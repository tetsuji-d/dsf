/**
 * press.js — Press Room ロジック
 * DSP → DSF レンダリング・R2アップロード・Firestore発行
 */
import {
    doc, setDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { state, dispatch, actionTypes } from './state.js';
import { extractSectionsFromBlocks } from './blocks.js';
import { db, uploadPressPage, triggerAutoSave, auth } from './firebase.js';
import { loadImageForCanvas } from './asset-fetch.js';
import { renderPositionedThumbImageHtml } from './sections.js';
import { t } from './i18n-studio.js';
import {
    CANONICAL_PAGE_WIDTH,
    CANONICAL_PAGE_HEIGHT,
    getPressResolutionDims,
    resolvePressResolutionKey,
    clampPressPublishResolutionKey
} from './page-geometry.js';
import {
    getWritingModeFromConfigs
} from './layout.js';
import { verticalGlyphText, composeTextPreviewModel } from './text-press-html.js';
import { encodeCanvasToWebP } from './canvas-encoding.js';
import { getLangProps } from './lang.js';

let _estimateTimer = null;
let _estimateRunId = 0;
let _pressListenersBound = false;
let _pressThumbLang = '';
const PRESS_IMAGE_WEBP_QUALITY_BY_SCALE = Object.freeze({
    1: 0.84,
    2: 0.86,
    3: 0.90,
    4: 0.92,
    6: 0.94
});
const PRESS_TEXT_WEBP_QUALITY = 0.90;

const PRESS_TRIAL_TEXT_BINARY_KEY = 'pressTrialTextBinary';

/** Horizon 発行 / DSF 書き出しの長時間レンダリングをユーザーが中断するための共有フラグ */
let _pressRenderCancelled = false;

export function resetPressRenderCancel() {
    _pressRenderCancelled = false;
}

export function requestPressRenderCancel() {
    _pressRenderCancelled = true;
}

export function throwIfPressRenderCancelled() {
    if (_pressRenderCancelled) {
        const e = new Error('PRESS_RENDER_CANCELLED');
        e.code = 'PRESS_RENDER_CANCELLED';
        throw e;
    }
}

/** Press Room: テキスト二値化＋高 q WebP の試行ルート（DSF 書き出し／クラウド発行の両方） */
function _isPressTextBinarizeTrialEnabled() {
    return document.getElementById('press-trial-text-binary')?.checked === true;
}

function _parseCssColorToRgb(str) {
    const s = String(str || '').trim() || '#ffffff';
    if (s.startsWith('#')) {
        const hex = s.slice(1);
        if (hex.length === 3) {
            return {
                r: parseInt(hex[0] + hex[0], 16),
                g: parseInt(hex[1] + hex[1], 16),
                b: parseInt(hex[2] + hex[2], 16)
            };
        }
        if (hex.length === 6) {
            return {
                r: parseInt(hex.slice(0, 2), 16),
                g: parseInt(hex.slice(2, 4), 16),
                b: parseInt(hex.slice(4, 6), 16)
            };
        }
    }
    const c = document.createElement('canvas').getContext('2d');
    if (!c) return { r: 255, g: 255, b: 255 };
    c.fillStyle = '#ffffff';
    c.fillStyle = s;
    const out = c.fillStyle;
    if (typeof out === 'string' && out.startsWith('#') && out.length >= 7) {
        const h = out.slice(1);
        return {
            r: parseInt(h.slice(0, 2), 16),
            g: parseInt(h.slice(2, 4), 16),
            b: parseInt(h.slice(4, 6), 16)
        };
    }
    const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(String(out));
    if (m) return { r: +m[1], g: +m[2], b: +m[3] };
    return { r: 255, g: 255, b: 255 };
}

function _colorDistSq(a, b) {
    const dr = a.r - b.r;
    const dg = a.g - b.g;
    const db = a.b - b.b;
    return dr * dr + dg * dg + db * db;
}

/**
 * アンチエイリアスを捨て、紙色・文字色のどちらか近い方へ量子化する（試行用）。
 */
function _binarizeTextCanvasForTrial(canvas, section) {
    const bg = _parseCssColorToRgb(section?.backgroundColor || '#ffffff');
    const fg = _parseCssColorToRgb(section?.textColor || '#000000');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = canvas;
    const img = ctx.getImageData(0, 0, width, height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
        const px = { r: d[i], g: d[i + 1], b: d[i + 2] };
        const a = d[i + 3];
        if (a < 16) {
            d[i] = bg.r;
            d[i + 1] = bg.g;
            d[i + 2] = bg.b;
            d[i + 3] = 255;
            continue;
        }
        const toBg = _colorDistSq(px, bg);
        const toFg = _colorDistSq(px, fg);
        if (toBg <= toFg) {
            d[i] = bg.r;
            d[i + 1] = bg.g;
            d[i + 2] = bg.b;
        } else {
            d[i] = fg.r;
            d[i + 1] = fg.g;
            d[i + 2] = fg.b;
        }
        d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
}

function _encodeTextSectionWebP(canvas, section, kindLabel) {
    if (_isPressTextBinarizeTrialEnabled()) {
        _binarizeTextCanvasForTrial(canvas, section);
        // iOS 等 WASM ロッシー q=100 は二値画に不向きで肥大化しやすい → libwebp ロスレス
        return encodeCanvasToWebP(canvas, 1, `${kindLabel}（試行・二値）`, { lossless: true });
    }
    return encodeCanvasToWebP(canvas, PRESS_TEXT_WEBP_QUALITY, kindLabel);
}

function _bindPressPublishCancelOnce() {
    const btn = document.getElementById('press-publish-cancel-btn');
    if (!btn || btn.dataset.pressCancelBound === '1') return;
    btn.dataset.pressCancelBound = '1';
    btn.addEventListener('click', () => requestPressRenderCancel());
}

function _bindPressTrialTextBinaryOnce() {
    const el = document.getElementById('press-trial-text-binary');
    if (!el || el.dataset.pressBound === '1') return;
    el.dataset.pressBound = '1';
    try {
        if (sessionStorage.getItem(PRESS_TRIAL_TEXT_BINARY_KEY) === '1') el.checked = true;
    } catch (_) { /* sessionStorage 不可環境 */ }
    el.addEventListener('change', () => {
        try {
            sessionStorage.setItem(PRESS_TRIAL_TEXT_BINARY_KEY, el.checked ? '1' : '0');
        } catch (_) { /* noop */ }
        _queueSizeEstimate();
    });
}

// ─── Press Room 入室 ─────────────────────────────────────────────────────────

/** Press Room に入ったときにページサムネイルと言語タブを描画する */
export function enterPressRoom() {
    _ensureBookSettings();
    _ensurePressThumbLang();
    _renderThumbLangTabs();
    _renderPageThumbs();
    _renderLangTabs();
    _renderBookSettings();
    _updatePublishBtn();
    _bindPressTrialTextBinaryOnce();
    _bindPressPublishCancelOnce();
    _queueSizeEstimate();
    if (!_pressListenersBound) {
        _pressListenersBound = true;
        document.getElementById('press-resolution')?.addEventListener('change', _queueSizeEstimate);
    }
}

function _ensurePressThumbLang() {
    const langs = state.languages || ['ja'];
    if (!langs.includes(_pressThumbLang)) {
        _pressThumbLang = state.activeLang && langs.includes(state.activeLang)
            ? state.activeLang
            : langs[0];
    }
}

function _getPressThumbLang() {
    _ensurePressThumbLang();
    return _pressThumbLang || state.defaultLang || 'ja';
}

function _getLangDirection(code) {
    const props = getLangProps(code);
    const fallback = props.directions?.[0]?.value || 'ltr';
    return state.languageConfigs?.[code]?.pageDirection || fallback;
}

function _getLangDirectionArrow(code) {
    return _getLangDirection(code) === 'rtl' ? '&lt;&lt;' : '&gt;&gt;';
}

function _getLangBadgeModifier(code) {
    const normalized = String(code || '').trim().toLowerCase();
    if (normalized === 'ja') return 'ja';
    if (normalized === 'en' || normalized === 'en-us') return 'en-us';
    if (normalized === 'en-gb') return 'en-gb';
    if (normalized === 'zh-cn') return 'zh-cn';
    if (normalized === 'zh-tw') return 'zh-tw';
    return 'generic';
}

function _renderPressLangTabContent(code) {
    const props = getLangProps(code);
    const modifier = _getLangBadgeModifier(code);
    const codeLabel = String(code || '').toUpperCase();
    return `
        <span class="lang-tab-badge home-lang-${modifier}" title="${_esc(codeLabel)}">${modifier === 'generic' ? _esc(codeLabel) : ''}</span>
        <span class="lang-tab-label">${_esc(props.label)}</span>
        <span class="lang-tab-code">${_esc(codeLabel)}</span>
        <span class="lang-tab-dir">${_getLangDirectionArrow(code)}</span>
    `;
}

function _renderThumbLangTabs() {
    const container = document.getElementById('press-thumb-lang-tabs');
    if (!container) return;
    const langs = state.languages || ['ja'];
    const current = _getPressThumbLang();
    container.classList.toggle('press-thumb-lang-tabs--rtl', _getLangDirection(current) === 'rtl');
    container.innerHTML = langs.map(code =>
        `<button class="lang-tab press-thumb-lang-tab ${code === current ? 'active' : ''}"
            data-lang="${code}"
            onclick="switchPressThumbLang('${code}')"
            title="${_esc(`${getLangProps(code).label} ${String(code).toUpperCase()} ${_getLangDirection(code) === 'rtl' ? '<<' : '>>'}`)}">${_renderPressLangTabContent(code)}</button>`
    ).join('');
}

function _renderPageThumbs() {
    const container = document.getElementById('press-page-thumbs');
    if (!container) return;

    const pages = _getRenderablePages();
    if (!pages.length) {
        container.innerHTML = '<p class="press-empty">ページがありません</p>';
        return;
    }
    const lang = _getPressThumbLang();
    container.classList.toggle('press-page-thumbs--rtl', _getLangDirection(lang) === 'rtl');

    container.innerHTML = pages.map((section, i) => {
        const label = String(i + 1);
        const roles = _getCoverRolesForPage(i);
        const badges = roles.length
            ? `<div class="press-thumb-cover-badges">${roles.map(role => `<span>${role.toUpperCase()}</span>`).join('')}</div>`
            : '';
        if (section.type === 'text') {
            const raw = section.texts?.[lang] || section.text || '';
            const snippet = _makeTextThumbSnippet(raw);
            const bg = section.backgroundColor || '#ffffff';
            const ink = section.textColor || '#000000';
            const writingMode = getWritingModeFromConfigs(lang, state.languageConfigs || {});
            const verticalClass = writingMode === 'vertical-rl' ? ' is-vertical' : '';
            return `<div class="press-thumb-item press-thumb-item--text">
                <div class="press-thumb-media">
                    <div class="press-thumb-text-preview${verticalClass}" style="background:${_esc(bg)};color:${_esc(ink)}">${_esc(snippet) || '&nbsp;'}</div>
                    ${badges}
                </div>
                <div class="press-thumb-label">${label}</div>
            </div>`;
        }
        const thumbImg = renderPositionedThumbImageHtml(section, lang, label);
        return `<div class="press-thumb-item">
            <div class="press-thumb-media">
                ${thumbImg
                    ? `<div class="press-thumb-canvas">${thumbImg}</div>`
                    : `<div class="press-thumb-empty"><span class="material-icons">image</span></div>`}
                ${badges}
            </div>
            <div class="press-thumb-label">${label}</div>
        </div>`;
    }).join('');
}

function _makeTextThumbSnippet(raw) {
    const plain = String(raw || '')
        .replace(/\{([^|{}]+)\|([^|{}]*)\}/g, '$1')
        .replace(/^===$/gm, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return Array.from(plain).slice(0, 42).join('');
}

function _renderLangTabs() {
    const container = document.getElementById('press-lang-tabs');
    if (!container) return;
    const langs = state.languages || ['ja'];
    container.innerHTML = langs.map(code =>
        `<button class="lang-tab press-lang-tab active"
            data-lang="${code}"
            onclick="togglePressLang('${code}')"
            title="${_esc(`${getLangProps(code).label} ${String(code).toUpperCase()} ${_getLangDirection(code) === 'rtl' ? '<<' : '>>'}`)}">${_renderPressLangTabContent(code)}</button>`
    ).join('');
}

function _readBookSettings(pageCount = _getRenderablePages().length) {
    const raw = state.book || {};
    const mode = raw.mode === 'full' || state.bookMode === 'full' ? 'full' : 'simple';
    return _normalizeBookSettings({ mode }, pageCount);
}

function _writeBookSettings(next, shouldAutosave = true) {
    const pageCount = _getRenderablePages().length;
    const normalized = _normalizeBookSettings(next, pageCount);
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'bookMode', value: normalized.mode } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'book', value: normalized } });
    if (shouldAutosave) triggerAutoSave();
}

