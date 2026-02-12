/**
 * viewer.js — DSF Viewer Logic
 */
import { state } from './state.js';
import { renderBubbleHTML } from './bubbles.js';
import { getLangProps } from './lang.js';
import { db } from './firebase.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let currentProject = null;

// ──────────────────────────────────────
//  Zoom & Pan State
// ──────────────────────────────────────
let viewState = {
    scale: 1,
    panning: false,
    startX: 0,
    startY: 0,
    currX: 0,
    currY: 0,
    lastX: 0,
    lastY: 0
};

function resetZoom() {
    viewState = { scale: 1, panning: false, startX: 0, startY: 0, currX: 0, currY: 0, lastX: 0, lastY: 0 };
    updateTransform();
}

function updateTransform() {
    const stage = document.getElementById('viewer-stage');
    if (stage) {
        stage.style.transform = `translate(${viewState.currX}px, ${viewState.currY}px) scale(${viewState.scale})`;
    }
}

// ──────────────────────────────────────
//  Initialization
// ──────────────────────────────────────
function init() {
    const layer = document.getElementById('click-layer');
    if (layer) {
        layer.addEventListener('click', handleClick);
        // Touchevents are now handled by LongPress wrappers which delegate to _Fixed functions
    }
    document.addEventListener('keydown', handleKeydown);

    // Check URL Param
    const params = new URLSearchParams(window.location.search);
    const pid = params.get('id');
    if (pid) {
        loadFromFirestore(pid);
    }

    // Resize & Wheel
    window.addEventListener('resize', resizeCanvas);
    document.addEventListener('wheel', handleWheel, { passive: false });

    // UI Toggle Listeners
    // UI Toggle Listeners
    // Removed body click handler, replaced with explicit triggers

    // Mobile Double Tap
    if (layer) {
        layer.addEventListener('touchstart', handleTouchStart_Fixed, { passive: false });
        layer.addEventListener('touchmove', handleTouchMove_Fixed, { passive: false });
        layer.addEventListener('touchend', handleTouchEnd);
    }

    resizeCanvas();
}

// ──────────────────────────────────────
//  UI Visibility
// ──────────────────────────────────────
// ──────────────────────────────────────
//  UI Visibility
// ──────────────────────────────────────
let isUiVisible = false;

window.toggleUi = function () {
    isUiVisible = !isUiVisible;
    updateUiVisibility();
};

function updateUiVisibility() {
    const ui = document.getElementById('viewer-ui');
    if (ui) {
        if (isUiVisible) ui.classList.add('visible');
        else ui.classList.remove('visible');
    }
}

// ──────────────────────────────────────
//  Page Navigation (Slider)
// ──────────────────────────────────────
window.jumpToPage = function (val) {
    const page = parseInt(val, 10);
    if (page >= 1 && page <= state.sections.length) {
        state.activeIdx = page - 1;
        refresh();
    }
};

async function loadFromFirestore(pid) {
    try {
        const docRef = doc(db, "works", pid);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
            const data = snap.data();
            data.projectId = pid; // Ensure ID is set
            loadProjectData(data);
        } else {
            alert('プロジェクトが見つかりませんでした: ' + pid);
        }
    } catch (e) {
        console.error(e);
        alert('読み込みエラー: ' + e.message);
    }
}

// ──────────────────────────────────────
//  File Loading
// ──────────────────────────────────────
window.loadDsf = (input) => {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            loadProjectData(data);
        } catch (err) {
            alert('ファイルの読み込みに失敗しました: ' + err.message);
        }
    };
    reader.readAsText(file);
};

function loadProjectData(data) {
    if (!data.languageConfigs) {
        data.languageConfigs = {};
        (data.languages || ['ja']).forEach(lang => {
            data.languageConfigs[lang] = {
                writingMode: (lang === 'ja') ? 'vertical-rl' : 'horizontal-tb'
            };
        });
    }

    state.projectId = data.projectId;
    state.title = data.title || ''; // Load title
    state.sections = data.sections || [];
    state.languages = data.languages || ['ja'];
    state.languageConfigs = data.languageConfigs;
    state.activeLang = state.languages[0];
    state.activeIdx = 0;

    currentProject = data;

    // Set Title
    const titleEl = document.getElementById('ui-title');
    if (titleEl) titleEl.textContent = state.title || state.projectId || 'Untitled';

    // Populate Lang Select
    const langSelect = document.getElementById('lang-select');
    if (langSelect) {
        langSelect.innerHTML = state.languages.map(code => {
            const props = getLangProps(code);
            return `<option value="${code}">${props.label}</option>`;
        }).join('');
        langSelect.value = state.activeLang;
        langSelect.style.display = state.languages.length > 1 ? 'inline-block' : 'none';
    }

    refresh();
}

