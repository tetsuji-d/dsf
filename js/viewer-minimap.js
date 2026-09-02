import { CANONICAL_PAGE_HEIGHT, CANONICAL_PAGE_WIDTH } from './page-geometry.js';

const DEFAULT_IDLE_HIDE_MS = 3000;
const DEFAULT_MAX_WIDTH = 116;
const DEFAULT_MAX_HEIGHT = 116;
const MIN_MAP_WIDTH = 48;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Clamp one axis of an internally zoomed page to the current visual viewport.
 * `viewportStart` matters on iOS when the visual viewport is offset from the
 * layout viewport by standalone/browser chrome.
 */
export function clampViewerPanAxis({
    value,
    contentStart,
    contentSize,
    scale,
    viewportStart = 0,
    viewportSize
}) {
    const start = Number(contentStart) || 0;
    const size = Math.max(0, Number(contentSize) || 0);
    const safeScale = Math.max(1, Number(scale) || 1);
    const visibleStart = Number(viewportStart) || 0;
    const visibleSize = Math.max(1, Number(viewportSize) || 1);
    const center = start + size / 2;
    const scaledHalf = size * safeScale / 2;

    if (scaledHalf * 2 <= visibleSize) {
        return visibleStart + visibleSize / 2 - center;
    }

    const min = visibleStart + visibleSize - center - scaledHalf;
    const max = visibleStart + scaledHalf - center;
    return clamp(Number(value) || 0, min, max);
}

/**
 * Keep one logical point under the same client-space focus while zooming.
 * `focusX` / `focusY` are measured from the untransformed canvas center.
 */
export function calculateViewerAnchoredZoom({
    currentScale = 1,
    viewX = 0,
    viewY = 0,
    nextScale,
    focusX = 0,
    focusY = 0,
    anchorX,
    anchorY,
    minScale = 1,
    maxScale = 5,
    resetThreshold = 1.01
}) {
    const safeMinScale = Math.max(0.001, Number(minScale) || 1);
    const safeMaxScale = Math.max(safeMinScale, Number(maxScale) || 5);
    const scale = clamp(Number(nextScale) || safeMinScale, safeMinScale, safeMaxScale);
    if (scale <= Math.max(safeMinScale, Number(resetThreshold) || safeMinScale)) {
        return { scale: safeMinScale, x: 0, y: 0 };
    }

    const oldScale = Math.max(0.001, Number(currentScale) || safeMinScale);
    const safeFocusX = Number(focusX) || 0;
    const safeFocusY = Number(focusY) || 0;
    const resolvedAnchorX = Number.isFinite(Number(anchorX))
        ? Number(anchorX)
        : (safeFocusX - (Number(viewX) || 0)) / oldScale;
    const resolvedAnchorY = Number.isFinite(Number(anchorY))
        ? Number(anchorY)
        : (safeFocusY - (Number(viewY) || 0)) / oldScale;

    return {
        scale,
        x: safeFocusX - resolvedAnchorX * scale,
        y: safeFocusY - resolvedAnchorY * scale
    };
}

/**
 * Place fixed Viewer navigation buttons around the current page without letting
 * the right button enter an open information drawer.
 */
export function calculateViewerSideNavPlacement({
    canvasLeft,
    canvasWidth,
    viewportStart = 0,
    viewportSize,
    readingEnd,
    buttonWidth = 44,
    edgeGap = 14,
    marginGap = 18
}) {
    const visibleStart = Number(viewportStart) || 0;
    const visibleSize = Math.max(1, Number(viewportSize) || 1);
    const visibleEnd = visibleStart + visibleSize;
    const pageLeft = Number(canvasLeft) || 0;
    const pageWidth = Math.max(0, Number(canvasWidth) || 0);
    const pageRight = pageLeft + pageWidth;
    const safeButtonWidth = Math.max(1, Number(buttonWidth) || 44);
    const safeEdgeGap = Math.max(0, Number(edgeGap) || 0);
    const safeMarginGap = Math.max(0, Number(marginGap) || 0);
    const requestedReadingEnd = Number(readingEnd);
    const safeReadingEnd = clamp(
        Number.isFinite(requestedReadingEnd) ? requestedReadingEnd : visibleEnd,
        visibleStart + safeEdgeGap + safeButtonWidth,
        visibleEnd
    );
    const minButtonX = visibleStart + safeEdgeGap;
    const maxButtonX = Math.max(minButtonX, safeReadingEnd - safeEdgeGap - safeButtonWidth);
    const outsideThreshold = safeButtonWidth + safeMarginGap * 2;
    const leftCandidate = pageLeft - visibleStart >= outsideThreshold
        ? pageLeft - safeMarginGap - safeButtonWidth
        : pageLeft + safeEdgeGap;
    const rightCandidate = safeReadingEnd - pageRight >= outsideThreshold
        ? pageRight + safeMarginGap
        : pageRight - safeEdgeGap - safeButtonWidth;

    return {
        leftX: clamp(leftCandidate, minButtonX, maxButtonX),
        rightX: clamp(rightCandidate, minButtonX, maxButtonX),
        readingEnd: safeReadingEnd
    };
}

