# Document Hub Explorer 2.0: document-first workspace

This branch extends `feat/document-hub-experience` and preserves its Compliance/HR authorization and controlled publication model. **It is not an approved cloud deployment.** Only synthetic records belong in the preview until staging acceptance.

## Interface

- Header: search shortcut, upload, new folder, review-queue notification indicator, and the existing user/session controls.
- Left: scoped Compliance/HR sections; All documents, My documents, Shared with me, Approvals, Expiring soon, Archive; expandable real folders and category filters.
- Centre: permission-filtered document list, list/grid controls, sorting, owner, lifecycle status and relevant dates.
- Right: inline preview for an authorized selected document, version downloads, access summary and workflow actions. The full detail page remains available for advanced access/grant and version operations.
- Summary: actionable independent approvals, expirations in the next 30 days (including already expired), and an explicit required-document register. If no requirements are configured, the UI shows **Set up** instead of a fabricated zero.
- Under 800 px the sidebar becomes a toggleable slide-out menu; under 600 px the preview becomes a full-screen overlay. The normal document list stays the primary content.

UI filters operate only on rows returned by the authorized backend; they never constitute a permission check. The owner column shows the **responsible document owner**, not ownership of the underlying employee record. Staff records remain subject to separate HR privacy rules.

## Document register (migration 004)

`004_document_register.sql` adds owner assignment and expiry to document metadata, and a scoped `document_requirements` register. It is additive. The previous approval and version history are untouched.

- Section managers can register required documents, optionally assign an employee, and link an approved/accessible file. An expired, archived, inaccessible, or unpublished controlled file cannot satisfy the requirement.
- An employee can see only requirements explicitly assigned to them, not another employee's requirements. Manager access stays section-scoped. These boundaries are also enforced by PostgreSQL row-level security.
- A manager cannot satisfy an employee-specific requirement using a file that employee cannot access. Current access is reevaluated when requirements are read, so later permission revocation makes the requirement missing again.
- Document classification updates category, type, responsible owner, tags, review date and expiry date. The server checks editing rights, membership, revisions, record privacy and section policy. All changes are audited. Updating a classification never approves or publishes content.
- The register does **not** automatically know which documents the company requires. A manager must configure the requirements first. This is deliberate.

## API additions

All endpoints are scoped under `/api/workspaces/:organisationId/:facilityId/:section` and use the existing OIDC/session (or synthetic preview) and CSRF protections.

| Method | Route | Role |
| --- | --- | --- |
| `GET` | `/register` | Active section membership, only own assignments for non-managers |
| `POST` | `/register/requirements` | Manager |
| `PUT` | `/register/requirements/:requirementId` | Manager |
| `PUT` | `/files/:fileId/classification` | Editor (manager needed to assign a new owner); existing document-level restrictions still apply |

`GET /register` returns `{configured, missing, requirements, role}`; `missing` is computed from the viewer's actual data and accessible files. New document metadata is also returned in the existing list/detail APIs.

## Deployment gates

1. Apply migration 004 with a separate migration administrator; update runtime grants with `scripts/runtime-grants.sql`.
2. Verify migration checksums, PostgreSQL row-level security, active section roles, and the requirement matrix with a restricted runtime database account against staging Cloud SQL.
3. Recheck the full approved document workflow, private GCS buckets, malware scanner, OIDC integration, HTTPS/CSRF, backup restore and offboarding in staging.
4. Configure business-approved document requirements and categories for each section; do not import real employee records during a preview.

Not yet implemented in this milestone: scheduled expiry notifications/email, manager-chosen named reviewer assignment, AI classification suggestions within the production runtime, Google Drive synchronization, automated archival/retention or MedCNX employee synchronization. **The notification icon opens the actual current approvals queue; it is not push/email notification delivery.**

## Verify

```powershell
npm ci
npm run check
npm test
npm run preview
```

Use an HR manager and employees A/B in preview to verify role boundaries. Try list/grid, folder expansion, the document inspector, date metadata, required-document creation/linking, and a controlled policy approval in both desktop and mobile layouts.