function _normalizeBookSettings(next, pageCount = _getRenderablePages().length) {
    const sourceMode = next?.mode || state.book?.mode || state.bookMode || 'simple';
    const mode = sourceMode === 'full' && pageCount >= 4 ? 'full' : 'simple';
    const last = Math.max(0, pageCount - 1);
    const normalized = {
        mode,
        covers: {
            c1: { pageIndex: 0 },
            c4: { pageIndex: last }
        }
    };
    if (mode === 'full') {
        normalized.covers.c2 = { pageIndex: 1 };
        normalized.covers.c3 = { pageIndex: pageCount - 2 };
    }
    return normalized;
}

function _ensureBookSettings() {
    const pageCount = _getRenderablePages().length;
    if (!pageCount) return;
    const current = _readBookSettings(pageCount);
    const normalized = _normalizeBookSettings(current, pageCount);
    const currentJson = JSON.stringify(state.book || {});
    const nextJson = JSON.stringify(normalized);
    if (state.bookMode !== normalized.mode || currentJson !== nextJson) {
        _writeBookSettings(normalized, false);
    }
}

function _renderBookSettings() {
    const container = document.getElementById('press-book-settings');
    if (!container) return;
    const pages = _getRenderablePages();
    if (!pages.length) {
        container.innerHTML = `<p class="press-book-empty">${_esc(t('press_book_no_pages'))}</p>`;
        return;
    }

    const settings = _readBookSettings(pages.length);
    const mode = settings.mode;
    const coverRow = (key, labelKey) => {
        const pageIndex = settings.covers[key]?.pageIndex;
        if (pageIndex === undefined) return '';
        return `<div class="press-book-cover-fixed">
            <span>${_esc(t(labelKey))}</span>
            <strong>${_esc(t('press_cover_page', { page: pageIndex + 1 }))}</strong>
        </div>`;
    };

    container.innerHTML = `
        <div class="press-book-mode-row">
            <span>${_esc(t('press_book_layout'))}</span>
            <select id="press-book-mode">
                <option value="simple" ${mode === 'simple' ? 'selected' : ''}>${_esc(t('press_book_simple'))}</option>
                <option value="full" ${mode === 'full' ? 'selected' : ''} ${pages.length < 4 ? 'disabled' : ''}>
                    ${_esc(pages.length < 4 ? t('press_book_full_disabled') : t('press_book_full'))}
                </option>
            </select>
        </div>
        <div class="press-book-fixed-hint">${_esc(t('press_book_fixed_hint'))}</div>
        <div class="press-book-covers-fixed">
            ${coverRow('c1', 'press_cover_c1')}
            ${coverRow('c2', 'press_cover_c2')}
            ${coverRow('c3', 'press_cover_c3')}
            ${coverRow('c4', 'press_cover_c4')}
        </div>
    `;

    const modeEl = container.querySelector('#press-book-mode');
    if (modeEl) modeEl.addEventListener('change', () => window.updatePressBookMode(modeEl.value));
}

