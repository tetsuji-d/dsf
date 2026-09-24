import {createPersonalSharingClient,mountPersonalSharingInbox} from './personal-sharing-ui.js';
import {createInvitationsClient} from './publishing-invitations-transport.js';
import {createPublishingInvitationsUI} from './publishing-invitations-ui.js';

// Account-wide inbox, independent of the currently selected publishing space.
export function createStudioInbox({getUser,getLocale,onNavigate,onOpenSpace}) {
    const buttons=[...document.querySelectorAll('[data-studio-notifications]')];
    const sharedRoot=document.getElementById('home-shared-inbox');
    const noticesRoot=document.getElementById('home-notifications');
    let key='',epoch=0,uid=null,view=null,views=[],personalCount=0,spaceCount=0,pending=null;
    const personal=createPersonalSharingClient({getUser}),spaces=createInvitationsClient({getUser});
    const en=()=>getLocale()==='en';
    function badges(){for(const button of buttons){
        button.hidden=!uid;button.title=en()?'Notifications':'お知らせ';
        const count=personalCount+spaceCount,badge=button.querySelector('[data-notification-count]');
        badge.hidden=!count;badge.textContent=count>99?'99+':String(count);
        button.setAttribute('aria-label',(en()?'Notifications':'お知らせ')+(count?' · '+count:''));
    }}
    function update(){const next=JSON.stringify([getUser()?.uid,getLocale()]);if(next===key)return;
        const previousView=view;key=next;epoch++;uid=getUser()?.uid||null;personalCount=spaceCount=0;pending=null;
        views.forEach(v=>v.destroy());views=[];view=null;sharedRoot.replaceChildren();noticesRoot.replaceChildren();badges();
        if(uid)void refreshCounts();
        if(previousView)show(previousView);
    }
    async function refreshCounts(){if(!uid||pending)return pending;const version=epoch;
        const work=Promise.allSettled([personal({kind:'inbox'}),spaces({kind:'inbox'})]).then(results=>{
            if(version!==epoch)return;
            if(results[0].status==='fulfilled')personalCount=results[0].value.items.filter(i=>i.status==='pending').length;
            if(results[1].status==='fulfilled')spaceCount=results[1].value.unreadCount||0;
            badges();
        }).finally(()=>{if(pending===work)pending=null;});pending=work;return work;
    }
    function show(next){update();if(next===view){views.forEach(v=>v.refresh());return;}view=next;
        views.forEach(v=>v.destroy());views=[];sharedRoot.replaceChildren();noticesRoot.replaceChildren();
        const root=next==='shared'?sharedRoot:noticesRoot;
        if(!uid){root.textContent=en()?'Sign in to continue.':'ログインしてください。';return;}
        const version=epoch,personalHost=document.createElement('section');root.append(personalHost);
        views.push(mountPersonalSharingInbox({root:personalHost,execute:personal,getLocale,isCurrent:()=>version===epoch,
            mode:next==='shared'?'works':'notifications',
            onChange:data=>{if(version!==epoch)return;personalCount=data.items.filter(i=>i.status==='pending').length;badges();},
        }));
        if(next==='notifications'){
            const spaceHost=document.createElement('section');root.append(spaceHost);
            views.push(createPublishingInvitationsUI({root:spaceHost,getLocale,inlineInbox:true,
                execute:async command=>{const result=await spaces(command);if(version!==epoch)throw Error('AUTH_CHANGED');if(command.kind==='inbox'){spaceCount=result.unreadCount||0;badges();}return result;},
                onOpenSpace:async invitation=>{if(version===epoch)await onOpenSpace(invitation);},
            }));
        }
    }
    for(const button of buttons)button.addEventListener('click',()=>onNavigate('notifications'));
    const focus=()=>{update();if(!document.hidden)void refreshCounts();};window.addEventListener('focus',focus);
    document.addEventListener('studio-ui-language-change',focus);
    const timer=setInterval(focus,60000);
    return {update,show,destroy(){epoch++;clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('studio-ui-language-change',focus);views.forEach(v=>v.destroy());}};
}
