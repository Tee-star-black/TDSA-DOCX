-- Apply with the migration administrator after migrations. Grant this NOLOGIN
-- role to the approved Cloud SQL application login; never grant ownership.
DO 'BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=''tdsa_runtime'') THEN CREATE ROLE tdsa_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF; END';
GRANT USAGE ON SCHEMA document_hub,hub_identity TO tdsa_runtime;
GRANT SELECT ON public.tdsa_schema_migrations TO tdsa_runtime;
GRANT SELECT ON hub_identity.principals,hub_identity.memberships TO tdsa_runtime;
GRANT SELECT,INSERT,DELETE ON hub_identity.sessions,hub_identity.login_attempts TO tdsa_runtime;
GRANT SELECT,INSERT,UPDATE ON document_hub.folders,document_hub.files,document_hub.file_metadata,document_hub.file_grants TO tdsa_runtime;
GRANT DELETE ON document_hub.file_grants TO tdsa_runtime;
GRANT SELECT,INSERT ON document_hub.file_versions,document_hub.objects,document_hub.audit TO tdsa_runtime;
GRANT SELECT,INSERT,UPDATE ON document_hub.file_approvals TO tdsa_runtime;
GRANT SELECT,INSERT ON document_hub.file_publications TO tdsa_runtime;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA document_hub TO tdsa_runtime;
GRANT SELECT,INSERT,UPDATE ON document_hub.document_requirements TO tdsa_runtime;
