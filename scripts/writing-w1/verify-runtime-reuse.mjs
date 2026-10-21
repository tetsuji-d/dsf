import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=(await readFile(new URL('./reader-runtime.mjs',import.meta.url),'utf8')).replace(/from '\/js\/([^']+)'/g,(_,name)=>`from '${new URL('../../js/'+name,import.meta.url).href}'`);
const originals=Object.fromEntries(['Worker','fetch','setTimeout','clearTimeout','window'].map(k=>[k,globalThis[k]]));
const timers=new Map(),workers=[],events={};let next=0;
class FakeWorker{
 constructor(){workers.push(this);}
 postMessage(data){if(this.fail){queueMicrotask(()=>this.onerror());return;}if(this.hang)return;queueMicrotask(()=>this.onmessage({data:{id:data.id,result:{ok:true}}}));}
 terminate(){this.stopped=true;}
}
try{
 globalThis.Worker=FakeWorker;globalThis.fetch=async()=>({ok:true,json:async()=>[]});
 globalThis.setTimeout=(fn)=>{const id=++next;timers.set(id,fn);return id;};globalThis.clearTimeout=id=>timers.delete(id);
 globalThis.window={addEventListener:(name,fn)=>{events[name]=fn;}};
 const {createReaderWritingRuntime}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const reader=await createReaderWritingRuntime(),writing=await createReaderWritingRuntime();
 await reader.options.engine.verify();reader.dispose();await writing.options.engine.verify();assert.equal(workers.length,1);
 await Promise.all([reader.options.engine.verify(),writing.options.engine.derive()]);assert.equal(workers.length,1);
 for(const fn of [...timers.values()])fn();assert.ok(workers[0].stopped);
 await writing.options.engine.verify();assert.equal(workers.length,2);
 workers[1].fail=true;await assert.rejects(()=>writing.options.engine.verify(),/FONT_PROCESS_FAILED/);
 await writing.options.engine.verify();assert.equal(workers.length,3);
 workers[2].hang=true;const timeout=writing.options.engine.verify();const rejected=assert.rejects(timeout,/FONT_PROCESS_FAILED/);for(const fn of [...timers.values()])fn();await rejected;
 await reader.options.engine.verify();events.pagehide();assert.ok(workers.at(-1).stopped);
 console.log('PASS shared worker: Reader/Writing reuse, concurrent callers, idle cleanup, errors, timeout recovery and page exit.');
}finally{for(const [key,value]of Object.entries(originals)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
