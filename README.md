# TDSA DOCX

Working foundation for a TDSA document library and clinical forms module. This release is a **local development pilot**: it uses a synthetic clinician/facility identity, binds to loopback only, and refuses `NODE_ENV=production`. Do not enter real patient or staff information.

## Run on Windows or Linux

Install Node.js 24 LTS. This foundation has no npm dependencies or installation step.

```powershell
git clone https://github.com/Tee-star-black/TDSA-DOCX.git
cd TDSA-DOCX
git switch feat/document-module-foundation
npm start
```

Open http://127.0.0.1:8795. Stop with Ctrl+C. For automatic server reload use `npm run dev`. Browser code is served directly; refresh after changing it.

To view the original PDFs, install Python 3 and run:

```powershell
npm run import:documents -- "C:\path\to\sop.zip"
```

If your machine uses the Python launcher instead: `py scripts/import_documents.py "C:\path\to\sop.zip"`.

First extract the separately supplied private catalogue ZIP into the project root so `.data/catalogue.json` exists. The server uses it instead of the synthetic examples.

The import checks every expected PDF hash before writing, skips restricted entries, and places files in ignored `.data/documents/`. Import does not constitute clinical approval. Original PDFs and completed records must never be committed to this public repository.

## Included

- Synthetic catalogue examples. A separately supplied private source catalogue supports original identifiers, dates, hashes and review notes without exposing them in Git.
- Responsive library search, category/type filters, detail screens and local PDF preview.
- Complaint/compliment/suggestion and environmental cleaning form pilots.
- SQLite persistence, manual draft saving, server validation, revision conflict detection, version pinning and immutable submitted content.
- Anonymous feedback that discards identifying fields server-side; one linked case per final submission.
- Print-friendly record export: use the browser Print command to save a PDF. No stored PDF snapshot is produced in this release.
- Audit events for save, submission, document access and printing; automated API/persistence tests.

## Development checks

```powershell
npm run check
npm test
```

The `.data/pilot.sqlite` database and locally imported PDFs persist between restarts. Tests use disposable databases. Back up this folder for local test-work continuity; do not share it with real records. Removing `.data` resets local drafts and imports.

## Deliberate boundaries

All source documents remain **pending TDSA review**. There is no production authentication, patient linkage, public complaint portal, document approval workflow, completed investigation workflow, record amendment, automated TEWS scoring, stored final PDF snapshot, or production database/storage integration yet. Scanned source material requires manual splitting, redaction and completeness review where applicable. Current search covers catalogue metadata, not PDF full text. No role or patient access claims are implied by the local demo identity.

The UI is plain browser JavaScript and the service uses Node's built-in SQLite for a portable, dependency-free first milestone. The API/form definitions are separated from the preview UI so the official app can replace the presentation and persistence layers. Confirm its stack before selecting shared UI packages.

Read [the integration contract](docs/integration.md), [source review notes](docs/source-review.md) and [next milestones](docs/roadmap.md).
