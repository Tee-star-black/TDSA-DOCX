-- Storage foundation only. Runtime identity and API adapters are not connected.
CREATE SCHEMA document_hub;
REVOKE ALL ON SCHEMA document_hub FROM PUBLIC;

CREATE TABLE document_hub.organisations (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  name text NOT NULL
);
CREATE TABLE document_hub.facilities (
  organisation_id text NOT NULL REFERENCES document_hub.organisations(id),
  id text NOT NULL CHECK (length(id) BETWEEN 1 AND 200),
  name text NOT NULL,
  PRIMARY KEY (organisation_id, id)
);
CREATE TABLE document_hub.folders (
  organisation_id text NOT NULL,
  facility_id text NOT NULL,
  id uuid NOT NULL,
  parent_id uuid,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 150),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, facility_id, id),
  FOREIGN KEY (organisation_id, facility_id) REFERENCES document_hub.facilities(organisation_id, id),
  FOREIGN KEY (organisation_id, facility_id, parent_id) REFERENCES document_hub.folders(organisation_id, facility_id, id),
  CHECK (parent_id IS DISTINCT FROM id)
);
CREATE UNIQUE INDEX folder_root_name ON document_hub.folders(organisation_id, facility_id, lower(name)) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX folder_child_name ON document_hub.folders(organisation_id, facility_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL;

CREATE TABLE document_hub.files (
  organisation_id text NOT NULL,
  facility_id text NOT NULL,
  id uuid NOT NULL,
  folder_id uuid,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 150),
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, facility_id, id),
  FOREIGN KEY (organisation_id, facility_id) REFERENCES document_hub.facilities(organisation_id, id),
  FOREIGN KEY (organisation_id, facility_id, folder_id) REFERENCES document_hub.folders(organisation_id, facility_id, id)
);
-- Content is held in a private object store. Never store public URLs here.
-- The storage adapter must verify bytes, scan them and pin the object generation.
CREATE TABLE document_hub.objects (
  organisation_id text NOT NULL,
  facility_id text NOT NULL,
  id uuid NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  storage_key text NOT NULL CHECK (length(storage_key) BETWEEN 1 AND 1024),
  storage_generation text NOT NULL CHECK (length(storage_generation) > 0),
  encryption_key_ref text,
  scan_status text NOT NULL CHECK (scan_status = 'clean'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, facility_id, id),
  FOREIGN KEY (organisation_id, facility_id) REFERENCES document_hub.facilities(organisation_id, id),
  UNIQUE (storage_key, storage_generation)
);
CREATE TABLE document_hub.file_versions (
  organisation_id text NOT NULL,
  facility_id text NOT NULL,
  id uuid NOT NULL,
  file_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  object_id uuid NOT NULL,
  filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 150),
  mime text NOT NULL,
  author_id text NOT NULL CHECK (length(author_id) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, facility_id, id),
  UNIQUE (organisation_id, facility_id, file_id, version),
  FOREIGN KEY (organisation_id, facility_id, file_id) REFERENCES document_hub.files(organisation_id, facility_id, id),
  FOREIGN KEY (organisation_id, facility_id, object_id) REFERENCES document_hub.objects(organisation_id, facility_id, id)
);
CREATE TABLE document_hub.file_metadata (
  organisation_id text NOT NULL,
  facility_id text NOT NULL,
  file_id uuid NOT NULL,
  category text NOT NULL DEFAULT 'general',
  document_type text NOT NULL DEFAULT 'Reference',
  confidentiality text NOT NULL DEFAULT 'internal' CHECK (confidentiality IN ('internal','restricted')),
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','reviewed')),
  tags jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(tags) = 'array'),
  review_date date,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  suggestion jsonb,
  reviewed_by text,
  reviewed_at timestamptz,
  PRIMARY KEY (organisation_id, facility_id, file_id),
  FOREIGN KEY (organisation_id, facility_id, file_id) REFERENCES document_hub.files(organisation_id, facility_id, id),
  CHECK ((review_status = 'reviewed' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    OR (review_status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL))
);
CREATE TABLE document_hub.audit (
  organisation_id text NOT NULL,
  facility_id text NOT NULL,
  id bigint GENERATED ALWAYS AS IDENTITY,
  actor_id text NOT NULL,
  action text NOT NULL,
  record_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, facility_id, id),
  FOREIGN KEY (organisation_id, facility_id) REFERENCES document_hub.facilities(organisation_id, id)
);
CREATE INDEX files_by_folder ON document_hub.files(organisation_id, facility_id, folder_id);
CREATE INDEX audit_by_record ON document_hub.audit(organisation_id, facility_id, record_id, created_at);

CREATE FUNCTION document_hub.reject_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Document history is immutable';
END;
$$;
CREATE TRIGGER immutable_versions BEFORE UPDATE OR DELETE ON document_hub.file_versions
  FOR EACH ROW EXECUTE FUNCTION document_hub.reject_history_change();
CREATE TRIGGER immutable_objects BEFORE UPDATE OR DELETE ON document_hub.objects
  FOR EACH ROW EXECUTE FUNCTION document_hub.reject_history_change();
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON document_hub.audit
  FOR EACH ROW EXECUTE FUNCTION document_hub.reject_history_change();

-- Only a trusted backend may set these transaction-local values after login.
-- They are defence in depth, not a replacement for authentication/permissions.
ALTER TABLE document_hub.organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_hub.organisations FORCE ROW LEVEL SECURITY;
CREATE POLICY organisation_scope ON document_hub.organisations
  USING (id = current_setting('tdsa.organisation_id', true))
  WITH CHECK (id = current_setting('tdsa.organisation_id', true));
ALTER TABLE document_hub.facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_hub.facilities FORCE ROW LEVEL SECURITY;
CREATE POLICY facility_scope ON document_hub.facilities
  USING (organisation_id = current_setting('tdsa.organisation_id', true) AND id = current_setting('tdsa.facility_id', true))
  WITH CHECK (organisation_id = current_setting('tdsa.organisation_id', true) AND id = current_setting('tdsa.facility_id', true));
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['folders','files','objects','file_versions','file_metadata','audit'] LOOP
    EXECUTE format('ALTER TABLE document_hub.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE document_hub.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY facility_scope ON document_hub.%I USING
      (organisation_id = current_setting(''tdsa.organisation_id'', true)
       AND facility_id = current_setting(''tdsa.facility_id'', true))
      WITH CHECK (organisation_id = current_setting(''tdsa.organisation_id'', true)
       AND facility_id = current_setting(''tdsa.facility_id'', true))', table_name);
  END LOOP;
END;
$$;
REVOKE ALL ON ALL TABLES IN SCHEMA document_hub FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA document_hub FROM PUBLIC;
