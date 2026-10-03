// Session-only file access. Never persist handles, permissions or fingerprints in DSP/IDB.
export const DSP_FILE_TYPES=[{description:'DSF Studio Project (.dsp)',accept:{'application/vnd.dsf.project+zip':['.dsp']}}];
export function dspFilename(name='project') {
    const clean=String(name||'project').replace(/[\\/:*?"<>|]/g,'_').trim()||'project';
    return clean.toLowerCase().endsWith('.dsp')?clean:clean+'.dsp';
}
export async function fingerprintDspFile(file) {
    const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
    return {size:file.size,modified:file.lastModified??null,hash:Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')};
}
const equal=(a,b)=>a.size===b.size&&a.hash===b.hash&&a.modified===b.modified;
const fail=code=>{throw Object.assign(Error(code),{code});};
export function createDspFileSession({readScope,canBind=()=>true,onChange=()=>{}}) {
    let binding=null,busy=false,generation=0;
    const currentBinding=()=>binding?.scope===readScope()&&canBind()?binding:null;
    const read=()=>({name:currentBinding()?.handle.name||'',busy});
    const changed=()=>onChange(read());
    return {
        read,
        clear(){binding=null;generation++;changed();},
        attach(handle,fingerprint){binding=canBind()?{handle,fingerprint,scope:readScope()}:null;changed();},
        async save({saveAs=false,chooseHandle,buildBlob}) {
            if(busy)fail('DSP_FILE_BUSY');
            const scope=readScope(),startGeneration=generation,previous=currentBinding(),bind=canBind();
            const check=()=>{if(scope!==readScope()||generation!==startGeneration)fail('DSP_FILE_SESSION_CHANGED');};
            let writer=null;
            busy=true;changed();
            try {
                // Pick/request permission synchronously from the user's click, before preparing the ZIP.
                let handle;
                if(saveAs||!previous){
                    try{handle=await chooseHandle();}catch(error){if(error?.name==='AbortError')return {status:'cancelled'};throw error;}
                } else {
                    handle=previous.handle;
                    if(typeof handle.requestPermission==='function'&&await handle.requestPermission({mode:'readwrite'})!=='granted')fail('DSP_FILE_PERMISSION');
                }
                check();
                if(!handle||typeof handle.createWritable!=='function'||!String(handle.name).toLowerCase().endsWith('.dsp'))fail('DSP_FILE_INVALID');
                const same=previous&&(handle===previous.handle||await handle.isSameEntry(previous.handle));
                check();
                const original=await fingerprintDspFile(await handle.getFile());check();
                if(same&&!equal(original,previous.fingerprint))fail('DSP_FILE_CHANGED');
                const result=await buildBlob();check();
                const blob=result?.blob;
                if(!(blob instanceof Blob)||!blob.size)fail('DSP_FILE_EMPTY');
                const expected=await fingerprintDspFile(blob);check();
                if(!equal(original,await fingerprintDspFile(await handle.getFile())))fail('DSP_FILE_CHANGED');check();
                writer=await handle.createWritable({keepExistingData:false,mode:'exclusive'});check();
                await writer.write(blob);check();
                if(!equal(original,await fingerprintDspFile(await handle.getFile())))fail('DSP_FILE_CHANGED');check();
                await writer.close();writer=null;
                // Confirm actual file bytes, not just a download or the start of a write.
                const saved=await fingerprintDspFile(await handle.getFile());
                if(saved.hash!==expected.hash||saved.size!==expected.size)fail('DSP_FILE_VERIFY_FAILED');
                check();
                if(bind&&canBind())binding={handle,fingerprint:saved,scope};
                return {status:'saved',filename:handle.name,token:result.token};
            } finally {
                if(writer){try{await writer.abort();}catch{ /* Never claim saving succeeded after a failed close. */ }}
                busy=false;changed();
            }
        }
    };
}
