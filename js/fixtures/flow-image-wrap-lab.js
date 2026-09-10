import {createFlowDocument} from '../flow-document.js';
import {createCanonicalFlowPageBox} from '../flow-pagination.js';
import {waitForFlowFonts} from '../flow-dom-measurer.js';
import {composeAnchoredFlowExperiment,renderAnchoredFlowExperiment,createWrapRegions,verifyWrapSourceCoverage} from './flow-wrap-composition.js';
if(!import.meta.env.DEV) throw new Error('Development fixture only');
const $=id=>document.getElementById(id);
const sentence='海からの風が、開いた窓を通り抜けた。小さな船が港へ戻ってくる。日差しは穏やかで、波の音だけが部屋に届いていた。';
const anchored='遠くに白い灯台が見える。私は机の上の手紙をそっと開いた。紙には懐かしい街の名前が書かれていた。あの日に交わした約束を、今でも覚えている。';
const history=[];
let showAnnotations=false;
function makeDocument(before=sentence.repeat(9),anchor=anchored.repeat(6)) {
    return createFlowDocument({id:'wrap-document',sourceLanguage:'ja',sections:[{id:'chapter',blocks:[
        {id:'before',type:'paragraph',texts:{ja:before}},
        {id:'anchor',type:'paragraph',texts:{ja:anchor}},
        {id:'after',type:'paragraph',texts:{ja:sentence.repeat(12)}},
    ]}]});
}
const typography={fontFamily:'"Yu Mincho", serif',fontSize:16,lineHeight:1.6,letterSpacing:0,paragraphSpacing:8,textAlign:'start'};
const canvas=document.createElement('canvas');canvas.width=800;canvas.height=1000;
const ctx=canvas.getContext('2d');ctx.fillStyle='#a6ccd2';ctx.fillRect(0,0,800,1000);ctx.fillStyle='#f7e1ae';ctx.beginPath();ctx.arc(170,180,85,0,Math.PI*2);ctx.fill();
ctx.fillStyle='#548992';ctx.fillRect(0,510,800,490);ctx.fillStyle='#506f69';ctx.beginPath();ctx.moveTo(420,1000);ctx.lineTo(540,620);ctx.lineTo(800,675);ctx.lineTo(800,1000);ctx.fill();ctx.fillStyle='#f8e8c8';ctx.fillRect(590,265,95,390);ctx.fillStyle='#bc695b';ctx.fillRect(590,370,95,45);ctx.fillRect(590,480,95,45);ctx.beginPath();ctx.moveTo(570,265);ctx.lineTo(638,185);ctx.lineTo(700,265);ctx.fill();
const imageUrl=canvas.toDataURL('image/webp',0.9);
function options(overrides={}) {
    const position=$('position').value;
    return {pageBox:createCanonicalFlowPageBox({padding:24}),writingMode:$('writing').value,languageKey:'ja',typography,
        object:{id:'harbor-image',anchorBlockId:'anchor',x:position==='left'?24:position==='center'?114:204,
            y:position==='center'?230:56,width:132,height:176,gap:+$('gap').value,wrap:$('wrap').value},...overrides};
}
let timer;
function run(){
    clearTimeout(timer);$('status').textContent='実測して再ページ化しています…';
    const source=makeDocument($('before').value,$('anchor').value), start=performance.now();
    if(showAnnotations){
        source.schemaVersion=2;
        const block=source.sections[0].blocks[1], list=[];
        for(const [word,type,value] of [['灯台','ruby','とうだい'],['約束','emphasis','sesame']]){
            const start=block.texts.ja.indexOf(word);
            if(start>=0)list.push({id:'sample-'+type,type,start,end:start+word.length,
                ...(type==='ruby'?{reading:value}:{mark:value})});
        }
        block.annotations={ja:list};
    }
    try {
        const result=composeAnchoredFlowExperiment(source,options());
        $('pages').replaceChildren();$('pages').style.flexDirection=result.writingMode==='vertical-rl'?'row-reverse':'row';
        for(const page of result.pages){const slot=document.createElement('section');slot.className='slot'+(page.object?' anchored':'');
            const surface=document.createElement('div');surface.className='page';renderAnchoredFlowExperiment(surface,result,page,imageUrl);
            const caption=document.createElement('div');caption.className='caption';caption.textContent=(page.index+1)+' · 本文'+(page.object?'　⚓ 灯台の段落':'');slot.append(surface,caption);$('pages').append(slot);}
        const page=result.pages.find(p=>p.object).index+1;
        $('status').dataset.error='false';$('status').textContent=`本文の欠落・重複なし · ${result.pages.length}ページ · 画像と段落：${page}ページ · ${Math.round(performance.now()-start)} ms`;
        window.wrapLab.result=result;window.wrapLab.source=source;
        document.querySelector('.slot.anchored')?.scrollIntoView({block:'nearest',inline:'center'});
    } catch(error){window.wrapLab.result=null;$('pages').replaceChildren();$('status').dataset.error='true';
        $('status').textContent=error.code==='UNSUPPORTED_COMPOSITION_FEATURE'?'今回の検証では未対応の組版設定です。':'この配置では組版を完了できません。画像の位置や余白を変更してください。';
        console.error('Wrap experiment failed:',error.code||error.name);}
}
window.wrapLab={makeDocument,options,compose:composeAnchoredFlowExperiment,render:renderAnchoredFlowExperiment,createWrapRegions,verifyWrapSourceCoverage,imageUrl,run};
function reset(){$('before').value=sentence.repeat(9);$('anchor').value=anchored.repeat(6);history.length=0;run();}
$('before').oninput=$('anchor').oninput=()=>{clearTimeout(timer);timer=setTimeout(run,250);};
for(const id of ['writing','wrap','position','gap'])$(id).onchange=run;
$('more').onclick=()=>{history.push($('before').value);$('before').value+=sentence.repeat(10);run();};
$('less').onclick=()=>{if(history.length){$('before').value=history.pop();run();}};
$('annotations').onclick=()=>{showAnnotations=!showAnnotations;$('annotations').setAttribute('aria-pressed',showAnnotations);run();};
$('reset').onclick=()=>{showAnnotations=false;$('annotations').setAttribute('aria-pressed','false');reset();};
await waitForFlowFonts(document,typography,'vertical-rl','ja');reset();
