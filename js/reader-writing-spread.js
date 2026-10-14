import {getViewerFallbackSpreadPageIndices} from './viewer-navigation.js';

export function writingSpreadPages(index,count,spread,rtl,units){
    if(!spread)return [index];
    const unit=units?.find(p=>p.includes(index));
    if(unit?.length&&unit.length<=2&&unit.every(i=>Number.isInteger(i)&&i>=0&&i<count))return [...unit];
    return getViewerFallbackSpreadPageIndices({currentIndex:index,totalPages:count,pageDirection:rtl?'rtl':'ltr'});
}
export function writingTurnTarget(index,count,delta,spread,rtl,units){
    if(!spread)return Math.max(0,Math.min(count-1,index+delta));
    const sequence=units?.length?units:Array.from({length:Math.ceil((count-1)/2)+1},(_,i)=>i===0?[0]:[i*2-1,i*2].filter(n=>n<count));
    const at=sequence.findIndex(u=>u.includes(index)),unit=sequence[Math.max(0,Math.min(sequence.length-1,at+delta))];
    return unit?.includes(index)?index:unit?.[rtl?unit.length-1:0]??index;
}
/** Same trajectory in each page's coordinates; clipping keeps the seam exact, including brush outlines.
 * Off-page geometry is retained within the contract bounds, never joined to a different spread later. */
export function spreadStrokeParts(stroke,indices,pageIds,idFactory){
    const min=Math.min(...stroke.points.map(p=>p.x-p.width/2)),max=Math.max(...stroke.points.map(p=>p.x+p.width/2));
    return indices.flatMap((index,column)=>{
        const left=column*360;if(max<left||min>left+360)return [];
        const object=structuredClone(stroke);object.id=idFactory();object.points.forEach(p=>p.x-=left);
        return [{pageId:pageIds[index],object}];
    });
}
