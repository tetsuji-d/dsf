/**
 * app.js — メインエントリポイント・描画・UI同期
 */
import { state, dispatch, actionTypes } from './state.js';
import { saveProject as persistProject, loadProject, uploadToStorage, uploadCoverToStorage, uploadStructureToStorage, triggerAutoSave, flushSave, generateCroppedThumbnail, listLocalRecentProjects, loadLocalRecentProject, cacheLocalRecentProject } from './firebase.js';
import { initGIS, renderGISButton, signInWithGoogle, signOutUser, onAuthChanged, handleRedirectResult } from './gis-auth.js';
import { handleCanvasClick, selectBubble, renderBubbleHTML, getBubbleText, setBubbleText, addBubbleAtCenter, startDrag, startTailDrag, startSpikeDrag } from './bubbles.js';
import { addSection, addTextSection, changeSection, changeBlock, insertStructureBlock, renderThumbs, deleteActive, deleteSectionAt, insertSectionAt, duplicateSectionAt, moveSection, insertPageNearBlock, duplicateBlockAt, moveBlockAt, getOptimizedImageUrl } from './sections.js';
import { pushState, undo, redo, getHistoryInfo, clearHistory } from './history.js';
import { openProjectModal, closeProjectModal, fetchCloudProjects, getCoverImage, getPageCount, deleteCloudProject } from './projects.js';
import { openWorksRoom, closeWorksRoom } from './works.js';
import { enterPressRoom } from './press.js';
import { getLangProps, getAllLangs } from './lang.js';
import { t, applyI18n, setUILang, getUILang } from './i18n-studio.js';
import { getBlockIndexFromPageIndex, getPageIndexFromBlockIndex, migrateSectionsToBlocks, syncBlocksWithSections } from './blocks.js';
import { blocksToPages, normalizeProjectDataV5 } from './pages.js';
import { buildDSP, buildDSF, parseAndLoadDSP } from './export.js';
import { applyTheme, bindThemePreferenceListener, getThemeMode, setThemeMode } from './theme.js';
import { get as idbGet } from 'idb-keyval';
import { createId } from './utils.js';
import { CANONICAL_PAGE_WIDTH, CANONICAL_PAGE_HEIGHT } from './page-geometry.js';
import { composeText, getWritingModeFromConfigs, getFontPresetFromConfigs, parseRubyTokens, tokensToPlainText, alignRubyToLines } from './layout.js';

const EDITOR_FRAME_WIDTH = CANONICAL_PAGE_WIDTH;
const EDITOR_FRAME_HEIGHT = CANONICAL_PAGE_HEIGHT;
const IMAGE_SNAP_THRESHOLD = 12;
const editorImageAspectCache = new Map();
const EMPTY_IMAGE_SNAP_STATE = Object.freeze({
    centerX: false,
    centerY: false,
    edgeLeft: false,
    edgeRight: false,
    edgeTop: false,
    edgeBottom: false
});
let imageSnapState = { ...EMPTY_IMAGE_SNAP_STATE };

function getEditorImageFrameMetrics(bgUrl) {
    const aspect = editorImageAspectCache.get(bgUrl);
    if (!aspect || !Number.isFinite(aspect) || aspect <= 0) {
        return {
            widthPercent: 100,
            heightPercent: 100
        };
    }

    const frameAspect = EDITOR_FRAME_WIDTH / EDITOR_FRAME_HEIGHT;
    if (aspect > frameAspect) {
        return {
            widthPercent: (EDITOR_FRAME_HEIGHT * aspect / EDITOR_FRAME_WIDTH) * 100,
            heightPercent: 100
        };
    }

    return {
        widthPercent: 100,
        heightPercent: (EDITOR_FRAME_WIDTH / aspect / EDITOR_FRAME_HEIGHT) * 100
    };
}

function resetImageSnapState() {
    imageSnapState = { ...EMPTY_IMAGE_SNAP_STATE };
}

function getImageSnapMetrics(bgUrl, pos) {
    const frameMetrics = getEditorImageFrameMetrics(bgUrl);
    const width = EDITOR_FRAME_WIDTH * (frameMetrics.widthPercent / 100);
    const height = EDITOR_FRAME_HEIGHT * (frameMetrics.heightPercent / 100);
    const scale = Math.max(0.1, Number.isFinite(Number(pos?.scale)) ? Number(pos.scale) : 1);
    const rotation = Number.isFinite(Number(pos?.rotation)) ? Number(pos.rotation) : 0;
    const rad = (rotation * Math.PI) / 180;
    const halfW = (width * scale) / 2;
    const halfH = (height * scale) / 2;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const extentX = Math.abs(halfW * cos) + Math.abs(halfH * sin);
    const extentY = Math.abs(halfW * sin) + Math.abs(halfH * cos);

    return {
        extentX,
        extentY
    };
}

function applyImageSnapping(pos, bgUrl) {
    if (!isImageAdjusting || !pos) {
        resetImageSnapState();
        return;
    }

    const nextState = { ...EMPTY_IMAGE_SNAP_STATE };
    const { extentX, extentY } = getImageSnapMetrics(bgUrl, pos);
    let x = Number.isFinite(Number(pos.x)) ? Number(pos.x) : 0;
    let y = Number.isFinite(Number(pos.y)) ? Number(pos.y) : 0;

    if (Math.abs(x) <= IMAGE_SNAP_THRESHOLD) {
        x = 0;
        nextState.centerX = true;
    } else {
        const snapLeftX = -EDITOR_FRAME_WIDTH / 2 + extentX;
        const snapRightX = EDITOR_FRAME_WIDTH / 2 - extentX;
        if (Math.abs(x - snapLeftX) <= IMAGE_SNAP_THRESHOLD) {
            x = snapLeftX;
            nextState.edgeLeft = true;
        } else if (Math.abs(x - snapRightX) <= IMAGE_SNAP_THRESHOLD) {
            x = snapRightX;
            nextState.edgeRight = true;
        }
    }

    if (Math.abs(y) <= IMAGE_SNAP_THRESHOLD) {
        y = 0;
        nextState.centerY = true;
    } else {
        const snapTopY = -EDITOR_FRAME_HEIGHT / 2 + extentY;
        const snapBottomY = EDITOR_FRAME_HEIGHT / 2 - extentY;
        if (Math.abs(y - snapTopY) <= IMAGE_SNAP_THRESHOLD) {
            y = snapTopY;
            nextState.edgeTop = true;
        } else if (Math.abs(y - snapBottomY) <= IMAGE_SNAP_THRESHOLD) {
            y = snapBottomY;
            nextState.edgeBottom = true;
        }
    }

    if (Math.abs(x) <= 0.001) nextState.centerX = true;
    if (Math.abs(y) <= 0.001) nextState.centerY = true;

    pos.x = x;
    pos.y = y;
    imageSnapState = nextState;
}

function getImageAdjustRenderMetrics(bgUrl, pos) {
    const frameMetrics = getEditorImageFrameMetrics(bgUrl);
    const scale = Math.max(0.1, Number(pos?.scale) || 1);
    const rotation = Number(pos?.rotation) || 0;
    const flipX = pos?.flipX ? ' scaleX(-1)' : '';
    return {
        frameMetrics,
        invScale: 1 / scale,
        targetTransform: `translate(calc(-50% + ${Number(pos?.x) || 0}px), calc(-50% + ${Number(pos?.y) || 0}px)) scale(${scale}) rotate(${rotation}deg)${flipX}`
    };
}

function syncImageAdjustDom() {
    const s = state.sections?.[state.activeIdx];
    if (!s || s.type !== 'image') return false;
    const pos = getActiveImagePosition();
    if (!pos) return false;

    const target = document.getElementById('image-adjust-target');
    if (!target) return false;

    const bgUrl = getOptimizedImageUrl(s?.backgrounds?.[state.activeLang] || s?.backgrounds?.[state.defaultLang] || s?.background || '');
    const { frameMetrics, invScale, targetTransform } = getImageAdjustRenderMetrics(bgUrl, pos);

    target.style.width = `${frameMetrics.widthPercent}%`;
    target.style.height = `${frameMetrics.heightPercent}%`;
    target.style.transform = targetTransform;

    const overlay = document.getElementById('image-adjust-overlay');
    if (overlay) {
        overlay.style.setProperty('--inv-handle-scale', String(invScale));
    }

    const rotateSlider = document.getElementById('image-rotate-slider');
    if (rotateSlider) {
        const rotation = roundRotationHalfStep(Math.max(-180, Math.min(180, Number(pos.rotation) || 0)));
        rotateSlider.value = String(rotation);
    }
    const rotateShell = document.querySelector('.img-rotate-slider-shell');
    if (rotateShell) {
        const rotation = roundRotationHalfStep(Math.max(-180, Math.min(180, Number(pos.rotation) || 0)));
        const ratio = (180 - rotation) / 360;
        rotateShell.style.setProperty('--rotate-ratio', String(ratio));
        rotateShell.setAttribute('aria-valuenow', String(rotation));
    }
    const rotateValue = document.getElementById('image-rotate-value');
    if (rotateValue) {
        const rotation = roundRotationHalfStep(Math.max(-180, Math.min(180, Number(pos.rotation) || 0)));
        rotateValue.textContent = `${rotation.toFixed(1)}°`;
    }

    const safeFrame = document.querySelector('#image-stage-overlay .image-safe-frame');
    if (safeFrame) {
        safeFrame.classList.toggle('active-left', !!imageSnapState.edgeLeft);
        safeFrame.classList.toggle('active-right', !!imageSnapState.edgeRight);
        safeFrame.classList.toggle('active-top', !!imageSnapState.edgeTop);
        safeFrame.classList.toggle('active-bottom', !!imageSnapState.edgeBottom);
    }

    const verticalGuide = document.querySelector('#image-stage-overlay .image-center-guide.vertical');
    if (verticalGuide) verticalGuide.classList.toggle('active', !!imageSnapState.centerX);
    const horizontalGuide = document.querySelector('#image-stage-overlay .image-center-guide.horizontal');
    if (horizontalGuide) horizontalGuide.classList.toggle('active', !!imageSnapState.centerY);

    const flipBtn = document.getElementById('image-flip-btn');
    if (flipBtn) flipBtn.classList.toggle('active', !!pos.flipX);

    return true;
}

let imageAdjustRaf = null;
let isAdjustingRotationSlider = false;
function scheduleImageAdjustDomUpdate() {
    if (imageAdjustRaf) return;
    imageAdjustRaf = requestAnimationFrame(() => {
        imageAdjustRaf = null;
        if (!syncImageAdjustDom()) refresh();
    });
}

window.handleEditorImageLoad = (e) => {
    const img = e?.target;
    const src = img?.getAttribute('src');
    const naturalWidth = Number(img?.naturalWidth);
    const naturalHeight = Number(img?.naturalHeight);
    if (!src || !Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) {
        return;
    }

    const aspect = naturalWidth / naturalHeight;
    const prev = editorImageAspectCache.get(src);
    if (prev && Math.abs(prev - aspect) < 0.0001) return;

    editorImageAspectCache.set(src, aspect);
    refresh();
};

function getActiveBlock() {
    const blocks = state.blocks || [];
    if (Number.isInteger(state.activeBlockIdx) && blocks[state.activeBlockIdx]) {
        return blocks[state.activeBlockIdx];
    }
    const fallbackBlockIdx = getBlockIndexFromPageIndex(blocks, state.activeIdx);
    if (fallbackBlockIdx >= 0) {
        dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: fallbackBlockIdx });
        return blocks[fallbackBlockIdx];
    }
    return null;
}


function syncBlocksFromState() {
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: syncBlocksWithSections(state.blocks, state.sections, state.languages) } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'pages', value: blocksToPages(state.blocks) } });
    const activeBlock = getActiveBlock();
    const pageIdx = getPageIndexFromBlockIndex(state.blocks, state.activeBlockIdx);
    if (pageIdx >= 0) {
        dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: pageIdx });
    }
    if (!activeBlock && state.blocks?.length) {
        dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: 0 });
    }
}

function getProjectDisplayName() {
    return state.projectName || '新規プロジェクト';
}

function ensureProjectIdentity() {
    if (!state.projectId) {
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'projectId', value: createId('proj') } });
    }

    if (!state.projectName) {
        const headerText = (document.getElementById('project-title')?.textContent || '').trim();
        const fallbackName = headerText && headerText !== '新規プロジェクト'
            ? headerText
            : (state.title || '新規プロジェクト');
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'projectName', value: fallbackName } });
    }
}

function formatHomeDate(value) {
    const date = value instanceof Date ? value : new Date(value || 0);
    if (Number.isNaN(date.getTime())) return '';
    const locale = getUILang() === 'en' ? 'en-US' : 'ja-JP';
    return date.toLocaleDateString(locale);
}

function formatProjectLanguages(languages) {
    const list = Array.isArray(languages) && languages.length > 0 ? languages : ['ja'];
    return list.map((code) => String(code).toUpperCase()).join(', ');
}

function renderLanguageBadges(languages) {
    const list = Array.isArray(languages) && languages.length > 0 ? languages : ['ja'];
    return list.map((code) => {
        const normalized = String(code).trim().toLowerCase();
        const modifier = normalized === 'ja'
            ? 'ja'
            : (normalized === 'en' || normalized === 'en-us')
                ? 'en-us'
                : normalized === 'en-gb'
                    ? 'en-gb'
                    : normalized === 'zh-cn'
                        ? 'zh-cn'
                        : normalized === 'zh-tw'
                            ? 'zh-tw'
                            : 'generic';
        const label = normalized.toUpperCase();
        return `<span class="home-lang-badge home-lang-${modifier}" title="${label}">${modifier === 'generic' ? label : ''}</span>`;
    }).join('');
}

