/**
 * firebase.js — Firebase初期化・クラウド保存/読込・自動保存
 *
 * Storage backend selection:
 *   VITE_STORAGE_BACKEND=firebase  → Firebase Storage (local Vite development)
 *   VITE_STORAGE_BACKEND=r2        → Cloudflare R2 via Pages Function at /upload (Pages production/preview)
 */
import { doc, setDoc, getDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { state, dispatch, actionTypes } from './state.js';
import { getBlockIndexFromPageIndex, syncBlocksWithSections } from './blocks.js';
import { PAGE_SCHEMA_VERSION, blocksToPages, normalizeProjectDataV5 } from './pages.js';
import { composeCanonicalLayoutsForSections } from './layout.js';
import { set as idbSet, get as idbGet } from 'idb-keyval';
import { createId } from './utils.js';
import { loadImageForCanvas, fetchAssetBlob, shouldEmbedAsset } from './asset-fetch.js';
import { db, storage, auth } from './firebase-core.js';

export { db, storage, auth } from './firebase-core.js';

window.localImageMap = window.localImageMap || {};

// --- Firebase Config ---
// 環境は .env.development / .env.staging / .env.production で切り替え
// npm run dev              → .env.development（staging Firebase 接続 / Storage は Firebase）
// npm run build            → .env.production（本番 接続 / Storage は R2）
// npm run build:staging    → .env.staging（staging 接続 / Storage は R2）
// ── Storage backend abstraction ───────────────────────────────────────────────
// When VITE_STORAGE_BACKEND=r2, uploads go to Cloudflare R2 via the Pages
// Function at /upload. Otherwise, Firebase Storage is used.
const _USE_R2 = import.meta.env.VITE_STORAGE_BACKEND === 'r2';
const LOCAL_RECENT_INDEX_KEY = 'dsf_local_recent_index';
const LOCAL_RECENT_PREFIX = 'dsf_local_recent_project_';
const LOCAL_RECENT_LIMIT = 12;
const projectAssetByteCache = new Map();

/**
 * Upload a Blob to R2 via the /upload Pages Function.
 * Requires the user to be signed in (Firebase ID token).
 */
async function _uploadToR2(blob, path) {
    const token = await auth.currentUser?.getIdToken(false);
    if (!token) throw new Error('R2 upload requires authentication');
    const fd = new FormData();
    // Pass blob with the correct MIME type (already webp after compressImage)
    fd.append('file', blob instanceof Blob ? blob : new Blob([blob], { type: 'image/webp' }), path.split('/').pop());
    fd.append('path', path);
    const res = await fetch('/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: fd,
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`R2 upload failed (${res.status}): ${text}`);
    }
    const { url } = await res.json();
    return url;
}

/**
 * Upload a Blob to the configured storage backend and return the public URL.
 * Use this instead of calling uploadBytes/getDownloadURL directly.
 */
async function _storeFile(blob, path) {
    if (_USE_R2) return _uploadToR2(blob, path);
    const storageRef = ref(storage, path);
    const snap = await uploadBytes(storageRef, blob);
    return getDownloadURL(snap.ref);
}

/** Press Room レンダリング結果のアップロード（press.js から使用） */
export async function uploadPressPage(blob, path) {
    return _storeFile(blob, path);
}
// ─────────────────────────────────────────────────────────────────────────────

// --- 自動保存 ---
let autoSaveTimer = null;
let saveStatus = 'idle'; // 'idle' | 'saving' | 'saved' | 'error'
let isSaving = false;
let isThumbnailGenerating = false;
const THUMB_BASE_WIDTH = 360;
const THUMB_BASE_HEIGHT = 640;

function requireUid() {
    if (!state.uid) throw new Error("ログインしてください");
    return state.uid;
}

function projectDocRef(projectId) {
    const uid = requireUid();
    return doc(db, "users", uid, "projects", projectId);
}

function ensureProjectIdentity() {
    if (!state.projectId) {
        state.projectId = createId('proj');
    }
    if (!state.projectName) {
        state.projectName = state.title || '新規プロジェクト';
    }
}

function ensureLocalProjectIdentity(snapshotState = state) {
    if (!snapshotState.localProjectId) {
        snapshotState.localProjectId = createId('local');
    }
    return snapshotState.localProjectId;
}

function getLocalRecentSnapshotId(snapshotState = state) {
    if (snapshotState.projectId) return `cloud:${snapshotState.projectId}`;
    return `local:${ensureLocalProjectIdentity(snapshotState)}`;
}

