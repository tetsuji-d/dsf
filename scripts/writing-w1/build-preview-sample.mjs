import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {nodeRuntime} from './node-runtime.mjs';
import {originalFixture} from './fixture.mjs';
import {createDsfV3Original,loadDsfV3} from '../../js/dsf-writing-package.js';
const options=await nodeRuntime(),fixture=originalFixture(options.catalog);
const titles=['Writing の操作サンプル','見開きの右ページ','見開きの左ページ','文字を直接入力','筆ペン・マーカーを試す','重ね順とロックを試す','保存と読み直しを試す','サンプルの裏表紙'];
const notes=['表紙から次へ進むと見開きになります。','左ページまで線を引いてみてください。','二つのページをまたいで書き込めます。','文字を選び、ページ上に枠を描きます。','道具をもう一度押すと設定が開きます。','レイヤーで選択・並べ替えができます。','書き込みは原本とは別に保存されます。','原稿本体の内容は変更されません。'];
const pages=titles.map((title,i)=>({id:`page${i+1}`,pageLabel:String(i+1),renderKind:'fixedText',sourceAnchor:{kind:'fixed',blockId:`sample-block-${i+1}`},background:{color:i===0||i===7?'#eaf1ed':i%2?'#fffdf8':'#f2f6fa'},
    lines:[{x:24,y:40,width:312,height:36,writingMode:'horizontal-tb',textOrientation:'mixed',styleRef:'s1',runs:[{text:title}]},
        {x:24,y:90,width:312,height:36,writingMode:'horizontal-tb',textOrientation:'mixed',styleRef:'hint',runs:[{text:notes[i]}]},
        {x:24,y:572,width:312,height:30,writingMode:'horizontal-tb',textOrientation:'mixed',styleRef:'hint',runs:[{text:`${i+1} / 8　自由に書き込める練習ページ`}]}]}));
fixture.meta={...fixture.meta,workId:'writing-eight-page-sample',releaseId:'writing-eight-page-v1',title:'Writing 操作サンプル',presentation:{spread:'auto'}};
fixture.bundle.manifests.ja.styles.hint={...fixture.bundle.manifests.ja.styles.s0,fontSize:13};
fixture.bundle.manifests.ja.pages=pages;fixture.bundle.index.languages.ja.pageCount=pages.length;
const result=await createDsfV3Original(fixture,options),read=await loadDsfV3(result.bytes,options);
if(read.bundle.manifests.ja.pages.length!==8||read.copyKind!=='original')throw Error('Invalid preview sample');
await writeFile(new URL('../../outputs/writing-w1/preview-sample.dsf',import.meta.url),result.bytes);
console.log(JSON.stringify({pages:8,bytes:result.bytes.length,sha256:createHash('sha256').update(result.bytes).digest('hex')}));