function _getCoverRolesForPage(pageIndex) {
    const settings = _readBookSettings();
    const roles = [];
    for (const key of ['c1', 'c2', 'c3', 'c4']) {
        if (settings.covers[key]?.pageIndex === pageIndex && (key === 'c1' || key === 'c4' || settings.mode === 'full')) {
            roles.push(key);
        }
    }
    return roles;
}

function _queueSizeEstimate() {
    clearTimeout(_estimateTimer);
    _estimateTimer = setTimeout(() => { _updateSizeEstimate(); }, 120);
}

function _getSelectedPressLangs() {
    const selectedLangs = Array.from(
        document.querySelectorAll('.press-lang-tab.active')
    ).map(el => el.dataset.lang).filter(Boolean);
    return selectedLangs.length ? selectedLangs : (state.languages || ['ja']);
}

async function _updateSizeEstimate() {
    const el = document.getElementById('press-size-estimate');
    if (!el) return;

    const runId = ++_estimateRunId;
    el.textContent = t('press_estimating_size');

    const resKey = resolvePressResolutionKey(document.getElementById('press-resolution')?.value);
    const { width: w, height: h } = getPressResolutionDims(resKey);
    const pages = _getRenderablePages();
    const langs = _getSelectedPressLangs();

    const tasks = [];
    for (const section of pages) {
        for (const lang of langs) {
            if (section.type === 'text') {
                const raw = section.texts?.[lang];
                if (!raw || !String(raw).trim()) continue;
                tasks.push({ kind: 'text', section, lang });
            } else {
                const bgUrl = section.backgrounds?.[lang] || section.background;
                if (!bgUrl) continue;
                tasks.push({
                    kind: 'image',
                    section,
                    lang,
                    bgUrl,
                    pos: section.imagePositions?.[lang] || section.imagePosition,
                });
            }
        }
    }

    if (!tasks.length) {
        el.textContent = '≈ 0.0 MB';
        return;
    }

    const sampleCount = Math.min(4, tasks.length);
    const sampleTasks = [];
    if (tasks.length <= sampleCount) {
        sampleTasks.push(...tasks);
    } else {
        for (let i = 0; i < sampleCount; i++) {
            const index = Math.round((tasks.length - 1) * (i / (sampleCount - 1)));
            sampleTasks.push(tasks[index]);
        }
    }

    try {
        let totalSampleBytes = 0;
        for (const task of sampleTasks) {
            const quality = _getPressQualityForTask(task, w, h);
            const blob = task.kind === 'text'
                ? await _renderTextSectionToWebP(task.section, task.lang, w, h, quality)
                : await _renderPageToWebP(task.bgUrl, task.pos, w, h, quality);
            totalSampleBytes += blob.size;
            if (runId !== _estimateRunId) return;
        }
        const avgBytes = totalSampleBytes / sampleTasks.length;
        const estimatedBytes = avgBytes * tasks.length;
        if (runId !== _estimateRunId) return;
        el.textContent = `≈ ${(estimatedBytes / (1024 * 1024)).toFixed(1)} MB`;
    } catch (err) {
        console.warn('[Press] size estimate failed:', err);
        if (runId !== _estimateRunId) return;
        el.textContent = '—';
    }
}

