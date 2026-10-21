import {test} from 'node:test';
import assert from 'node:assert/strict';
import {previewDatabase,profiles,scope,memoryStorage,previewScanner} from '../src/dev/fixtures.js';
import {registerService} from '../src/runtime/register.js';
import {documentService} from '../src/runtime/documents.js';
import {createHubServer} from '../src/runtime/server.js';
import {sessionStore} from '../src/runtime/identity.js';

const asText=(text,title='Synthetic document')=>({filename:'sample.txt',title,privacy:'team',content:Buffer.from(text).toString('base64')});
const forbidden=status=>error=>error.status===status;

test('classification stores owner, review and expiry dates and obeys section access',async()=>{
  const {pool}=await previewDatabase(),documents=documentService(pool,memoryStorage(),previewScanner),reg=registerService(pool);
  try{
    const file=await documents.upload(profiles.hr.id,scope('hr'),{...asText('Synthetic test'),privacy:'section'});
    const result=await reg.updateClassification(profiles.hr.id,scope('hr'),file.id,{revision:1,category:'HR & Staff',documentType:'Qualification',ownerPrincipalId:profiles.employee.id,reviewDate:'2026-11-14',expiresOn:'2026-11-29',tags:['staff','review']});
    assert.equal(result.revision,2);
    const detail=await documents.detail(profiles.employee.id,scope('hr'),file.id);
    assert.equal(detail.metadata.owner_principal_id,profiles.employee.id);
    assert.equal(detail.metadata.category,'HR & Staff');
    assert.equal(String(detail.metadata.expires_on).slice(0,10),'2026-11-29');
    const listed=await documents.list(profiles.employee.id,scope('hr'));
    assert.equal(listed.files.find(x=>x.id===file.id).owner_name,'Employee A');
    await assert.rejects(reg.updateClassification(profiles.hr.id,scope('hr'),file.id,{revision:1,category:'HR & Staff'}),forbidden(409));
    await assert.rejects(reg.updateClassification(profiles.employee.id,scope('hr'),file.id,{revision:2,category:'HR & Staff'}),forbidden(403));
    await assert.rejects(reg.updateClassification(profiles.compliance.id,scope('compliance'),file.id,{revision:2,category:'General'}),forbidden(404));
    await assert.rejects(reg.updateClassification(profiles.hr.id,scope('hr'),file.id,{revision:2,category:'Clinical & Medical'}),forbidden(422));
  }finally{await pool.end();}
});

test('requirements are private, linked to accessible same-section files, and never mark expired files satisfied',async()=>{
  const {pool}=await previewDatabase(),documents=documentService(pool,memoryStorage(),previewScanner),reg=registerService(pool);
  try{
    const requirement=await reg.createRequirement(profiles.hr.id,scope('hr'),{title:'Synthetic professional registration',category:'HR & Staff',assignedPrincipalId:profiles.employee.id,dueOn:'2026-12-15'});
    assert.equal((await reg.requirements(profiles.hr.id,scope('hr'))).missing,1);
    assert.equal((await reg.requirements(profiles.employee.id,scope('hr'))).requirements.length,1);
    assert.equal((await reg.requirements(profiles.colleague.id,scope('hr'))).requirements.length,0);
    await assert.rejects(reg.createRequirement(profiles.employee.id,scope('hr'),{title:'Not permitted'}),forbidden(403));
    const inaccessible=await documents.upload(profiles.hr.id,scope('hr'),asText('Restricted to editors'));
    await assert.rejects(reg.linkRequirement(profiles.hr.id,scope('hr'),requirement.id,{fileId:inaccessible.id}),forbidden(422));
    const file=await documents.upload(profiles.hr.id,scope('hr'),{...asText('Synthetic required doc'),privacy:'section'});
    await reg.linkRequirement(profiles.hr.id,scope('hr'),requirement.id,{fileId:file.id});
    assert.equal((await reg.requirements(profiles.hr.id,scope('hr'))).missing,0);
    const detail=await documents.detail(profiles.hr.id,scope('hr'),file.id);
    await reg.updateClassification(profiles.hr.id,scope('hr'),file.id,{revision:detail.revision,category:'HR & Staff',expiresOn:'2020-01-01'});
    assert.equal((await reg.requirements(profiles.hr.id,scope('hr'))).missing,1);
    await assert.rejects(reg.linkRequirement(profiles.compliance.id,scope('compliance'),requirement.id,{fileId:file.id}),forbidden(404));
    const other=await documents.upload(profiles.compliance.id,scope('compliance'),asText('Other dept'));
    await assert.rejects(reg.linkRequirement(profiles.hr.id,scope('hr'),requirement.id,{fileId:other.id}),forbidden(422));
  }finally{await pool.end();}
});

test('register routes require session, CSRF and manager role for writes',async()=>{
  const {pool}=await previewDatabase(),storage=memoryStorage(),documents=documentService(pool,storage,previewScanner),reg=registerService(pool),sessions=sessionStore(pool,{secure:false});
  const server=createHubServer({service:{...documents,...reg},sessions,preview:true});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
    const origin=`http://127.0.0.1:${server.address().port}`,path=origin+'/api/workspaces/preview-org/preview-facility/hr';
    assert.equal((await fetch(path+'/register')).status,401);
    const cookie=(await sessions.create(profiles.hr.id,new Date(Date.now()+3600000))).split(';')[0];
    const session=await(await fetch(origin+'/api/session',{headers:{Cookie:cookie}})).json();
    const response=await fetch(path+'/register/requirements',{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-CSRF-Token':session.csrfToken,'Content-Type':'application/json'},body:JSON.stringify({title:'Synthetic contract',category:'HR & Staff'})});
    assert.equal(response.status,201);
    const listed=await(await fetch(path+'/register',{headers:{Cookie:cookie}})).json();
    assert.equal(listed.missing,1);
    const denied=await fetch(path+'/register/requirements',{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({title:'No CSRF'})});
    assert.equal(denied.status,403);
  }finally{await new Promise(r=>server.close(r));await pool.end();}
});

test('explorer assets contain real accessible filtering and mobile inspector',async()=>{
  const {readFileSync}=await import('node:fs');
  const js=readFileSync(new URL('../public-hub/explorer.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../public-hub/explorer.css',import.meta.url),'utf8');
  assert.match(js,/data-explorer-filter/);assert.match(js,/data-summary/);
  assert.match(js,/getJSON\(base\+'\/files\/\+'/);
  assert.match(css,/@media\(max-width:600px\)/);
  assert.match(css,/\.explorer-inspector\.open/);
});
