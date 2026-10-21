import {resizeWritingErasures} from './reader-writing-eraser.js';
// Screen approximations inspired by stationery ranges; these are not manufacturer ink measurements.
export const INK_COLORS = [
    ['ブラック','#20272b'],['レッド','#d33544'],['ブルー','#2363bc'],['グリーン','#258169'],
    ['オレンジ','#e77a38'],['ピンク','#d95691'],['パープル','#8557a3'],['スカイブルー','#49a3cf'],
    ['ブラウン','#886149'],['グレー','#7c858c'],['ネイビー','#304768'],['ターコイズ','#299c9c'],
].map(([name,color])=>({name,color}));
export const HIGHLIGHTER_COLORS = [
    ['ビビッド',[['レモン','#f3ed35'],['ライム','#a9e443'],['アクア','#3cd2d6'],['ホットピンク','#ff62a0'],['タンジェリン','#ff9838']]],
    ['ブライト',[['サンフラワー','#f8cf45'],['コーラル','#ff867a'],['フューシャ','#db68bd'],['バイオレット','#a28cde'],['シアン','#6cc4ec']]],
    ['パステル',[['クリーム','#f7e3a1'],['ピーチ','#f5c4ac'],['ベビーピンク','#f2c0cf'],['ラベンダー','#d1c4ed'],['ミント','#bce2cd']]],
    ['マイルド',[['バター','#eadb87'],['アプリコット','#edb980'],['ローズ','#dba1b5'],['ライラック','#bca5cd'],['パウダーブルー','#a1c4dc']]],
    ['くすみ',[['ダスティピンク','#c795a0'],['モーヴ','#af94b0'],['スモーキーブルー','#8faebf'],['セージ','#a6b89c'],['グレージュ','#bcb2a3']]],
    ['アース',[['オリーブ','#a8ad77'],['オーカー','#cbbb7a'],['サンド','#d3c3a3'],['テラコッタ','#cc9980'],['ココア','#ad9587']]],
    ['ディープ',[['ボルドー','#b57c95'],['プラム','#9e86b3'],['インディゴ','#859cc2'],['フォレスト','#79ab9e'],['スレート','#9aa7ae']]],
].flatMap(([group,colors])=>colors.map(([name,color])=>({group,name,color})));
export const PEN_WIDTHS = [.3,.5,.7];
export const penPixels = mm => mm * 96 / 25.4;
export const penMillimeters = pixels => pixels * 25.4 / 96;
export const penWidthLabel = pixels => Number(penMillimeters(pixels).toFixed(1)).toString();
export const PEN_TOOLS = ['pen','brush','marker','highlighter','correction','eraser'];
export function toolDefaults() {return {
    pen:{color:INK_COLORS[0].color,width:penPixels(.5)},brush:{color:INK_COLORS[0].color,width:penPixels(2.5),inkAmount:.65},
    marker:{color:INK_COLORS[2].color,width:penPixels(1)},highlighter:{color:HIGHLIGHTER_COLORS[0].color,width:penPixels(4)},
    correction:{color:'#ffffff',width:penPixels(4)},eraser:{color:'#cf8597',width:penPixels(4)},geometry:{color:INK_COLORS[0].color,width:penPixels(.5)},text:{color:INK_COLORS[0].color,width:penPixels(.5)},
};}

