import {paintFlowLineGuides} from './flow-line-guides.js';
import { renderFlowGeneratedPage } from './flow-dom-measurer.js';
import { calculateFlowCanvasLayout, calculateFlowCanvasWindow,
    getFlowCanvasPagePosition, getFlowCanvasPageScrollLeft } from './flow-canvas-layout.js';
import { normalizeFlowPageGuideMode } from './flow-page-guides.js';

/** Editor-only virtual page strip. Page geometry and saved publication data never change. */
export function createFlowCanvasView({ container, getPinnedPageIndex, onPageCreate,
    onGeometryChange, onScrollPage, onReadingScroll, getPageLabel, getFlowGroupLabel, renderFixedPage, onBeforeRemove, getDirection, getJoinedPageIndices, onBoundaryMenu }) {
    const viewport = document.createElement('div');
    viewport.id = 'flow-canvas-viewport';
    viewport.className = 'flow-canvas-viewport';
    viewport.dataset.testid = 'flow-canvas-viewport';
    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', document.documentElement.lang==='en'?'Work pages, horizontal scrolling':'作品ページ・横スクロール');
    viewport.tabIndex = 0;
    viewport.hidden = true;
    viewport.dataset.flowPageGuideMode = 'off';
    const track = document.createElement('div');
    track.id = 'flow-canvas-track';
    track.className = 'flow-canvas-track';
    viewport.appendChild(track);
    container.appendChild(viewport);
    const mounted = new Map();
    let pages = [];
    let layout = null;
    let selected = 0;
    let frame = null;
    let contextKey = null;
    let explicitScale = null;
    let programmaticScrollLeft = null;
    let guideMode = 'off';

    function applyPageGuide(entry) {
        const contentElement = entry?.contentElement;
        if (!contentElement) return;
        // Coalesce until the mounted page has its final zoom and layout.
        cancelAnimationFrame(entry.guideFrame);
        if(guideMode==='off') paintFlowLineGuides(entry.pageElement,entry.page.pageBox,false);
        else entry.guideFrame=requestAnimationFrame(()=>paintFlowLineGuides(entry.pageElement,entry.page.pageBox,guideMode!=='off'));

    }

    function setGuideMode(value) {
        guideMode = normalizeFlowPageGuideMode(value);
        viewport.dataset.flowPageGuideMode = guideMode;
        mounted.forEach(applyPageGuide);
        return guideMode;
    }

    function setScrollLeft(value) {
        viewport.scrollLeft = value;
        // Native scroll events also fire for our reveal operations. They must
        // not replace the requested page with its neighbour at viewport center.
        programmaticScrollLeft = viewport.scrollLeft;
    }

    function renderWindow(extraPageIndex) {
        if (!layout) return;
        const window = calculateFlowCanvasWindow(layout, {
            scrollLeft: viewport.scrollLeft, overscan: 1, pinnedPageIndex: getPinnedPageIndex?.(),
        });
        const indices = new Set(window.pageIndices);
        if (Number.isInteger(extraPageIndex) && pages[extraPageIndex]) indices.add(extraPageIndex);
        for (const [index, entry] of mounted) {
            if (!indices.has(index)) { onBeforeRemove?.(entry); entry.slot.remove(); mounted.delete(index); }
        }
        for (const index of indices) {
            const page = pages[index];
            if (!page) continue;
            let entry = mounted.get(index);
            if (!entry) {
                const slot = document.createElement('div');
                slot.className = 'flow-canvas-page-slot';
                slot.dataset.flowPageIndex = String(index);
                slot.dataset.pageKind = page.kind;
                slot.dataset.runtimeKey = page.runtimeKey;
                slot.dataset.editorUnitId=page.groupId||page.blockId;
                slot.dataset.blockIndex=String(page.blockIndex);
                slot.dataset.generatedPageIndex=String(page.flowPageIndex||0);
                const pageFrame = document.createElement('div');
                pageFrame.className = 'flow-canvas-page-frame';
                const pageElement = document.createElement('div');
                pageElement.className = page.kind === 'fixed' ? 'editor-fixed-page-surface' : 'flow-editor-page-surface';
                pageElement.dataset.testid = page.kind === 'fixed' ? 'editor-fixed-page' : 'flow-editor-generated-page';
                pageElement.dataset.flowRuntimeKey = page.runtimeKey;
                pageElement.dataset.publicationIndex = String(page.index);
                pageElement.dataset.flowPageIndex = String(index);
                pageElement._flowPageEntry = page;
                pageFrame.appendChild(pageElement);
                const grip=document.createElement('span');grip.className='editor-canvas-drag-handle editor-canvas-frame-grip';grip.dataset.editorUnitId=page.blockId;grip.dataset.flowPageIndex=String(page.flowPageIndex||0);grip.title=document.documentElement.lang==='en'?'Hold to move page / Flow group':'長押ししてページ／Flow全体を移動';pageFrame.append(grip);
                slot.appendChild(pageFrame);
                const label = document.createElement('div');
                label.className = 'flow-canvas-page-label';
                label.textContent = getPageLabel(page);
                label.dataset.editorUnitId=page.groupId||page.blockId;label.dataset.flowPageIndex=String(page.flowPageIndex||0);
                label.classList.add('editor-canvas-drag-handle');label.tabIndex=0;
                slot.appendChild(label);
                if(index<pages.length-1){const gap=document.createElement('button');gap.type='button';gap.className='editor-canvas-boundary';gap.textContent='+';gap.setAttribute('aria-label',document.documentElement.lang==='en'?'Insert page here':'ここにページを挿入');gap.oncontextmenu=e=>{e.preventDefault();e.stopPropagation();onBoundaryMenu?.(e,page,'after');};gap.onclick=e=>{e.stopPropagation();onBoundaryMenu?.(e,page,'after');};slot.append(gap);}

                if (page.kind === 'flow') {
                    const band = document.createElement('div'); band.className = 'flow-canvas-group-band';
                    band.textContent = (getFlowGroupLabel?.(page) || 'Flow') + ' · ' + (page.flowPageIndex + 1) + '/' + page.flowPageCount;
                    slot.appendChild(band);
                    slot.dataset.groupStart = String(pages[index-1]?.groupId !== page.groupId);
                    slot.dataset.groupEnd = String(pages[index+1]?.groupId !== page.groupId);
                }
                track.appendChild(slot);
                const contentElement = page.kind === 'fixed'
                    ? (renderFixedPage?.(pageElement, page), null)
                    : renderFlowGeneratedPage(pageElement, { page: page.page, pageBox: page.pageBox,
                        languageKey: page.languageKey, writingMode: page.writingMode, typography: page.typography });
                entry = { slot, pageElement, contentElement, page, pageIndex: index };
                mounted.set(index, entry);
                applyPageGuide(entry);
                onPageCreate(entry);
            }
            const position = getFlowCanvasPagePosition(layout, index);
            Object.assign(entry.slot.style, {
                left: `${position.left}px`, top: `${position.top}px`, width: `${position.width}px`,
                height: `${position.height + layout.labelHeight}px`,
            });
            entry.slot.dataset.direction=getDirection?.()||'ltr';
            entry.slot.dataset.joinedAfter=String(getJoinedPageIndices?.(pages)?.includes(index+1)||false);
            entry.slot.dataset.groupSelected = String(page.kind === 'flow' && pages[selected]?.groupId === page.groupId);
            const selectedSpread = pages[selected]?.section?.spreadImage?.groupId;
            entry.slot.dataset.selected = String(index === selected || !!(selectedSpread
                && entry.page.section?.spreadImage?.groupId === selectedSpread));
        }
        viewport.dataset.visiblePageCount = String(layout.visibleCount);
        viewport.dataset.mountedPageCount = String(mounted.size);
        mounted.forEach(applyPageGuide);
        onGeometryChange?.();
    }

    function applyLayout({ reveal = true, readingOffset, retainedScale } = {}) {
        if (!pages.length || viewport.hidden) return;
        if (layout && explicitScale === null && (layout.viewportWidth !== viewport.clientWidth
            || layout.viewportHeight !== viewport.clientHeight)) retainedScale = undefined;
        // Scrollbars can change client dimensions after the first track is
        // inserted. Settle that geometry now, not on the next text input.
        for (let attempt = 0; attempt < 3; attempt += 1) {
            layout = calculateFlowCanvasLayout({ viewportWidth: viewport.clientWidth,
                viewportHeight: viewport.clientHeight, pageCount: pages.length,
                labelHeight: pages.some(page=>page.kind==='flow') ? 48 : 24,
                writingMode: pages[0].writingMode, direction: getDirection?.(),
                joinedPageIndices: getJoinedPageIndices?.(pages), scale: explicitScale ?? retainedScale });
            viewport.style.setProperty('--flow-canvas-scale', layout.scale);
            viewport.style.setProperty('--flow-canvas-page-height', `${layout.pageHeight}px`);
            viewport.dataset.direction = layout.direction;
            Object.assign(track.style, { width: `${layout.trackWidth}px`, height: `${layout.trackHeight}px` });
            if (layout.viewportWidth === viewport.clientWidth && layout.viewportHeight === viewport.clientHeight) break;
            if (explicitScale === null) retainedScale = undefined;
        }
        if (Number.isFinite(readingOffset)) {
            setScrollLeft(layout.direction === 'rtl' ? layout.maxScrollLeft - readingOffset : readingOffset);
        }
        if (reveal) setScrollLeft(getFlowCanvasPageScrollLeft(layout, selected,
            { align: 'nearest', scrollLeft: viewport.scrollLeft }));
        renderWindow(selected);
    }

    function resize({ scale, reveal = true } = {}) {
        const nextScale = Number(scale);
        // Public resize without a scale is the editor's Fit command. Updating
        // source below calls applyLayout directly and preserves explicit zoom.
        explicitScale = Number.isFinite(nextScale) && nextScale > 0 ? nextScale : null;
        applyLayout({ reveal });
    }

    function ensurePage(index, reveal = true) {
        if (!layout || !pages[index]) return null;
        selected = index;
        if (reveal) setScrollLeft(getFlowCanvasPageScrollLeft(layout, index,
            { align: 'nearest', scrollLeft: viewport.scrollLeft }));
        renderWindow(index);
        return mounted.get(index)?.pageElement || null;
    }

    const stopPassivePointer = event => {
        // The live Fixed stage keeps its existing bubble and image-drag handlers on canvas-view.
        if (!event.target.closest('#canvas-stage')) event.stopPropagation();
    };
    viewport.addEventListener('mousedown', stopPassivePointer);
    viewport.addEventListener('touchstart', stopPassivePointer, { passive: true });
    viewport.addEventListener('wheel', event => {
        if (event.target.closest('#canvas-transform-layer.adjust-image-mode')) return;
        event.stopPropagation();
        if (event.ctrlKey || event.metaKey) return; // Browser pinch/zoom remains native.
        event.preventDefault();
        const unit = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? viewport.clientWidth : 1;
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX
            : event.deltaY * (layout?.direction === 'rtl' ? -1 : 1);
        viewport.scrollLeft += delta * unit;
    }, { passive: false });
    viewport.addEventListener('scroll', () => {
        if (frame !== null) return;
        frame = requestAnimationFrame(() => {
            frame = null;
            if (viewport.hidden || !layout) return;
            renderWindow();
            const programmatic = programmaticScrollLeft !== null
                && Math.abs(viewport.scrollLeft - programmaticScrollLeft) < 0.5;
            programmaticScrollLeft = null;
            if (programmatic) return;
            onReadingScroll?.();
            if (getPinnedPageIndex?.() !== null && getPinnedPageIndex?.() !== undefined) return;
            const center = viewport.scrollLeft + viewport.clientWidth / 2;
            const visible = calculateFlowCanvasWindow(layout, { scrollLeft: viewport.scrollLeft, overscan: 0 });
            const next = visible.visiblePageIndices.reduce((nearest, index) => {
                const candidate = getFlowCanvasPagePosition(layout, index);
                const previous = getFlowCanvasPagePosition(layout, nearest);
                return !previous || Math.abs(candidate.left + candidate.width / 2 - center)
                    < Math.abs(previous.left + previous.width / 2 - center) ? index : nearest;
            }, selected);
            if (next !== selected) { selected = next; renderWindow(); onScrollPage?.(next); }
        });
    });

    return {
        viewport,
        update(nextPages, selectedIndex, nextContextKey) {
            const resolvedContext = nextContextKey
                ?? `${nextPages[0]?.groupId || ''}:${nextPages[0]?.languageKey || ''}`;
            const sameContext = contextKey !== null && contextKey === resolvedContext && layout !== null;
            const retainedScale = sameContext ? layout.scale : undefined;
            const readingOffset = sameContext ? layout.direction === 'rtl'
                ? layout.maxScrollLeft - viewport.scrollLeft : viewport.scrollLeft : undefined;
            if (!sameContext) explicitScale = null;
            contextKey = resolvedContext;
            pages = nextPages;
            selected = Math.max(0, Math.min(pages.length - 1, Number(selectedIndex) || 0));
            mounted.forEach(entry => onBeforeRemove?.(entry));
            mounted.clear();
            track.replaceChildren();
            if (!pages.length) {
                layout = null;
                viewport.hidden = true;
                return;
            }
            viewport.hidden = false;
            applyLayout({ reveal: sameContext, readingOffset, retainedScale });
            if (!sameContext) setScrollLeft(getFlowCanvasPageScrollLeft(layout, selected, { align: 'start' }));
            renderWindow(selected);
        },
        setVisible(visible) {
            if (!visible) mounted.forEach(entry => onBeforeRemove?.(entry));
            viewport.hidden = !visible;
        },
        refreshLabels() {
            const en = document.documentElement.lang === 'en';
            viewport.setAttribute('aria-label', en ? 'Work pages, horizontal scrolling' : '作品ページ・横スクロール');
            for (const { slot, page } of mounted.values()) {
                slot.querySelector('.flow-canvas-page-label').textContent = getPageLabel(page);
                const grip = slot.querySelector('.editor-canvas-frame-grip');
                if (grip) grip.title = en ? 'Hold to move page / Flow group' : '長押ししてページ／Flow全体を移動';
                slot.querySelector('.editor-canvas-boundary')?.setAttribute('aria-label', en ? 'Insert page here' : 'ここにページを挿入');
            }
        },
        resize, ensurePage, setGuideMode,
        getReadingPosition() {
            if (!layout) return 0;
            const stride = pages.length > 1 ? Math.abs(getFlowCanvasPagePosition(layout, 1).left - getFlowCanvasPagePosition(layout, 0).left) : 1;
            return (layout.direction === 'rtl' ? layout.maxScrollLeft - viewport.scrollLeft : viewport.scrollLeft) / stride;
        },
        setReadingPosition(value) {
            if (!layout) return;
            const stride = pages.length > 1 ? Math.abs(getFlowCanvasPagePosition(layout, 1).left - getFlowCanvasPagePosition(layout, 0).left) : 1;
            const offset = Math.max(0, Math.min(layout.maxScrollLeft, value * stride));
            setScrollLeft(layout.direction === 'rtl' ? layout.maxScrollLeft - offset : offset);
            renderWindow();
        },
        getScale() { return layout?.scale || 1; },
        getPages() { return pages; },
        refreshFixedPreviews(predicate) {
            for (const entry of mounted.values()) {
                if (entry.page.kind !== 'fixed' || !predicate(entry.page)
                    || entry.pageElement.querySelector('#canvas-stage')) continue;
                entry.pageElement.replaceChildren();
                renderFixedPage?.(entry.pageElement, entry.page);
            }
        },
        getMountedPages() { return [...mounted.values()].sort((a, b) => a.pageIndex - b.pageIndex); },
        getPageElement(index) { return mounted.get(index)?.pageElement || null; },
    };
}