function _updatePublishBtn() {
    const btn = document.getElementById('press-publish-cloud-btn');
    if (!btn) return;
    btn.disabled = !state.uid;
    btn.title = state.uid ? '' : 'ログインが必要です';
}

/** Press Room の言語タブをトグル（複数選択可） */
window.togglePressLang = (code) => {
    const tab = document.querySelector(`.press-lang-tab[data-lang="${code}"]`);
    if (tab) tab.classList.toggle('active');
    _queueSizeEstimate();
};

window.switchPressThumbLang = (code) => {
    const langs = state.languages || ['ja'];
    if (!langs.includes(code)) return;
    _pressThumbLang = code;
    _renderThumbLangTabs();
    _renderPageThumbs();
};

window.updatePressBookMode = (mode) => {
    const nextMode = mode === 'full' ? 'full' : 'simple';
    _writeBookSettings({ mode: nextMode });
    _renderBookSettings();
    _renderPageThumbs();
};

window.updatePressBookCover = (key, value) => {
    void key;
    void value;
    _writeBookSettings(_readBookSettings());
    _renderBookSettings();
    _renderPageThumbs();
};

// ─── レンダリング & 発行 ─────────────────────────────────────────────────────

/** Press Room の「Horizonに発行」ボタンから呼ばれる */
window.publishToCloud = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
        alert('ログインしてください');
        return;
    }
    if (state.uid && state.uid !== uid) {
        console.warn('[Press] state.uid does not match auth; syncing from Firebase');
        state.uid = uid;
    }
    if (!state.projectId) {
        alert('プロジェクトをクラウドに保存してから発行してください');
        return;
    }

    const pages = _getRenderablePages();
    if (!pages.length) {
        alert('レンダリングするページがありません');
        return;
    }

    // 設定取得
    const rawResKey = resolvePressResolutionKey(document.getElementById('press-resolution')?.value);
    const publishResKey = clampPressPublishResolutionKey(rawResKey);
    if (publishResKey !== rawResKey) {
        console.info('[Press] Publish resolution clamped to minimum publish size:', publishResKey, '(UI was', rawResKey + ')');
    }
    const { width: targetW, height: targetH } = getPressResolutionDims(publishResKey);
    const resStr = publishResKey;

    // 選択言語取得（アクティブなタブ）
    const selectedLangs = Array.from(
        document.querySelectorAll('.press-lang-tab.active')
    ).map(el => el.dataset.lang).filter(Boolean);
    const langs = selectedLangs.length ? selectedLangs : (state.languages || ['ja']);

    let totalOps = 0;
    for (const section of pages) {
        for (const lang of langs) {
            if (section.type === 'text') {
                if ((section.texts?.[lang] || '').trim()) totalOps += 1;
            } else if (section.backgrounds?.[lang] || section.background) {
                totalOps += 1;
            }
        }
    }
    if (!totalOps) {
        alert('選択した言語にレンダリングできるコンテンツがありません（画像または本文を確認してください）');
        return;
    }

    const openPressPublishModal = () => {
        const el = document.getElementById('press-publish-modal');
        if (el) {
            el.style.display = 'flex';
            el.setAttribute('aria-hidden', 'false');
        }
        const bar = document.getElementById('press-publish-modal-bar');
        if (bar) {
            bar.max = 100;
            bar.value = 0;
        }
        requestAnimationFrame(() => {
            document.getElementById('press-publish-cancel-btn')?.focus();
        });
    };

    const closePressPublishModal = () => {
        const el = document.getElementById('press-publish-modal');
        if (el) {
            el.style.display = 'none';
            el.setAttribute('aria-hidden', 'true');
        }
        const bar = document.getElementById('press-publish-modal-bar');
        if (bar) {
            bar.max = 100;
            bar.value = 0;
        }
    };

    /** @param {string} msg @param {number | null} fraction 0..1、null は不定（準備中） */
    const setModalProgress = (msg, fraction) => {
        const statusEl = document.getElementById('press-publish-modal-status');
        const bar = document.getElementById('press-publish-modal-bar');
        if (statusEl) statusEl.textContent = msg;
        if (!bar) return;
        if (fraction == null) {
            bar.removeAttribute('value');
        } else {
            bar.max = 100;
            bar.value = Math.round(Math.min(100, Math.max(0, fraction * 100)));
        }
    };

    resetPressRenderCancel();
    const onEscKey = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            requestPressRenderCancel();
        }
    };
    window.addEventListener('keydown', onEscKey, true);

    openPressPublishModal();
    setModalProgress(t('press_preparing'), null);

    try {
        const dsfPages = [];
        let pageNum = 0;
        let totalBytes = 0;
        let done = 0;
        const renderStamp = Date.now();

        try {
            await auth.currentUser.getIdToken(true);
        } catch (_) {
            /* トークン更新に失敗しても getIdToken(false) で再試行される */
        }

        for (const section of pages) {
            throwIfPressRenderCancelled();
            pageNum++;
            const langUrls = {};
            const langBytes = {};
            let pageTotalBytes = 0;

            for (const lang of langs) {
                throwIfPressRenderCancelled();
                let blob;
                if (section.type === 'text') {
                    const raw = section.texts?.[lang];
                    if (!raw || !String(raw).trim()) continue;
                    done++;
                    setModalProgress(
                        t('press_rendering_progress', { done, total: totalOps }),
                        done / totalOps
                    );
                    blob = await _renderTextSectionToWebP(section, lang, targetW, targetH, _getPressQualityForSection(section, targetW, targetH));
                } else {
                    const bgUrl = section.backgrounds?.[lang] || section.background;
                    if (!bgUrl) continue;
                    done++;
                    setModalProgress(
                        t('press_rendering_progress', { done, total: totalOps }),
                        done / totalOps
                    );
                    blob = await _renderPageToWebP(
                        bgUrl, section.imagePositions?.[lang] || section.imagePosition, targetW, targetH, _getPressQualityForSection(section, targetW, targetH)
                    );
                }
                throwIfPressRenderCancelled();
                totalBytes += blob.size;
                pageTotalBytes += blob.size;

                const path = `users/${uid}/dsf/${state.projectId}/${renderStamp}/${lang}/page_${String(pageNum).padStart(3, '0')}.webp`;
                langUrls[lang] = await uploadPressPage(blob, path);
                langBytes[lang] = blob.size;
            }

            dsfPages.push({
                pageNum,
                pageType: section.type === 'text' ? 'normal_text' : 'normal_image',
                urls: langUrls,
                bytesByLang: langBytes,
                totalBytes: pageTotalBytes,
            });
        }

        throwIfPressRenderCancelled();
        setModalProgress(t('press_saving_firestore'), 1);

        // Firestoreに DSF メタデータを保存
        const qualityProfile = getPressQualityProfile(resStr);
        await setDoc(
            doc(db, 'users', uid, 'projects', state.projectId),
            {
                dsfPages,
                ...getPressBookConfigForExport(dsfPages.length),
                labelName:      state.labelName || '',
                rating:         state.rating || 'all',
                license:        state.license || 'all-rights-reserved',
                meta:           state.meta || {},
                dsfStatus:      'draft',
                dsfPublishedAt: serverTimestamp(),
                dsfRenderStamp: renderStamp,
                dsfResolution:  resStr,
                dsfQuality:     Math.round(qualityProfile.image * 100),
                dsfQualityMode: 'auto-resolution',
                dsfQualityProfile: {
                    image: Math.round(qualityProfile.image * 100),
                    text: Math.round(PRESS_TEXT_WEBP_QUALITY * 100),
                },
                dsfLangs:       langs,
                dsfTotalBytes:  totalBytes,
                visibility:     'private',
            },
            { merge: true }
        );

        // Press は新しい DSF を draft として作り直す。
        // 公開インデックスは Works が管理するため、再発行時は stale な公開行を外す。
        await deleteDoc(doc(db, 'public_projects', state.projectId))
            .catch((e) => console.warn('[Press] Failed to clear public_projects on draft publish:', e?.message || e));

        console.log(`[Press] Published ${dsfPages.length} pages → draft`);
        closePressPublishModal();

        // Works Room へ遷移
        window.switchRoom('works');

    } catch (e) {
        if (e?.code === 'PRESS_RENDER_CANCELLED') {
            console.info('[Press] publishToCloud cancelled by user');
            alert(t('press_render_cancelled'));
        } else {
            console.error('[Press] publishToCloud error:', e);
            alert('発行中にエラーが発生しました:\n' + (e?.message || String(e)));
        }
        closePressPublishModal();
    } finally {
        window.removeEventListener('keydown', onEscKey, true);
        resetPressRenderCancel();
    }
};

