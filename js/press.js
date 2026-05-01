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
import { createId } from './utils.js';
import { getBookCompositionIssues, getPageCoverKey, getPageDisplayLabel, normalizeBookSettings } from './page-labels.js';

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
const _spreadRenderBlobCache = new Map();

function _isSpreadImageSection(section) {
    return section?.type === 'image'
        && section.spreadImage
        && typeof section.spreadImage === 'object'
        && !!section.spreadImage.groupId;
}

function _getPageDirectionForLang(lang) {
    const props = getLangProps(lang);
    return state.languageConfigs?.[lang]?.pageDirection || props.directions?.[0]?.value || 'ltr';
}

function _isCoverPageIndex(pageIndex, total) {
    return !!getPageCoverKey(pageIndex, state.book, state.bookMode, total);
}

function _isOuterCoverPageIndex(pageIndex, total) {
    const coverKey = getPageCoverKey(pageIndex, state.book, state.bookMode, total);
    return coverKey === 'c1' || coverKey === 'c4';
}

function _getReadablePageOrdinalForIndex(pageIndex, total) {
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= total) return 0;
    let ordinal = 0;
    for (let i = 0; i <= pageIndex; i += 1) {
        if (!_isCoverPageIndex(i, total)) ordinal += 1;
    }
    return ordinal;
}

function _getAdjacentPageIndexForSpreadRole(pageIndex, total) {
    if (pageIndex < 0 || pageIndex >= total || _isOuterCoverPageIndex(pageIndex, total)) return -1;
    const coverKey = getPageCoverKey(pageIndex, state.book, state.bookMode, total);
    const mode = normalizeBookSettings(state.book || {}, state.book?.mode || state.bookMode || 'simple', total).mode;
    const readableOrdinal = _getReadablePageOrdinalForIndex(pageIndex, total);
    let candidate;
    if (coverKey === 'c2') {
        candidate = pageIndex + 1;
    } else if (coverKey === 'c3') {
        candidate = pageIndex - 1;
    } else if (mode === 'full') {
        candidate = readableOrdinal % 2 === 1 ? pageIndex - 1 : pageIndex + 1;
    } else {
        candidate = readableOrdinal % 2 === 1 ? pageIndex + 1 : pageIndex - 1;
    }
    if (candidate < 0 || candidate >= total || _isOuterCoverPageIndex(candidate, total)) return -1;
    return candidate;
}

function _getPhysicalSpreadRoleForIndex(pageIndex, lang, total) {
    const adjIdx = _getAdjacentPageIndexForSpreadRole(pageIndex, total);
    if (adjIdx < 0) return '';
    const pageDir = _getPageDirectionForLang(lang);
    const pageOnLeft = pageDir === 'rtl' ? pageIndex >= adjIdx : pageIndex <= adjIdx;
    return pageOnLeft ? 'left' : 'right';
}

export function getPressSpreadImageDsfMetadata(section, pageIndex, langs = [], pages = _getRenderablePages()) {
    if (!_isSpreadImageSection(section)) return null;
    const groupId = section?.spreadImage?.groupId || '';
    if (!groupId) return null;
    const total = Array.isArray(pages) ? pages.length : 0;
    const rolesByLang = {};
    (Array.isArray(langs) ? langs : []).forEach((lang) => {
        const code = String(lang || '').trim();
        if (!code) return;
        const role = _getPhysicalSpreadRoleForIndex(pageIndex, code, total);
        if (role) rolesByLang[code] = role;
    });
    const defaultLang = state.defaultLang || (Array.isArray(langs) ? langs[0] : '') || 'ja';
    const physicalRole = rolesByLang[defaultLang] || Object.values(rolesByLang)[0] || '';
    return {
        groupId,
        physicalRole,
        rolesByLang,
        authoringRole: section.spreadImage.role === 'right' ? 'right' : 'left'
    };
}