function getProjectPreviewSource(snapshotState) {
    const activeLang = snapshotState.defaultLang || snapshotState.activeLang || snapshotState.languages?.[0] || 'ja';
    const pages = Array.isArray(snapshotState.pages) ? snapshotState.pages : [];
    const page = pages.find((item) => item?.pageType === 'normal_image');
    if (page?.content) {
        return {
            background: page.content.backgrounds?.[activeLang] || page.content.background || '',
            thumbnail: page.content.thumbnail || '',
            imagePosition: page.content.imagePositions?.[activeLang] || page.content.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0, flipX: false }
        };
    }

    const blocks = Array.isArray(snapshotState.blocks) ? snapshotState.blocks : [];
    const block = blocks.find((item) => item?.kind === 'page' && item?.content?.pageKind === 'image');
    if (block?.content) {
        return {
            background: block.content.backgrounds?.[activeLang] || block.content.background || '',
            thumbnail: block.content.thumbnail || '',
            imagePosition: block.content.imagePositions?.[activeLang] || block.content.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0, flipX: false }
        };
    }

    const sections = Array.isArray(snapshotState.sections) ? snapshotState.sections : [];
    const section = sections.find((item) => item?.type === 'image') || sections[0];
    if (!section) {
        return {
            background: '',
            thumbnail: '',
            imagePosition: { x: 0, y: 0, scale: 1, rotation: 0, flipX: false }
        };
    }

    return {
        background: section.backgrounds?.[activeLang] || section.background || '',
        thumbnail: section.thumbnail || '',
        imagePosition: section.imagePositions?.[activeLang] || section.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0, flipX: false }
    };
}

function getProjectPageCount(snapshotState) {
    const pages = (Array.isArray(snapshotState.pages) ? snapshotState.pages : []).filter((item) =>
        item?.pageType === 'normal_image' || item?.pageType === 'normal_text'
    ).length;
    if (pages > 0) return pages;
    const blockPages = (Array.isArray(snapshotState.blocks) ? snapshotState.blocks : []).filter((item) => item?.kind === 'page').length;
    if (blockPages > 0) return blockPages;
    return Array.isArray(snapshotState.sections) ? snapshotState.sections.length : 0;
}

function collectProjectAssetUrls(snapshotState) {
    const urls = new Set();
    const visit = (value) => {
        if (!value) return;
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        if (typeof value !== 'object') return;

        for (const [key, entry] of Object.entries(value)) {
            if (typeof entry === 'string' && (key === 'background' || key === 'thumbnail')) {
                if (shouldEmbedAsset(entry)) urls.add(entry);
                continue;
            }
            if (key === 'backgrounds' && entry && typeof entry === 'object') {
                Object.values(entry).forEach((url) => {
                    if (typeof url === 'string' && shouldEmbedAsset(url)) urls.add(url);
                });
                continue;
            }
            visit(entry);
        }
    };

    visit(snapshotState.pages || []);
    visit(snapshotState.blocks || []);
    visit(snapshotState.sections || []);
    return [...urls];
}

async function getAssetByteSize(url) {
    if (!shouldEmbedAsset(url)) return 0;
    if (projectAssetByteCache.has(url)) return projectAssetByteCache.get(url);
    try {
        const blob = await fetchAssetBlob(url, 'プロジェクト画像');
        const size = blob?.size || 0;
        projectAssetByteCache.set(url, size);
        return size;
    } catch (e) {
        console.warn('[DSF] Failed to measure asset size:', url, e);
        projectAssetByteCache.set(url, 0);
        return 0;
    }
}

async function computeProjectBytes(snapshotState) {
    const data = {
        version: snapshotState.version || PAGE_SCHEMA_VERSION,
        projectName: snapshotState.projectName || '',
        title: snapshotState.title || '',
        pages: snapshotState.pages || [],
        blocks: snapshotState.blocks || [],
        sections: snapshotState.sections || [],
        languages: snapshotState.languages || ['ja'],
        defaultLang: snapshotState.defaultLang || snapshotState.languages?.[0] || 'ja',
        languageConfigs: snapshotState.languageConfigs || {},
        uiPrefs: snapshotState.uiPrefs || null,
        dsfPages: snapshotState.dsfPages || []
    };
    const jsonBytes = new Blob([JSON.stringify(data)]).size;
    const assetUrls = collectProjectAssetUrls(snapshotState);
    const assetBytes = await Promise.all(assetUrls.map((url) => getAssetByteSize(url)));
    return jsonBytes + assetBytes.reduce((sum, size) => sum + size, 0);
}

