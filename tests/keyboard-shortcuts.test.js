import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHubServer } from '../src/runtime/server.js';
import { isTypingTarget, shortcutAction } from '../public-hub/shortcuts.js';

const event = (key, extra = {}) => ({key, shiftKey:false, altKey:false, ctrlKey:false, metaKey:false, isComposing:false, defaultPrevented:false, target:null, ...extra});

test('keyboard search/help shortcuts ignore editable fields and modifier chords', () => {
  assert.equal(shortcutAction(event('/')), 'search');
  assert.equal(shortcutAction(event('?', {shiftKey:true})), 'help');
  assert.equal(shortcutAction(event('/', {ctrlKey:true})), null);
  assert.equal(shortcutAction(event('/', {altKey:true})), null);
  assert.equal(shortcutAction(event('/', {isComposing:true})), null);
  assert.equal(shortcutAction(event('/', {defaultPrevented:true})), null);
  assert.equal(shortcutAction(event('/', {target:{closest:selector => selector.includes('input') ? {} : null}})), null);
  assert.equal(shortcutAction(event('a')), null);
  assert.equal(isTypingTarget(null), false);
  assert.equal(isTypingTarget({closest:()=>null}), false);
  assert.equal(isTypingTarget({closest:()=>({})}), true);
});

test('keyboard help is discoverable, dismissible, and loaded by hub page', () => {
  const html=readFileSync(new URL('../public-hub/index.html',import.meta.url),'utf8');
  const js=readFileSync(new URL('../public-hub/shortcuts.js',import.meta.url),'utf8');
  assert.match(html,/\/shortcuts\.js/);
  assert.match(html,/\/shortcuts\.css/);
  assert.match(js,/aria-labelledby/);
  assert.match(js,/aria-label.*Close keyboard shortcuts/);
  assert.match(js,/help\.addEventListener\('close'/);
  assert.match(js,/MutationObserver/);
});

test('shortcut assets load through same-origin server with strict CSP', async () => {
  const server=createHubServer({service:{},sessions:{},preview:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const root='http://127.0.0.1:'+server.address().port;
    for(const path of ['/shortcuts.js','/shortcuts.css']) {
      const result=await fetch(root+path);
      assert.equal(result.status,200,path);
      assert.match(result.headers.get('content-security-policy'),/script-src 'self'/);
      assert.match(await result.text(),/keyboard/i);
    }
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
