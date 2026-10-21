-- Controlled documents: independent review, explicit publication and pinned immutable versions.
-- This migration is additive. Personal and named-restricted documents are not publishable.
ALTER TABLE document_hub.files
  ADD COLUMN requires_approval boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT controlled_section_document CHECK
    (NOT requires_approval OR privacy IN ('section', 'team'));

-- Needed for composite foreign keys that bind the approval to the same document.
ALTER TABLE document_hub.file_versions
  ADD CONSTRAINT version_belongs_to_file UNIQUE
    (organisation_id,facility_id,section,file_id,id);

CREATE TABLE document_hub.file_approvals (
  organisation_id text NOT NULL,
  facility_id text NOT NULL,
  section text NOT NULL CHECK(section IN ('compliance','hr')),
  id uuid NOT NULL,
  file_id uuid NOT NULL,
  version_id uuid NOT NULL,
  submitted_by uuid NOT NULL REFERENCES hub_identity.principals(id),
  submission_note text NOT NULL DEFAULT '' CHECK(length(submission_note)<=2000),
  status text NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','approved','rejected','superseded')),
  reviewed_by uuid REFERENCES hub_identity.principals(id),
  review_note text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  PRIMARY KEY(organisation_id,facility_id,section,id),
  UNIQUE(organisation_id,facility_id,section,file_id,id),
  FOREIGN KEY(organisation_id,facility_id,section,file_id)
    REFERENCES document_hub.files(organisation_id,facility_id,section,id),
  FOREIGN KEY(organisation_id,facility_id,section,file_id,version_id)
    REFERENCES document_hub.file_versions(organisation_id,facility_id,section,file_id,id),
  CONSTRAINT approval_decision_shape CHECK (
    (status IN ('pending','superseded') AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_note IS NULL)
    OR (status IN ('approved','rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  CONSTRAINT distinct_approval_reviewer CHECK (reviewed_by IS NULL OR reviewed_by<>submitted_by)
);
CREATE UNIQUE INDEX one_pending_approval ON document_hub.file_approvals
  (organisation_id,facility_id,section,file_id) WHERE status='pending';
CREATE INDEX approvals_by_file ON document_hub.file_approvals
  (organisation_id,facility_id,section,file_id,submitted_at DESC);

CREATE TABLE document_hub.file_publications (
  organisation_id text NOT NULL,
  facility_id text NOT NULL,
  section text NOT NULL CHECK(section IN ('compliance','hr')),
  id bigint GENERATED ALWAYS AS IDENTITY,
  file_id uuid NOT NULL,
  version_id uuid NOT NULL,
  approval_id uuid NOT NULL,
  published_by uuid NOT NULL REFERENCES hub_identity.principals(id),
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organisation_id,facility_id,section,id),
  UNIQUE(organisation_id,facility_id,section,file_id,version_id),
  FOREIGN KEY(organisation_id,facility_id,section,file_id)
    REFERENCES document_hub.files(organisation_id,facility_id,section,id),
  FOREIGN KEY(organisation_id,facility_id,section,file_id,version_id)
    REFERENCES document_hub.file_versions(organisation_id,facility_id,section,file_id,id),
  FOREIGN KEY(organisation_id,facility_id,section,file_id,approval_id)
    REFERENCES document_hub.file_approvals(organisation_id,facility_id,section,file_id,id)
);
CREATE INDEX publications_by_file ON document_hub.file_publications
  (organisation_id,facility_id,section,file_id,id DESC);

-- Runtime transactions already set trusted, validated section and principal context.
-- Do not make publication tables globally readable or writable.
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['file_approvals','file_publications'] LOOP
    EXECUTE format('ALTER TABLE document_hub.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE document_hub.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY section_scope ON document_hub.%I USING
      (organisation_id=current_setting(''tdsa.organisation_id'',true)
       AND facility_id=current_setting(''tdsa.facility_id'',true)
       AND section=current_setting(''tdsa.section'',true)) WITH CHECK
      (organisation_id=current_setting(''tdsa.organisation_id'',true)
       AND facility_id=current_setting(''tdsa.facility_id'',true)
       AND section=current_setting(''tdsa.section'',true))',t);
  END LOOP;
END $$;

-- Readers never discover unpublished controlled policies through SQL-backed search.
CREATE POLICY controlled_file_visibility ON document_hub.files
  AS RESTRICTIVE FOR SELECT USING (
    NOT requires_approval
    OR current_setting('tdsa.role',true) IN ('editor','manager')
    OR EXISTS (SELECT 1 FROM document_hub.file_publications p WHERE p.file_id=files.id)
  );
-- Readers receive exactly the published immutable version, not any newer draft.
CREATE POLICY controlled_version_visibility ON document_hub.file_versions
  AS RESTRICTIVE FOR SELECT USING (
    current_setting('tdsa.role',true) IN ('editor','manager')
    OR EXISTS (
      SELECT 1 FROM document_hub.files f WHERE f.id=file_versions.file_id AND (
        NOT f.requires_approval OR EXISTS (
          SELECT 1 FROM document_hub.file_publications p
          WHERE p.file_id=f.id AND p.version_id=file_versions.id
        )
      )
    )
  );

-- A publication is never accepted unless its pinned version has a valid,
-- independently approved decision. The database rechecks even if an API errs.
CREATE FUNCTION document_hub.validate_published_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM document_hub.file_approvals a
    JOIN document_hub.file_versions v ON v.id=a.version_id AND v.file_id=a.file_id
    JOIN document_hub.files f ON f.id=a.file_id
    WHERE a.id=NEW.approval_id AND a.file_id=NEW.file_id
      AND a.version_id=NEW.version_id AND a.status='approved'
      AND a.reviewed_by IS NOT NULL
      AND a.submitted_by<>a.reviewed_by
      AND v.author_id<>a.reviewed_by::text
      AND f.requires_approval AND NOT f.archived
  ) THEN RAISE EXCEPTION 'Publishing requires independent approval of this exact version'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER check_published_approval BEFORE INSERT
  ON document_hub.file_publications FOR EACH ROW
  EXECUTE FUNCTION document_hub.validate_published_approval();

CREATE TRIGGER immutable_publications BEFORE UPDATE OR DELETE
  ON document_hub.file_publications FOR EACH ROW
  EXECUTE FUNCTION document_hub.reject_history_change();

-- Review history may transition only once, from pending into a terminal state.
-- Immutable provenance and approved/rejected reviewer details cannot be rewritten.
CREATE FUNCTION document_hub.guard_approval_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status<>'pending' OR NEW.status NOT IN ('approved','rejected','superseded')
     OR (NEW.organisation_id,NEW.facility_id,NEW.section,NEW.id,NEW.file_id,
         NEW.version_id,NEW.submitted_by,NEW.submission_note,NEW.submitted_at)
      IS DISTINCT FROM
        (OLD.organisation_id,OLD.facility_id,OLD.section,OLD.id,OLD.file_id,
         OLD.version_id,OLD.submitted_by,OLD.submission_note,OLD.submitted_at)
  THEN RAISE EXCEPTION 'Approval history may only transition once'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER controlled_approval_transition BEFORE UPDATE
  ON document_hub.file_approvals FOR EACH ROW
  EXECUTE FUNCTION document_hub.guard_approval_transition();
CREATE TRIGGER immutable_approval_deletes BEFORE DELETE
  ON document_hub.file_approvals FOR EACH ROW
  EXECUTE FUNCTION document_hub.reject_history_change();

REVOKE ALL ON document_hub.file_approvals,document_hub.file_publications FROM PUBLIC;
REVOKE ALL ON FUNCTION document_hub.guard_approval_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION document_hub.validate_published_approval() FROM PUBLIC;