function _getSpreadImageRenderOptions(section, pageIndex = -1, lang = state.activeLang || state.defaultLang || 'ja', total = _getRenderablePages().length) {
    if (!_isSpreadImageSection(section)) return {};
    const physicalRole = Number.isInteger(pageIndex) && pageIndex >= 0
        ? _getPhysicalSpreadRoleForIndex(pageIndex, lang, total)
        : '';
    const role = physicalRole || (section.spreadImage.role === 'left' ? 'left' : 'right');
    return {
        frameWidth: CANONICAL_PAGE_WIDTH * 2,
        frameHeight: CANONICAL_PAGE_HEIGHT,
        offsetX: role === 'left' ? CANONICAL_PAGE_WIDTH / 2 : -CANONICAL_PAGE_WIDTH / 2
    };
}

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
        const label = getPageDisplayLabel(i, pages.length, state.book, state.bookMode);
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
    const sourceMode = raw.mode || state.bookMode || 'cover';
    const mode = sourceMode === 'none' ? 'none' : 'cover';
    return _normalizeBookSettings({ ...raw, mode }, pageCount);
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
    return normalizeBookSettings(next, sourceMode, pageCount);
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
                <option value="none" ${mode === 'none' ? 'selected' : ''}>${_esc(t('press_book_none'))}</option>
                <option value="cover" ${mode !== 'none' ? 'selected' : ''}>${_esc(t('press_book_cover_auto'))}</option>
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
    const key = getPageCoverKey(pageIndex, state.book, state.bookMode, _getRenderablePages().length);
    return key ? [key] : [];
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
    for (const [pageIndex, section] of pages.entries()) {
        for (const lang of langs) {
            if (section.type === 'text') {
                tasks.push({ kind: 'text', section, lang });
            } else {
                const bgUrl = section.backgrounds?.[lang] || section.background;
                if (!bgUrl && !_isSpreadImageSection(section)) continue;
                tasks.push({
                    kind: 'image',
                    section,
                    pageIndex,
                    pages,
                    lang,
                    bgUrl,
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
                : await _renderSectionImageBlob(task.section, task.lang, w, h, quality, task.pageIndex, task.pages);
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
    const nextMode = mode === 'none' ? 'none' : 'cover';
    _writeBookSettings({ mode: nextMode });
    _renderBookSettings();
    _renderPageThumbs();
};

function _getCompositionIssueMessage(issue) {
    const messages = {
        cover_requires_even_pages: '表紙あり構成では総ページ数を偶数にしてください。',
        cover_requires_two_or_more_pages: '表紙あり構成には最低2ページが必要です。',
        cover_disallows_three_pages: '表紙あり3ページ構成は使用できません。2ページ、または4ページ以上の偶数にしてください。',
        spread_image_requires_covers: '表紙なし構成では見開き画像ページを使用できません。',
        spread_image_requires_full_covers: '見開き画像ページは C1/C2/C3/C4 構成の見開き位置でのみ使用できます。',
        spread_image_requires_adjacent_pair: '見開き画像ページは隣接する2ページ単位で配置してください。',
        spread_image_cannot_include_cover: '見開き画像ページに C1/C4 外側表紙ページを含めることはできません。',
        spread_image_invalid_body_pair: '見開き画像ページは C2|1、2|3、最終ページ|C3 のような紙面上の隣接見開き位置にだけ挿入できます。'
    };
    return messages[issue] || issue;
}

export function getPressBookCompositionIssueMessages() {
    const pages = _getRenderablePages();
    const book = _readBookSettings(pages.length);
    const issues = getBookCompositionIssues({
        pageCount: pages.length,
        book,
        bookMode: book.mode,
        sections: pages
    });
    return [...new Set(issues)].map(_getCompositionIssueMessage);
}

function _validateBookCompositionForPress() {
    const messages = getPressBookCompositionIssueMessages();
    if (!messages.length) return true;
    alert(messages.join('\n'));
    return false;
}

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
    if (!state.workId) {
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'workId', value: createId('work') } });
    }

    const pages = _getRenderablePages();
    if (!pages.length) {
        alert('レンダリングするページがありません');
        return;
    }
    if (!_validateBookCompositionForPress()) return;

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
                totalOps += 1;
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
        const workId = state.workId;
        const releaseId = createId('rel');
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'releaseId', value: releaseId } });

        try {
            await auth.currentUser.getIdToken(true);
        } catch (_) {
            /* トークン更新に失敗しても getIdToken(false) で再試行される */
        }

        for (const [pageIndex, section] of pages.entries()) {
            throwIfPressRenderCancelled();
            pageNum++;
            const langUrls = {};
            const langBytes = {};
            let pageTotalBytes = 0;

            for (const lang of langs) {
                throwIfPressRenderCancelled();
                let blob;
                if (section.type === 'text') {
                    done++;
                    setModalProgress(
                        t('press_rendering_progress', { done, total: totalOps }),
                        done / totalOps
                    );
                    blob = await _renderTextSectionToWebP(section, lang, targetW, targetH, _getPressQualityForSection(section, targetW, targetH));
                } else {
                    const bgUrl = section.backgrounds?.[lang] || section.background;
                    if (!bgUrl && !_isSpreadImageSection(section)) continue;
                    done++;
                    setModalProgress(
                        t('press_rendering_progress', { done, total: totalOps }),
                        done / totalOps
                    );
                    blob = await _renderSectionImageBlob(
                        section,
                        lang,
                        targetW,
                        targetH,
                        _getPressQualityForSection(section, targetW, targetH),
                        pageIndex,
                        pages
                    );
                }
                throwIfPressRenderCancelled();
                totalBytes += blob.size;
                pageTotalBytes += blob.size;

                const path = `users/${uid}/dsf/${workId}/${releaseId}/${lang}/page_${String(pageNum).padStart(3, '0')}.webp`;
                langUrls[lang] = await uploadPressPage(blob, path);
                langBytes[lang] = blob.size;
            }

            const spreadImage = getPressSpreadImageDsfMetadata(section, pageIndex, langs, pages);
            const dsfPage = {
                pageNum,
                pageType: section.type === 'text' ? 'normal_text' : 'normal_image',
                workId,
                releaseId,
                urls: langUrls,
                bytesByLang: langBytes,
                totalBytes: pageTotalBytes,
            };
            if (spreadImage) dsfPage.spreadImage = spreadImage;
            dsfPages.push(dsfPage);
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
                workId,
                releaseId,
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

        await setDoc(
            doc(db, 'users', uid, 'works', workId),
            {
                workId,
                projectId: state.projectId,
                ownerUid: uid,
                title: state.title || '',
                labelName: state.labelName || '',
                rating: state.rating || 'all',
                license: state.license || 'all-rights-reserved',
                meta: state.meta || {},
                languages: state.languages || ['ja'],
                defaultLang: state.defaultLang || state.languages?.[0] || 'ja',
                latestReleaseId: releaseId,
                latestProjectId: state.projectId,
                updatedAt: serverTimestamp()
            },
            { merge: true }
        );

        await setDoc(
            doc(db, 'users', uid, 'works', workId, 'releases', releaseId),
            {
                releaseId,
                workId,
                projectId: state.projectId,
                dsfPages,
                ...getPressBookConfigForExport(dsfPages.length),
                dsfStatus: 'draft',
                dsfPublishedAt: serverTimestamp(),
                dsfRenderStamp: renderStamp,
                dsfResolution: resStr,
                dsfQuality: Math.round(qualityProfile.image * 100),
                dsfQualityMode: 'auto-resolution',
                dsfQualityProfile: {
                    image: Math.round(qualityProfile.image * 100),
                    text: Math.round(PRESS_TEXT_WEBP_QUALITY * 100),
                },
                dsfLangs: langs,
                dsfTotalBytes: totalBytes,
                createdAt: serverTimestamp()
            },
            { merge: true }
        );

        // Press は新しい DSF を draft として作り直す。
        // 公開インデックスは Works が管理するため、再発行時は stale な公開行を外す。
        await deleteDoc(doc(db, 'public_projects', workId))
            .catch((e) => console.warn('[Press] Failed to clear public_projects on draft publish:', e?.message || e));
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

async function _renderPageToWebP(bgUrl, pos, targetW, targetH, quality, options = {}) {
    // Pages Functions 経由で画像を同一オリジン取得し、Canvas CORS taint を回避する
    const { img, revoke } = await loadImageForCanvas(bgUrl, 'Press Room 元画像');

    const canvas = document.createElement('canvas');
    canvas.width  = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);

    // 基準フレームは正規論理ページ（page-geometry）。見開き画像は2ページ幅の仮想フレームから片側だけ切り出す。
    const frameBaseW = Number(options.frameWidth) || CANONICAL_PAGE_WIDTH;
    const frameBaseH = Number(options.frameHeight) || CANONICAL_PAGE_HEIGHT;
    const pageRatioX = targetW / CANONICAL_PAGE_WIDTH;
    const pageRatioY = targetH / CANONICAL_PAGE_HEIGHT;
    const frameTargetW = targetW * (frameBaseW / CANONICAL_PAGE_WIDTH);
    const frameTargetH = targetH * (frameBaseH / CANONICAL_PAGE_HEIGHT);
    const offsetX = Number(options.offsetX) || 0;

    const safePos = {
        x:        Number.isFinite(Number(pos?.x))        ? Number(pos.x)        : 0,
        y:        Number.isFinite(Number(pos?.y))        ? Number(pos.y)        : 0,
        scale:    Math.max(0.1, Number.isFinite(Number(pos?.scale))    ? Number(pos.scale)    : 1),
        rotation: Number.isFinite(Number(pos?.rotation)) ? Number(pos.rotation) : 0,
        flipX:    !!pos?.flipX,
    };

    ctx.save();
    ctx.translate(targetW / 2, targetH / 2);
    ctx.translate((safePos.x + offsetX) * pageRatioX, safePos.y * pageRatioY);
    ctx.rotate((safePos.rotation * Math.PI) / 180);
    ctx.scale(safePos.flipX ? -safePos.scale : safePos.scale, safePos.scale);

    // object-fit: cover と同じ挙動
    const imgAspect   = img.width  / img.height;
    const frameAspect = frameTargetW / frameTargetH;
    let drawW, drawH;
    if (imgAspect > frameAspect) {
        drawH = frameTargetH;
        drawW = frameTargetH * imgAspect;
    } else {
        drawW = frameTargetW;
        drawH = frameTargetW / imgAspect;
    }

    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
    revoke();

    return encodeCanvasToWebP(canvas, quality, '画像ページ');
}

