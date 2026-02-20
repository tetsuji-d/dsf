/**
 * app.js — メインエントリポイント・描画・UI同期
 */
import { state } from './state.js';
import { saveProject, loadProject, uploadToStorage, uploadCoverToStorage, uploadStructureToStorage, triggerAutoSave, generateCroppedThumbnail, signInWithGoogle, signOutUser, onAuthChanged, consumeRedirectResult } from './firebase.js';
import { handleCanvasClick, selectBubble, renderBubbleHTML, getBubbleText, setBubbleText, addBubbleAtCenter, startDrag } from './bubbles.js';
import { addSection, changeSection, changeBlock, insertStructureBlock, renderThumbs, deleteActive, insertSectionAt, duplicateSectionAt, moveSection, insertPageNearBlock, duplicateBlockAt, moveBlockAt } from './sections.js';
import { pushState, undo, redo, getHistoryInfo, clearHistory } from './history.js';
import { openProjectModal, closeProjectModal } from './projects.js';
import { getLangProps, getAllLangs } from './lang.js';
import { composeCanonicalLayoutsForSections, composeText, getFontPresetFromConfigs, getFontPresetOptions, LAYOUT_VERSION } from './layout.js';
import { getBlockIndexFromPageIndex, getPageIndexFromBlockIndex, migrateSectionsToBlocks, syncBlocksWithSections } from './blocks.js';
import { PAGE_SCHEMA_VERSION, blocksToPages, normalizeProjectDataV5, buildOutlineFromPages } from './pages.js';
import { THEME_TEMPLATES, THEME_PALETTES, getThemePalette, getThemeTemplate } from './theme-presets.js';

// ──────────────────────────────────────
//  ヘルパー: セクションテキストの多言語取得・設定
// ──────────────────────────────────────
function getSectionText(s) {
    const lang = state.activeLang;
    if (s.texts && s.texts[lang] !== undefined) return s.texts[lang];
    return s.text || '';
}

function setSectionText(s, text) {
    const lang = state.activeLang;
    if (!s.texts) s.texts = {};
    s.texts[lang] = text;
    s.text = text;
}

function getActiveBlock() {
    const blocks = state.blocks || [];
    if (Number.isInteger(state.activeBlockIdx) && blocks[state.activeBlockIdx]) {
        return blocks[state.activeBlockIdx];
    }
    const fallbackBlockIdx = getBlockIndexFromPageIndex(blocks, state.activeIdx);
    if (fallbackBlockIdx >= 0) {
        state.activeBlockIdx = fallbackBlockIdx;
        return blocks[fallbackBlockIdx];
    }
    return null;
}

function getBlockLocalizedText(block) {
    const lang = state.activeLang;
    if (!block) return '';
    if (block.kind === 'cover_front') return block.meta?.title?.[lang] || '';
    if (block.kind === 'cover_back') return block.meta?.colophon?.[lang] || '';
    if (block.kind === 'chapter' || block.kind === 'section' || block.kind === 'item' || block.kind === 'toc') {
        return block.meta?.title?.[lang] || '';
    }
    return '';
}

function setBlockLocalizedText(block, text) {
    const lang = state.activeLang;
    if (!block) return;
    if (!block.meta) block.meta = {};
    if (block.kind === 'cover_front') {
        if (!block.meta.title) block.meta.title = {};
        block.meta.title[lang] = text;
        return;
    }
    if (block.kind === 'cover_back') {
        if (!block.meta.colophon) block.meta.colophon = {};
        block.meta.colophon[lang] = text;
        return;
    }
    if (block.kind === 'chapter' || block.kind === 'section' || block.kind === 'item' || block.kind === 'toc') {
        if (!block.meta.title) block.meta.title = {};
        block.meta.title[lang] = text;
    }
}

function getCoverBodyKindFromBlock(block) {
    const raw = block?.meta?.bodyKind || block?.meta?.renderMode || 'image';
    return raw === 'theme' ? 'theme' : 'image';
}

function renderCoverThemePreview(block) {
    const lang = state.activeLang;
    const theme = block?.content?.theme || block?.meta?.theme || {};
    const palette = getThemePalette(theme.paletteId);
    const template = getThemeTemplate(theme.templateId);
    const title = block?.meta?.title?.[lang] || 'Title';
    const subtitle = block?.meta?.subtitle?.[lang] || '';
    const author = block?.meta?.author?.[lang] || '';
    const supervisor = block?.meta?.supervisor?.[lang] || '';
    const publisher = block?.meta?.publisher?.[lang] || '';
    const edition = block?.meta?.edition?.[lang] || '';
    const contacts = Array.isArray(block?.meta?.contacts) ? block.meta.contacts : [];
    const contactText = contacts.map((c) => c?.value || '').filter(Boolean).join(' / ');
    const templateId = template.id || 'classic';

    if (block?.kind === 'cover_back') {
        if (templateId === 'minimal') {
            return `
                <div class="fixed-text-frame" style="position:absolute; left:20px; top:32px; width:320px; height:576px; background:${palette.bg}; color:${palette.fg}; border-left:10px solid ${palette.accent}; padding:28px;">
                    <div style="font-size:15px; line-height:1.8; margin-top:8px;">${edition || ''}</div>
                    <div style="font-size:12px; line-height:1.7; margin-top:14px; color:${palette.sub};">${contactText || '連絡先未入力'}</div>
                </div>
            `;
        }
        if (templateId === 'bold') {
            return `
                <div class="fixed-text-frame" style="position:absolute; left:20px; top:32px; width:320px; height:576px; border-radius:10px; background:${palette.accent}; color:#fff; padding:18px;">
                    <div style="height:100%; border:2px solid rgba(255,255,255,.8); border-radius:8px; padding:18px; background:linear-gradient(160deg, ${palette.accent}, ${palette.fg});">
                        <div style="font-size:16px; line-height:1.7; margin-top:12px;">${edition || ''}</div>
                        <div style="font-size:12px; line-height:1.8; margin-top:14px; opacity:.9;">${contactText || '連絡先未入力'}</div>
                    </div>
                </div>
            `;
        }
        if (templateId === 'novel') {
            return `
                <div class="fixed-text-frame" style="position:absolute; left:20px; top:32px; width:320px; height:576px; border-radius:6px; background:${palette.bg}; color:${palette.fg}; border:1px solid ${palette.sub}; padding:26px;">
                    <div style="border-top:1px solid ${palette.sub}; margin:12px 0 16px;"></div>
                    <div style="font-size:14px; line-height:1.9; font-family:'Noto Serif JP',serif;">${edition || ''}</div>
                    <div style="font-size:12px; line-height:1.9; margin-top:12px; color:${palette.sub};">${contactText || '連絡先未入力'}</div>
                </div>
            `;
        }
        return `
            <div class="fixed-text-frame" style="position:absolute; left:20px; top:32px; width:320px; height:576px; border-radius:8px; background:${palette.bg}; color:${palette.fg}; border:2px solid ${palette.accent}; padding:22px;">
                <div style="font-size:15px; line-height:1.7; margin-top:14px;">${edition || ''}</div>
                <div style="font-size:13px; line-height:1.6; margin-top:12px; color:${palette.sub};">${contactText || '連絡先未入力'}</div>
            </div>
        `;
    }

    if (templateId === 'minimal') {
        return `
            <div class="fixed-text-frame" style="position:absolute; left:20px; top:32px; width:320px; height:576px; background:${palette.bg}; color:${palette.fg}; border-left:10px solid ${palette.accent}; padding:28px;">
                <div style="font-size:34px; font-weight:900; line-height:1.2; margin:26px 0 12px; white-space:normal; overflow-wrap:anywhere; word-break:break-word;">${title || 'タイトル未入力'}</div>
                <div style="font-size:16px; color:${palette.sub}; margin-bottom:16px;">${subtitle || ''}</div>
                <div style="position:absolute; left:28px; right:28px; bottom:24px; font-size:13px; color:${palette.sub}; line-height:1.6;">
                    <div>${author || ''}</div><div>${supervisor || ''}</div><div>${publisher || ''}</div>
                </div>
            </div>
        `;
    }
    if (templateId === 'bold') {
        return `
            <div class="fixed-text-frame" style="position:absolute; left:20px; top:32px; width:320px; height:576px; border-radius:10px; background:${palette.accent}; color:#fff; padding:18px;">
                <div style="height:100%; border:2px solid rgba(255,255,255,.8); border-radius:8px; padding:18px; background:linear-gradient(160deg, ${palette.accent}, ${palette.fg});">
                    <div style="font-size:36px; font-weight:900; line-height:1.15; margin:28px 0 10px; white-space:normal; overflow-wrap:anywhere; word-break:break-word;">${title || 'タイトル未入力'}</div>
                    <div style="font-size:17px; opacity:.9; margin-bottom:18px;">${subtitle || ''}</div>
                    <div style="position:absolute; left:36px; right:36px; bottom:30px; font-size:13px; line-height:1.6; opacity:.9;">
                        <div>${author || ''}</div><div>${supervisor || ''}</div><div>${publisher || ''}</div>
                    </div>
                </div>
            </div>
        `;
    }
    if (templateId === 'novel') {
        return `
            <div class="fixed-text-frame" style="position:absolute; left:20px; top:32px; width:320px; height:576px; border-radius:6px; background:${palette.bg}; color:${palette.fg}; border:1px solid ${palette.sub}; padding:26px;">
                <div style="font-size:34px; font-family:'Noto Serif JP',serif; line-height:1.3; margin:24px 0 12px; white-space:normal; overflow-wrap:anywhere; word-break:break-word;">${title || 'タイトル未入力'}</div>
                <div style="font-size:15px; color:${palette.sub}; margin-bottom:20px; font-family:'Noto Serif JP',serif;">${subtitle || ''}</div>
                <div style="border-top:1px solid ${palette.sub}; margin-bottom:14px;"></div>
                <div style="position:absolute; left:26px; right:26px; bottom:24px; font-size:13px; color:${palette.sub}; line-height:1.8; font-family:'Noto Serif JP',serif;">
                    <div>${author || ''}</div><div>${supervisor || ''}</div><div>${publisher || ''}</div>
                </div>
            </div>
        `;
    }

    return `
        <div class="fixed-text-frame" style="position:absolute; left:20px; top:32px; width:320px; height:576px; border-radius:8px; background:${palette.bg}; color:${palette.fg}; border:2px solid ${palette.accent}; padding:24px;">
            <div style="font-size:30px; font-weight:800; line-height:1.25; margin-bottom:10px; white-space:normal; overflow-wrap:anywhere; word-break:break-word;">${title || 'タイトル未入力'}</div>
            <div style="font-size:16px; color:${palette.sub}; margin-bottom:20px;">${subtitle || ''}</div>
            <div style="position:absolute; left:24px; right:24px; bottom:24px;">
                <div style="font-size:14px; margin-bottom:6px;">${author || ''}</div>
                <div style="font-size:13px; color:${palette.sub}; margin-bottom:6px;">${supervisor || ''}</div>
                <div style="font-size:13px; color:${palette.sub};">${publisher || ''}</div>
            </div>
        </div>
    `;
}

function renderCoverImagePreview(block) {
    const bg = block?.content?.background || '';
    if (!bg) {
        return `
            <div class="fixed-text-frame" style="position:absolute; left:20px; top:32px; width:320px; height:576px; display:flex; align-items:center; justify-content:center; border:2px dashed #cfd7e3; background:#f8fafc; color:#2f3e52; padding:20px; text-align:center;">
                <div style="font-size:14px; font-weight:700;">画像を設定してください</div>
            </div>
        `;
    }
    return `
        <div style="position:absolute; left:20px; top:32px; width:320px; height:576px; overflow:hidden; border-radius:8px; border:1px solid #d7deea;">
            <img src="${bg}" style="width:100%; height:100%; object-fit:cover;">
        </div>
    `;
}

function renderTocPreview(activeBlock) {
    const lang = state.activeLang;
    const outline = buildOutlineFromPages(state.pages || [], lang, 'item');
    const blocks = Array.isArray(state.blocks) ? state.blocks : [];
    const tocIndices = [];
    for (let i = 0; i < blocks.length; i += 1) {
        if (blocks[i]?.kind === 'toc') tocIndices.push(i);
    }
    const activeIdx = Number.isInteger(state.activeBlockIdx) ? state.activeBlockIdx : -1;
    const tocPos = Math.max(0, tocIndices.indexOf(activeIdx));
    const start = tocPos * TOC_ROWS_PER_PAGE;
    const rows = outline.slice(start, start + TOC_ROWS_PER_PAGE).map((it) => {
        const indent = it.depth === 1 ? 0 : (it.depth === 2 ? 16 : 32);
        return `<div style="display:flex; justify-content:space-between; gap:10px; margin-bottom:6px; margin-left:${indent}px;">
            <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${it.title}</span>
            <span style="opacity:.7;">${it.pageNumber}</span>
        </div>`;
    }).join('');
    return `
        <div class="fixed-text-frame" style="position:absolute; left:20px; top:32px; width:320px; height:576px; border:2px solid #d8e0ec; border-radius:8px; background:#fff; color:#22314a; padding:16px; overflow:hidden;">
            <div style="font-size:20px; font-weight:800; margin-bottom:12px;">目次</div>
            <div style="font-size:13px; line-height:1.5;">${rows || '<div style="opacity:.6;">見出し未設定</div>'}</div>
        </div>
    `;
}

