// Real workerd + local R2; no Cloudflare/Firebase credentials or remote access.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url), wranglerRequire=createRequire(require.resolve('wrangler'));
const {Miniflare}=wranglerRequire('miniflare'), {buildSync}=wranglerRequire('esbuild');
const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE);
const bundle=buildSync({entryPoints:[fileURLToPath(new URL('./fixtures/publishing-spaces-worker.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'}).outputFiles[0].text;
const runtime=new Miniflare({modules:true,script:bundle,compatibilityDate:'2024-09-01',r2Buckets:['AUTHORING_BUCKET']});
let browser;
try {
    browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
    const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=256;c.getContext('2d').fillRect(0,0,256,256);return c.toDataURL('image/webp');});
    const request=async body=>runtime.dispatchFetch('https://studio.test/api/publishing-spaces',{method:body?'POST':'GET',headers:{Authorization:'Bearer fixture-owner','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const spaceId='space_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    assert.equal((await request({kind:'create',spaceId,name:'R2接続確認',baseRevision:0})).status,200);
    const command={kind:'profile',spaceId,name:'R2接続確認',baseRevision:1,profile:{description:'日本語の概要',website:'',icon:image}};
    const saved=await request(command);assert.equal(saved.status,200,await saved.clone().text());
    const data=await saved.json(), hash=data.spaces[0].profile.icon;
    const bucket=await runtime.getR2Bucket('AUTHORING_BUCKET');
    const key='publishing-spaces/owner_1/'+spaceId+'/'+hash+'.webp';
    const object=await bucket.get(key);assert.equal(object.httpMetadata.contentType,'image/webp');
    assert.equal(JSON.stringify(data).includes('data:image'),false);
    const read=await request({kind:'readImage',spaceId,slot:'icon'});assert.equal(read.status,200);
    assert.equal((await read.json()).dataUrl,image);
    assert.equal((await (await request(command)).json()).revision,2,'exact retry is idempotent');
    await bucket.put(key,'corrupt');const corrupted=await request({kind:'readImage',spaceId,slot:'icon'});
    assert.equal(corrupted.status,503);
    assert.equal((await (await request()).json()).revision,2,'failed media read does not mutate profile');
    const config=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8');
    assert.match(config.split('[env.preview.vars]')[0],/PUBLISHING_SPACES_ENABLED = "false"/);
    assert.match(config.split('[env.preview.vars]')[1],/PUBLISHING_SPACES_ENABLED = "true"/);
    console.log('Local Workers + real R2 binding + Firestore serialization: profile/image save, restore, retry and corruption detection passed; staging-only enablement checked.');
} finally {await browser?.close();await runtime.dispose();}