function formatProjectBytes(bytes) {
    const size = Number(bytes || 0);
    if (!Number.isFinite(size) || size <= 0) return '';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function renderHomeCard(project, source) {
    const displayName = project.projectName || project.title || project.id || '無題';
    const thumb = project.listThumbnail || (
        source === 'cloud'
            ? getCoverImage(project.dsfPages, project.pages, project.blocks, project.sections)
            : (project.thumbnail || '')
    );
    const pageCount = source === 'cloud'
        ? getPageCount(project.pages, project.blocks, project.sections)
        : Math.max(1, Number(project.pageCount || 0));
    const updatedAt = formatHomeDate(project.lastUpdated || project.updatedAt);
    const sourceLabel = source === 'cloud' ? t('home_source_cloud') : t('home_source_local');
    const languageLabel = formatProjectLanguages(project.languages);
    const sizeLabel = formatProjectBytes(project.projectBytes);
    const languageBadges = renderLanguageBadges(project.languages);

    return `
        <button class="home-project-card" data-home-source="${source}" data-id="${project.id}">
            ${source === 'cloud' ? `<span class="home-project-delete material-icons" data-delete-cloud="${project.id}" title="${t('btn_delete')}">delete</span>` : ''}
            <div class="home-project-thumb">
                ${thumb
                    ? `<img src="${thumb}" alt="${displayName}">`
                    : `<div class="home-project-thumb-fallback"><span class="material-icons">folder</span></div>`}
            </div>
            <div class="home-project-info">
                <div class="home-project-title">${displayName}</div>
                <div class="home-project-meta">${t('home_pages_count', { count: pageCount })} · ${sourceLabel}${updatedAt ? ` · ${updatedAt}` : ''}</div>
                <div class="home-project-meta home-project-meta-secondary">
                    <span class="home-lang-badges">${languageBadges}</span>
                    <span>${languageLabel}${sizeLabel ? ` · ${sizeLabel}` : ''}</span>
                </div>
            </div>
        </button>
    `;
}

async function renderHomeDashboard() {
    const cloudGrid = document.getElementById('home-cloud-grid');
    const localGrid = document.getElementById('home-local-grid');
    const cloudCount = document.getElementById('home-cloud-count');
    const localCount = document.getElementById('home-local-count');
    if (!cloudGrid || !localGrid) return;

    cloudGrid.innerHTML = `<div class="home-empty-state"><span class="material-icons">cloud_sync</span><p>${t('home_loading')}</p></div>`;
    localGrid.innerHTML = `<div class="home-empty-state"><span class="material-icons">history</span><p>${t('home_loading')}</p></div>`;
    if (cloudCount) cloudCount.textContent = '...';
    if (localCount) localCount.textContent = '...';

    const [cloudProjects, localProjects] = await Promise.all([
        fetchCloudProjects().catch((e) => {
            console.warn('[Home] Failed to load cloud projects:', e);
            return null;
        }),
        listLocalRecentProjects().catch((e) => {
            console.warn('[Home] Failed to load local recent projects:', e);
            return [];
        })
    ]);

    if (cloudProjects === null) {
        cloudGrid.innerHTML = `<div class="home-empty-state"><span class="material-icons">cloud_off</span><p>${t('home_cloud_error')}</p></div>`;
        if (cloudCount) cloudCount.textContent = '!';
    } else if (!state.uid) {
        cloudGrid.innerHTML = `<div class="home-empty-state"><span class="material-icons">lock</span><p>${t('home_cloud_login')}</p></div>`;
        if (cloudCount) cloudCount.textContent = '0';
    } else if (cloudProjects.length === 0) {
        cloudGrid.innerHTML = `<div class="home-empty-state"><span class="material-icons">cloud_done</span><p>${t('home_cloud_empty')}</p></div>`;
        if (cloudCount) cloudCount.textContent = '0';
    } else {
        cloudGrid.innerHTML = cloudProjects.map((project) => renderHomeCard(project, 'cloud')).join('');
        if (cloudCount) cloudCount.textContent = String(cloudProjects.length);
    }

    if (localProjects.length === 0) {
        localGrid.innerHTML = `<div class="home-empty-state"><span class="material-icons">folder_open</span><p>${t('home_local_empty')}</p></div>`;
        if (localCount) localCount.textContent = '0';
    } else {
        localGrid.innerHTML = localProjects.map((project) => renderHomeCard(project, 'local')).join('');
        if (localCount) localCount.textContent = String(localProjects.length);
    }

    cloudGrid.querySelectorAll('.home-project-card').forEach((card) => {
        card.addEventListener('click', async () => {
            const pid = card.dataset.id;
            const project = (cloudProjects || []).find((item) => item.id === pid);
            if (!project) return;
            onLoadProject(pid, project.projectName, project.sections, project.languages, project.defaultLang, project.languageConfigs, project.title, project.uiPrefs, project.pages, project.blocks, project.version);
            await cacheLocalRecentProject(JSON.parse(JSON.stringify(state)), window.localImageMap);
            refresh();
            window.switchRoom('editor');
        });
    });

    cloudGrid.querySelectorAll('[data-delete-cloud]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const pid = btn.dataset.deleteCloud;
            const project = (cloudProjects || []).find((item) => item.id === pid);
            const displayName = project?.projectName || project?.title || pid;
            if (!confirm(t('home_delete_confirm', { name: displayName }))) return;
            try {
                await deleteCloudProject(pid);
                await renderHomeDashboard();
            } catch (err) {
                console.error('[Home] Cloud delete failed:', err);
                alert(t('home_delete_error', { message: err.message }));
            }
        });
    });

    localGrid.querySelectorAll('.home-project-card').forEach((card) => {
        card.addEventListener('click', async () => {
            const snapshotId = card.dataset.id;
            try {
                const loadedState = await loadLocalRecentProject(snapshotId);
                dispatch({ type: actionTypes.LOAD_PROJECT, payload: loadedState });
                refresh();
                window.switchRoom('editor');
            } catch (e) {
                console.error('[Home] Local project restore failed:', e);
                alert(t('home_local_open_error', { message: e.message }));
            }
        });
    });

    syncStudioShell();
}

function updateAuthUI() {
    const signedIn = !!state.uid;
    const saveStatus = document.getElementById('save-status');
    const authSlotNav = document.getElementById('studio-auth-slot-nav');
    const authSlotMobile = document.getElementById('studio-auth-slot-mobile');

    if (authSlotNav) renderStudioAuthSlot(authSlotNav, state.user, { mobile: false, slotName: 'nav' });
    if (authSlotMobile) renderStudioAuthSlot(authSlotMobile, state.user, { mobile: true, slotName: 'mobile' });

    if (!signedIn && saveStatus && !saveStatus.textContent.trim()) {
        saveStatus.textContent = t('login_prompt');
        saveStatus.style.color = '#8a5d00';
    }
    document.body.classList.toggle('auth-guest', !signedIn);
    document.querySelectorAll('[data-auth-required]').forEach((el) => {
        el.disabled = !signedIn;
        el.title = !signedIn ? t('login_required') : '';
    });
    syncStudioShell();
}

let studioAuthGlobalBound = false;

function escapeStudioHtml(value) {
    if (value == null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function closeAllStudioAuthDropdowns() {
    document.querySelectorAll('.studio-auth-slot [data-auth-dropdown].open').forEach((dropdown) => {
        dropdown.classList.remove('open');
    });
    document.querySelectorAll('.studio-auth-slot [data-auth-trigger][aria-expanded="true"]').forEach((trigger) => {
        trigger.setAttribute('aria-expanded', 'false');
    });
}

function bindStudioAuthGlobalHandlers() {
    if (studioAuthGlobalBound) return;
    studioAuthGlobalBound = true;
    document.addEventListener('click', (event) => {
        if (event.target.closest('.studio-auth-slot')) return;
        closeAllStudioAuthDropdowns();
    });
}

function getStudioThemeButtonsMarkup() {
    const currentThemeMode = getThemeMode();
    return `
        <div class="auth-panel-section">
            <div class="auth-panel-label">${escapeStudioHtml(t('themeLabel'))}</div>
            <div class="theme-mode-switcher js-theme-switcher" role="group" aria-label="${escapeStudioHtml(t('themeLabel'))}">
                <button type="button" class="theme-mode-btn ${currentThemeMode === 'device' ? 'active' : ''}" data-theme-mode="device">${escapeStudioHtml(t('modeDevice'))}</button>
                <button type="button" class="theme-mode-btn ${currentThemeMode === 'light' ? 'active' : ''}" data-theme-mode="light">${escapeStudioHtml(t('modeLight'))}</button>
                <button type="button" class="theme-mode-btn ${currentThemeMode === 'dark' ? 'active' : ''}" data-theme-mode="dark">${escapeStudioHtml(t('modeDark'))}</button>
            </div>
        </div>
    `;
}

function getStudioAccountLinksMarkup() {
    return `
        <div class="auth-panel-links">
            <button type="button" class="auth-panel-link"><span class="material-icons">visibility_off</span><span>${escapeStudioHtml(t('restrictedMode'))}</span></button>
            <button type="button" class="auth-panel-link"><span class="material-icons">public</span><span>${escapeStudioHtml(t('location'))}</span></button>
            <button type="button" class="auth-panel-link"><span class="material-icons">settings</span><span>${escapeStudioHtml(t('settings'))}</span></button>
            <button type="button" class="auth-panel-link"><span class="material-icons">help_outline</span><span>${escapeStudioHtml(t('help'))}</span></button>
            <button type="button" class="auth-panel-link"><span class="material-icons">feedback</span><span>${escapeStudioHtml(t('feedback'))}</span></button>
        </div>
    `;
}

function getStudioAuthMarkup(user, { mobile = false, slotName = 'nav' } = {}) {
    const displayName = escapeStudioHtml(user?.displayName || user?.email || t('guest_label'));
    const photoUrl = escapeStudioHtml(user?.photoURL || '');
    const initials = escapeStudioHtml((user?.displayName || user?.email || 'U').trim().charAt(0).toUpperCase() || 'U');
    const avatarLabel = user ? displayName : escapeStudioHtml(t('btn_signin'));
    const avatarInner = photoUrl
        ? `<img src="${photoUrl}" alt="${displayName}" referrerpolicy="no-referrer">`
        : user
            ? `<span class="auth-initials">${initials}</span>`
            : `<span class="material-icons" aria-hidden="true">account_circle</span>`;
    const gisButtonId = `gis-btn-studio-${slotName}`;
    const fallbackClass = mobile ? 'mobile-auth-btn studio-signin-fallback' : 'btn-tool studio-signin-fallback';
    const signedOutSection = user ? '' : `
        <div class="auth-panel-section studio-auth-signin-section">
            <div id="${gisButtonId}" class="studio-gis-slot"></div>
            <button type="button" class="${fallbackClass}" data-auth-signin-fallback>${escapeStudioHtml(mobile ? t('btn_auth_mobile') : t('btn_signin'))}</button>
        </div>
    `;

    return `
        <div class="auth-user studio-auth-user ${mobile ? 'is-mobile' : 'is-desktop'}">
            <button type="button" class="auth-avatar-btn studio-auth-trigger" data-auth-trigger aria-label="${avatarLabel}" aria-expanded="false">
                ${avatarInner}
            </button>
            <div class="auth-dropdown auth-panel studio-auth-dropdown" data-auth-dropdown>
                <div class="auth-dropdown-name">${displayName}</div>
                ${getStudioThemeButtonsMarkup()}
                ${signedOutSection}
                ${getStudioAccountLinksMarkup()}
                ${user ? `<button type="button" class="btn-signout" data-auth-signout>${escapeStudioHtml(t('btn_signout'))}</button>` : ''}
            </div>
        </div>
    `;
}

function updateStudioThemeSwitchers() {
    const currentThemeMode = getThemeMode();
    document.querySelectorAll('.studio-auth-slot .js-theme-switcher .theme-mode-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.themeMode === currentThemeMode);
    });
}

function bindStudioAuthSlot(container, user, { mobile = false } = {}) {
    const trigger = container.querySelector('[data-auth-trigger]');
    const dropdown = container.querySelector('[data-auth-dropdown]');
    trigger?.addEventListener('click', (event) => {
        event.stopPropagation();
        const willOpen = !dropdown?.classList.contains('open');
        closeAllStudioAuthDropdowns();
        dropdown?.classList.toggle('open', willOpen);
        trigger.setAttribute('aria-expanded', String(willOpen));
    });
    dropdown?.addEventListener('click', async (event) => {
        const themeBtn = event.target.closest('.theme-mode-btn');
        if (themeBtn?.dataset.themeMode) {
            setThemeMode(themeBtn.dataset.themeMode);
            updateStudioThemeSwitchers();
            return;
        }
        if (event.target.closest('[data-auth-signout]')) {
            await signOutUser();
            return;
        }
    });
    container.querySelector('[data-auth-signin-fallback]')?.addEventListener('click', async () => {
        await signInWithGoogle();
    });

    if (!user) {
        const gisTarget = container.querySelector('.studio-gis-slot')?.id;
        if (gisTarget) {
            renderGISButton(gisTarget, {
                buttonOptions: mobile
                    ? {
                        theme: 'outline',
                        size: 'medium',
                        type: 'icon',
                        shape: 'pill',
                    }
                    : {
                        theme: 'outline',
                        size: 'medium',
                        type: 'standard',
                        shape: 'rectangular',
                        text: 'signin_with',
                        logo_alignment: 'left',
                    }
            }).catch((error) => console.warn(`[Auth] GIS ${mobile ? 'mobile' : 'desktop'} button render failed:`, error));
        }
    }
}

function renderStudioAuthSlot(container, user, options = {}) {
    if (!container) return;
    bindStudioAuthGlobalHandlers();
    container.innerHTML = getStudioAuthMarkup(user, options);
    bindStudioAuthSlot(container, user, options);
}

const THUMB_COLUMN_OPTIONS = [8, 5, 4, 2, 1];
const MOBILE_THUMB_SIZE_MAP = { s: 4, m: 2, l: 1 };
const MOBILE_THUMB_SIZE_BY_COLS = { 4: 's', 2: 'm', 1: 'l' };

function getDeviceKey() {
    return window.innerWidth < 1024 ? 'mobile' : 'desktop';
}

function getCurrentRoom() {
    return document.body.dataset.room || 'editor';
}

function getRoomLabel(room) {
    const keyMap = {
        home: 'nav_projects',
        editor: 'nav_editor',
        press: 'nav_press',
        works: 'nav_works'
    };
    return t(keyMap[room] || 'mobile_title');
}

function getMobileHeaderTitle(room) {
    if (room === 'editor') {
        return state.projectName || state.title || t('project_title_default');
    }
    return getRoomLabel(room);
}

function getMobileHeaderNavTarget(room) {
    if (room === 'editor') return 'home';
    if (room === 'press') return 'editor';
    if (room === 'works') return 'home';
    return null;
}

function isMobileHomeDrawerOpen() {
    return document.body.classList.contains('mobile-home-drawer-open');
}

function syncMobileHeader() {
    const room = getCurrentRoom();
    const navBtn = document.getElementById('mobile-header-nav');
    const roomLabel = document.getElementById('mobile-header-room-label');
    const title = document.getElementById('mobile-header-title');
    const navTarget = getMobileHeaderNavTarget(room);
    const roomText = getRoomLabel(room);

    if (roomLabel) {
        roomLabel.textContent = room === 'editor' ? roomText : t('mobile_title');
    }
    if (title) {
        title.textContent = getMobileHeaderTitle(room);
        title.title = title.textContent;
    }
    if (navBtn) {
        navBtn.hidden = !navTarget;
        navBtn.dataset.targetRoom = navTarget || '';
        navBtn.title = navTarget ? getRoomLabel(navTarget) : '';
        navBtn.setAttribute('aria-label', navBtn.title || roomText);
        const icon = navBtn.querySelector('.material-icons');
        if (icon) {
            icon.textContent = room === 'editor' ? 'menu_open' : 'arrow_back';
        }
        if (room === 'editor') {
            navBtn.title = t('tab_home');
            navBtn.setAttribute('aria-label', t('tab_home'));
        }
    }
}

function syncMobileCanvasZoomBar() {
    const zoomBar = document.getElementById('mobile-canvas-zoom-bar');
    if (!zoomBar) return;
    const visible = getDeviceKey() === 'mobile' && getCurrentRoom() === 'editor';
    zoomBar.hidden = !visible;
    document.body.classList.toggle('mobile-canvas-zoom-visible', visible);
    if (visible) syncCanvasZoomUI();
}

function syncStudioShell() {
    const device = getDeviceKey();
    const room = getCurrentRoom();

    document.body.dataset.device = device;
    document.body.classList.toggle('mobile-shell', device === 'mobile');
    document.body.classList.toggle('mobile-editor-shell', device === 'mobile' && room === 'editor');

    if ((device !== 'mobile' || room !== 'editor') && typeof window.closeMobileSheet === 'function') {
        window.closeMobileSheet();
    }
    if (device !== 'mobile' || room !== 'editor') {
        closeMobileHomeDrawer();
    }

    syncMobileHeader();
    syncMobileCanvasZoomBar();
    syncMobileMenuSheet();
    renderMobileBottomBar();
}

function sanitizeThumbColumns(value) {
    const n = Number(value);
    if (THUMB_COLUMN_OPTIONS.includes(n)) return n;
    return 2;
}

function getMobileThumbSizeKey(value = state.thumbColumns) {
    const n = sanitizeThumbColumns(value);
    return MOBILE_THUMB_SIZE_BY_COLS[n] || 'm';
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
    dispatch({ type: actionTypes.SET_THUMB_COLUMNS, payload: { columns: state.uiPrefs[key].thumbColumns, device: key } });
}

function syncThumbColumnButtons() {
    const active = sanitizeThumbColumns(state.thumbColumns);
    document.querySelectorAll('[data-thumb-cols]').forEach((btn) => {
        const isActive = Number(btn.dataset.thumbCols) === active;
        btn.classList.toggle('active', isActive);
    });
    const activeSize = getMobileThumbSizeKey(active);
    document.querySelectorAll('[data-thumb-size]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.thumbSize === activeSize);
    });
}

function setCurrentDeviceThumbColumns(cols) {
    ensureUiPrefs();
    const key = getDeviceKey();
    dispatch({ type: actionTypes.SET_THUMB_COLUMNS, payload: { columns: cols, device: key } });
}



