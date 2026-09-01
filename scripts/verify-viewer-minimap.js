import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    calculateViewerMinimapGeometry,
    calculateViewerMinimapPagePreviewGeometry,
    calculateViewerPanFromMinimapPoint,
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

const [html, viewerJs, css] = await Promise.all([
    readFile(new URL('../viewer.html', import.meta.url), 'utf8'),
    readFile(new URL('../js/viewer.js', import.meta.url), 'utf8'),
    readFile(new URL('../css/viewer.css', import.meta.url), 'utf8')
]);

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

assert.match(viewerJs, /createViewerMinimapController/, 'Viewer must initialize the minimap controller');
assert.match(viewerJs, /clampViewerPanAxis/, 'Viewer zoom pan must be clamped against the visual viewport');
assert.match(viewerJs, /initializeViewerMinimap\(\)/, 'Viewer init must bind the minimap');
assert.match(viewerJs, /\['click-layer', 'viewer-zoom-layer'\]/, 'Zoomed pages must retain full-viewport pointer handling');
assert.match(viewerJs, /window\.visualViewport/, 'Viewer centering must use the visual viewport when available');
assert.match(viewerJs, /document\.body\.classList\.toggle\('viewer-zoom-active', active\)/, 'Viewer must switch to full-viewport zoom mode');
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
