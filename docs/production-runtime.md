# Compliance and HR runtime: GCP staging guide

Status: implemented and tested locally; not deployed or validated against a live GCP project. This is the successor to the storage preparation milestone. The approved project, region, identity provider and scanner service have not yet been supplied.

## Architecture and boundaries

Browser → HTTPS hub → verified OIDC identity → active organisation/facility/section membership → PostgreSQL transaction with local row-policy context → private section bucket. Uploads pass through an authenticated malware scanner before bytes are stored. Downloads recheck authorisation after storage retrieval and validate the stored hash and size.

Compliance and HR share an application and database, with explicit section keys, composite foreign keys, row-level policies and distinct buckets. A user can belong to both sections, with a different role in each. No cross-section grants or moves are available. These controls isolate application users; database/cloud administrators and the trusted application service identity still have infrastructure access. They are not separate cryptographic or administrative tenants.

The privacy matrix is in the [README](../README.md). Named access requires an explicit grant even for managers. A manage grant never promotes a reader into an editor. Privacy changes clear other named permissions, preventing old permissions from returning when a file becomes restricted again. Employee reassignment immediately changes who can open the personal record. All HR managers can read personal records; use named access when fewer people should see a record.

Folder names are visible to every member of their section. File titles, search results, counts, versions, document bytes and file activity are filtered by file privacy. Avoid employee details in folder names. Membership is read afresh for each operation; sessions do not cache roles. A request already in progress can finish if access is changed after its final check; previously downloaded copies cannot be recalled.

## Required configuration

| Name | Value |
| --- | --- |
| `TDSA_PUBLIC_ORIGIN` | Canonical HTTPS origin, without a trailing slash or path |
| `TDSA_POSTGRES_URL` | Secret PostgreSQL connection URI for the restricted runtime login |
| `TDSA_OIDC_ISSUER` | Exact approved HTTPS issuer, with discovery support |
| `TDSA_OIDC_CLIENT_ID` | Confidential web application client ID |
| `TDSA_OIDC_CLIENT_SECRET` | Secret client credential |
| `TDSA_COMPLIANCE_BUCKET` | Private Compliance bucket name |
| `TDSA_HR_BUCKET` | Different private HR bucket name |
| `TDSA_SCANNER_URL` | HTTPS scan endpoint on the scanner's canonical Cloud Run service URL |
| `PORT` | Cloud Run injected port (8080 by default) |

Use Secret Manager for connection and client credentials. The service uses Application Default Credentials from its attached service identity for GCS and scanner calls. Do not bake credentials, service-account key files, `.env`, data or real identity mappings into the image/repository. This implementation uses a configured database login; automatic Cloud SQL IAM database authentication is not implemented.

## Cloud SQL and database roles

