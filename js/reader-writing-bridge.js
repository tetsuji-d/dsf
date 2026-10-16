import {installWritingLocale,writingUiText} from './reader-writing-i18n.js';
import {getPlatformLanguage,subscribePlatformLanguage} from './ui-language.js';
/** Prevent browser viewport gestures only on the active Writing surface, not Reader or dialogs. */
export function installWritingViewportGuards(document,isActive){
    const inDialog=e=>e.composedPath().some(node=>node.matches?.('dialog,[role=dialog]'));
    // Safari gestures can zoom the whole visual viewport, independently of Reader's page transform.
    for(const type of ['gesturestart','gesturechange'])document.addEventListener(type,e=>{if(isActive()&&!inDialog(e))e.preventDefault();},{passive:false});
    document.addEventListener('touchmove',e=>{if(isActive()&&e.touches.length>1&&!inDialog(e))e.preventDefault();},{passive:false});
    document.addEventListener('wheel',e=>{if(isActive()&&e.ctrlKey&&!inDialog(e))e.preventDefault();},{passive:false});
}
/** Native Reader overlay. The existing Reader remains responsible for page rendering and navigation. */
export function createReaderWritingBridge({button,read,onReturn,view,turn,goTo,onMode,resetView,textView}) {
    let container,editor,opening=false,finishing=false,frame,menu,menuLocale,source,syncing=false;
    const t=source=>writingUiText(source,getPlatformLanguage('viewer'));
    const updateButtonLabel=()=>{button.title=t(editor?'書き込みを終了してReaderに戻る':read()?.locked?'共有用DSFは書き込みロックされています':'書き込み / Writing');button.setAttribute('aria-label',button.title);};
    subscribePlatformLanguage(updateButtonLabel);
    installWritingViewportGuards(document,()=>!!editor);
    function updateLayers(){
        if(!editor)return;
        for(const paper of document.querySelectorAll('#viewer-content [data-writing-page],#viewer-spread-content [data-writing-page]')){
            const parent=paper.parentElement;
            for(const old of parent.querySelectorAll(':scope > .reader-writing-saved-layer'))old.remove();
            paper.insertAdjacentHTML('afterend',editor.layer(paper.dataset.writingPage,read()?.language));
        }
    }
    async function tick(){
        if(!editor)return;
        const snapshot=view();document.body.classList.toggle('reader-writing-turning',snapshot.suspended);
        if(!syncing){syncing=true;try{await editor.sync(snapshot);}catch(error){editor?.notice(error.message);}finally{syncing=false;}}
        if(editor)frame=requestAnimationFrame(tick);
    }
    function cleanup(){
        textView?.(null);
        cancelAnimationFrame(frame);editor?.dispose();editor=null;container?.remove();container=null;menuLocale?.dispose();menu?.remove();menu=null;source=null;
        document.body.classList.remove('reader-writing-active','reader-writing-turning');onMode(false);
        document.getElementById('viewer-reader-controls')?.scrollTo({left:0});
        button.removeAttribute('aria-pressed');button.title=t('書き込み / Writing');button.setAttribute('aria-label',button.title);button.focus();
    }
    async function finish(){
        if(!editor||opening||finishing)return false;
        finishing=true;button.disabled=true;
        try{const result=await editor.finish();await onReturn(result);cleanup();return true;}
        catch(error){editor?.notice(error.message||'Readerに戻せませんでした。書き込みは保持しています。');return false;}
        finally{finishing=false;button.disabled=false;}
    }
    function addMenu(){
        const appMenu=document.getElementById('platform-app-menu');if(!appMenu)return;
        menu=document.createElement('nav');menu.className='reader-writing-menu';menu.setAttribute('aria-label','Writing');
        for(const [label,panel] of [['書き込みを保存・書き出し','save'],['書き込みの設定','settings'],['書き込みの履歴','history'],['Readerに戻る','exit']]){
            const b=document.createElement('button');b.type='button';b.textContent=label;
            b.onclick=()=>{appMenu.close();if(panel==='exit')void finish();else editor.panel(panel);};menu.append(b);
        }
        appMenu.querySelector('header').after(menu);
        menuLocale=installWritingLocale(menu);
    }
    async function open(){
        if(editor){await finish();return;}
        if(opening)return;source=read();if(!source?.file||source.locked)return;
        opening=true;button.disabled=true;
        try{
            const moduleUrl='/writing/reader-writing.mjs';
            const [module,response]=await Promise.all([import(/* @vite-ignore */ moduleUrl),fetch('/writing/')]);
            if(!response.ok)throw Error('Writingを読み込めませんでした。');
            const html=new DOMParser().parseFromString(await response.text(),'text/html');
            html.querySelectorAll('script').forEach(node=>node.remove());
            container=document.createElement('dsf-writing-overlay');container.id='reader-writing-overlay';container.style.visibility='hidden';
            const root=container.attachShadow({mode:'open'});
            const styles=['/writing/writing.css','/writing/native-writing.css'].map(href=>new Promise((resolve,reject)=>{
                const link=document.createElement('link');link.rel='stylesheet';link.href=href;
                const timer=setTimeout(()=>reject(Error('Writingの表示設定を読み込めませんでした。')),20000);
                link.onload=()=>{clearTimeout(timer);resolve();};link.onerror=()=>{clearTimeout(timer);reject(Error('Writingの表示設定を読み込めませんでした。'));};root.append(link);
            }));
            root.append(...html.body.childNodes);document.body.append(container);await Promise.all(styles);
            editor=await module.mountReaderWriting(root,{turn,goTo,view,changed:updateLayers,resetView,textView});
            await editor.open(source);
            button.after(container);
            document.body.classList.add('reader-writing-active');onMode(true);addMenu();updateLayers();
            button.setAttribute('aria-pressed','true');button.setAttribute('aria-label',t('書き込みを終了してReaderに戻る'));
            await tick();container.style.visibility='';
        }catch(error){cleanup();window.alert(t(error.message||'Writingを開始できませんでした。'));}
        finally{opening=false;button.disabled=false;}
    }
    button.addEventListener('click',()=>void open());
    return {
        get active(){return !!editor||opening;},
        layer(pageId,lang){return editor?.layer(pageId,lang);},
        async beforeFile(){if(opening)return false;return !editor||finishing||await finish();},
        sync(){const current=read();button.hidden=!current?.file;button.disabled=opening||finishing||!!current?.locked;updateButtonLabel();}
    };
}
