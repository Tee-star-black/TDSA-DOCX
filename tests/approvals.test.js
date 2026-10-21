import {test} from 'node:test';
import assert from 'node:assert/strict';
import {previewDatabase,profiles,scope,memoryStorage,previewScanner} from '../src/dev/fixtures.js';
import {documentService} from '../src/runtime/documents.js';
import {scoped} from '../src/runtime/database.js';
import {createHubServer} from '../src/runtime/server.js';
import {sessionStore} from '../src/runtime/identity.js';

const input=(text='First policy')=>({filename:'policy.txt',title:'Controlled policy',privacy:'section',requiresApproval:true,content:Buffer.from(text).toString('base64')});
const expectStatus=status=>error=>error.status===status;

async function fixture(){const {pool,admin}=await previewDatabase();return {pool,admin,service:documentService(pool,memoryStorage(),previewScanner)};}

test('controlled HR documents need independent review and a pinned publication',async()=>{
  const {pool,service}=await fixture();
  try{
    const f=await service.upload(profiles.hr.id,scope('hr'),input());
    assert.equal((await service.list(profiles.employee.id,scope('hr'))).files.some(x=>x.id===f.id),false);
    await assert.rejects(service.detail(profiles.employee.id,scope('hr'),f.id),expectStatus(404));
    await assert.rejects(service.content(profiles.employee.id,scope('hr'),f.id,null),expectStatus(404));
    const submitted=await service.submitApproval(profiles.hr.id,scope('hr'),f.id,{revision:1,note:'Ready for review'});
    assert.equal(submitted.status,'pending');
    await assert.rejects(service.decideApproval(profiles.hr.id,scope('hr'),f.id,submitted.id,{revision:2,decision:'approved'}),expectStatus(403));
    await assert.rejects(service.publishApproval(profiles.dual.id,scope('hr'),f.id,{revision:2}),expectStatus(409));
    const reviewed=await service.decideApproval(profiles.dual.id,scope('hr'),f.id,submitted.id,{revision:2,decision:'approved',note:'Checked'});
    assert.equal(reviewed.status,'approved');
    await service.publishApproval(profiles.dual.id,scope('hr'),f.id,{revision:3});
    assert.equal((await service.list(profiles.employee.id,scope('hr'))).files.find(x=>x.id===f.id).version,1);
    assert.equal((await service.content(profiles.employee.id,scope('hr'),f.id,null)).bytes.toString(),'First policy');
    assert.equal((await service.approvalHistory(profiles.employee.id,scope('hr'),f.id)).publishedVersion,1);
    assert.deepEqual((await service.approvalHistory(profiles.employee.id,scope('hr'),f.id)).reviews,[]);
    await service.upload(profiles.hr.id,scope('hr'),{...input('Second draft'),revision:4},f.id);
    assert.equal((await service.content(profiles.employee.id,scope('hr'),f.id,null)).bytes.toString(),'First policy');
    await assert.rejects(service.content(profiles.employee.id,scope('hr'),f.id,'2'),expectStatus(404));
    assert.equal((await service.detail(profiles.employee.id,scope('hr'),f.id)).versions.length,1);
    assert.equal((await service.detail(profiles.dual.id,scope('hr'),f.id)).versions.length,2);
    await scoped(pool,profiles.employee.id,scope('hr'),async c=>{
      const {rows}=await c.query('SELECT version FROM document_hub.file_versions WHERE file_id=$1',[f.id]);
      assert.deepEqual(rows.map(r=>r.version),[1]);
    });
  }finally{await pool.end();}
});

test('new versions supersede pending reviews; rejected reviews cannot be published',async()=>{
  const {pool,service}=await fixture();
  try{
    const f=await service.upload(profiles.hr.id,scope('hr'),input());
    const r=await service.submitApproval(profiles.hr.id,scope('hr'),f.id,{revision:1});
    await service.upload(profiles.hr.id,scope('hr'),{...input('Updated draft'),revision:2},f.id);
    const history=await service.approvalHistory(profiles.hr.id,scope('hr'),f.id);
    assert.equal(history.reviews[0].status,'superseded');
    await assert.rejects(service.decideApproval(profiles.dual.id,scope('hr'),f.id,r.id,{revision:3,decision:'approved'}),expectStatus(409));
    const latest=await service.submitApproval(profiles.hr.id,scope('hr'),f.id,{revision:3});
    await assert.rejects(service.decideApproval(profiles.dual.id,scope('hr'),f.id,latest.id,{revision:4,decision:'rejected'}),expectStatus(422));
    await service.decideApproval(profiles.dual.id,scope('hr'),f.id,latest.id,{revision:4,decision:'rejected',note:'Needs corrections'});
    await assert.rejects(service.publishApproval(profiles.dual.id,scope('hr'),f.id,{revision:5}),expectStatus(409));
    const resubmitted=await service.submitApproval(profiles.hr.id,scope('hr'),f.id,{revision:5});
    await service.decideApproval(profiles.dual.id,scope('hr'),f.id,resubmitted.id,{revision:6,decision:'approved'});
    await service.publishApproval(profiles.dual.id,scope('hr'),f.id,{revision:7});
    assert.equal((await service.approvalHistory(profiles.hr.id,scope('hr'),f.id)).publishedVersion,2);
    await assert.rejects(service.publishApproval(profiles.dual.id,scope('hr'),f.id,{revision:8}),expectStatus(409));
  }finally{await pool.end();}
});

