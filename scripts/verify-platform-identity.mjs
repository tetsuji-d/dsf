import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {platformManifest} from './studio-pwa-plugin.js';
import {isPlatformShortcut,launchDestination} from '../js/platform-launch.js';
const source=JSON.parse(readFileSync('public/studio.webmanifest','utf8'));
for(const [mode,name] of [['production','Horizon'],['staging','Horizon（検証版）'],['development','Horizon（ローカル開発）']]){
 const m=platformManifest(mode,source);assert.equal(m.name,name);assert.equal(m.short_name,name);
 assert.equal(m.id,'/studio');assert.equal(m.scope,'/');assert.equal(m.start_url,'/?source=pwa');assert.equal(m.launch_handler.client_mode,'focus-existing');
}
const current='https://example.test/studio?room=editor';
assert.equal(isPlatformShortcut('/?source=pwa',current),true);
for(const u of ['/?source=pwa&work=one','/?source=pwa#one','https://outside.test/?source=pwa','/viewer?source=pwa','/'])assert.equal(isPlatformShortcut(u,current),false,u);
assert.equal(launchDestination('/viewer?work=one',current),'https://example.test/viewer?work=one');
for(const p of ['index.html','studio.html','viewer.html','mypage.html'])assert.ok(readFileSync(p,'utf8').includes('rel="manifest" href="/studio.webmanifest"'),p);
console.log('PASS shared app identity, environment labels, homepage shortcut and explicit links.');
