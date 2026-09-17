import { createFlowGroupBlock, assertValidFlowProjectData } from './flow-project-model.js';
import { createFlowParagraph, createFlowHeading } from './flow-document.js';
import { isFlowWritingModeSupported } from './flow-typography.js';
const error = code => ({ error: { code } });
const id = x => typeof x === 'string' && x.length > 0 && x.length <= 256;
const only = (x, keys) => x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).every(k => keys.includes(k));
const schema = (properties, required = Object.keys(properties)) => ({ type:'object', additionalProperties:false, properties, required });
const token = { type:'string', minLength:1, maxLength:256 };
const prepareSchema = schema({ workToken:token });
const appendSchema = schema({ workToken:token, appendToken:token, blocks:{ type:'array', minItems:1, maxItems:20,
    items:schema({ type:{type:'string',enum:['heading','paragraph']}, text:{type:'string',maxLength:12000}, level:{type:'integer',minimum:1,maximum:6} }, ['type','text']) } });
const projectSchema = schema({ workToken:token, projectName:{type:'string',minLength:1,maxLength:200}, title:{type:'string',minLength:1,maxLength:200},
    languageKey:{type:'string',minLength:1,maxLength:35}, writingMode:{type:'string',enum:['horizontal-tb','vertical-rl']} });

export function createAIFlowDraft(args) {
    if (!only(args, Object.keys(projectSchema.properties)) || !id(args.workToken)
        || !['projectName','title'].every(k => typeof args[k] === 'string' && args[k].trim() && args[k].length <= 200)
        || typeof args.languageKey !== 'string' || !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(args.languageKey) || args.languageKey.length > 35
        || !['horizontal-tb','vertical-rl'].includes(args.writingMode) || !isFlowWritingModeSupported(args.languageKey,args.writingMode)) throw Error('INVALID_ARGUMENTS');
    const group = createFlowGroupBlock({ sourceLanguage:args.languageKey, writingMode:args.writingMode,
        document:{sourceLanguage:args.languageKey,sections:[{blocks:[{type:'paragraph',texts:{[args.languageKey]:''}}]}]} });
    assertValidFlowProjectData({version:6,blocks:[group]});
    return { projectName:args.projectName.trim(),title:args.title.trim(),languageKey:args.languageKey,writingMode:args.writingMode,blocks:[group] };
}

