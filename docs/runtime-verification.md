# Runtime verification — 15 October 2026

Branch: `codex/compliance-hr-runtime`, stacked on the PostgreSQL storage foundation.

## Completed locally

- `npm run check`: all JavaScript syntax checks pass.
- `npm test`: 43 tests pass, including the preserved legacy regression suite.
- PostgreSQL/PGlite: complete migration chain, runtime role restrictions, section and privacy filtering, employee ownership, named read/manage/revoke, cross-section rejection, CSRF, membership revocation and stale/concurrent version writes.
- Migration 002 refuses a populated foundation, rolls back and retains the original records.
- GCS test double: distinct private buckets, immutable generation selection, hash validation and wrong-section rejection.
- Scanner test double: clean digest-matched verdict accepted; infected, unknown, mismatched and unavailable results rejected.
- OIDC controlled issuer: signed code flow, PKCE, browser-bound state, nonce/audience/signature verification, replay rejection, logout and inactive-principal rejection.
- Production entry point with missing configuration exits without serving a synthetic fallback.
- Browser with synthetic PostgreSQL data: upload, inline text preview, second version, original version download (contents verified), Compliance→HR separation, employee-only visibility and HR employee-ownership selector.
- Responsive layouts inspected at 390 px and 1280 px, with search/folder navigation corrections. Browser error log was empty at the final check.
- `git diff --check`: no whitespace errors.

## Not verified

No live GCP project, Cloud SQL, approved OIDC provider, real scanner or existing HR system was connected. GCP/OIDC adapter tests use controlled responses and must be repeated against approved staging services. Docker is installed but its daemon is unavailable, so the container build/run was not validated. Backup restore, cloud IAM, load/rate limits, operational telemetry and deployment acceptance remain outstanding as described in the [runtime guide](production-runtime.md).

The synthetic preview intentionally performs no malware scan. Local preview files, downloaded test documents and screenshots are not part of the production database or Git repository.