async function buildProjectListThumbnail(snapshotState) {
    const preview = getProjectPreviewSource(snapshotState);
    if (!preview.background) return preview.thumbnail || '';

    const { img, revoke } = await loadImageForCanvas(preview.background, '一覧サムネイル元画像');
    try {
        const targetW = 180;
        const targetH = Math.round(targetW * (16 / 9));
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetW, targetH);

        const safePos = {
            x: Number.isFinite(Number(preview.imagePosition?.x)) ? Number(preview.imagePosition.x) : 0,
            y: Number.isFinite(Number(preview.imagePosition?.y)) ? Number(preview.imagePosition.y) : 0,
            scale: Math.max(0.1, Number.isFinite(Number(preview.imagePosition?.scale)) ? Number(preview.imagePosition.scale) : 1),
            rotation: Number.isFinite(Number(preview.imagePosition?.rotation)) ? Number(preview.imagePosition.rotation) : 0,
            flipX: !!preview.imagePosition?.flipX
        };

        const baseW = 360;
        const baseH = 640;
        const ratio = targetW / baseW;

        ctx.save();
        ctx.translate(targetW / 2, targetH / 2);
        ctx.translate(safePos.x * ratio, safePos.y * ratio);
        ctx.rotate((safePos.rotation * Math.PI) / 180);
        ctx.scale(safePos.flipX ? -safePos.scale : safePos.scale, safePos.scale);

        const imgAspect = img.width / img.height;
        const frameAspect = baseW / baseH;
        let drawW;
        let drawH;
        if (imgAspect > frameAspect) {
            drawH = targetH;
            drawW = targetH * imgAspect;
        } else {
            drawW = targetW;
            drawH = targetW / imgAspect;
        }
        ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
        ctx.restore();

        return canvas.toDataURL('image/webp', 0.72);
    } finally {
        revoke();
    }
}

async function buildLocalRecentMeta(snapshotState) {
    let listThumbnail = '';
    try {
        listThumbnail = await buildProjectListThumbnail(snapshotState);
    } catch (e) {
        console.warn('[DSF] Failed to build local recent thumbnail:', e);
        listThumbnail = getProjectPreviewSource(snapshotState).thumbnail || '';
    }

    return {
        id: getLocalRecentSnapshotId(snapshotState),
        projectId: snapshotState.projectId || null,
        localProjectId: snapshotState.localProjectId || null,
        projectName: snapshotState.projectName || '',
        title: snapshotState.title || '',
        thumbnail: listThumbnail || getProjectPreviewSource(snapshotState).thumbnail || '',
        listThumbnail,
        pageCount: getProjectPageCount(snapshotState),
        languages: Array.isArray(snapshotState.languages) && snapshotState.languages.length > 0 ? snapshotState.languages : ['ja'],
        projectBytes: await computeProjectBytes(snapshotState),
        updatedAt: Date.now()
    };
}

export async function cacheLocalRecentProject(snapshotState, imageMap = window.localImageMap || {}) {
    const projectState = JSON.parse(JSON.stringify(snapshotState || state));
    ensureLocalProjectIdentity(projectState);
    const snapshotId = getLocalRecentSnapshotId(projectState);
    await idbSet(`${LOCAL_RECENT_PREFIX}${snapshotId}`, {
        state: projectState,
        imageMap: imageMap || {}
    });

    const storedIndex = await idbGet(LOCAL_RECENT_INDEX_KEY);
    const prevIndex = Array.isArray(storedIndex) ? storedIndex : [];
    const nextEntry = await buildLocalRecentMeta(projectState);
    const nextIndex = [nextEntry, ...prevIndex.filter((item) => item?.id !== snapshotId)].slice(0, LOCAL_RECENT_LIMIT);
    await idbSet(LOCAL_RECENT_INDEX_KEY, nextIndex);
}

export async function listLocalRecentProjects() {
    const index = Array.isArray(await idbGet(LOCAL_RECENT_INDEX_KEY)) ? await idbGet(LOCAL_RECENT_INDEX_KEY) : [];
    return index
        .filter((item) => item && item.id)
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

export async function loadLocalRecentProject(snapshotId) {
    const record = await idbGet(`${LOCAL_RECENT_PREFIX}${snapshotId}`);
    if (!record?.state) throw new Error('ローカルプロジェクトが見つかりません');

    let stateStr = JSON.stringify(record.state);
    const restoredMap = {};
    if (record.imageMap) {
        for (const [oldUrl, localId] of Object.entries(record.imageMap)) {
            const blob = await idbGet(localId);
            if (blob) {
                const newUrl = URL.createObjectURL(blob);
                restoredMap[newUrl] = localId;
                stateStr = stateStr.split(oldUrl).join(newUrl);
            }
        }
    }

    window.localImageMap = restoredMap;
    return JSON.parse(stateStr);
}

export function onAuthChanged(callback) {
    return onAuthStateChanged(auth, callback);
}

/**
 * 保存ステータスを更新してUIに反映する
 */
function updateSaveIndicator(status, message) {
    saveStatus = status;
    const el = document.getElementById('save-status');
    if (!el) return;

    const icons = { idle: '', saving: '●', saved: '✓', error: '!' };
    const colors = { idle: '#999', saving: '#f0ad4e', saved: '#34c759', error: '#ff3b30' };

    el.textContent = `${icons[status]} ${message || ''}`;
    el.style.color = colors[status];
}

/**
 * 自動保存をトリガーする（2秒デバウンス）
 */
export function triggerAutoSave() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);

    updateSaveIndicator('idle', '未保存');

    autoSaveTimer = setTimeout(async () => {
        await performSave();
    }, 2000);
}

