import {basicLayoutWritingModes,languageTextDirection} from './basic-layout-context.js';
import {basicLayoutSamples} from './basic-layout-samples.js';
import {createPageBlockFromSection} from './blocks.js';
import {createGraphicObject} from './graphic-object-model.js';

const newId = prefix => prefix + '_' + crypto.randomUUID();
export const BASIC_PAGE_LAYOUTS = [
    {id:'cover', label:['表紙','Cover'], description:['大きなタイトルと短い紹介','Large title and short introduction']},
    {id:'chapter', label:['章扉','Chapter'], description:['章番号・見出し・導入文','Chapter number, heading and introduction']},
    {id:'article', label:['見出しと本文','Title and body'], description:['余白を確保した短い読み物','Short reading with generous margins']},
    {id:'photo', label:['写真と説明','Photo and caption'], description:['写真と読みやすい説明文','Photo with a readable caption'], image:true},
    {id:'poster', label:['全面写真と見出し','Photo and headline'], description:['写真に文字用の帯を添える','Photo with an opaque text panel'], image:true},
    {id:'steps', label:['3つの手順','Three steps'], description:['番号と短い説明で伝える','Numbered steps with short descriptions']}
];
export function createBasicLayoutPage(layoutId, {language='ja', writingMode='horizontal-tb', pageDirection='ltr', imageAsset, idFactory=newId}={}) {
    const preset=BASIC_PAGE_LAYOUTS.find(p=>p.id===layoutId);
    if(!preset)throw Error('UNKNOWN_LAYOUT');
    if(preset.image && !imageAsset)throw Error('LAYOUT_IMAGE_REQUIRED');
    if(!basicLayoutWritingModes(language).includes(writingMode))throw Error('UNSUPPORTED_LAYOUT_WRITING_MODE');
    const vertical=writingMode==='vertical-rl',sample=basicLayoutSamples(language),textDirection=languageTextDirection(language);
    const ja=language.split('-')[0]==='ja', choose=(a,b)=>ja?a:b;
    const page=createPageBlockFromSection({type:'image',backgroundColor:'#ffffff',bubbles:[]});
    page.id=idFactory('page');
    const objects=[];
    const add=(kind,name,frame,text='',style={})=>{
        const o=createGraphicObject(kind,idFactory('object'),language,{name});
        Object.assign(o.frame,frame);
        Object.assign(o.style,{fontFamily:'sans-serif',fontSize:18,padding:0,align:'left',valign:'top',strokeOpacity:0,lineWidth:0,color:'#182b3a'},style);
        o.texts={[language]:text}; objects.push(o); return o;
    };
    const names={Title:'タイトル',Introduction:'紹介文',Author:'著者名',Chapter:'章番号',Heading:'見出し',Body:'本文',Caption:'説明文',Number:'手順番号','Step heading':'手順の見出し','Step body':'手順の説明'};
    const text=(name,x,y,width,height,size,value,style={})=>add('text',choose(names[name]||name,name),{x,y,width,height},value,{fontSize:size,...style});
    const panel=(x,y,width,height,fill)=>{const o=add('shape',choose('背景','Background'),{x,y,width,height},'',{fill});o.locked=true;return o;};
    const photo=(x,y,width,height)=>{
        const o=add('image',imageAsset.name||choose('写真','Photo'),{x,y,width,height});
        o.assetId=imageAsset.id;
        const target=width/height, ratio=imageAsset.width/imageAsset.height;
        o.crop=ratio>target?{x:(1-target/ratio)/2,y:0,width:target/ratio,height:1}
            :{x:0,y:(1-ratio/target)/2,width:1,height:ratio/target};
    };
    if(vertical){
        const verticalText=(name,x,y,w,h,size,value,style={})=>text(name,x,y,w,h,size,value,{writingMode:'vertical-rl',align:'left',...style});
        if(layoutId==='cover'){
            panel(0,0,360,640,'#102f43');panel(316,28,6,28,'#5cdbc5');
            verticalText('Title',224,64,108,360,32,sample.title,{color:'#ffffff',bold:true});
            verticalText('Introduction',114,180,84,344,18,sample.intro,{color:'#ffffff'});
            verticalText('Author',40,440,48,160,16,sample.author,{color:'#d0e5ed'});
        }else if(layoutId==='chapter'){
            panel(0,0,360,640,'#f3f6f8');panel(316,28,5,56,'#14675f');
            verticalText('Chapter',280,108,40,180,18,sample.chapter,{color:'#14675f',bold:true});
            verticalText('Heading',170,130,90,400,28,sample.heading,{bold:true});
            verticalText('Introduction',52,260,84,330,18,sample.intro);
        }else if(layoutId==='article'){
            verticalText('Heading',250,32,82,576,28,sample.heading,{bold:true});
            panel(234,32,2,576,'#c8d5df');
            verticalText('Body',28,32,186,576,18,sample.body);
        }else if(layoutId==='photo'){
            verticalText('Heading',268,28,64,328,28,sample.heading,{bold:true});
            photo(28,28,216,328);
            verticalText('Caption',28,384,304,228,18,sample.caption);
        }else if(layoutId==='poster'){
            photo(0,0,360,640);panel(188,0,172,640,'#102f43');
            verticalText('Heading',268,28,64,560,28,sample.heading,{color:'#ffffff',bold:true});
            verticalText('Caption',212,60,40,520,18,sample.caption,{color:'#ffffff'});
        }else{
            verticalText('Heading',282,30,50,576,28,sample.stepsTitle,{bold:true});
            panel(266,30,2,576,'#c8d5df');
            [184,104,24].forEach((x,i)=>{
                panel(x+18,30,40,40,'#14675f');
                text('Number',x+18,30,40,40,20,String(i+1),{color:'#ffffff',bold:true,align:'center',valign:'center'});
                verticalText('Step heading',x+18,88,40,190,20,sample.steps[i],{bold:true,valign:'center'});
                verticalText('Step body',x+2,308,70,292,18,sample.stepBody);
            });
        }
    }else if(layoutId==='cover'){
        panel(0,0,360,640,'#102f43');panel(28,112,56,6,'#5cdbc5');
        text('Title',28,156,304,174,36,sample.title,{color:'#ffffff',bold:true});
        text('Introduction',28,364,304,126,20,sample.intro,{color:'#ffffff'});
        text('Author',28,564,304,42,16,sample.author,{color:'#d0e5ed'});
    }else if(layoutId==='chapter'){
        panel(0,0,360,640,'#f3f6f8');panel(28,230,56,5,'#14675f');
        text('Chapter',28,156,304,48,18,sample.chapter,{color:'#14675f',bold:true});
        text('Heading',28,268,304,126,32,sample.heading,{bold:true});
        text('Introduction',28,438,304,126,18,sample.intro);
    }else if(layoutId==='article'){
        text('Heading',28,36,304,98,28,sample.heading,{bold:true});
        panel(28,152,304,2,'#c8d5df');
        text('Body',28,182,304,418,18,sample.body);
    }else if(layoutId==='photo'){
        text('Heading',28,28,304,84,28,sample.heading,{bold:true});
        photo(28,132,304,252);
        text('Caption',28,410,304,196,18,sample.caption);
    }else if(layoutId==='poster'){
        photo(0,0,360,640);panel(0,402,360,238,'#102f43');
        text('Heading',28,426,304,100,28,sample.heading,{color:'#ffffff',bold:true});
        text('Caption',28,550,304,62,18,sample.caption,{color:'#ffffff'});
    }else{
        text('Heading',28,30,304,90,28,sample.stepsTitle,{bold:true});
        [146,300,454].forEach((y,i)=>{
            panel(28,y,42,42,'#14675f');
            text('Number',28,y,42,42,20,String(i+1),{color:'#ffffff',bold:true,align:'center',valign:'center'});
            text('Step heading',86,y,246,42,20,sample.steps[i],{bold:true,valign:'center'});
            text('Step body',86,y+50,246,96,18,sample.stepBody);
        });
    }
    // In-page placement follows the reading language, independently of book page order.
    if(!vertical)for(const o of objects){
        if(textDirection==='rtl')o.frame.x=360-o.frame.x-o.frame.width;
        if(o.kind==='text'&&textDirection==='rtl'&&o.style.align==='left')o.style.align='right';
    }
    page.content.graphicObjects=objects;
    page.content.objectOrder=objects.map(o=>o.id);
    return page;
}

