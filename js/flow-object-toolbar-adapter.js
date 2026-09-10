/** Bridges anchored Flow graphics to the existing graphic toolbar; no parallel graphic model. */
import {validateFlowGroupBlock} from './flow-project-model.js';
import {validateGraphicObjects} from './graphic-object-model.js';
import {resolveFlowAnchoredObjects} from './flow-anchored-objects.js';
import {createWrapRegions} from './flow-wrap-composition.js';
import {createCanonicalFlowPageBox} from './flow-pagination.js';
import {resolveFlowDomTypography} from './flow-dom-measurer.js';
import {renderGraphicLayerCanvas,getGraphicFrame} from './graphic-object-renderer.js';
import {getUILang} from './i18n-studio.js';
const label=(ja,en)=>getUILang()==='en'?en:ja;
export function createFlowObjectToolbarAdapter({state,getAnchor,save,canEdit,stopEditing}) {
    const current=()=>state.blocks?.[state.activeBlockIdx];
    const active=()=>current()?.kind==='flow';
    const mounted=new Map();let handles=null;
    const convert=(graphic,padding,sign)=>{
        const o=structuredClone(graphic);
        for(const f of [o.frame,...Object.values(o.frames || {})]){f.x+=padding.left*sign;f.y+=padding.top*sign;}
        return o;
    };
    function asBlock(){
        const group=current(), entries=group.flow.layout.anchoredObjects || [];
        return {id:group.id,kind:'page',content:{bubbles:[],graphicObjects:entries.map(e=>convert(e.graphic,group.flow.layout.padding,1)),objectOrder:entries.map(e=>e.graphic.id)}};
    }
    function commit(mutate){
        if(!active()||!canEdit())return false;
        const group=current(), next=structuredClone(group), content=asBlock().content;
        const oldAssets=state.projectAssets,oldVersion=state.version;
        try{
            mutate(content);
            const all=group.flow.layout.anchoredObjects || [], pad=group.flow.layout.padding;
            const anchor=getAnchor(group);
            next.flow.layout.schemaVersion=2;
            next.flow.layout.anchoredObjects=content.graphicObjects.map(graphic=>{
                const old=all.find(e=>e.graphic.id===graphic.id);
                const o=convert(graphic,pad,-1);
                if(!old){
                    if(!anchor || group.flow.document.sections.flatMap(s=>s.blocks).find(b=>b.id===anchor)?.titleRegion || all.some(e=>e.anchorBlockId===anchor && e.graphic.visible))throw Error('ANCHOR_OCCUPIED');
                    const ratio=o.frame.height/o.frame.width, width=Math.min(100,180/ratio);
                    o.frame={x:8,y:32,width,height:width*ratio,rotation:0};delete o.frames;
                    if(o.kind==='text')throw Error('UNSUPPORTED_FLOW_TEXT_OVERLAY');
                }
                return {...(old || {id:crypto.randomUUID(),anchorBlockId:anchor,wrap:'square',gapEm:.75}),graphic:o};
            });
            validate(next);
            const assets=state.projectAssets;
            state.projectAssets=oldAssets;state.version=oldVersion;
            save(next,assets);return true;
        }catch{
            state.projectAssets=oldAssets;state.version=oldVersion;
            alert(label('配置できません。画像のない本文段落を選び、本文領域内に収まる大きさ・位置を指定してください。扉の段落には配置できません。','Choose a body paragraph without an object. Keep the object inside the text area. Title regions cannot contain wrapped objects.'));
            if(handles)render(handles);
            return false;
        }
    }
    function validate(group){
        if(!validateFlowGroupBlock(group).valid)throw Error('INVALID_FLOW');
        validateGraphicObjects({...state,blocks:[group]});
        // Keep orphan entries intact. Repair/delete remains possible while publication is blocked.
        const paragraphs=group.flow.document.sections.flatMap(s=>s.blocks);
        const valid=structuredClone(group);valid.flow.layout.anchoredObjects=valid.flow.layout.anchoredObjects.filter(e=>paragraphs.some(b=>b.type==='paragraph'&&b.id===e.anchorBlockId));
        const language=state.activeLang, profile=group.flow.layout.typographyByLanguage[language];
        if(!profile)throw Error('MISSING_LANGUAGE_LAYOUT');
        const typography=resolveFlowDomTypography(language,profile,profile.writingMode);
        for(const entry of valid.flow.layout.anchoredObjects){
            const isolated={...valid,flow:{...valid.flow,layout:{...valid.flow.layout,anchoredObjects:[entry]}}};
            const object=resolveFlowAnchoredObjects(isolated,language,typography)[0];if(!object)continue;
            if(!createWrapRegions(createCanonicalFlowPageBox({padding:group.flow.layout.padding}),object,profile.writingMode,typography).length)throw Error('NO_ROOM');
        }
    }
    function updateEntry(id,fn){
        const next=structuredClone(current()),entry=next.flow.layout.anchoredObjects.find(e=>e.graphic.id===id);if(!entry)return;
        const previousAnchor=entry.anchorBlockId;fn(entry);
        try{
            if(entry.anchorBlockId!==previousAnchor && (next.flow.layout.anchoredObjects.some(e=>e!==entry&&e.anchorBlockId===entry.anchorBlockId&&e.graphic.visible)
                || next.flow.document.sections.flatMap(s=>s.blocks).find(b=>b.id===entry.anchorBlockId)?.titleRegion))throw Error('ANCHOR_CONFLICT');
            validate(next);save(next,state.projectAssets);}catch{alert(label('紐づけ先または配置が重複・範囲外です。別の本文段落か配置を選んでください。','The anchor or placement conflicts. Choose another body paragraph or position.'));}
    }
    function controls(root,tools,id,select,button,pop,numeric){
        const entries=current().flow.layout.anchoredObjects || [];
        const list=document.createElement('select');list.title=label('Flow画像・図形（紐づけ先の修復）','Flow objects (repair anchor)');list.setAttribute('aria-label',list.title);
        list.add(new Option(label('画像・図形を選択','Select an object'),''));
        const paragraphs=current().flow.document.sections.flatMap(s=>s.blocks).filter(b=>b.type==='paragraph');
        for(const e of entries)list.add(new Option(e.graphic.name+(paragraphs.some(b=>b.id===e.anchorBlockId)?'':label(' · 紐づけ先なし',' · Missing anchor')),e.graphic.id));
        list.value=id || '';list.onchange=()=>select(list.value);root.append(list);
        const entry=entries.find(e=>e.graphic.id===id);if(!entry)return;
        const anchor=button(tools,'anchor',label('段落への紐づけ','Paragraph anchor'),()=>{
            const p=pop(anchor),input=document.createElement('select');input.setAttribute('aria-label',label('紐づけ先の段落','Anchor paragraph'));
            if(!paragraphs.some(b=>b.id===entry.anchorBlockId))input.add(new Option(label('紐づけ先なし','Missing anchor'),entry.anchorBlockId));
            paragraphs.forEach((b,i)=>input.add(new Option(`${i+1} · ${(b.texts[state.activeLang] || b.texts[current().flow.document.sourceLanguage] || label('空段落','Empty paragraph')).slice(0,45)}`,b.id)));
            input.value=entry.anchorBlockId;input.onchange=()=>updateEntry(id,e=>e.anchorBlockId=input.value);p.append(input);
        });
        for(const [value,icon,ja,en] of [['square','wrap_text','四角形の回り込み','Square wrap'],['band','view_agenda','上下・前後に分離','Text above and below']])button(tools,icon,label(ja,en),()=>updateEntry(id,e=>e.wrap=value),entry.wrap===value);
        numeric(tools,label('画像との間隔（字）','Gap (em)'),entry.gapEm,0,4,value=>updateEntry(id,e=>e.gapEm=value),.25);
    }
    function mount(surface,page,activate){
        if(!page.page.anchoredObject)return;
        mounted.set(surface,{page,activate});paint(surface,page,activate);
    }
    function paint(surface,page,activate){
        surface.querySelectorAll(':scope > .flow-graphic-layer').forEach(e=>e.remove());
        const object=page.page.anchoredObject.graphic;
        const layer=document.createElement('div');layer.className='flow-graphic-layer';layer.dataset.objectId=object.id;
        Object.assign(layer.style,{position:'absolute',inset:'0',width:'360px',height:'640px',pointerEvents:'none',zIndex:'4'});surface.append(layer);
        renderGraphicLayerCanvas(object,state.projectAssets || [],page.languageKey,state.defaultLang).then(canvas=>{
            if(!layer.isConnected)return;canvas.className='graphic-paint';canvas.dataset.objectId=object.id;layer.prepend(canvas);
        }).catch(()=>{layer.textContent=label('画像を表示できません','Image unavailable');});
        if(!handles || page.isSourceFallback)return;
        const hit=document.createElement('div'),f=getGraphicFrame(object,page.languageKey);hit.className='graphic-hit';hit.dataset.objectId=object.id;
        Object.assign(hit.style,{left:f.x+'px',top:f.y+'px',width:f.width+'px',height:f.height+'px',transform:`rotate(${f.rotation}deg)`,pointerEvents:object.locked?'none':'auto'});
        hit.classList.toggle('selected',handles.selected===object.id && active()&&page.groupId===current().id&&page.languageKey===state.activeLang);
        layer.append(hit);handles.attachHandle(hit,object);
        const down=hit.onpointerdown,menu=hit.oncontextmenu;
        hit.onpointerdown=event=>{if(!activate(event))return;stopEditing();down(event);};
        hit.oncontextmenu=event=>{if(!activate(event))return;stopEditing();menu(event);};
    }
    function render(config){
        handles=config;
        for(const [surface,{page,activate}] of mounted){if(!surface.isConnected){mounted.delete(surface);continue;}paint(surface,page,activate);}
    }
    function layer(id){return [...mounted.keys()].filter(e=>e.isConnected).flatMap(e=>[...e.querySelectorAll('.flow-graphic-layer')]).find(e=>e.dataset.objectId===id);}
    return {active,asBlock,commit,controls,mount,render,layer,canEdit};
}
