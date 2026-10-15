import pg from 'pg';
import {migratePostgres, readMigrations} from '../src/postgres-migrations.js';

const command = process.argv[2];
if (command === 'plan') {
  console.log(JSON.stringify({runtimeConnected: false, migrations: readMigrations().map(({name,checksum}) => ({name,checksum}))}, null, 2));
} else if (command === 'migrate' && process.argv.includes('--confirm')) {
  let client;
  try {
    if (!process.env.TDSA_POSTGRES_URL) throw new Error('missing configuration');
    client = new pg.Client({connectionString: process.env.TDSA_POSTGRES_URL, connectionTimeoutMillis: 10000});
    await client.connect();
    console.log(JSON.stringify(await migratePostgres(client), null, 2));
  } catch {
    // Provider errors may contain hostnames, usernames or connection strings.
    console.error('PostgreSQL migration failed. Check the approved database connection, permissions and migration history. No credentials are printed.');
    process.exitCode = 1;
  } finally {
    await client?.end();
  }
} else {
  console.error('Use npm run pg:plan, or set TDSA_POSTGRES_URL for an approved empty database and run npm run pg:migrate -- --confirm.');
  process.exitCode = 1;
}
