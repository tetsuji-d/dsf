import JSZip from 'jszip';
export async function buildSharedRecoveryArchive(record){
    const zip=new JSZip(),assets=[];
    for(const [index,asset] of (record.assets||[]).entries()){
        if(!(asset.blob instanceof Blob))throw Error('RECOVERY_IMAGE_MISSING');
        const file='assets/'+index+'.webp';zip.file(file,await asset.blob.arrayBuffer());assets.push({url:asset.url,ref:asset.ref,file});
    }
    zip.file('recovery.json',JSON.stringify({...record,assets},null,2));
    return zip.generateAsync({type:'blob'});
}
export function installSharedRecoveryUI({vault,getUid,getLocale,doc=document}){
    const t=(ja,en)=>getLocale()==='en'?en:ja,node=(tag,text)=>{const n=doc.createElement(tag);if(text)n.textContent=text;return n;};
    const host=node('aside');host.id='shared-recovery-notice';host.hidden=true;host.style.cssText='padding:10px 16px;background:#fff6df;color:#483411';
    doc.querySelector('#home-room .home-workspace-main')?.prepend(host);
    let dialog=null,epoch=0,failed=false;
    const button=(label,fn)=>{const b=node('button',label);b.type='button';b.textContent=label;b.onclick=fn;return b;};
    const close=()=>{epoch++;dialog?.close();dialog?.remove();dialog=null;};
    async function update(){
        const uid=getUid(),items=await vault.list();if(uid!==getUid())return;
        host.replaceChildren();host.hidden=!uid||(!items.length&&!failed);
        if(host.hidden)return;
        const pending=items.some(x=>!x.persisted);
        host.append(node('span',failed?t('下書きの退避に失敗しました。原稿を閉じる前に内容を控えてください。','Draft capture failed. Keep a copy before closing the manuscript.'):
            pending?t('端末への保存を確認できない復旧用下書きがあります。このタブを閉じずに下書きを保存してください。','Some recovery drafts are not confirmed on this device. Keep this tab open and download them.'):
            t('共有原稿の復旧用下書きがこの端末にあります。','Shared manuscript recovery drafts are stored on this device.')),
            button(t('復旧用下書き','Recovery drafts'),()=>open()));
    }
    async function open(){
        close();const uid=getUid();if(!uid)return;
        const active=++epoch,d=node('dialog');dialog=d;d.className='shared-recovery-dialog';d.style.cssText='width:min(760px,calc(100vw - 32px));max-height:calc(100dvh - 32px);padding:24px;border:1px solid #aab7c8;border-radius:14px;overflow:auto';doc.body.append(d);
        const current=()=>dialog===d&&epoch===active&&getUid()===uid;
        const title=node('h2',t('この端末の復旧用下書き','Recovery drafts on this device'));title.id='shared-recovery-title';d.setAttribute('aria-labelledby',title.id);
        const content=node('div'),status=node('p');status.setAttribute('role','status');
        d.append(title,node('p',t('保存できなかった共有原稿を保管しています。自動でクラウドに送信しません。復旧用ZIPには原稿JSONと取得済み画像が入り、DSPとは別形式です。必要な内容を取り出した後、不要な下書きを削除してください。','These drafts are not sent to the cloud. Recovery ZIPs contain manuscript JSON and already loaded images, in a format separate from DSP. Delete drafts after recovering the content you need.')),content,status,button(t('閉じる','Close'),close));
        d.addEventListener('cancel',e=>{e.preventDefault();close();});d.showModal();
        const items=await vault.list();if(!current())return;
        if(!items.length){content.append(node('p',t('復旧用下書きはありません。','No recovery drafts.')));return;}
        for(const {record,persisted} of items){
            const row=node('section');row.style.cssText='border-top:1px solid #ccd4df;padding:16px 0';
            row.append(node('h3',record.project.title||record.project.projectName||t('無題の原稿','Untitled manuscript')),node('p',new Date(record.updatedAt).toLocaleString()),
                node('p',persisted?t('端末に保存済み','Saved on this device'):t('端末への保存未確認：このタブを閉じないでください','Device save unconfirmed: keep this tab open')));
            const view=button(t('原稿を確認','Inspect manuscript'),()=>{
                if(!current())return;let area=row.querySelector('textarea');if(area){area.remove();return;}
                area=node('textarea');area.readOnly=true;area.setAttribute('aria-label',t('復旧原稿JSON','Recovery manuscript JSON'));area.rows=10;area.style.cssText='width:100%;box-sizing:border-box';area.value=JSON.stringify(record.project,null,2);row.append(area);
            });
            const download=button(t('復旧用ZIPを保存','Download recovery ZIP'),async()=>{
                if(!current())return;download.disabled=true;
                try{const blob=await buildSharedRecoveryArchive(record);if(!current())return;const url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download='dsf-recovery-'+record.updatedAt+'.zip';d.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
                catch{if(current())status.textContent=t('復旧用ZIPを保存できませんでした。原稿表示から内容を控えてください。','Could not create the recovery ZIP. Keep a copy from the manuscript view.');}
                finally{download.disabled=false;}
            });
            const remove=button(t('下書きを削除','Delete draft'),()=>{
                if(!current())return;const confirm=node('div');confirm.append(node('p',t('この復旧用下書きを端末から削除します。元のクラウド原稿は変わりません。','Delete this recovery draft from this device? The cloud manuscript is unchanged.')),
                    button(t('キャンセル','Cancel'),()=>confirm.remove()),button(t('削除する','Delete'),async()=>{
                        if(!current())return;remove.disabled=true;
                        try{await vault.remove(record.id);if(current()){row.remove();status.textContent=t('下書きを削除しました。','Draft deleted.');}}
                        catch{if(current())status.textContent=t('削除できませんでした。再試行してください。','Could not delete. Retry.');}
                        finally{remove.disabled=false;}
                    }));row.append(confirm);
            });row.append(view,download,remove);content.append(row);
        }
    }
    window.addEventListener('shared-recovery-change',()=>void update());
    window.addEventListener('shared-recovery-account',()=>{close();host.replaceChildren();host.hidden=true;failed=false;void update();});
    window.addEventListener('shared-recovery-failed',()=>{failed=true;void update();});
    doc.addEventListener('studio-ui-language-change',()=>{close();void update();});
    void update();return {open,update,close};
}