/**
 * 即時保存（タイマーをキャンセルして直ちに保存する）
 * await が必要な場面（共有URL生成・公開設定変更など）で使用する
 */
export async function flushSave() {
    if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = null;
    }
    await performSave();
}

// ─── Blob URL 解決ヘルパー ─────────────────────────────────────────────────────

/**
 * blob: URL を Firebase Storage にアップロードして実 URL を返す。
 * localImageMap にエントリがなければ '' を返す（ゲストセッション切れなど）。
 */
async function _uploadBlobUrlToStorage(blobUrl, uid) {
    const localId = window.localImageMap?.[blobUrl];
    if (!localId) return '';
    try {
        const blob = await idbGet(localId);
        if (!blob) return '';
        const timestamp = Date.now();
        const path = `users/${uid}/dsf/recovered/${timestamp}.webp`;
        const downloadUrl = await _storeFile(blob, path);
        if (downloadUrl) {
            window.localImageMap[downloadUrl] = localId;
            delete window.localImageMap[blobUrl];
        }
        return downloadUrl;
    } catch (e) {
        console.warn('[DSF] blob: URL のアップロードに失敗、破棄します:', e);
        return '';
    }
}

/**
 * sections 配列の background / thumbnail に含まれる blob: URL を
 * Storage URL に変換した新しい配列を返す。保存前に呼び出す。
 */
async function resolveBlobUrlsInSections(sections, uid) {
    const resolved = JSON.parse(JSON.stringify(sections));
    for (const s of resolved) {
        if (typeof s.background === 'string' && s.background.startsWith('blob:')) {
            s.background = await _uploadBlobUrlToStorage(s.background, uid);
        }
        if (typeof s.thumbnail === 'string' && s.thumbnail.startsWith('blob:')) {
            s.thumbnail = await _uploadBlobUrlToStorage(s.thumbnail, uid);
        }
        if (s.backgrounds && typeof s.backgrounds === 'object') {
            for (const lang of Object.keys(s.backgrounds)) {
                if (typeof s.backgrounds[lang] === 'string' && s.backgrounds[lang].startsWith('blob:')) {
                    s.backgrounds[lang] = await _uploadBlobUrlToStorage(s.backgrounds[lang], uid);
                }
            }
        }
    }
    return resolved;
}

/**
 * blocks 配列の content.background / content.thumbnail に含まれる blob: URL を
 * Storage URL に変換した新しい配列を返す。保存前に呼び出す。
 */
async function resolveBlobUrlsInBlocks(blocks, uid) {
    const resolved = JSON.parse(JSON.stringify(blocks));
    const resolveContent = async (content) => {
        if (!content) return;
        if (typeof content.background === 'string' && content.background.startsWith('blob:')) {
            content.background = await _uploadBlobUrlToStorage(content.background, uid);
        }
        if (typeof content.thumbnail === 'string' && content.thumbnail.startsWith('blob:')) {
            content.thumbnail = await _uploadBlobUrlToStorage(content.thumbnail, uid);
        }
        if (content.backgrounds && typeof content.backgrounds === 'object') {
            for (const lang of Object.keys(content.backgrounds)) {
                if (typeof content.backgrounds[lang] === 'string' && content.backgrounds[lang].startsWith('blob:')) {
                    content.backgrounds[lang] = await _uploadBlobUrlToStorage(content.backgrounds[lang], uid);
                }
            }
        }
    };
    for (const block of resolved) {
        await resolveContent(block.content);
        if (Array.isArray(block.pages)) {
            for (const page of block.pages) await resolveContent(page.content);
        }
    }
    return resolved;
}

/**
 * オブジェクト内のすべての blob: URL を '' に置換する（マイグレーション用）。
 * loadProject 時に呼び出して既存の破損データによるクラッシュを防ぐ。
 */
function stripBlobUrls(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(stripBlobUrls);
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string' && v.startsWith('blob:')) {
            console.warn(`[DSF] 破損した blob: URL を除去 (field: "${k}")`);
            out[k] = '';
        } else {
            out[k] = stripBlobUrls(v);
        }
    }
    return out;
}

// ──────────────────────────────────────────────────────────────────────────────

/**
 * 実際の保存処理
 */