// ─── レンダリング処理 ────────────────────────────────────────────────────────

async function _renderPageToWebP(bgUrl, pos, targetW, targetH, quality) {
    // Pages Functions 経由で画像を同一オリジン取得し、Canvas CORS taint を回避する
    const { img, revoke } = await loadImageForCanvas(bgUrl, 'Press Room 元画像');

    const canvas = document.createElement('canvas');
    canvas.width  = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);

    // 基準フレームは正規論理ページ（page-geometry）。ターゲット解像度に合わせてスケール
    const baseW = CANONICAL_PAGE_WIDTH;
    const ratio = targetW / baseW;

    const safePos = {
        x:        Number.isFinite(Number(pos?.x))        ? Number(pos.x)        : 0,
        y:        Number.isFinite(Number(pos?.y))        ? Number(pos.y)        : 0,
        scale:    Math.max(0.1, Number.isFinite(Number(pos?.scale))    ? Number(pos.scale)    : 1),
        rotation: Number.isFinite(Number(pos?.rotation)) ? Number(pos.rotation) : 0,
        flipX:    !!pos?.flipX,
    };

    ctx.save();
    ctx.translate(targetW / 2, targetH / 2);
    ctx.translate(safePos.x * ratio, safePos.y * ratio);
    ctx.rotate((safePos.rotation * Math.PI) / 180);
    ctx.scale(safePos.flipX ? -safePos.scale : safePos.scale, safePos.scale);

    // object-fit: cover と同じ挙動
    const imgAspect   = img.width  / img.height;
    const frameAspect = targetW    / targetH;
    let drawW, drawH;
    if (imgAspect > frameAspect) {
        drawH = targetH;
        drawW = targetH * imgAspect;
    } else {
        drawW = targetW;
        drawH = targetW / imgAspect;
    }

    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
    revoke();

    return encodeCanvasToWebP(canvas, quality, '画像ページ');
}

