import {basicLayoutWritingModes} from './basic-layout-context.js';
import {basicLayoutSamples} from './basic-layout-samples.js';
import {workLanguageName} from './work-languages.js';
import {BASIC_PAGE_LAYOUTS,createBasicLayoutPage} from './basic-page-layouts.js';
import {drawGraphicObject} from './graphic-object-renderer.js';
import {getUILang} from './i18n-studio.js';
import '../css/studio-page-layouts.css';

let opened;
const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text)el.textContent=text;if(cls)el.className=cls;return el;};
export function openBasicPageLayouts({context,insert}) {
    if(opened){opened.focus();return;}
    const en=getUILang()==='en',label=(ja,english)=>en?english:ja,origin=document.activeElement;
    const {language,pageDirection,textDirection}=context;
    let writingMode=context.writingMode;
    let selected=BASIC_PAGE_LAYOUTS[0],file=null,previewAsset=null,previewUrl='',generation=0,busy=false;
    const dialog=node('dialog',null,'page-layout-dialog');opened=dialog;
    dialog.id='basic-page-layout-dialog';dialog.setAttribute('aria-labelledby','basic-layout-title');
    const header=node('header'),heading=node('h2',label('基本レイアウトからページを追加','Add a page from a basic layout'));
    heading.id='basic-layout-title';header.append(heading);
    const close=node('button',label('閉じる','Close'));close.type='button';close.onclick=()=>dialog.close();header.append(close);
    const hint=node('p',label('選択中のページ・原稿の後ろに、新しいページを追加します。文字・画像は追加後に編集できます。','Add a new page after the selected page or manuscript. Edit its text and images afterward.'),'page-layout-hint');
    const settings=node('div',null,'page-layout-settings');
    const languageInfo=node('p',label('原稿の言語: ','Manuscript language: ')+workLanguageName(language,en?'en':'ja')+' · '+language);
    const modeLabel=node('label',label('このページの組み方向','Writing mode for this page'));
    const modeSelect=node('select');modeSelect.id='basic-layout-writing-mode';
    for(const value of basicLayoutWritingModes(language)){
        const option=node('option',value==='vertical-rl'?label('縦書き','Vertical'):label('横書き','Horizontal'));
        option.value=value;modeSelect.append(option);
    }
    modeSelect.value=writingMode;modeLabel.append(modeSelect);
    const directionInfo=node('p',label('ページ進行: ','Page order: ')+(pageDirection==='rtl'?label('RTL（右から左）','RTL (right to left)'):label('LTR（左から右）','LTR (left to right)')));
    const inherited=node('p',context.mixed?label('選択ページは縦横混在のため、作品設定を使用しています。','The selected page mixes writing modes; using project settings.'):
        label('初期値: ','Initial settings: ')+({page:label('選択ページ','Selected page'),manuscript:label('選択原稿','Selected manuscript'),project:label('作品設定','Project settings')}[context.source]));
    const settingNote=node('p',label('組み方向の変更は追加するページだけに適用します。言語とページ進行は作品の設定を引き継ぎます。','Writing mode applies only to the new page. Language and page order follow the project.'),'page-layout-hint');
    const contextSummary=node('p',null,'page-layout-context');contextSummary.setAttribute('role','status');
    settings.append(languageInfo,modeLabel,directionInfo,inherited,settingNote,contextSummary);
    if(basicLayoutSamples(language).fallback)settings.append(node('p',label('この言語のサンプル文は未収録のため、英語の仮文を表示します。追加後に本文を置き換えてください。','Samples for this language are not available. Replace the English placeholder text after adding the page.'),'page-layout-hint'));
    const body=node('div',null,'page-layout-body'),grid=node('div',null,'page-layout-grid'),detail=node('div',null,'page-layout-detail');
    grid.setAttribute('role','group');grid.setAttribute('aria-label',label('レイアウトを選択','Choose a layout'));
    const canvas=node('canvas');canvas.width=720;canvas.height=1280;canvas.setAttribute('role','img');
    const name=node('h3'),description=node('p');
    const imageLabel=node('label',label('使う写真を選ぶ','Choose a photo'),'page-layout-image');
    const input=node('input');input.type='file';input.accept='image/*';imageLabel.append(input);
    const readNote=node('p',label('本文18・説明16以上を基準にした配置です。内容を増やすときはページを分け、最後にスマホで読みやすさを確認してください。','These layouts use body text at 18 and supporting text at 16 or larger. Add pages for longer content and check readability on a phone.'),'page-layout-hint');
    const status=node('p',null,'page-layout-status');status.setAttribute('role','status');
    const footer=node('footer'),cancel=node('button',label('キャンセル','Cancel')),add=node('button',label('このレイアウトで追加','Add this layout'),'page-layout-add');
    cancel.type=add.type='button';cancel.onclick=()=>dialog.close();footer.append(cancel,add);
    detail.append(name,canvas,description,imageLabel,readNote);body.append(grid,detail);dialog.append(header,hint,settings,body,status,footer);document.body.append(dialog);
    const cards=[];
    async function paint(target,preset,asset=null,mode=writingMode) {
        const page=createBasicLayoutPage(preset.id,{language,writingMode:mode,pageDirection,imageAsset:asset||{id:'preview',name:'Photo',width:304,height:252},idFactory:p=>p+'_'+Math.random()});
        const ctx=target.getContext('2d');ctx.save();ctx.setTransform(target.width/360,0,0,target.height/640,0,0);ctx.fillStyle='#ffffff';ctx.fillRect(0,0,360,640);
        for(const o of page.content.graphicObjects){
            if(o.kind==='image'&&!asset){
                const f=o.frame;ctx.fillStyle='#dce8ec';ctx.fillRect(f.x,f.y,f.width,f.height);
                ctx.fillStyle='#335362';ctx.font='18px sans-serif';ctx.textAlign='center';
                ctx.fillText(label('写真','Photo'),f.x+f.width/2,f.y+f.height/2);ctx.textAlign='start';
            }else await drawGraphicObject(ctx,o,asset?[asset]:[],language,language);
        }
        ctx.restore();
    }
    async function render(){
        const token=++generation,mode=writingMode,preset=selected,asset=previewAsset;
        contextSummary.textContent=workLanguageName(language,en?'en':'ja')+' / '+(mode==='vertical-rl'?label('縦書き（列は右から左）','Vertical (columns right to left)'):label('横書き・文字方向 ','Horizontal, text direction ')+textDirection.toUpperCase())+' / '+label('ページ進行 ','Page order ')+pageDirection.toUpperCase();
        name.textContent=selected.label[en?1:0];description.textContent=selected.description[en?1:0];
        canvas.setAttribute('aria-label',name.textContent+label('のプレビュー',' preview'));
        imageLabel.hidden=!selected.image;add.disabled=true;
        for(const {button,preset}of cards)button.setAttribute('aria-pressed',String(preset===selected));
        // Paint offscreen so a late image decode cannot overwrite a newer choice.
        const off=document.createElement('canvas');off.width=canvas.width;off.height=canvas.height;
        try{
            await paint(off,preset,asset,mode);
            const previews=await Promise.all(cards.map(async({preset,miniature})=>{
                const image=document.createElement('canvas');image.width=miniature.width;image.height=miniature.height;
                await paint(image,preset,null,mode);return {miniature,image};
            }));
            if(token===generation&&dialog.open){
                canvas.getContext('2d').drawImage(off,0,0);
                for(const {miniature,image}of previews)miniature.getContext('2d').drawImage(image,0,0);
                add.disabled=busy||!!selected.image&&!previewAsset;
            }
        }
        catch{if(token===generation)status.textContent=label('プレビューを表示できませんでした。写真を選び直してください。','Preview unavailable. Choose the photo again.');}
    }
    for(const preset of BASIC_PAGE_LAYOUTS){
        const button=node('button',null,'page-layout-card');button.type='button';
        const miniature=node('canvas');miniature.width=180;miniature.height=320;miniature.setAttribute('aria-hidden','true');
        button.append(miniature,node('span',preset.label[en?1:0]));button.onclick=()=>{if(busy)return;selected=preset;status.textContent='';void render();};
        cards.push({button,preset,miniature});grid.append(button);
    }
    modeSelect.onchange=()=>{writingMode=modeSelect.value;status.textContent='';void render();};
    input.onchange=async()=>{
        file=input.files?.[0]||null;previewAsset=null;
        if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl='';
        if(!file){void render();return;}
        const chosen=file,url=URL.createObjectURL(file);previewUrl=url;add.disabled=true;
        try{
            const image=new Image();image.src=url;await image.decode();
            if(file!==chosen||!dialog.open)return;
            previewAsset={id:'preview',name:file.name,background:url,width:image.naturalWidth,height:image.naturalHeight};
            status.textContent='';void render();
        }catch{if(file===chosen){file=null;status.textContent=label('この写真を読み込めません。別の画像を選んでください。','This photo could not be read. Choose another image.');void render();}}
    };
    add.onclick=async()=>{
        if(busy||selected.image&&!file)return;
        busy=true;add.disabled=true;input.disabled=true;modeSelect.disabled=true;for(const {button}of cards)button.disabled=true;
        status.textContent=label('ページを追加しています…','Adding your page…');
        try{
            const done=await insert(selected.id,selected.image?file:null,()=>dialog.open,{language,writingMode,pageDirection});
            if(done&&dialog.open)dialog.close();
            else if(dialog.open)status.textContent=label('編集中の作品や選択が変わりました。閉じて選び直してください。','The document or selection changed. Close this dialog and choose again.');
        }catch{if(dialog.open)status.textContent=label('追加できませんでした。元のページは保持されています。写真と接続を確認して再試行してください。','Could not add the page. Your existing pages are intact. Check the photo and connection, then try again.');}
        finally{busy=false;if(dialog.open){input.disabled=false;modeSelect.disabled=false;for(const {button}of cards)button.disabled=false;void render();}}
    };
    dialog.addEventListener('close',()=>{generation++;if(previewUrl)URL.revokeObjectURL(previewUrl);dialog.remove();opened=null;if(origin?.isConnected)origin.focus();},{once:true});
    dialog.showModal();void render();cards[0].button.focus();
}
