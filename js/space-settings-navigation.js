// Navigation stays local to the selected space; it never changes permissions.
export function createSpaceSettingsNavigation({root,getLocale=()=> 'ja'}){
    const members=root.querySelector('[data-space-settings-panel="members"]');
    const profile=root.querySelector('[data-space-settings-panel="profile"]');
    if(!members||!profile)return {render(){}};
    const nav=document.createElement('nav');nav.className='home-settings-nav';
    let selected='members',visible=false;
    const buttons=['profile','members'].map(key=>{const button=document.createElement('button');button.type='button';button.dataset.spaceSettings=key;button.onclick=()=>{selected=key;render(visible);};nav.append(button);return button;});
    members.before(nav);
    function render(enabled){
        visible=enabled;const en=getLocale()==='en';nav.hidden=!enabled;
        nav.setAttribute('aria-label',en?'Space settings sections':'スペース設定の項目');
        for(const button of buttons){const key=button.dataset.spaceSettings;button.textContent=key==='profile'?(en?'Basic information':'基本情報'):(en?'Members & invitations':'メンバー・招待');button.setAttribute('aria-pressed',String(selected===key));}
        profile.hidden=!enabled||selected!=='profile';members.hidden=!enabled||selected!=='members';
    }
    return {render};
}