function getBlockLocalizedMetaField(block, key) {
    const lang = state.activeLang;
    if (!block?.meta) return '';
    const map = block.meta[key];
    if (!map || typeof map !== 'object') return '';
    return map[lang] || '';
}

function setBlockLocalizedMetaField(block, key, value) {
    if (!block) return;
    const lang = state.activeLang;
    if (!block.meta) block.meta = {};
    if (!block.meta[key] || typeof block.meta[key] !== 'object') block.meta[key] = {};
    block.meta[key][lang] = value;
}

function isStructureKind(kind) {
    return kind === 'chapter' || kind === 'section' || kind === 'item';
}

function getStructureBodyKind(block) {
    const raw = block?.meta?.bodyKind || block?.meta?.renderMode || 'text';
    return raw === 'image' ? 'image' : 'text';
}

function setStructureBodyKind(block, bodyKind) {
    if (!block) return;
    if (!block.meta) block.meta = {};
    const mode = bodyKind === 'image' ? 'image' : 'text';
    block.meta.bodyKind = mode;
    block.meta.renderMode = mode;
}

function getStructureBodyText(block) {
    const lang = state.activeLang;
    return block?.content?.texts?.[lang] ?? block?.content?.text ?? '';
}

function setStructureBodyText(block, text) {
    if (!block) return;
    const lang = state.activeLang;
    if (!block.content || typeof block.content !== 'object') block.content = {};
    if (!block.content.texts || typeof block.content.texts !== 'object') block.content.texts = {};
    block.content.texts[lang] = text;
    block.content.text = text;
}

function getStructureTitle(block) {
    const lang = state.activeLang;
    return block?.meta?.title?.[lang] || '';
}

function setStructureTitle(block, text) {
    if (!block) return;
    const lang = state.activeLang;
    if (!block.meta) block.meta = {};
    if (!block.meta.title || typeof block.meta.title !== 'object') block.meta.title = {};
    block.meta.title[lang] = text;
}

function getCoverBodyKind(block) {
    const raw = block?.meta?.bodyKind || block?.meta?.renderMode || 'image';
    return raw === 'theme' ? 'theme' : 'image';
}

function setCoverBodyKind(block, bodyKind) {
    if (!block) return;
    const mode = bodyKind === 'theme' ? 'theme' : 'image';
    if (!block.meta) block.meta = {};
    block.meta.bodyKind = mode;
    block.meta.renderMode = mode;
}

function ensureCoverTheme(block) {
    if (!block) return { templateId: 'classic', paletteId: 'ocean' };
    if (!block.content || typeof block.content !== 'object') block.content = {};
    if (!block.content.theme || typeof block.content.theme !== 'object') {
        block.content.theme = {};
    }
    if (!block.content.theme.templateId) block.content.theme.templateId = 'classic';
    if (!block.content.theme.paletteId) block.content.theme.paletteId = 'ocean';
    if (!block.meta) block.meta = {};
    block.meta.theme = block.content.theme;
    return block.content.theme;
}