function _normalizeImageTransform(pos = {}) {
    return {
        x: Number.isFinite(Number(pos?.x)) ? Number(pos.x) : 0,
        y: Number.isFinite(Number(pos?.y)) ? Number(pos.y) : 0,
        scale: Math.max(0.1, Number.isFinite(Number(pos?.scale)) ? Number(pos.scale) : 1),
        rotation: Number.isFinite(Number(pos?.rotation)) ? Number(pos.rotation) : 0,
        flipX: !!pos?.flipX,
    };
}

function _serializeSpreadCacheTransform(pos) {
    return [
        Number(pos?.x || 0).toFixed(4),
        Number(pos?.y || 0).toFixed(4),
        Number(pos?.scale || 1).toFixed(4),
        Number(pos?.rotation || 0).toFixed(4),
        pos?.flipX ? '1' : '0'
    ].join(':');
}

function _getSpreadImageGroupIndices(pages, groupId) {
    if (!Array.isArray(pages) || !groupId) return [];
    return pages
        .map((section, index) => section?.spreadImage?.groupId === groupId ? index : -1)
        .filter((index) => index >= 0);
}

function _getSpreadImageSharedBackground(pages, indices, lang) {
    for (const index of indices) {
        const section = pages[index];
        const url = section?.backgrounds?.[lang]
            || section?.backgrounds?.[state.defaultLang]
            || section?.background
            || '';
        if (url) return url;
    }
    return '';
}

