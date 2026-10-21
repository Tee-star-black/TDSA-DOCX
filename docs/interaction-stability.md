# Explorer interaction stability (preview branch)

The Compliance/HR runtime's `hub.js` renders the workspace shell. `explorer.js` adds a document inspector, folders, filters and summary views. Previously, archive and folder controls forced a full shell replacement on each click. The extra UI layer also ran its enhancement logic against every rerender, discarded loaded identity/register context, and used a time-delayed MutationObserver to click controls after navigating to details.

## Changes

- The hub dispatches cancelable `tdsa:folder-changed` / `tdsa:archive-changed` events. When the explorer is present, it handles the navigation on existing document rows without rebuilding `#app`. The legacy hub retains its render fallback if the explorer module is unavailable.
- For explorer mode, the list includes all *already authorized* document rows and annotates folder IDs; the view layer filters those rows locally. Existing server-side privacy and publication constraints still determine which records and bytes are returned.
- Folder selection includes descendants. The archive dropdown and sidebar now use the same view state; no synthetic `change` events trigger a loop.
- `tdsa:reset-folder` clears the hub's folder state when returning to global views, avoiding stale folder selection after a later server refresh.
- Full document details/version/access shortcuts use a single `tdsa:open-full-document` event handled by `hub.js` after the detail loads, not a delayed observer with a four-second timeout.
- The explorer caches identity/register context across screen redraws but clears it on sign-out, sign-in or scope change. Rapid inspector close/reopen invalidates outdated responses.
- The presentation observer watches only root screen replacement, not every nested DOM mutation.

## Verification

- Node syntax checks and the existing repository test suite must pass in GitHub Actions.
- Unit contract tests in `tests/ui-interactions.test.js` check nested folders, archive visibility, personal filters and the event handoff.
- Browser interaction checks with synthetic data passed at **1440px desktop** and **390px mobile**: repeat filters, choose parent/child folders, switch archive/active, sort, toggle grid, rapidly open/close inspector, open full details, sign out and sign in as a different synthetic employee.
- Those browser checks used an isolated fixture, *not* a complete Cloud SQL/GCS/OIDC deployment. Production acceptance still requires staging checks against the actual app and infrastructure.

## Safety boundary

No changes to document privacy/approval tables, authentication guards, storage or file API permissions. Client-side filtering only narrows records already returned by authorized backend requests. Do not use production employee/patient records in the synthetic preview.