function parseContactsFromText(raw) {
    const lines = String(raw || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    return lines.map((value) => {
        if (/^https?:\/\//i.test(value)) return { type: 'url', value };
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { type: 'email', value };
        return { type: 'other', value };
    });
}

let coverFieldPushTimer = null;
function touchCoverFieldHistory() {
    if (!coverFieldPushTimer) {
        pushState();
    } else {
        clearTimeout(coverFieldPushTimer);
    }
    coverFieldPushTimer = setTimeout(() => { coverFieldPushTimer = null; }, 500);
}

function populateThemeSelectOptions() {
    const templateOptions = Object.values(THEME_TEMPLATES)
        .map((t) => `<option value="${t.id}">${t.label}</option>`)
        .join('');
    const paletteOptions = Object.entries(THEME_PALETTES)
        .map(([id, p]) => `<option value="${id}">${id.charAt(0).toUpperCase()}${id.slice(1)}</option>`)
        .join('');

    const templateIds = ['cover-front-theme-template', 'cover-back-theme-template'];
    const paletteIds = ['cover-front-theme-palette', 'cover-back-theme-palette'];
    templateIds.forEach((id) => {
        const el = document.getElementById(id);
        if (el && el.dataset.loaded !== '1') {
            el.innerHTML = templateOptions;
            el.dataset.loaded = '1';
        }
    });
    paletteIds.forEach((id) => {
        const el = document.getElementById(id);
        if (el && el.dataset.loaded !== '1') {
            el.innerHTML = paletteOptions;
            el.dataset.loaded = '1';
        }
    });
}

const TOC_ROWS_PER_PAGE = 18;

function createRuntimeBlockId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isAutoTocBlock(block) {
    return block?.kind === 'toc' && block?.meta?.systemGenerated === true;
}

function isLockedBlock(block) {
    return block?.kind === 'cover_front' || block?.kind === 'cover_back' || isAutoTocBlock(block);
}

function ensureAutoTocBlocks() {
    const src = Array.isArray(state.blocks) ? state.blocks : [];
    if (!src.length) return;

    const before = src.filter((b) => !isAutoTocBlock(b));
    const manualTocIdx = before.findIndex((b) => b?.kind === 'toc');
    if (manualTocIdx < 0) {
        state.blocks = before;
        return;
    }

    const pages = blocksToPages(before);
    const lang = state.defaultLang || state.activeLang || state.languages?.[0] || 'ja';
    const outline = buildOutlineFromPages(pages, lang, 'item');
    const requiredCount = Math.max(1, Math.ceil(Math.max(1, outline.length) / TOC_ROWS_PER_PAGE));
    const addCount = Math.max(0, requiredCount - 1);

    const next = [...before];
    const seed = next[manualTocIdx];
    for (let i = 0; i < addCount; i += 1) {
        next.splice(manualTocIdx + 1 + i, 0, {
            id: createRuntimeBlockId('toc_auto'),
            kind: 'toc',
            meta: {
                title: { ...(seed?.meta?.title || {}) },
                systemGenerated: true,
                tocPageOffset: i + 1
            }
        });
    }

    const activeId = src[state.activeBlockIdx]?.id;
    state.blocks = next;
    if (activeId) {
        const nextActive = next.findIndex((b) => b?.id === activeId);
        if (nextActive >= 0) {
            state.activeBlockIdx = nextActive;
        } else {
            state.activeBlockIdx = Math.max(0, Math.min(state.activeBlockIdx || 0, next.length - 1));
        }
    }
}

function syncBlocksFromState() {
    state.blocks = syncBlocksWithSections(state.blocks, state.sections, state.languages);
    ensureAutoTocBlocks();
    state.pages = blocksToPages(state.blocks);
    const activeBlock = getActiveBlock();
    const pageIdx = getPageIndexFromBlockIndex(state.blocks, state.activeBlockIdx);
    if (pageIdx >= 0) {
        state.activeIdx = pageIdx;
        state.activePageIdx = pageIdx;
    }
    if (!activeBlock && state.blocks?.length) state.activeBlockIdx = 0;
}

function ensureSectionLayout(s) {
    if (!s.layout || typeof s.layout !== 'object') s.layout = {};
}

function getSectionLayout(s) {
    const lang = state.activeLang;
    ensureSectionLayout(s);
    return s.layout[lang] || null;
}

function composeSectionForActiveLang(s) {
    const lang = state.activeLang;
    const raw = getSectionText(s);
    const mode = getWritingMode(lang);
    const fontPreset = getFontPreset(lang);
    ensureSectionLayout(s);
    const layout = composeText(raw, lang, mode, fontPreset);
    s.layout[lang] = layout;
    return layout;
}

function ensureComposedLayoutForActiveLang(s) {
    const lang = state.activeLang;
    const raw = getSectionText(s);
    const mode = getWritingMode(lang);
    const fontPreset = getFontPreset(lang);
    const existing = getSectionLayout(s);
    if (!existing || existing.writingMode !== mode || existing.fontPreset !== fontPreset || Number(existing.version) !== LAYOUT_VERSION) {
        return composeSectionForActiveLang(s);
    }
    return existing;
}

function composeAllTextSectionsForLang(lang) {
    const mode = getWritingMode(lang);
    const fontPreset = getFontPreset(lang);
    for (const s of state.sections || []) {
        if (!s || s.type !== 'text') continue;
        if (!s.texts) s.texts = {};
        if (!s.layout || typeof s.layout !== 'object') s.layout = {};
        const raw = s.texts[lang] !== undefined ? s.texts[lang] : (s.text || '');
        s.layout[lang] = composeText(raw, lang, mode, fontPreset);
    }
}

function updateTextFitStatus(s) {
    const statusEl = document.getElementById('text-fit-status');
    const splitBtn = document.getElementById('btn-split-overflow');
    if (!statusEl || !splitBtn) return;
    if (!s || s.type !== 'text') {
        statusEl.textContent = '';
        splitBtn.style.display = 'none';
        return;
    }
    const layout = ensureComposedLayoutForActiveLang(s);
    const lines = layout?.lines?.length || 0;
    const maxLines = layout?.rules?.maxLines || 0;
    const chars = Array.from(getSectionText(s) || '').length;
    const maxChars = layout?.rules?.maxChars || 0;
    statusEl.textContent = `収まり: ${lines}/${maxLines}行  文字数: ${chars}/${maxChars}`;
    statusEl.style.color = layout?.overflow ? '#c0392b' : '#2f3e52';
    splitBtn.style.display = layout?.overflow ? 'inline-flex' : 'none';
}

function getVerticalTextPadding(layout) {
    if (!layout || layout.writingMode !== 'vertical-rl') return 0;
    const frameH = Number(layout?.frame?.h) || 0;
    const fontSize = Number(layout?.font?.size) || 16;
    const letterSpacing = Number(layout?.font?.letterSpacing) || 0;
    const lines = Array.isArray(layout?.lines) ? layout.lines : [];
    let maxChars = 0;
    for (const line of lines) {
        const count = Array.from(String(line || '')).length;
        if (count > maxChars) maxChars = count;
    }
    if (maxChars <= 0 || frameH <= 0) return 0;
    const usedH = maxChars * Math.max(1, fontSize + letterSpacing);
    const pad = Math.floor((frameH - usedH) / 2);
    return Math.max(0, Math.min(40, pad));
}

// ──────────────────────────────────────
//  refresh — 画面全体を再描画する
// ──────────────────────────────────────
// ──────────────────────────────────────
//  ヘルパー: 書字方向の取得
// ──────────────────────────────────────
function getWritingMode(lang) {
    if (state.languageConfigs && state.languageConfigs[lang]) {
        return state.languageConfigs[lang].writingMode;
    }
    // Fallback / Default
    const props = getLangProps(lang);
    return props.defaultWritingMode || 'horizontal-tb';
}

function getFontPreset(lang) {
    return getFontPresetFromConfigs(lang, state.languageConfigs);
}

function updateAuthUI() {
    const signedIn = !!state.uid;
    const authBtn = document.getElementById('btn-auth');
    const authBtnMobile = document.getElementById('btn-auth-mobile');
    const authStatus = document.getElementById('auth-status');
    const saveStatus = document.getElementById('save-status');

    if (authBtn) {
        authBtn.textContent = signedIn ? 'Sign out' : 'Sign in with Google';
        authBtn.title = signedIn ? 'ログアウト' : 'Googleでログイン';
    }
    if (authBtnMobile) {
        authBtnMobile.textContent = signedIn ? 'Sign out' : 'Sign in';
    }
    if (authStatus) {
        authStatus.textContent = signedIn
            ? `${state.user?.displayName || state.user?.email || 'Signed in'}`
            : 'ゲスト';
    }
    if (!signedIn && saveStatus && !saveStatus.textContent.trim()) {
        saveStatus.textContent = 'ログインでクラウド保存';
        saveStatus.style.color = '#8a5d00';
    }
    document.body.classList.toggle('auth-guest', !signedIn);
    document.querySelectorAll('[data-auth-required]').forEach((el) => {
        el.disabled = !signedIn;
        if (!signedIn) {
            el.title = 'ログインすると利用できます';
        }
    });
}

const THUMB_COLUMN_OPTIONS = [8, 5, 4, 2, 1];

function getDeviceKey() {
    return window.innerWidth < 1024 ? 'mobile' : 'desktop';
}

function sanitizeThumbColumns(value) {
    const n = Number(value);
    if (THUMB_COLUMN_OPTIONS.includes(n)) return n;
    return 2;
}

function ensureUiPrefs() {
    if (!state.uiPrefs || typeof state.uiPrefs !== 'object') {
        state.uiPrefs = {};
    }
    if (!state.uiPrefs.desktop || typeof state.uiPrefs.desktop !== 'object') {
        state.uiPrefs.desktop = {};
    }
    if (!state.uiPrefs.mobile || typeof state.uiPrefs.mobile !== 'object') {
        state.uiPrefs.mobile = {};
    }
    state.uiPrefs.desktop.thumbColumns = sanitizeThumbColumns(state.uiPrefs.desktop.thumbColumns);
    state.uiPrefs.mobile.thumbColumns = sanitizeThumbColumns(state.uiPrefs.mobile.thumbColumns);
}

function applyThumbColumnsFromPrefs() {
    ensureUiPrefs();
    const key = getDeviceKey();
    state.thumbColumns = sanitizeThumbColumns(state.uiPrefs[key].thumbColumns);
}

function syncThumbColumnButtons() {
    const active = sanitizeThumbColumns(state.thumbColumns);
    document.querySelectorAll('[data-thumb-cols]').forEach((btn) => {
        const isActive = Number(btn.dataset.thumbCols) === active;
        btn.classList.toggle('active', isActive);
    });
}

function setCurrentDeviceThumbColumns(cols) {
    ensureUiPrefs();
    const key = getDeviceKey();
    const normalized = sanitizeThumbColumns(cols);
    state.uiPrefs[key].thumbColumns = normalized;
    state.thumbColumns = normalized;
}

function inferRoleFromAnyPage(page) {
    if (page?.role) return page.role;
    const pt = page?.pageType;
    if (pt === 'cover_front') return 'cover_front';
    if (pt === 'cover_back') return 'cover_back';
    if (pt === 'chapter') return 'chapter';
    if (pt === 'section') return 'section';
    if (pt === 'item') return 'item';
    if (pt === 'toc') return 'toc';
    return 'normal';
}

function hasLocalizedValue(map, lang) {
    const v = map?.[lang];
    return typeof v === 'string' && v.trim().length > 0;
}

function isValidHttpUrl(value) {
    try {
        const u = new URL(String(value || ''));
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

let validationIssueStore = [];
let validationIssueFilter = 'all';
let validationIssueContextLabel = '公開';

function applyValidationIssueFilter(list, filter) {
    if (filter === 'cover_front') return list.filter((issue) => issue?.role === 'cover_front');
    if (filter === 'cover_back') return list.filter((issue) => issue?.role === 'cover_back');
    if (filter === 'structure') return list.filter((issue) => issue?.role === 'chapter' || issue?.role === 'section' || issue?.role === 'item');
    return list;
}

function renderValidationIssueList() {
    const listEl = document.getElementById('validation-issues');
    const summaryEl = document.getElementById('validation-summary');
    const filterEls = document.querySelectorAll('[data-validation-filter]');
    if (!listEl || !summaryEl) return;

    filterEls.forEach((el) => {
        el.classList.toggle('active', el.dataset.validationFilter === validationIssueFilter);
    });

    const all = Array.isArray(validationIssueStore) ? validationIssueStore : [];
    const filtered = applyValidationIssueFilter(all, validationIssueFilter);
    summaryEl.textContent = `${validationIssueContextLabel}できません。必須項目を入力してください（${filtered.length}/${all.length}件）。`;
    listEl.innerHTML = '';
    if (!filtered.length) {
        const note = document.createElement('div');
        note.className = 'validation-note';
        note.textContent = 'このフィルタに該当するエラーはありません。';
        listEl.appendChild(note);
        return;
    }

    filtered.slice(0, 300).forEach((issue, i) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'validation-issue';
        row.textContent = `P${(issue?.pageIdx ?? 0) + 1}: ${issue?.message || ''}`;
        row.onclick = () => jumpToValidationIssuePage(issue?.pageIdx ?? 0);
        listEl.appendChild(row);
        if (i === 0) {
            setTimeout(() => row.focus(), 0);
        }
    });
    if (filtered.length > 300) {
        const note = document.createElement('div');
        note.className = 'validation-note';
        note.textContent = `...他 ${filtered.length - 300} 件`;
        listEl.appendChild(note);
    }
}

function setValidationIssueFilter(filter) {
    validationIssueFilter = ['all', 'cover_front', 'cover_back', 'structure'].includes(filter) ? filter : 'all';
    renderValidationIssueList();
}

function validateProjectForPublishOrExport() {
    syncBlocksFromState();
    const pages = Array.isArray(state.pages) ? state.pages : [];
    const langs = Array.isArray(state.languages) && state.languages.length ? state.languages : ['ja'];
    const issues = [];

    const addIssue = (pageIdx, role, message) => {
        issues.push({ pageIdx, role, message });
    };

    for (let i = 0; i < pages.length; i += 1) {
        const p = pages[i];
        const role = inferRoleFromAnyPage(p);
        const meta = p?.meta || {};

        if (role === 'cover_front') {
            for (const lang of langs) {
                if (!hasLocalizedValue(meta.title, lang)) addIssue(i, role, `表紙 タイトル[${lang}] が未入力`);
                if (!hasLocalizedValue(meta.subtitle, lang)) addIssue(i, role, `表紙 サブタイトル[${lang}] が未入力`);
                if (!hasLocalizedValue(meta.author, lang)) addIssue(i, role, `表紙 著者名[${lang}] が未入力`);
                if (!hasLocalizedValue(meta.supervisor, lang)) addIssue(i, role, `表紙 監修者名[${lang}] が未入力`);
                if (!hasLocalizedValue(meta.publisher, lang)) addIssue(i, role, `表紙 出版社名[${lang}] が未入力`);
            }
        }

        if (role === 'cover_back') {
            for (const lang of langs) {
                if (!hasLocalizedValue(meta.edition, lang)) addIssue(i, role, `裏表紙 版[${lang}] が未入力`);
            }
            const contacts = Array.isArray(meta.contacts) ? meta.contacts : [];
            if (!contacts.length) {
                addIssue(i, role, '裏表紙 連絡先が未入力');
            } else {
                contacts.forEach((c, idx) => {
                    const type = c?.type || 'other';
                    const value = String(c?.value || '').trim();
                    if (!value) {
                        addIssue(i, role, `裏表紙 連絡先#${idx + 1} が未入力`);
                        return;
                    }
                    if (type === 'url' && !isValidHttpUrl(value)) {
                        addIssue(i, role, `裏表紙 連絡先#${idx + 1} URL形式が不正 (http/https必須)`);
                    }
                    if (type === 'email' && !isValidEmail(value)) {
                        addIssue(i, role, `裏表紙 連絡先#${idx + 1} メール形式が不正`);
                    }
                });
            }
        }

        if (role === 'chapter' || role === 'section' || role === 'item') {
            for (const lang of langs) {
                if (!hasLocalizedValue(meta.title, lang)) {
                    const label = role === 'chapter' ? '章' : (role === 'section' ? '節' : '項');
                    addIssue(i, role, `${label} タイトル[${lang}] が未入力`);
                }
            }
        }
    }

    return {
        ok: issues.length === 0,
        issues
    };
}

function jumpToValidationIssuePage(pageIdx) {
    const pages = Array.isArray(state.pages) ? state.pages : [];
    if (!pages.length) return;
    const idx = Math.max(0, Math.min(Number(pageIdx) || 0, pages.length - 1));
    state.activeIdx = idx;
    state.activePageIdx = idx;
    const blockIdx = getBlockIndexFromPageIndex(state.blocks || [], idx);
    if (blockIdx >= 0) state.activeBlockIdx = blockIdx;
    state.activeBubbleIdx = null;
    closePublishValidationModal();
    refresh();
    const thumbEl = getThumbElement(idx);
    if (thumbEl) thumbEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function closePublishValidationModal() {
    const modal = document.getElementById('validation-modal');
    if (!modal) return;
    modal.classList.remove('visible');
}

function showPublishValidationErrors(issues, contextLabel) {
    const list = Array.isArray(issues) ? issues : [];
    const modal = document.getElementById('validation-modal');
    const summaryEl = document.getElementById('validation-summary');
    const listEl = document.getElementById('validation-issues');
    const filterWrap = document.getElementById('validation-filters');

    if (modal && summaryEl && listEl && filterWrap) {
        validationIssueStore = list.map((issue) => ({
            pageIdx: issue?.pageIdx ?? 0,
            role: issue?.role || 'other',
            message: issue?.message || ''
        }));
        validationIssueContextLabel = contextLabel;
        validationIssueFilter = 'all';
        renderValidationIssueList();
        modal.classList.add('visible');
        return;
    }

    const lines = [
        `${contextLabel}できません。`,
        '必須項目を入力してください:',
        ...list.slice(0, 60).map((issue) => `P${(issue?.pageIdx ?? 0) + 1}: ${issue?.message || ''}`)
    ];
    if (list.length > 60) {
        lines.push(`...他 ${list.length - 60} 件`);
    }
    alert(lines.join('\n'));
}

// ──────────────────────────────────────
//  refresh — 画面全体を再描画する
// ──────────────────────────────────────
function refresh() {
    populateThemeSelectOptions();
    syncBlocksFromState();
    const activeBlock = getActiveBlock();
    const isPageBlock = activeBlock?.kind === 'page';
    const s = state.sections[state.activeIdx];
    const render = document.getElementById('content-render');
    const lang = state.activeLang;
    const langProps = getLangProps(lang);

    // Global Writing Mode
    const effectiveMode = getWritingMode(lang);

    // メインキャンバスの描画切り替え
    if (!isPageBlock) {
        const labels = {
            cover_front: '表紙ブロック',
            cover_back: '裏表紙ブロック',
            chapter: '章ブロック',
            section: '節ブロック',
            item: '項ブロック',
            item_end: '項終了ブロック',
            toc: '目次ブロック'
        };
        const label = labels[activeBlock?.kind] || (activeBlock?.kind || 'ブロック');
        const text = getBlockLocalizedText(activeBlock);
        const isCover = activeBlock?.kind === 'cover_front' || activeBlock?.kind === 'cover_back';
        const coverBodyKind = getCoverBodyKindFromBlock(activeBlock);
        if (isCover && coverBodyKind === 'theme') {
            render.innerHTML = renderCoverThemePreview(activeBlock);
        } else if (isCover && coverBodyKind === 'image') {
            render.innerHTML = renderCoverImagePreview(activeBlock);
        } else if (activeBlock?.kind === 'toc') {
            render.innerHTML = renderTocPreview(activeBlock);
        } else if (isStructureKind(activeBlock?.kind) && getStructureBodyKind(activeBlock) === 'image') {
            const bg = activeBlock?.content?.background || '';
            if (bg) {
                render.innerHTML = `
                    <div style="position:absolute; left:20px; top:32px; width:320px; height:576px; overflow:hidden; border-radius:8px; border:1px solid #d7deea;">
                        <img src="${bg}" style="width:100%; height:100%; object-fit:cover;">
                        <div style="position:absolute; left:12px; right:12px; bottom:12px; background:rgba(0,0,0,.45); color:#fff; border-radius:8px; padding:8px 10px;">
                            <div style="font-size:11px; opacity:.85;">${label}</div>
                            <div style="font-size:20px; font-weight:700; line-height:1.35; white-space:normal; overflow-wrap:anywhere; word-break:break-word;">${text || ''}</div>
                        </div>
                    </div>
                `;
            } else {
                render.innerHTML = `
                    <div class="fixed-text-frame" style="position:absolute; left:20px; top:32px; width:320px; height:576px; display:flex; align-items:center; justify-content:center; border:2px dashed #cfd7e3; background:#f8fafc; color:#2f3e52; padding:20px; text-align:center;">
                        <div>
                            <div style="font-size:12px; margin-bottom:8px;">${label}</div>
                            <div style="font-size:14px; font-weight:700;">画像を設定してください</div>
                        </div>
                    </div>
                `;
            }
        } else if (isStructureKind(activeBlock?.kind) && getStructureBodyKind(activeBlock) === 'text') {
            const body = getStructureBodyText(activeBlock);
            render.innerHTML = `
                <div class="fixed-text-frame" style="position:absolute; left:20px; top:32px; width:320px; height:576px; border:2px solid #d8e0ec; border-radius:8px; background:#f9fbff; color:#22314a; padding:20px;">
                    <div style="font-size:11px; color:#6a7b96; margin-bottom:8px;">${label}</div>
                    <div style="font-size:26px; font-weight:800; line-height:1.3; margin-bottom:16px; white-space:normal; overflow-wrap:anywhere; word-break:break-word;">${text || ''}</div>
                    <div style="font-size:15px; line-height:1.7; color:#334b6d; white-space:pre-wrap;">${body || ''}</div>
                </div>
            `;
        } else {
            render.innerHTML = `
            <div class="fixed-text-frame" style="position:absolute; left:20px; top:32px; width:320px; height:576px; display:flex; align-items:center; justify-content:center; border:2px dashed #cfd7e3; background:#f8fafc; color:#2f3e52; padding:20px; text-align:center;">
                <div>
                    <div style="font-size:12px; margin-bottom:8px;">${label}</div>
                    <div style="font-size:14px; font-weight:700;">${text || '右パネルのテキスト入力で編集'}</div>
                </div>
            </div>
        `;
        }
        document.getElementById('image-only-props').style.display = 'none';
        document.getElementById('bubble-layer').style.display = 'none';
        document.getElementById('bubble-shape-props').style.display = 'none';
    } else if (s.type === 'image') {
        if (!s.imagePosition) s.imagePosition = {};
        const toNum = (v, fallback) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : fallback;
        };
        s.imagePosition.x = toNum(s.imagePosition.x, 0);
        s.imagePosition.y = toNum(s.imagePosition.y, 0);
        s.imagePosition.scale = Math.max(0.1, toNum(s.imagePosition.scale, 1));
        s.imagePosition.rotation = toNum(s.imagePosition.rotation, 0);
        const pos = s.imagePosition;
        if (!s.imageBasePosition) {
            s.imageBasePosition = { x: 0, y: 0, scale: 1, rotation: 0 };
        }
        // 画像自体にtransformを適用。
        // object-fit: cover とバッティングしないよう、width/heightを維持しつつCSS transformで動かす
        // ただし cover だと中心基準で切り取られるため、transform translate は中心からのオフセットとして機能する。
        // これで直感的な挙動になるはず。
        const targetStyle = `transform: translate(${pos.x}px, ${pos.y}px) scale(${pos.scale}) rotate(${pos.rotation}deg);`;

        const invScale = 1 / Math.max(pos.scale || 1, 0.1);

        const overlayInTarget = isImageAdjusting ? `
            <div id="image-adjust-overlay" style="--inv-handle-scale:${invScale};">
                <div class="adjust-frame"></div>
                <button class="img-handle corner nw" onmousedown="startImageHandleDrag(event, 'nw')" ontouchstart="startImageHandleDrag(event, 'nw')" title="左上ハンドル"></button>
                <button class="img-handle corner ne" onmousedown="startImageHandleDrag(event, 'ne')" ontouchstart="startImageHandleDrag(event, 'ne')" title="右上ハンドル"></button>
                <button class="img-handle corner sw" onmousedown="startImageHandleDrag(event, 'sw')" ontouchstart="startImageHandleDrag(event, 'sw')" title="左下ハンドル"></button>
                <button class="img-handle corner se" onmousedown="startImageHandleDrag(event, 'se')" ontouchstart="startImageHandleDrag(event, 'se')" title="右下ハンドル"></button>
                <button class="img-handle rotate" onmousedown="startImageHandleDrag(event, 'rotate')" ontouchstart="startImageHandleDrag(event, 'rotate')" title="回転ハンドル">⟳</button>
            </div>
        ` : '';

        render.innerHTML = `
            <div id="image-adjust-stage">
                <div id="image-adjust-target" style="${targetStyle}">
                    <img id="main-img" src="${s.background}">
                    ${overlayInTarget}
                </div>
            </div>`;
        document.getElementById('image-only-props').style.display = 'block';
        document.getElementById('bubble-layer').style.display = 'block';
    } else {
        const layout = ensureComposedLayoutForActiveLang(s);
        const sectionText = (layout?.lines || []).join('\n');
        const vtClass = effectiveMode === 'vertical-rl' ? 'v-text' : '';
        const align = langProps.sectionAlign;
        const frame = layout?.frame || { x: 20, y: 32, w: 320, h: 576 };
        const font = layout?.font || {};
        const family = font.family || '"Noto Sans","Segoe UI",sans-serif';
        const size = Number(font.size) || 16;
        const lineHeight = Number(font.lineHeight) || 1.8;
        const letterSpacing = Number.isFinite(Number(font.letterSpacing)) ? Number(font.letterSpacing) : 0;
        const verticalPad = getVerticalTextPadding(layout);

        // フォーカス維持判定
        const existing = document.getElementById('main-text-area');
        if (existing && document.activeElement === existing) {
            if (existing.value !== sectionText) existing.value = sectionText;
        } else {
            render.innerHTML = `<div class="fixed-text-frame"
                style="position:absolute; left:${frame.x}px; top:${frame.y}px; width:${frame.w}px; height:${frame.h}px; overflow:hidden;">
                <textarea id="main-text-area" class="text-layer ${vtClass}" wrap="off"
                    style="width:100%; height:100%; padding:${verticalPad}px 0; background:transparent; text-align:${align}; white-space:pre; word-break:normal; overflow-wrap:normal; overflow:hidden; font-family:${family}; font-size:${size}px; line-height:${lineHeight}; letter-spacing:${letterSpacing}px;"
                    onmousedown="event.stopPropagation()"
                    onclick="event.stopPropagation()"
                    ontouchstart="event.stopPropagation()"
                    oninput="updateActiveText(this.value, event)">${sectionText}</textarea>
            </div>`;
        }
        document.getElementById('image-only-props').style.display = 'none';
        document.getElementById('bubble-layer').style.display = 'none';
        document.getElementById('bubble-shape-props').style.display = 'none';
    }

    // 吹き出し描画
    const editingEl = document.activeElement;
    const isDirectEditing = editingEl && editingEl.classList.contains('bubble-text')
        && editingEl.getAttribute('contenteditable') === 'true';

    if (isPageBlock && !isDirectEditing && s.type !== 'text') {
        document.getElementById('bubble-layer').innerHTML = (s.bubbles || []).map((b, i) =>
            renderBubbleHTML(b, i, i === state.activeBubbleIdx, effectiveMode) // Pass effectiveMode
        ).join('');
    } else if (!isPageBlock) {
        document.getElementById('bubble-layer').innerHTML = '';
    }

    // activeBubbleIdxが無効な場合はリセット
    if (isPageBlock && state.activeBubbleIdx !== null && (!s.bubbles || !s.bubbles[state.activeBubbleIdx])) {
        state.activeBubbleIdx = null;
    }

    // パネルUIの同期
    const propType = document.getElementById('prop-type');
    if (propType) {
        if (isPageBlock) {
            propType.disabled = false;
            propType.value = s.type;
        } else {
            propType.disabled = true;
        }
    }
    const pageLockNote = document.getElementById('page-lock-note');
    const deleteBtn = document.getElementById('btn-delete-active');
    const isLocked = isLockedBlock(activeBlock);
    if (pageLockNote) {
        if (activeBlock?.kind === 'cover_front' || activeBlock?.kind === 'cover_back') {
            pageLockNote.style.display = 'block';
            pageLockNote.textContent = 'このページは固定です: 位置変更・削除・role変更はできません。';
        } else if (isAutoTocBlock(activeBlock)) {
            pageLockNote.style.display = 'block';
            pageLockNote.textContent = 'この目次ページは自動生成です: 編集・削除はできません。';
        } else {
            pageLockNote.style.display = 'none';
            pageLockNote.textContent = '';
        }
    }
    if (deleteBtn) {
        deleteBtn.disabled = !!isLocked;
        deleteBtn.title = isLocked
            ? (isAutoTocBlock(activeBlock) ? '自動生成目次ページは削除できません' : '表紙/裏表紙は削除できません')
            : '';
    }
    const genericTextEditor = document.getElementById('generic-text-editor');
    const coverFrontFields = document.getElementById('cover-front-fields');
    const coverBackFields = document.getElementById('cover-back-fields');
    const structureFields = document.getElementById('structure-fields');
    const structureImageFields = document.getElementById('structure-image-fields');
    const structureTextFields = document.getElementById('structure-text-fields');
    const coverFrontImageFields = document.getElementById('cover-front-image-fields');
    const coverBackImageFields = document.getElementById('cover-back-image-fields');
    const isCoverFront = activeBlock?.kind === 'cover_front';
    const isCoverBack = activeBlock?.kind === 'cover_back';
    const isStructureBlock = isStructureKind(activeBlock?.kind);
    if (coverFrontFields) coverFrontFields.style.display = isCoverFront ? 'block' : 'none';
    if (coverBackFields) coverBackFields.style.display = isCoverBack ? 'block' : 'none';
    if (structureFields) structureFields.style.display = isStructureBlock ? 'block' : 'none';
    if (genericTextEditor) genericTextEditor.style.display = (isCoverFront || isCoverBack || isStructureBlock) ? 'none' : 'block';

    if (isCoverFront) {
        const bodyKind = getCoverBodyKind(activeBlock);
        const modeEl = document.getElementById('cover-front-body-kind');
        if (modeEl && document.activeElement !== modeEl) {
            modeEl.value = bodyKind;
        }
        const frontThemeFields = document.getElementById('cover-front-theme-fields');
        if (frontThemeFields) frontThemeFields.style.display = bodyKind === 'theme' ? 'block' : 'none';
        if (coverFrontImageFields) coverFrontImageFields.style.display = bodyKind === 'image' ? 'block' : 'none';
        const theme = ensureCoverTheme(activeBlock);
        const tplEl = document.getElementById('cover-front-theme-template');
        const palEl = document.getElementById('cover-front-theme-palette');
        if (tplEl && document.activeElement !== tplEl) tplEl.value = theme.templateId || 'classic';
        if (palEl && document.activeElement !== palEl) palEl.value = theme.paletteId || 'ocean';

        const mapping = [
            ['cover-front-title', 'title'],
            ['cover-front-subtitle', 'subtitle'],
            ['cover-front-author', 'author'],
            ['cover-front-supervisor', 'supervisor'],
            ['cover-front-publisher', 'publisher']
        ];
        mapping.forEach(([id, key]) => {
            const el = document.getElementById(id);
            if (!el || document.activeElement === el) return;
            el.value = getBlockLocalizedMetaField(activeBlock, key);
        });
    } else if (isCoverBack) {
        const bodyKind = getCoverBodyKind(activeBlock);
        const modeEl = document.getElementById('cover-back-body-kind');
        if (modeEl && document.activeElement !== modeEl) {
            modeEl.value = bodyKind;
        }
        const backThemeFields = document.getElementById('cover-back-theme-fields');
        if (backThemeFields) backThemeFields.style.display = bodyKind === 'theme' ? 'block' : 'none';
        if (coverBackImageFields) coverBackImageFields.style.display = bodyKind === 'image' ? 'block' : 'none';
        const theme = ensureCoverTheme(activeBlock);
        const tplEl = document.getElementById('cover-back-theme-template');
        const palEl = document.getElementById('cover-back-theme-palette');
        if (tplEl && document.activeElement !== tplEl) tplEl.value = theme.templateId || 'classic';
        if (palEl && document.activeElement !== palEl) palEl.value = theme.paletteId || 'ocean';

        const editionEl = document.getElementById('cover-back-edition');
        const contactsEl = document.getElementById('cover-back-contacts');
        if (editionEl && document.activeElement !== editionEl) {
            editionEl.value = getBlockLocalizedMetaField(activeBlock, 'edition');
        }
        if (contactsEl && document.activeElement !== contactsEl) {
            const contacts = Array.isArray(activeBlock?.meta?.contacts) ? activeBlock.meta.contacts : [];
            contactsEl.value = contacts.map((c) => c?.value || '').filter(Boolean).join('\n');
        }
    } else if (isStructureBlock) {
        const bodyKind = getStructureBodyKind(activeBlock);
        const titleEl = document.getElementById('structure-title');
        const modeEl = document.getElementById('structure-body-kind');
        if (titleEl && document.activeElement !== titleEl) titleEl.value = getStructureTitle(activeBlock);
        if (modeEl && document.activeElement !== modeEl) modeEl.value = bodyKind;
        if (structureImageFields) structureImageFields.style.display = bodyKind === 'image' ? 'block' : 'none';
        if (structureTextFields) structureTextFields.style.display = bodyKind === 'text' ? 'block' : 'none';
        const bodyEl = document.getElementById('structure-body-text');
        if (bodyEl && document.activeElement !== bodyEl) bodyEl.value = getStructureBodyText(activeBlock);
    }
    if (!isCoverFront && coverFrontImageFields) coverFrontImageFields.style.display = 'none';
    if (!isCoverBack && coverBackImageFields) coverBackImageFields.style.display = 'none';
    if (!isStructureBlock && structureImageFields) structureImageFields.style.display = 'none';
    if (!isStructureBlock && structureTextFields) structureTextFields.style.display = 'none';

    // 言語設定パネル内の書字方向同期
    const langModeSelect = document.getElementById('lang-writing-mode');
    if (langModeSelect) {
        langModeSelect.value = effectiveMode;
        // 言語が縦書き非対応なら無効化などの制御も可能だが、
        // lang.js の writingModes に従うべき
        const allowed = langProps.writingModes;
        Array.from(langModeSelect.options).forEach(opt => {
            opt.disabled = !allowed.includes(opt.value);
        });
    }

    const langFontSelect = document.getElementById('lang-font-preset');
    if (langFontSelect) {
        const current = getFontPreset(lang);
        const options = getFontPresetOptions();
        langFontSelect.innerHTML = options.map((opt) =>
            `<option value="${opt.value}">${opt.label}</option>`
        ).join('');
        langFontSelect.value = current;
    }

    // テキストエリア: 言語に応じたテキストを表示
    const propTextEl = document.getElementById('prop-text');
    if (isPageBlock && state.activeBubbleIdx !== null && s.bubbles[state.activeBubbleIdx]) {
        propTextEl.value = getBubbleText(s.bubbles[state.activeBubbleIdx]);
    } else if (isPageBlock) {
        propTextEl.value = getSectionText(s);
    } else {
        propTextEl.value = getBlockLocalizedText(activeBlock);
    }
    if (propTextEl) {
        propTextEl.readOnly = isAutoTocBlock(activeBlock);
    }
    updateTextFitStatus(isPageBlock ? s : null);

    // テキストラベルに現在の言語を表示
    const textLabel = document.getElementById('text-label');
    if (textLabel) {
        const label = isPageBlock
            ? `テキスト入力 [${langProps.label}]`
            : `ブロックテキスト [${langProps.label}]`;
        textLabel.textContent = label;
    }

    // 吹き出し形状セレクタの同期
    const shapeProps = document.getElementById('bubble-shape-props');
    const shapeSelect = document.getElementById('prop-shape');
    if (isPageBlock && state.activeBubbleIdx !== null && s.bubbles[state.activeBubbleIdx]) {
        shapeProps.style.display = 'block';
        shapeSelect.value = s.bubbles[state.activeBubbleIdx].shape || 'speech';
    } else {
        shapeProps.style.display = 'none';
    }

    // プロジェクト名表示
    const titleEl = document.getElementById('project-title');
    if (titleEl && document.activeElement !== titleEl) {
        titleEl.textContent = state.projectId || '新規プロジェクト';
    }

    // 作品タイトル同期
    const propTitle = document.getElementById('prop-title');
    if (propTitle && document.activeElement !== propTitle) {
        propTitle.value = state.title || '';
    }
    // ヘッダーガイドにタイトル表示
    const headerGuideTitle = document.getElementById('header-guide-title');
    if (headerGuideTitle) {
        headerGuideTitle.textContent = state.title || 'タイトル未設定';
    }

    // 言語タブの更新
    renderLangTabs();

    updateHistoryButtons();
    renderThumbs();
    syncThumbColumnButtons();
}

// ──────────────────────────────────────
//  言語UI
// ──────────────────────────────────────
function renderLangTabs() {
    const html = state.languages.map(code => {
        const props = getLangProps(code);
        const active = code === state.activeLang ? 'active' : '';
        return `<button class="lang-tab ${active}" onclick="switchLang('${code}')">${props.label}</button>`;
    }).join('');
    ['lang-tabs', 'lang-tabs-project', 'lang-tabs-mobile'].forEach((id) => {
        const container = document.getElementById(id);
        if (container) container.innerHTML = html;
    });
}

function renderLangSettings() {
    const list = document.getElementById('lang-list');
    if (!list) return;
    list.innerHTML = state.languages.map(code => {
        const props = getLangProps(code);
        const canRemove = state.languages.length > 1;
        const removeBtn = canRemove
            ? `<button class="btn-sm" onclick="removeLang('${code}')">✕</button>`
            : '';
        return `<div class="lang-item"><span>${props.label}</span>${removeBtn}</div>`;
    }).join('');
}

// ──────────────────────────────────────
//  Undo/Redoボタンの有効/無効を更新
// ──────────────────────────────────────
function updateHistoryButtons() {
    const info = getHistoryInfo();
    const undoBtn = document.getElementById('btn-undo');
    const redoBtn = document.getElementById('btn-redo');
    if (undoBtn) undoBtn.disabled = !info.canUndo;
    if (redoBtn) redoBtn.disabled = !info.canRedo;
}

let thumbDragSourceIdx = null;
let thumbTouchState = null;
let suppressThumbClickUntil = 0;

function clearThumbDropHints() {
    document.querySelectorAll('.thumb-wrap').forEach((el) => {
        el.classList.remove('drop-before', 'drop-after', 'drag-source');
    });
}

function getThumbElement(index) {
    return document.querySelector(`.thumb-wrap[data-section-index="${index}"]`);
}

function markThumbDropHint(index, position) {
    clearThumbDropHints();
    const sourceEl = getThumbElement(thumbDragSourceIdx);
    if (sourceEl) sourceEl.classList.add('drag-source');
    const el = getThumbElement(index);
    if (!el) return;
    el.classList.add(position === 'before' ? 'drop-before' : 'drop-after');
}

function getDropPositionByPoint(el, clientY) {
    const rect = el.getBoundingClientRect();
    return clientY < (rect.top + rect.height / 2) ? 'before' : 'after';
}

function moveSectionWithHistory(fromIndex, targetIndex, position) {
    const insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
    const from = Number(fromIndex);
    let to = Math.max(0, Math.min(insertIndex, state.sections.length));
    if (to === from || to === from + 1) return false;
    pushState();
    moveSection(from, to, refresh);
    triggerAutoSave();
    return true;
}

function bindTouchDragListeners() {
    document.addEventListener('touchmove', onThumbTouchMove, { passive: false });
    document.addEventListener('touchend', onThumbTouchEnd, { passive: false });
    document.addEventListener('touchcancel', onThumbTouchCancel, { passive: false });
}

function unbindTouchDragListeners() {
    document.removeEventListener('touchmove', onThumbTouchMove);
    document.removeEventListener('touchend', onThumbTouchEnd);
    document.removeEventListener('touchcancel', onThumbTouchCancel);
}

function onThumbTouchMove(e) {
    if (!thumbTouchState) return;
    const touch = e.touches && e.touches[0];
    if (!touch) return;

    const dx = touch.clientX - thumbTouchState.startX;
    const dy = touch.clientY - thumbTouchState.startY;

    if (!thumbTouchState.active && Math.hypot(dx, dy) > 10) {
        clearTimeout(thumbTouchState.timerId);
        thumbTouchState.timerId = null;
        thumbTouchState = null;
        unbindTouchDragListeners();
        clearThumbDropHints();
        return;
    }

    if (!thumbTouchState.active) return;

    e.preventDefault();
    const hit = document.elementFromPoint(touch.clientX, touch.clientY);
    const wrap = hit ? hit.closest('.thumb-wrap') : null;
    if (!wrap) return;

    const targetIndex = Number(wrap.dataset.sectionIndex);
    if (!Number.isInteger(targetIndex)) return;
    const position = getDropPositionByPoint(wrap, touch.clientY);
    thumbTouchState.targetIndex = targetIndex;
    thumbTouchState.position = position;
    markThumbDropHint(targetIndex, position);

    const container = document.getElementById('thumb-container');
    if (container) {
        const cRect = container.getBoundingClientRect();
        if (touch.clientY < cRect.top + 40) container.scrollBy({ top: -20, behavior: 'auto' });
        if (touch.clientY > cRect.bottom - 40) container.scrollBy({ top: 20, behavior: 'auto' });
    }
}

function onThumbTouchEnd() {
    if (!thumbTouchState) return;
    clearTimeout(thumbTouchState.timerId);
    if (thumbTouchState.active && Number.isInteger(thumbTouchState.targetIndex)) {
        moveSectionWithHistory(thumbTouchState.sourceIndex, thumbTouchState.targetIndex, thumbTouchState.position || 'after');
        suppressThumbClickUntil = Date.now() + 350;
    }
    thumbTouchState = null;
    unbindTouchDragListeners();
    clearThumbDropHints();
    thumbDragSourceIdx = null;
}

function onThumbTouchCancel() {
    if (!thumbTouchState) return;
    clearTimeout(thumbTouchState.timerId);
    thumbTouchState = null;
    unbindTouchDragListeners();
    clearThumbDropHints();
    thumbDragSourceIdx = null;
}

// ──────────────────────────────────────
//  セクションプロパティ更新
// ──────────────────────────────────────
function update(k, v) {
    const activeBlock = getActiveBlock();
    if (activeBlock && activeBlock.kind !== 'page') {
        return;
    }
    const s = state.sections[state.activeIdx];
    if (k === 'type' && v === 'text' && s.bubbles && s.bubbles.length > 0) {
        const ok = confirm(`このセクションには${s.bubbles.length}個の吹き出しがあります。\nテキストセクションに切り替えると吹き出しは削除されます。\nよろしいですか？`);
        if (!ok) {
            document.getElementById('prop-type').value = s.type;
            return;
        }
        pushState();
        s.bubbles = [];
        state.activeBubbleIdx = null;
    } else {
        pushState();
    }
    s[k] = v;
    refresh();
    s[k] = v;
    refresh();
    triggerAutoSave();
}

// ──────────────────────────────────────
//  背景画像調整モード
// ──────────────────────────────────────
let isImageAdjusting = false;
let mobileAdjustViewBackup = null;
let imageHandleDrag = null;

function calcMobileAdjustScale(pos) {
    const view = document.getElementById('canvas-view');
    if (!view) return 0.6;
    const cw = view.clientWidth || 360;
    const ch = view.clientHeight || 640;
    const visibilityFactor = Math.max(
        1,
        pos?.scale || 1,
        1 + Math.abs(pos?.x || 0) / 180,
        1 + Math.abs(pos?.y || 0) / 320
    );
    const needW = 360 * visibilityFactor;
    const needH = 640 * visibilityFactor;
    const s = Math.min(cw / needW, ch / needH) * 0.82;
    return Math.min(Math.max(s, 0.22), 0.9);
}

function getActiveImagePosition() {
    const s = state.sections[state.activeIdx];
    if (!s || s.type !== 'image') return null;
    if (!s.imagePosition) s.imagePosition = {};
    const toNum = (v, fallback) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    };
    s.imagePosition.x = toNum(s.imagePosition.x, 0);
    s.imagePosition.y = toNum(s.imagePosition.y, 0);
    s.imagePosition.scale = Math.max(0.1, toNum(s.imagePosition.scale, 1));
    s.imagePosition.rotation = toNum(s.imagePosition.rotation, 0);
    if (!s.imageBasePosition) s.imageBasePosition = { x: 0, y: 0, scale: 1, rotation: 0 };
    return s.imagePosition;
}

function getPointerClientPoint(e) {
    if (e.touches && e.touches[0]) {
        return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
}

window.adjustImageZoom = (delta) => {
    const pos = getActiveImagePosition();
    if (!isImageAdjusting || !pos) return;
    pushState();
    pos.scale = Math.max(0.1, pos.scale + delta);
    refresh();
    triggerAutoSave();
};

window.resetImageTransform = () => {
    const s = state.sections[state.activeIdx];
    const pos = getActiveImagePosition();
    if (!isImageAdjusting || !s || !pos) return;
    const base = s.imageBasePosition || { x: 0, y: 0, scale: 1, rotation: 0 };
    pushState();
    pos.x = base.x || 0;
    pos.y = base.y || 0;
    pos.scale = base.scale || 1;
    pos.rotation = base.rotation || 0;
    refresh();
    triggerAutoSave();
};

window.startImageHandleDrag = (e, handleType) => {
    if (!isImageAdjusting) return;
    e.preventDefault();
    e.stopPropagation();
    const pos = getActiveImagePosition();
    if (!pos) return;

    const p = getPointerClientPoint(e);
    const target = document.getElementById('image-adjust-target') || document.getElementById('canvas-transform-layer');
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    imageHandleDrag = {
        handleType,
        startPoint: p,
        center: { x: cx, y: cy },
        base: {
            x: pos.x,
            y: pos.y,
            scale: pos.scale,
            rotation: pos.rotation || 0
        },
        startAngle: Math.atan2(p.y - cy, p.x - cx),
        startDist: Math.hypot(p.x - cx, p.y - cy) || 1
    };
    pushState();
};

function onImageHandleDragMove(e) {
    if (!isImageAdjusting || !imageHandleDrag) return;
    const pos = getActiveImagePosition();
    if (!pos) return;

    const p = getPointerClientPoint(e);
    const dx = p.x - imageHandleDrag.startPoint.x;
    const dy = p.y - imageHandleDrag.startPoint.y;

    if (imageHandleDrag.handleType === 'rotate') {
        const currentAngle = Math.atan2(p.y - imageHandleDrag.center.y, p.x - imageHandleDrag.center.x);
        const deltaDeg = (currentAngle - imageHandleDrag.startAngle) * (180 / Math.PI);
        pos.rotation = imageHandleDrag.base.rotation + deltaDeg;
    } else {
        const currentDist = Math.hypot(p.x - imageHandleDrag.center.x, p.y - imageHandleDrag.center.y) || 1;
        const ratio = currentDist / imageHandleDrag.startDist;
        pos.scale = Math.max(0.1, imageHandleDrag.base.scale * ratio);
        pos.x = imageHandleDrag.base.x + dx / (2 * canvasScale);
        pos.y = imageHandleDrag.base.y + dy / (2 * canvasScale);
    }
    refresh();
}

function onImageHandleDragEnd() {
    if (!imageHandleDrag) return;
    imageHandleDrag = null;
    const s = state.sections[state.activeIdx];
    if (s && s.background && state.uid) {
        generateCroppedThumbnail(
            s.background,
            s.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 },
            refresh
        ).catch(() => { });
    }
    triggerAutoSave();
}

window.toggleImageAdjustment = () => {
    const s = state.sections[state.activeIdx];
    if (!s || s.type !== 'image') return;

    isImageAdjusting = !isImageAdjusting;

    // UI更新
    ['btn-adjust-img', 'btn-adjust-img-panel'].forEach((id) => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.style.background = isImageAdjusting ? 'var(--primary)' : '#fff';
            btn.style.color = isImageAdjusting ? '#fff' : '#333';
        }
    });

    // クロップ枠外のグレーアウト表示切り替え
    const layer = document.getElementById('canvas-transform-layer');
    if (layer) {
        if (isImageAdjusting) {
            layer.classList.add('adjust-image-mode');
        } else {
            layer.classList.remove('adjust-image-mode');
        }
    }
    const bubbleLayer = document.getElementById('bubble-layer');
    if (bubbleLayer) {
        bubbleLayer.style.pointerEvents = isImageAdjusting ? 'none' : '';
    }
    const floatingControls = document.getElementById('image-zoom-controls-floating');
    if (floatingControls) {
        floatingControls.classList.toggle('visible', isImageAdjusting);
    }

    const isMobile = window.innerWidth < 1024;
    if (isMobile && isImageAdjusting) {
        if (typeof window.closeMobileSheet === 'function') {
            window.closeMobileSheet();
        }
        mobileAdjustViewBackup = {
            scale: canvasScale,
            translate: { ...canvasTranslate }
        };
        const pos = s.imagePosition || { x: 0, y: 0, scale: 1 };
        canvasScale = calcMobileAdjustScale(pos);
        canvasTranslate = { x: 0, y: 0 };
        updateCanvasTransform();
        document.body.classList.add('image-adjusting-mobile');
    } else if (isMobile && !isImageAdjusting) {
        if (mobileAdjustViewBackup) {
            canvasScale = mobileAdjustViewBackup.scale;
            canvasTranslate = { ...mobileAdjustViewBackup.translate };
            updateCanvasTransform();
        }
        mobileAdjustViewBackup = null;
        document.body.classList.remove('image-adjusting-mobile');
    }

    // ガイド表示などの視覚的フィードバック
    const imgInfo = document.getElementById('text-label');
    if (imgInfo) {
        imgInfo.textContent = isImageAdjusting ? "画像をドラッグ/ピンチして調整" : "テキスト入力";
    }

    // 調整モード終了時に値を確定して保存＋サムネイル再生成
    if (!isImageAdjusting) {
        triggerAutoSave();
        // サムネイル更新
        if (s.background && state.uid) {
            generateCroppedThumbnail(
                s.background,
                s.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 },
                refresh
            ).catch(() => { });
        }
    }
};

