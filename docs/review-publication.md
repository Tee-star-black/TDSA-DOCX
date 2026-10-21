# Controlled documents: independent review and publication

Status: implemented for the **Compliance & HR PostgreSQL runtime**, pending Cloud SQL / GCS / scanner / approved identity provider staging acceptance. Synthetic preview identities only until those gates pass.

## Why this exists

Draft edits must not silently replace the current approved policy. Ordinary **section readers** must only be able to find, preview or download an explicitly published immutable version. Editors and managers can work on newer drafts. Personal employee records and named-restricted files remain under their existing access rules and cannot be classified as controlled publications.

## Workflow

1. A section manager uploads a *section* or *department-team* document with **Require independent review**, or explicitly enables this protection on an existing file. This setting is intentionally irreversible through the app.
2. An editor/manager submits the **current latest immutable version** for review. Only one pending request exists at a time. Each submission and decision is auditable and version-pinned.
3. A **different section manager** (not the submitter and not the version's author) approves it or requests corrections. Rejecting requires a note. No self-approval.
4. After approval, a section manager must separately select **Publish**. Publication pins the exact reviewed version. The database refuses publication if the approval does not match or violates separation of duties.
5. A later upload leaves the previously published version available to readers. The new draft is unavailable to readers until separately submitted, approved and published. Pending requests against the old version are marked *superseded* on upload.
6. Archiving prevents new submissions, decisions and publication. Existing historical publications and audit records are never erased.

For a section with only one manager, a second approved manager is required to review that manager's version. Do not weaken separation-of-duties in code to make testing convenient; use synthetic fixture members until the business approves real roles.

## Access matrix

| Operation | Reader | Editor | Manager |
| --- | --- | --- | --- |
| See unpublished controlled document | No | Yes | Yes |
| Download published version | Yes, subject to privacy | Yes | Yes |
| Upload new draft | No | Yes | Yes |
| Submit latest version | No | Yes | Yes |
| Approve/reject | No | No | Yes; independent person only |
| Publish an approved latest version | No | No | Yes |
| Change controlled privacy to personal or restricted | No | No | **Not permitted** |

These checks live in the backend; PostgreSQL row policies additionally hide unpublished controlled files and non-published versions from readers. Prior section and membership privacy rules remain in effect. This is a governance workflow, **not a cryptographic digital-signature system**.

## Data model

Migration `003_review_publication.sql` adds `files.requires_approval`, `file_approvals` (review decisions/history) and append-only `file_publications` (published version pointers and the responsible manager). Foreign keys bind reviews/publications to the same organisation, facility, section, file and immutable version. Approval transitions and published history have database triggers and audit actions. The default for older documents is **not controlled**, preserving their existing visibility; the business owner must identify and explicitly convert affected policies.

The older `file_metadata.review_status` tracks metadata review and is **not** a document publication approval. A version upload still resets metadata review separately.

## API contract

All URLs are under `/api/workspaces/:organisation/:facility/:section` and require verified sessions, CSRF validation for writes, server-side membership resolution and an authorised role.

| Method | Path | Body |
| --- | --- | --- |
| `PUT` | `/files/:fileId/controlled` | `{ "revision": 1 }` (manager only, one-way enable) |
| `GET` | `/files/:fileId/approvals` | None; reader response excludes private decision history |
| `POST` | `/files/:fileId/approvals` | `{ "revision": 2, "note": "Ready" }` |
| `PUT` | `/files/:fileId/approvals/:approvalId/decision` | `{ "revision": 3, "decision": "approved" | "rejected", "note": "..." }` |
| `POST` | `/files/:fileId/publications` | `{ "revision": 4 }` |

Uploads may include `requiresApproval: true` only when a manager creates a new section or team document. All revision values are current file revisions fetched from `GET /files/:fileId`; concurrent/stale decisions fail with HTTP 409. A protected policy can always be inspected via `GET /files/:fileId/approvals` by its authorized editor/manager.

## Deployment / validation

- Run `npm run pg:plan`, then apply migration `003_review_publication.sql` through the independent migration identity. Apply the **updated idempotent** `scripts/runtime-grants.sql` with an administrator so runtime roles can use the new tables.
- Verify that the restricted runtime login has no RLS-bypass, owner or DDL privileges. Test reader/editor/manager separation, authorship separation, stale revisions, race conditions and direct-version URLs in a real staging Cloud SQL environment.
- Test legacy documents explicitly marked controlled: do **not** assume old file_metadata `review_status='reviewed'` is equivalent to publication.
- Verify that unapproved versions remain inaccessible to staff readers after scanner failures, database rollbacks, membership revocation and uploading newer drafts. Confirm the old published version still downloads byte-for-byte.
- Run document workflow checks in CI and restore a full database-plus-object-store backup in staging before production access.

## Not included in this milestone

Electronic signatures, staff policy acknowledgements, Google Drive import, retention schedules, OCR, MedCNX employee synchronization, external email alerts, and actual production cloud deployment. These require approved organisational policy, infrastructure identities and further end-to-end testing. No real employee or patient data belongs in the synthetic preview.
