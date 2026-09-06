import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import {
    calculateViewerAnchoredZoom,
    calculateViewerMinimapGeometry,
    calculateViewerMinimapPagePreviewGeometry,
    calculateViewerPanFromMinimapPoint,
    calculateViewerSideNavPlacement,
    clampViewerPanAxis
} from '../js/viewer-minimap.js';

function nearlyEqual(actual, expected, tolerance = 0.001) {
    assert.ok(
        Math.abs(actual - expected) <= tolerance,
        `Expected ${actual} to be within ${tolerance} of ${expected}`
    );
}

const centered = calculateViewerMinimapGeometry({
    scale: 2,
    viewX: 0,
    viewY: 0,
    canvasWidth: 360,
    canvasHeight: 640
});
assert.ok(centered, 'Centered zoom geometry should be available');
nearlyEqual(centered.visibleRatio, 0.5);
nearlyEqual(centered.startRatioX, 0.25);
nearlyEqual(centered.startRatioY, 0.25);

const leftEdgePan = calculateViewerPanFromMinimapPoint({
    pointRatioX: 0.25,
    pointRatioY: 0.5,
    scale: 2,
    canvasWidth: 360,
    canvasHeight: 640
});
nearlyEqual(leftEdgePan.x, 180);
nearlyEqual(leftEdgePan.y, 0);

const leftEdge = calculateViewerMinimapGeometry({
    scale: 2,
    viewX: leftEdgePan.x,
    viewY: leftEdgePan.y,
    canvasWidth: 360,
    canvasHeight: 640
});
assert.ok(leftEdge, 'Panned zoom geometry should be available');
nearlyEqual(leftEdge.startRatioX, 0);
nearlyEqual(leftEdge.startRatioY, 0.25);

const singlePagePreview = calculateViewerMinimapPagePreviewGeometry({
    mapWidth: centered.mapWidth,
    mapHeight: centered.mapHeight,
    surfaceCount: 1
});
nearlyEqual(singlePagePreview.renderedWidth, centered.mapWidth);
nearlyEqual(singlePagePreview.renderedHeight, centered.mapHeight);

const spreadMap = calculateViewerMinimapGeometry({
    scale: 2,
    viewX: 0,
    viewY: 0,
    canvasWidth: 720,
    canvasHeight: 640
});
assert.ok(spreadMap, 'Spread minimap geometry should be available');
const spreadPagePreview = calculateViewerMinimapPagePreviewGeometry({
    mapWidth: spreadMap.mapWidth,
    mapHeight: spreadMap.mapHeight,
    surfaceCount: 2
});
nearlyEqual(spreadPagePreview.renderedWidth * 2, spreadMap.mapWidth);
nearlyEqual(spreadPagePreview.renderedHeight, spreadMap.mapHeight);

const topEdgePan = clampViewerPanAxis({
    value: Number.POSITIVE_INFINITY,
    contentStart: 100,
    contentSize: 600,
    scale: 2,
    viewportStart: 47,
    viewportSize: 800
});
nearlyEqual(100 + 300 + topEdgePan - 600, 47);

// Mobile page has letterboxing at rest; zoom reveals the entire viewport.
const phone = {
    scale: 2.82, canvasWidth: 440, canvasHeight: 782,
    canvasLeft: 0, canvasTop: 87, viewportLeft: 0, viewportTop: 0,
    viewportWidth: 440, viewportHeight: 956
};
for (const [value, edge] of [[Infinity, 'top'], [-Infinity, 'bottom']]) {
    const viewY = clampViewerPanAxis({
        value, contentStart: phone.canvasTop, contentSize: phone.canvasHeight,
        scale: phone.scale, viewportStart: phone.viewportTop, viewportSize: phone.viewportHeight
    });
    const map = calculateViewerMinimapGeometry({ ...phone, viewX: 0, viewY });
    nearlyEqual(map.visibleRatioY, 956 / (782 * 2.82));
    nearlyEqual(map.visibleRatioX, 1 / 2.82);
    nearlyEqual(edge === 'top' ? map.viewportTop : map.viewportTop + map.viewportHeight,
        edge === 'top' ? 0 : map.mapHeight);
    const pan = calculateViewerPanFromMinimapPoint({ ...phone,
        pointRatioX: map.focusRatioX, pointRatioY: map.focusRatioY });
    nearlyEqual(pan.y, viewY);
}
const fitsVertically = calculateViewerMinimapGeometry({ ...phone, scale: 1.1, viewY: 0 });
nearlyEqual(fitsVertically.viewportTop, 0);
nearlyEqual(fitsVertically.viewportHeight, fitsVertically.mapHeight);
const offsetViewport = { ...phone, canvasLeft: 20, canvasTop: 110, viewportLeft: 10, viewportTop: 47 };
const offsetMap = calculateViewerMinimapGeometry({ ...offsetViewport, viewX: 15, viewY: -70 });
const offsetPan = calculateViewerPanFromMinimapPoint({ ...offsetViewport,
    pointRatioX: offsetMap.focusRatioX, pointRatioY: offsetMap.focusRatioY });
