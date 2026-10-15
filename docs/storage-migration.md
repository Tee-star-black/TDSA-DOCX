# Production storage preparation

This is the historical first milestone. The [production runtime guide](production-runtime.md) describes the new Compliance/HR runtime and migration 002. Export verification still does not import legacy records into production.

15 October 2026 · First storage milestone · No live deployment

## Delivered

- A versioned PostgreSQL schema for organisations, facilities, folders, files, object references, immutable versions, metadata and audit.
- Composite foreign keys prevent links across organisation/facility boundaries. Row policies deny absent or mismatched scope for ordinary runtime roles. Version, object and audit records reject updates/deletes.
- A migration runner with a transaction-scoped advisory lock, bounded timeouts, recorded checksums and rollback on failure. Previously applied files cannot silently change. SQL line endings are normalised for Windows/Linux consistency.
- A read-only, transactionally consistent SQLite export. It copies every legacy table, including forms and patient feedback, and preserves stored bytes and their encryption. Every stored object is decrypted in memory when necessary to verify its original SHA-256, without writing decrypted copies.
- A standalone verifier reconciles all file versions with stored objects, metadata checksums, object hashes, lengths and counts. Invalid packages and wrong keys fail. Export uses a fresh temporary directory and publishes it only after verification; existing destinations are never replaced.

The running website still uses SQLite and demo identity. Neither tool contacts a cloud service automatically. An export is not an imported database, and creating the PostgreSQL schema is not production readiness.

## Inspect and export locally

Use Node 24 and `npm ci`, then:

```powershell
npm run pg:plan
npm run migration:export -- .data/pilot.sqlite .data/migrations/rehearsal-01
npm run migration:verify -- .data/migrations/rehearsal-01
```

Use a complete 0.4 workspace already initialised by the preview. The source must exist; the export command does not initialise or upgrade it. An active SQLite database can be read consistently, but perform a final cutover export only after writes are stopped and a verified backup is saved. The command preserves all versions, restricted metadata, audit and patient records, including orphaned blobs, rather than selecting only visible files.

The package contains `manifest.json`, `records.json` and `objects/<sha256>.bin`. The manifest includes a private ownership inventory, counts and missing source-content report. Terminal output contains counts/blocker summaries, not identities or document names. Checksums detect accidental corruption; they are not a cryptographic signature against an attacker who can rewrite the entire package.

**Treat the whole package as sensitive.** Metadata and form/feedback records are plaintext, and unencrypted source blobs stay unencrypted. Existing encrypted blobs stay encrypted and require the original `TDSA_BLOB_KEY_B64` for verification. Keep that key in the approved secret store, separately from the export. Directory/file modes restrict access on POSIX; on Windows use an access-controlled directory with the appropriate inherited ACLs. `.data/` and export payload patterns are excluded from Git. Do not upload a real package to a PR or public storage.

Missing file-version bytes are fatal. Source catalogue entries without bytes are reported as blockers because the pilot deliberately omits some restricted source content and includes synthetic examples. Unknown tables are rejected to prevent losing data from a newer schema. The verifier always reports `readyForProductionImport: false` until a real destination import and ownership reconciliation have been implemented.

## Apply the schema in approved staging infrastructure

1. Obtain the approved dedicated database, region, connection method and migration identity from the CTO. This tool does not provision cloud resources.
2. Supply `TDSA_POSTGRES_URL` through the approved environment/secret store. Use the approved Cloud SQL connector/proxy or a certificate-verified TLS connection. No tool disables certificate verification. Do not paste connection secrets into chat, a PR or command history.
3. Review `migrations/postgres/001_documents.sql`, then run `npm run pg:migrate -- --confirm`. The explicit flag prevents an accidental invocation from changing a database. It is intended for an empty, dedicated staging database. It creates `document_hub` and a `public.tdsa_schema_migrations` ledger; an existing conflicting schema fails instead of being overwritten.
4. Use a separate runtime role with `NOSUPERUSER NOBYPASSRLS`. Never use the migration owner as the application role. Give only necessary schema/table/sequence privileges; do not grant schema ownership, DDL, TRUNCATE, or history UPDATE/DELETE privileges. No application roles or grants are provisioned by this milestone.
5. The future backend must begin a transaction on one checked-out connection and set `tdsa.organisation_id` and `tdsa.facility_id` with parameterised, transaction-local `set_config` calls using verified membership. The backend must also enforce user permissions, restricted-document rules and patient ownership. Row policies are a second boundary, not identity verification: anyone with direct database credentials can set these settings. Do not expose them to clients.

`pg:plan` needs no credentials. The migration command intentionally omits raw provider errors from terminal output to avoid leaking connection details. On failure check access, migration checksums and approved server diagnostics. A failed migration rolls back its DDL; automatic down migrations and deletion of existing data are not provided.

## Remaining work before staging cutover

1. Confirm verified user/organisation/facility IDs and map the export's legacy IDs. The old source catalogue is global and audit records do not reliably encode ownership; do not infer permission from filenames or a display name.
2. Implement the asynchronous PostgreSQL runtime repository and explicit, retry-safe importer. Add scoped source/import tables and separately scoped patient/form schemas. This document schema intentionally does not claim to complete patient or HR integration.
3. Implement private object storage, quarantine/scanning and immutable object generation checks. Only scanned-clean objects may be registered in the final immutable object table; quarantine job state belongs outside it. A database `clean` value is a trusted backend assertion, not an actual scan.
4. Upload/verify each object and record its storage key and generation. Preserve immutable versions and encryption/key references. Reconcile package counts and all plaintext hashes. No public bucket URLs or signed URL issuance are implemented here.
5. Wire verified login and permissions through every route. Add folder-cycle enforcement, optimistic edit checks, approved retention/deletion workflows and publication governance to the repository/service layer. The schema alone does not implement those workflows.
6. Exercise failure recovery, concurrent migrations/uploads, full PostgreSQL plus bucket backup restoration, restricted downloads and clinician/patient isolation on real staging services. Enable production only after those checks and the remaining integration acceptance criteria pass.

## Validation and limits

Automated tests execute the SQL in PGlite (embedded PostgreSQL), including repeat application, checksum drift, transaction rollback, cross-facility foreign keys, immutable history and row policies under a non-owner role. Export tests cover multiple versions, restricted metadata, audit preservation, wrong keys, missing bytes, tampering and schema mismatch. Existing HTTP/UI service tests remain part of the full suite.

PGlite does not validate Cloud SQL connectivity, IAM, TLS, multi-client advisory-lock contention, bucket access, restore performance or deployment configuration. Those checks require the approved staging infrastructure.

Implementation references: [PostgreSQL constraints](https://www.postgresql.org/docs/18/ddl-constraints.html), [PostgreSQL row security](https://www.postgresql.org/docs/18/ddl-rowsecurity.html), [node-postgres transactions](https://node-postgres.com/features/transactions), [PGlite API](https://pglite.dev/docs/api).
