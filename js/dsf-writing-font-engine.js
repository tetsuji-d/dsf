/** Trusted WASM bindings are supplied by the host (Worker in browsers).
 * Verifies embedded subsets without fetching the original full font.
 */
import {ensure,sha256,WRITING_LIMITS} from './dsf-writing-contract.js';
export function fontCharacterSet(text) {
    return [...new Set([...text,...text.normalize('NFC'),...text.normalize('NFD')].filter(c=>c!=='\n'&&c!=='\r'))].sort((a,b)=>a.codePointAt(0)-b.codePointAt(0)).join('');
}
export const fontTextDigest = text => sha256(new TextEncoder().encode(fontCharacterSet(text)));
function fontNames(bytes) {
    const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.length);let b;
    for(let i=0;i<v.getUint16(4);i++){const p=12+i*16;if(String.fromCharCode(...bytes.slice(p,p+4))==='name')b=bytes.slice(v.getUint32(p+8),v.getUint32(p+8)+v.getUint32(p+12));}
    ensure(b,'FONT_NAMES');const d=new DataView(b.buffer,b.byteOffset,b.length),out=[];
    for(let i=0;i<d.getUint16(2);i++){const p=6+i*12,id=d.getUint16(p+6),platform=d.getUint16(p),at=d.getUint16(4)+d.getUint16(p+10);
        if([0,1,6,13,14,16].includes(id))out.push({id,value:new TextDecoder(platform===0||platform===3?'utf-16be':'latin1').decode(b.slice(at,at+d.getUint16(p+8)))});}
    return out;
}
export function createWritingFontEngine({hb,decode,encode,subset}) {
    // Bounded, in-memory caches. Keys include the actual bytes and trust metadata.
    const opened=new Map(),verified=new Map(),derived=new Map();
    const remember=(map,key,value,limit)=>{map.delete(key);map.set(key,value);while(map.size>limit)map.delete(map.keys().next().value);return value;};
    const identity=async(bytes,text,source,exact)=>JSON.stringify([await sha256(bytes),text,source.nameRecords,exact]);
    async function open(bytes) {
        ensure(bytes instanceof Uint8Array&&bytes.length>=48&&bytes.length<=WRITING_LIMITS.fontBytes,'FONT_BYTES');
        const h=new DataView(bytes.buffer,bytes.byteOffset,bytes.length);
        ensure(h.getUint32(0)===0x774f4632&&h.getUint32(8)===bytes.length&&h.getUint32(16)<=WRITING_LIMITS.sfntBytes,'FONT_HEADER');
        const key=await sha256(bytes);if(opened.has(key))return opened.get(key);
        const sfnt=new Uint8Array(await decode(bytes));ensure(sfnt.length===h.getUint32(16),'FONT_EXPANDED_SIZE');
        const value={sfnt,face:new hb.Face(new hb.Blob(sfnt.buffer.slice(sfnt.byteOffset,sfnt.byteOffset+sfnt.byteLength)))};
        // At most two input/subset faces; large fonts are not retained.
        if(sfnt.byteLength<=16*1024*1024)remember(opened,key,value,2);
        return value;
    }
    async function verifyUncached(bytes,text,source,exact=true) {
        const {sfnt,face}=await open(bytes),characters=fontCharacterSet(text),wanted=new Set([...characters].map(c=>c.codePointAt(0))),font=new hb.Font(face);
        for(const c of wanted)ensure(font.glyph(c),'FONT_GLYPH_MISSING');
        if(exact) {
            // HarfBuzz may add required mirrored characters/layout closure.
            // Re-subset the embedded font itself; no full-font fetch is needed.
            const reduced=new Uint8Array(await subset(sfnt,{text:characters}));
            const allowed=new hb.Face(new hb.Blob(reduced.buffer.slice(reduced.byteOffset,reduced.byteOffset+reduced.byteLength)));
            ensure(JSON.stringify([...face.collectUnicodes()])===JSON.stringify([...allowed.collectUnicodes()]),'FONT_UNUSED_GLYPHS');
        }
        ensure(JSON.stringify(fontNames(sfnt))===JSON.stringify(source.nameRecords),'FONT_NAMES_CHANGED');
        return {valid:true,codepoints:[...face.collectUnicodes()]};
    }
    async function deriveUncached(bytes,text,source) {
        await verify(bytes,text,source,false);const {sfnt,face}=await open(bytes);
        const result=new Uint8Array(await encode(await subset(sfnt,{text:fontCharacterSet(text)})));
        await verify(result,text,source,true);const target=(await open(result)).face;
        // Compare actual run context in both orientations/weights; caller passes
        // newlines between runs so unrelated combining sequences are not joined.
        const shape=(f,s,dir,weight)=>{const font=new hb.Font(f);font.setVariations([new hb.Variation('wght',weight)]);
            const b=new hb.Buffer();b.addText(s);b.guessSegmentProperties();b.setLanguage('ja');b.setDirection(dir);hb.shape(font,b,dir===hb.Direction.TTB?[new hb.Feature('vert',1),new hb.Feature('vrt2',1)]:[]);
            const p=b.getGlyphPositions();return b.getGlyphInfos().map((g,i)=>({cluster:g.cluster,position:p[i],path:font.glyphToPath(g.codepoint)}));};
        for(const s of text.split(/\r?\n/))if(s)for(const weight of [400,700])for(const dir of [hb.Direction.LTR,hb.Direction.TTB])
            ensure(JSON.stringify(shape(face,s,dir,weight))===JSON.stringify(shape(target,s,dir,weight)),'FONT_SHAPE_CHANGED');
        ensure(JSON.stringify(face.getAxisInfos())===JSON.stringify(target.getAxisInfos()),'FONT_AXES_CHANGED');return result;
    }
    async function verify(bytes,text,source,exact=true) {
        // Own input while hashing asynchronously; callers cannot poison cache keys.
        bytes=bytes.slice();source={...source,nameRecords:structuredClone(source.nameRecords)};
        const key=await identity(bytes,fontCharacterSet(text),source,exact);
        if(verified.has(key))return structuredClone(verified.get(key));
        const result=await verifyUncached(bytes,text,source,exact);
        remember(verified,key,result,32);return structuredClone(result);
    }
    async function derive(bytes,text,source) {
        bytes=bytes.slice();source={...source,nameRecords:structuredClone(source.nameRecords)};
        // Full run text matters for shaping validation, not just its character set.
        const key=await identity(bytes,text,source,true);
        if(derived.has(key))return derived.get(key).slice();
        const result=await deriveUncached(bytes,text,source);
        if(result.byteLength<=512*1024)remember(derived,key,result.slice(),8);
        return result;
    }
    return {verify,derive};
}