// ─── ヘルパー ────────────────────────────────────────────────────────────────

function _getRenderablePages() {
    const authoringSections = Array.isArray(state.blocks) && state.blocks.some(b => b?.kind === 'page')
        ? extractSectionsFromBlocks(state.blocks)
        : (state.sections || []);
    return authoringSections.filter(s => s && (s.type === 'image' || s.type === 'text'));
}

function _getImagePressQuality(targetW, targetH) {
    const scale = Math.max(1, Math.round(Math.min(targetW / CANONICAL_PAGE_WIDTH, targetH / CANONICAL_PAGE_HEIGHT)));
    return PRESS_IMAGE_WEBP_QUALITY_BY_SCALE[scale] || 0.94;
}

function _getPressQualityForSection(section, targetW, targetH) {
    return section?.type === 'text' ? PRESS_TEXT_WEBP_QUALITY : _getImagePressQuality(targetW, targetH);
}

function _getPressQualityForTask(task, targetW, targetH) {
    return task?.kind === 'text' ? PRESS_TEXT_WEBP_QUALITY : _getImagePressQuality(targetW, targetH);
}

export function getRenderablePressPages() {
    return _getRenderablePages();
}

export function getSelectedPressLangs() {
    return _getSelectedPressLangs();
}

export function getPressQualityProfile(resolutionKey = '') {
    const { width, height } = getPressResolutionDims(resolutionKey || resolvePressResolutionKey(document.getElementById('press-resolution')?.value || '1080x1920'));
    const textQ = _isPressTextBinarizeTrialEnabled() ? 1 : PRESS_TEXT_WEBP_QUALITY;
    return {
        image: _getImagePressQuality(width, height),
        text: textQ
    };
}

