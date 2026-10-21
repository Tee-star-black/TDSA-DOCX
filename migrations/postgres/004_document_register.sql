-- Document classification, renewal dates and auditable document requirements.
-- Does not change existing document privacy or approval/publication policies.
ALTER TABLE document_hub.file_metadata ADD COLUMN owner_principal_id uuid;
ALTER TABLE document_hub.file_metadata ALTER COLUMN category SET DEFAULT 'General';
UPDATE document_hub.file_metadata SET category='General' WHERE category='general';
ALTER TABLE document_hub.file_metadata ADD COLUMN expires_on date;
ALTER TABLE document_hub.file_metadata ADD CONSTRAINT active_section_document_owner
  FOREIGN KEY (organisation_id,facility_id,section,owner_principal_id)
  REFERENCES hub_identity.memberships(organisation_id,facility_id,section,principal_id);
CREATE INDEX metadata_expiry ON document_hub.file_metadata
  (organisation_id,facility_id,section,expires_on) WHERE expires_on IS NOT NULL;

CREATE TABLE document_hub.document_requirements (
  organisation_id text NOT NULL,
  facility_id text NOT NULL,
  section text NOT NULL CHECK(section IN ('hr','compliance')),
  id uuid NOT NULL,
  title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 150),
  category text NOT NULL DEFAULT 'General' CHECK(length(category) BETWEEN 1 AND 80),
  due_on date,
  assigned_principal_id uuid,
  fulfilled_file_id uuid,
  created_by uuid NOT NULL REFERENCES hub_identity.principals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id,facility_id,section,id),
  FOREIGN KEY (organisation_id,facility_id,section,assigned_principal_id)
    REFERENCES hub_identity.memberships(organisation_id,facility_id,section,principal_id),
  FOREIGN KEY (organisation_id,facility_id,section,fulfilled_file_id)
    REFERENCES document_hub.files(organisation_id,facility_id,section,id)
);
ALTER TABLE document_hub.document_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_hub.document_requirements FORCE ROW LEVEL SECURITY;
CREATE POLICY section_scope ON document_hub.document_requirements USING (
  organisation_id=current_setting('tdsa.organisation_id',true)
  AND facility_id=current_setting('tdsa.facility_id',true)
  AND section=current_setting('tdsa.section',true)
) WITH CHECK (
  organisation_id=current_setting('tdsa.organisation_id',true)
  AND facility_id=current_setting('tdsa.facility_id',true)
  AND section=current_setting('tdsa.section',true)
);
-- Keep employee requirements private from unrelated staff and prevent SQL-level writes.
CREATE POLICY requirement_visibility ON document_hub.document_requirements
 AS RESTRICTIVE FOR SELECT USING (
    current_setting('tdsa.role',true)='manager'
    OR assigned_principal_id::text=current_setting('tdsa.principal_id',true)
 );
CREATE POLICY requirement_insert ON document_hub.document_requirements
 AS RESTRICTIVE FOR INSERT WITH CHECK(current_setting('tdsa.role',true)='manager');
CREATE POLICY requirement_update ON document_hub.document_requirements
 AS RESTRICTIVE FOR UPDATE USING(current_setting('tdsa.role',true)='manager')
 WITH CHECK(current_setting('tdsa.role',true)='manager');
CREATE INDEX requirements_assignee ON document_hub.document_requirements
 (organisation_id,facility_id,section,assigned_principal_id);
REVOKE ALL ON document_hub.document_requirements FROM PUBLIC;