/** Eight resize handles for shapes, two editable endpoints for lines. */
export function writingControlPoints(o) {
    if(o.type==='line')return [{key:'from',x:o.from[0],y:o.from[1]},{key:'to',x:o.to[0],y:o.to[1]}];
    if(o.type!=='shape')return [];
    const [x,y,w,h]=o.rect;
    return [['nw',0,0],['n',.5,0],['ne',1,0],['e',1,.5],['se',1,1],['s',.5,1],['sw',0,1],['w',0,.5]].map(([key,a,b])=>({key,x:x+w*a,y:y+h*b}));
}
export function snapWritingPoint(point,objects,excludeId,radius=9) {
    let best=null,distance=radius;
    for(const o of objects)if(o.id!==excludeId)for(const target of writingControlPoints(o)) {
        const d=Math.hypot(point.x-target.x,point.y-target.y);
        if(d<distance){distance=d;best={x:target.x,y:target.y,objectId:o.id,key:target.key};}
    }
    return best ? {point:{x:best.x,y:best.y},target:best} : {point:{...point},target:null};
}
export function constrainedRect(start,end,square=false) {
    let dx=end.x-start.x,dy=end.y-start.y;
    if(square){const sx=Math.sign(dx)||1,sy=Math.sign(dy)||1;
        const size=Math.min(Math.max(Math.abs(dx),Math.abs(dy)),sx>0?360-start.x:start.x,sy>0?640-start.y:start.y);
        dx=sx*size;dy=sy*size;}
    return [Math.min(start.x,start.x+dx),Math.min(start.y,start.y+dy),Math.max(.1,Math.abs(dx)),Math.max(.1,Math.abs(dy))];
}
export function editWritingPoint(o,key,p,square=false) {
    const next=structuredClone(o);
    if(o.type==='line') {next[key]=[p.x,p.y];const box=l=>[Math.min(l.from[0],l.to[0]),Math.min(l.from[1],l.to[1]),Math.max(.1,Math.abs(l.to[0]-l.from[0])),Math.max(.1,Math.abs(l.to[1]-l.from[1]))];return resizeWritingErasures(next,box(o),box(next));}
    const [x,y,w,h]=o.rect;
    if(key.length===2){const anchor={x:key.includes('w')?x+w:x,y:key.includes('n')?y+h:y};next.rect=constrainedRect(anchor,p,square);}
    else {let left=x,top=y,right=x+w,bottom=y+h;
        if(key==='w')left=Math.min(p.x,right-.1);if(key==='e')right=Math.max(p.x,left+.1);
        if(key==='n')top=Math.min(p.y,bottom-.1);if(key==='s')bottom=Math.max(p.y,top+.1);
        if(square){const size=Math.min(key==='w'||key==='e'?right-left:bottom-top,360-left,640-top);right=left+size;bottom=top+size;}
        next.rect=[left,top,right-left,bottom-top];}
    return resizeWritingErasures(next,o.rect,next.rect);
}

/** Speed, direction and distance-based entry / travel / exit, frozen as ordinary saved point widths. */
export function brushDryness(distance,speed=0){return Math.min(1,.24*(1-Math.exp(-distance/220))+.76*speed*speed/(speed*speed+.36));}
export function brushGeometry(raw,baseWidth,finished=false,dynamics=false) {
    if(!raw.length)return [];
    const samples=[{...raw[0],distance:0,speed:0}];let total=0;
    for(let i=1;i<raw.length;i++){
        const a=raw[i-1],b=raw[i],length=Math.hypot(b.x-a.x,b.y-a.y);if(length<.001)continue;
        const steps=Math.max(1,Math.ceil(length/2)),speed=length/Math.max(1,b.time-a.time);
        for(let j=1;j<=steps;j++){const f=j/steps;samples.push({x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,
            pressure:a.pressure+(b.pressure-a.pressure)*f,pen:b.pen,speed,distance:total+length*f});}
        total+=length;
    }
    if(samples.length===1)return [{x:raw[0].x,y:raw[0].y,pressure:raw[0].pressure,width:Math.max(.1,baseWidth*.55),...(dynamics?{dryness:0}:{})}];
    let lastWidth=baseWidth*.35,lastDryness=0;
    return samples.map((p,i)=>{
        const a=samples[Math.max(0,i-1)],b=samples[Math.min(samples.length-1,i+1)],angle=Math.atan2(b.y-a.y,b.x-a.x);
        const pressure=p.pen?Math.max(.05,p.pressure):.35+.65/(1+p.speed*.65);
        const direction=.7+.3*Math.abs(Math.sin(angle+Math.PI/4));
        const entry=.3+.7*Math.min(1,p.distance/Math.max(5,baseWidth*1.4));
        // Upward/rightward exits taper; a downward stop retains a little more ink.
        const exitTip=b.y-a.y>Math.abs(b.x-a.x)*.5?.27:.035;
        const exit=finished?exitTip+(1-exitTip)*Math.min(1,(total-p.distance)/Math.max(7,baseWidth*2)):1;
        const desired=baseWidth*(.35+pressure*.85)*direction*entry;
        lastWidth=lastWidth*.3+desired*.7;
        lastDryness=lastDryness*.7+brushDryness(p.distance,p.speed)*.3;
        return {x:p.x,y:p.y,pressure,width:Math.max(.06,lastWidth*exit),...(dynamics?{dryness:lastDryness}:{})};
    });
}

/** A single outline avoids stepped joins in a varying-width brush stroke. */
export function strokeOutline(points) {
    if(points.length<2)return '';
    const left=[],right=[];
    points.forEach((p,i)=>{const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],angle=Math.atan2(b.y-a.y,b.x-a.x),nx=-Math.sin(angle)*p.width/2,ny=Math.cos(angle)*p.width/2;
        left.push([p.x+nx,p.y+ny]);right.push([p.x-nx,p.y-ny]);});
    return `M ${[...left,...right.reverse()].map(p=>p.map(v=>Number(v.toFixed(3))).join(' ')).join(' L ')} Z`;
}

