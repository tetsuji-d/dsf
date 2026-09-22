import {openSharedAuthoringSession} from '/js/shared-authoring-session.js';
import {encodeCanvasToWebP} from '/js/canvas-encoding.js';
export function createFixtureSharedEditor({root,uid,isCurrent,locale}) {
    const en=locale==='en',t=(ja,english)=>en?english:ja;
    let session=null,project=null,closed=false,opening=0,busy=false,canEdit=false,editor,save,upload,notice,gallery,timer;
    const el=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
    const current=()=>!closed&&isCurrent();
    function dispose(){closed=true;opening++;clearInterval(timer);session?.dispose();session=null;project=null;root.replaceChildren();}
    function invalidate(){dispose();root.append(el('p',t('アクセス権限が変更されました。作品を閉じました。','Access changed. This work has been closed.')));}
    function controls(){if(!editor)return;editor.readOnly=!canEdit;save.disabled=busy||!canEdit;upload.disabled=busy||!canEdit;}
    function images(){gallery.replaceChildren();for(const block of project.blocks){if(block.content?.pageKind!=='image')continue;
        const img=el('img');img.src=block.content.background;img.alt=t('作品の画像','Work image');img.style.cssText='max-width:100%;max-height:260px;object-fit:contain';gallery.append(img);}}
    const message=error=>/CONFLICT|RELOAD/.test(error.code||'')?t('別の更新があります。入力内容を控えてから作品を開き直してください。','Another edit was saved. Keep your text and reopen the work.'):
        error.code==='EDIT_FORBIDDEN'?t('現在は閲覧のみです。保存できません。','This work is now view only. Changes cannot be saved.'):
        error.code==='PRIVATE_IMAGES_REQUIRED'?t('この原稿には共有用に非公開化されていない画像が含まれています。','This manuscript contains images that have not been made private for sharing.'):
        t('処理できませんでした。接続と権限を確認してください。','Could not complete the action. Check your connection and access.');
    async function run(fn){if(busy||!current())return;busy=true;controls();try{await fn();}catch(error){if(current())notice.textContent=message(error);}finally{busy=false;if(current())controls();}}
    async function verify(){if(!session||busy||!current())return;try{const access=await session.checkAccess();if(!current())return;canEdit=access.canEdit;controls();}catch(error){if(current())notice.textContent=message(error);}}
    async function add(file){await run(async()=>{
        if(!file||!canEdit)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>25*1024*1024)throw Error('INVALID_IMAGE');
        notice.textContent=t('画像を準備しています…','Preparing image…');
        const bitmap=await createImageBitmap(file);let webp;
        try{const scale=Math.min(1,2160/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
            canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);webp=await encodeCanvasToWebP(canvas,0.9,'画像');}
        finally{bitmap.close();}
        if(!current())return;const asset=await session.addImage(webp);if(!current())return;
        project.blocks.push({id:'image_'+crypto.randomUUID(),kind:'page',content:{pageKind:'image',background:asset.url,layers:[]}});
        images();notice.textContent=t('画像を追加しました。「保存」で原稿に反映します。','Image added. Save to include it in the manuscript.');
    });}
    async function open(work){
        if(busy)return;
        session?.dispose();clearInterval(timer);closed=false;const request=++opening;project=null;root.replaceChildren();notice=el('p',t('作品を開いています…','Opening work…'));root.append(notice);
        try{
            const next=await openSharedAuthoringSession({spaceId:'space_demo',workId:work.workId,user:{uid,getIdToken:async()=>'fixture-'+uid},isCurrent:()=>current()&&opening===request,onInvalidated:()=>{if(current()&&opening===request)invalidate();}});
            if(!current()||opening!==request){next.dispose();return;}session=next;project=next.project;canEdit=next.context.canEdit;
            const textBlock=project.blocks.find(b=>b.content?.pageKind==='text');if(!textBlock)throw Error('FIXTURE_TEXT_REQUIRED');
            root.replaceChildren();root.className='shared-editor';root.append(el('h2',work.title),el('p',t('共有原稿の接続確認用エディター','Shared manuscript connection preview')));
            const mode=el('p',canEdit?t('編集可','Can edit'):t('閲覧のみ','View only'));mode.id='shared-mode';root.append(mode);
            const label=el('label',t('本文','Manuscript'));label.htmlFor='shared-text';editor=el('textarea');editor.id='shared-text';editor.rows=7;editor.value=textBlock.content.texts?.ja??textBlock.content.text??'';editor.style.cssText='width:100%;box-sizing:border-box;font:inherit;line-height:1.8';root.append(label,editor);
            gallery=el('div');gallery.id='shared-images';root.append(gallery);images();
            const buttons=el('div');buttons.className='invitation-actions';save=el('button',t('保存','Save'));save.id='shared-save';upload=el('button',t('画像を追加','Add image'));upload.id='shared-upload';
            const input=el('input');input.type='file';input.accept='image/png,image/jpeg,image/webp';input.hidden=true;input.id='shared-image-file';upload.onclick=()=>input.click();input.onchange=()=>add(input.files[0]);
            save.onclick=()=>run(async()=>{textBlock.content.text=editor.value;textBlock.content.texts={...textBlock.content.texts,ja:editor.value};
                // Fixed compatibility surfaces are regenerated by the existing persistence serializer.
                const stored=structuredClone(project);delete stored.sections;delete stored.pages;await session.save(stored);if(current())notice.textContent=t('保存しました。','Saved.');});
            const check=el('button',t('権限を確認','Check access'));check.id='shared-check';check.onclick=async()=>{await verify();if(current())mode.textContent=canEdit?t('編集可','Can edit'):t('閲覧のみ','View only');};
            const close=el('button',t('閉じる','Close'));close.onclick=dispose;buttons.append(save,upload,input,check,close);root.append(buttons);
            notice=el('p');notice.id='shared-status';notice.setAttribute('role','status');root.append(notice);controls();
            root.onpaste=e=>{const file=[...(e.clipboardData?.files||[])].find(f=>f.type.startsWith('image/'));if(file&&canEdit){e.preventDefault();add(file);}};
            timer=setInterval(()=>{if(!document.hidden)verify().then(()=>{if(current())mode.textContent=canEdit?t('編集可','Can edit'):t('閲覧のみ','View only');});},10000);
        }catch(error){session?.dispose();session=null;project=null;if(current()&&opening===request)notice.textContent=message(error);}
    }
    return {open,dispose};
}
