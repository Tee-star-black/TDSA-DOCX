import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createApp} from '../src/server.js';
import {explorer} from '../src/explorer.js';
import {documentHub} from '../src/hub.js';
import {exportWorkspace, verifyExport} from '../src/migration-export.js';

const actor = {id: 'synthetic-user', facilityId: 'demo-facility', permissions: ['documents.manage','documents.restricted']};
function workspace(key) {
  const dir = mkdtempSync(join(tmpdir(), 'tdsa-export-'));
  const app = createApp({dataDir: dir, encryptionKey: key});
  const files = explorer(app.store, dir), hub = documentHub(app.store, files);
  const input = text => ({filename: 'policy.txt', content: Buffer.from(text).toString('base64')});
  const file = files.upload(input('First synthetic version'), actor); hub.initialise(file.id, actor);
  files.upload(input('Second synthetic version'), actor, file.id); hub.initialise(file.id, actor);
  hub.update(file.id, {revision: hub.metadata(file.id, actor).revision, confidentiality: 'restricted'}, actor);
  return {dir, app, file, files, source: join(dir, 'pilot.sqlite'), output: join(dir, 'export')};
}

test('consistent export preserves versions, restricted metadata, audit and encrypted bytes without modifying the workspace', () => {
  const key = randomBytes(32).toString('base64'), w = workspace(key);
  try {
    const before = w.app.store.db.prepare('SELECT * FROM audit').all();
    const report = exportWorkspace(w.source, w.output, {encryptionKey: key});
    assert.equal(report.counts.file_versions, 2);
    assert.equal(report.objectCount, 2);
    assert.equal(report.readyForProductionImport, false);
    assert.deepEqual(report.actorIds, ['synthetic-user']);
    assert.deepEqual(verifyExport(w.output, {encryptionKey: key}), report);
    const records = JSON.parse(readFileSync(join(w.output, 'records.json')));
    assert.equal(records.file_metadata[0].confidentiality, 'restricted');
    assert.deepEqual(records.audit, JSON.parse(JSON.stringify(before)));
    assert.deepEqual(w.app.store.db.prepare('SELECT * FROM audit').all(), before);
    const version = w.files.versions(w.file.id, actor)[0];
    const stored = readFileSync(join(w.output, 'objects', version.hash + '.bin'));
    assert.equal(stored.includes(Buffer.from('Second synthetic version')), false);
    assert.throws(() => exportWorkspace(w.source, w.output, {encryptionKey: key}), /already exists/);
  } finally { w.app.store.close(); rmSync(w.dir, {recursive: true, force: true}); }
});

test('wrong encryption key and missing version contents fail export without publishing or leaving partial files', () => {
  const w = workspace(randomBytes(32).toString('base64'));
  try {
    assert.throws(() => exportWorkspace(w.source, w.output, {encryptionKey: randomBytes(32).toString('base64')}), /incorrect|modified/);
    assert.equal(existsSync(w.output), false);
    assert.equal(readdirSync(w.dir).some(n => n.includes('.partial-')), false);
    w.app.store.db.exec('DELETE FROM file_blobs');
    assert.throws(() => exportWorkspace(w.source, w.output, {encryptionKey: undefined}), /missing or mismatched/);
    assert.equal(existsSync(w.output), false);
  } finally { w.app.store.close(); rmSync(w.dir, {recursive: true, force: true}); }
});

test('verification detects metadata, object and reconciliation tampering and invalid paths', () => {
  const w = workspace();
  try {
    exportWorkspace(w.source, w.output);
    const recordPath = join(w.output, 'records.json'), original = readFileSync(recordPath);
    writeFileSync(recordPath, Buffer.concat([original, Buffer.from(' ')]));
    assert.throws(() => verifyExport(w.output), /metadata checksum/);
    writeFileSync(recordPath, original);
    const path = join(w.output, 'manifest.json'), manifest = JSON.parse(readFileSync(path));
    const objectPath = join(w.output, 'objects', manifest.objects[0].sha256 + '.bin'), bytes = readFileSync(objectPath);
    writeFileSync(objectPath, 'corrupt');
    assert.throws(() => verifyExport(w.output), /object checksum/);
    writeFileSync(objectPath, bytes);
    manifest.report.objectCount++;
    writeFileSync(path, JSON.stringify(manifest));
    assert.throws(() => verifyExport(w.output), /reconciliation/);
    manifest.objects[0].sha256 = '../outside';
    writeFileSync(path, JSON.stringify(manifest));
    assert.throws(() => verifyExport(w.output), /descriptor/);
  } finally { w.app.store.close(); rmSync(w.dir, {recursive: true, force: true}); }
});

test('missing source files and unknown workspace tables cannot silently become a production-ready export', () => {
  const w = workspace();
  try {
    const report = exportWorkspace(w.source, w.output);
    assert.ok(report.sourcesWithoutBytes.length > 0);
    assert.equal(report.readyForProductionImport, false);
    w.app.store.db.exec('CREATE TABLE future_data (id TEXT)');
    assert.throws(() => exportWorkspace(w.source, join(w.dir, 'second')), /Unsupported workspace/);
    assert.throws(() => exportWorkspace(join(w.dir, 'missing.sqlite'), join(w.dir, 'third')), /does not exist/);
    assert.equal(existsSync(join(w.dir, 'missing.sqlite')), false);
  } finally { w.app.store.close(); rmSync(w.dir, {recursive: true, force: true}); }
});

test('export and verify CLI report counts without printing private ownership identifiers', () => {
  const w = workspace();
  try {
    for (const args of [['export', w.source, w.output], ['verify', w.output]]) {
      const result = spawnSync(process.execPath, ['scripts/migration-export.js', ...args], {encoding: 'utf8'});
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).objects, 2);
      assert.equal(result.stdout.includes('synthetic-user'), false);
      assert.equal(result.stdout.includes('policy.txt'), false);
    }
  } finally { w.app.store.close(); rmSync(w.dir, {recursive: true, force: true}); }
});
