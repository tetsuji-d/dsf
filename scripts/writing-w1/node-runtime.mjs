import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import * as hb from '../writing-w0/node_modules/harfbuzzjs/dist/index.mjs';
import {init as initSubset,subset} from '../writing-w0/subsetter.mjs';
import {init as initEncode,encode} from '../writing-w0/node_modules/woff2-encode-wasm/dist/index.js';
import {createWritingFontEngine} from '../../js/dsf-writing-font-engine.js';
const require=createRequire(import.meta.url),{decompress}=require('../writing-w0/node_modules/wawoff2');
export async function nodeRuntime() {
    await initSubset(await readFile(new URL('../writing-w0/node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm',import.meta.url)));
    await initEncode(await readFile(new URL('../writing-w0/node_modules/woff2-encode-wasm/dist/encoder.wasm',import.meta.url)));
    const catalog=JSON.parse(await readFile(new URL('../../docs/writing-w0-licenses/catalog.json',import.meta.url)));
    const evidence=JSON.parse((await readFile(new URL('../../docs/writing-w1-font-metadata.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''));
    for(const c of catalog)c.nameRecords=evidence.find(f=>f.id===c.id).sourceNames;
    return {catalog,engine:createWritingFontEngine({hb,decode:decompress,encode,subset}),
        getFont:async id=>new Uint8Array(await readFile(new URL(`../../outputs/writing-w0/fonts/${id}.woff2`,import.meta.url))),
        getNotice:async id=>new Uint8Array(await readFile(new URL(`../../docs/writing-w0-licenses/${id}-asset.txt`,import.meta.url)))};
}
