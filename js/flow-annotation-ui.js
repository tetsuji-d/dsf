/** Annotation rendering and dialog; all persistence is delegated to the caller. */
import { createFlowAnnotationEdit } from './flow-annotations.js';
import { segmentGraphemes } from './grapheme.js';

export function renderAnnotationPreview(element, block, language = 'ja') {
    const document = element.ownerDocument;
    const text = block.texts[language];
    const annotations = block.annotations?.[language] || [];
    element.replaceChildren();
    const ruby = annotations.filter(a => a.type === 'ruby').sort((a,b) => a.start-b.start);
    const addBase = (parent, start, end, readingAnnotation = null) => {
        let segments = segmentGraphemes(text.slice(start,end),language);
        if(!readingAnnotation){
            const grouped=[];
            for(const g of segments){
                const marked=annotations.some(a=>a.type==='emphasis' && a.start<=start+g.index && a.end>=start+g.end);
                const previous=grouped.at(-1);
                if(!marked && previous && !previous.marked){previous.segment+=g.segment;previous.end=g.end;}
                else grouped.push({...g,marked});
            }
            segments=grouped;
        }
        const readings = readingAnnotation ? segmentGraphemes(readingAnnotation.reading,language) : [];
        const extent = Math.max(segments.length, readings.length * .5);
        const readingStart = Math.max(-segmentGraphemes(text.slice(0,start),language).length, (segments.length-extent)/2);
        for (const [index,g] of segments.entries()) {
            const base = document.createElement('span');
            base.dataset.baseStart = String(start + g.index);
            base.dataset.baseEnd = String(start + g.end);
            base.textContent = g.segment;
            base.className = 'annotation-base';
            const emphasis = annotations.find(a => a.type === 'emphasis' && a.start <= start+g.index && a.end >= start+g.end);
            // Preserve older combined data; ruby takes display precedence.
            if (emphasis && !readingAnnotation && !/^\s+$/u.test(g.segment)) {
                const mark=document.createElement('span');mark.className='annotation-single-mark';
                mark.dataset.annotationText='true';mark.dataset.emphasisId=emphasis.id;
                mark.dataset.baseOffset=String(start+g.index);
                mark.textContent=emphasis.mark==='dot'?'•':'﹅';base.append(mark);
            }
            readings.forEach((reading,readingIndex)=>{
                const center=readingStart+(readingIndex+.5)*extent/readings.length;
                const anchor=Math.max(0,Math.min(segments.length-1,Math.floor(center)));
                if(anchor!==index)return;
                const span=document.createElement('span');span.className='annotation-reading';
                span.dataset.annotationText='true';span.dataset.readingIndex=String(readingIndex);
                span.textContent=reading.segment;
                span.style.insetInlineStart=((center-index-.25)*2)+'em';
                span.setAttribute('aria-label','読み '+reading.segment);base.append(span);
            });
            parent.append(base);
        }
    };
    let cursor = 0;
    for (const a of ruby) {
        addBase(element,cursor,a.start);
        const node = document.createElement('ruby');
        node.dataset.annotationId = a.id;
        node.title = a.reviewState === 'needs-review' ? 'ルビの読みを確認してください' : a.reading;
        node.className = 'annotation-ruby';
        if (a.reviewState === 'needs-review') node.classList.add('needs-review');
        addBase(node,a.start,a.end,a);
        element.append(node);
        cursor = a.end;
    }
    addBase(element,cursor,text.length);
}

export function getAnnotationSelection(element) {
    const selection = element.ownerDocument.getSelection();
    if (!selection?.rangeCount || !element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) return null;
    const offset = (node, value) => {
        const base = (node.nodeType===1 ? node : node.parentElement)?.closest('[data-base-start]');
        if (!base || !element.contains(base)) return null;
        return Number(base.dataset.baseStart) + (node.nodeType===3 ? Math.min(value,node.data.length) : value ? base.firstChild.textContent.length : 0);
    };
    const anchor = offset(selection.anchorNode,selection.anchorOffset), focus = offset(selection.focusNode,selection.focusOffset);
    return anchor === null || focus === null ? null : {start:Math.min(anchor,focus),end:Math.max(anchor,focus)};
}