async function performSave() {
    if (isSaving) return;
    isSaving = true;
    try {
    // レイアウト確定: テキストセクションの layout[lang] を計算して state.sections に書き込む（意図的な mutation）
    composeCanonicalLayoutsForSections(state.sections, state.languages, state.languageConfigs);
    // blocks / pages は保存専用のローカル変数に計算し、グローバル state を dispatch なしに書き換えない
    const blocksToSave = syncBlocksWithSections(state.blocks, state.sections, state.languages);
    const pagesToSave = blocksToPages(blocksToSave);

    updateSaveIndicator('saving', '保存中...');

    // 1. ローカルバックアップ (常に実行)
    try {
        const localSnapshot = JSON.parse(JSON.stringify({ ...state, blocks: blocksToSave, pages: pagesToSave }));
        ensureLocalProjectIdentity(localSnapshot);
        state.localProjectId = localSnapshot.localProjectId;
        await idbSet('dsf_autosave', {
            state: localSnapshot,
            imageMap: window.localImageMap
        });
        await cacheLocalRecentProject(localSnapshot, window.localImageMap);
        updateSaveIndicator('saved', '保存済み (Local)');
    } catch (e) {
        console.warn("[DSF] Local auto-save to IndexedDB failed:", e);
    }

    // 2. クラウドバックアップ (ログイン時のみ)
    if (state.projectId && state.uid) {
        try {
            const visibility = state.visibility || 'private';

            // blob: URL が残っている場合は Storage にアップロードして実 URL に変換
            const cleanSections = await resolveBlobUrlsInSections(state.sections, state.uid);
            const cleanBlocks   = await resolveBlobUrlsInBlocks(blocksToSave, state.uid);
            const persistedProject = {
                version: PAGE_SCHEMA_VERSION,
                projectName: state.projectName || '',
                title: state.title || '',
                pages: pagesToSave,
                blocks: cleanBlocks,
                sections: cleanSections,
                languages: state.languages,
                defaultLang: state.defaultLang || state.languages?.[0] || 'ja',
                languageConfigs: state.languageConfigs,
                uiPrefs: state.uiPrefs || null
            };

            let listThumbnail = '';
            try {
                listThumbnail = await buildProjectListThumbnail(persistedProject);
            } catch (e) {
                console.warn('[DSF] Failed to build cloud project thumbnail:', e);
                listThumbnail = getProjectPreviewSource(persistedProject).thumbnail || '';
            }
            const projectBytes = await computeProjectBytes(persistedProject);

            // Press Room フィールドを引き継ぐために既存ドキュメントを取得
            const existingSnap = await getDoc(projectDocRef(state.projectId));
            const existingData = existingSnap.exists() ? existingSnap.data() : {};
            const pressFields = {};
            for (const key of ['dsfPages', 'dsfStatus', 'dsfTotalBytes', 'dsfResolution', 'dsfQuality', 'dsfPageCount', 'updatedAt']) {
                if (existingData[key] !== undefined) pressFields[key] = existingData[key];
            }

            await setDoc(projectDocRef(state.projectId), {
                ...pressFields,
                ...persistedProject,
                listThumbnail,
                projectBytes,
                visibility: visibility,
                ownerUid: state.uid,
                ownerEmail: state.user?.email || '',
                lastUpdated: new Date()
            });

            // 3. public_projects コレクションへの同期
            const publicProjectRef = doc(db, 'public_projects', state.projectId);
            if (visibility === 'public') {
                await setDoc(publicProjectRef, {
                    title: state.title || '無題のプロジェクト',
                    authorName: state.user?.displayName || state.user?.email?.split('@')[0] || '名無し',
                    authorUid: state.uid,
                    thumbnail: listThumbnail || getProjectPreviewSource(persistedProject).thumbnail || '',
                    publishedAt: serverTimestamp() // Bumps to top on save
                }, { merge: true });
            } else {
                // private や unlisted になった場合は一覧から削除
                await deleteDoc(publicProjectRef).catch(e => console.warn('[DSF] Failed to remove from public_projects:', e));
            }

            updateSaveIndicator('saved', '保存済み (Cloud)');
            console.log(`[DSF] Auto-saved project to cloud: ${state.projectId}`);
        } catch (e) {
            console.error("[DSF] Cloud auto-save failed:", e);
            updateSaveIndicator('error', '保存失敗 (Cloud)');
        }
    }
    } finally {
        isSaving = false;
    }
}


/**
 * 手動保存（プロジェクトIDを新規設定して保存）
 */
export async function saveAsProject() {
    requireUid();
    ensureProjectIdentity();
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'projectId', value: state.projectId } });
    await performSave();
}

/**
 * 後方互換: 旧API `saveProject` を維持する
 * @param {string=} pid - 任意のプロジェクトID
 */
export async function saveProject(pid) {
    requireUid();
    if (pid) dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'projectId', value: pid } });
    ensureProjectIdentity();
    await performSave();
}

/**
 * 画像を圧縮・リサイズするヘルパー関数
 * @param {File} file - 入力ファイル
 * @param {number} maxWidth - 最大幅
 * @param {number} quality - 画質 (0.0 - 1.0)
 * @returns {Promise<Blob>} - 圧縮されたBlob (image/webp)
 */
