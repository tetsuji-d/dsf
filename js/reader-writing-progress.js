import {getPlatformLanguage} from './ui-language.js';
// Local Performance entries only: no manuscript text, filenames or telemetry.
export function recordWritingTime(name,start){
    const key='dsf:'+name;
    if(performance.getEntriesByName(key,'measure').length>=64)performance.clearMeasures(key);
    performance.measure(key,{start,end:performance.now()});
}
export function createWritingProgress(name,render=()=>{}){
    const start=performance.now();let phase,phaseStart,ja='',en='',finished=false;
    const update=()=>{if(!finished)render((getPlatformLanguage('viewer')==='en'?en:ja)+' · '+Math.floor((performance.now()-start)/1000)+(getPlatformLanguage('viewer')==='en'?' s':'秒'));};
    const timer=setInterval(update,1000);
    return {
        async stage(key,japanese,english){
            if(finished)return;
            if(phase)recordWritingTime(name+':'+phase,phaseStart);
            phase=key;phaseStart=performance.now();ja=japanese;en=english;update();
            // Let the status paint before ZIP/font work. No invented percentages.
            await new Promise(resolve=>setTimeout(resolve,0));
        },
        end(){if(finished)return;finished=true;clearInterval(timer);if(phase)recordWritingTime(name+':'+phase,phaseStart);recordWritingTime(name,start);render(null);}
    };
}
export function readerProgressPanel(){
    const panel=document.createElement('div');panel.className='reader-operation-progress';panel.setAttribute('role','status');panel.setAttribute('aria-live','polite');document.body.append(panel);
    return text=>{if(text===null)panel.remove();else panel.textContent=text;};
}
