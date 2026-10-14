/** Visible spread plus two pages on either side. Work is cancelled when navigation supersedes it. */
export function writingPageWindow(visible,total){
    if(!visible.length)return [];
    const first=Math.min(...visible),last=Math.max(...visible);
    return [...new Set([...visible,first-1,last+1,first-2,last+2])].filter(i=>i>=0&&i<total);
}
export function createWritingPageCache({load,dispose=()=>{},schedule=fn=>setTimeout(fn,0),cancel=clearTimeout}){
    const cache=new Map();let pending,allowed=new Set(),generation=0;
    const get=key=>{if(!cache.has(key))cache.set(key,load(key));return cache.get(key);};
    return {
        get,
        window(visible,nearby){
            cancel(pending);const epoch=++generation;allowed=new Set([...visible,...nearby]);
            for(const [key,value] of cache)if(!allowed.has(key)){dispose(value);cache.delete(key);}
            visible.forEach(get);
            const remaining=nearby.filter(key=>!cache.has(key));
            const step=()=>{if(epoch!==generation)return;const key=remaining.shift();if(key!==undefined&&allowed.has(key))get(key);if(remaining.length)pending=schedule(step);};
            if(remaining.length)pending=schedule(step);
        },
        clear(){cancel(pending);generation++;for(const value of cache.values())dispose(value);cache.clear();allowed.clear();},
        get size(){return cache.size;},get keys(){return [...cache.keys()];},
    };
}
