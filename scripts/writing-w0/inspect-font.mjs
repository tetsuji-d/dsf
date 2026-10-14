// Diagnostic reproducer for the REJECTED hb-subset-wasm 0.4.0 build (zero vertical advances).
// probe.ttf / probe.woff2 are deliberately not the chosen engine's output.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { init, subset } from 'hb-subset-wasm';
import { init as initEncoder, encode } from 'woff2-encode-wasm';
import { SAMPLE_TEXT } from './fixtures.mjs';
const require=createRequire(import.meta.url),{decompress}=require('wawoff2');
await init(await readFile(new URL('node_modules/hb-subset-wasm/dist/hb-subset.wasm',import.meta.url)));
await initEncoder(await readFile(new URL('node_modules/woff2-encode-wasm/dist/encoder.wasm',import.meta.url)));
const root=new URL('../../outputs/writing-w0/',import.meta.url);
const bytes=await readFile(new URL('fonts/noto-sans-jp-2.004-h2.woff2',root));
const sfnt=await decompress(bytes),text=SAMPLE_TEXT+' か\u3099';
const output=await subset(sfnt,{text:text+text.normalize('NFC')+text.normalize('NFD'),layoutFeatures:'*',passthroughTables:['name']});
await mkdir(new URL('results/',root),{recursive:true});
await writeFile(new URL('results/probe.ttf',root),output);await writeFile(new URL('results/probe.woff2',root),await encode(output));
console.log({source:sfnt.length,subset:output.length});
