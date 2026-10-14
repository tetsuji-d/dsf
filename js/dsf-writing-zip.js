/** Bounded ZIP32 STORE codec for format 3. WOFF2/WebP are already compressed.
 * No ZIP64, encryption, duplicate names, data descriptors or silent path repair.
 */
import { ensure, validatePath, WRITING_LIMITS } from './dsf-writing-contract.js';
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const table = Array.from({length:256}, (_,n) => { for(let k=0;k<8;k++) n=n&1?0xedb88320^(n>>>1):n>>>1; return n>>>0; });
export function crc32(bytes) { let n=0xffffffff; for(const b of bytes)n=table[(n^b)&255]^(n>>>8); return (n^0xffffffff)>>>0; }
/** Read only ZIP directory names to explain unsupported existing archives.
 * This is not validation or conversion; format 3 still uses the strict reader below.
 */
export function writingArchiveKind(bytes) {
    if(!(bytes instanceof Uint8Array)||bytes.length<22||bytes.length>WRITING_LIMITS.expandedBytes+1024*1024)return 'unknown';
    const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.length);let end=-1;
    for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(v.getUint32(p,true)===0x06054b50&&p+22+v.getUint16(p+20,true)===bytes.length){end=p;break;}
    if(end<0||v.getUint16(end+4,true)||v.getUint16(end+6,true))return 'unknown';
    const count=v.getUint16(end+10,true),start=v.getUint32(end+16,true),size=v.getUint32(end+12,true);
    if(!count||count>WRITING_LIMITS.entries||count!==v.getUint16(end+8,true)||start+size!==end)return 'unknown';
    const names=new Set();let at=start;
    for(let i=0;i<count;i++){
        if(at+46>end||v.getUint32(at,true)!==0x02014b50)return 'unknown';
        const n=v.getUint16(at+28,true),extra=v.getUint16(at+30,true),comment=v.getUint16(at+32,true),next=at+46+n+extra+comment;
        if(!n||n>256||next>end)return 'unknown';
        let name;try{name=decoder.decode(bytes.subarray(at+46,at+46+n));}catch{return 'unknown';}
        if(names.has(name))return 'unknown';names.add(name);at=next;
    }
    if(at!==end)return 'unknown';
    if(names.has('format.json')||names.has('base.json')||[...names].some(n=>n.startsWith('writing/')))return 'writing';
    if(names.has('project.json'))return 'project';
    return names.has('meta.json')&&names.has('content.json')?'existing-dsf':'unknown';
}
function join(parts) { const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){b.set(p,at);at+=p.length;}return b; }
export function writeWritingZip(files) {
    ensure(files.length>0&&files.length<=WRITING_LIMITS.entries,'ZIP_COUNT');
    const local=[],central=[],seen=new Set();let offset=0,total=0;
    for(const {path,bytes} of files) {
        validatePath(path);ensure(!seen.has(path.toLowerCase()),'ZIP_DUPLICATE');seen.add(path.toLowerCase());
        ensure(bytes instanceof Uint8Array,'ZIP_BYTES');total+=bytes.length;ensure(total<=WRITING_LIMITS.expandedBytes,'ZIP_LIMIT');
        const name=encoder.encode(path),crc=crc32(bytes),l=new Uint8Array(30),v=new DataView(l.buffer),c=new Uint8Array(46),w=new DataView(c.buffer);
        v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(10,0,true);v.setUint16(12,33,true);
        v.setUint32(14,crc,true);v.setUint32(18,bytes.length,true);v.setUint32(22,bytes.length,true);v.setUint16(26,name.length,true);
        w.setUint32(0,0x02014b50,true);w.setUint16(4,20,true);w.setUint16(6,20,true);w.setUint16(14,33,true);
        w.setUint32(16,crc,true);w.setUint32(20,bytes.length,true);w.setUint32(24,bytes.length,true);w.setUint16(28,name.length,true);w.setUint32(42,offset,true);
        local.push(l,name,bytes);central.push(c,name);offset+=30+name.length+bytes.length;
    }
    const directory=join(central),end=new Uint8Array(22),v=new DataView(end.buffer);
    v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,directory.length,true);v.setUint32(16,offset,true);
    return join([...local,directory,end]);
}
export function readWritingZip(bytes) {
    ensure(bytes instanceof Uint8Array&&bytes.length>=22&&bytes.length<=WRITING_LIMITS.expandedBytes+1024*1024,'ZIP_LIMIT');
    const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.length),e=bytes.length-22;
    ensure(v.getUint32(e,true)===0x06054b50&&v.getUint16(e+4,true)===0&&v.getUint16(e+6,true)===0&&v.getUint16(e+20,true)===0,'ZIP_END');
    const count=v.getUint16(e+10,true),size=v.getUint32(e+12,true),start=v.getUint32(e+16,true);
    ensure(count>0&&count<=WRITING_LIMITS.entries&&count===v.getUint16(e+8,true)&&start+size===e,'ZIP_DIRECTORY');
    const files=[],seen=new Set();let at=start,local=0,total=0;
    for(let i=0;i<count;i++) {
        ensure(at+46<=e&&v.getUint32(at,true)===0x02014b50,'ZIP_CENTRAL');
        const length=v.getUint16(at+28,true),n=v.getUint32(at+24,true),crc=v.getUint32(at+16,true);
        ensure(at+46+length<=e&&length>0&&length<=256,'ZIP_NAME');
        const path=decoder.decode(bytes.subarray(at+46,at+46+length));validatePath(path);
        ensure(!seen.has(path.toLowerCase()),'ZIP_DUPLICATE');seen.add(path.toLowerCase());
        ensure(v.getUint16(at+6,true)<=20&&v.getUint16(at+8,true)===0&&v.getUint16(at+10,true)===0
            &&v.getUint32(at+20,true)===n&&v.getUint16(at+30,true)===0&&v.getUint16(at+32,true)===0
            &&v.getUint16(at+34,true)===0&&v.getUint32(at+38,true)===0&&v.getUint32(at+42,true)===local,'ZIP_UNSUPPORTED');
        ensure(local+30+length+n<=start&&v.getUint32(local,true)===0x04034b50,'ZIP_LOCAL');
        ensure(v.getUint16(local+4,true)<=20&&v.getUint16(local+6,true)===0&&v.getUint16(local+8,true)===0
            &&v.getUint32(local+14,true)===crc&&v.getUint32(local+18,true)===n&&v.getUint32(local+22,true)===n
            &&v.getUint16(local+26,true)===length&&v.getUint16(local+28,true)===0
            &&decoder.decode(bytes.subarray(local+30,local+30+length))===path,'ZIP_HEADER_MISMATCH');
        total+=n;ensure(total<=WRITING_LIMITS.expandedBytes,'ZIP_LIMIT');
        const payload=bytes.slice(local+30+length,local+30+length+n);ensure(crc32(payload)===crc,'ZIP_CRC');
        files.push({path,bytes:payload});local+=30+length+n;at+=46+length;
    }
    ensure(at===e&&local===start&&files[0].path==='mimetype','ZIP_LAYOUT');return files;
}
