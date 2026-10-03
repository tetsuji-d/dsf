/** Reader-only viewport windows over immutable, already composed glyphs. */
export function buildReadingWindows(glyphs, visible, {wordOverlap = false} = {}) {
    const chars = glyphs.filter(c => Number.isFinite(c.start) && c.end > c.start).sort((a,b) => a.start-b.start);
    if (!chars.length || visible <= 0) return [{start:0,end:Math.max(1,visible)}];
    const windows=[]; let first=0, start=chars[0].start;
    while (windows.length <= chars.length) {
        let last=first;
        while(last+1<chars.length && chars[last+1].end<=start+visible+.1) last++;
        if(wordOverlap && last<chars.length-1) {
            const boundary=chars.findLastIndex((c,i)=>i>first&&i<=last&&c.space);
            if(boundary>first) last=boundary;
        }
        windows.push({start,end:Math.min(start+visible,chars[last].end)});
        if(last===chars.length-1) break;
        let next=Math.max(first+1,last-1);
        if(wordOverlap && chars[last].space) {
            const boundary=chars.findLastIndex((c,i)=>i>=first&&i<last&&c.space);
            if(boundary>=first&&boundary+1<last) next=boundary+1;
        }
        first=next; start=chars[first].start;
    }
    return windows;
}
/** Range reads only: do not reflow text or change the delivery coordinates. */
export function measureReadingGlyphs(node, pageScale, vertical) {
    const rect=node.getBoundingClientRect(), glyphs=[];
    const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);
    const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
    while(walker.nextNode()) {
        const text=walker.currentNode;
        if(text.parentElement.closest('rt')) continue;
        for(const {segment,index} of segmenter.segment(text.textContent)) {
            const range=document.createRange();range.setStart(text,index);range.setEnd(text,index+segment.length);
            const r=range.getBoundingClientRect();
            const start=(vertical?r.top-rect.top:r.left-rect.left)/pageScale;
            const size=(vertical?r.height:r.width)/pageScale;
            if(size>0) glyphs.push({start,end:start+size,space:/\s/u.test(segment)});
        }
    }
    return glyphs;
}
