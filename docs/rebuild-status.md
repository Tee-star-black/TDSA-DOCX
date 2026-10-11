# Rebuild status — 0.4

## Implemented

Medical explorer UI, drag-and-drop upload/move, multi-file upload, folder setup, list/grid views, metadata search and filters, bulk actions, version history, document metadata/review and local classification, DOCX text preview, optional AES-256-GCM document byte encryption, restricted-file permission checks and recent document activity. Existing patient feedback remains a separate entry surface.

## Not connected or implemented

Production authentication, Cloud SQL/PostgreSQL runtime adapter, private cloud object storage, malware scanning, cloud AI, scanned-document OCR, Drive sync worker, MedCNX ID mapping/grants/webhooks, clinical approval/publication, employee acknowledgements, signatures, patient/encounter integration and KMS key rotation. The single-workspace imported-source catalogue needs tenant ownership before a multi-facility rollout. Local demo identities and the production startup guard remain.

## Connection handoff

Start with [connect-systems.md](connect-systems.md). Gather the CTO's identity/app/database details, integrate staging identity and storage, then clinician/patient flows, MedCNX access mapping, and finally Drive/AI workers. Do not remove the guard just to deploy this preview.

## Validation

Syntax checks and 28 automated tests passed. Browser verification passed for medical folder setup, multi-file upload, content classification and metadata review, list/grid views, bulk move, drag-to-folder persistence after reload, connection status, a 390px mobile layout without page overflow and separate patient feedback entry. All browser/test documents were synthetic.

[Desktop preview](screenshots/desktop.png) · [Mobile preview](screenshots/mobile.png) · [Connections screen](screenshots/connections.png)
