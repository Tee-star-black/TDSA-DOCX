import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const directory = fileURLToPath(new URL('../migrations/postgres/', import.meta.url));
export function readMigrations(path = directory) {
  return readdirSync(path).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort().map(name => {
    const sql = readFileSync(join(path, name), 'utf8').replace(/\r\n/g, '\n');
    return {name, sql, checksum: createHash('sha256').update(sql).digest('hex')};
  });
}

// Pass a dedicated connected pg Client, never a Pool: the transaction and lock
// must remain on the same connection. PGlite uses the same interface in tests.
export async function migratePostgres(client, migrations = readMigrations()) {
  if (!migrations.length || new Set(migrations.map(m => m.name)).size !== migrations.length) {
    throw new Error('Expected a nonempty, unique migration list');
  }
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query('SELECT pg_advisory_xact_lock(746372901)');
    await client.query(`CREATE TABLE IF NOT EXISTS public.tdsa_schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const {rows} = await client.query('SELECT name, checksum FROM public.tdsa_schema_migrations ORDER BY name');
    for (const [i, row] of rows.entries()) {
      if (migrations[i]?.name !== row.name || migrations[i]?.checksum !== row.checksum) {
        throw new Error('Migration history differs from this release; restore the matching migration files');
      }
    }
    const applied = [];
    for (const migration of migrations.slice(rows.length)) {
      // PGlite requires exec for multi-statement SQL; pg Client accepts query.
      if (client.exec) await client.exec(migration.sql);
      else await client.query(migration.sql);
      await client.query('INSERT INTO public.tdsa_schema_migrations(name,checksum) VALUES ($1,$2)', [migration.name, migration.checksum]);
      applied.push(migration.name);
    }
    await client.query('COMMIT');
    return {applied, current: migrations.at(-1).name};
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