// ──────────────────────────────────────
//  refresh — 画面全体を再描画する (Gen3: image pages only)
// ──────────────────────────────────────
function refresh(options = {}) {
    const skipAncillary = !!options.skipAncillary;
    const skipThumbs = !!options.skipThumbs;
    const visSelect = document.getElementById('prop-visibility');
    if (visSelect && document.activeElement !== visSelect) {
        visSelect.value = state.visibility || 'private';
    }

    syncBlocksFromState();
    const activeBlock = getActiveBlock();
    const s = state.sections[state.activeIdx];
    const render = document.getElementById('content-render');
    const lang = state.activeLang;
    const langProps = getLangProps(lang);

    // Normalize stale bubble selection
    if (state.activeBubbleIdx !== null && (!s?.bubbles || !s.bubbles[state.activeBubbleIdx])) {
        dispatch({ type: actionTypes.SET_ACTIVE_BUBBLE_INDEX, payload: null });
    }

    // メインキャンバスの描画 — image pages only
    if (s && s.type === 'image') {
        const pos = getActiveImagePosition();
        if (!s.imageBasePosition) {
            s.imageBasePosition = { x: 0, y: 0, scale: 1, rotation: 0, flipX: false };
        }
        const bgUrl = getOptimizedImageUrl(s.backgrounds?.[state.activeLang] || s.backgrounds?.[state.defaultLang] || s.background || '');
        _hideTextPreviewOverlay();

        if (!bgUrl) {
            // 画像未設定 → アップロード誘導プレースホルダーを表示
            render.innerHTML = `<div id="image-upload-placeholder" onclick="document.getElementById('file-upload').click()">
                <span class="material-icons">add_photo_alternate</span>
                <span class="placeholder-main" data-i18n="placeholder_drop_image">画像をドロップ</span>
                <span class="placeholder-sub" data-i18n="placeholder_or_click">またはクリックして選択</span>
            </div>`;
            document.getElementById('image-only-props').style.display = 'block';
            document.getElementById('bubble-layer').style.display = 'none';
        } else {
            const { frameMetrics, targetTransform, invScale } = getImageAdjustRenderMetrics(bgUrl, pos);
            const targetStyle = [
                `width:${frameMetrics.widthPercent}%`,
                `height:${frameMetrics.heightPercent}%`,
                `transform:${targetTransform};`
            ].join('; ');
            const stageOverlay = isImageAdjusting ? `
                <div id="image-stage-overlay">
                    <div class="image-safe-frame${imageSnapState.edgeLeft ? ' active-left' : ''}${imageSnapState.edgeRight ? ' active-right' : ''}${imageSnapState.edgeTop ? ' active-top' : ''}${imageSnapState.edgeBottom ? ' active-bottom' : ''}"></div>
                    <div class="image-center-guide vertical${imageSnapState.centerX ? ' active' : ''}"></div>
                    <div class="image-center-guide horizontal${imageSnapState.centerY ? ' active' : ''}"></div>
                </div>
            ` : '';

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
                    ${stageOverlay}
                    <div id="image-adjust-target" style="${targetStyle}">
                        <img id="main-img" src="${bgUrl}" onload="handleEditorImageLoad(event)">
                        ${overlayInTarget}
                    </div>
                </div>`;
            document.getElementById('image-only-props').style.display = 'block';
            document.getElementById('bubble-layer').style.display = 'block';
        }
    } else if (s && s.type === 'text') {
        render.innerHTML = '';
        document.getElementById('image-only-props').style.display = 'none';
        document.getElementById('bubble-layer').style.display = 'none';
        document.getElementById('bubble-shape-props').style.display = 'none';
        renderTextPreview(s);
    } else if (s) {
        render.innerHTML = '';
        document.getElementById('image-only-props').style.display = 'none';
        document.getElementById('bubble-layer').style.display = 'none';
        document.getElementById('bubble-shape-props').style.display = 'none';
        _hideTextPreviewOverlay();
    }

    // 吹き出し描画
    const editingEl = document.activeElement;
    const isDirectEditing = editingEl && editingEl.classList.contains('bubble-text')
        && editingEl.getAttribute('contenteditable') === 'true';

    if (s && s.type === 'image' && !isDirectEditing) {
        document.getElementById('bubble-layer').innerHTML = (s.bubbles || []).map((b, i) =>
            renderBubbleHTML(b, i, i === state.activeBubbleIdx, langProps.defaultWritingMode || 'horizontal-tb')
        ).join('');
    }

    // パネルUIの同期
    const propType = document.getElementById('prop-type');
    if (propType) {
        propType.disabled = false;
        propType.value = s?.type || 'image';
    }
    const deleteBtn = document.getElementById('btn-delete-active');
    if (deleteBtn) {
        deleteBtn.disabled = false;
        deleteBtn.title = '';
    }

    const isTextSection = s?.type === 'text';

    // FAB「テキスト追加」ボタンをテキストページでは非表示
    const fabAddBubble = document.getElementById('fab-add-bubble');
    if (fabAddBubble) fabAddBubble.style.display = isTextSection ? 'none' : '';

    // テキストページではキャンバスのクリックカーソルをデフォルトに戻す
    const canvasView = document.getElementById('canvas-view');
    if (canvasView) canvasView.style.cursor = isTextSection ? 'default' : '';

    // テキストセクション専用パネル
    const textSectionProps = document.getElementById('text-section-props');
    if (textSectionProps) {
        textSectionProps.style.display = isTextSection ? 'block' : 'none';
        if (isTextSection) {
            _syncTextSectionPanel(s);
        }
    }

    // 吹き出しテキストエディター（テキストセクションでは非表示）
    const genericTextEditor = document.getElementById('generic-text-editor');
    if (genericTextEditor) genericTextEditor.style.display = isTextSection ? 'none' : 'block';

    // テキストエリア: バブル選択時のテキスト表示
    const propTextEl = document.getElementById('prop-text');
    if (propTextEl) {
        if (!isTextSection && state.activeBubbleIdx !== null && s?.bubbles?.[state.activeBubbleIdx]) {
            propTextEl.value = getBubbleText(s.bubbles[state.activeBubbleIdx]);
        } else if (!isTextSection) {
            propTextEl.value = '';
        }
        propTextEl.style.display = isTextSection ? 'none' : 'block';
        propTextEl.readOnly = false;
    }

    // テキストラベルに現在の言語を表示
    const textLabel = document.getElementById('text-label');
    if (textLabel) {
        textLabel.textContent = `テキスト入力 [${langProps.label}]`;
    }

    // 吹き出し形状＆カラーセレクタの同期（テキストセクションでは非表示）
    const shapeProps = document.getElementById('bubble-shape-props');
    if (!isTextSection && state.activeBubbleIdx !== null && s?.bubbles?.[state.activeBubbleIdx]) {
        if (shapeProps) shapeProps.style.display = 'block';
        updateBubblePropPanel(s.bubbles[state.activeBubbleIdx]);
    } else {
        if (shapeProps) shapeProps.style.display = 'none';
        updateBubblePropPanel(null);
    }

    // プロジェクト名表示
    const titleEl = document.getElementById('project-title');
    if (titleEl && document.activeElement !== titleEl) {
        titleEl.textContent = getProjectDisplayName();
    }

    // 作品タイトル同期
    const propTitle = document.getElementById('prop-title');
    if (propTitle && document.activeElement !== propTitle) {
        propTitle.value = state.title || '';
    }
    // キャンバス下部のページ番号ラベルを更新
    const canvasPageLabel = document.getElementById('canvas-page-label');
    if (canvasPageLabel) {
        const totalPages = (state.sections || []).length;
        const currentPage = (state.activeIdx ?? 0) + 1;
        const langCode = (state.activeLang || 'ja').toUpperCase();
        canvasPageLabel.textContent = `${currentPage} / ${totalPages} ${langCode}`;
    }

    // 言語タブの更新
    if (!skipAncillary) {
        renderLangTabs();
        syncLangPanel();
        renderLangSettings();
        updateHistoryButtons();
    }
    if (!skipThumbs) {
        renderThumbs();
    }
    if (!skipAncillary) {
        syncThumbColumnButtons();
        syncStudioShell();
    }
}

function captureViewportSnapshot() {
    const sidebarPages = document.querySelector('.sidebar-pages');
    const editorMain = document.getElementById('editor-main');
    return {
        windowX: window.scrollX,
        windowY: window.scrollY,
        sidebarPagesScrollTop: sidebarPages?.scrollTop ?? 0,
        editorMainScrollTop: editorMain?.scrollTop ?? 0
    };
}

function restoreViewportSnapshot(snapshot) {
    if (!snapshot) return;
    requestAnimationFrame(() => {
        window.scrollTo(snapshot.windowX, snapshot.windowY);
        const sidebarPages = document.querySelector('.sidebar-pages');
        if (sidebarPages) sidebarPages.scrollTop = snapshot.sidebarPagesScrollTop;
        const editorMain = document.getElementById('editor-main');
        if (editorMain) editorMain.scrollTop = snapshot.editorMainScrollTop;
    });
}

function refreshForThumbSelection() {
    const snapshot = captureViewportSnapshot();
    refresh({ skipAncillary: true, skipThumbs: true });
    syncThumbSelectionDom();
    restoreViewportSnapshot(snapshot);
}

function syncThumbSelectionDom() {
    document.querySelectorAll('.thumb-wrap, .thumb-row').forEach((el) => {
        const blockIndex = Number(el.dataset.blockIndex);
        const isActive = Number.isInteger(blockIndex) && blockIndex === state.activeBlockIdx;
        el.classList.toggle('active', isActive);
        el.setAttribute('aria-current', isActive ? 'true' : 'false');
    });
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
    ['lang-tabs', 'lang-tabs-mobile', 'lang-tabs-top'].forEach((id) => {
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
            ? `<button class="btn-sm lang-item-remove" onclick="removeLang('${code}')">✕</button>`
            : '';

        // 複数方向対応の言語にはインラインセレクトを表示
        let dirSelect = '';
        if (props.directions && props.directions.length > 1) {
            const currentDir = state.languageConfigs?.[code]?.pageDirection || props.directions[0].value;
            const options = props.directions.map(d => {
                const sel = d.value === currentDir ? ' selected' : '';
                return `<option value="${d.value}"${sel}>${d.label}</option>`;
            }).join('');
            dirSelect = `<select class="lang-dir-select" onchange="changeLangDirection('${code}', this.value)">${options}</select>`;
        }

        return `<div class="lang-item"><span class="lang-item-label">${props.label}</span>${dirSelect}${removeBtn}</div>`;
    }).join('');
}

window.changeLangDirection = (code, dir) => {
    if (!state.languageConfigs) state.languageConfigs = {};
    if (!state.languageConfigs[code]) state.languageConfigs[code] = {};
    state.languageConfigs[code].pageDirection = dir;
    renderLangSettings();
    renderProjectSettingsTable();
    triggerAutoSave();
};

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
        el.classList.remove(
            'drop-before',
            'drop-after',
            'drag-source',
            'preview-gap-left',
            'preview-gap-right',
            'preview-gap-left-edge',
            'preview-gap-right-edge'
        );
    });
    document.getElementById('thumb-drop-indicator')?.remove();
    document.getElementById('thumb-drop-preview')?.remove();
}

function getThumbElement(index) {
    return document.querySelector(`.thumb-wrap[data-section-index="${index}"]`);
}

function setThumbDeleteDropzoneActive(active) {
    const zone = document.getElementById('thumb-delete-dropzone');
    if (!zone) return;
    zone.classList.toggle('is-active', !!active);
}

function clearThumbDeleteDropzone() {
    document.body.classList.remove('thumb-delete-mode');
    setThumbDeleteDropzoneActive(false);
}

function isPointInThumbDeleteDropzone(clientX, clientY) {
    const zone = document.getElementById('thumb-delete-dropzone');
    if (!zone || zone.offsetParent === null) return false;
    const rect = zone.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function getThumbTargetFromPoint(clientX, clientY) {
    const hit = document.elementFromPoint(clientX, clientY);
    const direct = hit ? hit.closest('.thumb-wrap') : null;
    if (direct) return direct;
    const container = document.getElementById('thumb-container');
    if (!container) return null;
    const thumbs = [...container.querySelectorAll('.thumb-wrap[data-section-index]')];
    if (!thumbs.length) return null;
    let nearest = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    thumbs.forEach((thumb) => {
        const rect = thumb.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const dist = Math.hypot(clientX - centerX, clientY - centerY);
        if (dist < nearestDistance) {
            nearest = thumb;
            nearestDistance = dist;
        }
    });
    return nearest;
}

function getThumbVisualThumbs() {
    const container = document.getElementById('thumb-container');
    if (!container) return [];
    return [...container.querySelectorAll('.thumb-wrap[data-section-index]')].sort((a, b) => {
        const rectA = a.getBoundingClientRect();
        const rectB = b.getBoundingClientRect();
        return rectA.left - rectB.left;
    });
}

function getMobileThumbInsertTarget(clientX) {
    const container = document.getElementById('thumb-container');
    if (!container) return null;
    const sourceIndex = Number(thumbTouchState?.sourceIndex ?? thumbDragSourceIdx);
    const sourceEl = getThumbElement(sourceIndex);
    if (!sourceEl) return null;
    const sourceRect = sourceEl.getBoundingClientRect();
    const visualThumbs = getThumbVisualThumbs().filter((thumb) => Number(thumb.dataset.sectionIndex) !== sourceIndex);
    const dir = container.dataset.dir === 'rtl' ? 'rtl' : 'ltr';
    if (!visualThumbs.length) {
        const containerRect = container.getBoundingClientRect();
        return {
            insertIndex: 0,
            boundary: containerRect.left + sourceRect.width / 2,
            top: sourceRect.top,
            height: sourceRect.height,
            sourceRect,
            leftEl: null,
            rightEl: null
        };
    }
    const rects = visualThumbs.map((thumb) => ({
        el: thumb,
        index: Number(thumb.dataset.sectionIndex),
        rect: thumb.getBoundingClientRect()
    }));
    const first = rects[0];
    const last = rects[rects.length - 1];
    if (clientX <= first.rect.left + first.rect.width / 2) {
        return {
            insertIndex: dir === 'rtl' ? first.index + 1 : first.index,
            boundary: first.rect.left,
            top: first.rect.top,
            height: first.rect.height,
            sourceRect,
            leftEl: null,
            rightEl: first.el
        };
    }
    for (let i = 0; i < rects.length - 1; i += 1) {
        const left = rects[i];
        const right = rects[i + 1];
        const midpoint = (left.rect.right + right.rect.left) / 2;
        if (clientX <= midpoint) {
            return {
                insertIndex: dir === 'rtl' ? left.index : right.index,
                boundary: (left.rect.right + right.rect.left) / 2,
                top: Math.min(left.rect.top, right.rect.top),
                height: Math.max(left.rect.height, right.rect.height),
                sourceRect,
                leftEl: left.el,
                rightEl: right.el
            };
        }
    }
    return {
        insertIndex: dir === 'rtl' ? last.index : last.index + 1,
        boundary: last.rect.right,
        top: last.rect.top,
        height: last.rect.height,
        sourceRect,
        leftEl: last.el,
        rightEl: null
    };
}

function showMobileThumbInsertPreview(target) {
    const container = document.getElementById('thumb-container');
    const sourceEl = getThumbElement(thumbTouchState?.sourceIndex ?? thumbDragSourceIdx);
    if (!container || !sourceEl || !target) return;
    clearThumbDropHints();
    sourceEl.classList.add('drag-source');

    const containerRect = container.getBoundingClientRect();
    const leftPx = target.boundary - containerRect.left + container.scrollLeft;
    const topPx = target.top - containerRect.top + container.scrollTop;

    if (target.leftEl && target.rightEl) {
        target.leftEl.classList.add('preview-gap-right');
        target.rightEl.classList.add('preview-gap-left');
    } else if (target.leftEl) {
        target.leftEl.classList.add('preview-gap-right-edge');
    } else if (target.rightEl) {
        target.rightEl.classList.add('preview-gap-left-edge');
    }

    const indicator = document.createElement('div');
    indicator.id = 'thumb-drop-indicator';
    indicator.style.left = `${leftPx - 2}px`;
    indicator.style.top = `${topPx + 6}px`;
    indicator.style.height = `${Math.max(40, target.height - 12)}px`;
    container.appendChild(indicator);

    const preview = sourceEl.cloneNode(true);
    preview.id = 'thumb-drop-preview';
    preview.removeAttribute('onclick');
    preview.removeAttribute('ontouchstart');
    preview.removeAttribute('draggable');
    preview.style.width = `${target.sourceRect.width}px`;
    preview.style.minWidth = `${target.sourceRect.width}px`;
    preview.style.left = `${leftPx - target.sourceRect.width / 2}px`;
    preview.style.top = `${topPx}px`;
    container.appendChild(preview);
}

function markThumbDropHint(index, position) {
    clearThumbDropHints();
    const sourceEl = getThumbElement(thumbDragSourceIdx);
    if (sourceEl) sourceEl.classList.add('drag-source');
    const el = getThumbElement(index);
    if (!el) return;
    el.classList.add(position === 'before' ? 'drop-before' : 'drop-after');
}

function getDropPositionByPoint(el, clientX, clientY) {
    const rect = el.getBoundingClientRect();
    if (window.innerWidth < 1024) {
        const isRtl = window.getComputedStyle(el.parentElement).flexDirection === 'row-reverse';
        const before = clientX < (rect.left + rect.width / 2);
        if (isRtl) return before ? 'after' : 'before';
        return before ? 'before' : 'after';
    }
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

function moveSectionToInsertIndexWithHistory(fromIndex, insertIndex) {
    const from = Number(fromIndex);
    const to = Math.max(0, Math.min(Number(insertIndex), state.sections.length));
    if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
    if (to === from || to === from + 1) return false;
    pushState();
    moveSection(from, to, refresh);
    triggerAutoSave();
    return true;
}

function deleteSectionWithHistory(sectionIndex) {
    const idx = Number(sectionIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= state.sections.length) return false;
    if (state.sections.length <= 1) return false;
    pushState();
    deleteSectionAt(idx, refreshForThumbSelection);
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
    thumbTouchState.lastX = touch.clientX;
    thumbTouchState.lastY = touch.clientY;

    const dx = touch.clientX - thumbTouchState.startX;
    const dy = touch.clientY - thumbTouchState.startY;

    if (!thumbTouchState.active) {
        if (Math.abs(dx) > 18 && Math.abs(dx) > Math.abs(dy) + 6) {
            thumbTouchState = null;
            unbindTouchDragListeners();
            clearThumbDropHints();
            clearThumbDeleteDropzone();
            thumbDragSourceIdx = null;
            return;
        }
        if (dy <= -12 && Math.abs(dy) > Math.abs(dx) + 4) {
            thumbTouchState.active = true;
            thumbTouchState.mode = 'move';
            const sourceEl = getThumbElement(thumbTouchState.sourceIndex);
            if (sourceEl) sourceEl.classList.add('drag-source');
        } else if (dy >= 12 && Math.abs(dy) > Math.abs(dx) + 4) {
            thumbTouchState.active = true;
            thumbTouchState.mode = 'delete';
            document.body.classList.add('thumb-delete-mode');
            setThumbDeleteDropzoneActive(false);
            const sourceEl = getThumbElement(thumbTouchState.sourceIndex);
            if (sourceEl) sourceEl.classList.add('drag-source');
        } else {
            return;
        }
    }

    e.preventDefault();
    if (thumbTouchState.mode === 'delete') {
        clearThumbDropHints();
        setThumbDeleteDropzoneActive(isPointInThumbDeleteDropzone(touch.clientX, touch.clientY));
        return;
    }

    if (window.innerWidth < 1024) {
        const target = getMobileThumbInsertTarget(touch.clientX);
        if (target) {
            thumbTouchState.insertIndex = target.insertIndex;
            showMobileThumbInsertPreview(target);
        }
    } else {
        const wrap = getThumbTargetFromPoint(touch.clientX, touch.clientY);
        if (!wrap) return;
        const targetIndex = Number(wrap.dataset.sectionIndex);
        if (!Number.isInteger(targetIndex)) return;
        const position = getDropPositionByPoint(wrap, touch.clientX, touch.clientY);
        thumbTouchState.targetIndex = targetIndex;
        thumbTouchState.position = position;
        markThumbDropHint(targetIndex, position);
    }

    const container = document.getElementById('thumb-container');
    if (container) {
        const cRect = container.getBoundingClientRect();
        if (window.innerWidth < 1024) {
            if (touch.clientX < cRect.left + 40) container.scrollBy({ left: -24, behavior: 'auto' });
            if (touch.clientX > cRect.right - 40) container.scrollBy({ left: 24, behavior: 'auto' });
        } else {
            if (touch.clientY < cRect.top + 40) container.scrollBy({ top: -20, behavior: 'auto' });
            if (touch.clientY > cRect.bottom - 40) container.scrollBy({ top: 20, behavior: 'auto' });
        }
    }
}

function onThumbTouchEnd(e) {
    if (!thumbTouchState) return;
    const endTouch = e?.changedTouches?.[0];
    const endX = endTouch?.clientX ?? thumbTouchState.lastX ?? thumbTouchState.startX;
    const endY = endTouch?.clientY ?? thumbTouchState.lastY ?? thumbTouchState.startY;
    let changed = false;
    if (thumbTouchState.active) {
        if (thumbTouchState.mode === 'delete') {
            if (isPointInThumbDeleteDropzone(endX, endY)) {
                changed = deleteSectionWithHistory(thumbTouchState.sourceIndex);
            }
        } else {
            if (window.innerWidth < 1024) {
                const target = getMobileThumbInsertTarget(endX);
                if (target) {
                    thumbTouchState.insertIndex = target.insertIndex;
                    showMobileThumbInsertPreview(target);
                }
                if (Number.isInteger(thumbTouchState.insertIndex)) {
                    changed = moveSectionToInsertIndexWithHistory(thumbTouchState.sourceIndex, thumbTouchState.insertIndex);
                }
            } else {
                const endWrap = getThumbTargetFromPoint(endX, endY);
                if (endWrap) {
                    const endTargetIndex = Number(endWrap.dataset.sectionIndex);
                    if (Number.isInteger(endTargetIndex)) {
                        thumbTouchState.targetIndex = endTargetIndex;
                        thumbTouchState.position = getDropPositionByPoint(endWrap, endX, endY);
                        markThumbDropHint(endTargetIndex, thumbTouchState.position);
                    }
                }
                if (Number.isInteger(thumbTouchState.targetIndex)) {
                    changed = moveSectionWithHistory(thumbTouchState.sourceIndex, thumbTouchState.targetIndex, thumbTouchState.position || 'after');
                }
            }
        }
    } else if (thumbTouchState.mode === 'delete' && isPointInThumbDeleteDropzone(endX, endY)) {
        changed = deleteSectionWithHistory(thumbTouchState.sourceIndex);
    } else {
        changeSection(thumbTouchState.sourceIndex, refreshForThumbSelection);
        changed = true;
    }
    if (changed) {
        suppressThumbClickUntil = Date.now() + 350;
    }
    thumbTouchState = null;
    unbindTouchDragListeners();
    clearThumbDropHints();
    clearThumbDeleteDropzone();
    thumbDragSourceIdx = null;
}

function onThumbTouchCancel() {
    if (!thumbTouchState) return;
    thumbTouchState = null;
    unbindTouchDragListeners();
    clearThumbDropHints();
    clearThumbDeleteDropzone();
    thumbDragSourceIdx = null;
}

// ──────────────────────────────────────
//  セクションプロパティ更新
// ──────────────────────────────────────
function update(k, v) {
    const activeBlock = getActiveBlock();
    if (activeBlock && activeBlock.kind !== 'page') return;
    const s = state.sections[state.activeIdx];
    if (!s) return;
    pushState();
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
    const cw = view.clientWidth || CANONICAL_PAGE_WIDTH;
    const ch = view.clientHeight || CANONICAL_PAGE_HEIGHT;
    const halfW = CANONICAL_PAGE_WIDTH / 2;
    const halfH = CANONICAL_PAGE_HEIGHT / 2;
    const visibilityFactor = Math.max(
        1,
        pos?.scale || 1,
        1 + Math.abs(pos?.x || 0) / halfW,
        1 + Math.abs(pos?.y || 0) / halfH
    );
    const needW = CANONICAL_PAGE_WIDTH * visibilityFactor;
    const needH = CANONICAL_PAGE_HEIGHT * visibilityFactor;
    const s = Math.min(cw / needW, ch / needH) * 0.82;
    return Math.min(Math.max(s, 0.22), 0.9);
}

function getActiveImagePosition() {
    const s = state.sections[state.activeIdx];
    if (!s || s.type !== 'image') return null;
    const lang = state.activeLang || state.defaultLang || 'ja';
    if (!s.imagePositions) s.imagePositions = {};
    if (!s.imagePositions[lang]) {
        // Migrate from legacy shared imagePosition on first access
        const legacy = s.imagePosition || {};
        s.imagePositions[lang] = {
            x: Number.isFinite(Number(legacy.x)) ? Number(legacy.x) : 0,
            y: Number.isFinite(Number(legacy.y)) ? Number(legacy.y) : 0,
            scale: Math.max(0.1, Number.isFinite(Number(legacy.scale)) ? Number(legacy.scale) : 1),
            rotation: Number.isFinite(Number(legacy.rotation)) ? Number(legacy.rotation) : 0,
            flipX: legacy.flipX || false
        };
    }
    const pos = s.imagePositions[lang];
    const toNum = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
    pos.x = toNum(pos.x, 0);
    pos.y = toNum(pos.y, 0);
    pos.scale = Math.max(0.1, toNum(pos.scale, 1));
    pos.rotation = toNum(pos.rotation, 0);
    if (pos.flipX === undefined) pos.flipX = false;
    if (!s.imageBasePosition) s.imageBasePosition = { x: 0, y: 0, scale: 1, rotation: 0, flipX: false };
    return pos;
}

function getPointerClientPoint(e) {
    if (e.touches && e.touches[0]) {
        return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
}

function roundRotationHalfStep(value) {
    const n = Number(value) || 0;
    return Math.round(n * 2) / 2;
}

window.adjustImageZoom = (delta) => {
    const pos = getActiveImagePosition();
    if (!isImageAdjusting || !pos) return;
    pushState();
    pos.scale = Math.max(0.1, pos.scale + delta);
    const s = state.sections[state.activeIdx];
    const bgUrl = getOptimizedImageUrl(s?.backgrounds?.[state.activeLang] || s?.backgrounds?.[state.defaultLang] || s?.background || '');
    applyImageSnapping(pos, bgUrl);
    scheduleImageAdjustDomUpdate();
    triggerAutoSave();
};

window.resetImageTransform = () => {
    const s = state.sections[state.activeIdx];
    const pos = getActiveImagePosition();
    if (!isImageAdjusting || !s || !pos) return;
    const base = s.imageBasePosition || { x: 0, y: 0, scale: 1, rotation: 0, flipX: false };
    pushState();
    pos.x = base.x || 0;
    pos.y = base.y || 0;
    pos.scale = base.scale || 1;
    pos.rotation = base.rotation || 0;
    pos.flipX = base.flipX || false;
    resetImageSnapState();
    scheduleImageAdjustDomUpdate();
    triggerAutoSave();
};

window.toggleImageFlipX = () => {
    const pos = getActiveImagePosition();
    if (!isImageAdjusting || !pos) return;
    pushState();
    pos.flipX = !pos.flipX;
    scheduleImageAdjustDomUpdate();
    triggerAutoSave();
};

window.setImageRotationFromSlider = (value) => {
    const pos = getActiveImagePosition();
    if (!isImageAdjusting || !pos) return;
    const rotation = roundRotationHalfStep(Math.max(-180, Math.min(180, Number(value) || 0)));
    pos.rotation = rotation;
    const s = state.sections[state.activeIdx];
    const bgUrl = getOptimizedImageUrl(s?.backgrounds?.[state.activeLang] || s?.backgrounds?.[state.defaultLang] || s?.background || '');
    applyImageSnapping(pos, bgUrl);
    scheduleImageAdjustDomUpdate();
};

window.startImageRotationSliderAdjust = (event) => {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
        if (event.currentTarget?.setPointerCapture && event.pointerId != null) {
            event.currentTarget.setPointerCapture(event.pointerId);
        }
    }
    isAdjustingRotationSlider = true;
    window.moveImageRotationSliderAdjust(event);
};

window.endImageRotationSliderAdjust = (event) => {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
        if (event.currentTarget?.releasePointerCapture && event.pointerId != null) {
            try {
                event.currentTarget.releasePointerCapture(event.pointerId);
            } catch { }
        }
    }
    isAdjustingRotationSlider = false;
};

window.moveImageRotationSliderAdjust = (event) => {
    if (!isAdjustingRotationSlider || !event?.currentTarget) return;
    event.stopPropagation();
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.height) return;
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    const ratio = y / rect.height;
    const rotation = 180 - (ratio * 360);
    window.setImageRotationFromSlider(rotation);
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
    window.addEventListener('mousemove', onImageHandleDragMove);
    window.addEventListener('mouseup', onImageHandleDragEnd);
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
    const s = state.sections[state.activeIdx];
    const bgUrl = getOptimizedImageUrl(s?.backgrounds?.[state.activeLang] || s?.backgrounds?.[state.defaultLang] || s?.background || '');
    applyImageSnapping(pos, bgUrl);
    scheduleImageAdjustDomUpdate();
}

function onImageHandleDragEnd() {
    if (!imageHandleDrag) return;
    imageHandleDrag = null;
    resetImageSnapState();
    window.removeEventListener('mousemove', onImageHandleDragMove);
    window.removeEventListener('mouseup', onImageHandleDragEnd);
    const s = state.sections[state.activeIdx];
    if (s && state.uid) {
        const lang = state.activeLang || state.defaultLang || 'ja';
        const thumbBgUrl = s.backgrounds?.[lang] || s.backgrounds?.[state.defaultLang] || s.background || '';
        const thumbPos = getActiveImagePosition() || s.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 };
        if (thumbBgUrl) {
            generateCroppedThumbnail(thumbBgUrl, thumbPos, refresh)
                .catch(e => console.warn('[DSF] Thumbnail update skipped (onImageHandleDragEnd):', e));
        }
    }
    triggerAutoSave();
}

window.toggleImageAdjustment = () => {
    const s = state.sections[state.activeIdx];
    if (!s || s.type !== 'image') return;

    isImageAdjusting = !isImageAdjusting;
    if (!isImageAdjusting) {
        isAdjustingRotationSlider = false;
    }

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
            resetImageSnapState();
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
        const pos = getActiveImagePosition() || s.imagePosition || { x: 0, y: 0, scale: 1 };
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

    // 調整モード確定: refresh で handles 表示/非表示を切り替える
    refresh();
    // 調整モード終了時に値を確定して保存＋サムネイル再生成
    if (!isImageAdjusting) {
        triggerAutoSave();
        // サムネイル更新（多言語対応: backgrounds[activeLang] を優先使用）
        const lang = state.activeLang || state.defaultLang || 'ja';
        const thumbBgUrl = s.backgrounds?.[lang] || s.backgrounds?.[state.defaultLang] || s.background || '';
        const thumbPos = getActiveImagePosition() || s.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 };
        if (thumbBgUrl && state.uid) {
            generateCroppedThumbnail(
                thumbBgUrl,
                thumbPos,
                refresh
            ).catch(e => console.warn('[DSF] Thumbnail update skipped (toggleImageAdjustment):', e));
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

    // Events

    const onMove = (clientX, clientY) => {
        if (isAdjustingRotationSlider) return;
        const dx = clientX - startPos.x;
        const dy = clientY - startPos.y;
        const pos = getActiveImagePosition();
        if (!pos) return;
        pos.x = startTransform.x + dx / canvasScale;
        pos.y = startTransform.y + dy / canvasScale;
        const s = state.sections[state.activeIdx];
        const bgUrl = getOptimizedImageUrl(s?.backgrounds?.[state.activeLang] || s?.backgrounds?.[state.defaultLang] || s?.background || '');
        applyImageSnapping(pos, bgUrl);
        scheduleImageAdjustDomUpdate();
    };

    const onMoveWrap = (e) => onMove(e.clientX, e.clientY);

    const onEnd = () => {
        if (isDraggingImg) {
            isDraggingImg = false;
            resetImageSnapState();
            const s = state.sections[state.activeIdx];
            if (s && state.uid) {
                const lang = state.activeLang || state.defaultLang || 'ja';
                const thumbBgUrl = s.backgrounds?.[lang] || s.backgrounds?.[state.defaultLang] || s.background || '';
                const thumbPos = getActiveImagePosition() || s.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 };
                if (thumbBgUrl) {
                    generateCroppedThumbnail(thumbBgUrl, thumbPos, refresh)
                        .catch(e => console.warn('[DSF] Thumbnail update skipped (onEnd):', e));
                }
            }
            triggerAutoSave();
        }
        window.removeEventListener('mousemove', onMoveWrap);
        window.removeEventListener('mouseup', onEnd);
    };

    const onStart = (clientX, clientY) => {
        if (!isImageAdjusting || isAdjustingRotationSlider) return;
        isDraggingImg = true;
        startPos = { x: clientX, y: clientY };
        const pos = getActiveImagePosition();
        startTransform = pos ? { x: pos.x, y: pos.y } : { x: 0, y: 0 };
        window.addEventListener('mousemove', onMoveWrap);
        window.addEventListener('mouseup', onEnd);
    };

    // Mouse
    view.addEventListener('mousedown', (e) => {
        if (isAdjustingRotationSlider) return;
        const inAdjustTarget = !!(e.target && e.target.closest && e.target.closest('#image-adjust-target'));
        if (isImageAdjusting && (e.target.id === 'main-img' || inAdjustTarget)) {
            e.stopPropagation(); // Stop canvas pan
            e.preventDefault();
            onStart(e.clientX, e.clientY);
        }
    });

    // Touch
    view.addEventListener('touchstart', (e) => {
        if (isAdjustingRotationSlider) return;
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
                const pos = getActiveImagePosition();
                startScale = pos?.scale || 1;
            }
        }
    }, { passive: false });

    view.addEventListener('touchmove', (e) => {
        onImageHandleDragMove(e);
        if (!isImageAdjusting) return;
        if (isAdjustingRotationSlider) {
            e.preventDefault();
            return;
        }
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
            const pos = getActiveImagePosition();
            if (!pos) return;
            pos.scale = Math.max(0.1, startScale * scale);
            const s = state.sections[state.activeIdx];
            const bgUrl = getOptimizedImageUrl(s?.backgrounds?.[state.activeLang] || s?.backgrounds?.[state.defaultLang] || s?.background || '');
            applyImageSnapping(pos, bgUrl);
            scheduleImageAdjustDomUpdate();
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
            const pos = getActiveImagePosition();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            pos.scale = Math.max(0.1, (pos.scale || 1) * delta);
            const s = state.sections[state.activeIdx];
            const bgUrl = getOptimizedImageUrl(s?.backgrounds?.[state.activeLang] || s?.backgrounds?.[state.defaultLang] || s?.background || '');
            applyImageSnapping(pos, bgUrl);
            scheduleImageAdjustDomUpdate();
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
function updateActiveText(v) {
    const s = state.sections[state.activeIdx];
    if (!s) return;
    if (!textPushTimer) {
        pushState();
    } else {
        clearTimeout(textPushTimer);
    }
    textPushTimer = setTimeout(() => { textPushTimer = null; }, 500);

    if (state.activeBubbleIdx !== null && s.bubbles && s.bubbles[state.activeBubbleIdx]) {
        setBubbleText(s.bubbles[state.activeBubbleIdx], v);
    }
    refresh();
    triggerAutoSave();
}

// ──────────────────────────────────────────────────────────────
//  テキストセクション キャンバスプレビュー
// ──────────────────────────────────────────────────────────────

function _hideTextPreviewOverlay() {
    const overlay = document.getElementById('text-preview-overlay');
    if (overlay) overlay.style.display = 'none';
}

/** HTML 特殊文字をエスケープ */
function _escHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * 縦書き列の 1 行を HTML にマークアップする。
 * 2〜4 桁の半角数字を <span class="tcy"> でラップし縦中横（Tate-Chu-Yoko）を適用する。
 * ルビなし plain-text 用。ruby 付き行は _markupTokenLine を使用する。
 */
function _markupVerticalLine(rawLine) {
    if (!rawLine) return '\u00a0';
    return _markupTcyText(rawLine) || '\u00a0';
}

/**
 * トークン行（alignRubyToLines の 1 要素）を HTML にマークアップする。
 * - plain text token: _escHtml + TCY 数字ラップ（_markupVerticalLine 相当）
 * - ruby token: <ruby><rb>base</rb><rt>ruby</rt></ruby>（base にも TCY 適用）
 * 縦書き・横書き両方で使用できる。
 */
function _markupTokenLine(tokenLine) {
    if (!tokenLine || !tokenLine.length) return '\u00a0';
    const parts = [];
    for (const tok of tokenLine) {
        if (tok.kind === 'ruby') {
            const markedBase = _markupTcyText(tok.base);
            const rubyText = _escHtml(tok.ruby || '');
            parts.push(`<ruby>${markedBase}<rt>${rubyText}</rt></ruby>`);
        } else {
            parts.push(_markupTcyText(tok.text || ''));
        }
    }
    const html = parts.join('');
    return html || '\u00a0';
}

/** 文字列内の 2〜4 桁の半角数字に TCY span を適用する（内部ヘルパー） */
function _markupTcyText(text) {
    if (!text) return '';
    const parts = [];
    let lastIdx = 0;
    const re = /[0-9]{2,4}/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        if (m.index > lastIdx) {
            parts.push(_escHtml(text.slice(lastIdx, m.index)));
        }
        parts.push(`<span class="tcy">${m[0]}</span>`);
        lastIdx = re.lastIndex;
    }
    if (lastIdx < text.length) {
        parts.push(_escHtml(text.slice(lastIdx)));
    }
    return parts.length ? parts.join('') : _escHtml(text);
}

/**
 * composeText の lines 配列を縦書き連続フロー用 HTML に変換する。
 * 空行（段落区切り）は全角スペース（字下げ代わり）に変換し、
 * 行間スペースを入れずに連結することで CSS のマルチカラムフロー
 * （column-fill: auto）が列を上から下まで充填できるようにする。
 */
function _buildCjkHtmlFlow(lines) {
    const parts = [];
    for (const line of lines) {
        if (line === '') {
            parts.push('\u3000'); // 段落区切り → 字下げ（U+3000 ideographic space）
        } else {
            parts.push(_markupVerticalLine(line));
        }
    }
    return parts.join('');
}

/**
 * composeText の lines 配列を段落単位に再結合する（横書き向け）。
 * 連続する非空行をスペースで繋ぎ、空行は null（ブランク行）として返す。
 * CSS が justify + hyphens で再ラップできるよう、行分割を解除する。
 */
function _linesIntoParagraphs(lines) {
    const result = [];
    let buf = [];
    for (const line of lines) {
        if (line === '') {
            if (buf.length) { result.push(buf.join(' ')); buf = []; }
            result.push(null);
        } else {
            buf.push(line);
        }
    }
    if (buf.length) result.push(buf.join(' '));
    return result;
}

/**
 * ルビあり横書き向け: alignRubyToLines の token-line 配列を段落単位に結合する。
 * 空行（lines[i] === ''）は null として返す。
 * 連続する token 行のトークンを結合し、text トークン間にスペースを挿入する。
 * @param {Array<Array>} rubyLines  alignRubyToLines の返り値
 * @param {string[]} lines          composeText の lines（空行判定用）
 * @returns {Array<Array<token>|null>}
 */
function _tokenLinesIntoParagraphs(rubyLines, lines) {
    const result = [];
    let buf = [];

    function flushBuf() {
        if (!buf.length) return;
        // 複数行のトークンをスペース区切りで結合（行境界にスペースを挿入）
        const merged = [];
        for (let i = 0; i < buf.length; i++) {
            merged.push(...buf[i]);
            if (i < buf.length - 1) {
                merged.push({ kind: 'text', text: ' ' });
            }
        }
        result.push(merged);
        buf = [];
    }

    for (let i = 0; i < lines.length; i++) {
        if (lines[i] === '') {
            flushBuf();
            result.push(null);
        } else {
            buf.push(rubyLines[i] || []);
        }
    }
    flushBuf();
    return result;
}

/**
 * テキストセクションの組版結果をキャンバス上の HTML オーバーレイとして描画する。
 *
 * ▼ 縦書き (vertical-rl)
 *   - 列ごとに <span class="tpv-col"> を生成し、flex row-reverse で右端から配置
 *   - 列幅   = frame.w / maxLines（全列が枠内に収まるよう均等割り）
 *   - 文字ピッチ = frame.h / charsPerLine（縦方向均等割り）
 *   - 2〜4 桁の半角数字に <span class="tcy"> を自動付与（縦中横）
 *   - {base|ruby} 記法を <ruby> タグに変換（ルビ）
 *
 * ▼ 横書き (horizontal-tb)
 *   - 行を段落ごとに結合し、<p class="tpv-para"> として流し込む
 *   - CSS が text-align:justify + hyphens:auto で再ラップ
 *   - lang 属性を設定しブラウザの自動ハイフネーション辞書を有効化
 *   - {base|ruby} 記法を <ruby> タグに変換（ルビ）
 */
function renderTextPreview(section) {
    const overlay = document.getElementById('text-preview-overlay');
    if (!overlay) return;

    const lang = state.activeLang || state.defaultLang || 'ja';
    const raw = section.texts?.[lang] ?? '';
    const writingMode = getWritingModeFromConfigs(lang, state.languageConfigs);
    const fontPreset = getFontPresetFromConfigs(lang, state.languageConfigs);

    // ルビマークアップを解析し、ベーステキストで組版する
    let rubyTokens, hasRuby, plainText, rubyLines;
    try {
        rubyTokens = parseRubyTokens(raw);
        hasRuby = rubyTokens.some(t => t.kind === 'ruby');
        plainText = hasRuby ? tokensToPlainText(rubyTokens) : raw;
    } catch (e) {
        console.error('[renderTextPreview] ruby parse error:', e);
        rubyTokens = []; hasRuby = false; plainText = raw;
    }

    const composed = composeText(plainText, lang, writingMode, fontPreset);

    // ルビあり: 行ごとのトークン配列を構築
    try {
        rubyLines = hasRuby ? alignRubyToLines(rubyTokens, composed.lines) : null;
    } catch (e) {
        console.error('[renderTextPreview] ruby align error:', e);
        rubyLines = null;
    }

    overlay.style.backgroundColor = section.backgroundColor || '#ffffff';
    overlay.style.display = 'block';

    const frameEl = document.getElementById('text-preview-frame');
    if (frameEl) {
        const { x, y, w, h } = composed.frame;
        frameEl.style.left          = `${x}px`;
        frameEl.style.top           = `${y}px`;
        frameEl.style.width         = `${w}px`;
        frameEl.style.height        = `${h}px`;
        frameEl.style.fontFamily    = composed.font.family;
        frameEl.style.fontSize      = `${composed.font.size}px`;
        frameEl.style.color         = section.textColor || '#000000';
        frameEl.style.writingMode   = '';
        frameEl.style.lineHeight    = '';
        frameEl.style.letterSpacing = composed.font.letterSpacing
            ? `${composed.font.letterSpacing}px` : '0';
        // hyphens:auto などが言語固有処理を使えるよう lang 属性を設定
        frameEl.setAttribute('lang', lang.toLowerCase());
    }

    const contentEl = document.getElementById('text-preview-content');
    if (contentEl) {
        if (!raw) {
            contentEl.innerHTML = '';
        } else if (composed.writingMode === 'vertical-rl') {
            // 縦書き: 列ごとに span を生成（right → left へ flex row-reverse）
            //
            // パラメータ計算:
            //   colW          = floor(frame.w / maxCols)
            //                   → 全列が frame.w に収まる列幅
            //   lineHeight    = colW / fontSize
            //                   → writing-mode:vertical-rl では line-height が
            //                      ブロック方向（水平）= 列幅 を制御する
            //   letterSpacing = frame.h / charsPerCol - fontSize
            //                   → インライン方向（垂直）の文字ピッチを均等割り。
            //                      full column (33文字) がちょうど frame.h を埋める。
            const { w, h }    = composed.frame;
            const maxCols     = composed.rules?.maxLines    || 12;
            const charsPerCol = composed.rules?.charsPerLine || 33;
            const fontSize    = composed.font.size;
            // ルビあり: rt のはみ出しスペースとして各列に rubyGap を確保する
            // rubyGap = rt の font-size（0.5em）に相当する幅を全列で分担
            const rubyGap     = rubyLines ? Math.round(fontSize * 0.55) : 0;
            const colW        = Math.floor((w - rubyGap) / maxCols);
            const lineHeight  = (colW / fontSize).toFixed(3);
            const letterSpacing = ((h / charsPerCol) - fontSize).toFixed(3);

            const cols = composed.lines.map((line, i) => {
                const content = rubyLines
                    ? _markupTokenLine(rubyLines[i])
                    : _markupVerticalLine(line);
                return `<span class="tpv-col"` +
                    ` style="width:${colW}px;line-height:${lineHeight};letter-spacing:${letterSpacing}px"` +
                    `>${content}</span>`;
            }).join('');
            contentEl.innerHTML = `<div class="tpv-vertical">${cols}</div>`;
        } else {
            // 横書き: 段落単位に行を結合し、CSS の justify + hyphens に委ねる
            const lineH  = composed.frame.h / (composed.rules?.maxLines || 20);

            let html;
            if (rubyLines) {
                // ルビあり: token-line をそのまま段落に変換
                const tokenParas = _tokenLinesIntoParagraphs(rubyLines, composed.lines);
                html = tokenParas.map(p =>
                    p === null
                        ? `<div class="tpv-blank" style="height:${lineH}px"></div>`
                        : `<p class="tpv-para">${p.map(tok =>
                            tok.kind === 'ruby'
                                ? `<ruby>${_markupTcyText(tok.base)}<rt>${_escHtml(tok.ruby || '')}</rt></ruby>`
                                : _escHtml(tok.text || '')
                          ).join('')}</p>`
                ).join('');
            } else {
                const paras = _linesIntoParagraphs(composed.lines);
                html = paras.map(p =>
                    p === null
                        ? `<div class="tpv-blank" style="height:${lineH}px"></div>`
                        : `<p class="tpv-para">${_escHtml(p)}</p>`
                ).join('');
            }
            contentEl.innerHTML =
                `<div class="tpv-horizontal" lang="${lang.toLowerCase()}" style="line-height:${lineH}px">${html}</div>`;
        }
    }

    const placeholder = document.getElementById('text-preview-placeholder');
    if (placeholder) placeholder.style.display = raw ? 'none' : 'flex';
}

// ──────────────────────────────────────────────────────────────
//  テキストセクション パネル同期・入力ハンドラ
// ──────────────────────────────────────────────────────────────

let _textBodyPushTimer = null;
let _textBodyDebounceTimer = null;

/**
 * テキストセクションパネルを現在のセクション内容で同期する
 */
function _syncTextSectionPanel(section) {
    const lang = state.activeLang || state.defaultLang || 'ja';
    const textarea = document.getElementById('prop-body-text');
    if (textarea && document.activeElement !== textarea) {
        textarea.value = section.texts?.[lang] ?? '';
    }
    const label = document.getElementById('text-body-label');
    if (label) label.textContent = `本文 [${lang.toUpperCase()}]`;

    _updateTextOverflowBadge(section, lang);
}

/**
 * 溢れバッジを更新する
 */
function _updateTextOverflowBadge(section, lang) {
    const badge = document.getElementById('text-overflow-badge');
    if (!badge) return;
    const raw = section.texts?.[lang] ?? '';
    if (!raw) { badge.style.display = 'none'; return; }
    const writingMode = getWritingModeFromConfigs(lang, state.languageConfigs);
    const fontPreset = getFontPresetFromConfigs(lang, state.languageConfigs);
    // ルビマークアップを除いたベーステキストで文字数を計算する
    const tokens = parseRubyTokens(raw);
    const plainText = tokens.some(t => t.kind === 'ruby') ? tokensToPlainText(tokens) : raw;
    const result = composeText(plainText, lang, writingMode, fontPreset);
    badge.style.display = result.overflow ? 'block' : 'none';
}

/**
 * テキストセクションの本文入力ハンドラ（debounce 付き）
 */
function updateTextSectionBody(v) {
    const idx = state.activeIdx;
    const s = state.sections[idx];
    if (!s || s.type !== 'text') return;
    const lang = state.activeLang || state.defaultLang || 'ja';

    if (!_textBodyPushTimer) {
        pushState();
    } else {
        clearTimeout(_textBodyPushTimer);
    }
    _textBodyPushTimer = setTimeout(() => { _textBodyPushTimer = null; }, 600);

    dispatch({ type: actionTypes.UPDATE_SECTION_TEXT, payload: { idx, lang, text: v } });

    // blocks/pages を同期
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: syncBlocksWithSections(state.blocks, state.sections, state.languages) } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'pages', value: blocksToPages(state.blocks) } });

    // プレビューと溢れバッジをリアルタイム更新（debounce）
    clearTimeout(_textBodyDebounceTimer);
    _textBodyDebounceTimer = setTimeout(() => {
        const sec = state.sections[idx];
        _updateTextOverflowBadge(sec, lang);
        renderTextPreview(sec);
    }, 300);

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
//  最近使った色パレット
// ──────────────────────────────────────
const RECENT_COLORS_KEY = 'dsf_bubble_recent_colors';
const RECENT_COLORS_MAX = 16;

function loadRecentColors() {
    try {
        return JSON.parse(localStorage.getItem(RECENT_COLORS_KEY) || '[]');
    } catch { return []; }
}

function addRecentColor(color) {
    const hex = (color || '').toLowerCase();
    if (!hex.match(/^#[0-9a-f]{6}$/)) return;
    let list = loadRecentColors();
    list = [hex, ...list.filter(c => c !== hex)].slice(0, RECENT_COLORS_MAX);
    try { localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(list)); } catch { }
    renderRecentColors();
}

function renderRecentColors() {
    const container = document.getElementById('bubble-recent-colors');
    if (!container) return;
    const list = loadRecentColors();
    if (list.length === 0) {
        container.innerHTML = '<span style="font-size:11px;color:#aaa;">まだありません</span>';
        return;
    }
    container.innerHTML = list.map(c =>
        `<button class="recent-color-swatch" style="background:${c};" title="${c}"
            onclick="applyRecentColor('${c}')" type="button"></button>`
    ).join('');
}

// 最後にアクティブだったカラープロップを記憶
let _lastColorProp = 'strokeColor';

function applyRecentColor(hex) {
    const propEls = {
        strokeColor: 'prop-stroke-color',
        fillColor: 'prop-fill-color',
        fontColor: 'prop-font-color'
    };
    // 選択中のカラーピッカーに適用
    const el = document.getElementById(propEls[_lastColorProp]);
    if (el) el.value = hex;
    updateBubbleColor(_lastColorProp, hex);
}
window.applyRecentColor = applyRecentColor;

function updateBubbleColor(prop, value) {
    _lastColorProp = prop;
    const s = state.sections[state.activeIdx];
    if (state.activeBubbleIdx !== null && s.bubbles && s.bubbles[state.activeBubbleIdx]) {
        s.bubbles[state.activeBubbleIdx][prop] = value;
        addRecentColor(value);
        refresh();
        triggerAutoSave();
    }
}
window.updateBubbleColor = updateBubbleColor;

// ─── AR 設定パネル ───────────────────────────────────────────────────────────


// フキダシ選択時に右パネルの値を同期する
function updateBubblePropPanel(bubble) {
    const shapeEl = document.getElementById('prop-shape');
    const strokeEl = document.getElementById('prop-stroke-color');
    const fillEl = document.getElementById('prop-fill-color');
    const fontEl = document.getElementById('prop-font-color');
    if (!bubble) {
        if (shapeEl) shapeEl.value = 'speech';
        if (strokeEl) strokeEl.value = '#000000';
        if (fillEl) fillEl.value = '#ffffff';
        if (fontEl) fontEl.value = '#000000';
        renderRecentColors();
        return;
    }
    if (shapeEl) shapeEl.value = bubble.shape || 'speech';
    if (strokeEl) strokeEl.value = bubble.strokeColor || '#000000';
    if (fillEl) fillEl.value = bubble.fillColor || '#ffffff';
    const defaultFont = (bubble.shape === 'urchin') ? '#ffffff' : '#000000';
    if (fontEl) fontEl.value = bubble.fontColor || defaultFont;
    renderRecentColors();
}
window.updateBubblePropPanel = updateBubblePropPanel;



// ──────────────────────────────────────
//  ページ送り方向更新
// ──────────────────────────────────────
function updatePageDirection(dir) {
    const lang = state.activeLang;
    if (!state.languageConfigs) state.languageConfigs = {};
    if (!state.languageConfigs[lang]) state.languageConfigs[lang] = {};
    state.languageConfigs[lang].pageDirection = dir;
    pushState();
    refresh();
    triggerAutoSave();
}
window.updatePageDirection = updatePageDirection;

function syncLangPanel() {
    const sel = document.getElementById('lang-page-direction');
    if (!sel) return;
    const dir = state.languageConfigs?.[state.activeLang]?.pageDirection || 'ltr';
    sel.value = dir;
}


function onLoadProject(pid, projectName, sections, languages, defaultLang, languageConfigs, title, uiPrefs, pages, blocks, version) {
    const normalized = normalizeProjectDataV5({
        version,
        projectName,
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
    state.localProjectId = null;
    state.projectName = normalized.projectName || pid || '';
    state.title = normalized.title || '';
    state.pages = normalized.pages || [];
    state.blocks = normalized.blocks;
    state.sections = normalized.sections;
    state.languages = normalized.languages;
    state.defaultLang = normalized.defaultLang || normalized.languages[0] || 'ja';

    // languageConfigs Migration
    state.languageConfigs = normalized.languageConfigs || {};
    state.languages.forEach(lang => {
        if (!state.languageConfigs[lang]) state.languageConfigs[lang] = {};
        const cfg = state.languageConfigs[lang];
        // Gen3: pageDirection が未設定なら旧 writingMode から変換、またはデフォルト値を設定
        if (!cfg.pageDirection) {
            if (cfg.writingMode === 'vertical-rl') {
                cfg.pageDirection = 'rtl';
            } else if (cfg.writingMode === 'horizontal-tb') {
                cfg.pageDirection = 'ltr';
            } else {
                cfg.pageDirection = lang === 'ja' ? 'rtl' : 'ltr';
            }
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
window.handleCanvasClick = (e) => {
    // テキストページはキャンバスクリックを無効にする（吹き出し追加・画像操作不要）
    const activeSection = state.sections?.[state.activeIdx];
    if (activeSection?.type === 'text') return;
    pushState();
    handleCanvasClick(e, refresh);
    triggerAutoSave();
};
window.selectBubble = (e, i) => selectBubble(e, i, refresh);
window.addSection = () => { pushState(); addSection(refresh); triggerAutoSave(); };
window.addTextSection = () => { pushState(); addTextSection(refresh); triggerAutoSave(); };
window.updateTextSectionBody = updateTextSectionBody;

// ── キャンバスへのドラッグ&ドロップ（画像アップロード） ──────────────────────
window.handleCanvasDragOver = (e) => {
    const s = state.sections?.[state.activeIdx];
    if (s?.type !== 'image') return;
    // 画像ファイルを含むドラッグのみ受け付ける
    if ([...e.dataTransfer.types].some(t => t === 'Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        document.getElementById('canvas-view')?.classList.add('drag-over');
    }
};

window.handleCanvasDragLeave = (e) => {
    // canvas-view の外へ出たときのみ解除（子要素への移動は無視）
    if (!e.currentTarget.contains(e.relatedTarget)) {
        document.getElementById('canvas-view')?.classList.remove('drag-over');
    }
};

window.handleCanvasDrop = (e) => {
    e.preventDefault();
    document.getElementById('canvas-view')?.classList.remove('drag-over');
    const s = state.sections?.[state.activeIdx];
    if (s?.type !== 'image') return;
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    // 既存の uploadToStorage に File を渡すため擬似 input を作成
    pushState();
    uploadToStorage({ files: [file] }, refresh);
    triggerAutoSave();
};
window.changeSection = (i) => {
    if (Date.now() < suppressThumbClickUntil) return;
    changeSection(i, refreshForThumbSelection);
};
window.changeBlock = (idx) => {
    if (Date.now() < suppressThumbClickUntil) return;
    changeBlock(idx, refreshForThumbSelection);
};
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
    const position = getDropPositionByPoint(el, e.clientX, e.clientY);
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
    const position = getDropPositionByPoint(el, e.clientX, e.clientY);
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
    clearThumbDeleteDropzone();
    clearThumbDropHints();
    thumbTouchState = {
        sourceIndex: idx,
        mode: null,
        targetIndex: null,
        insertIndex: null,
        position: 'after',
        startX: touch.clientX,
        startY: touch.clientY,
        active: false,
        lastX: touch.clientX,
        lastY: touch.clientY
    };
    bindTouchDragListeners();
};
window.deleteActive = () => { pushState(); deleteActive(refresh); triggerAutoSave(); };
window.update = update;
window.updateActiveText = updateActiveText;
window.updateBubbleShape = updateBubbleShape;
window.changeBubbleShapeFromMenu = (idx, shapeName) => {
    const s = state.sections[state.activeIdx];
    if (s?.bubbles?.[idx]) {
        pushState();
        s.bubbles[idx].shape = shapeName;
        refresh();
        triggerAutoSave();
        const menu = document.getElementById('context-menu');
        if (menu) menu.style.display = 'none';
    }
};
window.updateTitle = (v) => {
    dispatch({ type: actionTypes.SET_TITLE, payload: v });
    const headerGuideTitle = document.getElementById('header-guide-title');
    if (headerGuideTitle) headerGuideTitle.textContent = v || 'タイトル未設定';
    triggerAutoSave();
};
window.setThumbColumns = (cols) => {
    setCurrentDeviceThumbColumns(cols);
    refresh();
    triggerAutoSave();
};
window.setThumbSize = (sizeKey) => {
    const cols = MOBILE_THUMB_SIZE_MAP[sizeKey] || 2;
    setCurrentDeviceThumbColumns(cols);
    refresh();
    triggerAutoSave();
};
window.uploadToStorage = (input) => { pushState(); uploadToStorage(input, refresh); };

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

// しっぽ移動ハンドル用
window.onTailHandleDown = (e, i) => {
    startTailDrag(e, i, refresh);
};

// ウニ・スパイク長ハンドル用
window.onSpikeHandleDown = (e, i) => {
    startSpikeDrag(e, i, refresh);
};

// ズーム・パン機能
let canvasScale = 1;
let canvasTranslate = { x: 0, y: 0 };

const CANVAS_ZOOM_PRESETS = [25, 33, 50, 67, 75, 90, 100, 110, 125, 150, 175, 200, 300, 400];

function syncCanvasZoomUI() {
    const select = document.getElementById('canvas-zoom-select');
    const percent = Math.round(canvasScale * 100);
    if (select) {
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

    const mobileRange = document.getElementById('mobile-canvas-zoom-range');
    if (mobileRange) {
        mobileRange.value = String(Math.min(Math.max(percent, 25), 300));
    }
    const mobileValue = document.getElementById('mobile-canvas-zoom-value');
    if (mobileValue) {
        mobileValue.textContent = `${percent}%`;
    }
}

window.setCanvasZoomPercent = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return;
    canvasScale = Math.min(Math.max(num / 100, 0.1), 5);
    updateCanvasTransform();
};

window.fitCanvasView = () => {
    canvasTranslate = { x: 0, y: 0 };

    const container = document.getElementById('canvas-view');
    if (container) {
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        const targetW = CANONICAL_PAGE_WIDTH;
        const targetH = CANONICAL_PAGE_HEIGHT;

        let s = Math.min(cw / targetW, ch / targetH) * 0.9;
        if (s > 1.2) s = 1.0;
        canvasScale = s;
    } else {
        canvasScale = 1;
    }

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
    updateCanvasTransform();
};

function initCanvasZoom() {
    const view = document.getElementById('canvas-view');
    if (!view) return;

    // 初期化時にリセット（flex レイアウト確定後に実行）
    requestAnimationFrame(() => fitCanvasView());

    // #canvas-view のサイズ変化（ページストリップ開閉・パネル開閉・ウィンドウリサイズ等）
    // に対して自動的にキャンバススケールを再計算する
    if (typeof ResizeObserver !== 'undefined') {
        let _fitRaf = null;
        const ro = new ResizeObserver(() => {
            if (_fitRaf) cancelAnimationFrame(_fitRaf);
            _fitRaf = requestAnimationFrame(() => { fitCanvasView(); _fitRaf = null; });
        });
        ro.observe(view);
    }

    // Pan handling
    let isPanning = false;
    let startPan = { x: 0, y: 0 };
    let startTranslate = { x: 0, y: 0 };

    const onPanMove = (e) => {
        const dx = e.clientX - startPan.x;
        const dy = e.clientY - startPan.y;
        canvasTranslate.x = startTranslate.x + dx;
        canvasTranslate.y = startTranslate.y + dy;
        updateCanvasTransform();
    };

    const onPanEnd = () => {
        isPanning = false;
        view.style.cursor = 'default';
        window.removeEventListener('mousemove', onPanMove);
        window.removeEventListener('mouseup', onPanEnd);
    };

    view.addEventListener('mousedown', (e) => {
        // 画像調整中はCanvas全体のパンを無効化
        if (isImageAdjusting) return;

        // バブルやテキストレイヤー以外ならPan開始
        if (e.target.id === 'canvas-view'
            || e.target.id === 'content-render'
            || e.target.id === 'main-richtext-area'
            || e.target.classList.contains('text-layer')) {
            isPanning = true;
            startPan = { x: e.clientX, y: e.clientY };
            startTranslate = { ...canvasTranslate };
            view.style.cursor = 'grabbing';
            window.addEventListener('mousemove', onPanMove);
            window.addEventListener('mouseup', onPanEnd);
        }
    });

    // Touch Pan & Pinch (Simplified)
    // Hammer.js or similar recommended for robust pinch, but implementing basic logic here
    // For now, support single touch pan (if not on bubble)
    view.addEventListener('touchstart', (e) => {
        // 画像調整中はCanvasパン無効
        if (isImageAdjusting) return;

        if (e.touches.length === 1 && (
            e.target.id === 'canvas-view'
            || e.target.id === 'main-richtext-area'
            || e.target.classList.contains('text-layer')
        )) {
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
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'projectName', value: name === '新規プロジェクト' ? '' : name } });
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
        state.projectName = name === '新規プロジェクト' ? '' : name;
        triggerAutoSave();
    }
};
window.saveProject = async () => {
    ensureProjectIdentity();
    await persistProject();
    refresh();
};

window.importDSP = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (typeof closeMobileSheet === 'function') {
        closeMobileSheet();
    }

    // Show loading? Optional since it might be fast, but let's just do it
    const originalCursor = document.body.style.cursor;
    document.body.style.cursor = 'wait';

    try {
        const loadedState = await parseAndLoadDSP(file);

        dispatch({
            type: actionTypes.LOAD_PROJECT,
            payload: loadedState
        });
        await cacheLocalRecentProject(JSON.parse(JSON.stringify(state)), window.localImageMap);

        // Update title UI
        const pt = document.getElementById('project-title');
        if (pt) pt.textContent = state.projectName || state.title || 'Untitled';
        const inputTitle = document.getElementById('prop-title');
        if (inputTitle) inputTitle.value = state.title || '';

        refresh();
        window.switchRoom('editor');
    } catch (e) {
        console.error("DSP Import failed", e);
        alert("読み込みエラー: " + e.message);
    } finally {
        document.body.style.cursor = originalCursor;
        event.target.value = ''; // Reset input
    }
};

window.exportDSP = async () => {
    const btnDataList = document.querySelectorAll('button[onclick="exportDSP()"]');
    btnDataList.forEach(btn => btn.textContent = '⏳ ZIP生成中...');
    try {
        await buildDSP();
    } catch (e) {
        console.error("Export DSP failed:", e);
        alert("エクスポート中にエラーが発生しました。\n" + e.message);
    } finally {
        btnDataList.forEach(btn => btn.textContent = '⬇ プロジェクト保存 (.dsp)');
    }
};

window.exportDSF = async () => {
    const btnDataList = document.querySelectorAll('button[onclick="exportDSF()"]');
    btnDataList.forEach(btn => btn.textContent = '⏳ ZIP生成中...');
    try {
        await buildDSF();
    } catch (e) {
        console.error("Export DSF failed:", e);
        alert("エクスポート中にエラーが発生しました。\n" + e.message);
    } finally {
        btnDataList.forEach(btn => btn.textContent = '⬇ 配信データ出力 (.dsf)');
    }
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

    await flushSave();

    const host = window.location.host;
    const visibility = state.visibility || 'private';
    if (visibility === 'private') {
        alert('現在の状態は「非公開」です。\nこのままでは作品を共有できません。上部メニューから「限定公開」か「公開」に変更してください。');
        return;
    }
    const url = `${window.location.protocol}//${host}/viewer?project=${encodeURIComponent(state.projectId)}&author=${encodeURIComponent(state.uid)}`;

    try {
        await navigator.clipboard.writeText(url);
        alert(`スマホ用URLをコピーしました！\n\n${url}`);
    } catch (e) {
        prompt("ビューワー用URL (コピーしてください):", url);
    }
};

window.updateVisibility = async (val) => {
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'visibility', value: val } });
    await flushSave();
    const map = {
        'private': '非公開（自分だけの状態）',
        'unlisted': '限定公開（URLを知っている人のみ閲覧可能）',
        'public': '公開（ポータルに掲載され誰でも閲覧可能）'
    };
    console.log(`[DSF] Visibility updated to ${val}`);
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

