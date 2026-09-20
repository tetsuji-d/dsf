/** Explicitly scoped production migration. Never imported by Pages routes. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {initializeApp,cert,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {createGoogleClient} from '../server/private-authoring/google-auth.js';
import {createFirestoreStore} from '../server/private-authoring/firestore.js';
import {createAuthoringMaintenance} from '../server/private-authoring/maintenance.js';
import {createMaintenanceBackupStore} from '../server/private-authoring/maintenance-common.js';
import {createAuthoringBucket} from '../server/private-authoring/r2.js';
export const firebaseProject='vmnn-26345';
export const ownerUid='K53KsYUmTjOT0IhDEkPxPBWkUx72';
export const projectIds=Object.freeze(['R2に移行','テスト１']);
export function scopeFor(projectId){assert(projectIds.includes(projectId),'Project outside approved production inventory');return {uid:ownerUid,projectId,generationId:'prod_20260920_1'};}
export function credential(){const value=JSON.parse(fs.readFileSync(new URL('../secrets/authoring-production.service-account.json',import.meta.url),'utf8'));assert.equal(value.project_id,firebaseProject);assert.equal(value.client_email,`dsf-authoring-production@${firebaseProject}.iam.gserviceaccount.com`);return value;}
export async function operator(){
 const app=initializeApp({projectId:firebaseProject,credential:cert(credential())},`authoring-production-${Date.now()}`);
 return {db:getFirestore(app),customToken:()=>getAuth(app).createCustomToken(ownerUid),close:()=>deleteApp(app)};
}
export async function maintenance(op){
 const entry=process.env.DSF_AUTHORING_WRANGLER_ENTRY;assert(entry,'Explicit tested Wrangler 4 entry required');
 const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',pathToFileURL(entry)),'utf8'));assert.equal(pkg.name,'wrangler');assert.equal(pkg.version,'4.135.0');
 const {getPlatformProxy}=await import(pathToFileURL(entry).href);
 const proxy=await getPlatformProxy({configPath:fileURLToPath(new URL('../secrets/authoring-remote-production.toml',import.meta.url)),persist:false,remoteBindings:true});
 const db=createFirestoreStore(createGoogleClient({projectId:firebaseProject,serviceAccountJson:JSON.stringify(credential())}));
 const bucket=createAuthoringBucket(proxy.env.AUTHORING_BUCKET);
 const authorize=async scope=>{assert.deepEqual(scope,scopeFor(scope.projectId));const account=(await op.db.doc(`users/${ownerUid}`).get()).data();assert.equal(account?.uid,ownerUid);assert.equal(account.status?.disabled,false);};
 return {api:createAuthoringMaintenance({db,bucket,backups:createMaintenanceBackupStore(proxy.env.AUTHORING_BUCKET),authorize}),bucket,rawBucket:proxy.env.AUTHORING_BUCKET,dispose:()=>proxy.dispose()};
}
async function main(){
 assert.equal(process.env.DSF_RUN_PRODUCTION_AUTHORING,'1','Explicit production opt-in required');
 const [mode,projectId,planHash]=process.argv.slice(2),scope=scopeFor(projectId);assert(['inspect','migrate','inspect-rollback','rollback','status'].includes(mode));
 const op=await operator();let m;
 try{
  const r=`users/${ownerUid}/projects/${projectId}`;
  if(mode==='status'){const rows=await op.db.getAll(...[r,`${r}/authoringHeads/current`,`${r}/authoringControl/current`].map(p=>op.db.doc(p)));console.log(JSON.stringify({projectId,version:rows[0].data()?.version,backend:rows[0].data()?.authoringBackend||'firestore',status:rows[2].data()?.status||'legacy',revision:rows[1].data()?.revision||null,releaseId:rows[0].data()?.releaseId}));return;}
  m=await maintenance(op);
  if(mode==='inspect')console.log(JSON.stringify(await m.api.inspectMigration(scope)));
  else if(mode==='inspect-rollback')console.log(JSON.stringify(await m.api.inspectRollback(scope,'prod_rollback_1')));
  else{assert.match(planHash||'',/^[a-f0-9]{64}$/,'Use the inspected plan hash');console.log(JSON.stringify(mode==='migrate'?await m.api.migrate(scope,planHash):await m.api.rollback(scope,'prod_rollback_1',planHash)));}
 }finally{await m?.dispose();await op.close();}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])main().then(()=>process.exit(0)).catch(e=>{console.error(e.code||e.message);process.exit(1)});
