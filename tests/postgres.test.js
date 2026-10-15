import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {migratePostgres, readMigrations} from '../src/postgres-migrations.js';

const folder = '11111111-1111-4111-8111-111111111111';
const file = '22222222-2222-4222-8222-222222222222';
const object = '33333333-3333-4333-8333-333333333333';
const version = '44444444-4444-4444-8444-444444444444';
const sha = 'a'.repeat(64);

async function seed(db) {
  await db.exec(`INSERT INTO document_hub.organisations VALUES ('org-a','A'),('org-b','B');
    INSERT INTO document_hub.facilities VALUES ('org-a','facility-a','A'),('org-a','facility-b','B'),('org-b','facility-a','Other organisation');
    INSERT INTO document_hub.folders(organisation_id,facility_id,id,name) VALUES ('org-a','facility-a','${folder}','Policies');
    INSERT INTO document_hub.files(organisation_id,facility_id,id,folder_id,title) VALUES ('org-a','facility-a','${file}','${folder}','Policy');
    INSERT INTO document_hub.objects(organisation_id,facility_id,id,sha256,size_bytes,storage_key,storage_generation,scan_status)
      VALUES ('org-a','facility-a','${object}','${sha}',24,'private/object','1','clean');
    INSERT INTO document_hub.file_versions(organisation_id,facility_id,id,file_id,version,object_id,filename,mime,author_id)
      VALUES ('org-a','facility-a','${version}','${file}',1,'${object}','policy.txt','text/plain','verified-user');
    INSERT INTO document_hub.file_metadata(organisation_id,facility_id,file_id) VALUES ('org-a','facility-a','${file}');
    INSERT INTO document_hub.audit(organisation_id,facility_id,actor_id,action,record_id) VALUES ('org-a','facility-a','verified-user','file.created','${file}');`);
}

test('PostgreSQL migrations are repeatable, detect history changes, and roll back failed DDL', async () => {
  const db = new PGlite();
  try {
    const migrations = readMigrations();
    assert.equal((await migratePostgres(db)).applied.length, 1);
    assert.equal((await migratePostgres(db)).applied.length, 0);
    await assert.rejects(migratePostgres(db, [{...migrations[0], checksum: 'changed'}]), /history differs/);
    await assert.rejects(migratePostgres(db, [...migrations, {name: '002_invalid.sql', checksum: 'bad', sql: 'CREATE TABLE document_hub.should_rollback(id integer); SELECT nonexistent_function();'}]));
    assert.equal((await db.query("SELECT to_regclass('document_hub.should_rollback') AS name")).rows[0].name, null);
    assert.equal((await db.query('SELECT * FROM public.tdsa_schema_migrations')).rows.length, 1);
  } finally { await db.close(); }
});

test('PostgreSQL constraints reject cross-facility links and prevent version, object and audit rewriting', async () => {
  const db = new PGlite();
  try {
    await migratePostgres(db); await seed(db);
    await assert.rejects(db.query(`INSERT INTO document_hub.files(organisation_id,facility_id,id,folder_id,title) VALUES ('org-a','facility-b',$1,$2,'Wrong scope')`, [file, folder]), /foreign key/);
    await assert.rejects(db.query(`INSERT INTO document_hub.files(organisation_id,facility_id,id,folder_id,title) VALUES ('org-b','facility-a',$1,$2,'Wrong organisation')`, [file, folder]), /foreign key/);
    await assert.rejects(db.query(`INSERT INTO document_hub.folders(organisation_id,facility_id,id,name) VALUES ('org-a','facility-a',$1,'POLICIES')`, [file]), /unique/);
    for (const table of ['file_versions','objects','audit']) {
      await assert.rejects(db.query(`DELETE FROM document_hub.${table}`), /immutable/);
      await assert.rejects(db.query(`UPDATE document_hub.${table} SET created_at = now()`), /immutable/);
    }
    await assert.rejects(db.query(`UPDATE document_hub.file_metadata SET review_status='reviewed'`), /check constraint/);
    await assert.rejects(db.query(`INSERT INTO document_hub.objects(organisation_id,facility_id,id,sha256,size_bytes,storage_key,storage_generation,scan_status) VALUES ('org-a','facility-a',$1,$2,24,'pending','1','pending')`, [file, sha]), /check constraint/);
  } finally { await db.close(); }
});

test('row policies deny missing and foreign scope for a non-owner runtime role and reset between transactions', async () => {
  const db = new PGlite();
  try {
    await migratePostgres(db); await seed(db);
    await db.exec(`CREATE ROLE tdsa_runtime NOSUPERUSER NOBYPASSRLS;
      GRANT USAGE ON SCHEMA document_hub TO tdsa_runtime;
      GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA document_hub TO tdsa_runtime;
      SET ROLE tdsa_runtime;`);
    for (const table of ['organisations','facilities','folders','files','objects','file_versions','file_metadata','audit']) {
      assert.equal((await db.query(`SELECT * FROM document_hub.${table}`)).rows.length, 0);
    }
    await db.exec("BEGIN; SET LOCAL tdsa.organisation_id='org-a'; SET LOCAL tdsa.facility_id='facility-a';");
    assert.equal((await db.query('SELECT * FROM document_hub.files')).rows.length, 1);
    await db.exec('COMMIT');
    assert.equal((await db.query('SELECT * FROM document_hub.files')).rows.length, 0);
    await db.exec("BEGIN; SET LOCAL tdsa.organisation_id='org-b'; SET LOCAL tdsa.facility_id='facility-a';");
    assert.equal((await db.query('SELECT * FROM document_hub.files')).rows.length, 0);
    await assert.rejects(db.query(`INSERT INTO document_hub.files(organisation_id,facility_id,id,title) VALUES ('org-a','facility-a',$1,'Denied')`, [folder]), /row-level security/);
    await db.exec('ROLLBACK');
    await db.exec("BEGIN; SET LOCAL tdsa.organisation_id='org-a'; SET LOCAL tdsa.facility_id='facility-b';");
    assert.equal((await db.query('SELECT * FROM document_hub.files')).rows.length, 0);
    await db.exec('COMMIT');
  } finally { await db.close(); }
});