// 言語切替
window.switchLang = (code) => {
    state.activeLang = code;
    refresh();
};

// lang-add-select を現在の追加済み言語を除いて生成する
function renderLangAddSelect() {
    const select = document.getElementById('lang-add-select');
    if (!select) return;
    const added = new Set(state.languages);
    const allLangs = getAllLangs();
    const options = [];
    allLangs.forEach(({ code, label, directions }) => {
        if (added.has(code)) return; // 既追加はスキップ
        directions.forEach(({ value: dir, label: dirLabel }) => {
            const suffix = dirLabel ? ` — ${dirLabel}` : '';
            const dirStr = dir.toUpperCase();
            options.push(`<option value="${code}:${dir}">${label}${suffix} (${dirStr})</option>`);
        });
    });
    select.innerHTML = options.length
        ? options.join('')
        : '<option value="">— 追加できる言語がありません —</option>';
}

// 言語追加（セレクト値は "code:dir" 形式）
window.addLang = () => {
    const select = document.getElementById('lang-add-select');
    if (!select || !select.value || select.value.startsWith('—')) return;
    const [code, dir] = select.value.split(':');
    if (!code || state.languages.includes(code)) return;
    state.languages.push(code);
    if (!state.languageConfigs) state.languageConfigs = {};
    state.languageConfigs[code] = { pageDirection: dir || 'ltr' };
    renderLangSettings();
    renderLangTabs();
    renderLangAddSelect();
    renderProjectSettingsTable();
    triggerAutoSave();
};