export function getPressBookConfigForExport(pageCount = _getRenderablePages().length) {
    const book = _normalizeBookSettings(_readBookSettings(pageCount), pageCount);
    return {
        bookMode: book.mode,
        book: {
            mode: book.mode,
            covers: book.covers
        }
    };
}

export async function renderPressSectionToWebP(section, lang, targetW, targetH) {
    if (section?.type === 'text') {
        const raw = section.texts?.[lang];
        if (!raw || !String(raw).trim()) return null;
        return _renderTextSectionToWebP(section, lang, targetW, targetH, _getPressQualityForSection(section, targetW, targetH));
    }
    const bgUrl = section?.backgrounds?.[lang] || section?.background;
    if (!bgUrl) return null;
    return _renderPageToWebP(
        bgUrl,
        section.imagePositions?.[lang] || section.imagePosition,
        targetW,
        targetH,
        _getPressQualityForSection(section, targetW, targetH)
    );
}

function _prepareTextComposition(section, lang) {
    return composeTextPreviewModel(section, lang, state.languageConfigs || {});
}

const SMALL_KANA_VERTICAL_OFFSET = Object.freeze({
    x: 0.12,
    y: -0.08
});
const SMALL_KANA_SET = new Set(Array.from(
    'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿ'
));

function _drawVerticalPlainText(ctx, text, x, startSlot, metrics) {
    const chars = Array.from(String(text || ''));
    let slot = startSlot;
    for (let i = 0; i < chars.length;) {
        const y = metrics.frameY + (slot + (metrics.slotOffset || 0)) * metrics.charPitch + metrics.charPitch / 2;
        const glyph = verticalGlyphText(chars[i]);
        ctx.font = `${metrics.fontPx}px ${metrics.family}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const isSmallKana = SMALL_KANA_SET.has(chars[i]);
        const gx = x + (isSmallKana ? metrics.fontPx * SMALL_KANA_VERTICAL_OFFSET.x : 0);
        const gy = y + (isSmallKana ? metrics.fontPx * SMALL_KANA_VERTICAL_OFFSET.y : 0);
        ctx.fillText(glyph, gx, gy);
        slot += 1;
        i += 1;
    }
    return slot - startSlot;
}

function _drawVerticalRubyText(ctx, tokenLine, x, metrics) {
    let slot = 0;
    for (const tok of tokenLine || []) {
        const base = tok.kind === 'ruby' ? (tok.base || '') : (tok.text || '');
        const startSlot = slot;
        const used = _drawVerticalPlainText(ctx, base, x, slot, metrics);
        if (tok.kind === 'ruby' && tok.ruby) {
            const rubyChars = Array.from(verticalGlyphText(tok.ruby));
            const rubyX = x + metrics.fontPx * 0.68;
            const rubyBlockH = rubyChars.length * metrics.rubyPitch;
            const baseBlockH = Math.max(used, 1) * metrics.charPitch;
            const rubyTop = metrics.frameY + (startSlot + (metrics.slotOffset || 0)) * metrics.charPitch + Math.max(0, (baseBlockH - rubyBlockH) / 2);
            ctx.font = `${metrics.rubyFontPx}px ${metrics.family}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            rubyChars.forEach((ch, idx) => {
                ctx.fillText(ch, rubyX, rubyTop + idx * metrics.rubyPitch + metrics.rubyPitch / 2);
            });
        }
        slot += used;
    }
}

function _getTextSectionAlign(section) {
    const value = section?.textAlign || 'start';
    return value === 'center' || value === 'end' ? value : 'start';
}

function _getVerticalBlockOffsetPx(frameW, usedCols, colW, align) {
    const groupW = Math.min(frameW, usedCols * colW);
    if (align === 'center') return Math.max(0, (frameW - groupW) / 2);
    if (align === 'end') return 0;
    return Math.max(0, frameW - groupW);
}

function _getHorizontalBlockOffsetPx(frameW, blockW, align) {
    if (align === 'center') return Math.max(0, (frameW - blockW) / 2);
    if (align === 'end') return Math.max(0, frameW - blockW);
    return 0;
}

