-- Never guess the department of existing records. A populated foundation needs
-- an explicit reviewed mapping before this migration can be applied.
DO $$ DECLARE t text; occupied boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['folders','files','objects','file_versions','file_metadata','audit'] LOOP
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM document_hub.%I)',t) INTO occupied;
    IF occupied THEN RAISE EXCEPTION 'Section ownership must be mapped before migration 002'; END IF;
  END LOOP;
END $$;

CREATE SCHEMA hub_identity;
REVOKE ALL ON SCHEMA hub_identity FROM PUBLIC;
CREATE TABLE hub_identity.principals (
  id uuid PRIMARY KEY,
  issuer text NOT NULL,
  subject text NOT NULL,
  display_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (issuer,subject)
);
CREATE TABLE hub_identity.memberships (
  organisation_id text NOT NULL,
  facility_id text NOT NULL,
  section text NOT NULL CHECK(section IN ('compliance','hr')),
  principal_id uuid NOT NULL REFERENCES hub_identity.principals(id),
  role text NOT NULL CHECK(role IN ('reader','editor','manager')),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY(organisation_id,facility_id,section,principal_id),
  FOREIGN KEY(organisation_id,facility_id) REFERENCES document_hub.facilities(organisation_id,id)
);
CREATE TABLE hub_identity.sessions (
  token_hash text PRIMARY KEY,
  principal_id uuid NOT NULL REFERENCES hub_identity.principals(id),
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX session_expiry ON hub_identity.sessions(expires_at);
CREATE TABLE hub_identity.login_attempts (
  state_hash text PRIMARY KEY,
  binding_hash text NOT NULL,
  verifier text NOT NULL,
  nonce text NOT NULL,
  expires_at timestamptz NOT NULL
);

DO $$ DECLARE t text; c record;
BEGIN
  FOREACH t IN ARRAY ARRAY['folders','files','objects','file_versions','file_metadata','audit'] LOOP
    EXECUTE format('ALTER TABLE document_hub.%I ADD COLUMN section text NOT NULL CHECK(section IN (''compliance'',''hr''))',t);
    EXECUTE format('DROP POLICY facility_scope ON document_hub.%I',t);
    EXECUTE format('CREATE POLICY section_scope ON document_hub.%I USING
      (organisation_id=current_setting(''tdsa.organisation_id'',true)
       AND facility_id=current_setting(''tdsa.facility_id'',true)
       AND section=current_setting(''tdsa.section'',true)) WITH CHECK
      (organisation_id=current_setting(''tdsa.organisation_id'',true)
       AND facility_id=current_setting(''tdsa.facility_id'',true)
       AND section=current_setting(''tdsa.section'',true))',t);
  END LOOP;
  -- Replace only relationships to document tables; retain facility ownership FKs.
  FOR c IN SELECT conrelid::regclass AS tbl,conname FROM pg_constraint
    WHERE contype='f' AND confrelid IN ('document_hub.folders'::regclass,'document_hub.files'::regclass,'document_hub.objects'::regclass)
  LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',c.tbl,c.conname); END LOOP;
END $$;
ALTER TABLE document_hub.folders ADD UNIQUE(organisation_id,facility_id,section,id);
ALTER TABLE document_hub.files ADD UNIQUE(organisation_id,facility_id,section,id);
ALTER TABLE document_hub.objects ADD UNIQUE(organisation_id,facility_id,section,id);
ALTER TABLE document_hub.folders ADD FOREIGN KEY(organisation_id,facility_id,section,parent_id) REFERENCES document_hub.folders(organisation_id,facility_id,section,id);
ALTER TABLE document_hub.files ADD FOREIGN KEY(organisation_id,facility_id,section,folder_id) REFERENCES document_hub.folders(organisation_id,facility_id,section,id);
ALTER TABLE document_hub.file_versions ADD FOREIGN KEY(organisation_id,facility_id,section,file_id) REFERENCES document_hub.files(organisation_id,facility_id,section,id);
ALTER TABLE document_hub.file_versions ADD FOREIGN KEY(organisation_id,facility_id,section,object_id) REFERENCES document_hub.objects(organisation_id,facility_id,section,id);
ALTER TABLE document_hub.file_metadata ADD FOREIGN KEY(organisation_id,facility_id,section,file_id) REFERENCES document_hub.files(organisation_id,facility_id,section,id);
DROP INDEX document_hub.folder_root_name;
DROP INDEX document_hub.folder_child_name;
CREATE UNIQUE INDEX folder_root_name ON document_hub.folders(organisation_id,facility_id,section,lower(name)) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX folder_child_name ON document_hub.folders(organisation_id,facility_id,section,parent_id,lower(name)) WHERE parent_id IS NOT NULL;

ALTER TABLE document_hub.files ADD COLUMN privacy text NOT NULL DEFAULT 'team' CHECK(privacy IN ('section','team','personal','restricted'));
ALTER TABLE document_hub.files ADD COLUMN subject_id uuid;
ALTER TABLE document_hub.files ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0);
ALTER TABLE document_hub.files ADD CHECK ((privacy='personal' AND section='hr' AND subject_id IS NOT NULL) OR (privacy<>'personal' AND subject_id IS NULL));
ALTER TABLE document_hub.files ADD FOREIGN KEY(organisation_id,facility_id,section,subject_id) REFERENCES hub_identity.memberships(organisation_id,facility_id,section,principal_id);
CREATE TABLE document_hub.file_grants (
  organisation_id text NOT NULL,
  facility_id text NOT NULL,
  section text NOT NULL,
  file_id uuid NOT NULL,
  principal_id uuid NOT NULL,
  capability text NOT NULL CHECK(capability IN ('read','manage')),
  PRIMARY KEY(organisation_id,facility_id,section,file_id,principal_id),
  FOREIGN KEY(organisation_id,facility_id,section,file_id) REFERENCES document_hub.files(organisation_id,facility_id,section,id),
  FOREIGN KEY(organisation_id,facility_id,section,principal_id) REFERENCES hub_identity.memberships(organisation_id,facility_id,section,principal_id)
);
ALTER TABLE document_hub.file_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_hub.file_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY section_scope ON document_hub.file_grants USING
  (organisation_id=current_setting('tdsa.organisation_id',true) AND facility_id=current_setting('tdsa.facility_id',true) AND section=current_setting('tdsa.section',true))
  WITH CHECK (organisation_id=current_setting('tdsa.organisation_id',true) AND facility_id=current_setting('tdsa.facility_id',true) AND section=current_setting('tdsa.section',true));

-- Restrictive SELECT policies combine with section_scope. Runtime context comes
-- only from freshly resolved server-side membership, never browser claims.
CREATE POLICY file_privacy ON document_hub.files AS RESTRICTIVE FOR SELECT USING (
  privacy='section'
  OR (privacy='team' AND current_setting('tdsa.role',true) IN ('editor','manager'))
  OR (privacy='personal' AND (subject_id::text=current_setting('tdsa.principal_id',true) OR current_setting('tdsa.role',true)='manager'))
  OR (privacy='restricted' AND EXISTS(SELECT 1 FROM document_hub.file_grants g WHERE g.file_id=files.id AND g.principal_id::text=current_setting('tdsa.principal_id',true)))
);
CREATE POLICY version_privacy ON document_hub.file_versions AS RESTRICTIVE FOR SELECT USING
  (EXISTS(SELECT 1 FROM document_hub.files f WHERE f.id=file_versions.file_id));
CREATE POLICY metadata_privacy ON document_hub.file_metadata AS RESTRICTIVE FOR SELECT USING
  (EXISTS(SELECT 1 FROM document_hub.files f WHERE f.id=file_metadata.file_id));
CREATE POLICY object_privacy ON document_hub.objects AS RESTRICTIVE FOR SELECT USING
  (EXISTS(SELECT 1 FROM document_hub.file_versions v WHERE v.object_id=objects.id));
CREATE POLICY audit_privacy ON document_hub.audit AS RESTRICTIVE FOR SELECT USING
  (EXISTS(SELECT 1 FROM document_hub.files f WHERE f.id::text=audit.record_id)
   OR EXISTS(SELECT 1 FROM document_hub.folders f WHERE f.id::text=audit.record_id));

CREATE FUNCTION document_hub.reject_scope_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.organisation_id,OLD.facility_id,OLD.section) IS DISTINCT FROM (NEW.organisation_id,NEW.facility_id,NEW.section)
  THEN RAISE EXCEPTION 'Cross-section moves require a separate approved sharing workflow'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fixed_file_scope BEFORE UPDATE ON document_hub.files FOR EACH ROW EXECUTE FUNCTION document_hub.reject_scope_change();
CREATE TRIGGER fixed_folder_scope BEFORE UPDATE ON document_hub.folders FOR EACH ROW EXECUTE FUNCTION document_hub.reject_scope_change();
REVOKE ALL ON ALL TABLES IN SCHEMA hub_identity FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA document_hub FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA document_hub FROM PUBLIC;