// 言語削除
window.removeLang = (code) => {
    if (state.languages.length <= 1) return;
    if (!confirm(t('confirm_remove_lang', { lang: getLangProps(code).label }))) return;
    state.languages = state.languages.filter(c => c !== code);
    if (state.defaultLang === code) state.defaultLang = state.languages[0] || 'ja';
    if (state.activeLang === code) state.activeLang = state.defaultLang || state.languages[0];
    renderLangSettings();
    renderLangAddSelect();
    renderProjectSettingsTable();
    refresh();
    triggerAutoSave();
};

// プロジェクトモーダル
window.openProjectModal = () => openProjectModal((...args) => {
    onLoadProject(...args);
    cacheLocalRecentProject(JSON.parse(JSON.stringify(state)), window.localImageMap).catch((e) => {
        console.warn('[Home] Failed to cache cloud project locally:', e);
    });
    window.switchRoom('editor');
});
window.closeProjectModal = closeProjectModal;

// Works Room
window.openWorksRoom = openWorksRoom;
window.closeWorksRoom = closeWorksRoom;
window.loadWorksRoom  = () => openWorksRoom(true); // true = ルームモード
window.loadAndOpenProject = (pid) => {
    closeWorksRoom();
    loadProject(pid, () => {
        refresh();
        window.switchRoom('editor');
    });
};
window.copyViewerUrl = async (pid) => {
    const url = `${window.location.origin}/viewer?project=${encodeURIComponent(pid)}&author=${encodeURIComponent(state.uid)}`;
    try {
        await navigator.clipboard.writeText(url);
        alert('URLをコピーしました:\n' + url);
    } catch {
        prompt('ビューワーURL:', url);
    }
};
window.loadAndRepress = (pid) => {
    closeWorksRoom();
    loadProject(pid, () => {
        refresh();
        window.switchRoom('press');
    });
};

