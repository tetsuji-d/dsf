import { renderFlowGeneratedPage } from './flow-dom-measurer.js';
import { calculateFlowCanvasLayout, calculateFlowCanvasWindow,
    getFlowCanvasPagePosition, getFlowCanvasPageScrollLeft } from './flow-canvas-layout.js';
import { normalizeFlowPageGuideMode, resolveFlowPageRuleGuide } from './flow-page-guides.js';

/** Editor-only virtual page strip. Page geometry and saved publication data never change. */
export function createFlowCanvasView({ container, getPinnedPageIndex, onPageCreate,
    onGeometryChange, onScrollPage, getPageLabel }) {
    const viewport = document.createElement('div');
    viewport.id = 'flow-canvas-viewport';
    viewport.dataset.testid = 'flow-canvas-viewport';
    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', 'Flowページ・横スクロール');
    viewport.tabIndex = 0;
    viewport.hidden = true;
    viewport.dataset.flowPageGuideMode = 'off';
    const track = document.createElement('div');
    track.id = 'flow-canvas-track';
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
        const guide = resolveFlowPageRuleGuide({
            mode: guideMode,
            languageKey: entry.page.languageKey,
            writingMode: entry.page.writingMode,
            typography: entry.page.typography,
        });
        if (guide.mode === 'off') {
            delete contentElement.dataset.flowPageGuide;
            delete contentElement.dataset.flowPageGuideAxis;
            contentElement.style.removeProperty('--flow-page-rule-pitch');
            return;
        }
        contentElement.dataset.flowPageGuide = guide.mode;
        contentElement.dataset.flowPageGuideAxis = guide.axis;
        contentElement.style.setProperty('--flow-page-rule-pitch', `${guide.linePitch}px`);
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
            if (!indices.has(index)) { entry.slot.remove(); mounted.delete(index); }
        }
        for (const index of indices) {
            const page = pages[index];
            if (!page) continue;
            let entry = mounted.get(index);
            if (!entry) {
                const slot = document.createElement('div');
                slot.className = 'flow-canvas-page-slot';
                slot.dataset.flowPageIndex = String(index);
                const pageFrame = document.createElement('div');
                pageFrame.className = 'flow-canvas-page-frame';
                const pageElement = document.createElement('div');
                pageElement.className = 'flow-editor-page-surface';
                pageElement.dataset.testid = 'flow-editor-generated-page';
                pageElement.dataset.flowRuntimeKey = page.runtimeKey;
                pageElement.dataset.publicationIndex = String(page.index);
                pageElement.dataset.flowPageIndex = String(index);
                pageElement._flowPageEntry = page;
                pageFrame.appendChild(pageElement);
                slot.appendChild(pageFrame);
                const label = document.createElement('div');
                label.className = 'flow-canvas-page-label';
                label.textContent = getPageLabel(page);
                slot.appendChild(label);
                track.appendChild(slot);
                const contentElement = renderFlowGeneratedPage(pageElement, { page: page.page, pageBox: page.pageBox,
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
            entry.slot.dataset.selected = String(index === selected);
        }
        viewport.dataset.visiblePageCount = String(layout.visibleCount);
        viewport.dataset.mountedPageCount = String(mounted.size);
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
                writingMode: pages[0].writingMode, scale: explicitScale ?? retainedScale });
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

    viewport.addEventListener('mousedown', event => event.stopPropagation());
    viewport.addEventListener('touchstart', event => event.stopPropagation(), { passive: true });
    viewport.addEventListener('wheel', event => {
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
        setVisible(visible) { viewport.hidden = !visible; },
        resize, ensurePage, setGuideMode,
        getScale() { return layout?.scale || 1; },
        getMountedPages() { return [...mounted.values()].sort((a, b) => a.pageIndex - b.pageIndex); },
        getPageElement(index) { return mounted.get(index)?.pageElement || null; },
    };
}
