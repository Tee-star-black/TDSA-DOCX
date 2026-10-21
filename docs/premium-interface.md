# Premium Document Hub UI

This branch implements the approved high-fidelity explorer design on top of the existing stability, approval and document-register branches. No clinical/HR security rules have been removed or relaxed.

- Header: real document search form moved into the top bar; Upload, New Folder, Filter, approvals indicator and account menu.
- Navigation: shorter names; real Compliance/HR membership switching and existing scoped folder hierarchy.
- Summary: four actionable values (approvals, expiring, missing required, recently updated). The fourth metric uses file update timestamps within 30 days. Missing is unknown when the register is unconfigured rather than a fake zero.
- Library: compact, sortable rows, list/grid toggle, type icons, status, owner and review/expiry date.
- Inspector: live permission-checked preview/download, version history, edit metadata, new version, request review, independent approval, publication and access management according to existing backend permissions.
- Experience: CSS-driven dimensional icons, subtle transitions, responsive tablet/mobile inspector, touch-friendly card strip, keyboard focus and reduced-motion handling.
- Keyboard: Ctrl/Cmd+K focuses document search. Escape closes the account and filter menus.
- Security: no external UI assets, no direct Cloud Storage links, no fabricated patient/employee records in shipped code.

Run on Node.js 24: npm ci && npm run check && npm test && npm run preview. Synthetic preview only. The production deployment, live identity, Cloud SQL/GCS acceptance, scanner and MedCNX integration are separate workstreams. Merge the stacked branches in dependency order.