function compressImage(file, maxWidth, quality) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const reader = new FileReader();

        reader.onload = (e) => {
            img.src = e.target.result;
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = Math.round(height * (maxWidth / width));
                    width = maxWidth;
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error("Canvas to Blob failed"));
                }, 'image/webp', quality);
            };
            img.onerror = (e) => reject(e);
        };
        reader.onerror = (e) => reject(e);
        reader.readAsDataURL(file);
    });
}

/**
 * 切り抜き位置・スケールを反映してサムネイルを再生成・アップロードする
 * @param {string} bgUrl - 現在の背景画像URL
 * @param {object} pos - {x, y, scale}
 * @param {function} refresh - 画面更新コールバック
 */
export async function generateCroppedThumbnail(bgUrl, pos, refresh) {
    if (!bgUrl) return;
    if (isThumbnailGenerating) return;
    isThumbnailGenerating = true;

    try {
        const timestamp = Date.now();
        const { img, revoke } = await loadImageForCanvas(bgUrl, 'サムネイル生成元画像');

        const targetW = 320;
        const targetH = Math.round(targetW * (16 / 9));

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');

        // 白背景（透明画像対策）
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, targetW, targetH);

        const safePos = {
            x: Number.isFinite(Number(pos?.x)) ? Number(pos.x) : 0,
            y: Number.isFinite(Number(pos?.y)) ? Number(pos.y) : 0,
            scale: Math.max(0.1, Number.isFinite(Number(pos?.scale)) ? Number(pos.scale) : 1),
            rotation: Number.isFinite(Number(pos?.rotation)) ? Number(pos.rotation) : 0
        };

        const frameAspect = THUMB_BASE_WIDTH / THUMB_BASE_HEIGHT;
        const imgAspect = img.width / img.height;
        let frameWidth = THUMB_BASE_WIDTH;
        let frameHeight = THUMB_BASE_HEIGHT;
        if (imgAspect > frameAspect) {
            frameWidth = THUMB_BASE_HEIGHT * imgAspect;
        } else {
            frameHeight = THUMB_BASE_WIDTH / imgAspect;
        }
        const ratio = targetW / THUMB_BASE_WIDTH;

        ctx.save();
        ctx.translate(targetW / 2, targetH / 2);
        ctx.translate(safePos.x * ratio, safePos.y * ratio);
        ctx.rotate((safePos.rotation * Math.PI) / 180);
        ctx.scale(safePos.scale, safePos.scale);
        ctx.drawImage(
            img,
            -(frameWidth * ratio) / 2,
            -(frameHeight * ratio) / 2,
            frameWidth * ratio,
            frameHeight * ratio
        );

        ctx.restore();
        revoke();

        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.8));
        let thumbUrl = '';
        if (!state.uid) {
            const thumbKey = `local_img_thumb_adjusted_${timestamp}`;
            await idbSet(thumbKey, blob);
            thumbUrl = URL.createObjectURL(blob);
            window.localImageMap[thumbUrl] = thumbKey;
        } else {
            const uid = requireUid();
            const filename = `cropped_${timestamp}`;
            const thumbPath = `users/${uid}/dsf/thumbs/${timestamp}_${filename}_thumb.webp`;
            thumbUrl = await _storeFile(blob, thumbPath);
        }

        const newSections = [...state.sections];
        newSections[state.activeIdx].thumbnail = thumbUrl;
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: newSections } });
        console.log("[DSF] Thumbnail updated:", thumbUrl);

        refresh(); // update thumbnails if logical
        triggerAutoSave();

    } catch (e) {
        console.warn("[DSF] Thumbnail generation failed (likely CORS):", e);
        // エラーでも処理は止めない（サムネ生成失敗だけなので）
    } finally {
        isThumbnailGenerating = false;
    }
}

/**
 * 画像をアップロードし、セクションの背景に設定する
 * クライアント側でWebP変換・サムネイル生成を行う
 * 未ログイン(Guest)の場合は IndexedDB に一時保存して ObjectURL を返す
 * @param {HTMLInputElement} input - ファイル入力要素
 * @param {function} refresh - 画面更新コールバック
 */