window.switchViewerLang = (code) => {
    state.activeLang = code;
    refresh();
};

// ──────────────────────────────────────
//  Rendering
// ──────────────────────────────────────
function getWritingMode(lang) {
    if (state.languageConfigs && state.languageConfigs[lang]) {
        return state.languageConfigs[lang].writingMode;
    }
    const props = getLangProps(lang);
    return props.defaultWritingMode || 'horizontal-tb';
}

function refresh() {
    if (!state.sections || state.sections.length === 0) return;

    const s = state.sections[state.activeIdx];
    const contentEl = document.getElementById('viewer-content');
    const bubblesEl = document.getElementById('viewer-bubbles');
    const lang = state.activeLang;
    const mode = getWritingMode(lang);

    // Reset Zoom on page change
    resetZoom();

    // 1. Content
    if (s.type === 'image') {
        const pos = s.imagePosition || { x: 0, y: 0, scale: 1 };
        const imgStyle = `width:100%; height:100%; object-fit:cover; transform: translate(${pos.x}px, ${pos.y}px) scale(${pos.scale}); transform-origin: center center;`;
        contentEl.innerHTML = `<img src="${s.background}" style="${imgStyle}">`;
    } else {
        let text = s.text || '';
        if (s.texts && s.texts[lang]) text = s.texts[lang];

        const vtClass = mode === 'vertical-rl' ? 'v-text' : '';
        const langProps = getLangProps(lang);
        const align = langProps.sectionAlign;

        contentEl.innerHTML = `<div class="text-layer ${vtClass}" 
            style="width:100%; height:100%; padding:20px; box-sizing:border-box; background:#fafafa; text-align:${align}; font-size:16px; line-height:1.8; white-space:pre-wrap; overflow:auto;">${text}</div>`;
    }

    // 2. Bubbles
    if (s.type !== 'text') {
        bubblesEl.innerHTML = (s.bubbles || []).map((b, i) =>
            renderBubbleHTML(b, i, false, mode)
        ).join('');
    } else {
        bubblesEl.innerHTML = '';
    }

    // 3. Update Footer Info
    const total = state.sections.length;
    const current = state.activeIdx + 1;
    const slider = document.getElementById('page-slider');
    const label = document.getElementById('page-count');

    if (slider) {
        slider.min = 1;
        slider.max = total;
        slider.value = current;
    }
    if (label) {
        label.textContent = `${current} / ${total}`;
    }
}

// ──────────────────────────────────────
//  Resize Logic
// ──────────────────────────────────────
function resizeCanvas() {
    const canvas = document.getElementById('viewer-canvas');
    if (!canvas) return;

    // Target constraints
    const targetRatio = 9 / 16;
    const maxWidth = 500;

    // Available space
    const w = window.innerWidth;
    const h = window.innerHeight;

    // Calculate best fit
    let finalW = w;
    let finalH = w / targetRatio;

    // Constrain by height
    if (finalH > h) {
        finalH = h;
        finalW = finalH * targetRatio;
    }

    // Constrain by max width (PC)
    if (finalW > maxWidth) {
        finalW = maxWidth;
        finalH = finalW / targetRatio;

        // Check height again after max-width
        if (finalH > h) {
            finalH = h;
            finalW = finalH * targetRatio;
        }
    }

    canvas.style.width = `${finalW}px`;
    canvas.style.height = `${finalH}px`;
}

// ──────────────────────────────────────
//  Navigation Helpers
// ──────────────────────────────────────
function next() {
    if (!state.sections) return;
    if (state.activeIdx < state.sections.length - 1) {
        state.activeIdx++;
        refresh();
    }
}

function prev() {
    if (!state.sections) return;
    if (state.activeIdx > 0) {
        state.activeIdx--;
        refresh();
    }
}

function getNextPageDirection() {
    const lang = state.activeLang;
    const mode = getWritingMode(lang);
    return mode === 'vertical-rl' ? 'left' : 'right';
}

// ──────────────────────────────────────
//  Event Handlers
// ──────────────────────────────────────

// Click (PC)
function handleClick(e) {
    // If zoomed, ignore navigation click
    if (viewState.scale > 1.05) return;

    const w = window.innerWidth;
    const x = e.clientX;
    const nextDir = getNextPageDirection();

    // Center click -> Next
    if (x >= w * 0.3 && x <= w * 0.7) {
        next();
        return;
    }

    if (nextDir === 'left') {
        if (x < w * 0.3) next();
        else if (x > w * 0.7) prev();
    } else {
        if (x > w * 0.7) next();
        else if (x < w * 0.3) prev();
    }
}

