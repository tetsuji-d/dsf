/**
 * press.js — Press Room ロジック
 * DSP → DSF レンダリング・R2アップロード・Firestore発行
 */
import {
    doc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { state, dispatch, actionTypes } from './state.js';
import { extractSectionsFromBlocks } from './blocks.js';
import { db, uploadPressPage, triggerAutoSave } from './firebase.js';
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
    composeText,
    getWritingModeFromConfigs,
    getFontPresetFromConfigs,
    parseRubyTokens,
    tokensToPlainText,
    alignRubyToLines
} from './layout.js';
import { verticalGlyphText } from './text-press-html.js';
import { encodeCanvasToWebP } from './canvas-encoding.js';

let _estimateTimer = null;
let _estimateRunId = 0;
let _pressListenersBound = false;
let _pressThumbLang = '';
const PRESS_IMAGE_WEBP_QUALITY = 0.85;
const PRESS_TEXT_WEBP_QUALITY = 0.90;

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

function _renderThumbLangTabs() {
    const container = document.getElementById('press-thumb-lang-tabs');
    if (!container) return;
    const langs = state.languages || ['ja'];
    const current = _getPressThumbLang();
    container.innerHTML = langs.map(code =>
        `<button class="lang-tab press-thumb-lang-tab ${code === current ? 'active' : ''}"
            data-lang="${code}"
            onclick="switchPressThumbLang('${code}')">${code.toUpperCase()}</button>`
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

    container.innerHTML = pages.map((section, i) => {
        const lang = _getPressThumbLang();
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
            onclick="togglePressLang('${code}')">${code.toUpperCase()}</button>`
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
            const quality = _getPressQualityForTask(task);
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

/** Press Room の「クラウドに発行」ボタンから呼ばれる */
window.publishToCloud = async () => {
    if (!state.uid) {
        alert('ログインしてください');
        return;
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

    // プログレス表示
    const btn = document.getElementById('press-publish-cloud-btn');
    const origLabel = btn?.innerHTML;
    const setProgress = (msg) => {
        if (btn) btn.innerHTML = `<span class="material-icons">hourglass_top</span><span>${msg}</span>`;
    };
    const resetBtn = () => { if (btn && origLabel) btn.innerHTML = origLabel; };

    setProgress(t('press_preparing'));

    try {
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
            resetBtn();
            return;
        }

        const dsfPages = [];
        let pageNum = 0;
        let totalBytes = 0;
        let done = 0;
        const renderStamp = Date.now();

        for (const section of pages) {
            pageNum++;
            const langUrls = {};

            for (const lang of langs) {
                let blob;
                if (section.type === 'text') {
                    const raw = section.texts?.[lang];
                    if (!raw || !String(raw).trim()) continue;
                    done++;
                    setProgress(t('press_rendering_progress', { done, total: totalOps }));
                    blob = await _renderTextSectionToWebP(section, lang, targetW, targetH, _getPressQualityForSection(section));
                } else {
                    const bgUrl = section.backgrounds?.[lang] || section.background;
                    if (!bgUrl) continue;
                    done++;
                    setProgress(t('press_rendering_progress', { done, total: totalOps }));
                    blob = await _renderPageToWebP(
                        bgUrl, section.imagePositions?.[lang] || section.imagePosition, targetW, targetH, _getPressQualityForSection(section)
                    );
                }
                totalBytes += blob.size;

                const path = `users/${state.uid}/dsf/${state.projectId}/${renderStamp}/${lang}/page_${String(pageNum).padStart(3, '0')}.webp`;
                langUrls[lang] = await uploadPressPage(blob, path);
            }

            dsfPages.push({
                pageNum,
                pageType: section.type === 'text' ? 'normal_text' : 'normal_image',
                urls: langUrls,
            });
        }

        setProgress(t('press_saving_firestore'));

        // Firestoreに DSF メタデータを保存
        await setDoc(
            doc(db, 'users', state.uid, 'projects', state.projectId),
            {
                dsfPages,
                ...getPressBookConfigForExport(dsfPages.length),
                dsfStatus:      'draft',
                dsfPublishedAt: serverTimestamp(),
                dsfRenderStamp: renderStamp,
                dsfResolution:  resStr,
                dsfQuality:     Math.round(PRESS_IMAGE_WEBP_QUALITY * 100),
                dsfQualityMode: 'auto',
                dsfQualityProfile: {
                    image: Math.round(PRESS_IMAGE_WEBP_QUALITY * 100),
                    text: Math.round(PRESS_TEXT_WEBP_QUALITY * 100),
                },
                dsfLangs:       langs,
                dsfTotalBytes:  totalBytes,
            },
            { merge: true }
        );

        console.log(`[Press] Published ${dsfPages.length} pages → draft`);
        resetBtn();

        // Works Room へ遷移
        window.switchRoom('works');

    } catch (e) {
        console.error('[Press] publishToCloud error:', e);
        alert('発行中にエラーが発生しました:\n' + (e?.message || String(e)));
        resetBtn();
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

function _getPressQualityForSection(section) {
    return section?.type === 'text' ? PRESS_TEXT_WEBP_QUALITY : PRESS_IMAGE_WEBP_QUALITY;
}

function _getPressQualityForTask(task) {
    return task?.kind === 'text' ? PRESS_TEXT_WEBP_QUALITY : PRESS_IMAGE_WEBP_QUALITY;
}

export function getRenderablePressPages() {
    return _getRenderablePages();
}

export function getSelectedPressLangs() {
    return _getSelectedPressLangs();
}

export function getPressQualityProfile() {
    return {
        image: PRESS_IMAGE_WEBP_QUALITY,
        text: PRESS_TEXT_WEBP_QUALITY
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
        return _renderTextSectionToWebP(section, lang, targetW, targetH, _getPressQualityForSection(section));
    }
    const bgUrl = section?.backgrounds?.[lang] || section?.background;
    if (!bgUrl) return null;
    return _renderPageToWebP(
        bgUrl,
        section.imagePositions?.[lang] || section.imagePosition,
        targetW,
        targetH,
        _getPressQualityForSection(section)
    );
}

function _prepareTextComposition(section, lang) {
    const raw = section.texts?.[lang] ?? '';
    const writingMode = getWritingModeFromConfigs(lang, state.languageConfigs || {});
    const fontPreset = getFontPresetFromConfigs(lang, state.languageConfigs || {});

    let rubyTokens = [];
    let hasRuby = false;
    let plainText = raw;
    try {
        rubyTokens = parseRubyTokens(raw);
        hasRuby = rubyTokens.some(t => t.kind === 'ruby');
        plainText = hasRuby ? tokensToPlainText(rubyTokens) : raw;
    } catch {
        rubyTokens = [];
        hasRuby = false;
        plainText = raw;
    }

    const composed = composeText(plainText, lang, writingMode, fontPreset);
    let rubyLines = null;
    try {
        rubyLines = hasRuby ? alignRubyToLines(rubyTokens, composed.lines) : null;
    } catch {
        rubyLines = null;
    }

    return { raw, composed, rubyLines };
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
        const y = metrics.frameY + slot * metrics.charPitch + metrics.charPitch / 2;
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
            const rubyTop = metrics.frameY + startSlot * metrics.charPitch + Math.max(0, (baseBlockH - rubyBlockH) / 2);
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

async function _renderVerticalTextSectionToWebP(section, lang, targetW, targetH, quality) {
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
        return encodeCanvasToWebP(canvas, quality, '空テキストページ');
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
        const xCenter = frameX + frameW - i * colW - colW / 2;
        if (rubyLines) {
            _drawVerticalRubyText(ctx, rubyLines[i] || [], xCenter, metrics);
        } else {
            _drawVerticalPlainText(ctx, line, xCenter, 0, metrics);
        }
    });

    return encodeCanvasToWebP(canvas, quality, '縦書きテキストページ');
}

async function _renderHorizontalTextSectionToWebP(section, lang, targetW, targetH, quality) {
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
        return encodeCanvasToWebP(canvas, quality, '空テキストページ');
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

    const lines = composed.lines || [];
    const lineBreaks = composed.lineBreaks || [];
    const baselineOffset = Math.max(fontPx, (lineH - fontPx) / 2 + fontPx * 0.86);

    lines.forEach((line, i) => {
        const text = String(line || '');
        if (!text) return;
        const baseline = frameY + i * lineH + baselineOffset;
        const isLastParaLine = !!lineBreaks[i] || i === lines.length - 1 || lines[i + 1] === '';
        _drawHorizontalLine(ctx, text, frameX, baseline, frameW, !isLastParaLine);
    });

    return encodeCanvasToWebP(canvas, quality, '横書きテキストページ');
}

function _drawHorizontalLine(ctx, line, x, baseline, width, justify) {
    const text = String(line || '').trimEnd();
    if (!text) return;

    const naturalWidth = ctx.measureText(text).width;
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
