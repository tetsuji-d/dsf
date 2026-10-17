import {dsfFilename} from './file-extensions.js';

// Keep an opened reader filename; legacy extensions migrate without changing the archive format.
export function writingExportName(sourceName='',title='DSF',shared=false) {
    const source=String(sourceName).replace(/\.zip$/i,'');
    const name=/\.(dsfr|dsf)$/i.test(source)?source:(title||'DSF');
    if(shared)return dsfFilename(name.replace(/\.(dsfr|dsf)$/i,'')+'-shared');
    return /\.dsfr$/i.test(name)?name.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_'):dsfFilename(name);
}

export function prepareWritingFileExport(bytes,name,nav=globalThis.navigator) {
    const file=new File([bytes],name,{type:'application/octet-stream'});
    // Desktop OS sharing is not a reliable file-save destination. Keep Files sharing on phones/tablets.
    const mobile=/Android|iPhone|iPad|iPod/i.test(nav?.userAgent||'')||nav?.platform==='MacIntel'&&nav?.maxTouchPoints>1;
    let canShare=false;
    try{canShare=typeof nav?.share==='function'&&nav.canShare?.({files:[file]})===true;}catch{}
    return {file,canShare,mobile,
        async share(){
            if(!canShare)return 'unavailable';
            // Invoke share before any await: Safari requires the button's user activation.
            try{await nav.share({files:[file]});return 'shared';}
            catch(error){return error.name==='AbortError'?'cancelled':'failed';}
        }
    };
}

// A browser hand-off is not proof of a file being saved. Only the user's confirmation completes it.
export function mountWritingFileExport(container,{bytes,name,t=s=>s,onConfirm,confirmLabel='ファイルに保存しました',download}) {
    const doc=container.ownerDocument,prepared=prepareWritingFileExport(bytes,name);
    const showShare=prepared.mobile&&prepared.canShare;
    const url=URL.createObjectURL(prepared.file);
    let active=true,pending=false,handedOff=false;
    const make=(tag,text)=>{const el=doc.createElement(tag);el.textContent=t(text);return el;};
    const filename=make('p','');filename.textContent=name;filename.className='writing-export-name';filename.translate=false;filename.setAttribute('data-writing-user-label','');
    const guide=make('p',showShare
        ?'「保存・共有」を押し、次の画面で「“ファイル”に保存」を選んでください。'
        :prepared.mobile?'ダウンロード後にプレビューが開いた場合は、「次の方法で開く」または共有ボタンから「“ファイル”に保存」を選んでください。'
        :'「ダウンロードで保存」を押してください。ブラウザーの設定に応じて、保存先の選択画面が開くか、ダウンロードフォルダに保存されます。');
    const replace=make('p','上書きしたい場合は、元と同じフォルダ・ファイル名で保存し、置き換え確認が出たら承認してください。');
    const status=make('p','');status.setAttribute('role','status');
    const confirm=make('button',confirmLabel);confirm.type='button';confirm.hidden=true;
    confirm.onclick=()=>{if(active&&!pending&&handedOff)onConfirm?.();};
    const share=make('button','保存・共有');share.type='button';share.hidden=!showShare;
    const link=download||make('a','');link.textContent=t('ダウンロードで保存');
    link.className='button writing-export-download';link.href=url;link.download=name;link.hidden=false;
    const downloadHint=make('p','共有メニューが使えない場合はこちら');downloadHint.hidden=!showShare;
    link.onclick=e=>{
        if(!active||pending){e.preventDefault();return;}
        handedOff=true;confirm.hidden=false;
        status.textContent=t('保存先で保存を完了してください。この画面では保存結果を確認できません。');
    };
    share.onclick=async()=>{
        if(!active||pending||!showShare)return;
        pending=true;share.disabled=confirm.disabled=true;link.setAttribute('aria-disabled','true');
        const result=await prepared.share();
        if(!active)return;
        pending=false;share.disabled=confirm.disabled=false;link.removeAttribute('aria-disabled');
        if(result==='shared'){handedOff=true;confirm.hidden=false;}
        status.textContent=t(result==='shared'?'保存先で保存を完了してください。この画面では保存結果を確認できません。'
            :result==='cancelled'?'共有をキャンセルしました。書き込みは保持されています。'
            :'共有を開けませんでした。「ダウンロードで保存」をお使いください。書き込みは保持されています。');
    };
    container.classList.add('writing-file-export');container.hidden=false;
    container.replaceChildren(filename,guide,replace,share,link,downloadHint,status,confirm);
    return {get pending(){return pending;},dispose(){active=false;link.onclick=null;share.onclick=null;confirm.onclick=null;link.removeAttribute('href');setTimeout(()=>URL.revokeObjectURL(url),60000);}};
}