// 画像操作イベントリスナー
function initImageAdjustment() {
    const view = document.getElementById('canvas-view');
    // We bind events to view but check target or mode

    let isDraggingImg = false;
    let startPos = { x: 0, y: 0 };
    let startTransform = { x: 0, y: 0 };
    let startScale = 1;
    let initialPinchDist = null;

    // Helper to get image transform state
    const getImgState = () => {
        const s = state.sections[state.activeIdx];
        if (!s.imagePosition) s.imagePosition = { x: 0, y: 0, scale: 1 };
        return s.imagePosition;
    };

    // Events
    const onStart = (clientX, clientY) => {
        if (!isImageAdjusting) return;
        isDraggingImg = true;
        startPos = { x: clientX, y: clientY };
        const pos = getImgState();
        startTransform = { x: pos.x, y: pos.y };
    };

    const onMove = (clientX, clientY) => {
        if (!isImageAdjusting || !isDraggingImg) return;
        const dx = clientX - startPos.x;
        const dy = clientY - startPos.y;

        // Canvasのズームレベルを考慮して移動量を補正
        // canvasScale is global from initCanvasZoom scope... wait, we need access to it.
        // It's defined below. We might need to move this logic or access it.
        // For now, let's assume we can access 'canvasScale' variable if it's in outer scope or module scope.
        // Actually canvasScale is defined in outer scope in this file. Good.

        const pos = getImgState();
        pos.x = startTransform.x + dx / canvasScale;
        pos.y = startTransform.y + dy / canvasScale;

        refresh(); // Re-render transform
    };

    const onEnd = () => {
        if (isDraggingImg) {
            isDraggingImg = false;
            const s = state.sections[state.activeIdx];
            if (s && s.background && state.uid) {
                generateCroppedThumbnail(
                    s.background,
                    s.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 },
                    refresh
                ).catch(() => { });
            }
            triggerAutoSave();
        }
    };

    // Mouse
    view.addEventListener('mousedown', (e) => {
        const inAdjustTarget = !!(e.target && e.target.closest && e.target.closest('#image-adjust-target'));
        if (isImageAdjusting && (e.target.id === 'main-img' || inAdjustTarget)) {
            e.stopPropagation(); // Stop canvas pan
            e.preventDefault();
            onStart(e.clientX, e.clientY);
        }
    });
    window.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('mousemove', onImageHandleDragMove);
    window.addEventListener('mouseup', onImageHandleDragEnd);

    // Touch
    view.addEventListener('touchstart', (e) => {
        const inAdjustTarget = !!(e.target && e.target.closest && e.target.closest('#image-adjust-target'));
        if (isImageAdjusting && (e.target.id === 'main-img' || inAdjustTarget || e.touches.length === 2)) {
            e.stopPropagation();
            if (e.touches.length === 1) {
                onStart(e.touches[0].clientX, e.touches[0].clientY);
            } else if (e.touches.length === 2) {
                // Pinch start
                isDraggingImg = false; // Cancel drag
                const dist = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                initialPinchDist = dist;
                const pos = getImgState();
                startScale = pos.scale || 1;
            }
        }
    }, { passive: false });

    view.addEventListener('touchmove', (e) => {
        onImageHandleDragMove(e);
        if (!isImageAdjusting) return;
        if (e.touches.length === 1) {
            e.preventDefault(); // Prevent scroll
            onMove(e.touches[0].clientX, e.touches[0].clientY);
        } else if (e.touches.length === 2 && initialPinchDist) {
            e.preventDefault();
            const dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const scale = dist / initialPinchDist;
            const pos = getImgState();
            pos.scale = Math.max(0.1, startScale * scale);
            refresh();
        }
    }, { passive: false });

    view.addEventListener('touchend', () => {
        initialPinchDist = null;
        onEnd();
        onImageHandleDragEnd();
    });

    // Wheel Zoom for Image
    view.addEventListener('wheel', (e) => {
        if (isImageAdjusting) {
            e.preventDefault();
            e.stopPropagation();
            const pos = getActiveImagePosition() || getImgState();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            pos.scale = Math.max(0.1, (pos.scale || 1) * delta);
            refresh();
            // Debounce save?
            if (window.saveTimer) clearTimeout(window.saveTimer);
            window.saveTimer = setTimeout(triggerAutoSave, 500);
        }
    }, { passive: false });
}

