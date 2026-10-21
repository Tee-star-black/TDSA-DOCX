import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHubServer} from '../src/runtime/server.js';

const file = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('redesigned interface keeps its enhancements separate from document authorization', () => {
  const theme=file('../public-hub/experience.css');
  const enhancements=file('../public-hub/experience.js');
  const shell=file('../public-hub/index.html');
  assert.match(shell, /href="\/experience\.css"/);
  assert.match(shell, /src="\/experience\.js"/);
  assert.match(theme, /data-experience-view="grid"/);
  assert.match(theme, /@media\(max-width:600px\)/);
  assert.match(enhancements, /Sort visible documents/);
  assert.match(enhancements, /aria-pressed/);
  assert.match(enhancements, /MutationObserver/);
});

test('new design assets are served by the existing same-origin preview server', async () => {
  const server=createHubServer({service:{},sessions:{},preview:true});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    const origin=`http://127.0.0.1:${server.address().port}`;
    for (const [resource,type,needle] of [
      ['/experience.css','text/css','--accent'],
      ['/experience.js','text/javascript','enhanceLibrary'],
      ['/','text/html','experience.css'],
    ]) {
      const response=await fetch(origin+resource);
      assert.equal(response.status,200,resource);
      assert.match(response.headers.get('content-type'),new RegExp(type),resource);
      assert.match(response.headers.get('content-security-policy'),/default-src 'self'/);
      assert.match(await response.text(),new RegExp(needle),resource);
    }
  } finally {
    await new Promise(resolve=>server.close(resolve));
  }
});
