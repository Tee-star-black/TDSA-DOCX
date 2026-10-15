> Historical pilot instructions. Use the [current README](../README.md) and [production runtime guide](production-runtime.md) for the Compliance/HR hub. The old server is now started with npm run legacy:preview, not npm start.

# TDSA DOCX — Medical Document Hub

Working foundation for a TDSA document library and clinical forms module. This release is a **local development pilot**: it uses a synthetic clinician/facility identity, binds to loopback only, and refuses `NODE_ENV=production`. Do not enter real patient or staff information.

## Medical hub rebuild (0.4)

Review branch: `feat/medical-document-hub`, based on `feat/document-module-foundation`.

- Medical folder setup, drag-and-drop uploads and moves, multi-file uploads, list/grid views, search/category filters and bulk move/archive/restore.
- PDF, DOCX and UTF-8 TXT. DOCX preview shows text; PDF text analysis optionally uses Poppler `pdftotext` (filename fallback when unavailable).
- Medical category/type, tags, restricted classification, next review date and revision-checked metadata review. New versions reset review.
- Local classification suggestions requiring confirmation. Cloud AI and scanned-PDF OCR are not connected.
- Optional AES-256-GCM document-byte encryption via `TDSA_BLOB_KEY_B64`. Metadata/records are not covered; backups need the original key. See the guide before enabling.
- Honest connection status and facility document activity. The module remains a local preview with demo identities.

[Desktop preview](screenshots/desktop.png) · [Mobile preview](screenshots/mobile.png)

[How to connect TDSA, MedCNX, Drive and Cloud SQL](connect-systems.md) · [Implementation status and remaining work](rebuild-status.md)

## Run on Windows or Linux

Install Node.js 24 LTS and the locked dependencies with `npm ci`.

```powershell
git clone https://github.com/Tee-star-black/TDSA-DOCX.git
cd TDSA-DOCX
git switch codex/production-storage-foundation
npm ci
npm start
```

Open **http://127.0.0.1:8795** for the clinician document explorer. Open **http://127.0.0.1:8795/patient** for the separate patient feedback interface. Stop with Ctrl+C. For automatic server reload use `npm run dev`. Browser code is served directly; refresh after changing it.

## Import your document ZIP from the app

1. Open the clinician explorer and click **Import document ZIP**.
2. Select your original document ZIP (up to 10 MiB). No Python installation or separate catalogue is required.
3. PDFs are stored in SQLite and grouped into folders. Exact duplicates are detected; repeat imports are safe. Synthetic examples disappear after the first successful source import.
4. Open a folder, search a document, and preview/download it. Moving a document preserves its contents.

New metadata is inferred from filenames and remains pending review; this is not OCR, clinical validation or publication. Known private catalogue metadata is retained where available. Suspected scan bundles are restricted and their contents are not imported for viewing. Filename-based scan detection is a convenience, not a guarantee: an owner must review every imported file for identifying/completed-record content before live sharing. Patient complaint-entry templates are excluded from clinician catalogue views; digital complaint entry belongs in the separate patient interface.

Original sources, real metadata, database files and records must never be committed to this public repository. The earlier Python/ private-catalogue import remains an optional legacy path; restarting the server migrates recognised legacy file contents into the database.

## Included

- One-click document ZIP import and automatic folder organisation.
- Database status, a downloadable complete workspace backup and checked restore.
- Synthetic catalogue examples. A separately supplied private source catalogue supports original identifiers, dates, hashes and review notes without exposing them in Git.
- Persistent folders/subfolders with breadcrumbs, a folder tree and workspace-wide metadata search.
- Folder creation, rename and move; cycle and sibling-name conflict checks.
- Private PDF/DOCX/TXT uploads (up to 4 MiB), preview/download, file rename/move, archive/restore and immutable version history.
- Original catalogue documents can be moved into folders without changing their source metadata.
- Patient-only complaint/compliment/suggestion entry at `/patient`; clinicians get the environmental cleaning form.
- Authorised demo staff can assign feedback cases, track investigation status and record resolution notes. Original patient submissions remain read-only; staff notes are not returned to patient records.
- SQLite persistence, manual draft saving, server validation, revision conflict detection, version pinning and immutable submitted content.
- Anonymous feedback that discards identifying fields server-side; one linked case per final submission.
- Print-friendly record export: use the browser Print command to save a PDF. No stored PDF snapshot is produced in this release.
- Audit events for save, submission, document access and printing; automated API/persistence tests.