// 新規プロジェクト
window.newProject = () => {
    if (state.projectId && !confirm('現在のプロジェクトを閉じて新しいプロジェクトを作成しますか？')) return false;
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'projectId', value: null } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'projectName', value: '' } });
    dispatch({ type: actionTypes.SET_TITLE, payload: '' });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'languages', value: ['ja'] } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'defaultLang', value: 'ja' } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'languageConfigs', value: { ja: { pageDirection: 'rtl' } } } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'uiPrefs', value: { desktop: { thumbColumns: 2 }, mobile: { thumbColumns: 2 } } } });
    applyThumbColumnsFromPrefs();
    dispatch({ type: actionTypes.SET_ACTIVE_LANGUAGE, payload: 'ja' });
    const initialSections = [{
        type: 'image',
        background: 'https://picsum.photos/id/10/600/1066',
        backgrounds: {},
        bubbles: []
    }];
    const initialBlocks = migrateSectionsToBlocks(initialSections, ['ja']);
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: initialSections } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: initialBlocks } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'pages', value: blocksToPages(initialBlocks) } });
    dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: 0 });
    dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: Math.max(0, getBlockIndexFromPageIndex(initialBlocks, 0)) });
    dispatch({ type: actionTypes.SET_ACTIVE_BUBBLE_INDEX, payload: null });
    clearHistory();
    refresh();
    renderLangSettings();
    closeProjectModal();
    return true;
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
    const drawerOpen = document.body.classList.contains('drawer-open');
    const rightCollapsed = document.body.classList.contains('right-collapsed');
    const leftBtn = document.getElementById('btn-toggle-sidebar');
    const rightBtn = document.getElementById('btn-toggle-panel');
    if (leftBtn) leftBtn.textContent = drawerOpen ? '🖼 Assetsを閉じる' : '🖼 Assets';
    if (rightBtn) rightBtn.textContent = rightCollapsed ? '⚙ Editを開く' : '⚙ Edit';
}