/**
 * Convert the Viewer zoom/pan transform into minimap geometry.
 * Kept pure so the viewport math can be regression-tested without a browser.
 */
export function calculateViewerMinimapGeometry({
    scale,
    viewX,
    viewY,
    canvasWidth,
    canvasHeight,
    maxWidth = DEFAULT_MAX_WIDTH,
    maxHeight = DEFAULT_MAX_HEIGHT
}) {
    const safeScale = Math.max(1, Number(scale) || 1);
    const width = Math.max(0, Number(canvasWidth) || 0);
    const height = Math.max(0, Number(canvasHeight) || 0);
    if (!width || !height) return null;

    const ratio = width / height;
    const mapWidth = Math.max(MIN_MAP_WIDTH, Math.min(maxWidth, maxHeight * ratio));
    const mapHeight = mapWidth / ratio;
    const visibleRatio = Math.min(1, 1 / safeScale);
    const maxStart = 1 - visibleRatio;
    const startRatioX = clamp(
        ((safeScale - 1) / 2 - (Number(viewX) || 0) / width) / safeScale,
        0,
        maxStart
    );
    const startRatioY = clamp(
        ((safeScale - 1) / 2 - (Number(viewY) || 0) / height) / safeScale,
        0,
        maxStart
    );

    return {
        mapWidth,
        mapHeight,
        visibleRatio,
        startRatioX,
        startRatioY,
        viewportLeft: startRatioX * mapWidth,
        viewportTop: startRatioY * mapHeight,
        viewportWidth: visibleRatio * mapWidth,
        viewportHeight: visibleRatio * mapHeight,
        focusRatioX: startRatioX + visibleRatio / 2,
        focusRatioY: startRatioY + visibleRatio / 2
    };
}

export function calculateViewerPanFromMinimapPoint({
    pointRatioX,
    pointRatioY,
    scale,
    canvasWidth,
    canvasHeight
}) {
    const safeScale = Math.max(1, Number(scale) || 1);
    const width = Math.max(0, Number(canvasWidth) || 0);
    const height = Math.max(0, Number(canvasHeight) || 0);
    return {
        x: (0.5 - clamp(Number(pointRatioX) || 0, 0, 1)) * width * safeScale,
        y: (0.5 - clamp(Number(pointRatioY) || 0, 0, 1)) * height * safeScale
    };
}

/**
 * Fit each canonical 9:16 page into its minimap slot without reflowing text.
 * Fixed-layout/text pages must first render at 360 x 640 and then be scaled;
 * laying them out directly inside the tiny minimap frame clips most columns.
 */
export function calculateViewerMinimapPagePreviewGeometry({
    mapWidth,
    mapHeight,
    surfaceCount = 1,
    pageWidth = CANONICAL_PAGE_WIDTH,
    pageHeight = CANONICAL_PAGE_HEIGHT
}) {
    const safeMapWidth = Math.max(0, Number(mapWidth) || 0);
    const safeMapHeight = Math.max(0, Number(mapHeight) || 0);
    const safeSurfaceCount = Math.max(1, Math.floor(Number(surfaceCount) || 1));
    const safePageWidth = Math.max(1, Number(pageWidth) || CANONICAL_PAGE_WIDTH);
    const safePageHeight = Math.max(1, Number(pageHeight) || CANONICAL_PAGE_HEIGHT);
    const slotWidth = safeMapWidth / safeSurfaceCount;
    const scale = Math.min(slotWidth / safePageWidth, safeMapHeight / safePageHeight);
    const renderedWidth = safePageWidth * scale;
    const renderedHeight = safePageHeight * scale;

    return {
        scale,
        pageWidth: safePageWidth,
        pageHeight: safePageHeight,
        slotWidth,
        renderedWidth,
        renderedHeight,
        offsetX: Math.max(0, (slotWidth - renderedWidth) / 2),
        offsetY: Math.max(0, (safeMapHeight - renderedHeight) / 2)
    };
}

