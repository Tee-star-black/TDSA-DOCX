import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeBatch,validateBatchFile,MAX_BATCH_FILES,MAX_FILE_BYTES} from '../public-hub/upload-queue.js';
import {createHubServer} from '../src/runtime/server.js';

const sample=(name,size=100)=>({name,size});
test('batch validates supported document extensions, sizes and bounded queue',()=>{
  assert.equal(validateBatchFile(sample('policy.PDF')),null);
  assert.equal(validateBatchFile(sample('draft.docx')),null);
  assert.equal(validateBatchFile(sample('note.txt')),null);
  assert.match(validateBatchFile(sample('script.html')),/Only PDF/);
  assert.match(validateBatchFile(sample('fake.pdf',0)),/1 byte/);
  assert.match(validateBatchFile(sample('huge.pdf',MAX_FILE_BYTES+1)),/4 MiB/);
  assert.throws(()=>normalizeBatch(Array.from({length:MAX_BATCH_FILES+1},()=>sample('doc.pdf'))),/20 files/);
  const queued=normalizeBatch([sample('good.txt'),sample('bad.exe')]);
  assert.equal(queued[0].status,'queued');
  assert.equal(queued[1].status,'invalid');
});

test('batch UI only posts to existing guarded backend; no auto retries or invented network progress',()=>{
  const js=readFileSync(new URL('../public-hub/upload-queue.js',import.meta.url),'utf8');
  const hub=readFileSync(new URL('../public-hub/hub.js',import.meta.url),'utf8');
  assert.match(js,/manual/i);
  assert.match(js,/scopeMatches\(\)/);
  assert.match(js,/FileReader/);
  assert.match(js,/onprogress/);
  assert.doesNotMatch(js,/setInterval\(/);
  assert.match(hub,/privacy:'team'/);
  assert.match(hub,/requiresApproval:false/);
  assert.match(hub,/write\(scopeAtStart\+'\/files'/);
  assert.match(hub,/batchUpload\(files\)/);
});

test('batch static resources use same-origin CSP and load from document hub',async()=>{
  const server=createHubServer({service:{},sessions:{},preview:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const origin='http://127.0.0.1:'+server.address().port;
    for (const file of ['/upload-queue.js','/upload-queue.css']) {
      const res=await fetch(origin+file);
      assert.equal(res.status,200,file);
      assert.match(res.headers.get('content-security-policy'),/script-src 'self'/);
    }
    const page=await(await fetch(origin+'/')).text();
    assert.match(page,/upload-queue.css/);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