window.toggleDesktopPanel = (side) => {
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
    window.toggleDrawer('pages');
};

window.toggleEditPanel = () => {
    if (window.innerWidth < 1024) {
        closeMobileSheet();
        return;
    }
    toggleDesktopPanel('right');
};

let activeDrawer = null;

window.toggleDrawer = (drawerName) => {
    if (window.innerWidth < 1024) return;
    if (activeDrawer === drawerName && document.body.classList.contains('drawer-open')) {
        window.closeDrawer();
        return;
    }
    activeDrawer = drawerName;
    document.body.classList.add('drawer-open');
    document.querySelectorAll('.sidebar-assets, .sidebar-pages').forEach((el) => {
        el.style.display = 'none';
    });
    const target = document.querySelector(`.sidebar-${drawerName}`);
    if (target) target.style.display = 'flex';
    document.querySelectorAll('.icon-bar-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.drawer === drawerName);
    });
    syncDesktopToggleButtons();
};

window.closeDrawer = () => {
    activeDrawer = null;
    document.body.classList.remove('drawer-open');
    document.querySelectorAll('.icon-bar-btn').forEach((btn) => btn.classList.remove('active'));
    syncDesktopToggleButtons();
};

// ===== Project Settings Modal =====

const PS_META_FIELDS = [
    { key: 'title',       get label() { return t('field_title'); },       type: 'input'    },
    { key: 'author',      get label() { return t('field_author'); },      type: 'input'    },
    { key: 'description', get label() { return t('field_description'); }, type: 'textarea' },
    { key: 'copyright',   get label() { return t('field_copyright'); },   type: 'input'    },
];

// ── PS テーブル列ドラッグ ──
let _psDragLang = null;

window.psColDragStart = (e, lang) => {
    _psDragLang = lang;
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.classList.add('ps-col-dragging');
};

window.psColDragEnd = (e) => {
    e.currentTarget.classList.remove('ps-col-dragging');
};

window.psColDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('ps-col-drag-over');
};

window.psColDragLeave = (e) => {
    e.currentTarget.classList.remove('ps-col-drag-over');
};

window.psColDrop = (e, targetLang) => {
    e.preventDefault();
    e.currentTarget.classList.remove('ps-col-drag-over');
    if (!_psDragLang || _psDragLang === targetLang) { _psDragLang = null; return; }

    // Save current input values before re-render
    const currentMeta = state.meta ? JSON.parse(JSON.stringify(state.meta)) : {};
    document.querySelectorAll('#ps-meta-table .ps-meta-input').forEach(input => {
        const lang = input.dataset.lang;
        const key  = input.dataset.key;
        if (lang && key) {
            if (!currentMeta[lang]) currentMeta[lang] = {};
            currentMeta[lang][key] = input.value;
        }
    });
    state.meta = currentMeta;

    // Reorder languages
    const langs = [...state.languages];
    const fromIdx = langs.indexOf(_psDragLang);
    const toIdx   = langs.indexOf(targetLang);
    if (fromIdx === -1 || toIdx === -1) { _psDragLang = null; return; }
    langs.splice(fromIdx, 1);
    langs.splice(toIdx, 0, _psDragLang);
    state.languages = langs;
    state.defaultLang = langs[0];
    _psDragLang = null;

    renderProjectSettingsTable();
    renderLangSettings();
    renderLangTabs();
    triggerAutoSave();
};

function renderProjectSettingsTable() {
    const container = document.getElementById('ps-meta-table');
    if (!container) return;

    const langs = state.languages || ['ja'];
    const meta = state.meta || {};
    const isMobile = window.innerWidth < 768 || document.body.dataset.device === 'mobile';

    if (isMobile) {
        const cards = langs.map((lang, idx) => {
            const props = getLangProps(lang);
            const dir = (state.languageConfigs?.[lang]?.pageDirection || 'ltr').toUpperCase();
            const code = lang.toUpperCase();
            const isDefault = idx === 0;
            const defaultBadge = isDefault
                ? `<span class="ps-default-badge">${t('ps_default_badge')}</span>`
                : '';
            const fields = PS_META_FIELDS.map(field => {
                const val = (meta[lang]?.[field.key] || '').replace(/"/g, '&quot;');
                const ph = (getLangProps(lang).placeholders?.[field.key] || '').replace(/"/g, '&quot;');
                const control = field.type === 'textarea'
                    ? `<textarea class="ps-meta-input" data-lang="${lang}" data-key="${field.key}" placeholder="${ph}">${val}</textarea>`
                    : `<input type="text" class="ps-meta-input" data-lang="${lang}" data-key="${field.key}" value="${val}" placeholder="${ph}">`;
                return `
                    <div class="ps-meta-mobile-field">
                        <label class="ps-meta-mobile-label">${field.label}</label>
                        ${control}
                    </div>
                `;
            }).join('');
            return `
                <section class="ps-meta-mobile-card">
                    <header class="ps-meta-mobile-head${isDefault ? ' ps-meta-header--default' : ''}">
                        <div class="ps-meta-mobile-head-main">
                            <div class="ps-meta-mobile-lang">${props.label}</div>
                            <div class="ps-meta-mobile-sub">${code} / ${dir}</div>
                        </div>
                        ${defaultBadge}
                    </header>
                    <div class="ps-meta-mobile-body">${fields}</div>
                </section>
            `;
        }).join('');
        container.innerHTML = `<div class="ps-meta-mobile-list">${cards}</div>`;
        return;
    }

    // grid-template-columns: label col (fixed) + one col per language (fixed 180px each → horizontal scroll)
    const colTemplate = `120px ${langs.map(() => '320px').join(' ')}`;

    let html = `<div class="ps-meta-grid" style="grid-template-columns:${colTemplate};">`;

    // Header row: empty label cell + draggable language headers
    html += `<div class="ps-meta-cell ps-meta-header ps-meta-corner"></div>`;
    langs.forEach((lang, idx) => {
        const props = getLangProps(lang);
        const dir  = (state.languageConfigs?.[lang]?.pageDirection || 'ltr').toUpperCase();
        const code = lang.toUpperCase();
        const isDefault = idx === 0;
        const defaultBadge = isDefault
            ? `<span class="ps-default-badge">${t('ps_default_badge')}</span>`
            : '';
        html += `<div class="ps-meta-cell ps-meta-header${isDefault ? ' ps-meta-header--default' : ''}"
            draggable="true"
            data-lang="${lang}"
            ondragstart="psColDragStart(event,'${lang}')"
            ondragend="psColDragEnd(event)"
            ondragover="psColDragOver(event)"
            ondragleave="psColDragLeave(event)"
            ondrop="psColDrop(event,'${lang}')">
            <span class="ps-meta-header-drag">⠿</span>
            ${props.label}
            <span class="ps-meta-header-sub">${code} / ${dir}</span>
            ${defaultBadge}
        </div>`;
    });

    // Data rows
    PS_META_FIELDS.forEach(field => {
        html += `<div class="ps-meta-cell ps-meta-row-label">${field.label}</div>`;
        langs.forEach(lang => {
            const val = (meta[lang]?.[field.key] || '').replace(/"/g, '&quot;');
            const ph  = (getLangProps(lang).placeholders?.[field.key] || '').replace(/"/g, '&quot;');
            if (field.type === 'textarea') {
                html += `<div class="ps-meta-cell"><textarea class="ps-meta-input" data-lang="${lang}" data-key="${field.key}" placeholder="${ph}">${val}</textarea></div>`;
            } else {
                html += `<div class="ps-meta-cell"><input type="text" class="ps-meta-input" data-lang="${lang}" data-key="${field.key}" value="${val}" placeholder="${ph}"></div>`;
            }
        });
    });

    html += `</div>`;
    container.innerHTML = html;
}

window.openProjectSettings = () => {
    const modal = document.getElementById('project-settings-modal');
    if (!modal) return;

    // Project name
    const nameEl = document.getElementById('ps-project-name');
    if (nameEl) nameEl.value = state.projectName || '';

    // Global settings
    const ratingEl = document.getElementById('ps-rating');
    if (ratingEl) ratingEl.value = state.rating || 'all';

    const licenseEl = document.getElementById('ps-license');
    if (licenseEl) licenseEl.value = state.license || 'all-rights-reserved';

    // Language settings
    renderLangSettings();
    renderLangAddSelect();

    // Per-language meta table
    renderProjectSettingsTable();

    modal.style.display = 'flex';
};

window.closeProjectSettings = (e) => {
    if (e && e.currentTarget !== e.target) return;
    const modal = document.getElementById('project-settings-modal');
    if (modal) modal.style.display = 'none';
};

window.saveProjectSettings = () => {
    // Project name
    const nameEl = document.getElementById('ps-project-name');
    if (nameEl) {
        const newName = nameEl.value.trim();
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'projectName', value: newName } });
        const titleDisplay = document.getElementById('project-title');
        if (titleDisplay) titleDisplay.textContent = newName || '新規プロジェクト';
    }

    // Global settings
    ['rating', 'license'].forEach(key => {
        const el = document.getElementById(`ps-${key}`);
        if (el) dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key, value: el.value } });
    });

    // Per-language meta table
    const meta = state.meta ? JSON.parse(JSON.stringify(state.meta)) : {};
    document.querySelectorAll('#ps-meta-table .ps-meta-input').forEach(input => {
        const lang = input.dataset.lang;
        const key  = input.dataset.key;
        if (lang && key) {
            if (!meta[lang]) meta[lang] = {};
            meta[lang][key] = input.value;
        }
    });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'meta', value: meta } });

    const modal = document.getElementById('project-settings-modal');
    if (modal) modal.style.display = 'none';

    triggerAutoSave();
};

// ===== Room Navigation =====
window.switchRoom = (room) => {
    document.body.dataset.room = room;
    syncStudioShell();
    if (room === 'home') {
        renderHomeDashboard().catch((e) => console.warn('[Home] render failed:', e));
    }
    if (room === 'press') {
        enterPressRoom();
    }
    if (room === 'works') {
        loadWorksRoom();
    }
};

window.togglePageStrip = () => {
    document.body.classList.toggle('strip-collapsed');
    const chevron = document.getElementById('page-strip-chevron');
    if (chevron) {
        chevron.textContent = document.body.classList.contains('strip-collapsed') ? 'expand_less' : 'expand_more';
    }
    // #page-strip の CSS transition（200ms）完了後にキャンバスサイズを再計算
    setTimeout(() => fitCanvasView(), 220);
};

window.handleMobileHeaderNav = () => {
    if (getCurrentRoom() === 'editor' && window.innerWidth < 1024) {
        window.toggleMobileHomeDrawer();
        return;
    }
    const navBtn = document.getElementById('mobile-header-nav');
    const targetRoom = navBtn?.dataset.targetRoom;
    if (targetRoom) {
        window.switchRoom(targetRoom);
    }
};

window.uploadAsset = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = async (e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;
        // TODO: implement asset upload to Firebase Storage
        console.log('uploadAsset: files selected', files.map((f) => f.name));
    };
    input.click();
};

const MOBILE_ROOM_ACTIONS = {
    home: [
        {
            key: 'new-project',
            icon: 'add_circle',
            labelKey: 'bottom_new_project',
            onClick: () => {
                if (newProject()) {
                    window.switchRoom('editor');
                }
            }
        },
        {
            key: 'open-local',
            icon: 'folder_open',
            labelKey: 'bottom_open_local',
            onClick: () => document.getElementById('dsp-upload')?.click()
        },
        {
            key: 'menu',
            icon: 'menu',
            labelKey: 'bottom_menu',
            sheet: 'menu'
        }
    ],
    editor: [
        { key: 'pages', icon: 'view_carousel', labelKey: 'bottom_pages', sheet: 'pages' },
        { key: 'add', icon: 'add_circle', labelKey: 'bottom_add', sheet: 'add' },
        { key: 'edit', icon: 'tune', labelKey: 'bottom_edit', sheet: 'edit' },
        { key: 'export', icon: 'ios_share', labelKey: 'bottom_export', sheet: 'export' },
        { key: 'menu', icon: 'menu', labelKey: 'bottom_menu', sheet: 'menu' }
    ],
    press: [
        { key: 'menu', icon: 'menu', labelKey: 'bottom_menu', sheet: 'menu' }
    ],
    works: [
        { key: 'menu', icon: 'menu', labelKey: 'bottom_menu', sheet: 'menu' }
    ]
};

let activeMobileSheet = null;
let lastDeviceKey = getDeviceKey();

function getMobileActionConfigs(room = getCurrentRoom()) {
    return MOBILE_ROOM_ACTIONS[room] || [];
}

function setBottomBarActive(actionName) {
    document.querySelectorAll('.bottom-item').forEach((item) => {
        item.classList.toggle('active', item.dataset.mobileAction === actionName);
    });
}

