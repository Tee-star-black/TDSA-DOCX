# Idempotent uploads and storage reconciliation

## Behavior
New-file uploads may supply a client-generated UUID `requestId`. The runtime stores a SHA-256 fingerprint of the file bytes **and** intent (filename, title, section-scoped folder, privacy, subject and controlled-publication setting). The ledger key is organisation/facility/section/principal/request ID.

* First accepted request reserves its identifier **before** scanning/storage.
* Same identifier and fingerprint during upload returns HTTP 409. Clients should not generate a different ID to work around this.
* After commit, an identical retry returns the original file ID/version and a `replayed` indicator; no scanner or object write is repeated.
* Reusing an identifier for different content/settings returns HTTP 409.
* Known scanner, storage or database failures attempt to release an incomplete reservation so the same upload can be retried. If the cleanup transaction cannot run (for example, membership is revoked), the reservation remains pending and must be reviewed by an administrator.
* Old clients without `requestId` retain legacy behavior; **they are not idempotent**. Version uploads continue using revision conflicts and are not covered by this new-file ledger.
* Changes in visibility are rechecked on replay. New uploads still use CSRF, section membership and role restrictions.

## Reconciliation is still an operations requirement
If object storage succeeds but PostgreSQL rejects/rolls back the metadata transaction, the stored GCS object can remain **unreferenced**. The ledger does not by itself prevent orphaned objects or guarantee cleanup. A successful replay should always refer to the committed object and must not create another version.

Build a separate authorized **read-only inventory job** before enabling live cleanup:

1. Scan private HR and Compliance GCS buckets by their scoped prefixes, collecting opaque key and exact generation, created timestamp and size. Never log document bytes or employee names.
2. Read `document_hub.objects` including **all historical version references** using a dedicated audited operations identity. Never use a normal section user or bypass RLS in the web application.
3. Compare by bucket, exact object key and generation, not just SHA-256 or filename. Treat anything referenced in immutable history, retention or legal holds as protected.
4. Report only candidates past a policy-approved grace period, accounting for in-flight uploads, failed transaction windows, migrations, restores and object lifecycle operations. Verify a second inventory pass.
5. Require authorized human approval and recorded audit before any deletion. Keep signed evidence of what was reviewed. No automatic purge is implemented in this branch.

A database backup **does not** contain private object bytes. Restore drills require both matching object generations and PostgreSQL metadata. POPIA and clinical retention policies require business/legal approval before deletion.

## Rollout
1. Run migration `005_upload_idempotency.sql` with the independent migration role and reapply `scripts/runtime-grants.sql`.
2. Verify runtime role has no table ownership or BYPASSRLS, and ledger RLS prevents cross-principal reads/writes.
3. Test exact replay, mismatch, concurrent in-flight retry, scanner failure, rollback, lost HTTP response, multi-employee isolation and session revocation in **real Cloud SQL staging** using synthetic documents.
4. Confirm the 4 MiB limit, two private GCS buckets, scanner, CSRF, and restore behavior. Never run migration on the CMS database.
5. Document operations recovery for stale reservations and orphan objects before live employee files.