1. Choose the approved project, region and PostgreSQL version, with an owner-approved backup, point-in-time recovery and availability plan. Create a dedicated database. The migrations are tested against PGlite; staging must also verify them against the selected Cloud SQL PostgreSQL version.
2. Configure Cloud Run's Cloud SQL connection and grant the runtime service identity Cloud SQL Client access. Use the mounted `/cloudsql/PROJECT:REGION:INSTANCE` socket or an approved authenticated proxy/connector route. The URI can specify a percent-encoded socket directory through `?host=...`. Percent-encode credentials. Direct TCP requires verified TLS; do not use `rejectUnauthorized:false`. See [Google's Cloud Run connection guide](https://docs.cloud.google.com/sql/docs/postgres/connect-run).
3. With the separate migration administrator, set the migration process's `TDSA_POSTGRES_URL`, inspect `npm run pg:plan`, then run `npm run pg:migrate -- --confirm`. The migration runner checks history/checksums and rolls back failed migrations.
4. Apply `scripts/runtime-grants.sql` once as the administrator. Grant its `tdsa_runtime` group to a dedicated application login. That login must not own tables, inherit the owner/admin role, be a superuser, or have BYPASSRLS/DDL privileges. Startup rejects direct ownership, superuser and BYPASSRLS. Operators must also review inherited privileges. The application cannot modify principals or memberships.
5. Keep migration/identity provisioning credentials out of the service. Use the restricted application URI in the running service, then verify real section and privacy isolation with that login.

Migration 002 deliberately refuses a database containing document records from migration 001. Do not empty an existing database to get past this guard. A populated database needs a reviewed ownership/privacy mapping and a separately tested migration. The legacy export verifier does not import into the new runtime. Do not start the old app against new hub storage.

## Identity and membership provisioning

Register the exact callback `TDSA_PUBLIC_ORIGIN/auth/callback` with the chosen identity provider. The runtime uses authorization code, PKCE, state, nonce and signed ID-token verification. It stores hashed opaque session tokens in PostgreSQL, with Secure/HttpOnly/SameSite cookies and a maximum one-hour session capped by the ID-token expiry. Logout revokes the local session; it does not globally sign the user out of their identity provider. MFA and conditional-access rules belong to that provider.

The runtime accepts only identities pre-provisioned by an administrator using their exact issuer and stable subject identifier. An email address, browser-supplied role or similarly named employee never grants access. With the administrative connection, provision records in this order using parameterised statements in a controlled tool:

1. `document_hub.organisations(id,name)` and `document_hub.facilities(organisation_id,id,name)`.
2. `hub_identity.principals(id,issuer,subject,display_name,active)` using a generated UUID and the verified issuer/subject.
3. `hub_identity.memberships(organisation_id,facility_id,section,principal_id,role,active)` for each approved section. Roles are `reader`, `editor`, `manager`.

Record the approver and provisioning changes in the organisation's administrative audit system. There is no membership-management UI or provisioning API in this milestone. Deactivate membership to remove one section; deactivate the principal and revoke sessions for account-wide removal. Named grants are subordinate to active membership. Recovery of a restricted document with no active managing member requires a separately authorised administrator action, not a manager override in the app.

Future HR integration should use a dedicated audited service identity with a narrowly scoped provisioning interface, stable external employee IDs and explicit access mapping. It must handle joins, transfers and offboarding without assigning Compliance access implicitly. No HR credentials, employee sync or external HR endpoints are connected in this release.

## Document buckets and malware scanning

Create two distinct buckets in the approved location. Explicitly enable uniform bucket-level access and set public access prevention to `enforced` on each bucket. Startup checks both settings. An inherited public-access policy alone is not accepted by this adapter. See Google's [uniform access](https://docs.cloud.google.com/storage/docs/uniform-bucket-level-access) and [public access prevention](https://docs.cloud.google.com/storage/docs/public-access-prevention) documentation.

Give the hub identity only `storage.buckets.get`, `storage.objects.create` and `storage.objects.get` on these two buckets (via an approved custom role). It does not need object delete, public access, ACL modification or a signed-URL signer. Verify effective inherited permissions too. Use a separate operations identity for retention/reconciliation. The application stores opaque keys and exact generations, creates with generation-match zero, and verifies CRC32c plus SHA-256. It streams authenticated downloads through the hub rather than issuing public links.

The scanner is a required external service; this repository contains the adapter, not a malware engine. Deploy and maintain an approved engine independently, including signature updates, file/archive limits and monitoring. Its contract is:

- Authenticated `POST` of raw bytes with `Content-Type: application/octet-stream` and `X-Content-SHA256`.
- Verify the actual bytes independently; return JSON `{ "verdict": "clean", "sha256": "<computed digest>" }` only when a complete scan succeeds. Infected files return `verdict: "infected"` with the computed digest.
- Unknown verdicts, mismatched hashes, timeouts and scanner errors block upload. The client uses a 30-second timeout and does not retry automatically.
- Grant the hub service identity invocation permission on the scanner. Its ID-token audience is the endpoint's HTTPS origin; use the canonical service URL, with the scan path if needed. For a custom hostname, configure the matching custom audience. See [service-to-service authentication](https://docs.cloud.google.com/run/docs/authenticating/service-to-service).

The 4 MiB file limit applies before scanning; the HTTP JSON limit is 6 MiB. Uploads can leave an unreferenced private object if storage succeeds but the database transaction fails. A separately controlled reconciliation job must compare object key/generation pairs against committed references, use a suitable age grace period and preserve every referenced historical version. No automatic deletion is implemented. Do not enable blanket age-based deletion on live buckets. Retention, legal holds and deletion approval remain organisational decisions and need an implementation before relevant retention commitments can be claimed.

## Container and Cloud Run acceptance

The Dockerfile runs Node.js 24 as a non-root user and packages only the runtime and hub assets. It excludes the legacy SQLite server, preview fixtures and migration/admin tools. Run migrations from a separate controlled job with the repository's locked dependencies. Build, scan and pin the resulting image digest in the deployment pipeline.

Configure the service identity, secrets, Cloud SQL attachment, approved ingress and canonical HTTPS origin. The service rejects alternate Host values and cross-origin mutations. If the platform's health probe does not use the canonical Host, use a TCP startup/liveness probe. `/healthz` is liveness only, not database/scanner readiness. Keep concurrency and maximum instances within the database connection budget: each instance allows up to ten PostgreSQL connections. Test graceful shutdown and upstream request timeouts with representative scan latency.

Before real documents are allowed:

- Verify live login and denial for unprovisioned/deactivated users, cookie settings, logout, CSRF and the absence of preview login routes.
- Test separate Compliance/HR users, an employee pair, a dual-section user and named read/manage/revoked grants through search, direct URLs, downloads and historical versions.
- Upload synthetic PDF, DOCX and TXT, then verify a new version, stale-save rejection, archive/restore and byte hashes. Use the scanner's approved harmless detection fixture to prove rejection, and prove fail-closed behaviour during scanner outage.
- Confirm bucket IAM prevents anonymous access and enforces the intended service permissions. Check version retrieval after object lifecycle changes in staging.
- Restore Cloud SQL plus matching bucket generations into an isolated environment and reconcile references. A database backup alone does not contain document bytes.
- Configure operational logging/alerts, identity-administration audit, request rate limiting, scanner freshness and object-reconciliation monitoring. The application records document actions but currently has no complete operational/error telemetry or failed-access audit pipeline.
- Test expected concurrent load, database connection limits and the deployment/rollback procedure. Upload retry idempotency is not implemented: a retry of a new-file upload can create another document. Concurrent version writes use revisions, but a losing upload may leave a private orphan object.

These are deployment acceptance gates, not checks already performed against your GCP account. Clinical forms, patient feedback, AI/OCR, document approvals, scheduled reviews and the future HR-system integration are not served by this new runtime.

## Controlled document publication (migration 003)

The approval and publication lifecycle is described in [review-publication.md](review-publication.md). Apply `003_review_publication.sql` and rerun the **idempotent** `scripts/runtime-grants.sql` as the migration administrator before restarting the restricted runtime. This enforces independent manager review and explicitly pins published immutable versions. Existing files remain uncontrolled until authorised managers opt into governance; audit and classify legacy policies before making them controlled. Published versions must be verified with real Cloud SQL RLS and GCS generation references in staging before staff receive access.