nearlyEqual(offsetPan.x, 15);
nearlyEqual(offsetPan.y, -70);

const focusedZoom = calculateViewerAnchoredZoom({
    currentScale: 1,
    viewX: 0,
    viewY: 0,
    nextScale: 2,
    focusX: -100,
    focusY: -200
});
nearlyEqual(focusedZoom.scale, 2);
nearlyEqual(focusedZoom.x, 100);
nearlyEqual(focusedZoom.y, 200);
nearlyEqual(focusedZoom.x + (-100 * focusedZoom.scale), -100);
nearlyEqual(focusedZoom.y + (-200 * focusedZoom.scale), -200);

const movingPinchZoom = calculateViewerAnchoredZoom({
    currentScale: 2,
    nextScale: 3,
    focusX: -80,
    focusY: -170,
    anchorX: -100,
    anchorY: -200
});
nearlyEqual(movingPinchZoom.x, 220);
nearlyEqual(movingPinchZoom.y, 430);
nearlyEqual(movingPinchZoom.x + (-100 * movingPinchZoom.scale), -80);
nearlyEqual(movingPinchZoom.y + (-200 * movingPinchZoom.scale), -170);

assert.deepEqual(calculateViewerAnchoredZoom({
    currentScale: 2,
    viewX: 80,
    viewY: 120,
    nextScale: 1,
    focusX: 40,
    focusY: 60
}), { scale: 1, x: 0, y: 0 });

const closedDrawerNav = calculateViewerSideNavPlacement({
    canvasLeft: 320,
    canvasWidth: 1106,
    viewportSize: 1746,
    readingEnd: 1746
});
nearlyEqual(closedDrawerNav.leftX, 258);
nearlyEqual(closedDrawerNav.rightX, 1444);

const openDrawerNav = calculateViewerSideNavPlacement({
    canvasLeft: 5,
    canvasWidth: 1106,
    viewportSize: 1746,
    readingEnd: 1116
});
nearlyEqual(openDrawerNav.leftX, 19);
nearlyEqual(openDrawerNav.rightX, 1053);
assert.ok(openDrawerNav.rightX + 44 <= openDrawerNav.readingEnd, 'Right navigation must stay outside the info drawer');

const [html, viewerJs, css] = await Promise.all([
    readFile(new URL('../viewer.html', import.meta.url), 'utf8'),
    readFile(new URL('../js/viewer.js', import.meta.url), 'utf8'),
    readFile(new URL('../css/viewer.css', import.meta.url), 'utf8')
]);