test('only a manager can mark an existing team or section document controlled; privacy cannot bypass review',async()=>{
  const {pool,service}=await fixture();
  try{
    const f=await service.upload(profiles.hr.id,scope('hr'),{...input(),requiresApproval:false});
    assert.equal((await service.content(profiles.employee.id,scope('hr'),f.id,null)).bytes.toString(),'First policy');
    await assert.rejects(service.enableApproval(profiles.employee.id,scope('hr'),f.id,{revision:1}),expectStatus(403));
    await service.enableApproval(profiles.hr.id,scope('hr'),f.id,{revision:1});
    await assert.rejects(service.content(profiles.employee.id,scope('hr'),f.id,null),expectStatus(404));
    await assert.rejects(service.privacy(profiles.hr.id,scope('hr'),f.id,{revision:2,privacy:'personal',subjectId:profiles.employee.id}),expectStatus(422));
    await assert.rejects(service.privacy(profiles.hr.id,scope('hr'),f.id,{revision:2,privacy:'restricted'}),expectStatus(422));
    const personal=await service.upload(profiles.hr.id,scope('hr'),{...input(),privacy:'personal',subjectId:profiles.employee.id,requiresApproval:false});
    await assert.rejects(service.enableApproval(profiles.hr.id,scope('hr'),personal.id,{revision:1}),expectStatus(422));
    await assert.rejects(service.upload(profiles.hr.id,scope('hr'),{...input(),privacy:'personal',subjectId:profiles.employee.id}),expectStatus(422));
  }finally{await pool.end();}
});

test('review publication routes enforce sessions, CSRF, and manager roles',async()=>{
  const {pool,service}=await fixture();const sessions=sessionStore(pool,{secure:false});let server;
  try{
    const file=await service.upload(profiles.hr.id,scope('hr'),input());
    const submitted=await service.submitApproval(profiles.hr.id,scope('hr'),file.id,{revision:1});
    server=createHubServer({service,sessions,preview:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const base=`http://127.0.0.1:${server.address().port}`;
    const make=async profile=>{
      const cookie=(await sessions.create(profile.id,new Date(Date.now()+3600000))).split(';')[0];
      const session=await (await fetch(base+'/api/session',{headers:{Cookie:cookie}})).json();
      return {cookie,csrf:session.csrfToken};
    };
    const manager=await make(profiles.dual),employee=await make(profiles.employee),endpoint=base+'/api/workspaces/preview-org/preview-facility/hr/files/'+file.id;
    assert.equal((await fetch(endpoint+'/approvals',{headers:{Cookie:employee.cookie}})).status,404);
    assert.equal((await fetch(endpoint+'/approvals/'+submitted.id+'/decision',{method:'PUT',headers:{Cookie:manager.cookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({revision:2,decision:'approved'})})).status,403);
    const response=await fetch(endpoint+'/approvals/'+submitted.id+'/decision',{method:'PUT',headers:{Cookie:manager.cookie,Origin:base,'X-CSRF-Token':manager.csrf,'Content-Type':'application/json'},body:JSON.stringify({revision:2,decision:'approved'})});
    assert.equal(response.status,200);
    const published=await fetch(endpoint+'/publications',{method:'POST',headers:{Cookie:manager.cookie,Origin:base,'X-CSRF-Token':manager.csrf,'Content-Type':'application/json'},body:JSON.stringify({revision:3})});
    assert.equal(published.status,201);
    assert.equal((await fetch(endpoint+'/approvals',{headers:{Cookie:employee.cookie}})).status,200);
  }finally{if(server)await new Promise(r=>server.close(r));await pool.end();}
});
