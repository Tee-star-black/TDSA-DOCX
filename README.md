# TDSA Document Hub — Compliance & HR

A central document hub with independently authorised Compliance and Human Resources workspaces. The new runtime uses **PostgreSQL, two private Google Cloud Storage buckets and verified OpenID Connect sign-in**. It has no SQLite fallback.

This branch is a production preparation milestone, **not a verified live deployment**. GCP project/region, approved identity provider, scanner and operational acceptance are still required. Use synthetic data in the local preview.

## Try the local preview

Use Node.js 24 and the locked dependencies:

```powershell
npm ci
npm run preview
```

Open the printed local URL (default http://127.0.0.1:8895). Choose Compliance manager, HR manager, Employee A/B, or Both departments to see the different boundaries. The preview uses a persistent embedded PostgreSQL engine (PGlite), local document files and synthetic identities. It does not use real login, GCS or malware scanning. Stop with Ctrl+C; refresh the browser after UI changes.

## Document access

| Privacy | Who can read within the assigned section |
| --- | --- |
| Section members | Active readers, editors and managers |
| Department team | Active editors and managers |
| Employee record (HR only) | The selected employee and authorised HR managers |
| Named access | Explicitly granted active section members; managers have no automatic override |

Section memberships are checked on every operation. PostgreSQL row policies also filter document rows, versions, objects and activity. Search, previews and downloads follow the same rules. Cross-section moves and grants are rejected. Folder names are visible throughout their section; use general folder names, not private employee information.

Readers cannot edit. Editors can create team documents and edit visible non-personal documents; restricted editing also requires a named manage grant. Managers can assign document privacy and named access only for documents they can manage. Changing privacy clears other named permissions. Membership administration remains a separate trusted operation.

Uploads support PDF, DOCX and UTF-8 TXT up to 4 MiB. The hub provides previews, immutable version history, revision conflict checks, archive/restore, folders, title/tag search and access audit events. DOCX previews show text. Uploading a version resets metadata review to pending; a full approval workflow is not part of this milestone.

## Prepare GCP

Follow [the production runtime guide](docs/production-runtime.md) for Cloud SQL roles, identity provisioning, private buckets, the scanner contract, deployment and acceptance checks. Copy `.env.example` for configuration names; inject credentials from the approved secret store.

```powershell
npm run pg:plan
# In a controlled migration job using the separate migration identity:
npm run pg:migrate -- --confirm
# With all approved runtime configuration present:
npm start
```

The runtime fails startup when required configuration, migrations, private bucket settings or the restricted database role are missing. It never creates production tables or grants users access automatically. The container excludes preview fixtures and legacy SQLite modules.

## Verify

```powershell
npm run check
npm test
```

Tests include PostgreSQL section/privacy enforcement, HTTP auth and CSRF, membership revocation, stale versions, GCS generation/hash checks, scanner failure and OIDC signature/state/nonce checks. GCP and OIDC adapter tests use controlled test doubles; they do not certify a real deployment.

The future HR integration will map verified external identities to explicit section membership and employee ownership. It is not connected yet. There is no cross-department sharing, OCR, automated retention, approval workflow or production import in this release.

The [legacy medical pilot](docs/legacy-pilot.md) is retained for migration reference and regression tests. Run it only with `npm run legacy:preview`; its SQLite data and patient/form routes are separate from the new hub. `db:*` and `migration:*` scripts are legacy recovery/export tools, not the new runtime. See [the storage migration guide](docs/storage-migration.md) before exporting old records. Never commit real documents, records, `.data`, exports, credentials or identity mappings to this public repository.
