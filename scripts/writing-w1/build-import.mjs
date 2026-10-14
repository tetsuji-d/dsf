import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {readFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);
export async function writingImportNotices(){
    const licenses=[['jszip','LICENSE.markdown'],['pako','LICENSE'],['lie','license.md'],['immediate','LICENSE.txt'],['setimmediate','LICENSE.txt'],['readable-stream','LICENSE']];
    return (await Promise.all(licenses.map(async([name,file])=>`${name}\n${await readFile(join(dirname(require.resolve(name+'/package.json')),file),'utf8')}`))).join('\n\n');
}
export async function buildWritingImport(){
    const result=await build({entryPoints:[fileURLToPath(new URL('./import-v2.mjs',import.meta.url))],bundle:true,format:'esm',platform:'browser',target:'es2022',write:false,legalComments:'inline'});
    const notice=await writingImportNotices();
    return new TextEncoder().encode(`/*! Writing v2 import dependencies\n${notice.replaceAll('*/','* /')}\n*/\n${result.outputFiles[0].text}`);
}
