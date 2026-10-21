import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const explorer=readFileSync(new URL('../public-hub/explorer.js',import.meta.url),'utf8');
const hub=readFileSync(new URL('../public-hub/hub.js',import.meta.url),'utf8');
const experience=readFileSync(new URL('../public-hub/experience.js',import.meta.url),'utf8');

function check(code){return runInNewContext(explorer+'\n'+code,{document:{querySelector:()=>null},window:{},console});}

test('folder scope includes descendants without showing adjacent folders',()=>{
  assert.equal(check(`pref.folder='parent';pref.folderParents=new Map([['child','parent'],['sibling',''],['parent','']]);matching({dataset:{folderId:'child',archived:'false'}},'all')`),true);
  assert.equal(check(`pref.folder='parent';pref.folderParents=new Map([['child','parent'],['sibling',''],['parent','']]);matching({dataset:{folderId:'sibling',archived:'false'}},'all')`),false);
  assert.equal(check(`pref.folder=null;matching({dataset:{folderId:'sibling',archived:'false'}},'all')`),true);
});
test('archive and personal views stay scoped to the intended rows',()=>{
  assert.equal(check(`pref.folder=null;matching({dataset:{archived:'true'}},'all')`),false);
  assert.equal(check(`pref.folder=null;matching({dataset:{archived:'true'}},'archive')`),true);
  assert.equal(check(`pref.principal='employee';matching({dataset:{archived:'false',owner:'employee',author:'another',subject:''}},'mine')`),true);
  assert.equal(check(`pref.principal='employee';matching({dataset:{archived:'false',owner:'someone-else',author:'another',subject:''}},'mine')`),false);
});
test('native hub defers explorer navigation without needing a full app rebuild',()=>{
  assert.match(hub,/tdsa:folder-changed/);
  assert.match(hub,/tdsa:archive-changed/);
  assert.match(hub,/if\(document\.dispatchEvent\(event\)\)library\(\)/);
  assert.match(explorer,/document\.addEventListener\('tdsa:folder-changed'/);
  assert.match(explorer,/document\.addEventListener\('tdsa:archive-changed'/);
  assert.doesNotMatch(explorer,/select\.dispatchEvent\(new Event\('change'/);
});
test('preview actions use an awaited handoff instead of timed synthetic clicks',()=>{
  assert.match(hub,/tdsa:open-full-document/);
  assert.match(explorer,/new CustomEvent\('tdsa:open-full-document'/);
  assert.doesNotMatch(explorer,/setTimeout\(\(\)=>observer\.disconnect/);
  assert.match(experience,/observer\.observe\(hubRoot,\{childList:true\}\)/);
});
