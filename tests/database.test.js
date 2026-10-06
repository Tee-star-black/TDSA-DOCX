import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateRawSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../src/server.js';
import {restoreDatabase} from '../scripts/database.js';
import {readZip} from '../src/zip.js';

function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function zip(entries){const local=[],central=[];let offset=0;
 for(const [name,text] of entries){const n=Buffer.from(name),data=Buffer.from(text),packed=deflateRawSync(data),crc=crc32(data),l=Buffer.alloc(30),c=Buffer.alloc(46);
  l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(8,8);l.writeUInt32LE(crc,14);l.writeUInt32LE(packed.length,18);l.writeUInt32LE(data.length,22);l.writeUInt16LE(n.length,26);
  c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(8,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(packed.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
  local.push(l,n,packed);central.push(c,n);offset+=l.length+n.length+packed.length;
 }const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end]);
}
const pdf='%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF';
test('ZIP parser rejects unsafe paths and checksum corruption',()=>{
 assert.throws(()=>readZip(zip([['../outside.pdf',pdf]])),e=>e.status===422);
 const archive=zip([['safe.pdf',pdf]]);archive[30+'safe.pdf'.length+2]^=4;assert.throws(()=>readZip(archive),e=>e.status===422);
});
test('archive import, retrieval, restart and backup restore preserve the whole database workspace',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'tdsa-complete-'));let app=createApp({dataDir:directory});
 let base;const start=async()=>{await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${app.server.address().port}`;};
 const stop=async()=>{await new Promise(r=>app.server.close(r));app.store.close();};
 const get=async path=>(await fetch(base+path)).json();
 let csrf;
 const post=(path,input)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(input)});
 try{
  await start();csrf=(await get('/api/session')).csrfToken;
  const archive=zip([['sop/SOP_example.pdf',pdf],['sop/duplicate.pdf',pdf],['sop/scan_record.pdf',pdf+'\nRestricted example']]);
  let response=await post('/api/imports',{content:archive.toString('base64')});assert.equal(response.status,201);const summary=await response.json();assert.equal(summary.uniqueDocuments,2);assert.equal(summary.duplicates,1);assert.equal(summary.restricted,1);
  const docs=await get('/api/documents');assert.equal(docs.length,2);const available=docs.find(d=>!d.restricted);assert.ok(available.fileAvailable);
  assert.equal(await(await fetch(base+'/api/documents/'+available.id+'/file')).text(),pdf);
  assert.equal((await get('/api/explorer')).folders.length,2);
  assert.equal((await(await post('/api/imports',{content:archive.toString('base64')})).json()).alreadyImported,true);
  const upload=await(await post('/api/files',{filename:'test.txt',content:Buffer.from('Persistent file contents').toString('base64')})).json();
  const patient=await get('/api/patient/session');const request={templateId:'complaint',templateVersion:1,facilityId:'demo-facility',data:{type:'Complaint',anonymous:true,details:'Synthetic backup test'}};
  const patientPost=(p,input)=>fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':patient.csrfToken},body:JSON.stringify(input)});
  const draft=await(await patientPost('/api/patient/submissions',request)).json();await patientPost('/api/patient/submissions/'+draft.id+'/submit',{...request,revision:draft.revision,attested:true});
  const status=await get('/api/database');assert.equal(status.engine,'SQLite');assert.equal(status.integrity,'ok');assert.equal(status.counts.file_blobs,2);assert.equal(status.counts.cases,1);
  response=await post('/api/database/backup',{});assert.equal(response.status,200);const backup=join(directory,'backup.sqlite');writeFileSync(backup,Buffer.from(await response.arrayBuffer()));
  await stop();app=createApp({dataDir:directory});await start();assert.equal((await get('/api/documents')).length,2);assert.equal(await(await fetch(base+'/api/files/'+upload.id+'/content')).text(),'Persistent file contents');
  await stop();const restoreDir=join(directory,'restored');const {mkdirSync}=await import('node:fs');mkdirSync(restoreDir);restoreDatabase(backup,join(restoreDir,'pilot.sqlite'));app=createApp({dataDir:restoreDir});await start();
  assert.equal((await get('/api/documents')).length,2);assert.equal((await get('/api/cases')).length,1);assert.equal(await(await fetch(base+'/api/files/'+upload.id+'/content')).text(),'Persistent file contents');assert.equal(await(await fetch(base+'/api/documents/'+available.id+'/file')).text(),pdf);
  const check=new DatabaseSync(join(restoreDir,'pilot.sqlite'),{readOnly:true});assert.equal(check.prepare('PRAGMA integrity_check').get().integrity_check,'ok');check.close();
 }finally{if(app.server.listening)await stop();rmSync(directory,{recursive:true});}
});
test('malformed ZIP import leaves documents and folders unchanged',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'tdsa-import-fail-')),app=createApp({dataDir:directory});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
 try{const session=await(await fetch(base+'/api/session')).json();const archive=zip([['good.pdf',pdf],['bad.pdf','Not a PDF']]);
  const result=await fetch(base+'/api/imports',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},body:JSON.stringify({content:archive.toString('base64')})});assert.equal(result.status,422);assert.equal(app.store.documents().length,3);assert.equal(app.store.db.prepare('SELECT COUNT(*) AS n FROM folders').get().n,0);
 }finally{await new Promise(r=>app.server.close(r));app.store.close();rmSync(directory,{recursive:true});}
});