export async function uploadToStorage(input, refresh) {
    const file = input.files[0];
    if (!file) return;

    const labelEl = document.getElementById('text-label');
    const originalText = labelEl?.innerText ?? '';
    const setLabel = (text) => { if (labelEl) labelEl.innerText = text; };

    setLabel("処理中...");

    try {
        // 1. 画像圧縮 (メイン: max 1280px, サムネイル: max 320px)
        const [mainBlob, thumbBlob] = await Promise.all([
            compressImage(file, 1280, 0.8),
            compressImage(file, 320, 0.8)
        ]);

        const timestamp = Date.now();
        const filename = file.name.replace(/\.[^/.]+$/, "");

        // --- ゲスト（未ログイン）モード時のローカル保存処理 ---
        if (!state.uid) {
            setLabel("ローカル保存中...");

            const mainKey = `local_img_main_${timestamp}`;
            const thumbKey = `local_img_thumb_${timestamp}`;

            await Promise.all([
                idbSet(mainKey, mainBlob),
                idbSet(thumbKey, thumbBlob)
            ]);

            const mainUrl = URL.createObjectURL(mainBlob);
            const thumbUrl = URL.createObjectURL(thumbBlob);

            // マッピングを保持 (IndexedDBのキーとURLを紐づける)
            window.localImageMap[mainUrl] = mainKey;
            window.localImageMap[thumbUrl] = thumbKey;

            // ステート更新
            const lang = state.activeLang || state.defaultLang || 'ja';
            const isMultiLang = (state.languages || ['ja']).length > 1;
            const newSections = [...state.sections];
            if (!newSections[state.activeIdx].backgrounds) newSections[state.activeIdx].backgrounds = {};
            newSections[state.activeIdx].backgrounds[lang] = mainUrl;
            // 多言語時は language-agnostic な background を変更しない（他言語のフォールバックが壊れる）
            if (!isMultiLang) newSections[state.activeIdx].background = mainUrl;
            newSections[state.activeIdx].thumbnail = thumbUrl;
            if (!newSections[state.activeIdx].imagePositions) newSections[state.activeIdx].imagePositions = {};
            newSections[state.activeIdx].imagePositions[lang] = { x: 0, y: 0, scale: 1, rotation: 0, flipX: false };
            newSections[state.activeIdx].imageBasePosition = { x: 0, y: 0, scale: 1, rotation: 0, flipX: false };
            dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: newSections } });

            refresh();
            triggerAutoSave();

            setLabel("完了！");
            setTimeout(() => setLabel(originalText), 2000);
            return;
        }

        // --- ログイン時の Storage 保存処理 ---
        const uid = state.uid;
        const mainPath = `users/${uid}/dsf/${timestamp}_${filename}.webp`;
        const thumbPath = `users/${uid}/dsf/thumbs/${timestamp}_${filename}_thumb.webp`;

        setLabel("アップロード中...");

        // 2. アップロード & URL取得
        const [mainUrl, thumbUrl] = await Promise.all([
            _storeFile(mainBlob, mainPath),
            _storeFile(thumbBlob, thumbPath),
        ]);

        // 4. ステート更新
        const lang = state.activeLang || state.defaultLang || 'ja';
        const isMultiLang = (state.languages || ['ja']).length > 1;
        const newSections = [...state.sections];
        if (!newSections[state.activeIdx].backgrounds) newSections[state.activeIdx].backgrounds = {};
        newSections[state.activeIdx].backgrounds[lang] = mainUrl;
        // 多言語時は language-agnostic な background を変更しない（他言語のフォールバックが壊れる）
        if (!isMultiLang) newSections[state.activeIdx].background = mainUrl;
        newSections[state.activeIdx].thumbnail = thumbUrl;
        if (!newSections[state.activeIdx].imagePositions) newSections[state.activeIdx].imagePositions = {};
        newSections[state.activeIdx].imagePositions[lang] = { x: 0, y: 0, scale: 1, rotation: 0, flipX: false };
        newSections[state.activeIdx].imageBasePosition = { x: 0, y: 0, scale: 1, rotation: 0, flipX: false };
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: newSections } });

        refresh();
        triggerAutoSave();

        setLabel("完了！");
        setTimeout(() => setLabel(originalText), 2000);
    } catch (e) {
        console.error(e);
        alert("保存失敗: " + e.message);
        setLabel(originalText);
    } finally {
        console.log("[DSF] Upload process finished.");
        input.value = ''; // Reset input to allow same file selection
    }
}

/**
 * Firestoreからセクションデータを読み込む
 * @param {string} pid - プロジェクトID
 * @param {function} refresh - 画面更新コールバック
 */