/** Append-only source authoring. Tickets and receipts never enter persisted project data. */
export function createEditorAuthoringTools({ readState, readonly, applyEdit, createProject, createToken = () => crypto.randomUUID() }) {
    let ticket=null,receipt=null,creating=false,generation=0;
    const reset=()=>{generation++;ticket=null;receipt=null;};
    const context=workToken=>{const c=readonly.execute('dsf_get_editor_context',{});return c.error?c:c.workToken!==workToken?error('STALE_WORK_TOKEN'):c.busy?error('BUSY'):c;};
    function execute(name,args,options={}) {
        try {
            if (name==='dsf_create_flow_project') return create(args,options);
            if (creating) return error('BUSY');
            if (name==='dsf_prepare_flow_append') {
                if (!only(args,['workToken']) || !id(args.workToken)) return error('INVALID_ARGUMENTS');
                const ctx=context(args.workToken);if(ctx.error)return ctx;
                const group=readState().blocks.find(b=>b.kind==='flow'&&b.id===ctx.target?.groupId);
                if(!group)return error('NO_CURRENT_FLOW');
                if(ctx.languageKey!==group.flow.document.sourceLanguage)return error('SOURCE_LANGUAGE_REQUIRED');
                const section=group.flow.document.sections.at(-1);if(!section)return error('INVALID_TARGET');
                ticket={ workToken:args.workToken,appendToken:createToken(),groupId:group.id,sectionId:section.id,languageKey:ctx.languageKey,snapshot:JSON.stringify(group) };
                receipt=null;
                return { workToken:ticket.workToken,appendToken:ticket.appendToken,groupId:group.id,sectionId:section.id,languageKey:ctx.languageKey,afterBlockId:section.blocks.at(-1)?.id??null };
            }
            if(name==='dsf_append_flow_blocks') {
                if(!only(args,['workToken','appendToken','blocks'])||!id(args.workToken)||!id(args.appendToken)
                    ||!Array.isArray(args.blocks)||args.blocks.length<1||args.blocks.length>20)return error('INVALID_ARGUMENTS');
                if(args.blocks.some(b=>!only(b,['type','text','level'])||!['heading','paragraph'].includes(b.type)||typeof b.text!=='string'||b.text.length>12000
                    ||(b.level!==undefined&&(b.type!=='heading'||!Number.isInteger(b.level)||b.level<1||b.level>6)))
                    ||args.blocks.reduce((n,b)=>n+b.text.length,0)>12000)return error('INVALID_ARGUMENTS');
                const ctx=context(args.workToken);if(ctx.error)return ctx;
                const key=JSON.stringify(args);
                if(receipt?.key===key)return {...receipt.result,replayed:true};
                if(!ticket||ticket.appendToken!==args.appendToken||ticket.workToken!==args.workToken)return error('STALE_EDIT_TOKEN');
                if(ctx.target?.groupId!==ticket.groupId||ctx.languageKey!==ticket.languageKey)return error('TARGET_CHANGED');
                const state=readState(),group=state.blocks.find(b=>b.id===ticket.groupId);
                if(JSON.stringify(group)!==ticket.snapshot){ticket=null;return error('STALE_TEXT');}
                const target={...ticket};delete target.snapshot;delete target.appendToken;
                const next=structuredClone(state.blocks),nextGroup=next.find(b=>b.id===group.id);
                const added=args.blocks.map(b=>(b.type==='heading'?createFlowHeading:createFlowParagraph)({texts:{[ctx.languageKey]:b.text},...(b.type==='heading'?{level:b.level??1}:{})}));
                nextGroup.flow.document.sections.find(s=>s.id===ticket.sectionId).blocks.push(...added);
                assertValidFlowProjectData({version:6,blocks:next});
                ticket=null;
                applyEdit({blocks:next,count:added.length});
                const result={...target,changed:true,added:added.map(b=>({blockId:b.id,type:b.type})),undoAvailable:true,autosave:'normal-editor-policy'};
                receipt={key,result};return result;
            }
            return error('UNKNOWN_TOOL');
        }catch{return error('EDIT_FAILED');}
    }
    async function create(args,options) {
        let draft;try{draft=createAIFlowDraft(args);}catch{return error('INVALID_ARGUMENTS');}
        if(typeof createProject!=='function')return error('UNAVAILABLE');
        if(creating)return error('BUSY');
        const ctx=context(args.workToken);if(ctx.error)return ctx;
        const currentGeneration=generation;
        const guard=()=>!options.signal?.aborted&&currentGeneration===generation&&!context(args.workToken).error;
        creating=true;
        try {
            const result=await createProject(draft,guard);
            if(result?.error)return result;
            return {created:true,changed:true,projectName:draft.projectName,title:draft.title,languageKey:draft.languageKey,
                groupId:draft.blocks[0].id,permissionReset:true,nextAction:'Enable AI tools and editing again for the new project, then get context and list paragraphs.'};
        }catch{return error('PROJECT_CREATE_FAILED');}
        finally{creating=false;}
    }
    function getTools(){return [
        {name:'dsf_prepare_flow_append',description:'Prepare appending headings/paragraphs at the end of the current Flow original-language manuscript. Returns a one-use appendToken and exact target. No mutation. Translation view is rejected.',inputSchema:prepareSchema,annotations:{readOnlyHint:true}},
        {name:'dsf_append_flow_blocks',description:'Append 1-20 new heading/paragraph blocks with at most 12000 UTF-16 text units total, using the latest appendToken. Existing paragraphs, translations, annotations and layout are preserved. New paragraphs may contain line breaks. One Undo step and normal autosave. Identical retry is not applied twice. Does not publish.',inputSchema:appendSchema,annotations:{readOnlyHint:false,consequentialHint:true}},
        ...(typeof createProject==='function'?[{name:'dsf_create_flow_project',description:'Create and open a NEW Flow project with projectName, title, original languageKey and writingMode. The current project is backed up locally before switching; backup failure or concurrent change cancels creation. Does not publish. Opening the new project revokes AI permission; the user must enable it again in the profile. Never use this to rename or edit the current project.',inputSchema:projectSchema,annotations:{readOnlyHint:false,consequentialHint:true}}]:[])
    ].map(t=>({...t,inputSchema:structuredClone(t.inputSchema),execute:(args,options)=>execute(t.name,args,options)}));}
    return {execute,getTools,reset};
}