// ──────────────────────────────────────
//  テキスト更新（多言語対応）
// ──────────────────────────────────────
let textPushTimer = null;
function updateActiveText(v, ev) {
    const activeBlock = getActiveBlock();
    if (activeBlock && activeBlock.kind !== 'page') {
        if (isAutoTocBlock(activeBlock)) return;
        if (!textPushTimer) {
            pushState();
        } else {
            clearTimeout(textPushTimer);
        }
        textPushTimer = setTimeout(() => { textPushTimer = null; }, 500);
        setBlockLocalizedText(activeBlock, v);
        refresh();
        triggerAutoSave();
        return;
    }
    const s = state.sections[state.activeIdx];
    if (!textPushTimer) {
        pushState();
    } else {
        clearTimeout(textPushTimer);
    }
    textPushTimer = setTimeout(() => { textPushTimer = null; }, 500);

    if (state.activeBubbleIdx !== null && s.bubbles && s.bubbles[state.activeBubbleIdx]) {
        setBubbleText(s.bubbles[state.activeBubbleIdx], v);
    } else {
        setSectionText(s, v);
        composeSectionForActiveLang(s);
    }
    if (ev?.isComposing) {
        updateTextFitStatus(s);
    } else {
        const activeEl = document.activeElement;
        const editingMainText = activeEl && activeEl.id === 'main-text-area';
        if (editingMainText) {
            updateTextFitStatus(s);
        } else {
            refresh();
        }
    }
    triggerAutoSave();
}