async function _renderVerticalTextSectionToWebP(section, lang, targetW, targetH, _quality) {
    const { raw, composed, rubyLines } = _prepareTextComposition(section, lang);
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D が利用できません');

    const sx = targetW / CANONICAL_PAGE_WIDTH;
    const sy = targetH / CANONICAL_PAGE_HEIGHT;
    const s = Math.min(sx, sy);
    ctx.fillStyle = section.backgroundColor || '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
    if (!raw) {
        return _encodeTextSectionWebP(canvas, section, '空テキストページ');
    }

    await document.fonts.ready;

    const { x, y, w, h } = composed.frame;
    const maxCols = composed.rules?.maxLines || 12;
    const charsPerCol = composed.rules?.charsPerLine || 33;
    const colW = Math.floor(w / maxCols) * sx;
    const fontPx = composed.font.size * s;
    const frameX = x * sx;
    const frameY = y * sy;
    const frameW = w * sx;
    const charPitch = (h * sy) / charsPerCol;
    const family = composed.font.family;

    ctx.fillStyle = section.textColor || '#000000';
    ctx.imageSmoothingEnabled = true;
    const textAlign = _getTextSectionAlign(section);

    const metrics = {
        frameY,
        colW,
        charPitch,
        fontPx,
        rubyFontPx: Math.max(7, Math.round(fontPx * 0.5)),
        rubyPitch: Math.max(8, Math.round(fontPx * 0.6)),
        family
    };

    composed.lines.forEach((line, i) => {
        const blockOffsetX = _getVerticalBlockOffsetPx(frameW, composed.lines.length, colW, textAlign);
        const xCenter = frameX + blockOffsetX + (composed.lines.length - i - 0.5) * colW;
        const lineMetrics = { ...metrics, slotOffset: 0 };
        if (rubyLines) {
            _drawVerticalRubyText(ctx, rubyLines[i] || [], xCenter, lineMetrics);
        } else {
            _drawVerticalPlainText(ctx, line, xCenter, 0, lineMetrics);
        }
    });

    return _encodeTextSectionWebP(canvas, section, '縦書きテキストページ');
}

async function _renderHorizontalTextSectionToWebP(section, lang, targetW, targetH, _quality) {
    const { raw, composed } = _prepareTextComposition(section, lang);
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D が利用できません');

    const sx = targetW / CANONICAL_PAGE_WIDTH;
    const sy = targetH / CANONICAL_PAGE_HEIGHT;
    const s = Math.min(sx, sy);

    ctx.fillStyle = section.backgroundColor || '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
    if (!raw) {
        return _encodeTextSectionWebP(canvas, section, '空テキストページ');
    }

    await document.fonts.ready;

    const { x, y, w, h } = composed.frame;
    const frameX = x * sx;
    const frameY = y * sy;
    const frameW = w * sx;
    const fontPx = composed.font.size * s;
    const lineH = (h * sy) / (composed.rules?.maxLines || 20);
    const family = composed.font.family;

    ctx.fillStyle = section.textColor || '#000000';
    ctx.font = `${fontPx}px ${family}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.imageSmoothingEnabled = true;
    const textAlign = _getTextSectionAlign(section);

    const lines = composed.lines || [];
    const baselineOffset = Math.max(fontPx, (lineH - fontPx) / 2 + fontPx * 0.86);
    const lineWidths = lines.map((line) => ctx.measureText(String(line || '').trimEnd()).width);
    const blockWidth = Math.min(frameW, lineWidths.reduce((max, width) => Math.max(max, width), 0));
    const blockOffsetX = _getHorizontalBlockOffsetPx(frameW, blockWidth, textAlign);
    const blockStartX = frameX + blockOffsetX;

    lines.forEach((line, i) => {
        const text = String(line || '');
        if (!text) return;
        const baseline = frameY + i * lineH + baselineOffset;
        _drawHorizontalLine(ctx, text, blockStartX, baseline, frameW, false, 'start');
    });

    return _encodeTextSectionWebP(canvas, section, '横書きテキストページ');
}

function _drawHorizontalLine(ctx, line, x, baseline, width, justify, align = 'start') {
    const text = String(line || '').trimEnd();
    if (!text) return;

    const naturalWidth = ctx.measureText(text).width;
    if (align === 'center') {
        ctx.fillText(text, x + Math.max(0, width - naturalWidth) / 2, baseline);
        return;
    }
    if (align === 'end') {
        ctx.fillText(text, x + Math.max(0, width - naturalWidth), baseline);
        return;
    }
    if (!justify || !/\s/.test(text) || naturalWidth / width < 0.88) {
        ctx.fillText(text, x, baseline);
        return;
    }

    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= 1) {
        ctx.fillText(text, x, baseline);
        return;
    }

    const wordWidth = words.reduce((sum, word) => sum + ctx.measureText(word).width, 0);
    const extra = width - wordWidth;
    const normalSpace = ctx.measureText(' ').width;
    const gap = extra / (words.length - 1);
    if (extra <= normalSpace * (words.length - 1) || gap > normalSpace * 2.2) {
        ctx.fillText(text, x, baseline);
        return;
    }

    let cursor = x;
    words.forEach((word, idx) => {
        ctx.fillText(word, cursor, baseline);
        cursor += ctx.measureText(word).width + (idx < words.length - 1 ? gap : 0);
    });
}

/**
 * テキストページを WebP 化する。
 * 縦書きは CSS/html2canvas に任せず、Canvas に列と文字を明示配置する。
 * 横書きも Canvas に直接描画する。html2canvas の foreignObject は環境により白紙化するため使わない。
 */
async function _renderTextSectionToWebP(section, lang, targetW, targetH, quality) {
    const writingMode = getWritingModeFromConfigs(lang, state.languageConfigs || {});
    if (writingMode === 'vertical-rl') {
        return _renderVerticalTextSectionToWebP(section, lang, targetW, targetH, quality);
    }
    return _renderHorizontalTextSectionToWebP(section, lang, targetW, targetH, quality);
}

function _esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