## Development checks

```powershell
npm run check
npm test
```

The `.data/pilot.sqlite` SQLite database stores folders, source metadata, uploaded/imported file contents, versions, form records, cases and audit events. The database is created and tables are initialised automatically at startup. Known legacy file-system contents migrate into database blobs after a hash check; originals are unchanged. Tests use disposable databases. Removing `.data` resets the workspace.

## Deliberate boundaries

All source documents remain **pending TDSA review**. There is no production authentication, patient linkage, live patient-app integration, document approval workflow, deadline automation, corrective-action workflow, record amendment, automated TEWS scoring, stored final PDF snapshot, or production database/storage integration yet. Scanned source material requires manual splitting, redaction and completeness review where applicable. Current search covers catalogue metadata, not PDF full text. No role or patient access claims are implied by the local demo identity.

The UI is plain browser JavaScript and the preview service uses Node's built-in SQLite. The PostgreSQL preparation tools use `pg`; database tests use PGlite. The API/form definitions are separated from the preview UI so the official app can replace the presentation and persistence layers. Confirm its stack before selecting shared UI packages.

## Production storage preparation (15 October 2026)

The [storage migration guide](storage-migration.md) covers the new versioned PostgreSQL document schema and verified SQLite export package. Run `npm run pg:plan` to inspect migration checksums without a database connection. Export and verification preserve existing encryption, file versions and all legacy records, and report unresolved ownership or missing source contents.

These tools prepare a migration; they do not connect the running app to PostgreSQL or cloud storage. Verified login, the runtime adapters, private bucket/scanning integration and a tested staging import remain outstanding. The production startup guard remains enabled.

Read [the integration contract](integration.md), [source review notes](source-review.md) and [next milestones](roadmap.md).

## Patient/staff boundaries

Patient APIs are namespaced under `/api/patient/` and expose only patient form definitions and the demo patient’s own submissions/print view. Clinician APIs reject complaint creation; staff complaint access uses explicit management routes. The demo staff actor has `documents.manage` and `complaints.manage` permissions. These are local test identities, not a production security boundary: any local user can open either surface. Replace them with verified host-app users and roles before live use.

Source catalogue versions and uploaded-file versions are distinct. Upload version history is durable, but clinical approval/publication and signed final record snapshots remain future work. PDF and UTF-8 TXT are the upload types supported in this milestone; Standard DOCX documents are supported; images, macro-enabled Office documents and legacy DOC formats are not.

## Database operations

The **Database & backup** screen displays connectivity, integrity, record counts and stored bytes. Click **Download backup** to export a consistent SQLite snapshot containing database-stored file contents and records. Keep backups private. The database backup itself is not password-encrypted. Encrypted document bytes require the original key; metadata and form records remain unencrypted.

```powershell
npm run db:init
npm run db:status
```

To restore, stop the app with Ctrl+C first:

```powershell
npm run db:restore -- "C:\path\to\TDSA-workspace-backup.sqlite" --confirm
npm start
```

Restore validates the backup, refuses while the known local server process is running, and preserves a consistent pre-restore copy of the current database. It replaces the current workspace, so use the correct backup. Database-stored contents are restored without needing the original source ZIP. Restricted/excluded originals are not part of the backup.

Optionally copy `.env.example` to `.env` to choose the port or a persistent `TDSA_DATA_DIR`. `.env` and workspace data are ignored by Git. The demo uses one local database; it is not yet connected to a shared PostgreSQL/Cloud SQL service or the official app identity system.
