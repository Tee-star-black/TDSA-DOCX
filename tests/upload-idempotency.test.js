import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {previewDatabase,profiles,scope,memoryStorage,previewScanner} from '../src/dev/fixtures.js';
import {documentService} from '../src/runtime/documents.js';
import {scoped} from '../src/runtime/database.js';

const input=(requestId,text='Synthetic content')=>({
  requestId,filename:'sample.txt',title:'Synthetic document',privacy:'team',
  content:Buffer.from(text).toString('base64')
});
const denied=status=>err=>err.status===status;

test('same scoped upload identifier replays the committed result without new blob/version',async()=>{
  const {pool}=await previewDatabase(),storage=memoryStorage(),service=documentService(pool,storage,previewScanner);
  try{
    const requestId=randomUUID();
    const first=await service.upload(profiles.hr.id,scope('hr'),input(requestId));
    const duplicate=await service.upload(profiles.hr.id,scope('hr'),input(requestId));
    assert.equal(first.id,duplicate.id);
    assert.equal(duplicate.replayed,true);
    assert.equal(storage.values.size,1);
    assert.equal((await service.list(profiles.hr.id,scope('hr'))).files.length,1);
    await assert.rejects(service.upload(profiles.hr.id,scope('hr'),input(requestId,'Changed content')),denied(409));
  }finally{await pool.end();}
});

test('upload identifiers cannot expose results across principals or sections',async()=>{
  const {pool}=await previewDatabase(),service=documentService(pool,memoryStorage(),previewScanner);
  try{
    const requestId=randomUUID();
    const first=await service.upload(profiles.hr.id,scope('hr'),input(requestId));
    const other=await service.upload(profiles.dual.id,scope('hr'),input(requestId));
    assert.notEqual(first.id,other.id);
    const compliance=await service.upload(profiles.dual.id,scope('compliance'),input(requestId));
    assert.notEqual(compliance.id,other.id);
    await assert.rejects(service.upload(profiles.employee.id,scope('hr'),input(requestId)),denied(403));
  }finally{await pool.end();}
});

test('in-flight duplicate request fails closed and first request completes exactly once',async()=>{
  const {pool}=await previewDatabase(),storage=memoryStorage();
  try{
    let unblock,scanned;
    const hold=new Promise(resolve=>{unblock=resolve;});
    const entered=new Promise(resolve=>{scanned=resolve;});
    const scanner={async scan(){scanned();await hold;}};
    const service=documentService(pool,storage,scanner),requestId=randomUUID();
    const first=service.upload(profiles.hr.id,scope('hr'),input(requestId));
    await entered;
    await assert.rejects(service.upload(profiles.hr.id,scope('hr'),input(requestId)),denied(409));
    unblock();
    const saved=await first;
    assert.equal((await service.upload(profiles.hr.id,scope('hr'),input(requestId))).id,saved.id);
    assert.equal(storage.values.size,1);
  }finally{await pool.end();}
});

test('scanner errors release a reservation so same ID can be retried safely',async()=>{
  const {pool}=await previewDatabase(),storage=memoryStorage(),requestId=randomUUID();
  try{
    const fail=documentService(pool,storage,{async scan(){throw Object.assign(Error('Scanner down'),{status:503});}});
    await assert.rejects(fail.upload(profiles.hr.id,scope('hr'),input(requestId)),denied(503));
    assert.equal(storage.values.size,0);
    const service=documentService(pool,storage,previewScanner);
    const result=await service.upload(profiles.hr.id,scope('hr'),input(requestId));
    assert.equal((await service.detail(profiles.hr.id,scope('hr'),result.id)).versions.length,1);
  }finally{await pool.end();}
});

test('raw SQL ledger reads stay scoped to calling principal',async()=>{
  const {pool}=await previewDatabase(),service=documentService(pool,memoryStorage(),previewScanner);
  try{
    await service.upload(profiles.hr.id,scope('hr'),input(randomUUID()));
    const entries=await scoped(pool,profiles.dual.id,scope('hr'),async c=>(await c.query('SELECT * FROM document_hub.upload_requests')).rows);
    assert.equal(entries.length,0);
  }finally{await pool.end();}
});
