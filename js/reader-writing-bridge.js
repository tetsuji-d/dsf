import {installWritingLocale,writingUiText} from './reader-writing-i18n.js';
import {getPlatformLanguage,subscribePlatformLanguage} from './ui-language.js';
import {writingExportName,mountWritingFileExport} from './reader-writing-file-save.js';
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
    let container,editor,opening=false,finishing=false,frame,menu,menuLocale,source,syncing=false,chromePromise,warmScheduled=false,toolsVisible=true,exitPending;
    const t=source=>writingUiText(source,getPlatformLanguage('viewer'));
    const updateButtonLabel=()=>{button.title=t(opening?'Writingを準備しています…':editor?(toolsVisible?'道具を隠す。長押しでReaderに戻る':'道具を表示。長押しでReaderに戻る'):read()?.locked?'共有用DSFは書き込みロックされています':'書き込み / Writing');button.setAttribute('aria-label',button.title);button.setAttribute('aria-expanded',String(!!editor&&toolsVisible));};
    function loadChrome(){
        const moduleUrl='/writing/reader-writing.mjs';
        if(!chromePromise)chromePromise=Promise.all([import(/* @vite-ignore */ moduleUrl).then(async module=>{await module.warmWritingRuntime();return module;}),fetch('/writing/').then(async r=>{if(!r.ok)throw Error('Writingを読み込めませんでした。');return r.text();}),...['/writing/writing.css','/writing/native-writing.css'].map(url=>fetch(url).then(r=>{if(!r.ok)throw Error('Writingの表示設定を読み込めませんでした。');return r.text();}))]).catch(error=>{chromePromise=null;throw error;});
        return chromePromise;
    }
    function warm(){if(warmScheduled||!read()?.file)return;warmScheduled=true;setTimeout(()=>void loadChrome().catch(()=>{warmScheduled=false;}),250);}
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
        button.removeAttribute('aria-pressed');updateButtonLabel();button.focus({preventScroll:true});
    }
    async function exitChoice(){
        const dialog=document.createElement('dialog');dialog.className='reader-writing-exit';dialog.setAttribute('aria-labelledby','writing-exit-title');
        const title=document.createElement('h2');title.id='writing-exit-title';title.textContent=t('書き込みを保存しますか？');
        const message=document.createElement('p');message.textContent=t('元のファイルを自動で上書きすることはありません。保存せず戻っても、書き込みはReaderと端末内の下書きに残ります。');
        const actions=document.createElement('div');dialog.append(title,message,actions);document.body.append(dialog);
        return new Promise(resolve=>{
            let fileExport,preparing=false;const done=value=>{fileExport?.dispose();dialog.close();dialog.remove();resolve(value);};
            const add=(label,action)=>{const b=document.createElement('button');b.type='button';b.textContent=t(label);b.onclick=action;actions.append(b);return b;};
            add('編集用DSFRを保存',async()=>{
                preparing=true;for(const b of actions.children)b.disabled=true;message.textContent=t('保存ファイルを準備しています…');
                try{const result=await editor.finish(),exportArea=document.createElement('div');
                    fileExport=mountWritingFileExport(exportArea,{bytes:result.bytes,name:writingExportName(source?.file?.name),t,
                        confirmLabel:'保存したのでReaderに戻る',onConfirm:()=>done(result)});
                    actions.replaceChildren(exportArea);add('書き込みを続ける',()=>done(null));message.textContent=t('保存ファイルを用意しました。保存後、この画面に戻ってください。');
                    exportArea.querySelector('button:not([hidden]),a').focus();
                }catch(error){message.textContent=t(error.message);for(const b of actions.children)b.disabled=false;}finally{preparing=false;}
            });
            add('ファイルに保存せず戻る',()=>done('return'));
            add('書き込みを続ける',()=>done(null));
            dialog.addEventListener('keydown',e=>e.stopPropagation());
            dialog.addEventListener('cancel',e=>{e.preventDefault();if(!preparing)done(null);});dialog.showModal();
        });
    }
    async function finish(){
        if(!editor||opening||finishing)return false;
        if(exitPending)return false;
        if(editor.hasChanges){exitPending=true;let choice;try{choice=await exitChoice();}finally{exitPending=false;}if(!choice)return false;if(choice!=='return')return complete(choice);}
        return complete();
    }
    async function complete(prepared){
        finishing=true;button.disabled=true;
        try{const result=prepared||await editor.finish();await onReturn(result);cleanup();return true;}
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
        if(editor&&!opening){editor.toggleTools();return;}
        if(opening)return;source=read();if(!source?.file||source.locked)return;
        opening=true;button.disabled=true;button.setAttribute('aria-busy','true');updateButtonLabel();
        try{
            const [module,markup]=await loadChrome();
            const html=new DOMParser().parseFromString(markup,'text/html');
            html.querySelectorAll('script').forEach(node=>node.remove());
            container=document.createElement('dsf-writing-overlay');container.id='reader-writing-overlay';container.style.visibility='hidden';
            const root=container.attachShadow({mode:'open'});
            const styles=['/writing/writing.css','/writing/native-writing.css'].map(href=>new Promise((resolve,reject)=>{
                const link=document.createElement('link');link.rel='stylesheet';link.href=href;
                const timer=setTimeout(()=>reject(Error('Writingの表示設定を読み込めませんでした。')),20000);
                link.onload=()=>{clearTimeout(timer);resolve();};link.onerror=()=>{clearTimeout(timer);reject(Error('Writingの表示設定を読み込めませんでした。'));};root.append(link);
            }));
            root.append(...html.body.childNodes);document.body.append(container);await Promise.all(styles);
            editor=await module.mountReaderWriting(root,{turn,goTo,view,changed:updateLayers,resetView,textView,toolsVisibility:visible=>{toolsVisible=visible;updateButtonLabel();}});
            toolsVisible=true;container.dataset.preparing='true';container.dataset.loadingLabel=t('Writingを準備しています…');
            document.body.classList.add('reader-writing-active');onMode(true);editor.prepare();container.style.visibility='';
            await editor.open(source);
            delete container.dataset.preparing;addMenu();updateLayers();
            button.setAttribute('aria-pressed','true');
            await tick();container.style.visibility='';
        }catch(error){cleanup();window.alert(t(error.message||'Writingを開始できませんでした。'));}
        finally{opening=false;button.disabled=false;button.removeAttribute('aria-busy');updateButtonLabel();}
    }
    let holdTimer,held=false,start;
    const cancelHold=()=>clearTimeout(holdTimer);
    button.addEventListener('pointerdown',e=>{held=false;if(!editor||opening||e.button!==0)return;start=[e.clientX,e.clientY];holdTimer=setTimeout(()=>{held=true;void finish();},550);});
    button.addEventListener('pointermove',e=>{if(start&&Math.hypot(e.clientX-start[0],e.clientY-start[1])>10)cancelHold();});
    for(const name of ['pointerup','pointercancel','pointerleave'])button.addEventListener(name,cancelHold);
    button.addEventListener('click',e=>{if(held){e.preventDefault();held=false;return;}void open();});
    button.addEventListener('contextmenu',e=>{e.preventDefault();cancelHold();if(editor&&!exitPending)void finish();});
    button.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.shiftKey){e.preventDefault();void finish();}});
    button.addEventListener('pointerenter',()=>void loadChrome().catch(()=>{}));
    return {
        get active(){return !!editor||opening;},
        layer(pageId,lang){return editor?.layer(pageId,lang);},
        async beforeFile(){if(opening)return false;return !editor||finishing||await finish();},
        sync(){const current=read();button.hidden=!current?.file;button.disabled=opening||finishing||!!current?.locked;updateButtonLabel();warm();}
    };
}