/** Whole fixed pages are copied from canonical blocks, never inferred from sections. */
export function inspectPageDuplication(blocks, blockIndex) {
    const source=blocks?.[blockIndex];
    if(source?.kind!=='page')return {ok:false,reason:'fixed_only'};
    const group=source.content?.spreadImage?.groupId;
    const indices=group?blocks.flatMap((b,i)=>b.kind==='page'&&b.content?.spreadImage?.groupId===group?[i]:[]):[blockIndex];
    if(group && (indices.length!==2||indices[1]!==indices[0]+1
        ||!['left','right'].every(role=>indices.some(i=>blocks[i].content.spreadImage.role===role))))return {ok:false,reason:'invalid_spread'};
    return {ok:true,indices};
}
export function duplicateFixedPage(project, blockIndex, idFactory=newId) {
    const status=inspectPageDuplication(project.blocks,blockIndex);
    if(!status.ok)throw Error(status.reason);
    const owners=new Map(),objectMaps=new Map(),spreadId=status.indices.length===2?idFactory('spreadimg'):null;
    const copies=status.indices.map(i=>{
        const old=project.blocks[i], next=structuredClone(old),ids=new Map();
        next.id=idFactory('page');owners.set(old.id,next.id);objectMaps.set(old.id,ids);
        for(const o of [...next.content.bubbles||[],...next.content.graphicObjects||[]]){
            const oldId=o.id;o.id=idFactory('object');if(oldId)ids.set(oldId,o.id);
        }
        if(next.content.objectOrder)next.content.objectOrder=next.content.objectOrder.map(id=>ids.get(id)||id);
        if(spreadId)next.content.spreadImage.groupId=spreadId;
        return next;
    });
    const blocks=project.blocks.slice(),activeBlockIndex=status.indices.at(-1)+1;
    blocks.splice(activeBlockIndex,0,...copies);
    const result={blocks,activeBlockIndex};
    if(project.pageNavigation){
        const nav=structuredClone(project.pageNavigation),anchors=new Map();
        const mapTarget=t=>({...structuredClone(t),ownerId:owners.get(t.ownerId),objectId:objectMaps.get(t.ownerId).get(t.objectId)||t.objectId});
        const copiedAnchors=nav.anchors.filter(a=>owners.has(a.target.ownerId)).map(a=>{
            const id=idFactory('anchor');anchors.set(a.id,id);return {...structuredClone(a),id,target:mapTarget(a.target)};
        });
        const copiedLinks=nav.links.filter(l=>owners.has(l.source.ownerId)).map(l=>{
            const n={...structuredClone(l),id:idFactory('link'),source:mapTarget(l.source)};
            if(n.destination.kind==='anchor'&&anchors.has(n.destination.anchorId))n.destination.anchorId=anchors.get(n.destination.anchorId);
            return n;
        });
        nav.anchors.push(...copiedAnchors);nav.links.push(...copiedLinks);result.pageNavigation=nav;
    }
    return result;
}

/** Insert after an entire authoring unit; never bisect an image spread. */
export function layoutInsertionIndex(blocks, blockIndex) {
    if(blockIndex<0||!blocks[blockIndex])return blocks.length;
    if(blocks[blockIndex].content?.spreadImage?.groupId){
        const status=inspectPageDuplication(blocks,blockIndex);
        if(!status.ok)throw Error(status.reason);
        return status.indices.at(-1)+1;
    }
    return blockIndex+1;
}
