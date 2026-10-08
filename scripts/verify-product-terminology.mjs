import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STRINGS} from '../js/i18n-studio.js';
import {localizePrintTemplate} from '../js/editor-print-i18n.js';
import {buildPublicViewerUrl} from '../js/viewer-release-route.js';
import {buildOwnerDraftViewerUrl} from '../js/viewer-owner-preview.js';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
assert.equal(STRINGS.ja.nav_works,'リーズ');assert.equal(STRINGS.en.nav_works,'Reads');
assert.equal(STRINGS.ja.label_work_title,'リードタイトル');
for(const [locale,strings]of Object.entries(STRINGS))for(const [key,value]of Object.entries(strings)){
 assert.ok(!/\bViewer\b|ビューワ|ビューア/.test(value),`${locale}:${key}: legacy product name`);
 if(locale==='ja')assert.ok(!/作品|\bReads?\b/.test(value),`${key}: Japanese product terminology`);
}
assert.equal(STRINGS.en.text_paper_book,'Book Paper','Real paper/binding terminology is retained');
assert.match(STRINGS.en.press_readiness_order,/Content/,'Page payload is still content');
const template=read('js/editor-print-template.html');
assert.ok(!localizePrintTemplate(template,false).includes('作品'));
assert.ok(!localizePrintTemplate(template,true).includes('作品'),'Print lookup keys still match');
assert.match(localizePrintTemplate(template,true),/Booklet/);
assert.equal(buildPublicViewerUrl('https://dsf.ink','work_1','release-1'),'https://dsf.ink/viewer?work=work_1&r=release-1');
assert.equal(buildOwnerDraftViewerUrl('https://dsf.ink','project_1','release-1'),'https://dsf.ink/viewer?draft=project_1&r=release-1');
assert.match(read('js/editor-viewer-preview.js'),/window\.open\("\/viewer\.html\?editorPreview="/);
assert.match(read('js/portal.js'),/\/viewer\.html\?work=/);
const manifest=JSON.parse(read('public/studio.webmanifest'));
assert.equal(manifest.id,'/studio','Keep the installed app identity stable');assert.equal(manifest.name,'Horizon');assert.equal(manifest.start_url,'/?source=pwa');
assert.match(read('viewer.html'),/<title>DSF Reader<\/title>/);
assert.match(read('js/platform-menu.js'),/リード（Read）/);assert.match(read('js/platform-menu.js'),/A Read is one item/);
assert.match(read('js/platform-menu.js'),/\['viewer','\/viewer','auto_stories'\]/);
console.log('PASS: JA/EN terminology, print translation, real Book/Content meanings, legacy routes and PWA identity.');
