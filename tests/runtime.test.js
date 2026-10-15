import {test} from 'node:test';
import assert from 'node:assert/strict';
import {previewDatabase,profiles,scope,memoryStorage,previewScanner} from '../src/dev/fixtures.js';
import {documentService} from '../src/runtime/documents.js';
import {sessionStore} from '../src/runtime/identity.js';
import {assertRuntimeDatabase,scoped} from '../src/runtime/database.js';
import {createHubServer} from '../src/runtime/server.js';

const input=(privacy='team',subjectId=null)=>({filename:'sample.txt',title:'Synthetic document',privacy,subjectId,content:Buffer.from('Synthetic document content').toString('base64')});
const denied=status=>e=>e.status===status;
test('PostgreSQL runtime enforces Compliance/HR, personal ownership and named restricted access through HTTP',async()=>{
  const {pool,admin}=await previewDatabase(),storage=memoryStorage(),service=documentService(pool,storage,previewScanner),sessions=sessionStore(pool,{secure:false});
  let server;
  try{
    await assertRuntimeDatabase(pool);
    const compliance=await service.upload(profiles.compliance.id,scope('compliance'),input('section'));
    const staff=await service.upload(profiles.hr.id,scope('hr'),input('section'));
    const personal=await service.upload(profiles.hr.id,scope('hr'),input('personal',profiles.employee.id));
    const restricted=await service.upload(profiles.hr.id,scope('hr'),input('restricted'));
    await assert.rejects(service.list(profiles.compliance.id,scope('hr')),denied(403));
    await assert.rejects(service.detail(profiles.dual.id,scope('compliance'),staff.id),denied(404));
    assert.deepEqual((await service.list(profiles.employee.id,scope('hr'))).files.map(f=>f.id).sort(),[staff.id,personal.id].sort());
    await assert.rejects(service.detail(profiles.colleague.id,scope('hr'),personal.id),denied(404));
    await assert.rejects(service.content(profiles.dual.id,scope('hr'),restricted.id,null),denied(404));
    await service.grant(profiles.hr.id,scope('hr'),restricted.id,{revision:1,principalId:profiles.dual.id,capability:'read'});
    assert.equal((await service.content(profiles.dual.id,scope('hr'),restricted.id,null)).bytes.toString(),'Synthetic document content');
    await assert.rejects(service.update(profiles.dual.id,scope('hr'),restricted.id,{revision:2,title:'Denied'}),denied(403));
    await service.grant(profiles.hr.id,scope('hr'),restricted.id,{revision:2,principalId:profiles.dual.id,capability:'revoke'});
    await assert.rejects(service.content(profiles.dual.id,scope('hr'),restricted.id,null),denied(404));
    await assert.rejects(service.grant(profiles.hr.id,scope('hr'),restricted.id,{revision:3,principalId:profiles.compliance.id,capability:'read'}),denied(422));
    await service.grant(profiles.hr.id,scope('hr'),restricted.id,{revision:3,principalId:profiles.dual.id,capability:'read'});
    await service.privacy(profiles.hr.id,scope('hr'),restricted.id,{revision:4,privacy:'team'});
    await service.privacy(profiles.hr.id,scope('hr'),restricted.id,{revision:5,privacy:'restricted'});
    await assert.rejects(service.content(profiles.dual.id,scope('hr'),restricted.id,null),denied(404));
    assert.deepEqual((await service.grants(profiles.hr.id,scope('hr'),restricted.id)).map(g=>g.principal_id),[profiles.hr.id]);
    const folder=await service.createFolder(profiles.hr.id,scope('hr'),{name:'HR folder'});
    await assert.rejects(service.update(profiles.compliance.id,scope('compliance'),compliance.id,{revision:1,folderId:folder.id}),denied(404));
    await assert.rejects(service.update(profiles.hr.id,scope('hr'),staff.id,{revision:1,section:'compliance'}),denied(422));
    const count=storage.values.size;
    const failed=documentService(pool,storage,{scan:async()=>{throw Object.assign(Error('Scanner unavailable'),{status:503});}});
    await assert.rejects(failed.upload(profiles.hr.id,scope('hr'),input()),denied(503));assert.equal(storage.values.size,count);
    server=createHubServer({service,sessions,preview:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
    const employeeCookie=(await sessions.create(profiles.employee.id,new Date(Date.now()+3600000))).split(';')[0];
    const endpoint=base+'/api/workspaces/preview-org/preview-facility/hr';
    assert.equal((await fetch(endpoint)).status,401);
    const req=path=>fetch(path,{headers:{Cookie:employeeCookie}});
    assert.equal((await req(base+'/api/workspaces/preview-org/preview-facility/compliance')).status,403);
    assert.equal((await req(endpoint+'/files/'+restricted.id+'/content')).status,404);
    assert.equal((await req(endpoint+'/files/'+personal.id+'/content')).status,200);
    const session=await(await req(base+'/api/session')).json();
    assert.equal((await fetch(endpoint+'/files',{method:'POST',headers:{Cookie:employeeCookie,'Content-Type':'application/json',Origin:base},body:JSON.stringify(input())})).status,403);
    assert.equal((await fetch(endpoint+'/files',{method:'POST',headers:{Cookie:employeeCookie,'Content-Type':'application/json',Origin:base,'X-CSRF-Token':session.csrfToken},body:JSON.stringify(input())})).status,403);
    await admin(db=>db.query('UPDATE hub_identity.memberships SET active=false WHERE principal_id=$1',[profiles.employee.id]));
    assert.equal((await req(endpoint+'/files/'+personal.id+'/content')).status,403);
    assert.equal((await req(base+'/api/files/'+staff.id+'/content')).status,404);
  }finally{if(server)await new Promise(r=>server.close(r));await pool.end();}
});

test('section policies filter raw SQL and version uploads reject stale revisions',async()=>{
  const {pool}=await previewDatabase(),service=documentService(pool,memoryStorage(),previewScanner);
  try{
    const file=await service.upload(profiles.hr.id,scope('hr'),input('restricted'));
    const personal=await service.upload(profiles.hr.id,scope('hr'),input('personal',profiles.employee.id));
    for(const section of ['compliance','hr'])await scoped(pool,profiles.dual.id,scope(section),async c=>{
      const {rows}=await c.query('SELECT * FROM document_hub.files WHERE id=$1',[file.id]);assert.equal(rows.length,0);
      const {rows:versions}=await c.query('SELECT * FROM document_hub.file_versions WHERE file_id=$1',[file.id]);assert.equal(versions.length,0);
    });
    await service.upload(profiles.hr.id,scope('hr'),{...input(),revision:1},personal.id);
    await assert.rejects(service.upload(profiles.hr.id,scope('hr'),{...input(),revision:1},personal.id),denied(409));
    assert.equal((await service.detail(profiles.employee.id,scope('hr'),personal.id)).versions.length,2);
    const parent=await service.createFolder(profiles.hr.id,scope('hr'),{name:'Parent'}),child=await service.createFolder(profiles.hr.id,scope('hr'),{name:'Child',parentId:parent.id});
    await assert.rejects(service.updateFolder(profiles.hr.id,scope('hr'),parent.id,{parentId:child.id}),denied(422));
  }finally{await pool.end();}
});

test('concurrent version uploads cannot overwrite or duplicate a version after scanning',async()=>{
  const {pool}=await previewDatabase(),storage=memoryStorage();
  try{
    const service=documentService(pool,storage,previewScanner);
    const file=await service.upload(profiles.hr.id,scope('hr'),input('team'));
    let scanned=0,release;
    const barrier=new Promise(resolve=>{release=resolve;});
    const concurrent=documentService(pool,storage,{async scan(){if(++scanned===2)release();await barrier;}});
    const results=await Promise.allSettled([1,2].map(()=>concurrent.upload(profiles.hr.id,scope('hr'),{...input(),revision:1},file.id)));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
    assert.deepEqual((await service.detail(profiles.hr.id,scope('hr'),file.id)).versions.map(v=>v.version),[2,1]);
    // The rejected transaction leaves a private orphan for reconciliation.
    assert.equal(storage.values.size,3);
  }finally{await pool.end();}
});
