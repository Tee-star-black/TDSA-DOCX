import {test} from 'node:test';
import assert from 'node:assert/strict';
import {previewDatabase,profiles,scope,memoryStorage,previewScanner} from '../src/dev/fixtures.js';
import {documentService} from '../src/runtime/documents.js';
import {sessionStore} from '../src/runtime/identity.js';
import {createHubServer} from '../src/runtime/server.js';

test('reference resolution requires a real Hub session and current document access',async()=>{
  const {pool,admin}=await previewDatabase();
  const service=documentService(pool,memoryStorage(),previewScanner);
  const sessions=sessionStore(pool,{secure:false});
  let server;
  try{
    const uploaded=await service.upload(profiles.hr.id,scope('hr'),{
      title:'Synthetic HR record',filename:'reference.txt',privacy:'personal',
      subjectId:profiles.employee.id,content:Buffer.from('synthetic only').toString('base64')
    });
    server=createHubServer({service,sessions,preview:true});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+server.address().port;
    const ref=base+'/api/workspaces/preview-org/preview-facility/hr/files/'+uploaded.id+'/reference';
    assert.equal((await fetch(ref)).status,401);
    const own=(await sessions.create(profiles.employee.id,new Date(Date.now()+3600000))).split(';')[0];
    const other=(await sessions.create(profiles.colleague.id,new Date(Date.now()+3600000))).split(';')[0];
    const read=(cookie,url=ref)=>fetch(url,{headers:{Cookie:cookie}});
    assert.equal((await read(other)).status,404);
    const response=await read(own);
    assert.equal(response.status,200);
    const data=await response.json();
    assert.equal(data.kind,'tdsa.document-reference.v1');
    assert.equal(data.documentId,uploaded.id);
    assert.equal(data.version,1);
    assert.equal(data.section,'hr');
    assert.equal(typeof data.versionId,'string');
    assert.equal(JSON.stringify(data).includes('synthetic only'),false);
    assert.equal((await read(own,ref+'?version=999')).status,404);
    await admin(db=>db.query('UPDATE hub_identity.memberships SET active=false WHERE principal_id=$1',[profiles.employee.id]));
    assert.equal((await read(own)).status,403);
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    await pool.end();
  }
});