/** Brush geometry v2: deterministic strands and soft nested edges, inside saved widths.
 * Distance along the stroke (never object ID or page position) anchors the texture.
 * No filters, external assets or random state: copies and split spreads stay identical.
 */
export function brushInkPaths(points,inkAmount) {
    if(!points.length)return [];
    // A tap uses the same texture algorithm as a very short stroke.
    const source=points.length===1?[points[0],{...points[0],y:points[0].y+.01}]:points;
    const stride=Math.max(1,Math.ceil(source.length/1500));
    const samples=source.filter((_,i)=>i%stride===0||i===source.length-1);
    const scaled=f=>strokeOutline(samples.map(p=>({...p,width:p.width*f})));
    if(inkAmount>=.65){
        const wet=(inkAmount-.65)/.35;
        return [{d:scaled(1),opacity:.12+wet*.08},{d:scaled(.96),opacity:.24+wet*.08},
            {d:scaled(1-wet*.12),opacity:.96}];
    }
    let distance=0;
    const frames=samples.map((p,i)=>{if(i)distance+=Math.hypot(p.x-samples[i-1].x,p.y-samples[i-1].y);
        const a=samples[Math.max(0,i-1)],b=samples[Math.min(samples.length-1,i+1)],angle=Math.atan2(b.y-a.y,b.x-a.x);
        return {p,distance,nx:-Math.sin(angle),ny:Math.cos(angle)};});
    const saturation=inkAmount/.65;
    return Array.from({length:12},(_,strand)=>{
        const offset=(strand+.5)/12-.5;
        const strandPoints=frames.map(({p,distance,nx,ny})=>{
            const grain=(Math.sin(distance*.39+strand*2.7)+Math.sin(distance*.13+strand*5.1)+2)/4;
            const coverage=(.12+saturation*.86)*(.22+.78*grain);
            return {...p,x:p.x+nx*p.width*offset,y:p.y+ny*p.width*offset,width:p.width/12*coverage};
        });
        return {d:strokeOutline(strandPoints),opacity:.58+saturation*.42};
    });
}

/** Sweep a fixed rectangular nib. Each convex segment is opaque inside one translucent group. */
export function naturalBrushInkPaths(points,inkAmount,dynamics=false) {
    if(!points.length)return [];
    const source=points.length===1?[points[0],{...points[0],y:points[0].y+.2}]:points;
    const stride=Math.max(1,Math.ceil(source.length/1200)),samples=source.filter((_,i)=>i%stride===0||i===source.length-1);
    const noise=(x,seed)=>{const hash=n=>{const v=Math.sin(n*127.1+seed*311.7)*43758.5453;return v-Math.floor(v);};const n=Math.floor(x),t=x-n,s=t*t*(3-2*t);return hash(n)*(1-s)+hash(n+1)*s;};
    let distance=0;
    const frames=samples.map((p,i)=>{if(i)distance+=Math.hypot(p.x-samples[i-1].x,p.y-samples[i-1].y);
        const a=samples[Math.max(0,i-1)],b=samples[Math.min(samples.length-1,i+1)],angle=Math.atan2(b.y-a.y,b.x-a.x);
        return {p,d:distance,ink:dynamics?Math.max(.015,Math.min(1,inkAmount+.22-p.dryness*.85)):inkAmount,nx:-Math.sin(angle),ny:Math.cos(angle)};});
    const paths=[],wet=inkAmount*inkAmount;
    // Several translucent, irregular edges resemble ink entering paper fibres.
    for(let k=0;k<6;k++){
        const scale=1-k*.028;
        paths.push({d:strokeOutline(frames.map(({p,d,ink})=>({...p,width:p.width*scale*(.94+.06*noise(d*.65,17+k*.3))*(dynamics?Math.pow(ink,2):1)}))),opacity:wet*(k===5?.76:.055)});
    }
    // Broken, unevenly spaced bristle ribbons. Coverage changes continuously with ink quantity.
    for(let j=0;j<18;j++){
        let run=[];const fragments=[];
        const flush=()=>{if(run.length>1)fragments.push(strokeOutline(run));run=[];};
        for(const {p,d,ink,nx,ny} of frames){
            const grain=noise(d*.25,j+41)*.65+noise(d*.91,j+89)*.35;
            const coverage=Math.max(0,Math.min(1,(grain-(.48-ink*.65))*3));
            if(coverage<.035){flush();continue;}
            const offset=((j+.5)/18-.5)*.86+(noise(d*.08,j+101)-.5)*.032;
            run.push({...p,x:p.x+nx*p.width*offset,y:p.y+ny*p.width*offset,width:p.width/18*(.35+ink*.95)*coverage});
        }flush();if(fragments.length)paths.push({d:fragments.join(' '),opacity:.5+inkAmount*.48});
    }
    return paths.filter(path=>path.opacity>0);
}

