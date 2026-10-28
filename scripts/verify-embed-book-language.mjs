import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {mapDsfLanguagePage} from '../js/dsf-delivery-v2.js';
const source=readFileSync(new URL('../js/viewer.js',import.meta.url),'utf8');
const handler=source.slice(source.indexOf('window.switchViewerLang ='),source.indexOf('\nfunction getPageDirection()'));
const step=source.slice(source.indexOf('function stepEmbeddedReader('),source.indexOf('\nwindow.setEmbeddedReaderView='));
function fixture({book=true,session=null,direction='rtl'}={}){
 const events=[],keys=[];
 const state={languages:['ja','en'],activeLang:'ja',index:3,pages:Array(10).fill({})};
 const ctx=vm.createContext({window:{},state,embedEditionId:'test',viewerLocalPortableSession:session,
  viewerFixedTextContext:null,viewerLocalFixtureAssetUrls:null,viewerBookModel:null,viewerPreloadedImageUrls:new Set(),bookSpreadIndex:0,
  coverTurn:{cancel(){}},edgePeek:{opened:book,sourceIndex:7,handleKey(e){keys.push(e.key);}},
  readerChrome:{state:book?'book':'reading',canReadBook:()=>true,transitioning:false,changeTo(mode){events.push(mode);this.state=mode;}},
  getIndex:()=>state.index,actionTypes:{SET_ACTIVE_LANG:'lang',SET_ACTIVE_INDEX:'index',SET_STATE_FIELD:'field'},
  dispatch({type,payload}){if(type==='lang')state.activeLang=payload;if(type==='index')state.index=payload;if(type==='field')state[payload.key]=payload.value;},
  mapDsfLanguagePage,buildViewerBookModel:()=>({}),syncViewerAutoSpreadMode(){},findBookUnitIndexForPage:i=>i,
  closeViewerLangMenu(){},renderViewerLanguagePicker(){},refresh(){events.push('refresh');ctx.readerChrome.state='reading';},
  queueBookmarkSave(){},trackPageView(){},noteEmbedPageTurn(){},getPageDirection:()=>state.activeLang==='ja'?direction:(direction==='rtl'?'ltr':'rtl'),goNext(){events.push('next');},goPrev(){events.push('prev');}
 });
 vm.runInContext(handler+'\n'+step,ctx);return {ctx,state,events,keys};
}
for(const direction of ['ltr','rtl']){
 const f=fixture({direction});f.ctx.stepEmbeddedReader(1);f.ctx.stepEmbeddedReader(-1);
 assert.deepEqual(f.keys,direction==='rtl'?['ArrowLeft','ArrowRight']:['ArrowRight','ArrowLeft']);
 f.ctx.window.switchViewerLang('en');assert.equal(f.state.index,7,'current curved page survives instead of stale start index');
 assert.deepEqual(f.events,['refresh','book']);assert.equal(f.state.activeLang,'en');
 f.ctx.stepEmbeddedReader(1);assert.equal(f.keys[2],direction==='rtl'?'ArrowRight':'ArrowLeft','language change uses the new binding direction');
}
const anchor=n=>({sourceAnchor:{kind:'fixed',blockId:`p${n}`}});
const session={contextsByLanguage:new Map([['en',{}]]),assetUrls:[],project:{},
 manifests:{ja:{pages:Array.from({length:10},(_,i)=>anchor(i))},en:{pages:[anchor(0),anchor(1),anchor(7),anchor(9)]}},
 pagesByLanguage:new Map([['en',Array(4).fill({})]])};
{
 const f=fixture({session});f.ctx.window.switchViewerLang('en');
 assert.equal(f.state.index,2,'different page counts use the visible page anchor');assert.equal(f.state.pages.length,4);assert.deepEqual(f.events,['refresh','book']);
}
{
 const f=fixture({book:false});f.ctx.window.switchViewerLang('en');assert.equal(f.state.index,3);assert.deepEqual(f.events,['refresh']);
 f.ctx.window.switchViewerLang('missing');assert.equal(f.state.activeLang,'en');
}
console.log('Embed LTR/RTL navigation, language mode/position retention and unequal language page counts passed.');
