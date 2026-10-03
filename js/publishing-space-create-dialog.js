/** Explicit opening flow, shared by Dashboard and the Horizon publication dialog. */
export function openPublishingSpaceCreation({request, getLocale, isCurrent = () => true}) {
    const en = getLocale() === 'en';
    const t = en ? {
        eyebrow:'PUBLISHING SPACE', title:'Create your publishing home', intro:'Make a place of your own among the publishing spaces across Horizon.',
        about:'A home for your publications', features:['Organize your manuscripts and published works.','Give your space an icon, a banner and an introduction.','Choose this space when publishing on Horizon.'],
        note:'Add your visual identity in the space profile after opening.', steps:['Name your space','Review and create'],
        name:'Publishing space name', placeholder:'e.g. Lighthouse Press', nameHint:'Use your own name, a circle or a business name. You can change it later.',
        preview:'Your publishing space', review:'Review your new space', owner:'Managed by', ownerValue:'Your signed-in account',
        payment:'Payment for this action', paymentValue:'No payment or paid subscription', next:'After opening', nextValue:'Add works and set up your space profile. Publishing is a separate action.',
        confirm:'Create this publishing space', continue:'Review details', back:'Back', cancel:'Cancel',
        working:'Creating your space…', error:'Could not finish opening the space. Retry with the same details.',
        conflict:'Your spaces changed in another window. The list has been refreshed. Review and retry.', expired:'Your account or manuscript changed. Close this window and try again.',
    } : {
        eyebrow:'PUBLISHING SPACE', title:'あなたの出版拠点をつくる', intro:'たくさんの出版スペースが広がるHorizonに、あなたの場所を。',
        about:'出版スペースでできること', features:['原稿と発行した作品を、ひとつの場所で管理。','アイコン・背景・概要で、あなたらしい拠点に。','Horizonへの発行時に、作品の所属先として選択。'],
        note:'アイコン・背景・概要は、開設後の「基本情報」で設定できます。', steps:['名前を決める','開設内容を確認'],
        name:'出版スペース名', placeholder:'例：灯台出版', nameHint:'個人名・サークル名・事業名など。名前は後から変更できます。',
        preview:'あなたの出版スペース', review:'この内容で開設します', owner:'管理するアカウント', ownerValue:'現在ログイン中のあなた',
        payment:'今回のお支払い', paymentValue:'お支払い・有料プランの契約はありません', next:'開設後の流れ', nextValue:'作品の追加や基本情報の設定へ進めます。作品の発行は別途操作します。',
        confirm:'この内容で開設', continue:'内容を確認', back:'戻る', cancel:'キャンセル',
        working:'出版スペースを開設しています…', error:'開設を完了できませんでした。同じ内容で再試行できます。',
        conflict:'別の画面で更新されました。最新の一覧を取得したので、内容を確認して再試行してください。', expired:'アカウントまたは原稿が切り替わりました。閉じてやり直してください。',
    };
    const el = (tag, text, className) => { const node=document.createElement(tag); if(text)node.textContent=text; if(className)node.className=className; return node; };
    const dialog=el('dialog',null,'space-opening-dialog');dialog.setAttribute('aria-label',t.title);
    const aside=el('aside',null,'space-opening-intro');aside.append(el('span',t.eyebrow,'space-opening-eyebrow'),el('h2',t.title),el('p',t.intro));
    // An illustrative Horizon landscape, not a count or map of actual publishers.
    const scene=el('div',null,'space-opening-horizon');scene.setAttribute('role','img');
    scene.setAttribute('aria-label',en?'Your new space joins the many publishing spaces on Horizon.':'Horizonに点在する出版スペースの中に、新しいスペースが加わるイメージ');
    scene.append(el('span','HORIZON','space-opening-horizon-word'));
    for(let i=0;i<48;i++){
        const depth=i/47, node=el('span',null,'space-opening-neighbor');
        const x=3+((i*37+11)%94), y=26+depth*62;
        // Leave a clear area around the new space in the foreground.
        if(x>36 && x<80 && y>50)continue;
        node.style.setProperty('--x',x+'%');node.style.setProperty('--y',y+'%');
        node.style.setProperty('--size',(3+depth*16)+'px');node.style.setProperty('--opacity',String(.22+depth*.42));
        if(i%5===0)node.classList.add('is-warm');scene.append(node);
    }
    const newSpace=el('div',null,'space-opening-new-space'),spaceMark=el('span','+');newSpace.append(spaceMark);scene.append(newSpace);
    const spaceCaption=el('span',en?'YOUR SPACE':'あなたのスペース','space-opening-horizon-caption');scene.append(spaceCaption);aside.append(scene);
    aside.append(el('h3',t.about));const features=el('ul');for(const text of t.features)features.append(el('li',text));aside.append(features);
    const main=el('div',null,'space-opening-main'), steps=el('ol',null,'space-opening-steps');for(const text of t.steps)steps.append(el('li',text));
    const form=el('form');form.dataset.spaceOpeningForm='';
    const inputArea=el('div'),label=el('label',t.name),name=el('input');name.name='name';name.required=true;name.maxLength=80;name.autocomplete='off';name.placeholder=t.placeholder;label.append(name);
    inputArea.append(label,el('p',t.nameHint,'space-opening-muted'));
    const preview=el('div',null,'space-opening-preview'),initial=el('span','D','space-opening-initial'),displayName=el('strong',t.preview);preview.append(initial,displayName);inputArea.append(preview,el('p',t.note,'space-opening-muted'));
    const review=el('section');review.append(el('h3',t.review));const reviewName=el('p',null,'space-opening-review-name');review.append(reviewName);
    const list=el('dl');for(const [key,value] of [[t.owner,t.ownerValue],[t.payment,t.paymentValue],[t.next,t.nextValue]])list.append(el('dt',key),el('dd',value));review.append(list);
    const paymentNote=el('p',t.paymentValue,'space-opening-payment');inputArea.append(paymentNote);
    const status=el('p',null,'space-opening-status');status.setAttribute('role','status');
    const actions=el('div',null,'space-opening-actions'),cancel=el('button',t.cancel),back=el('button',t.back),submit=el('button',t.continue,'space-opening-primary');
    cancel.type=back.type='button';submit.type='submit';actions.append(cancel,back,submit);form.append(inputArea,review,status,actions);main.append(steps,form);dialog.append(aside,main);
    let step=0,busy=false,closed=false,command=null;
    return new Promise(resolve=>{
        const finish=result=>{if(closed)return;closed=true;dialog.close();dialog.remove();resolve(result);};
        const current=()=>{if(closed || !isCurrent())throw new Error('AUTH_CHANGED');};
        function render(){
            inputArea.hidden=step!==0;review.hidden=step!==1;name.required=step===0;back.hidden=step===0;
            [...steps.children].forEach((node,i)=>{if(i===step)node.setAttribute('aria-current','step');else node.removeAttribute('aria-current');});
            for(const control of [name,cancel,back,submit])control.disabled=busy;
            submit.textContent=busy?t.working:step===0?t.continue:t.confirm;
            reviewName.textContent=name.value.trim();
        }
        name.oninput=()=>{displayName.textContent=name.value.trim()||t.preview;initial.textContent=Array.from(name.value.trim())[0]||'D';spaceMark.textContent=Array.from(name.value.trim())[0]||'+';spaceCaption.textContent=name.value.trim()||(en?'YOUR SPACE':'あなたのスペース');name.setCustomValidity('');};
        cancel.onclick=()=>finish(null);back.onclick=()=>{step=0;status.textContent='';render();name.focus();};
        dialog.addEventListener('cancel',e=>{e.preventDefault();if(!busy)finish(null);});
        form.onsubmit=async event=>{
            event.preventDefault();if(busy)return;
            const value=name.value.trim();if(!value){name.setCustomValidity(t.name);name.reportValidity();return;}
            if(step===0){step=1;render();submit.focus();return;}
            busy=true;status.textContent='';render();
            try{
                current();
                if(!command || command.name!==value){const catalogue=await request();current();command={kind:'create',name:value,spaceId:'space_'+crypto.randomUUID(),baseRevision:catalogue.revision};}
                const catalogue=await request(command);current();finish({spaceId:command.spaceId,catalogue});
            }catch(error){
                if(error.message==='SPACE_CONFLICT'){
                    try{const catalogue=await request();current();if(command)command.baseRevision=catalogue.revision;status.textContent=t.conflict;}
                    catch{status.textContent=isCurrent()?t.error:t.expired;}
                }else status.textContent=error.message==='AUTH_CHANGED'?t.expired:t.error;
            }finally{busy=false;if(!closed)render();}
        };
        document.body.append(dialog);render();dialog.showModal();name.focus();
    });
}
