import {DatabaseSync} from 'node:sqlite';
import {createHash, randomUUID} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, rmdirSync, lstatSync, openSync, closeSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {blobCrypto} from './blob-crypto.js';

const tables = ['documents','submissions','cases','audit','imports','schema_migrations','folders','files','file_versions','source_locations','file_metadata','case_management'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');

function reconcile(records, objects) {
  const byHash = new Map(objects.map(object => [object.sha256, object]));
  if (byHash.size !== objects.length) throw new Error('Duplicate export objects');
  for (const version of records.file_versions) {
    const object = byHash.get(version.hash);
    if (!object || object.plaintextBytes !== version.size) throw new Error('A file version has missing or mismatched contents');
  }
  const sourcesWithoutBytes = [];
  for (const row of records.documents) {
    const source = JSON.parse(row.metadata);
    if (!byHash.has(source.sha256)) sourcesWithoutBytes.push({id: row.id, restricted: Boolean(source.restricted)});
  }
  const facilityIds = [...new Set(['folders','files','submissions','cases','imports'].flatMap(t => records[t].map(r => r.facility_id)))].sort();
  const actorIds = [...new Set([
    ...records.submissions.map(r => r.author_id), ...records.file_versions.map(r => r.author_id),
    ...records.audit.map(r => r.actor_id), ...records.imports.map(r => r.actor_id),
    ...records.file_metadata.map(r => r.reviewed_by).filter(Boolean)
  ])].sort();
  return {
    facilityIds, actorIds, sourcesWithoutBytes,
    counts: Object.fromEntries(tables.map(t => [t, records[t].length])),
    objectCount: objects.length,
    readyForProductionImport: false,
    blockers: [
      'Map legacy facilities and actors to verified organisation, facility and user IDs.',
      'Assign ownership to the global source catalogue and legacy audit/import records.',
      'Implement and validate PostgreSQL import, private storage, scanning and runtime adapters.',
      'Patient feedback and clinical forms require separately scoped destination schemas.',
      ...(sourcesWithoutBytes.length ? ['Resolve or explicitly exclude source catalogue entries without stored bytes.'] : [])
    ]
  };
}

// Reads one consistent SQLite snapshot without creating or upgrading the source.
// File bytes retain their existing encryption; plaintext metadata is sensitive.
export function exportWorkspace(source, output, {encryptionKey = process.env.TDSA_BLOB_KEY_B64} = {}) {
  source = resolve(source); output = resolve(output);
  if (!existsSync(source)) throw new Error('Source workspace does not exist');
  if (existsSync(output)) throw new Error('Export destination already exists');
  const crypto = blobCrypto(encryptionKey);
  const db = new DatabaseSync(source, {readOnly: true});
  let temporary;
  const created = [];
  try {
    db.exec('BEGIN');
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) {
      throw new Error('Workspace integrity check failed');
    }
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
    if (names.length !== tables.length + 1 || ![...tables, 'file_blobs'].every(t => names.includes(t))) {
      throw new Error('Unsupported workspace schema; export requires the complete version 0.4 workspace');
    }
    const records = Object.fromEntries(tables.map(t => [t, db.prepare(`SELECT * FROM ${t}`).all()]));
    mkdirSync(dirname(output), {recursive: true});
    temporary = output + '.partial-' + randomUUID();
    mkdirSync(temporary, {mode: 0o700});
    mkdirSync(join(temporary, 'objects'), {mode: 0o700});
    const write = (name, bytes) => {
      const path = join(temporary, name);
      const fd = openSync(path, 'wx', 0o600); created.push(path);
      try { writeFileSync(fd, bytes); } finally { closeSync(fd); }
    };
    const objects = [];
    for (const row of db.prepare('SELECT hash,content,encryption FROM file_blobs ORDER BY hash').iterate()) {
      if (!validHash(row.hash) || ![0,1].includes(row.encryption)) throw new Error('Invalid stored object');
      const bytes = Buffer.from(row.content);
      const plain = crypto.decode(row.hash, bytes, Boolean(row.encryption));
      write('objects/' + row.hash + '.bin', bytes);
      objects.push({sha256: row.hash, storedSha256: hash(bytes), storedBytes: bytes.length, plaintextBytes: plain.length, encryption: row.encryption});
    }
    const report = reconcile(records, objects);
    const metadata = json(records);
    write('records.json', metadata);
    write('manifest.json', json({format: 'tdsa-workspace-export', version: 1, createdAt: new Date().toISOString(), recordsSha256: hash(metadata), objects, report}));
    db.exec('COMMIT');
    // Verify the finished package before making its final directory visible.
    verifyExport(temporary, {encryptionKey});
    if (existsSync(output)) throw new Error('Export destination already exists');
    renameSync(temporary, output); temporary = null;
    return report;
  } finally {
    db.close();
    if (temporary) {
      // Delete only files created by this call, never a pre-existing destination.
      for (const path of created.reverse()) unlinkSync(path);
      if (existsSync(join(temporary, 'objects'))) rmdirSync(join(temporary, 'objects'));
      if (existsSync(temporary)) rmdirSync(temporary);
    }
  }
}

export function verifyExport(directory, {encryptionKey = process.env.TDSA_BLOB_KEY_B64} = {}) {
  directory = resolve(directory);
  const read = name => {
    const path = join(directory, name);
    if (!lstatSync(path).isFile()) throw new Error('Export entries must be regular files');
    return readFileSync(path);
  };
  if (!lstatSync(join(directory, 'objects')).isDirectory() || lstatSync(join(directory, 'objects')).isSymbolicLink()) throw new Error('Invalid object directory');
  const manifest = JSON.parse(read('manifest.json'));
  if (manifest.format !== 'tdsa-workspace-export' || manifest.version !== 1 || !Array.isArray(manifest.objects)) throw new Error('Unsupported export format');
  const bytes = read('records.json');
  if (hash(bytes) !== manifest.recordsSha256) throw new Error('Export metadata checksum mismatch');
  const records = JSON.parse(bytes);
  if (Object.keys(records).length !== tables.length || !tables.every(t => Array.isArray(records[t]))) throw new Error('Incomplete export records');
  const crypto = blobCrypto(encryptionKey);
  for (const object of manifest.objects) {
    if (!validHash(object.sha256) || !validHash(object.storedSha256) || ![0,1].includes(object.encryption)) throw new Error('Invalid export object descriptor');
    const stored = read('objects/' + object.sha256 + '.bin');
    if (stored.length !== object.storedBytes || hash(stored) !== object.storedSha256) throw new Error('Export object checksum mismatch');
    if (crypto.decode(object.sha256, stored, Boolean(object.encryption)).length !== object.plaintextBytes) throw new Error('Export object size mismatch');
  }
  const report = reconcile(records, manifest.objects);
  if (JSON.stringify(report) !== JSON.stringify(manifest.report)) throw new Error('Export reconciliation mismatch');
  return report;
}