// Exercise the actual DOM-to-focus adapter, including successive pinch frames.
// A pure anchored-zoom test alone cannot detect double-counted pan here.
const focusSource = viewerJs.match(/function getZoomFocusPoint\(clientX, clientY\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(focusSource, 'Viewer focus adapter must be available');
const gestureContext = {
    document: { getElementById: () => ({ getBoundingClientRect: () => ({ left: 0, top: 87, width: 440, height: 782 }) }) },
    viewX: 30, viewY: -80
};
const focusAt = runInNewContext(`(${focusSource})`, gestureContext);
const initialFocus = focusAt(160, 390);
const anchor = { x: (initialFocus.x - 30) / 2, y: (initialFocus.y + 80) / 2 };
for (const [scale, x, y] of [[2.2, 160, 390], [2.5, 165, 400], [3, 175, 410]]) {
    const focus = focusAt(x, y);
    const next = calculateViewerAnchoredZoom({ currentScale: 2, nextScale: scale,
        focusX: focus.x, focusY: focus.y, anchorX: anchor.x, anchorY: anchor.y });
    nearlyEqual(220 + next.x + anchor.x * scale, x);
    nearlyEqual(478 + next.y + anchor.y * scale, y);
    gestureContext.viewX = next.x;
    gestureContext.viewY = next.y;
}

for (const id of [
    'viewer-minimap',
    'viewer-minimap-surface',
    'viewer-minimap-thumbnail',
    'viewer-minimap-divider',
    'viewer-minimap-viewport',
    'viewer-minimap-zoom',
    'viewer-zoom-layer'
]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `Missing Viewer minimap DOM: ${id}`);
}
assert.match(html, /<a[^>]+id=["']viewer-horizon-link["'][^>]+href=["']\/["']/, 'Viewer header must link the Horizon brand to the portal');
assert.doesNotMatch(html, /viewer-footer-brand|Powered\s+by\s*<\/span>/, 'Viewer footer branding must be removed');
assert.match(css, /\.viewer-horizon-link\s*\{/, 'Viewer Horizon link styling must exist');
assert.match(viewerJs, /horizonHome:\s*'Horizonへ戻る'/, 'Viewer Horizon link must have a Japanese accessible label');
assert.match(viewerJs, /horizonHome:\s*'Back to Horizon'/, 'Viewer Horizon link must have an English accessible label');

assert.match(viewerJs, /createViewerMinimapController/, 'Viewer must initialize the minimap controller');
assert.match(viewerJs, /clampViewerPanAxis/, 'Viewer zoom pan must be clamped against the visual viewport');
assert.match(viewerJs, /initializeViewerMinimap\(\)/, 'Viewer init must bind the minimap');
assert.match(viewerJs, /\['click-layer', 'viewer-zoom-layer'\]/, 'Zoomed pages must retain full-viewport pointer handling');
assert.match(viewerJs, /window\.visualViewport/, 'Viewer centering must use the visual viewport when available');
assert.match(viewerJs, /document\.body\.classList\.toggle\('viewer-zoom-active', active\)/, 'Viewer must switch to full-viewport zoom mode');
assert.match(viewerJs, /bindViewerInfoPanelLayoutSync\(\)/, 'Viewer must bind info drawer geometry updates');
assert.match(viewerJs, /new ResizeObserver\(\(\) => syncViewerCanvasChromePlacement\(\)\)/, 'Viewer controls must follow the animated info drawer width');
assert.match(viewerJs, /event\.propertyName !== 'width'/, 'Viewer must realign controls when the drawer width transition ends');
assert.match(viewerJs, /syncViewerCanvasChromePlacement\(canvas, w\)/, 'Canvas resize must align slider and side navigation together');
assert.match(viewerJs, /calculateViewerSideNavPlacement/, 'Side navigation must use the current reading-region boundary');
assert.match(viewerJs, /pinchAnchorX\s*=\s*\(focus\.x\s*-\s*viewX\)\s*\/\s*safeScale/, 'Pinch must capture the logical point under its midpoint');
assert.match(viewerJs, /setViewScaleAtClientPoint\(2,\s*e\.clientX,\s*e\.clientY\)/, 'Double tap must zoom around the tapped point');
assert.match(viewerJs, /setViewScaleAtClientPoint\(viewScale\s*\*\s*factor,\s*e\.clientX,\s*e\.clientY\)/, 'Ctrl-wheel zoom must retain the pointer focus');
assert.match(viewerJs, /getHtml:\s*\(\)\s*=>\s*renderSurfaceContentHTML\(surface, lang\)/, 'Minimap must lazily reuse current image/fixed-text rendering');
assert.match(viewerJs, /viewerDocumentRevision\s*\+=\s*1/, 'Loading another document must invalidate the minimap thumbnail cache');
assert.match(viewerJs, /key:\s*\[\s*viewerDocumentRevision,/, 'Minimap thumbnail keys must include the loaded document revision');
assert.match(viewerJs, /applyTransform\(fromInteraction = false\)/, 'Transform updates must distinguish user interaction');
assert.match(viewerJs, /viewerMinimap\?\.update\(\{ fromInteraction \}\)/, 'Zoom transforms must update the minimap');
assert.ok((viewerJs.match(/applyTransform\(true\)/g) || []).length >= 6, 'Zoom and pan interactions must reveal the minimap');

assert.match(css, /\.viewer-minimap\s*\{/, 'Viewer minimap CSS is missing');
assert.match(css, /html\s*\{[\s\S]*?overflow:\s*hidden/, 'The Viewer document must not drift through horizontal page scrolling');
assert.match(css, /#viewer-layout\s*\{[\s\S]*?overflow:\s*clip/, 'Off-screen drawer content must not enlarge the Viewer document');
assert.match(css, /body\.viewer-zoom-active #viewer-canvas,[\s\S]*?overflow:\s*visible/, 'Magnified pages must be allowed to use the full viewport');
assert.match(css, /#viewer-zoom-layer\s*\{[\s\S]*?position:\s*fixed/, 'Full-viewport zoom interaction layer is missing');
assert.match(
    css,
    /\.viewer-minimap-surface\s*\{[\s\S]*?box-sizing:\s*content-box/,
    'Minimap geometry must describe the drawable area inside its border'
);
assert.match(
    css,
    /\.viewer-minimap-page-content\s*\{[\s\S]*?width:\s*var\(--viewer-minimap-page-width[\s\S]*?height:\s*var\(--viewer-minimap-page-height[\s\S]*?transform:\s*scale\(var\(--viewer-minimap-page-scale/,
    'Minimap pages must keep canonical dimensions and scale as a whole'
);
assert.match(css, /\.viewer-minimap-viewport\s*\{[\s\S]*?border:\s*2px solid #3b82f6/, 'Current viewport frame must remain visible');

console.log('Viewer minimap verification passed.');
