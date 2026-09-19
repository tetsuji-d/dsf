import assert from 'node:assert/strict';
import {createGraphicObject,initializeGraphicObjects,validateGraphicObjects,graphicOrder} from '../js/graphic-object-model.js';
import {createPageBlockFromSection,createSectionFromPageBlock} from '../js/blocks.js';
import {prepareProjectForSave,hydrateProjectFromPersistence} from '../js/project-persistence.js';
import {getAssetUsage} from '../js/project-assets.js';
const asset={id:'image',name:'sample.webp',mimeType:'image/webp',width:7680,height:4320,byteLength:24000,background:'assets/library/image.webp',thumbnail:'assets/library/thumb.webp'};
const content={pageKind:'image',bubbles:[{text:'legacy',x:50,y:50}]};initializeGraphicObjects(content,()=> 'legacy');
for(const kind of ['shape','image','text']){const o=createGraphicObject(kind,kind,'ja',{assetId:'image'});content.graphicObjects.push(o);content.objectOrder.push(o.id)}
content.graphicObjects[2].texts['en-GB']='Translated';content.graphicObjects[2].frames={'en-GB':{x:10,y:20,width:150,height:100,rotation:20}};
const project={version:6,languages:['ja','en-GB'],defaultLang:'ja',projectAssets:[asset],blocks:[{id:'page',kind:'page',content}]};
const stored=prepareProjectForSave(project),loaded=hydrateProjectFromPersistence(JSON.parse(JSON.stringify(stored)));
assert.deepEqual(loaded.blocks[0].content.graphicObjects,content.graphicObjects);assert.deepEqual(loaded.blocks[0].content.objectOrder,content.objectOrder);
const adapted=createPageBlockFromSection(createSectionFromPageBlock(project.blocks[0]));assert.deepEqual(adapted.content.graphicObjects,content.graphicObjects);assert.deepEqual(adapted.content.objectOrder,content.objectOrder);
assert.equal(getAssetUsage(project.blocks,asset),true);assert.deepEqual(graphicOrder(content).map(o=>o.id),['legacy','shape','image','text']);
for(const mutate of [p=>p.blocks[0].content.objectOrder.push('text'),p=>p.blocks[0].content.graphicObjects[1].assetId='missing',p=>p.blocks[0].content.graphicObjects[0].frame.width=0,p=>p.blocks[0].content.graphicObjects[0].style.fill='url(x)',p=>p.blocks[0].content.graphicObjects[1].crop={x:.6,y:0,width:.6,height:1},p=>p.blocks[0].content.graphicObjects[2].frames['en-GB'].rotation=Infinity,p=>p.blocks[0].content.graphicObjects[0].visible='false']){const p=structuredClone(project);mutate(p);assert.throws(()=>validateGraphicObjects(p))}
const legacy={version:5,languages:['ja'],defaultLang:'ja',blocks:[createPageBlockFromSection({type:'image',bubbles:[{text:'unchanged',x:20,y:30}]})]};const old=hydrateProjectFromPersistence(prepareProjectForSave(legacy));assert.equal(old.blocks[0].content.graphicObjects,undefined);assert.equal(old.blocks[0].content.bubbles[0].id,undefined);
console.log('Graphic objects: persistence, language frames, legacy preservation, asset reference and malformed-input rejection passed');