function syncMobileMenuSheet() {
    const room = getCurrentRoom();
    document.querySelectorAll('[data-mobile-room-only]').forEach((el) => {
        el.hidden = el.dataset.mobileRoomOnly !== room;
    });
}

function handleMobileBottomAction(actionKey) {
    const action = getMobileActionConfigs().find((item) => item.key === actionKey);
    if (!action) return;
    if (action.sheet) {
        openMobileSheet(action.sheet);
        return;
    }
    closeMobileSheet();
    action.onClick?.();
}

function renderMobileBottomBar() {
    const bottomBar = document.getElementById('bottom-bar');
    if (!bottomBar) return;
    const device = getDeviceKey();
    const actions = device === 'mobile' ? getMobileActionConfigs() : [];

    document.body.classList.toggle('mobile-bottom-visible', actions.length > 0);

    if (!actions.length) {
        bottomBar.innerHTML = '';
        setBottomBarActive(null);
        return;
    }

    bottomBar.style.setProperty('--mobile-bottom-columns', String(actions.length));
    bottomBar.innerHTML = actions.map((action) => `
        <button class="bottom-item" data-mobile-action="${action.key}">
            <span class="material-icons">${action.icon}</span><span>${t(action.labelKey)}</span>
        </button>
    `).join('');

    bottomBar.querySelectorAll('.bottom-item').forEach((item) => {
        item.addEventListener('click', () => handleMobileBottomAction(item.dataset.mobileAction));
    });

    if (activeMobileSheet && !actions.some((action) => action.key === activeMobileSheet || action.sheet === activeMobileSheet)) {
        closeMobileSheet();
    } else {
        setBottomBarActive(activeMobileSheet);
    }
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

window.closeMobileHomeDrawer = () => {
    document.body.classList.remove('mobile-home-drawer-open');
};

window.openMobileHomeDrawer = () => {
    if (window.innerWidth >= 1024 || getCurrentRoom() !== 'editor') return;
    closeMobileSheet();
    document.body.classList.add('mobile-home-drawer-open');
};

window.toggleMobileHomeDrawer = () => {
    if (isMobileHomeDrawerOpen()) {
        closeMobileHomeDrawer();
    } else {
        openMobileHomeDrawer();
    }
};

window.closeMobileOverlays = () => {
    closeMobileSheet();
    closeMobileHomeDrawer();
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

    closeMobileHomeDrawer();
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
        menu: 'mobile-sheet-menu',
        add: 'mobile-sheet-add',
        export: 'mobile-sheet-export',
        lang: 'mobile-sheet-lang'
    };
    openMobileActionSheet(map[sheetName] || 'mobile-sheet-menu');
};

function initUIChrome() {
    document.querySelectorAll('.ribbon-tab').forEach((tab) => {
        tab.addEventListener('click', () => setRibbonTab(tab.dataset.ribbonTab));
    });

    document.getElementById('btn-toggle-sidebar')?.addEventListener('click', () => window.toggleDrawer('assets'));
    document.getElementById('btn-toggle-panel')?.addEventListener('click', () => toggleDesktopPanel('right'));

    let mobileHomeDrawerSwipe = null;
    document.addEventListener('touchstart', (e) => {
        if (window.innerWidth >= 1024 || getCurrentRoom() !== 'editor' || activeMobileSheet || isMobileHomeDrawerOpen()) return;
        const touch = e.touches?.[0];
        if (!touch) return;
        if (touch.clientX > 24) return;
        mobileHomeDrawerSwipe = {
            startX: touch.clientX,
            startY: touch.clientY,
            opened: false
        };
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!mobileHomeDrawerSwipe || mobileHomeDrawerSwipe.opened) return;
        const touch = e.touches?.[0];
        if (!touch) return;
        const dx = touch.clientX - mobileHomeDrawerSwipe.startX;
        const dy = Math.abs(touch.clientY - mobileHomeDrawerSwipe.startY);
        if (dy > 36) {
            mobileHomeDrawerSwipe = null;
            return;
        }
        if (dx > 56) {
            openMobileHomeDrawer();
            mobileHomeDrawerSwipe.opened = true;
            mobileHomeDrawerSwipe = null;
        }
    }, { passive: true });

    document.addEventListener('touchend', () => {
        mobileHomeDrawerSwipe = null;
    }, { passive: true });

    const mobileHomeDrawer = document.getElementById('mobile-home-drawer');
    let mobileHomeDrawerCloseSwipe = null;
    mobileHomeDrawer?.addEventListener('touchstart', (e) => {
        if (!isMobileHomeDrawerOpen()) return;
        const touch = e.touches?.[0];
        if (!touch) return;
        const rect = mobileHomeDrawer.getBoundingClientRect();
        if ((rect.right - touch.clientX) > 36) return;
        mobileHomeDrawerCloseSwipe = {
            startX: touch.clientX,
            startY: touch.clientY
        };
    }, { passive: true });

    mobileHomeDrawer?.addEventListener('touchmove', (e) => {
        if (!mobileHomeDrawerCloseSwipe) return;
        const touch = e.touches?.[0];
        if (!touch) return;
        const dx = touch.clientX - mobileHomeDrawerCloseSwipe.startX;
        const dy = Math.abs(touch.clientY - mobileHomeDrawerCloseSwipe.startY);
        if (dy > 36) {
            mobileHomeDrawerCloseSwipe = null;
            return;
        }
        if (dx < -48) {
            closeMobileHomeDrawer();
            mobileHomeDrawerCloseSwipe = null;
        }
    }, { passive: true });

    mobileHomeDrawer?.addEventListener('touchend', () => {
        mobileHomeDrawerCloseSwipe = null;
    }, { passive: true });

    window.addEventListener('resize', () => {
        const currentDeviceKey = getDeviceKey();
        if (currentDeviceKey !== lastDeviceKey) {
            lastDeviceKey = currentDeviceKey;
            applyThumbColumnsFromPrefs();
            refresh();
        }
        syncStudioShell();
    });

    setRibbonTab('home');
    syncDesktopToggleButtons();
    syncStudioShell();
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
        console.error('[Auth] toggleAuth error:', e);
    }
};

onAuthChanged((user) => {
    state.user = user || null;
    state.uid = user?.uid || null;
    updateAuthUI();
    renderHomeDashboard().catch((e) => console.warn('[Home] render failed after auth:', e));
    // Auto-load project from URL param after login
    if (user) {
        const pid = new URLSearchParams(window.location.search).get('id');
        if (pid) loadProject(pid, refresh);
    }
});

// ── UI言語スイッチャー（windowに公開） ──────────────────────────
window.setStudioUILang = (lang) => {
    setUILang(lang);
    // 動的レンダリング済みコンポーネントを再描画
    renderLangTabs();
    updateAuthUI();
    renderHomeDashboard().catch((e) => console.warn('[Home] render failed after language switch:', e));
    if (document.getElementById('project-settings-modal')?.style.display !== 'none') {
        renderProjectSettingsTable();
        renderLangSettings();
        renderLangAddSelect();
    }
    syncStudioShell();
};

// --- 初回描画 ---
async function bootstrapApp() {
    initUIChrome();
    ensureUiPrefs();
    applyThumbColumnsFromPrefs();
    applyTheme();
    bindThemePreferenceListener(() => {
        updateStudioThemeSwitchers();
    });
    applyI18n(); // UI言語を適用

    // Prevent local restore if we are explicitly loading a cloud project via URL
    const urlParams = new URLSearchParams(window.location.search);
    const hasCloudId = urlParams.has('id');

    handleRedirectResult();
    initGIS();

    if (!hasCloudId) {
        try {
            const backup = await idbGet('dsf_autosave');
            if (backup && backup.state) {
                console.log("[DSF] Found local auto-save backup. Restoring...");

                // Restore object URLs for unsaved guest images
                let stateStr = JSON.stringify(backup.state);
                const restoredMap = {};

                if (backup.imageMap) {
                    for (const [oldUrl, localId] of Object.entries(backup.imageMap)) {
                        const blob = await idbGet(localId);
                        if (blob) {
                            const newUrl = URL.createObjectURL(blob);
                            restoredMap[newUrl] = localId; // keep the new mapping alive
                            stateStr = stateStr.split(oldUrl).join(newUrl);
                        }
                    }
                }

                window.localImageMap = restoredMap;
                const restoredState = JSON.parse(stateStr);

                // Only dispatch state keys that exist in our actual store
                dispatch({ type: actionTypes.LOAD_PROJECT, payload: restoredState });
                console.log("[DSF] Auto-save restored successfully.");
            }
        } catch (err) {
            console.warn("[DSF] Error restoring local auto-save:", err);
        }
    }

    refresh();
    renderLangSettings();
    updateAuthUI();
    await renderHomeDashboard();
    const requestedRoom = urlParams.get('room');
    if (requestedRoom && ['home', 'editor', 'press', 'works'].includes(requestedRoom)) {
        window.switchRoom(requestedRoom);
    }
}

bootstrapApp();

// --- 右サイドバーリサイザー初期化 ---
function initSidebarResizer() {
    const resizer = document.getElementById('resizer-right');
    if (!resizer) return;

    const doResize = (e) => {
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        let newWidth = window.innerWidth - clientX;
        if (newWidth < 200) newWidth = 200;
        if (newWidth > 800) newWidth = 800;
        document.body.style.setProperty('--right-panel-width', `${newWidth}px`);
    };

    const stopResize = () => {
        resizer.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', doResize);
        window.removeEventListener('touchmove', doResize);
        window.removeEventListener('mouseup', stopResize);
        window.removeEventListener('touchend', stopResize);
    };

    const startResize = (e) => {
        resizer.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        if (e.type === 'mousedown') e.preventDefault();
        window.addEventListener('mousemove', doResize);
        window.addEventListener('touchmove', doResize, { passive: true });
        window.addEventListener('mouseup', stopResize);
        window.addEventListener('touchend', stopResize);
    };

    resizer.addEventListener('mousedown', startResize);
    resizer.addEventListener('touchstart', startResize, { passive: true });
}

initCanvasZoom(); // Initialize zoom/pan
initImageAdjustment(); // Initialize image adjustment events
initSidebarResizer(); // Initialize sidebar resizer
initContextMenu(); // Initialize right-click context menu

// ============================================================
// Context Menu (Right-Click) Logic
// ============================================================
function initContextMenu() {
    const contextMenu = document.getElementById('context-menu');
    if (!contextMenu) return;

    // キャンバスおよび吹き出し上の右クリックをフック
    document.addEventListener('contextmenu', (e) => {
        // Only intercept if we are in the editor area
        const canvasView = document.getElementById('canvas-view');
        if (!canvasView || !canvasView.contains(e.target)) return;

        e.preventDefault(); // デフォルトメニューを禁止

        // どこがクリックされたか判定
        const bubbleSvg = e.target.closest('.bubble-svg');
        const bubbleText = e.target.closest('.bubble-text');
        const isBubble = bubbleSvg || bubbleText;

        // メニュー内容を動的に生成
        contextMenu.innerHTML = '';

        if (isBubble) {
            // 吹き出しの上で右クリックした場合
            // 要素IDからインデックスを逆引き
            let bubbleIndex = -1;
            const targetEl = bubbleSvg || bubbleText;
            if (targetEl && targetEl.id) {
                const match = targetEl.id.match(/^bubble-(?:svg|text)-(\d+)$/);
                if (match) bubbleIndex = parseInt(match[1], 10);
            }

            if (bubbleIndex !== -1) {
                // select it first (pass refresh so UI updates)
                selectBubble(e, bubbleIndex, refresh);

                const currentShape = (() => {
                    const s2 = state.sections[state.activeIdx];
                    return s2?.bubbles?.[bubbleIndex]?.shape || 'speech';
                })();

                const shapeOptions = [
                    ['speech', '角丸'], ['oval', '楕円'], ['rect', '四角'],
                    ['cloud', '雲'], ['wave', '波'], ['thought', '思考'],
                    ['explosion', '💥 爆発'], ['digital', '📡 電子音'],
                    ['shout', '⚡ ギザギザ'], ['flash', '✨ フラッシュ'], ['urchin', '🦔 ウニフラッシュ']
                ].map(([v, l]) =>
                    `<option value="${v}"${v === currentShape ? ' selected' : ''}>${l}</option>`
                ).join('');

                contextMenu.innerHTML = `
                    <div class="context-menu-item context-menu-shape">
                        <span class="material-icons">auto_fix_high</span>
                        <select class="context-shape-select" onchange="changeBubbleShapeFromMenu(${bubbleIndex}, this.value)" onclick="event.stopPropagation()">
                            ${shapeOptions}
                        </select>
                    </div>
                    <div class="context-menu-item" onclick="duplicateSelectedBubble(${bubbleIndex})">
                        <span class="material-icons">content_copy</span> 複製
                    </div>
                    <div class="context-menu-item" onclick="deleteSelectedBubble(${bubbleIndex})" style="color: #d32f2f;">
                        <span class="material-icons">delete</span> 削除
                    </div>
                `;
            }
        } else {
            // キャンバス（何もない場所）で右クリックした場合
            contextMenu.innerHTML = `
                <div class="context-menu-item" onclick="addBubbleAtPointer(event)">
                    <span class="material-icons">text_fields</span> ここにテキストを追加
                </div>
            `;
            // ポインター座標を一時保存（addBubbleAtPointerで使う）
            contextMenu.dataset.pointerX = e.clientX;
            contextMenu.dataset.pointerY = e.clientY;
        }

        // メニューの表示位置を計算 (画面外にはみ出ないように調整)
        contextMenu.style.display = 'flex';
        const rect = contextMenu.getBoundingClientRect();
        let x = e.clientX;
        let y = e.clientY;

        if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
        if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;

        contextMenu.style.left = `${x}px`;
        contextMenu.style.top = `${y}px`;
    });

    // 画面のどこかをクリックしたらコンテキストメニューを閉じる
    document.addEventListener('click', (e) => {
        if (!contextMenu.contains(e.target)) {
            contextMenu.style.display = 'none';
        }
    });
}

// Global functions for context menu actions
window.addBubbleAtPointer = function (e) {
    const contextMenu = document.getElementById('context-menu');
    if (!contextMenu) return;
    contextMenu.style.display = 'none';

    const clientX = parseFloat(contextMenu.dataset.pointerX);
    const clientY = parseFloat(contextMenu.dataset.pointerY);

    if (isNaN(clientX) || isNaN(clientY)) return;

    const layer = document.getElementById('canvas-transform-layer');
    if (!layer) return;

    const rect = layer.getBoundingClientRect();

    // Convert screen coordinates to canvas % coordinates
    let x = ((clientX - rect.left) / rect.width) * 100;
    let y = ((clientY - rect.top) / rect.height) * 100;

    // Clamp
    x = Math.max(5, Math.min(95, x));
    y = Math.max(5, Math.min(95, y));

    pushState();
    const newBubble = {
        id: 'bubble_' + Date.now(),
        shape: 'rect',
        text: 'テキスト',
        x: x.toFixed(1),
        y: y.toFixed(1),
        tailX: 0,
        tailY: 20
    };

    if (!state.sections[state.activeIdx].bubbles) {
        state.sections[state.activeIdx].bubbles = [];
    }
    state.sections[state.activeIdx].bubbles.push(newBubble);

    // Select the newly created bubble
    state.activeBubbleIdx = state.sections[state.activeIdx].bubbles.length - 1;

    refresh();
    triggerAutoSave();
};

window.duplicateSelectedBubble = function (bubbleIndex) {
    const contextMenu = document.getElementById('context-menu');
    if (contextMenu) contextMenu.style.display = 'none';

    const section = state.sections[state.activeIdx];
    if (!section || !section.bubbles || !section.bubbles[bubbleIndex]) return;

    pushState();
    const source = section.bubbles[bubbleIndex];
    const clone = JSON.parse(JSON.stringify(source));
    clone.id = 'bubble_' + Date.now();
    clone.x = (parseFloat(source.x) + 5).toFixed(1); // slightly offset
    clone.y = (parseFloat(source.y) + 5).toFixed(1);

    section.bubbles.push(clone);
    state.activeBubbleIdx = section.bubbles.length - 1;

    refresh();
    triggerAutoSave();
};

window.deleteSelectedBubble = function (bubbleIndex) {
    const contextMenu = document.getElementById('context-menu');
    if (contextMenu) contextMenu.style.display = 'none';

    const section = state.sections[state.activeIdx];
    if (!section || !section.bubbles || !section.bubbles[bubbleIndex]) return;

    pushState();
    section.bubbles.splice(bubbleIndex, 1);
    state.activeBubbleIdx = null;

    refresh();
    triggerAutoSave();
};
