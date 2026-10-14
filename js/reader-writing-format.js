export const TEXT_SIZES = [8,9,10,11,12,14,16,18,20,24,28,32,36,40,48,60,72,96,120,144];
export const TEXT_COLORS = [['ブラック','#20272b'],['ホワイト','#ffffff'],['グレー','#7c858c'],['レッド','#d33544'],['ブルー','#2363bc'],['グリーン','#258169'],['オレンジ','#e77a38'],['パープル','#8557a3']].map(([name,color])=>({name,color}));
export const ARROW_HEADS = [['open','開いた矢印'],['triangle','三角'],['circle','丸'],['diamond','ひし形']];
export const LINE_STYLES = [['solid','実線'],['dashed','破線'],['dotted','点線'],['dash-dot','一点鎖線']];
/** Dash lengths use page coordinates, so display, thumbnails and saved files agree. */
export function lineStrokeAttributes(style='solid',width=1){
    const unit=Math.max(1,width),pattern={dashed:[4,2.5],dotted:[0,2.5],'dash-dot':[6,2.5,0,2.5]}[style];
    return {'stroke-linecap':style==='dotted'||style==='dash-dot'?'round':'butt',...(pattern?{'stroke-dasharray':pattern.map(n=>n*unit).join(' ')}:{})};
}
/** Filled heads cover the shaft endpoint. Butt caps cannot protrude beyond a circle. */
export function arrowShaftGeometry(o){
    const dx=o.to[0]-o.from[0],dy=o.to[1]-o.from[1],distance=Math.hypot(dx,dy);
    if(!distance)return null;
    const inset=(o.arrowHead||'open')==='open'?0:Math.max(10,o.width*3)/2;
    const start=['start','both'].includes(o.arrow)?inset:0,end=['end','both'].includes(o.arrow)?inset:0;
    if(start+end>=distance)return null;
    return {from:[o.from[0]+dx*start/distance,o.from[1]+dy*start/distance],to:[o.to[0]-dx*end/distance,o.to[1]-dy*end/distance]};
}
export function textSize(value){const n=Number(value);return String(value).trim()&&Number.isFinite(n)&&n>=1&&n<=360?n:null;}
export function stepTextSize(value,delta){return Math.max(1,Math.min(360,Math.round(((textSize(value)??20)+delta)*100)/100));}
/** Shared endpoint outlines for rendering, thumbnails, bounds and selection. */
export function arrowHeadGeometry(o){
    const result=[],kind=o.arrowHead||'open',len=Math.max(10,o.width*3);
    const add=(a,b)=>{
        const angle=Math.atan2(b[1]-a[1],b[0]-a[0]),u=[Math.cos(angle),Math.sin(angle)],v=[-u[1],u[0]];
        const p=(back,side)=>[b[0]-u[0]*back+v[0]*side,b[1]-u[1]*back+v[1]*side];
        if(kind==='circle')result.push({kind,center:p(len/2,0),radius:len/2});
        else result.push({kind,points:kind==='diamond'?[b,p(len/2,len*.4),p(len,0),p(len/2,-len*.4)]:[p(len*Math.cos(.5),len*Math.sin(.5)),b,p(len*Math.cos(.5),-len*Math.sin(.5))]});
    };
    if(['start','both'].includes(o.arrow))add(o.to,o.from);
    if(['end','both'].includes(o.arrow))add(o.from,o.to);
    return result;
}
