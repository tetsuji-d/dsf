const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {deflateSync} = require('node:zlib');
const crc32 = require('jszip/lib/crc32');
const JSZip = require('jszip');
const repo = path.resolve(__dirname, '..');
const root = path.join(repo, 'outputs/windows-preview');
const run = fs.mkdtempSync(path.join(root, 'verification-'));
const exe = path.join(root, 'dsf-thumbnail-check.exe');
const dll = path.join(root, 'DsfThumbnail.dll');
const png = fs.readFileSync(path.join(repo, 'public/file-icons/dsf-256.png'));
// Synthetic 90x160 blue cover with two white lines; no user data.
const webp = Buffer.from('UklGRugCAABXRUJQVlA4WAoAAAAgAAAAWQAAnwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDgg+gAAAJAKAJ0BKloAoAA+bTaWR6QjIiEonPgAgA2JZ27dXxiAH6AXNVd2bRAI4A/AC6AAvDv/Ywj0qCy33PU/Al98gJeEIqWCjM7thUAgPYACtfuHZnxKYACtfuHZnxKXmAD+9L/H/+Ic/rb/uU2Kf/G/1a+TK6Bb+a4YThJeAoKq/xU84vK/IHKLXmB0CcHeoH+guvkEOzm7YT71YfpqLe0E3/sgA/2wF3VEvzQMhoy9d7ebuG7SBahoy/lIi/V+eo+WuCM894lOas/5Se1OlAGh5nHAT2gm/9kALN+/94X7nfnww3txi3H15HDi4f47D2o9xAiAAAAAAAAAAAA=', 'base64');
const hash = b => createHash('sha256').update(b).digest('hex');
const report = [];
function base(image = png, ref = 'assets/cover.png') {
  return {mimetype:'application/vnd.dsf.content+zip', 'meta.json':JSON.stringify({defaultLang:'ja'}),
    'content.json':JSON.stringify({pages:[{content:{background:ref}}]}), [ref]:image};
}
async function archive(entries) {
  const zip = new JSZip();
  for (const [name, bytes] of Object.entries(entries)) zip.file(name, bytes, {createFolders:false});
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
async function check(name, entries, expected, com = false) {
  const bytes = Buffer.isBuffer(entries) ? entries : await archive(entries);
  const input = path.join(run, name + '.dsf');
  const output = path.join(run, name + '.png');
  fs.writeFileSync(input, bytes);
  const result = spawnSync(exe, [input, output, ...(com ? [dll] : [])], {encoding:'utf8',timeout:15000,windowsHide:true});
  assert.ifError(result.error);
  assert.equal(hash(fs.readFileSync(input)), hash(bytes), 'Source must remain unchanged');
  if (expected === 'ok') {
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    assert.equal(fs.readFileSync(output).subarray(1,4).toString(), 'PNG');
  } else {
    assert.equal(result.status, 1, `${name}: should reject`);
    assert.match(result.stderr, new RegExp(expected), name);
    assert.equal(fs.existsSync(output), false, name + ': no misleading output');
  }
  report.push({name,passed:true,com});
}
function v2(image = png, kind = 'image') {
  const ref = 'content/language-0001.json';
  const language = JSON.stringify({schemaVersion:1,language:'ja',pages:[{renderKind:kind,image:{href:'../assets/cover.png'}}]});
  const entries = {mimetype:'application/vnd.dsf.content+zip', 'meta.json':JSON.stringify({defaultLang:'ja'}),
    'content.json':JSON.stringify({schemaVersion:2,layoutModel:'fixed-page-hybrid-1',defaultLang:'ja',languages:{ja:{href:ref,sha256:hash(language)}}}),
    [ref]:language,'assets/cover.png':image};
  entries['manifest.json'] = JSON.stringify({format:'dsf-archive-manifest-1',schemaVersion:1,
    files:Object.entries(entries).map(([name,bytes])=>({path:name,byteLength:Buffer.byteLength(bytes),sha256:hash(bytes)}))});
  return entries;
}
function dsp() {
  const chunk=(type,data)=>{const name=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data]))>>>0);return Buffer.concat([size,name,data,crc]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(360);header.writeUInt32BE(640,4);header[8]=8;header[9]=6;
  const raw=Buffer.alloc((360*4+1)*640);
  for(let y=0;y<640;y++)for(let x=0;x<360;x++){const o=y*(360*4+1)+1+x*4;raw[o]=30;raw[o+1]=65;raw[o+2]=120;raw[o+3]=255;}
  const cover=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
  const project=JSON.stringify({version:5,defaultLang:'ja'});
  return {mimetype:'application/vnd.dsf.project+zip','project.json':project,'preview/cover.png':cover,
    'preview/cover.json':JSON.stringify({schemaVersion:1,language:'ja',width:360,height:640,sourceSha256:hash(project),imageSha256:hash(cover)})};
}
(async()=>{
  await check('v1-png',base(),'ok');
  await check('v1-webp',base(webp,'assets/cover.webp'),'ok');
  await check('v1-com',base(),'ok',true);
  await check('v2-png',v2(),'ok');
  await check('v2-webp',v2(webp),'ok');
  await check('dsp-snapshot',dsp(),'ok');
  await check('dsp-snapshot-com',dsp(),'ok',true);
  const changedSource=dsp();changedSource['project.json']=JSON.stringify({version:5,defaultLang:'ja',title:'changed'});
  await check('dsp-stale-source',changedSource,'DSP_PREVIEW_HASH_MISMATCH');
  const changedImage=dsp();changedImage['preview/cover.png']=png;
  await check('dsp-changed-image',changedImage,'DSP_PREVIEW_HASH_MISMATCH');
  const changedLanguage=dsp();const info=JSON.parse(changedLanguage['preview/cover.json']);info.language='en';changedLanguage['preview/cover.json']=JSON.stringify(info);
  await check('dsp-wrong-language',changedLanguage,'DSP_PREVIEW_METADATA_INVALID');
  const explicit=base();
  explicit['content.json']=JSON.stringify({book:{covers:{c1:{pageIndex:1}}},pages:[{content:{background:'assets/missing.png'}},{content:{background:'assets/cover.png'}}]});
  await check('explicit-c1',explicit,'ok');
  const cases = [
    ['traversal',{...base(),'../escape.png':png},'ZIP_PATH_INVALID'],
    ['case-collision',{...base(),'ASSETS/COVER.PNG':png},'ZIP_DUPLICATE_PATH'],
    ['external',base(png,'https://example.com/a.png'),'ZIP_PATH_INVALID'],
    ['duplicate-json',{...base(),'meta.json':'{"defaultLang":"ja","defaultLang":"en"}'},'JSON_DUPLICATE_KEY'],
    ['json-depth',{...base(),'meta.json':'{"x":'+ '['.repeat(70)+'0'+']'.repeat(70)+'}'},'JSON_DEPTH_LIMIT'],
    ['json-large',{...base(),'meta.json':' '.repeat(9*1024*1024)},'ENTRY_SIZE_LIMIT'],
    ['missing-cover',{...base(),'content.json':JSON.stringify({pages:[{content:{background:'assets/missing.png'}}]})},'ASSET_MISSING_OR_UNSAFE'],
    ['no-language-fallback',{...base(),'content.json':JSON.stringify({dsfPages:[{urls:{en:'assets/cover.png'}}]})},'IMAGE_PATH_INVALID'],
    ['dsp-not-raw',{...base(),mimetype:'application/vnd.dsf.project+zip'},'DSP_SNAPSHOT_REQUIRED'],
    ['fixed-text-cover',v2(png,'fixedText'),'FIXED_TEXT_COVER_UNSUPPORTED'],
    ['image-limit',base(Buffer.alloc(33*1024*1024)),'ENTRY_SIZE_LIMIT'],
    ['not-zip',Buffer.from('not an archive'),'ARCHIVE_SIZE_LIMIT'],
    ['broken-image',base(Buffer.from('not an image')),'IMAGE_DECODE_OR_CODEC_UNAVAILABLE'],
    ['future-schema',{...base(),'content.json':'{"schemaVersion":99}'},'SCHEMA_UNSUPPORTED'],
  ];
  for (const args of cases) await check(...args);
  const altered=v2(); altered['assets/cover.png']=Buffer.from(png); altered['assets/cover.png'][40]^=1;
  await check('hash-mismatch',altered,'MANIFEST_HASH_MISMATCH');
  const truncated=(await archive(base())).subarray(0,60);
  await check('truncated',truncated,'ZIP_DIRECTORY_INVALID');
  const source=fs.readFileSync(path.join(run,'v1-png.png'));
  assert.equal(hash(source), hash(fs.readFileSync(path.join(run,'v1-com.png'))), 'Real COM provider should render identical pixels');
  fs.writeFileSync(path.join(root,'verification.json'),JSON.stringify({run,tests:report},null,2));
  console.log(JSON.stringify({passed:report.length,run}));
})().catch(error=>{console.error(error);process.exitCode=1;});
