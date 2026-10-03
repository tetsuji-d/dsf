const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../outputs/windows-preview');
const fixtures=JSON.parse(fs.readFileSync(path.join(root,'verification.json'),'utf8'));
const dll=path.join(root,'DsfCoverPreview.dll');
const exe=path.join(root,'dsf-preview-check.exe');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const cases=[
  ['v1-png','DSF · 作品の表紙'],['v1-webp','DSF · 作品の表紙'],['v2-webp','DSF · 作品の表紙'],
  ['explicit-c1','DSF · 作品の表紙'],['dsp-snapshot','DSP · 原稿の表紙'],
  ['dsp-not-raw','このDSPには確認用の表紙画像がありません'],
  ['fixed-text-cover','この形式の表紙は、まだプレビューに対応していません'],
  ['dsp-stale-source','表紙を表示できません'],['hash-mismatch','表紙を表示できません'],
  ['external','表紙を表示できません'],['truncated','表紙を表示できません'],
  ['broken-image','表紙を表示できません'],['image-limit','表紙を表示できません']
];
const tests=[];
for(const [name,caption] of cases){
  const file=path.join(fixtures.run,name+'.dsf');
  const before=hash(fs.readFileSync(file));
  const result=spawnSync(exe,[dll,file,'--check'],{encoding:'utf8',timeout:15000,windowsHide:true});
  assert.ifError(result.error);
  assert.equal(result.status,0,name+': '+result.stderr);
  assert.ok(result.stdout.includes(caption),name+': '+result.stdout);
  assert.ok(result.stdout.includes('PREVIEW_LIFECYCLE_OK'),name);
  assert.equal(hash(fs.readFileSync(file)),before,'Original must not change');
  tests.push({name,caption,passed:true});
}
fs.writeFileSync(path.join(root,'cover-pane-verification.json'),JSON.stringify({dllSha256:hash(fs.readFileSync(dll)),tests},null,2));
console.log(JSON.stringify({passed:tests.length,checks:'COM lifecycle, resize, unsupported messages, file unlock, original hashes, unload'}));
