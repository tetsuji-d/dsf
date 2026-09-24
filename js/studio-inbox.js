import {createPersonalSharingClient,mountPersonalSharingInbox} from './personal-sharing-ui.js';
import {createAccountNotifications} from './account-notifications.js';

export function createStudioInbox({getUser,getLocale}) {
    const sharedRoot=document.getElementById('home-shared-inbox');
    const noticesRoot=document.getElementById('home-notifications');
    const personal=createPersonalSharingClient({getUser});
    const notifications=createAccountNotifications({getUser,getLocale});
    let key='',epoch=0,view=null,sharedUI=null;
    function update(){notifications.update();const next=JSON.stringify([getUser()?.uid,getLocale()]);if(next===key)return;
        key=next;epoch++;sharedUI?.destroy();sharedUI=null;sharedRoot.replaceChildren();noticesRoot.replaceChildren();
        if(view)render();
    }
    function render(){sharedUI?.destroy();sharedUI=null;sharedRoot.replaceChildren();noticesRoot.replaceChildren();
        if(view==='notifications'){const b=document.createElement('button');b.type='button';b.textContent=getLocale()==='en'?'Open notifications':'お知らせを開く';b.onclick=notifications.open;noticesRoot.append(b);return;}
        if(!getUser()){sharedRoot.textContent=getLocale()==='en'?'Sign in to continue.':'ログインしてください。';return;}
        const version=epoch;
        sharedUI=mountPersonalSharingInbox({root:sharedRoot,execute:personal,getLocale,isCurrent:()=>version===epoch,
            mode:'works',onChange:()=>void notifications.refresh()});
    }
    function show(next){update();view=next;render();if(next==='notifications')notifications.open();}
    return {update,show,destroy(){epoch++;sharedUI?.destroy();notifications.destroy();}};
}
