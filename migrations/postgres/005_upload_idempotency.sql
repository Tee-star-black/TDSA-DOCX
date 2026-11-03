-- One client-generated idempotency key per new-file creation intent.
-- No automatic expiry: stale reservations require reviewed administrator recovery.
CREATE TABLE document_hub.upload_requests (
  organisation_id text NOT NULL,
  facility_id text NOT NULL,
  section text NOT NULL CHECK (section IN ('hr','compliance')),
  principal_id uuid NOT NULL REFERENCES hub_identity.principals(id),
  request_id uuid NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  file_id uuid,
  version integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (organisation_id,facility_id,section,principal_id,request_id),
  FOREIGN KEY (organisation_id,facility_id,section,file_id)
    REFERENCES document_hub.files(organisation_id,facility_id,section,id),
  CONSTRAINT result_consistent CHECK (
    (file_id IS NULL AND version IS NULL AND completed_at IS NULL)
    OR (file_id IS NOT NULL AND version IS NOT NULL AND completed_at IS NOT NULL)
  )
);
ALTER TABLE document_hub.upload_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_hub.upload_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY upload_scope ON document_hub.upload_requests
  USING (organisation_id=current_setting('tdsa.organisation_id',true)
    AND facility_id=current_setting('tdsa.facility_id',true)
    AND section=current_setting('tdsa.section',true)
    AND principal_id::text=current_setting('tdsa.principal_id',true))
  WITH CHECK (organisation_id=current_setting('tdsa.organisation_id',true)
    AND facility_id=current_setting('tdsa.facility_id',true)
    AND section=current_setting('tdsa.section',true)
    AND principal_id::text=current_setting('tdsa.principal_id',true));
REVOKE ALL ON document_hub.upload_requests FROM PUBLIC;
