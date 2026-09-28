import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {syncAuthSaveStatus} from '../js/studio-auth-save-status.js';
const el={dataset:{},style:{},textContent:''};
syncAuthSaveStatus(el);assert.equal(el.textContent,'ログインでクラウド保存');
syncAuthSaveStatus(el,{uid:'alice'});assert.match(el.textContent,/ログイン済み/);assert.equal(el.dataset.saveStatus,'idle');assert.equal(el.dataset.saveTarget,'');
syncAuthSaveStatus(el,{uid:'alice',en:true});assert.match(el.textContent,/Signed in/);
for(const phase of ['saving','saved','error']){
 delete el.dataset.authNotice;el.dataset.saveStatus=phase;el.dataset.saveTarget='Cloud';el.textContent=phase;
 syncAuthSaveStatus(el,{uid:'alice'});assert.equal(el.textContent,phase);
}
syncAuthSaveStatus(el,{uid:'bob'});assert.equal(el.dataset.saveStatus,'idle');assert.equal(el.dataset.saveTarget,'');
delete el.dataset.authNotice;el.dataset.saveStatus='saved';el.dataset.saveTarget='Cloud';el.textContent='saved';
syncAuthSaveStatus(el);assert.equal(el.textContent,'ログインでクラウド保存');assert.equal(el.dataset.saveTarget,'');
el.dataset={};el.textContent='Sign in to save to cloud';syncAuthSaveStatus(el,{uid:'alice'});assert.match(el.textContent,/ログイン済み/);
const app=readFileSync('js/app.js','utf8');assert.match(app,/syncAuthSaveStatus\(saveStatus/);
console.log('PASS auth guidance: guest to login, account switch, logout, language, preserve saving/success/failure');