function updateBubbleShape(shapeName) {
    const s = state.sections[state.activeIdx];
    if (state.activeBubbleIdx !== null && s.bubbles && s.bubbles[state.activeBubbleIdx]) {
        pushState();
        s.bubbles[state.activeBubbleIdx].shape = shapeName;
        refresh();
        triggerAutoSave();
    }
}



// ──────────────────────────────────────
//  グローバル書字方向更新
// ──────────────────────────────────────
function updateGlobalWritingMode(mode) {
    const lang = state.activeLang;
    if (!state.languageConfigs) state.languageConfigs = {};
    if (!state.languageConfigs[lang]) state.languageConfigs[lang] = {};

    state.languageConfigs[lang].writingMode = mode;
    pushState();
    composeAllTextSectionsForLang(lang);
    refresh();
    triggerAutoSave();
}

function updateGlobalFontPreset(fontPreset) {
    const lang = state.activeLang;
    if (!state.languageConfigs) state.languageConfigs = {};
    if (!state.languageConfigs[lang]) state.languageConfigs[lang] = {};

    state.languageConfigs[lang].fontPreset = fontPreset;
    pushState();
    composeAllTextSectionsForLang(lang);
    refresh();
    triggerAutoSave();
}


function onLoadProject(pid, sections, languages, defaultLang, languageConfigs, title, uiPrefs, pages, blocks, version) {
    const normalized = normalizeProjectDataV5({
        version,
        pages,
        blocks,
        sections,
        languages,
        defaultLang,
        languageConfigs,
        title,
        uiPrefs
    });

    state.projectId = pid;
    state.title = normalized.title || '';
    state.pages = normalized.pages || [];
    state.blocks = normalized.blocks;
    state.sections = normalized.sections;
    state.languages = normalized.languages;
    state.defaultLang = normalized.defaultLang || normalized.languages[0] || 'ja';

    // languageConfigs Migration
    if (normalized.languageConfigs) {
        state.languageConfigs = normalized.languageConfigs;
    } else {
        // Old format migration: create configs based on defaults
        state.languageConfigs = {};
        state.languages.forEach(lang => {
            const props = getLangProps(lang);
            state.languageConfigs[lang] = {
                writingMode: props.defaultWritingMode || 'horizontal-tb',
                fontPreset: 'gothic'
            };
        });
    }
    state.languages.forEach((lang) => {
        if (!state.languageConfigs[lang]) state.languageConfigs[lang] = {};
        if (!state.languageConfigs[lang].writingMode) {
            state.languageConfigs[lang].writingMode = getLangProps(lang).defaultWritingMode || 'horizontal-tb';
        }
        if (!state.languageConfigs[lang].fontPreset) {
            state.languageConfigs[lang].fontPreset = 'gothic';
        }
    });

    state.uiPrefs = normalized.uiPrefs || state.uiPrefs || {};
    ensureUiPrefs();
    applyThumbColumnsFromPrefs();

    state.activeLang = state.defaultLang || state.languages[0];
    state.activeIdx = 0;
    state.activePageIdx = 0;
    state.activeBlockIdx = Math.max(0, getBlockIndexFromPageIndex(state.blocks, 0));
    state.activeBubbleIdx = null;
    clearHistory();
    refresh();
    renderLangSettings();
}

// --- キーボードショートカット ---
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closePublishValidationModal();
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        undo(refresh);
        triggerAutoSave();
    }
    if ((e.ctrlKey || e.metaKey) && (e.shiftKey && e.key === 'Z' || e.key === 'y')) {
        e.preventDefault();
        redo(refresh);
        triggerAutoSave();
    }
});