/** Applies only to a caller-owned in-memory document after an explicit dialog action. */
export function openAnnotationDialog({ source, sectionId, blockId, range, languageKey='ja', initialFocus='reading', onApply, onClose }) {
    const block = source.sections.find(s=>s.id===sectionId).blocks.find(b=>b.id===blockId);
    const text = block.texts[languageKey];
    const list = block.annotations?.[languageKey] || [];
    const match = type => list.find(a=>a.type===type && (range.start===range.end
        ? a.start<=range.start && range.start<a.end : a.start===range.start && a.end===range.end));
    let existingRuby = match('ruby'), existingEmphasis = match('emphasis');
    if (range.start===range.end) {
        const existing = existingRuby || existingEmphasis;
        if (!existing) return false;
        range = {start:existing.start,end:existing.end};
        existingRuby = match('ruby'); existingEmphasis = match('emphasis');
    }
    const dialog = document.createElement('dialog');
    dialog.className = 'flow-annotation-dialog';
    dialog.setAttribute('aria-labelledby','annotation-dialog-title');
    // Dialog-local native undo must not undo the manuscript underneath it.
    dialog.addEventListener('keydown',event=>{
        if((event.ctrlKey || event.metaKey) && ['z','y'].includes(event.key.toLowerCase()))event.stopPropagation();
    });
    dialog.innerHTML = `<form method="dialog">
        <header><h2 id="annotation-dialog-title">ルビ・圏点</h2><button value="cancel" aria-label="閉じる">×</button></header>
        <label>対象の文字<output data-parent></output></label>
        <label>ルビの読み<input name="reading" autocomplete="off" placeholder="例：としょかん"></label>
        <p class="annotation-help">ルビと圏点は同じ文字には併用しません。一方を設定すると、もう一方を解除します。</p>
        <label>圏点<select name="mark"><option value="none">なし</option><option value="sesame">ゴマ点</option><option value="dot">黒丸</option></select></label>
        <div class="annotation-live" aria-label="設定後の見た目"><div data-preview></div></div>
        <p data-error role="alert"></p>
        <footer><button value="cancel">キャンセル</button><button type="button" data-apply class="primary">適用</button></footer>
    </form>`;
    const reading = dialog.querySelector('[name=reading]'), mark = dialog.querySelector('[name=mark]');
    reading.value = existingRuby?.reading || '';
    mark.value = existingRuby ? 'none' : existingEmphasis?.mark || 'none';
    dialog.querySelector('[data-parent]').textContent = text.slice(range.start,range.end);
    const candidate = () => {
        let result = source;
        const chosenType=reading.value.trim()?'ruby':mark.value!=='none'?'emphasis':null;
        if(chosenType && list.some(a=>a.type!==chosenType && a.start<range.end && range.start<a.end && (a.start!==range.start || a.end!==range.end)))throw new Error('ANNOTATION_PARTIAL_OVERLAP');
        for (const type of ['ruby','emphasis']) {
            const existing = type==='ruby' ? existingRuby : existingEmphasis;
            const value = type==='ruby' ? reading.value.trim() : mark.value;
            const op = {sectionId,blockId,languageKey,expectedText:text};
            if ((type==='ruby' && !value) || (type==='emphasis' && value==='none')) {
                if (existing) result=createFlowAnnotationEdit(result,{...op,action:'remove',id:existing.id});
                continue;
            }
            const annotation={id:existing?.id || crypto.randomUUID(),type,...range,
                ...(type==='ruby'?{reading:value,reviewState:'confirmed'}:{mark:value})};
            result=createFlowAnnotationEdit(result,{...op,action:'set',annotation});
        }
        return result;
    };
    const update = () => {
        const error = dialog.querySelector('[data-error]');
        try {
            const result=candidate();
            const next=result.sections.find(s=>s.id===sectionId).blocks.find(b=>b.id===blockId);
            const preview = {...next,texts:{[languageKey]:text.slice(range.start,range.end)},annotations:{[languageKey]:(next.annotations?.[languageKey]||[])
                .filter(a=>a.start>=range.start && a.end<=range.end).map(a=>({...a,start:a.start-range.start,end:a.end-range.start}))}};
            renderAnnotationPreview(dialog.querySelector('[data-preview]'),preview,languageKey);
            error.textContent='';dialog.querySelector('[data-apply]').disabled=false;return result;
        } catch {
            error.textContent='既存のルビ・圏点と一部が重なっています。対象の文字全体を選択してください。';
            dialog.querySelector('[data-apply]').disabled=true;return null;
        }
    };
    reading.addEventListener('input',()=>{if(reading.value.trim())mark.value='none';update();});
    mark.addEventListener('change',()=>{if(mark.value!=='none')reading.value='';update();});
    const previous = document.activeElement;
    dialog.querySelector('[data-apply]').onclick=()=>{const next=update();if(next){
        try { onApply(next); dialog.close(); }
        catch { dialog.querySelector('[data-error]').textContent='原稿が変更されています。閉じて対象文字を選び直してください。'; }
    }};
    dialog.addEventListener('close',()=>{dialog.remove();previous?.focus?.({preventScroll:true});onClose?.();},{once:true});
    document.body.append(dialog);update();dialog.showModal();(initialFocus==='mark'?mark:reading).focus();return true;
}
