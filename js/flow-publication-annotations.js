/** Expected annotation glyphs, shared by capture and strict no-loss projection. */
import {segmentGraphemes} from './grapheme.js';
export function getFlowPublicationAnnotationGlyphs(fragment){
 const result=[];
 for(const annotation of fragment.annotations || []){
  if(annotation.type==='ruby'){
   segmentGraphemes(annotation.reading,fragment.languageKey).forEach((g,index)=>result.push({blockId:fragment.blockId,annotationId:annotation.id,type:'ruby',index,text:g.segment}));
  }else if(annotation.type==='emphasis'){
   for(const g of segmentGraphemes(fragment.text.slice(annotation.start,annotation.end),fragment.languageKey)){
    if(!/^\s+$/u.test(g.segment) && !(fragment.annotations || []).some(a=>a.type==='ruby' && a.start<=annotation.start+g.index && a.end>=annotation.start+g.end))result.push({blockId:fragment.blockId,annotationId:annotation.id,type:'emphasis',index:fragment.sourceRange.start+annotation.start+g.index,text:annotation.mark==='dot'?'•':'﹅'});
   }
  }
 }
 return result;
}
