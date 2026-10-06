# Integration contract — draft

This local adapter is **not authentication**. Replace the fixed actor and local CSRF/session bootstrap before hosting. The deployment guard must stay in place until identity, permissions, storage and acceptance checks exist.

## Decisions for the CTO

1. Host app framework, integration approach (shared components or API), authentication issuer/session mechanism and verification.
2. Authoritative user, facility, patient and encounter IDs; checks for membership and patient access on every request.
3. Whether submissions live in this module or the host backend. Choose one authoritative owner. Agree retries, idempotency and record-delivery reconciliation if data crosses services.
4. Database and private object storage, backups/restore, secrets, retention and authorised disposal.
5. Clinical template owner, policy approver, signature/attestation expectations and pilot facilities.

## Current API

| Method | Route | Behaviour |
| --- | --- | --- |
| GET | `/api/session` | Local demo actor and CSRF bootstrap only |
| GET | `/api/documents` | Source catalogue plus local PDF availability |
| GET | `/api/documents/:id/file` | Non-restricted imported PDF |
| GET | `/api/templates` | Pilot definitions and exact versions |
| GET / POST | `/api/submissions` | List own records / create draft |
| GET / PUT | `/api/submissions/:id` | Read own record / update draft with revision |
| POST | `/api/submissions/:id/submit` | Validate, attest and lock; same-content retry returns existing final record |
| GET | `/api/cases` | Own feedback register entries |
| GET | `/records/:id/print` | Access-checked printable HTML |

Mutations require JSON and the `X-CSRF-Token` returned by the demo session. The server blocks cross-origin and cross-site requests and rejects unexpected hosts. It serves only explicitly listed assets and file routes; `.data` is not public. Local processes/users can still access the demo: use synthetic records only.

Create/update/submit body:

```json
{
  "templateId": "complaint",
  "templateVersion": 1,
  "facilityId": "demo-facility",
  "revision": 1,
  "attested": true,
  "data": {"type":"Complaint","anonymous":true,"details":"Synthetic example"}
}
```

Errors: 422 with field errors; 409 for stale drafts or immutable records; 404 for records outside the actor's scope; 403 for request protections. Version changes need a new immutable template definition; the pilot supports version 1 only. Draft creation is not idempotent; finalisation of a known draft is. Add caller idempotency keys before supporting offline or cross-service creation retries.

## Production replacement checklist

- Verified identity, session expiry/revocation, logout and server-enforced roles/facility/patient scope.
- Immutable published document/template versions, review/approval, restricted record types and audited amendments.
- Private hosted files, access-checked short-lived downloads, upload controls and scanning.
- Production relational database migrations, transaction/concurrency checks, backups and restore verification.
- Approved policy deadlines, clinical fields/rules, consent evidence and final record export snapshots.
- Rate limiting, monitoring, privacy-safe logs, accessibility and end-to-end clinician-app acceptance.
