import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openStore} from '../src/store.js';
import {explorer} from '../src/explorer.js';
import {createApp} from '../src/server.js';
const catalogue=fileURLToPath(new URL('../data/catalogue.json',import.meta.url));
const manager={id:'manager',facilityId:'demo-facility',surface:'clinician',permissions:['documents.manage','complaints.manage']};
const upload=(text='Version one')=>({filename:'example.txt',content:Buffer.from(text).toString('base64')});
test('folder hierarchy rejects cycles, sibling duplicates and foreign facilities',()=>{
 const dir=mkdtempSync(join(tmpdir(),'tdsa-folders-')),s=openStore(':memory:',catalogue),x=explorer(s,dir);
 try{const a=x.createFolder({name:'Policies'},manager),b=x.createFolder({name:'Nested',parentId:a.id},manager);
 assert.throws(()=>x.updateFolder(a.id,{parentId:b.id},manager),err=>err.status===422);
 assert.throws(()=>x.createFolder({name:'policies'},manager),err=>err.status===409);
 assert.throws(()=>x.createFolder({name:'Other',parentId:a.id},{...manager,facilityId:'other'}),err=>err.status===404);
 assert.throws(()=>x.createFolder({name:'Other'},{...manager,permissions:[]}),err=>err.status===403);
 }finally{s.close();rmSync(dir,{recursive:true});}
});
test('file versions, moves and archives survive a restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'tdsa-files-')),path=join(dir,'test.sqlite');let s=openStore(path,catalogue),x=explorer(s,dir);
 try{const f=x.createFolder({name:'Templates'},manager),file=x.upload(upload(),manager);
 x.upload(upload('Version two'),manager,file.id);x.updateFile(file.id,{title:'Renamed template',folderId:f.id,archived:true},manager);
 x.moveSource('demo-001',{folderId:f.id},manager);s.close();s=openStore(path,catalogue);x=explorer(s,dir);
 assert.equal(x.files(manager)[0].title,'Renamed template');assert.equal(x.files(manager)[0].archived,1);assert.equal(x.versions(file.id,manager).length,2);assert.equal(x.locations(manager)[0].folder_id,f.id);
 assert.throws(()=>x.upload(upload('Third'),manager,file.id),err=>err.status===409);
 assert.throws(()=>x.versions(file.id,{...manager,facilityId:'other'}),err=>err.status===404);
 }finally{s.close();rmSync(dir,{recursive:true});}
});
test('uploads reject spoofed types and invalid data',()=>{
 const dir=mkdtempSync(join(tmpdir(),'tdsa-upload-')),s=openStore(':memory:',catalogue),x=explorer(s,dir);
 try{assert.throws(()=>x.upload({...upload(),filename:'fake.pdf'},manager),err=>err.status===422);
 assert.throws(()=>x.upload({...upload(),content:'not base64'},manager),err=>err.status===422);
 assert.throws(()=>x.upload({...upload(),filename:'../bad.txt'},manager),err=>err.status===422);
 assert.throws(()=>x.upload(upload(),{...manager,permissions:[]}),err=>err.status===403);
 }finally{s.close();rmSync(dir,{recursive:true});}
});
test('patient complaint entry is separate from clinician forms and staff management',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tdsa-surfaces-')),{server,store}=createApp({dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const get=async p=>(await fetch(base+p)).json();
 const staff=await get('/api/session'),patient=await get('/api/patient/session');
 const send=(p,body,token,method='POST')=>fetch(base+p,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify(body)});
 const input={templateId:'complaint',templateVersion:1,facilityId:'demo-facility',data:{type:'Complaint',anonymous:true,details:'Synthetic patient feedback'}};
 try{
 assert.deepEqual((await get('/api/templates')).map(t=>t.id),['cleaning']);assert.deepEqual((await get('/api/patient/templates')).map(t=>t.id),['complaint']);
 assert.equal((await send('/api/submissions',input,staff.csrfToken)).status,403);
 assert.equal((await send('/api/patient/submissions',{...input,templateId:'cleaning',data:{}},patient.csrfToken)).status,403);
 assert.equal((await fetch(base+'/api/patient/explorer')).status,403);assert.equal((await fetch(base+'/api/patient/cases')).status,403);
 const draft=await(await send('/api/patient/submissions',input,patient.csrfToken)).json();
 assert.equal((await send('/api/patient/submissions/'+draft.id+'/submit',{...input,revision:draft.revision,attested:true},patient.csrfToken)).status,200);
 assert.equal((await fetch(base+'/api/submissions/'+draft.id)).status,404);
 const [c]=await get('/api/cases');assert.ok(c);assert.equal((await get('/api/cases/'+c.id)).data.details,input.data.details);
 assert.equal((await send('/api/cases/'+c.id,{assignee:'Demo manager',status:'resolved',note:''},staff.csrfToken,'PUT')).status,422);
 assert.equal((await send('/api/cases/'+c.id,{assignee:'Demo manager',status:'resolved',note:'Synthetic resolution'},staff.csrfToken,'PUT')).status,200);
 assert.equal((await get('/api/cases'))[0].workflow_status,'resolved');
 const own=await get('/api/patient/submissions/'+draft.id);assert.ok(!own.note);assert.equal(own.data.details,input.data.details);
 const file=await(await send('/api/files',upload('Stored bytes'),staff.csrfToken)).json();
 assert.equal(await(await fetch(base+'/api/files/'+file.id+'/content')).text(),'Stored bytes');
 assert.equal((await fetch(base+'/api/patient/files/'+file.id+'/content')).status,403);
 }finally{await new Promise(r=>server.close(r));store.close();rmSync(dir,{recursive:true});}
});
