import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {matchesAdvanced,validDateRange} from '../public-hub/advanced-filters.js';
import {createHubServer} from '../src/runtime/server.js';

function row(dataset, type='PDF', status='Active') {
  return {dataset,querySelector:selector=>selector==='.file-icon'?{textContent:type}:selector==='[data-document-status]'?{textContent:status}:null};
}

test('advanced filters combine type, category, privacy, owner, status and updated-date',()=>{
  const document=row({category:'HR & Staff',privacy:'restricted',owner:'employee-a',updated:'2026-11-02T10:00:00Z'},'DOCX','Awaiting approval');
  assert.equal(matchesAdvanced(document,{type:'DOCX',category:'HR & Staff',privacy:'restricted',owner:'mine',status:'Awaiting approval',from:'2026-11-01',to:'2026-11-03'},'employee-a'),true);
  assert.equal(matchesAdvanced(document,{type:'PDF'},'employee-a'),false);
  assert.equal(matchesAdvanced(document,{category:'Compliance & Governance'},'employee-a'),false);
  assert.equal(matchesAdvanced(document,{privacy:'personal'},'employee-a'),false);
  assert.equal(matchesAdvanced(document,{owner:'mine'},'employee-b'),false);
  assert.equal(matchesAdvanced(document,{owner:'unassigned'},'employee-a'),false);
  assert.equal(matchesAdvanced(document,{status:'Expired'},'employee-a'),false);
  assert.equal(matchesAdvanced(document,{from:'2026-11-03'},'employee-a'),false);
  assert.equal(matchesAdvanced(document,{to:'2026-11-01'},'employee-a'),false);
  assert.equal(matchesAdvanced(row({owner:''}),{owner:'unassigned'}),true);
});

test('date range handles unset dates and rejects impossible ordering',()=>{
  assert.equal(validDateRange('2026-11-03','2026-11-02'),false);
  assert.equal(validDateRange('2026-11-02','2026-11-03'),true);
  assert.equal(validDateRange('','2026-11-03'),true);
  assert.equal(matchesAdvanced(row({}),{from:'2026-01-01'}),false);
});

test('advanced filters stay on authorized explorer rows and reset across section changes',()=>{
  const explorer=readFileSync(new URL('../public-hub/explorer.js',import.meta.url),'utf8');
  assert.match(explorer,/rowCollection\(panel\)/);
  assert.match(explorer,/matchesAdvanced\(row,pref\.advanced,pref\.principal\)/);
  assert.match(explorer,/pref\.advanced=\{type:'',category:'',privacy:'',owner:'',status:'',from:'',to:''\}/);
  assert.match(explorer,/pref\.scope=scope/);
  assert.match(explorer,/addAdvancedFilters\(panel\)/);
  assert.doesNotMatch(explorer,/localStorage|sessionStorage/);
});

test('filter module and stylesheet are served same-origin under existing CSP',async()=>{
  const server=createHubServer({service:{},sessions:{},preview:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const root='http://127.0.0.1:'+server.address().port;
    for(const path of ['/advanced-filters.js','/advanced-filters.css']){
      const response=await fetch(root+path);
      assert.equal(response.status,200,path);
      assert.match(response.headers.get('content-security-policy'),/default-src 'self'/);
    }
  }finally{await new Promise(resolve=>server.close(resolve));}
});