// Keydown (PC)
function handleKeydown(e) {
    if (e.key === 'ArrowDown') { next(); return; }
    if (e.key === 'ArrowUp') { prev(); return; }

    const nextDir = getNextPageDirection();

    if (nextDir === 'left') {
        if (e.key === 'ArrowLeft') next();
        if (e.key === 'ArrowRight') prev();
    } else {
        if (e.key === 'ArrowRight') next();
        if (e.key === 'ArrowLeft') prev();
    }
}

// Wheel (PC: Zoom & Nav)
let wheelTimer = null;
function handleWheel(e) {
    e.preventDefault();

    if (e.ctrlKey) {
        // ZOOM
        const delta = -e.deltaY;
        const speed = 0.002;
        let newScale = viewState.scale + delta * speed;
        newScale = Math.min(Math.max(1, newScale), 5); // Limit 1x to 5x
        viewState.scale = newScale;

        // If zooming out to 1, reset pan
        if (viewState.scale <= 1) {
            resetZoom();
        } else {
            updateTransform();
        }
    } else {
        // NAV (only if not zoomed)
        if (viewState.scale > 1.05) return;

        if (wheelTimer) return;
        wheelTimer = setTimeout(() => { wheelTimer = null; }, 200);

        if (e.deltaY > 0) next();
        else if (e.deltaY < 0) prev();
    }
}

// Touch (Mobile: Swipe & Pinch)
let touchStartDist = 0;
let isPinch = false;
let pinchStartScale = 1;

// For separate swipe detection variables
let touchStartX = 0;
let touchStartY = 0;

function getDist(t1, t2) {
    return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
}

function handleTouchStart_Fixed(e) {
    if (e.touches.length === 2) {
        // PINCH Start
        isPinch = true;
        touchStartDist = getDist(e.touches[0], e.touches[1]);
        pinchStartScale = viewState.scale;
    } else {
        // PAN / SWIPE Start
        isPinch = false;
        // Panning setup
        viewState.lastX = e.touches[0].clientX;
        viewState.lastY = e.touches[0].clientY;

        // Swipe detection setup
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }
}

function handleTouchMove_Fixed(e) {
    e.preventDefault();

    if (e.touches.length === 2 && isPinch) {
        // PINCH Move
        const dist = getDist(e.touches[0], e.touches[1]);
        if (touchStartDist > 0) {
            const newScale = pinchStartScale * (dist / touchStartDist);
            viewState.scale = Math.min(Math.max(1, newScale), 5);
            updateTransform();
        }
    } else if (e.touches.length === 1 && !isPinch) {
        // PAN (only if zoomed)
        if (viewState.scale > 1.05) {
            const cx = e.touches[0].clientX;
            const cy = e.touches[0].clientY;

            const dx = cx - viewState.lastX;
            const dy = cy - viewState.lastY;

            viewState.currX += dx;
            viewState.currY += dy;
            viewState.lastX = cx;
            viewState.lastY = cy;

            updateTransform();
        }
    }
}

// DOUBLE TAP State
let lastTapTime = 0;

function handleTouchEnd(e) {
    if (isPinch) {
        isPinch = false;
        // Snap back if zoomed out too far
        if (viewState.scale < 1) {
            resetZoom();
        }
        return;
    }

    // SWIPE / TAP Detection (only if NOT zoomed)
    if (viewState.scale <= 1.05) {
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;

        const diffX = touchEndX - touchStartX;
        const diffY = touchEndY - touchStartY;

        // Tap Detection (< 30px move)
        if (Math.abs(diffX) < 30 && Math.abs(diffY) < 30) {
            const currentTime = new Date().getTime();
            const tapLength = currentTime - lastTapTime;

            if (tapLength < 300 && tapLength > 0) {
                // Double Tap Detected!
                e.preventDefault(); // Prevent Click/Nav
                toggleUi();
                lastTapTime = 0; // Reset
            } else {
                lastTapTime = currentTime;
                // Allow click to pass through (it will trigger navigation via handleClick)
            }
            return;
        }

        if (Math.abs(diffY) > Math.abs(diffX)) {
            // Vertical
            if (diffY < 0) next();
            else prev();
        } else {
            // Horizontal
            const nextDir = getNextPageDirection();
            if (nextDir === 'left') {
                if (diffX > 0) next();
                else prev();
            } else {
                if (diffX < 0) next();
                else prev();
            }
        }
    }
}

// Start
init();