// --- グローバル関数の登録 ---
window.handleCanvasClick = (e) => { pushState(); handleCanvasClick(e, refresh); triggerAutoSave(); };
window.selectBubble = (e, i) => selectBubble(e, i, refresh);
window.addSection = () => { pushState(); addSection(refresh); triggerAutoSave(); };
window.changeSection = (i) => {
    if (Date.now() < suppressThumbClickUntil) return;
    changeSection(i, refresh);
};
window.changeBlock = (idx) => {
    if (Date.now() < suppressThumbClickUntil) return;
    changeBlock(idx, refresh);
};
window.addChapterBlock = () => { pushState(); insertStructureBlock('chapter', refresh); triggerAutoSave(); };
window.addSubsectionBlock = () => { pushState(); insertStructureBlock('section', refresh); triggerAutoSave(); };
window.addItemBlock = () => { pushState(); insertStructureBlock('item', refresh); triggerAutoSave(); };
window.addItemEndBlock = () => { pushState(); insertStructureBlock('item_end', refresh); triggerAutoSave(); };
window.addTocBlock = () => { pushState(); insertStructureBlock('toc', refresh); triggerAutoSave(); };
window.insertSectionAtIndex = (idx, e) => {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    pushState();
    insertSectionAt(idx, refresh);
    triggerAutoSave();
};
window.duplicateSectionByIndex = (idx, e) => {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    pushState();
    duplicateSectionAt(idx, refresh);
    triggerAutoSave();
};
window.insertPageNearBlock = (blockIdx, position, e) => {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    pushState();
    insertPageNearBlock(blockIdx, position, refresh);
    triggerAutoSave();
};
window.duplicateBlockByIndex = (blockIdx, e) => {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    pushState();
    duplicateBlockAt(blockIdx, refresh);
    triggerAutoSave();
};
window.moveBlockByIndex = (blockIdx, direction, e) => {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    pushState();
    const moved = moveBlockAt(blockIdx, direction, refresh);
    if (moved) triggerAutoSave();
};
window.splitOverflowToNextPage = () => {
    const activeBlock = getActiveBlock();
    if (activeBlock && activeBlock.kind !== 'page') return;
    const s = state.sections[state.activeIdx];
    if (!s || s.type !== 'text') return;
    const layout = ensureComposedLayoutForActiveLang(s);
    if (!layout?.overflow || !layout?.overflowText) return;
    const lang = state.activeLang;

    pushState();
    setSectionText(s, layout.lines.join('\n'));
    composeSectionForActiveLang(s);

    const insertIdx = state.activeIdx + 1;
    insertSectionAt(insertIdx, refresh);
    const next = state.sections[insertIdx];
    next.type = 'text';
    next.background = '';
    next.bubbles = [];
    next.texts = next.texts || {};
    next.layout = next.layout || {};
    next.languageConfigs = next.languageConfigs || {};
    next.texts[lang] = layout.overflowText;
    next.text = layout.overflowText;
    state.activeIdx = insertIdx;
    composeSectionForActiveLang(next);

    refresh();
    triggerAutoSave();
};
window.startThumbDrag = (e, idx) => {
    thumbDragSourceIdx = idx;
    const el = getThumbElement(idx);
    if (el) el.classList.add('drag-source');
    if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(idx));
    }
};
window.onThumbDragOver = (e, idx) => {
    if (!Number.isInteger(thumbDragSourceIdx)) return;
    e.preventDefault();
    const el = getThumbElement(idx);
    if (!el) return;
    const position = getDropPositionByPoint(el, e.clientY);
    markThumbDropHint(idx, position);
};
window.onThumbDragLeave = () => {
    // no-op; keep hint until a new target is selected
};
window.onThumbDrop = (e, idx) => {
    if (!Number.isInteger(thumbDragSourceIdx)) return;
    e.preventDefault();
    const el = getThumbElement(idx);
    if (!el) return;
    const position = getDropPositionByPoint(el, e.clientY);
    moveSectionWithHistory(thumbDragSourceIdx, idx, position);
    suppressThumbClickUntil = Date.now() + 250;
    thumbDragSourceIdx = null;
    clearThumbDropHints();
};
window.endThumbDrag = () => {
    thumbDragSourceIdx = null;
    clearThumbDropHints();
};
window.startThumbTouchDrag = (e, idx) => {
    if (e.touches?.length !== 1) return;
    const touch = e.touches[0];
    thumbDragSourceIdx = idx;
    thumbTouchState = {
        sourceIndex: idx,
        targetIndex: null,
        position: 'after',
        startX: touch.clientX,
        startY: touch.clientY,
        active: false,
        timerId: null
    };
    thumbTouchState.timerId = setTimeout(() => {
        if (!thumbTouchState) return;
        thumbTouchState.active = true;
        const sourceEl = getThumbElement(idx);
        if (sourceEl) sourceEl.classList.add('drag-source');
    }, 320);
    bindTouchDragListeners();
};
window.deleteActive = () => { pushState(); deleteActive(refresh); triggerAutoSave(); };
window.update = update;
window.updateActiveText = updateActiveText;
window.updateBubbleShape = updateBubbleShape;
window.updateGlobalWritingMode = updateGlobalWritingMode;
window.updateGlobalFontPreset = updateGlobalFontPreset;
window.updateTitle = (v) => {
    state.title = v;
    const headerGuideTitle = document.getElementById('header-guide-title');
    if (headerGuideTitle) headerGuideTitle.textContent = v || 'タイトル未設定';
    triggerAutoSave();
};
window.setThumbColumns = (cols) => {
    setCurrentDeviceThumbColumns(cols);
    refresh();
    triggerAutoSave();
};
window.setThumbSize = window.setThumbColumns;
window.uploadToStorage = (input) => { pushState(); uploadToStorage(input, refresh); };
window.uploadCoverToStorage = (input) => { pushState(); uploadCoverToStorage(input, refresh); };
window.uploadStructureToStorage = (input) => { pushState(); uploadStructureToStorage(input, refresh); };

window.performUndo = () => { undo(refresh); triggerAutoSave(); };
window.performRedo = () => { redo(refresh); triggerAutoSave(); };

// FAB用
window.addBubbleFab = () => {
    pushState();
    addBubbleAtCenter(refresh);
    triggerAutoSave();
};

// バブル移動ハンドル用
window.onHandleDown = (e, i) => {
    startDrag(e, i, refresh);
};

// ズーム・パン機能
let canvasScale = 1;
let canvasTranslate = { x: 0, y: 0 };

const CANVAS_ZOOM_PRESETS = [25, 33, 50, 67, 75, 90, 100, 110, 125, 150, 175, 200, 300, 400];

function syncCanvasZoomUI() {
    const select = document.getElementById('canvas-zoom-select');
    if (!select) return;
    const percent = Math.round(canvasScale * 100);
    const custom = select.querySelector('option[value="custom"]');
    if (CANVAS_ZOOM_PRESETS.includes(percent)) {
        if (custom) custom.hidden = true;
        select.value = String(percent);
    } else if (custom) {
        custom.hidden = false;
        custom.textContent = `${percent}%`;
        select.value = 'custom';
    }
}

window.setCanvasZoomPercent = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return;
    canvasScale = Math.min(Math.max(num / 100, 0.1), 5);
    updateCanvasTransform();
};

function updateCanvasTransform() {
    const layer = document.getElementById('canvas-transform-layer');
    if (layer) {
        layer.style.transform = `translate(-50%, -50%) translate(${canvasTranslate.x}px, ${canvasTranslate.y}px) scale(${canvasScale})`;
    }
    syncCanvasZoomUI();
}

// キャンバスリセット（中央寄せ・初期サイズ）
window.resetCanvasView = () => {
    canvasTranslate = { x: 0, y: 0 };

    // 画面サイズに合わせて自動スケール
    const container = document.getElementById('canvas-view');
    if (container) {
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        // 9:16 (360x640) base
        const targetW = 360;
        const targetH = 640;

        let s = Math.min(cw / targetW, ch / targetH) * 0.9;
        if (s > 1.2) s = 1.0; // あまり大きすぎないように
        canvasScale = s;
    } else {
        canvasScale = 1;
    }

    updateCanvasTransform();
};

function initCanvasZoom() {
    const view = document.getElementById('canvas-view');
    if (!view) return;

    // 初期化時にリセット
    resetCanvasView();

    // Pan handling
    let isPanning = false;
    let startPan = { x: 0, y: 0 };
    let startTranslate = { x: 0, y: 0 };

    view.addEventListener('mousedown', (e) => {
        // 画像調整中はCanvas全体のパンを無効化
        if (isImageAdjusting) return;

        // バブルやテキストレイヤー以外ならPan開始
        if (e.target.id === 'canvas-view' || e.target.id === 'content-render' || e.target.classList.contains('text-layer')) {
            isPanning = true;
            startPan = { x: e.clientX, y: e.clientY };
            startTranslate = { ...canvasTranslate };
            view.style.cursor = 'grabbing';
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (!isPanning) return;
        const dx = e.clientX - startPan.x;
        const dy = e.clientY - startPan.y;
        canvasTranslate.x = startTranslate.x + dx;
        canvasTranslate.y = startTranslate.y + dy;
        updateCanvasTransform();
    });

    window.addEventListener('mouseup', () => {
        if (isPanning) {
            isPanning = false;
            view.style.cursor = 'default';
        }
    });

    // Touch Pan & Pinch (Simplified)
    // Hammer.js or similar recommended for robust pinch, but implementing basic logic here
    // For now, support single touch pan (if not on bubble)
    view.addEventListener('touchstart', (e) => {
        // 画像調整中はCanvasパン無効
        if (isImageAdjusting) return;

        if (e.touches.length === 1 && (e.target.id === 'canvas-view' || e.target.classList.contains('text-layer'))) {
            isPanning = true;
            startPan = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            startTranslate = { ...canvasTranslate };
        }
    });

    view.addEventListener('touchmove', (e) => {
        if (isPanning && e.touches.length === 1) {
            const dx = e.touches[0].clientX - startPan.x;
            const dy = e.touches[0].clientY - startPan.y;
            canvasTranslate.x = startTranslate.x + dx;
            canvasTranslate.y = startTranslate.y + dy;
            updateCanvasTransform();
        }
    }, { passive: false });

    view.addEventListener('touchend', () => {
        isPanning = false;
    });

    // Wheel Zoom
    view.addEventListener('wheel', (e) => {
        if (isImageAdjusting) return; // 画像調整中はCanvasズーム無効

        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        canvasScale *= delta;
        canvasScale = Math.min(Math.max(0.1, canvasScale), 5); // Limit scale
        updateCanvasTransform();
    }, { passive: false });
}

// プロジェクト名インライン編集
window.onProjectTitleInput = () => {
    const el = document.getElementById('project-title');
    if (el) {
        const name = (el.textContent || '').trim();
        if (name && name !== '新規プロジェクト') {
            state.projectId = name;
        }
    }
};
window.onProjectTitleKeydown = (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        e.target.blur();
    }
};
window.onProjectTitleBlur = () => {
    const el = document.getElementById('project-title');
    if (el) {
        const name = (el.textContent || '').trim();
        if (name && name !== '新規プロジェクト') {
            state.projectId = name;
            triggerAutoSave();
        }
    }
};
window.saveProject = () => {
    if (!state.projectId) {
        const name = (document.getElementById('project-title').textContent || '').trim();
        if (!name || name === '新規プロジェクト') {
            const input = prompt('プロジェクト名を入力してください:');
            if (!input) return;
            state.projectId = input;
            document.getElementById('project-title').textContent = input;
        } else {
            state.projectId = name;
        }
    }
    triggerAutoSave();
};