function _getSpreadImageSharedPosition(pages, indices, lang) {
    for (const index of indices) {
        const section = pages[index];
        const pos = section?.imagePositions?.[lang]
            || section?.imagePositions?.[state.defaultLang]
            || section?.imagePosition
            || section?.imageBasePosition;
        if (pos) return _normalizeImageTransform(pos);
    }
    return _normalizeImageTransform();
}

async function _renderSpreadImagePairBlobs(bgUrl, pos, targetW, targetH, quality) {
    const { img, revoke } = await loadImageForCanvas(bgUrl, 'Press Room 見開き元画像');
    const spreadCanvas = document.createElement('canvas');
    spreadCanvas.width = targetW * 2;
    spreadCanvas.height = targetH;
    const spreadCtx = spreadCanvas.getContext('2d');
    if (!spreadCtx) {
        revoke();
        throw new Error('Canvas 2D が利用できません');
    }

    spreadCtx.fillStyle = '#ffffff';
    spreadCtx.fillRect(0, 0, spreadCanvas.width, spreadCanvas.height);

    const safePos = _normalizeImageTransform(pos);
    const frameTargetW = spreadCanvas.width;
    const frameTargetH = targetH;
    const scaleX = frameTargetW / (CANONICAL_PAGE_WIDTH * 2);
    const scaleY = frameTargetH / CANONICAL_PAGE_HEIGHT;

    spreadCtx.save();
    spreadCtx.translate(frameTargetW / 2, frameTargetH / 2);
    spreadCtx.translate(safePos.x * scaleX, safePos.y * scaleY);
    spreadCtx.rotate((safePos.rotation * Math.PI) / 180);
    spreadCtx.scale(safePos.flipX ? -safePos.scale : safePos.scale, safePos.scale);

    const imgAspect = img.width / img.height;
    const frameAspect = frameTargetW / frameTargetH;
    let drawW;
    let drawH;
    if (imgAspect > frameAspect) {
        drawH = frameTargetH;
        drawW = frameTargetH * imgAspect;
    } else {
        drawW = frameTargetW;
        drawH = frameTargetW / imgAspect;
    }
    spreadCtx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    spreadCtx.restore();
    revoke();

    const leftCanvas = document.createElement('canvas');
    leftCanvas.width = targetW;
    leftCanvas.height = targetH;
    const leftCtx = leftCanvas.getContext('2d');
    const rightCanvas = document.createElement('canvas');
    rightCanvas.width = targetW;
    rightCanvas.height = targetH;
    const rightCtx = rightCanvas.getContext('2d');
    if (!leftCtx || !rightCtx) throw new Error('Canvas 2D が利用できません');

    leftCtx.drawImage(spreadCanvas, 0, 0, targetW, targetH, 0, 0, targetW, targetH);
    rightCtx.drawImage(spreadCanvas, targetW, 0, targetW, targetH, 0, 0, targetW, targetH);

    // 見開き中央の継ぎ目は左右を別々にロッシー圧縮すると色差が出るため、
    // 見開き画像ページだけは分割後の左右ページをロスレス WebP で固定する。
    const [leftBlob, rightBlob] = await Promise.all([
        encodeCanvasToWebP(leftCanvas, 1, '見開き画像ページ(左)', { lossless: true }),
        encodeCanvasToWebP(rightCanvas, 1, '見開き画像ページ(右)', { lossless: true })
    ]);
    return { leftBlob, rightBlob };
}

