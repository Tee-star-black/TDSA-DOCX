# Document Hub visual redesign

The `feat/document-hub-experience` branch builds on `feat/document-approvals-publication`.

## What changed

- A restrained, light clinical visual system with navy typography, quiet blue actions, crisp lines and sharp corners, matching the wider TDSA Workspace direction.
- A cleaner section navigator, persistent folder tree on desktop and a horizontally scrollable folder rail on mobile.
- A search-led document library with accessible list/grid controls, local sorting by document name, update date or file type, and an explicit count of visible documents.
- A more readable document detail and preview layout, accessible forms and clear approval/history section hierarchy.
- A reworked preview sign-in landing page, with the synthetic preview disclosure retained.
- A dedicated same-origin stylesheet and progressive-enhancement script, without changes to access-control logic or persisted records.

## Integration and safety boundaries

The existing API, immutable document versions, Compliance/HR section separation, restricted-file access and review/publication authorization rules are unchanged. UI controls do not grant access. Every file and version request is still checked by the server and PostgreSQL row policies.

The layout switch and sorting operate only on the DOM rows already returned by the authorized API; no new endpoint or extra document data is exposed. Grid mode reuses the original clickable document rows. The enhancements reattach after the existing frontend renders a new section or detail view.

These changes do **not** implement live Google sign-in, Cloud SQL acceptance, Google Cloud Storage validation, malware scanning, employee acknowledgement flows or MedCNX integration. Only synthetic data should be used in the preview.

## Verification

Run on Node.js 24:

```powershell
npm ci
npm run check
npm test
npm run preview
```

Review the document library, list/grid switching, sorting, folder selection, search, file detail, upload/version dialogs, approval/submission/publication controls and both Compliance and HR sections. Check at desktop, tablet and 390px mobile widths, including keyboard navigation. This branch does not claim live cloud or authentication testing.
