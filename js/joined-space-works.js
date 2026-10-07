// Renders only the server-filtered shared directory; never reads personal projects.
export async function renderJoinedSpaceWorks({root,count,spaceId,execute,isCurrent,getLocale=()=> 'ja'}){
    const en=getLocale()==='en',t=(ja,english)=>en?english:ja;
    const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
    root.replaceChildren(node('p',t('共有リーズを読み込み中…','Loading shared Reads…')));if(count)count.textContent='…';
    let cursor=null,total=0;
    const list=node('div');list.className='joined-space-work-list';
    const status=node('p');status.setAttribute('role','status');
    const more=node('button',t('さらに表示','Show more'));more.type='button';more.className='home-action-btn';more.hidden=true;
    let busy=false;
    const seen=new Set();
    async function load(append=false){
        if(busy)return;busy=true;more.disabled=true;
        try{
            const result=await execute({kind:'listSpaceWorks',spaceId,afterId:append?cursor:null});if(!isCurrent())return;
            if(result.space?.id!==spaceId||!Array.isArray(result.items))throw Error('INVALID_DIRECTORY');
            if(!append){list.replaceChildren();seen.clear();root.replaceChildren(status,list,more);}
            total=result.total;cursor=result.nextCursor;if(count)count.textContent=String(total);
            status.textContent=!total?t('共有リーズはまだありません。所有者が共有登録すると、ここに表示されます。','No shared Reads yet. They appear here after the owner enables sharing.'):result.canOpen===false?t('共有原稿を開く機能は準備中です。現在はリーズ一覧を確認できます。','Opening shared manuscripts is being prepared. You can view the Read list now.') : '';
            for(const work of result.items){
                if(seen.has(work.workId))continue;seen.add(work.workId);
                const card=node('article');card.className='joined-space-work-card';card.append(node('h3',work.title),node('p',work.canEdit?t('編集可','Can edit'):t('閲覧のみ','View only')));
                if(result.canOpen===false)card.append(node('span',t('準備中','Not yet available')));
                else{const link=node('a',t('リードを開く','Open Read'));link.className='home-action-btn';link.href='/studio?room=editor&sharedSpace='+encodeURIComponent(spaceId)+'&sharedWork='+encodeURIComponent(work.workId);card.append(link);}
                list.append(card);
            }
            more.hidden=!cursor;
        }catch{if(!isCurrent())return;list.replaceChildren();seen.clear();if(count)count.textContent='!';status.textContent=t('共有リーズを取得できませんでした。権限と接続を確認して再試行してください。','Could not load shared Reads. Check access and connection, then retry.');const retry=node('button',t('再試行','Retry'));retry.type='button';retry.className='home-action-btn';retry.onclick=()=>load(false);root.replaceChildren(status,retry);}
        finally{busy=false;more.disabled=false;}
    }
    more.onclick=()=>load(true);await load();
}
