/* Classic worker only, isolated from all product state. Terminated after run. */
const memories = new Set();
for (const method of ['instantiate','instantiateStreaming']) {
    const original = WebAssembly[method].bind(WebAssembly);
    WebAssembly[method] = async (...args) => {
        const result = await original(...args);
        for (const value of Object.values((result.instance || result).exports || {})) if(value instanceof WebAssembly.Memory) memories.add(value);
        return result;
    };
}
const decoderReady = new Promise(resolve => { self.Module = {onRuntimeInitialized:resolve}; });
importScripts('/assets/vendor/wawoff2/decompress_binding.js');
const decode = async bytes => {await decoderReady;const out=self.Module.decompress(bytes);if(!out)throw new Error('WOFF2_DECODE');return new Uint8Array(out);};
let dependencies;
async function setup() {
    if (!dependencies) dependencies = (async()=>{
        const hb = await import('/assets/vendor/harfbuzzjs/index.mjs');
        const subsetter = await import('/subsetter.mjs');
        const encoder = await import('/assets/vendor/woff2-encode-wasm/index.js');
        await subsetter.init(await (await fetch('/assets/vendor/harfbuzzjs/harfbuzz-subset.wasm')).arrayBuffer());
        await encoder.init(await (await fetch('/assets/vendor/woff2-encode-wasm/encoder.wasm')).arrayBuffer());
        return {hb,subsetter,encoder};
    })();
    return dependencies;
}
function table(bytes, tag) {
    const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const count=v.getUint16(4);
    for(let i=0;i<count;i++) {const o=12+i*16; if(String.fromCharCode(...bytes.slice(o,o+4))===tag) return bytes.slice(v.getUint32(o+8),v.getUint32(o+8)+v.getUint32(o+12));}
    return null;
}
function names(bytes) {
    const b=table(bytes,'name'); if(!b)throw new Error('FONT_NAME_MISSING');const v=new DataView(b.buffer,b.byteOffset,b.byteLength),count=v.getUint16(2),start=v.getUint16(4),result=[];
    for(let i=0;i<count;i++) {const o=6+i*12,platform=v.getUint16(o),id=v.getUint16(o+6),length=v.getUint16(o+8),offset=v.getUint16(o+10),data=b.slice(start+offset,start+offset+length);
        if([0,1,6,13,14,16].includes(id)) result.push({id,value:new TextDecoder(platform===0||platform===3?'utf-16be':'latin1').decode(data)});
    }return result;
}
function faceFor(hb,bytes) { return new hb.Face(new hb.Blob(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength))); }
// HarfBuzz shaping normalizes combining sequences before GSUB. Preserve that
// Unicode closure too, without rewriting the author's stored text.
const subsetOptions=text=>({text:text+text.normalize('NFC')+text.normalize('NFD'),layoutFeatures:'*',passthroughTables:['name']});
function assertCoverage(hb,face,text) {
    const font = new hb.Font(face); let previous;
    for(const ch of text) {
        const c=ch.codePointAt(0); if(c===10||c===13)continue;
        const vs=(c>=0xFE00&&c<=0xFE0F)||(c>=0xE0100&&c<=0xE01EF);
        if(vs ? !previous || !font.glyph(previous,c) : !font.glyph(c)) throw new Error(`FONT_GLYPH_MISSING U+${c.toString(16).toUpperCase()}`);
        previous=c;
    }
}
function shape(hb,face,text,direction,weight) {
    const font=new hb.Font(face); font.setVariations([new hb.Variation('wght',weight)]);
    const buffer=new hb.Buffer(); buffer.addText(text);buffer.guessSegmentProperties();buffer.setLanguage('ja');buffer.setDirection(direction);
    hb.shape(font,buffer,direction===hb.Direction.TTB?[new hb.Feature('vert',1),new hb.Feature('vrt2',1)]:[]);
    const positions=buffer.getGlyphPositions();return buffer.getGlyphInfos().map((g,i)=>({cluster:g.cluster,position:positions[i],outline:font.glyphToPath(g.codepoint)}));
}
onmessage=async({data})=>{
    try {
        const started=performance.now(),{hb,subsetter,encoder}=await setup();
        const {font,sha256,groups,shapeSamples}=data; const digest=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(v=>v.toString(16).padStart(2,'0')).join('');
        if(font.byteLength>16*1024*1024 || await digest(font)!==sha256)throw new Error('FONT_IDENTITY');
        const header=new DataView(font.buffer,font.byteOffset,font.byteLength);
        if(header.getUint32(16)>32*1024*1024)throw new Error('FONT_EXPANSION_LIMIT');
        const sfnt=await decode(font),face=faceFor(hb,sfnt),sourceNames=names(sfnt);
        const results=[];
        for(const [name,text] of Object.entries(groups)) {
            if(text.length>200000)throw new Error('FONT_TEXT_LIMIT');
            assertCoverage(hb,face,text);const t=performance.now();
            const subset=await subsetter.subset(sfnt,subsetOptions(text));
            const woff2=await encoder.encode(subset);const decoded=await decode(woff2);const target=faceFor(hb,decoded);
            assertCoverage(hb,target,text);
            const comparison=[];
            for(const weight of [400,700]) for(const direction of [hb.Direction.LTR,hb.Direction.TTB]) {
                // Glyph inventories are sorted sets, not prose: combining marks must
                // be shaped in their original run context, never against synthetic neighbors.
                const before=shapeSamples[name].flatMap(s=>shape(hb,face,s,direction,weight)),after=shapeSamples[name].flatMap(s=>shape(hb,target,s,direction,weight));
                const same=JSON.stringify(before)===JSON.stringify(after);
                if(!same) {const index=before.findIndex((g,i)=>JSON.stringify(g)!==JSON.stringify(after[i]));
                    const a=before[index],b=after[index];const offset=[...a.outline].findIndex((c,i)=>c!==b?.outline[i]);
                    throw new Error(`SHAPE_MISMATCH ${name} ${weight} ${direction} index=${index} ${JSON.stringify({before:a.position,after:b?.position,offset,pathA:a.outline.slice(offset,offset+80),pathB:b?.outline.slice(offset,offset+80)})}`);}
                comparison.push({weight,direction,equal:true});
            }
            if(JSON.stringify(face.getAxisInfos())!==JSON.stringify(target.getAxisInfos()))throw new Error('VARIATION_AXES_CHANGED');
            if(JSON.stringify(sourceNames)!==JSON.stringify(names(decoded)))throw new Error('FONT_NOTICE_METADATA_CHANGED');
            const again=await encoder.encode(await subsetter.subset(sfnt,subsetOptions(text)));
            if(await digest(again)!==await digest(woff2))throw new Error('SUBSET_NONDETERMINISTIC');
            results.push({name,text,bytes:woff2,byteLength:woff2.length,sha256:await digest(woff2),ms:Math.round(performance.now()-t),comparison,
                cmap:[...target.collectUnicodes()],axes:target.getAxisInfos(),names:names(decoded)});
        }
        let missingRejected=false;try{assertCoverage(hb,face,'\u{10FFFF}');}catch(e){missingRejected=e.message.startsWith('FONT_GLYPH_MISSING');}
        // Re-subset editable bytes without the original, as shared export will.
        const current=results.find(r=>r.name==='current'),history=results.find(r=>r.name==='history');
        let historyPruned=false;
        if(current&&history) {
            const bytes=await encoder.encode(await subsetter.subset(await decode(history.bytes),subsetOptions(current.text)));
            const pruned=faceFor(hb,await decode(bytes));
            historyPruned=JSON.stringify([...pruned.collectUnicodes()])===JSON.stringify(current.cmap);
            for(const weight of [400,700]) for(const direction of [hb.Direction.LTR,hb.Direction.TTB]) {
                for(const s of shapeSamples.current) if(JSON.stringify(shape(hb,face,s,direction,weight))!==JSON.stringify(shape(hb,pruned,s,direction,weight)))throw new Error('RESHARE_SHAPE_MISMATCH');
            }
            if(!historyPruned)throw new Error('HISTORY_GLYPHS_LEAK');
        }
        postMessage({ok:true,results,sourceNames,missingRejected,historyPruned,ms:Math.round(performance.now()-started),
            wasmLinearBytes:[...memories].reduce((n,m)=>n+m.buffer.byteLength,0),
            measurement:'live WASM linear memory after processing, not process peak or JS heap'});
    }catch(e){postMessage({ok:false,error:e.stack||String(e)});}
};