export function highlighterPolygons(points) {
    // Rotate the rectangular nib with each segment: the broad edge always lies
    // across the movement. Use the same orientation at both ends, including taps.
    const corners=(p,angle)=>{const x=p.width*.14,y=p.width/2,c=Math.cos(angle),s=Math.sin(angle);return [[-x,-y],[x,-y],[x,y],[-x,y]].map(([a,b])=>[p.x+a*c-b*s,p.y+a*s+b*c]);};
    const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    return points.map((p,i)=>{
        const previous=points[Math.max(0,i-1)],next=points[Math.min(points.length-1,i+1)],angle=i?Math.atan2(p.y-previous.y,p.x-previous.x):Math.atan2(next.y-p.y,next.x-p.x);
        const sorted=[...corners(previous,angle),...corners(p,angle)].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
        const half=items=>{const hull=[];for(const v of items){while(hull.length>1&&cross(hull.at(-2),hull.at(-1),v)<=0)hull.pop();hull.push(v);}return hull.slice(0,-1);};
        return [...half(sorted),...half([...sorted].reverse())];
    });
}

/** A restrained visual range keeps the original pen silhouette recognizable. */
export function penTipScale(tool,width){const defaults=toolDefaults(),ratio=width/defaults[tool].width;return .3+1.4*ratio/(1+ratio);}

/** Inline vector pen illustrations remain crisp at every display scale. */
export function createPenButton(documentRef,id,name) {
    const button=documentRef.createElement('button');button.className=`pen-item pen-${id}`;button.dataset.tool=id;button.type='button';button.setAttribute('aria-label',name);button.title=name;
    const tips={
        eraser:'<path d="M14 68H46V103Q46 116 30 116Q14 116 14 103Z" fill="#e6a5b4" stroke="#a66c7d"/><path d="M14 68H46V86H14Z" fill="#476c87"/><path d="M21 94H39" stroke="#fff8"/>',
        pen:'<path d="M19 78H41L34 102H26Z" fill="url(#metal-pen)"/><g class="pen-nib"><path d="M27 99H33L31 111H29Z" fill="#a6aeb6"/><circle cx="30" cy="112" r="2" class="ink-fill"/></g>',
        brush:'<path d="M19 74H41L38 91H22Z" fill="#b5ae9b"/><g class="pen-nib"><path d="M23 88Q19 105 30 122Q37 104 37 88Z" class="ink-fill"/><path d="M27 92Q24 107 30 119" fill="none" stroke="#ffffff55"/></g>',
        marker:'<path d="M19 77H41L36 94H24Z" fill="#a6aca9"/><g class="pen-nib"><path d="M24 90H36V112Q30 118 24 112Z" class="ink-fill"/></g>',
        highlighter:'<path d="M12 72H48L43 92H17Z" fill="#dadfd6"/><g class="pen-nib"><path d="M18 88H42V112L18 121Z" class="ink-fill"/></g>',
        correction:'<path d="M17 77H43L34 102H26Z" fill="#dae2e5"/><g class="pen-nib"><path d="M26 99H34V113H26Z" fill="#fafafa" stroke="#9dacb2"/></g>',
    };
    button.innerHTML=`<svg viewBox="0 0 60 130" aria-hidden="true"><defs><linearGradient id="barrel-${id}"><stop stop-color="#a4afb3"/><stop offset=".24" stop-color="#fafcfb"/><stop offset=".63" stop-color="#e0e7e5"/><stop offset="1" stop-color="#a2afb1"/></linearGradient><linearGradient id="metal-${id}"><stop stop-color="#677c89"/><stop offset=".45" stop-color="#f4f6f5"/><stop offset="1" stop-color="#80959e"/></linearGradient></defs><rect x="${id==='highlighter'?10:17}" y="-1200" width="${id==='highlighter'?40:26}" height="1280" rx="7" fill="url(#barrel-${id})" stroke="#85999e"/><rect x="${id==='highlighter'?10:17}" y="14" width="${id==='highlighter'?40:26}" height="6" class="ink-fill"/><path d="M22 26V64M27 26V64" stroke="#8f9e9c" stroke-width="1" opacity=".5"/>${tips[id]}</svg><span>${name}</span>`;
    return button;
}
