# Workspace document reference handoff

Status: a user-initiated **metadata handoff**, not production single sign-on or service-to-service access.

## Endpoint

`GET /api/workspaces/:organisationId/:facilityId/:section/files/:fileId/reference?version=N`

- Uses the same Hub session, organisation/facility/section membership and database row-level privacy rules as document detail.
- Returns HTTP 401/403/404 for unauthenticated, unauthorized, missing, archived or unavailable document/version records, with no document bytes, direct bucket URL, capability token or named grants.
- If a controlled file requires publication, only its currently published immutable version is eligible. Without `version`, the published version is selected. Draft versions are never valid references for this handoff.
- Responds with `kind`, `organisationId`, `facilityId`, `section`, `documentId`, `version`, `versionId` and `title`. The UI copies the identifier fields, not the title.
- The reference itself is **not an access grant**: possession of it cannot open a file, and revocation takes effect when the Hub checks the user's session again.

The Hub document details page includes **Copy Workspace reference**. This requests the server-side reference resolver under the user's own session, then copies the identifier JSON.

## Security and integration limitation

The Workspace still uses synthetic identities; do not turn this into a cross-origin CORS read or a backend credential proxy. Workspaces currently store the reference as an unverified identifier, not an authenticated assertion. A future portal can only resolve/open it after **independent Workspace task authorization and Hub file/version authorization**. Never treat a document UUID, title or project membership as a Hub permission.

Do not use real HR, clinical or patient documents in the preview. Verify production identity, storage, malware scanning, retention, incident response and environment configuration before deploying.