window.exportProject = () => {
    const validation = validateProjectForPublishOrExport();
    if (!validation.ok) {
        showPublishValidationErrors(validation.issues, 'エクスポート');
        return;
    }
    composeCanonicalLayoutsForSections(state.sections, state.languages, state.languageConfigs);
    syncBlocksFromState();
    const pages = blocksToPages(state.blocks);
    const data = {
        version: PAGE_SCHEMA_VERSION,
        projectId: state.projectId,
        title: state.title || '',
        pages,
        blocks: state.blocks,
        sections: state.sections,
        languages: state.languages,
        defaultLang: state.defaultLang || state.languages?.[0] || 'ja',
        languageConfigs: state.languageConfigs,
        lastUpdated: new Date().toISOString()
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.projectId || 'project'}.dsf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

window.shareProject = async () => {
    if (!state.projectId) {
        alert("プロジェクトが保存されていません。");
        return;
    }
    if (!state.uid) {
        alert("ログインしてください。");
        return;
    }
    const validation = validateProjectForPublishOrExport();
    if (!validation.ok) {
        showPublishValidationErrors(validation.issues, '共有');
        return;
    }
    // Ensure save
    await triggerAutoSave();

    // Construct URL
    const host = window.location.host;
    const url = `${window.location.protocol}//${host}/viewer.html?id=${encodeURIComponent(state.projectId)}&uid=${encodeURIComponent(state.uid)}`;

    // Copy to clipboard
    try {
        await navigator.clipboard.writeText(url);
        alert(`スマホ用URLをコピーしました！\n\n${url}`);
    } catch (e) {
        prompt("ビューワー用URL (コピーしてください):", url);
    }
};

// 吹き出し直接編集（多言語対応）
let directEditPushTimer = null;
window.onBubbleTextInput = (e, i) => {
    const text = (e.target.innerText || '').replace(/\n+$/, '');
    const s = state.sections[state.activeIdx];
    if (s.bubbles && s.bubbles[i]) {
        if (!directEditPushTimer) {
            pushState();
        } else {
            clearTimeout(directEditPushTimer);
        }
        directEditPushTimer = setTimeout(() => { directEditPushTimer = null; }, 500);

        setBubbleText(s.bubbles[i], text);
        document.getElementById('prop-text').value = text;
        triggerAutoSave();
    }
};
window.onBubbleTextBlur = () => {
    setTimeout(() => refresh(), 10);
};

window.updateCoverField = (field, value) => {
    const block = getActiveBlock();
    if (!block || block.kind !== 'cover_front') return;
    touchCoverFieldHistory();
    setBlockLocalizedMetaField(block, field, value);
    refresh();
    triggerAutoSave();
};

window.updateCoverBackField = (field, value) => {
    const block = getActiveBlock();
    if (!block || block.kind !== 'cover_back') return;
    touchCoverFieldHistory();
    setBlockLocalizedMetaField(block, field, value);
    refresh();
    triggerAutoSave();
};

window.updateCoverBackContacts = (raw) => {
    const block = getActiveBlock();
    if (!block || block.kind !== 'cover_back') return;
    touchCoverFieldHistory();
    if (!block.meta) block.meta = {};
    block.meta.contacts = parseContactsFromText(raw);
    refresh();
    triggerAutoSave();
};

window.updateCoverBodyKind = (bodyKind) => {
    const block = getActiveBlock();
    if (!block || (block.kind !== 'cover_front' && block.kind !== 'cover_back')) return;
    touchCoverFieldHistory();
    setCoverBodyKind(block, bodyKind);
    if (getCoverBodyKind(block) === 'theme') {
        ensureCoverTheme(block);
    }
    refresh();
    triggerAutoSave();
};

window.updateCoverThemeField = (key, value) => {
    const block = getActiveBlock();
    if (!block || (block.kind !== 'cover_front' && block.kind !== 'cover_back')) return;
    touchCoverFieldHistory();
    const theme = ensureCoverTheme(block);
    if (key === 'templateId' || key === 'paletteId') {
        theme[key] = String(value || '');
    }
    block.meta.theme = theme;
    refresh();
    triggerAutoSave();
};

window.updateStructureBodyKind = (bodyKind) => {
    const block = getActiveBlock();
    if (!block || !isStructureKind(block.kind)) return;
    touchCoverFieldHistory();
    setStructureBodyKind(block, bodyKind);
    if (!block.content || typeof block.content !== 'object') block.content = {};
    if (bodyKind === 'image') {
        if (!block.content.background) block.content.background = '';
        if (!block.content.imagePosition) block.content.imagePosition = { x: 0, y: 0, scale: 1, rotation: 0 };
        if (!block.content.imageBasePosition) block.content.imageBasePosition = { x: 0, y: 0, scale: 1, rotation: 0 };
    }
    refresh();
    triggerAutoSave();
};

window.updateStructureBodyText = (value) => {
    const block = getActiveBlock();
    if (!block || !isStructureKind(block.kind)) return;
    touchCoverFieldHistory();
    setStructureBodyText(block, value);
    refresh();
    triggerAutoSave();
};

window.updateStructureTitle = (value) => {
    const block = getActiveBlock();
    if (!block || !isStructureKind(block.kind)) return;
    touchCoverFieldHistory();
    setStructureTitle(block, value);
    refresh();
    triggerAutoSave();
};

// 言語切替
window.switchLang = (code) => {
    state.activeLang = code;
    refresh();
};

// 言語追加
window.addLang = () => {
    const select = document.getElementById('lang-add-select');
    if (!select) return;
    const code = select.value;
    if (!code || state.languages.includes(code)) return;
    state.languages.push(code);
    if (!state.languageConfigs) state.languageConfigs = {};
    state.languageConfigs[code] = {
        writingMode: getLangProps(code).defaultWritingMode || 'horizontal-tb',
        fontPreset: 'gothic'
    };
    renderLangSettings();
    renderLangTabs();
    triggerAutoSave();
};

// 言語削除
window.removeLang = (code) => {
    if (state.languages.length <= 1) return;
    if (!confirm(`${getLangProps(code).label} を削除しますか？\nこの言語のテキストは保持されます。`)) return;
    state.languages = state.languages.filter(c => c !== code);
    if (state.defaultLang === code) {
        state.defaultLang = state.languages[0] || 'ja';
    }
    if (state.activeLang === code) {
        state.activeLang = state.defaultLang || state.languages[0];
    }
    renderLangSettings();
    refresh();
    triggerAutoSave();
};

// プロジェクトモーダル
window.openProjectModal = () => openProjectModal(onLoadProject);
window.closeProjectModal = closeProjectModal;
window.closePublishValidationModal = closePublishValidationModal;
window.setValidationIssueFilter = setValidationIssueFilter;

// 新規プロジェクト
window.newProject = () => {
    if (state.projectId && !confirm('現在のプロジェクトを閉じて新しいプロジェクトを作成しますか？')) return;
    state.projectId = null;
    state.title = '';
    state.languages = ['ja'];
    state.defaultLang = 'ja';
    state.languageConfigs = {
        ja: { writingMode: 'vertical-rl', fontPreset: 'gothic' }
    };
    state.uiPrefs = {
        desktop: { thumbColumns: 2 },
        mobile: { thumbColumns: 2 }
    };
    applyThumbColumnsFromPrefs();
    state.activeLang = 'ja';
    state.sections = [{
        type: 'image',
        background: 'https://picsum.photos/id/10/600/1066',
        writingMode: 'horizontal-tb', // Legacy usage, ignored
        bubbles: [],
        text: '',
        texts: {}
    }];
    state.blocks = migrateSectionsToBlocks(state.sections, state.languages);
    state.pages = blocksToPages(state.blocks);
    state.activeIdx = 0;
    state.activePageIdx = 0;
    state.activeBlockIdx = Math.max(0, getBlockIndexFromPageIndex(state.blocks, 0));
    state.activeBubbleIdx = null;
    clearHistory();
    refresh();
    renderLangSettings();
    closeProjectModal();
};

function setRibbonTab(tabName) {
    document.querySelectorAll('.ribbon-tab').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.ribbonTab === tabName);
    });
    document.querySelectorAll('.ribbon-panel').forEach((panel) => {
        panel.classList.toggle('active', panel.dataset.ribbonPanel === tabName);
    });
}

function syncDesktopToggleButtons() {
    const leftCollapsed = document.body.classList.contains('left-collapsed');
    const rightCollapsed = document.body.classList.contains('right-collapsed');
    const leftBtn = document.getElementById('btn-toggle-sidebar');
    const rightBtn = document.getElementById('btn-toggle-panel');
    if (leftBtn) leftBtn.textContent = leftCollapsed ? '📚 Pagesを開く' : '📚 Pages';
    if (rightBtn) rightBtn.textContent = rightCollapsed ? '⚙ Editを開く' : '⚙ Edit';
}

window.toggleDesktopPanel = (side) => {
    if (side === 'left') {
        document.body.classList.toggle('left-collapsed');
    }
    if (side === 'right') {
        document.body.classList.toggle('right-collapsed');
    }
    syncDesktopToggleButtons();
};

window.togglePagesPanel = () => {
    if (window.innerWidth < 1024) {
        closeMobileSheet();
        return;
    }
    toggleDesktopPanel('left');
};

window.toggleEditPanel = () => {
    if (window.innerWidth < 1024) {
        closeMobileSheet();
        return;
    }
    toggleDesktopPanel('right');
};

let activeMobileSheet = null;
let lastDeviceKey = getDeviceKey();

function setBottomBarActive(actionName) {
    document.querySelectorAll('.bottom-item').forEach((item) => {
        item.classList.toggle('active', item.dataset.mobileAction === actionName);
    });
}

window.closeMobileSheet = () => {
    activeMobileSheet = null;
    document.body.classList.remove('mobile-sheet-active');
    ['sidebar', 'panel-right', 'mobile-action-sheet'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('mobile-sheet-open');
    });
    document.querySelectorAll('.mobile-sheet-content').forEach((el) => el.classList.remove('active'));
    setBottomBarActive(null);
};

function openMobileActionSheet(contentId) {
    const actionSheet = document.getElementById('mobile-action-sheet');
    if (!actionSheet) return;
    actionSheet.classList.add('mobile-sheet-open');
    document.querySelectorAll('.mobile-sheet-content').forEach((el) => {
        el.classList.toggle('active', el.id === contentId);
    });
}

window.openMobileSheet = (sheetName) => {
    if (window.innerWidth >= 1024) return;
    if (activeMobileSheet === sheetName) {
        closeMobileSheet();
        return;
    }

    closeMobileSheet();
    activeMobileSheet = sheetName;
    document.body.classList.add('mobile-sheet-active');
    setBottomBarActive(sheetName);

    if (sheetName === 'pages') {
        document.getElementById('sidebar')?.classList.add('mobile-sheet-open');
        return;
    }
    if (sheetName === 'edit') {
        document.getElementById('panel-right')?.classList.add('mobile-sheet-open');
        return;
    }

    const map = {
        home: 'mobile-sheet-home',
        add: 'mobile-sheet-add',
        export: 'mobile-sheet-export',
        lang: 'mobile-sheet-lang'
    };
    openMobileActionSheet(map[sheetName] || 'mobile-sheet-home');
};

function initUIChrome() {
    document.querySelectorAll('.ribbon-tab').forEach((tab) => {
        tab.addEventListener('click', () => setRibbonTab(tab.dataset.ribbonTab));
    });

    document.getElementById('btn-toggle-sidebar')?.addEventListener('click', () => toggleDesktopPanel('left'));
    document.getElementById('btn-toggle-panel')?.addEventListener('click', () => toggleDesktopPanel('right'));

    document.querySelectorAll('.bottom-item').forEach((item) => {
        item.addEventListener('click', () => openMobileSheet(item.dataset.mobileAction));
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth >= 1024) {
            closeMobileSheet();
        }
        const currentDeviceKey = getDeviceKey();
        if (currentDeviceKey !== lastDeviceKey) {
            lastDeviceKey = currentDeviceKey;
            applyThumbColumnsFromPrefs();
            refresh();
        }
    });

    setRibbonTab('home');
    syncDesktopToggleButtons();
}

// 後方互換: 旧モバイルナビAPI
window.toggleMobilePanel = (panelName) => {
    if (panelName === 'sidebar') return openMobileSheet('pages');
    if (panelName === 'properties') return openMobileSheet('edit');
    return closeMobileSheet();
};

window.toggleAuth = async () => {
    try {
        if (state.uid) {
            await signOutUser();
        } else {
            await signInWithGoogle();
        }
    } catch (e) {
        const code = e?.code || '';
        let msg = e?.message || 'unknown error';
        if (code === 'auth/unauthorized-domain') {
            msg = 'このアクセス元ドメインはFirebase Authで未許可です。Firebase Console > Authentication > Settings > Authorized domains に現在のホストを追加してください。';
        } else if (code === 'auth/popup-blocked') {
            msg = 'ポップアップがブロックされました。iPhoneではリダイレクトログインを使用してください。';
        } else if (code === 'auth/persistence-unavailable') {
            msg = 'Safariでログイン状態を保持できません。プライベートブラウズOFF・すべてのCookieをブロックOFFを確認してください。';
        } else if (code === 'auth/redirect-state-lost') {
            msg = 'リダイレクト後にログイン状態が消えています。iPhoneの「サイト越えトラッキングを防ぐ」を一時的にOFFにして再試行してください。';
        }
        alert(`認証に失敗しました (${code || 'no-code'}): ${msg}`);
    }
};

onAuthChanged((user) => {
    state.user = user || null;
    state.uid = user?.uid || null;
    updateAuthUI();
});

// --- 初回描画 ---
initUIChrome();
ensureUiPrefs();
applyThumbColumnsFromPrefs();
consumeRedirectResult().catch((e) => {
    const code = e?.code || '';
    let detail = e?.message || 'unknown error';
    if (code === 'auth/unauthorized-domain') {
        detail = 'Firebase AuthのAuthorized domainsに現在のホストが未登録です。';
    } else if (code === 'auth/redirect-state-lost') {
        detail = 'iPhoneでリダイレクト後の認証状態が復元できませんでした。Cookie/トラッキング設定を確認してください。';
    }
    alert(`ログイン復帰に失敗しました (${code || 'no-code'}): ${detail}`);
});
refresh();
renderLangSettings();
updateAuthUI();
initCanvasZoom(); // Initialize zoom/pan
initImageAdjustment(); // Initialize image adjustment events