async function _renderSectionImageBlob(section, lang, targetW, targetH, quality, pageIndex, pages = _getRenderablePages()) {
    const bgUrl = section?.backgrounds?.[lang] || section?.backgrounds?.[state.defaultLang] || section?.background || '';
    const pos = section?.imagePositions?.[lang]
        || section?.imagePositions?.[state.defaultLang]
        || section?.imagePosition
        || section?.imageBasePosition;
    if (!_isSpreadImageSection(section)) {
        return _renderPageToWebP(bgUrl, pos, targetW, targetH, quality);
    }

    const groupId = section?.spreadImage?.groupId || '';
    const total = pages.length;
    const indices = _getSpreadImageGroupIndices(pages, groupId);
    if (indices.length !== 2) {
        return _renderPageToWebP(
            bgUrl,
            pos,
            targetW,
            targetH,
            quality,
            _getSpreadImageRenderOptions(section, pageIndex, lang, total)
        );
    }

    const sharedBgUrl = _getSpreadImageSharedBackground(pages, indices, lang) || bgUrl;
    const sharedPos = _getSpreadImageSharedPosition(pages, indices, lang);
    const cacheKey = [
        groupId,
        lang,
        targetW,
        targetH,
        Number(quality).toFixed(4),
        sharedBgUrl,
        _serializeSpreadCacheTransform(sharedPos)
    ].join('|');
    if (!_spreadRenderBlobCache.has(cacheKey)) {
        _spreadRenderBlobCache.set(cacheKey, _renderSpreadImagePairBlobs(sharedBgUrl, sharedPos, targetW, targetH, quality));
    }
    const pair = await _spreadRenderBlobCache.get(cacheKey);
    const role = _getPhysicalSpreadRoleForIndex(pageIndex, lang, total)
        || (section?.spreadImage?.role === 'left' ? 'left' : 'right');
    return role === 'left' ? pair.leftBlob : pair.rightBlob;
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

export async function renderPressSectionToWebP(section, lang, targetW, targetH, pageIndexOverride = null, pagesOverride = null) {
    if (section?.type === 'text') {
        return _renderTextSectionToWebP(section, lang, targetW, targetH, _getPressQualityForSection(section, targetW, targetH));
    }
    const pages = Array.isArray(pagesOverride) ? pagesOverride : _getRenderablePages();
    const pageIndex = Number.isInteger(pageIndexOverride) ? pageIndexOverride : pages.indexOf(section);
    const bgUrl = section?.backgrounds?.[lang] || section?.backgrounds?.[state.defaultLang] || section?.background;
    if (!bgUrl && !_isSpreadImageSection(section)) return null;
    return _renderSectionImageBlob(section, lang, targetW, targetH, _getPressQualityForSection(section, targetW, targetH), pageIndex, pages);
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