export async function loadProject(pid, refresh) {
    if (!state.uid) return;
    const snap = await getDoc(projectDocRef(pid));
    if (snap.exists()) {
        const raw = normalizeProjectDataV5(snap.data() || {});
        // 既存データに残存する blob: URL を除去（マイグレーション・クラッシュ防止）
        const data = stripBlobUrls(raw);
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'projectId', value: pid } });
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'projectName', value: data.projectName || pid } });
        dispatch({ type: actionTypes.SET_TITLE, payload: data.title || '' });
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'pages', value: data.pages || [] } });
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: data.blocks || [] } });
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: data.sections } });
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'dsfPages', value: Array.isArray(data.dsfPages) ? data.dsfPages : [] } });
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'languages', value: data.languages && data.languages.length > 0 ? data.languages : ['ja'] } });
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'defaultLang', value: data.defaultLang || (data.languages && data.languages.length > 0 ? data.languages[0] : 'ja') } });
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'uiPrefs', value: data.uiPrefs || state.uiPrefs || {} } });
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'visibility', value: data.visibility || 'private' } });
        dispatch({ type: actionTypes.SET_ACTIVE_LANGUAGE, payload: data.defaultLang || (data.languages && data.languages.length > 0 ? data.languages[0] : 'ja') });
        dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: 0 });
        dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: Math.max(0, getBlockIndexFromPageIndex(data.blocks || [], 0)) });
        dispatch({ type: actionTypes.SET_ACTIVE_BUBBLE_INDEX, payload: null });
        refresh();
    }
}

/**
 * 表紙/裏表紙の画像をFirebase Storageにアップロードし、cover blockに設定する
 * @param {HTMLInputElement} input - ファイル入力要素
 * @param {function} refresh - 画面更新コールバック
 */
export async function uploadCoverToStorage(input, refresh) {
    const uid = requireUid();
    const file = input.files[0];
    if (!file) return;

    const block = (state.blocks || [])[state.activeBlockIdx];
    if (!block || (block.kind !== 'cover_front' && block.kind !== 'cover_back')) {
        input.value = '';
        return;
    }

    try {
        const [mainBlob, thumbBlob] = await Promise.all([
            compressImage(file, 1280, 0.8),
            compressImage(file, 320, 0.8)
        ]);

        const timestamp = Date.now();
        const filename = file.name.replace(/\.[^/.]+$/, "");
        const base = block.kind === 'cover_front' ? 'cover_front' : 'cover_back';
        const mainPath = `users/${uid}/dsf/covers/${base}_${timestamp}_${filename}.webp`;
        const thumbPath = `users/${uid}/dsf/covers/thumbs/${base}_${timestamp}_${filename}_thumb.webp`;

        const [mainUrl, thumbUrl] = await Promise.all([
            _storeFile(mainBlob, mainPath),
            _storeFile(thumbBlob, thumbPath),
        ]);

        if (!block.content || typeof block.content !== 'object') block.content = {};
        block.content.background = mainUrl;
        block.content.thumbnail = thumbUrl;
        if (!block.content.imagePosition) block.content.imagePosition = { x: 0, y: 0, scale: 1, rotation: 0 };
        if (!block.content.imageBasePosition) block.content.imageBasePosition = { x: 0, y: 0, scale: 1, rotation: 0 };
        if (!block.meta || typeof block.meta !== 'object') block.meta = {};
        block.meta.bodyKind = 'image';
        block.meta.renderMode = 'image';

        refresh();
        triggerAutoSave();
    } catch (e) {
        console.error(e);
        alert("保存失敗: " + e.message);
    } finally {
        input.value = '';
    }
}

/**
 * 章/節/項ブロック用画像をアップロードしてブロックcontentへ設定する
 * @param {HTMLInputElement} input
 * @param {function} refresh
 */
export async function uploadStructureToStorage(input, refresh) {
    const uid = requireUid();
    const file = input.files[0];
    if (!file) return;

    const block = (state.blocks || [])[state.activeBlockIdx];
    if (!block || !['chapter', 'section', 'item'].includes(block.kind)) {
        input.value = '';
        return;
    }

    try {
        const [mainBlob, thumbBlob] = await Promise.all([
            compressImage(file, 1280, 0.8),
            compressImage(file, 320, 0.8)
        ]);
        const timestamp = Date.now();
        const filename = file.name.replace(/\.[^/.]+$/, "");
        const base = block.kind;
        const mainPath = `users/${uid}/dsf/structure/${base}_${timestamp}_${filename}.webp`;
        const thumbPath = `users/${uid}/dsf/structure/thumbs/${base}_${timestamp}_${filename}_thumb.webp`;

        const [mainUrl, thumbUrl] = await Promise.all([
            _storeFile(mainBlob, mainPath),
            _storeFile(thumbBlob, thumbPath),
        ]);

        if (!block.content || typeof block.content !== 'object') block.content = {};
        block.content.background = mainUrl;
        block.content.thumbnail = thumbUrl;
        block.content.imagePosition = { x: 0, y: 0, scale: 1, rotation: 0 };
        block.content.imageBasePosition = { x: 0, y: 0, scale: 1, rotation: 0 };
        if (!block.meta || typeof block.meta !== 'object') block.meta = {};
        block.meta.bodyKind = 'image';
        block.meta.renderMode = 'image';

        refresh();
        triggerAutoSave();
    } catch (e) {
        console.error(e);
        alert("保存失敗: " + e.message);
    } finally {
        input.value = '';
    }
}
