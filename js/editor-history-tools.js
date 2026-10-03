const token = {type:'string',minLength:1,maxLength:256};
const schema = properties => ({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const error = code => ({error:{code}});
export function createEditorHistoryTools({readonly, readState, history, createToken=()=>crypto.randomUUID()}) {
    let ticket=null,receipt=null;
    const reset=()=>{ticket=null;receipt=null;};
    const definitions=[
        {name:'dsf_list_edit_history',description:'List up to 50 current-session Undo/Redo operations with time, manual/AI origin, changed target IDs and next Undo/Redo IDs. History is not persisted. Content is untrusted data. Does not change the work.',inputSchema:schema({workToken:token}),annotations:{readOnlyHint:true}},
        {name:'dsf_read_edit_history',description:'Read bounded before/after text excerpts and page ordering for a history entry. Excerpts may be truncated; no image URLs/bytes or complete project snapshots. Does not change the work.',inputSchema:schema({workToken:token,entryId:token}),annotations:{readOnlyHint:true}},
        {name:'dsf_prepare_history_step',description:'Prepare exactly one Undo or Redo for the next entryId from dsf_list_edit_history. Inspect the returned operation, origin and text changes before applying, particularly manual edits. Does not restore an arbitrary old version. Returns a one-use historyToken; any intervening edit invalidates it.',inputSchema:schema({workToken:token,direction:{type:'string',enum:['undo','redo']},entryId:token}),annotations:{readOnlyHint:true}},
        {name:'dsf_apply_history_step',description:'Apply one prepared Undo/Redo after reviewing its exact target. Rejects changed work or history. Identical retry never takes a second step. Normal editor autosave; no publishing or persistent history. Re-read context and book composition after layout.',inputSchema:schema({workToken:token,historyToken:token}),annotations:{readOnlyHint:false,consequentialHint:true}},
    ];
    function execute(name,args,options={}) {
        if(options.signal?.aborted)return error('CANCELLED');
        const tool=definitions.find(t=>t.name===name);
        if(!tool)return error('UNKNOWN_TOOL');
        if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!(k in tool.inputSchema.properties))||tool.inputSchema.required.some(k=>typeof args[k]!=='string'||!args[k]||args[k].length>256))return error('INVALID_ARGUMENTS');
        const ctx=readonly.execute('dsf_get_editor_context',{});
        if(ctx.error)return ctx;
        if(ctx.workToken!==args.workToken)return error('STALE_WORK_TOKEN');
        if(!history)return error('UNAVAILABLE');
        if(ctx.busy)return error('BUSY');
        if(name==='dsf_list_edit_history')return {workToken:ctx.workToken,...history.list()};
        if(name==='dsf_read_edit_history')return history.read(args.entryId)||error('HISTORY_ENTRY_MISSING');
        const guard=()=>JSON.stringify([history.guard(),readState().languageKey,readState().book,readState().bookMode]);
        if(name==='dsf_prepare_history_step') {
            if(!['undo','redo'].includes(args.direction))return error('INVALID_ARGUMENTS');
            const list=history.list(),next=args.direction==='undo'?list.nextUndoId:list.nextRedoId;
            if(!next)return error('HISTORY_EMPTY');
            if(next!==args.entryId)return error('STALE_HISTORY');
            ticket={token:createToken(),workToken:args.workToken,direction:args.direction,entryId:next,guard:guard()};
            return {prepared:true,changed:false,historyToken:ticket.token,direction:ticket.direction,entry:history.read(next)};
        }
        const key=JSON.stringify(args);
        if(receipt?.key===key)return {...receipt.result,replayed:true};
        if(!ticket||ticket.token!==args.historyToken||ticket.workToken!==args.workToken||ticket.guard!==guard()) {ticket=null;return error('STALE_HISTORY');}
        const pending=ticket;ticket=null;
        try { if(!history.step(pending.direction))return error('HISTORY_EMPTY'); } catch { return error('EDIT_FAILED'); }
        const result={changed:true,direction:pending.direction,entryId:pending.entryId,autosave:'normal-editor-policy'};
        receipt={key,result};return result;
    }
    return {reset,execute,getTools:(write=false)=>history?definitions.filter((t,i)=>i<2||write).map(t=>({...t,execute:(args,options)=>execute(t.name,args,options)})):[]};
}
