// Run after writing-w0/prepare.mjs. Only synthetic sample/build inputs are written.
import {mkdir,writeFile} from 'node:fs/promises';
import {nodeRuntime} from './node-runtime.mjs';
const out=new URL('../../outputs/writing-w1/',import.meta.url);
await mkdir(out,{recursive:true});
const {catalog}=await nodeRuntime();
await writeFile(new URL('catalog.json',out),JSON.stringify(catalog,null,2)+'\n');
await import('./build-preview-sample.mjs');
