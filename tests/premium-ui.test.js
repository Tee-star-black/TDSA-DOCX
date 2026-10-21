import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createHubServer} from '../src/runtime/server.js';

const asset=name=>readFileSync(new URL('../public-hub/'+name,import.meta.url),'utf8');
const explorer=asset('explorer.js'),modern=asset('modern.js'),css=asset('modern.css');
const run=expression=>runInNewContext(explorer+'\n'+expression,{document:{querySelector:()=>null},window:{},console});

test('dashboard summaries are derived from real authorized document rows',()=>{
  for(const marker of ['data-count-approvals','data-count-expiring','data-count-missing','data-count-recent'])
    assert.ok(explorer.includes(marker),marker);
  assert.match(explorer,/pref\.register\?\.configured/);
  assert.equal(run("recentlyUpdated('2000-01-01T00:00:00Z')"),false);
  assert.equal(run("recentlyUpdated(new Date().toISOString())"),true);
  assert.equal(run("pref.folder=null;matching({dataset:{archived:'false',updated:new Date().toISOString()}},'recent')"),true);
  assert.equal(run("pref.folder=null;matching({dataset:{archived:'true',updated:new Date().toISOString()}},'recent')"),false);
});
test('premium UI preserves actual search and protected document actions',()=>{
  assert.match(modern,/shortcut\.replaceWith\(form\)/);
  assert.match(modern,/modern-search/);
  assert.match(modern,/Account menu/);
  for(const part of ['/files/','/approvals','/publications','/classification'])assert.ok(explorer.includes(part),part);
  assert.match(explorer,/tdsa:open-full-document/);
});
test('desktop and mobile UI have reduced motion and responsive controls',()=>{
  assert.match(css, /@media\(max-width:680px\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /\.explorer-inspector\.open/);
  assert.match(css, /\.summary-glyph/);
  assert.match(asset('index.html'),/\/modern\.css/);
  assert.match(asset('index.html'),/\/modern\.js/);
});
test('new UI files are served by the existing same-origin secure server',async()=>{
  const server=createHubServer({service:{},sessions:{},preview:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const origin='http://127.0.0.1:'+server.address().port;
    for(const path of ['/modern.js','/modern.css']){
      const response=await fetch(origin+path);
      assert.equal(response.status,200,path);
      assert.match(response.headers.get('content-security-policy'),/default-src 'self'/);
      assert.match(await response.text(),/Document Hub/i);
    }
  }finally{await new Promise(resolve=>server.close(resolve));}
});
