import {installFileLaunch} from './file-launch-ui.js';
import {createPlatformNavigator} from './platform-navigation.js';
import {registerPlatformLaunch,launchDestination,isPlatformShortcut} from './platform-launch.js';
import {getPlatformLanguage} from './ui-language.js';
import '../css/platform-menu.css';
export function installPlatformLaunchNotice({surface,beforeNavigate=()=>true}){
    if(surface==='portal')installFileLaunch({extension:'.none',getLocale:()=>getPlatformLanguage(surface)});
    const navigate=createPlatformNavigator({beforeNavigate});
    let launchNotice;
    registerPlatformLaunch('url',params=>{
        if(!params?.targetURL||isPlatformShortcut(params.targetURL,location.href))return;
        const href=launchDestination(params.targetURL,location.href);if(!href)return;
        // Relaunching Studio's shortcut focuses the current manuscript, without resetting its room.
        const destination=new URL(href);
        if(surface==='studio'&&/^\/studio(?:\.html)?$/.test(destination.pathname)&&[...destination.searchParams.keys()].every(key=>['room','source'].includes(key))&&(!destination.searchParams.get('room')||destination.searchParams.get('room')==='home'))return;
        launchNotice?.remove();launchNotice=document.createElement('aside');launchNotice.className='platform-launch-notice';launchNotice.setAttribute('role','status');
        const en=getPlatformLanguage(surface)==='en',text=document.createElement('span'),open=document.createElement('button'),cancel=document.createElement('button');
        const reader=/^\/viewer(?:\.html)?$/.test(destination.pathname);
        text.textContent=reader?(en?'Open this Read in Reader.':'Readerでリードを開きます。'):(en?'A link was sent to this app. Open it in this window?':'アプリにリンクが届きました。このウィンドウで開きますか？');
        open.type=cancel.type='button';open.textContent=reader?(en?'Open here':'この画面で開く'):(en?'Open':'開く');cancel.textContent=en?'Keep current screen':'現在の画面を続ける';
        open.onclick=async()=>{open.disabled=true;try{await navigate(href);}finally{open.disabled=false;}};cancel.onclick=()=>launchNotice.remove();
        launchNotice.append(text);
        if(reader){
            const newTab=document.createElement('a');newTab.href=href;newTab.target='_blank';newTab.rel='noopener';newTab.className='platform-launch-new-tab';
            newTab.textContent=en?'Open in new tab':'別タブで開く';
            launchNotice.append(newTab);
        }
        launchNotice.append(open,cancel);document.body.append(launchNotice);
    });
}