function getMinimapElements() {
    return {
        minimap: document.getElementById('viewer-minimap'),
        surface: document.getElementById('viewer-minimap-surface'),
        thumbnail: document.getElementById('viewer-minimap-thumbnail'),
        viewport: document.getElementById('viewer-minimap-viewport'),
        divider: document.getElementById('viewer-minimap-divider'),
        zoomLabel: document.getElementById('viewer-minimap-zoom')
    };
}

function getThumbnailKey(snapshot) {
    return [
        snapshot.lang || '',
        snapshot.surfaceMode || '',
        ...snapshot.surfaces.map((surface) => surface.key || '')
    ].join('|');
}

export function createViewerMinimapController({
    getSnapshot,
    onMove,
    getLabel,
    idleHideMs = DEFAULT_IDLE_HIDE_MS
} = {}) {
    let dragging = false;
    let cornerLocked = false;
    let hideTimer = null;
    let thumbnailKey = '';

    function setOppositeCorner(minimap, centerRatioX, centerRatioY) {
        const focusHorizontal = centerRatioX <= 0.5 ? 'left' : 'right';
        const focusVertical = centerRatioY <= 0.5 ? 'top' : 'bottom';
        const cornerHorizontal = focusHorizontal === 'left' ? 'right' : 'left';
        const cornerVertical = focusVertical === 'top' ? 'bottom' : 'top';
        minimap.dataset.focusQuadrant = `${focusVertical}-${focusHorizontal}`;
        minimap.dataset.corner = `${cornerVertical}-${cornerHorizontal}`;
    }

    function clearHideTimer() {
        if (hideTimer !== null) window.clearTimeout(hideTimer);
        hideTimer = null;
    }

    function hide() {
        clearHideTimer();
        cornerLocked = false;
        const { minimap } = getMinimapElements();
        if (minimap) minimap.hidden = true;
    }

    function keepVisible(minimap) {
        minimap.hidden = false;
        cornerLocked = true;
        clearHideTimer();
        hideTimer = window.setTimeout(() => {
            hideTimer = null;
            cornerLocked = false;
            minimap.hidden = true;
        }, idleHideMs);
    }

    function renderThumbnail(thumbnail, snapshot) {
        const nextKey = getThumbnailKey(snapshot);
        thumbnail.classList.toggle('is-spread', snapshot.surfaces.length > 1);
        if (nextKey === thumbnailKey && thumbnail.childElementCount === snapshot.surfaces.length) return;

        thumbnailKey = nextKey;
        const fragment = document.createDocumentFragment();
        snapshot.surfaces.forEach((surface) => {
            const page = document.createElement('div');
            page.className = 'viewer-minimap-page';
            if (surface.blank) {
                page.classList.add('is-blank');
            } else {
                const html = typeof surface.getHtml === 'function'
                    ? surface.getHtml()
                    : surface.html;
                if (!html) {
                    page.classList.add('is-empty');
                    fragment.appendChild(page);
                    return;
                }
                const content = document.createElement('div');
                content.className = 'viewer-minimap-page-content';
                content.innerHTML = html;
                page.appendChild(content);
            }
            fragment.appendChild(page);
        });
        thumbnail.replaceChildren(fragment);
    }

    function update({ fromInteraction = false } = {}) {
        const elements = getMinimapElements();
        const { minimap, surface, thumbnail, viewport, divider, zoomLabel } = elements;
        const snapshot = typeof getSnapshot === 'function' ? getSnapshot() : null;
        const canvas = snapshot?.canvas;
        const scale = Number(snapshot?.scale) || 1;
        if (!minimap || !surface || !thumbnail || !viewport || !canvas) return;

        minimap.setAttribute('aria-label', typeof getLabel === 'function' ? getLabel() : 'Position map');
        if (scale <= 1.05 || !canvas.clientWidth || !canvas.clientHeight) {
            hide();
            return;
        }

        const geometry = calculateViewerMinimapGeometry({
            scale,
            viewX: snapshot.viewX,
            viewY: snapshot.viewY,
            canvasWidth: canvas.clientWidth,
            canvasHeight: canvas.clientHeight
        });
        if (!geometry) {
            hide();
            return;
        }

        surface.style.width = `${geometry.mapWidth}px`;
        surface.style.height = `${geometry.mapHeight}px`;
        if (zoomLabel) zoomLabel.textContent = `${Math.round(scale * 100)}%`;

        const surfaces = Array.isArray(snapshot.surfaces) ? snapshot.surfaces : [];
        snapshot.surfaces = surfaces;
        if (divider) divider.hidden = surfaces.length <= 1;
        renderThumbnail(thumbnail, snapshot);
        const pagePreview = calculateViewerMinimapPagePreviewGeometry({
            mapWidth: geometry.mapWidth,
            mapHeight: geometry.mapHeight,
            surfaceCount: surfaces.length
        });
        thumbnail.style.setProperty('--viewer-minimap-page-width', `${pagePreview.pageWidth}px`);
        thumbnail.style.setProperty('--viewer-minimap-page-height', `${pagePreview.pageHeight}px`);
        thumbnail.style.setProperty('--viewer-minimap-page-scale', String(pagePreview.scale));
        thumbnail.style.setProperty('--viewer-minimap-page-offset-x', `${pagePreview.offsetX}px`);
        thumbnail.style.setProperty('--viewer-minimap-page-offset-y', `${pagePreview.offsetY}px`);

        viewport.style.left = `${geometry.viewportLeft}px`;
        viewport.style.top = `${geometry.viewportTop}px`;
        viewport.style.width = `${geometry.viewportWidth}px`;
        viewport.style.height = `${geometry.viewportHeight}px`;
        if (!cornerLocked) {
            setOppositeCorner(minimap, geometry.focusRatioX, geometry.focusRatioY);
        }
        if (fromInteraction) keepVisible(minimap);
    }

    function moveFromMinimap(event) {
        const { surface } = getMinimapElements();
        const snapshot = typeof getSnapshot === 'function' ? getSnapshot() : null;
        const canvas = snapshot?.canvas;
        const scale = Number(snapshot?.scale) || 1;
        if (!surface || !canvas || scale <= 1.05) return;
        const rect = surface.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        const pan = calculateViewerPanFromMinimapPoint({
            pointRatioX: (event.clientX - rect.left) / rect.width,
            pointRatioY: (event.clientY - rect.top) / rect.height,
            scale,
            canvasWidth: canvas.clientWidth,
            canvasHeight: canvas.clientHeight
        });
        if (typeof onMove === 'function') onMove(pan);
    }

    function bind() {
        const { minimap, surface } = getMinimapElements();
        if (!minimap || !surface || surface.dataset.bound === 'true') return;
        surface.dataset.bound = 'true';

        const stopEvent = (event) => {
            event.preventDefault();
            event.stopPropagation();
        };
        minimap.addEventListener('click', stopEvent);
        minimap.addEventListener('wheel', stopEvent, { passive: false });
        surface.addEventListener('pointerdown', (event) => {
            stopEvent(event);
            dragging = true;
            try { surface.setPointerCapture(event.pointerId); } catch (_) { /* ignore */ }
            moveFromMinimap(event);
        });
        surface.addEventListener('pointermove', (event) => {
            if (!dragging) return;
            stopEvent(event);
            moveFromMinimap(event);
        });
        const finish = (event) => {
            if (!dragging) return;
            dragging = false;
            event.stopPropagation();
            try { surface.releasePointerCapture(event.pointerId); } catch (_) { /* ignore */ }
        };
        surface.addEventListener('pointerup', finish);
        surface.addEventListener('pointercancel', finish);
    }

    return { bind, hide, update };
}
