import {createFileLaunchInbox} from './file-launch.js';
import '../css/file-launch.css';

export function installFileLaunch({extension,openFile,getLocale=()=> 'ja',target=window}) {
    if(typeof target.launchQueue?.setConsumer!=='function')return null;
    const en=()=>getLocale()==='en';
    const dialog=document.createElement('dialog');dialog.className='file-launch-dialog';
    const heading=document.createElement('h2');heading.id='file-launch-title';dialog.setAttribute('aria-labelledby',heading.id);
    const note=document.createElement('p'),list=document.createElement('ul'),close=document.createElement('button');
    const reopen=document.createElement('button');reopen.className='file-launch-reopen';reopen.type='button';reopen.hidden=true;
    close.type='button';
    const errors=()=>({
        unsaved:en()?'Save the current manuscript first, then try Open again.':'編集中の原稿を先に保存してから、もう一度「開く」を押してください。',
        busy:en()?'Wait for the current operation to finish, then retry.':'現在の操作が終わってから、もう一度お試しください。',
        type:en()?'This file type cannot be opened here.':'この画面では対応していないファイル形式です。',
        'not-ready':en()?'Studio could not finish starting. Keep your drafts and reopen the app.':'Studioの起動が完了しませんでした。原稿を保存してアプリを開き直してください。',
        open:en()?'Could not open the file. Check the file and its access permission, then retry.':'ファイルを開けませんでした。形式とアクセス許可を確認して再試行してください。'
    });
    let inbox;
    function render({items,busy}) {
        heading.textContent=en()?'Open received files':'受け取ったファイルを開く';
        note.textContent=en()?'Choose a file to open. DSP opens as a local manuscript; DSF opens for reading. Files are not uploaded. Later keeps this list until this window closes.':'開くファイルを選んでください。DSPは端末の原稿、DSFは閲覧用として開きます。クラウドへの送信は行いません。「あとで」の一覧は、タブまたはアプリのウィンドウを閉じるまで保持します。';
        close.textContent=en()?'Later':'あとで';close.disabled=busy;
        reopen.textContent=(en()?'Received files':'受け取ったファイル')+' ('+items.length+')';reopen.hidden=!items.length;
        list.replaceChildren();
        for(const item of items) {
            const row=document.createElement('li'),name=document.createElement('strong'),actions=document.createElement('div');
            name.textContent=item.name;
            const label=document.createElement('div');label.className='file-launch-name';
            const kind=item.name.toLowerCase().endsWith('.dsp')?'dsp':item.name.toLowerCase().endsWith('.dsf')?'dsf':null;
            if(kind){const icon=document.createElement('img');icon.src='/file-icons/'+kind+'.svg';icon.alt='';icon.width=icon.height=40;label.append(icon);}
            label.append(name);row.append(label);
            if(item.error){const error=document.createElement('p');error.setAttribute('role','alert');error.textContent=errors()[item.error];row.append(error);}
            const open=document.createElement('button'),remove=document.createElement('button');
            open.type=remove.type='button';open.textContent=en()?'Open':'開く';remove.textContent=en()?'Remove from list':'一覧から外す';
            open.disabled=busy||item.error==='type';remove.disabled=busy;
            open.onclick=()=>void inbox.open(item.id);remove.onclick=()=>inbox.remove(item.id);
            actions.append(open,remove);row.append(actions);list.append(row);
        }
        dialog.setAttribute('aria-busy',String(busy));
        if(!items.length&&dialog.open)dialog.close();
        else if(dialog.open&&!busy)close.focus();
    }
    inbox=createFileLaunchInbox({extension,openFile,onChange:render});
    const show=()=>{if(inbox.read().items.length&&!dialog.open){dialog.showModal();close.focus();}};
    close.onclick=()=>dialog.close();reopen.onclick=show;
    dialog.addEventListener('cancel',event=>{if(inbox.read().busy)event.preventDefault();});
    dialog.append(heading,note,list,close);document.body.append(dialog,reopen);
    target.launchQueue.setConsumer(params=>{inbox.receive(params);show();});
    return inbox;
}
