// File handles live only in this window. Receiving a file never opens or uploads it.
export function createFileLaunchInbox({extension,openFile,beforeOpen=()=>{},onChange=()=>{}}) {
    let nextId=0,busy=false;
    const items=[];
    const read=()=>({busy,items:items.map(({id,name,error})=>({id,name,error}))});
    const changed=()=>onChange(read());
    return {
        read,
        receive(params) {
            for(const handle of params?.files || []) {
                if(handle?.kind!=='file'||typeof handle.getFile!=='function')continue;
                const name=String(handle.name||'');
                items.push({id:++nextId,name,handle,error:name.toLowerCase().endsWith(extension)?'':'type'});
            }
            changed();
        },
        remove(id) {
            if(busy)return;
            const i=items.findIndex(item=>item.id===id);
            if(i>=0)items.splice(i,1);
            changed();
        },
        async open(id) {
            const item=items.find(item=>item.id===id);
            if(busy||!item||!item.name.toLowerCase().endsWith(extension))return false;
            busy=true;item.error='';changed();
            try {
                // Check manuscript safety before accessing the incoming file.
                await beforeOpen();
                const file=await item.handle.getFile();
                if(!String(file?.name||'').toLowerCase().endsWith(extension))throw Error('type');
                if(await openFile(file,item.handle)===false)throw Error('open');
                items.splice(items.indexOf(item),1);
                return true;
            } catch(error) {
                item.error=['unsaved','busy','type','not-ready'].includes(error?.message)?error.message:'open';
                return false;
            } finally {busy=false;changed();}
        }
    };
}
