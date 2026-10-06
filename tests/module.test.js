import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import http from 'node:http';
import {openStore} from '../src/store.js';
import {createApp} from '../src/server.js';
import {validateSubmission} from '../src/forms.js';

const catalogue=fileURLToPath(new URL('../data/catalogue.json',import.meta.url));
const actor={id:'test-patient',facilityId:'demo-facility',surface:'patient'};
const feedback=(data={})=>({templateId:'complaint',templateVersion:1,facilityId:actor.facilityId,data:{type:'Complaint',anonymous:true,details:'Synthetic waiting-time feedback',...data}});
test('external links may navigate to app pages while cross-site APIs and embeds stay blocked',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tdsa-navigation-'));const {server,store}=createApp({dataDir:dir});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const request=(path,headers,method='GET')=>new Promise((resolve,reject)=>{
  const r=http.request(base+path,{method,headers},response=>{response.resume();resolve(response.statusCode);});r.on('error',reject);r.end();
 });
 const navigation={'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'};
 try{
  assert.equal(await request('/patient',navigation),200);
  assert.equal(await request('/',navigation),200);
  assert.equal(await request('/api/patient/session',navigation),403);
  assert.equal(await request('/patient',{...navigation,'Sec-Fetch-Dest':'iframe'}),403);
  assert.equal(await request('/patient',{...navigation,'Sec-Fetch-Mode':'cors'}),403);
  assert.equal(await request('/api/patient/submissions',navigation,'POST'),403);
 }finally{await new Promise(r=>server.close(r));store.close();rmSync(dir,{recursive:true});}
});
test('draft survives database close and reopen',()=>{
 const dir=mkdtempSync(join(tmpdir(),'tdsa-'));const path=join(dir,'test.sqlite');
 let store=openStore(path,catalogue);const r=store.save(feedback(),actor);store.close();
 store=openStore(path,catalogue);assert.equal(store.getSubmission(r.id,actor).data.details,'Synthetic waiting-time feedback');store.close();rmSync(dir,{recursive:true});
});
test('finalisation is idempotent and creates only one linked feedback case',()=>{
 const s=openStore(':memory:',catalogue);const draft=s.save(feedback(),actor);const input={...feedback(),attested:true,revision:draft.revision};
 const final=s.save(input,actor,true,draft.id);const retry=s.save(input,actor,true,draft.id);
 assert.equal(final.id,retry.id);assert.equal(s.cases(actor).length,1);assert.equal(final.templateVersion,1);assert.equal(final.status,'submitted');s.close();
});
test('submitted records cannot be edited or switched to a different template',()=>{
 const s=openStore(':memory:',catalogue),r=s.save(feedback(),actor);s.save({...feedback(),attested:true,revision:r.revision},actor,true,r.id);
 assert.throws(()=>s.save({...feedback({details:'Changed'}),revision:2},actor,false,r.id),err=>err.status===409);
 assert.throws(()=>s.save({templateId:'cleaning',templateVersion:1,facilityId:actor.facilityId,data:{}},actor,false,r.id),err=>err.status===403);s.close();
});
test('stale draft revision cannot overwrite a newer save',()=>{
 const s=openStore(':memory:',catalogue),r=s.save(feedback(),actor);s.save({...feedback(),revision:r.revision},actor,false,r.id);
 assert.throws(()=>s.save({...feedback({details:'stale'}),revision:r.revision},actor,false,r.id),err=>err.status===409);s.close();
});
test('records and register entries are isolated by author and facility',()=>{
 const s=openStore(':memory:',catalogue),r=s.save(feedback(),actor);s.save({...feedback(),attested:true,revision:r.revision},actor,true,r.id);
 for(const other of [{...actor,id:'other'},{...actor,facilityId:'other-facility'}]){assert.throws(()=>s.getSubmission(r.id,other),err=>err.status===404);assert.equal(s.submissions(other).length,0);assert.equal(s.cases(other).length,0);}s.close();
});
test('final forms enforce required fields, attestation, versions and calendar validity',()=>{
 assert.ok(validateSubmission(feedback({details:''}),{final:true}).errors.details);
 assert.ok(validateSubmission(feedback(),{final:true}).errors.attested);
 assert.ok(validateSubmission({...feedback(),templateVersion:9}).errors.templateVersion);
 assert.ok(validateSubmission(feedback({eventDate:'2026-02-31'})).errors.eventDate);
 assert.ok(validateSubmission({...feedback(),facilityId:'other'}).errors.facilityId);
});
test('anonymous feedback discards name and contact server-side',()=>{
 const result=validateSubmission(feedback({name:'Should not remain',contact:'private@example.test'}));assert.equal(result.data.name,'');assert.equal(result.data.contact,'');
});
test('server blocks cross-origin requests, forged hosts and mutations without CSRF',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tdsa-api-'));const {server,store}=createApp({dataDir:dir});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  assert.equal((await fetch(base+'/api/documents',{headers:{Origin:'https://evil.example'}})).status,403);
  const forgedHostStatus=await new Promise((resolve,reject)=>{const request=http.get(base+'/api/documents',{headers:{Host:'evil.example'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);});
  assert.equal(forgedHostStatus,403);
  assert.equal((await fetch(base+'/api/submissions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(feedback())})).status,403);
  const session=await(await fetch(base+'/api/patient/session')).json();
  const headers={'Content-Type':'application/json','X-CSRF-Token':session.csrfToken};
  const r=await fetch(base+'/api/patient/submissions',{method:'POST',headers,body:JSON.stringify(feedback())});assert.equal(r.status,201);const draft=await r.json();
  const final=await fetch(base+'/api/patient/submissions/'+draft.id+'/submit',{method:'POST',headers,body:JSON.stringify({...feedback(),attested:true,revision:draft.revision})});assert.equal(final.status,200);
  assert.equal((await(await fetch(base+'/api/cases')).json()).length,1);
  assert.equal((await fetch(base+'/patient/records/'+draft.id+'/print')).status,200);
  const docs=await(await fetch(base+'/api/documents')).json();const restricted=docs.find(d=>d.restricted);assert.equal((await fetch(base+'/api/documents/'+restricted.id+'/file')).status,404);
  assert.equal((await fetch(base+'/.data/pilot.sqlite')).status,404);
 }finally{await new Promise(r=>server.close(r));store.close();rmSync(dir,{recursive:true});}
});
test('print export escapes user-supplied HTML',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tdsa-print-'));const {server,store}=createApp({dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const demo={id:'local-demo-patient',facilityId:'demo-facility',surface:'patient'};const r=store.save(feedback({details:'<script>alert(1)</script>'}),demo);
 try{const html=await(await fetch(`http://127.0.0.1:${server.address().port}/patient/records/${r.id}/print`)).text();assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));}
 finally{await new Promise(r=>server.close(r));store.close();rmSync(dir,{recursive:true});}
});
