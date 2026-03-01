/**
 * firebase.js — Firebase初期化・クラウド保存/読込・自動保存
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
    inMemoryPersistence,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { state, dispatch, actionTypes } from './state.js';
import { getBlockIndexFromPageIndex, syncBlocksWithSections } from './blocks.js';
import { PAGE_SCHEMA_VERSION, blocksToPages, normalizeProjectDataV5 } from './pages.js';
import { composeCanonicalLayoutsForSections } from './layout.js';
import { set as idbSet, get as idbGet } from 'idb-keyval';

window.localImageMap = window.localImageMap || {};

// --- Firebase Config ---
// 環境は .env.development / .env.staging / .env.production で切り替え
// npm run dev       → .env.development（staging 接続）
// npm run build     → .env.production（本番 接続）
// npm run build:staging → .env.staging（staging 接続）
const firebaseConfig = {
    apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId:             import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId:     import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
let authInitPromise = null;
let authPersistenceLevel = 'unknown'; // local | session | memory | unavailable
const AUTH_REDIRECT_PENDING_KEY = 'dsf-auth-redirect-pending';

function isIOSDevice() {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    const iOSUA = /iPad|iPhone|iPod/i.test(ua);
    // iPadOS desktop UA support
    const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    return iOSUA || iPadOS;
}

async function ensureAuthPersistence() {
    if (authInitPromise) return authInitPromise;
    authInitPromise = (async () => {
        try {
            await setPersistence(auth, browserLocalPersistence);
            authPersistenceLevel = 'local';
            return;
        } catch (_) {
            // Continue with weaker persistence fallback
        }
        try {
            await setPersistence(auth, browserSessionPersistence);
            authPersistenceLevel = 'session';
            return;
        } catch (_) {
            // Continue with weakest persistence fallback
        }
        try {
            await setPersistence(auth, inMemoryPersistence);
            authPersistenceLevel = 'memory';
        } catch (_) {
            authPersistenceLevel = 'unavailable';
        }
    })();
    return authInitPromise;
}

function markRedirectPending() {
    try {
        sessionStorage.setItem(AUTH_REDIRECT_PENDING_KEY, '1');
    } catch (_) {
        // ignore
    }
}

function wasRedirectPending() {
    try {
        return sessionStorage.getItem(AUTH_REDIRECT_PENDING_KEY) === '1';
    } catch (_) {
        return false;
    }
}

function clearRedirectPending() {
    try {
        sessionStorage.removeItem(AUTH_REDIRECT_PENDING_KEY);
    } catch (_) {
        // ignore
    }
}

// --- 自動保存 ---
let autoSaveTimer = null;
let saveStatus = 'idle'; // 'idle' | 'saving' | 'saved' | 'error'
let isSaving = false;
let isThumbnailGenerating = false;

function requireUid() {
    if (!state.uid) throw new Error("ログインしてください");
    return state.uid;
}

function projectDocRef(projectId) {
    const uid = requireUid();
    return doc(db, "users", uid, "projects", projectId);
}

export async function signInWithGoogle() {
    await ensureAuthPersistence();
    // Redirect login requires persistence that survives full-page navigation.
    if (isIOSDevice() && authPersistenceLevel === 'memory') {
        const err = new Error('ブラウザ設定によりログイン状態を保持できません。SafariでプライベートブラウズOFF/すべてのCookieをブロックOFFを確認してください。');
        err.code = 'auth/persistence-unavailable';
        throw err;
    }
    const popupFallbackCodes = new Set([
        'auth/popup-blocked',
        'auth/popup-closed-by-user',
        'auth/cancelled-popup-request',
        'auth/operation-not-supported-in-this-environment'
    ]);
    try {
        const result = await signInWithPopup(auth, googleProvider);
        return result.user;
    } catch (e) {
        if (popupFallbackCodes.has(e?.code)) {
            markRedirectPending();
            await signInWithRedirect(auth, googleProvider);
            return null;
        }
        throw e;
    }
}

export async function signOutUser() {
    await signOut(auth);
}

export function onAuthChanged(callback) {
    return onAuthStateChanged(auth, callback);
}

export async function consumeRedirectResult() {
    await ensureAuthPersistence();
    const pending = wasRedirectPending();
    try {
        const result = await getRedirectResult(auth);
        if (pending) {
            clearRedirectPending();
        }
        // Detect silent redirect failure on iOS (no error, no user, no result).
        if (pending && !result && !auth.currentUser) {
            const err = new Error('リダイレクト後に認証状態を復元できませんでした。ブラウザのCookie/トラッキング設定を確認してください。');
            err.code = 'auth/redirect-state-lost';
            throw err;
        }
        return result;
    } catch (e) {
        if (pending) {
            clearRedirectPending();
        }
        throw e;
    }
}

/**
 * 保存ステータスを更新してUIに反映する
 */
function updateSaveIndicator(status, message) {
    saveStatus = status;
    const el = document.getElementById('save-status');
    if (!el) return;

    const icons = { idle: '', saving: '💾', saved: '✓', error: '⚠' };
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
        const storageRef = ref(storage, `users/${uid}/dsf/recovered/${timestamp}.webp`);
        const snap = await uploadBytes(storageRef, blob);
        const downloadUrl = await getDownloadURL(snap.ref);
        window.localImageMap[downloadUrl] = localId;
        delete window.localImageMap[blobUrl];
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

function normalizeLocalizedMap(value) {
    if (!value || typeof value !== 'object') return {};
    const out = {};
    for (const [lang, text] of Object.entries(value)) {
        if (typeof text !== 'string') continue;
        const trimmed = text.trim();
        if (trimmed) out[lang] = trimmed;
    }
    return out;
}

function pickLocalizedValue(map, preferredLang, fallbackLangs = [], fallback = '') {
    if (preferredLang && typeof map[preferredLang] === 'string' && map[preferredLang]) {
        return map[preferredLang];
    }
    for (const lang of fallbackLangs) {
        if (typeof map[lang] === 'string' && map[lang]) return map[lang];
    }
    const first = Object.values(map).find((v) => typeof v === 'string' && v);
    return first || fallback;
}

function buildPublicProjectPayload(pages, cleanSections) {
    const coverPage = (Array.isArray(pages) ? pages : []).find((p) => p?.role === 'cover_front' || p?.pageType === 'cover_front') || null;
    const langListRaw = Array.isArray(state.languages) && state.languages.length ? state.languages : ['ja'];
    const langList = [...new Set(langListRaw.filter((lang) => typeof lang === 'string' && lang))];
    const defaultLang = (typeof state.defaultLang === 'string' && langList.includes(state.defaultLang))
        ? state.defaultLang
        : (langList[0] || 'ja');

    const titles = normalizeLocalizedMap(coverPage?.meta?.title);
    const subtitles = normalizeLocalizedMap(coverPage?.meta?.subtitle);
    const authors = normalizeLocalizedMap(coverPage?.meta?.author);
    const fallbackTitle = (typeof state.title === 'string' && state.title.trim())
        ? state.title.trim()
        : (state.projectId || '無題のプロジェクト');
    const fallbackAuthor = state.user?.displayName || state.user?.email?.split('@')[0] || '名無し';
    const title = pickLocalizedValue(titles, defaultLang, langList, fallbackTitle);
    const subtitle = pickLocalizedValue(subtitles, defaultLang, langList, '');
    const authorName = pickLocalizedValue(authors, defaultLang, langList, fallbackAuthor);
    const thumbnail = coverPage?.content?.thumbnail
        || coverPage?.content?.background
        || cleanSections?.[0]?.thumbnail
        || cleanSections?.[0]?.background
        || '';

    return {
        title,
        subtitle,
        titles,
        subtitles,
        authorName,
        authors,
        authorUid: state.uid,
        thumbnail,
        languages: langList,
        defaultLang
    };
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
        await idbSet('dsf_autosave', {
            state: JSON.parse(JSON.stringify({ ...state, blocks: blocksToSave, pages: pagesToSave })),
            imageMap: window.localImageMap
        });
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

            await setDoc(projectDocRef(state.projectId), {
                version: PAGE_SCHEMA_VERSION,
                title: state.title || '',
                pages: pagesToSave,
                blocks: cleanBlocks,
                sections: cleanSections,
                languages: state.languages,
                defaultLang: state.defaultLang || state.languages?.[0] || 'ja',
                languageConfigs: state.languageConfigs,
                uiPrefs: state.uiPrefs || null,
                visibility: visibility,
                ownerUid: state.uid,
                ownerEmail: state.user?.email || '',
                lastUpdated: new Date()
            });

            // 3. public_projects コレクションへの同期
            const publicProjectRef = doc(db, 'public_projects', state.projectId);
            if (visibility === 'public') {
                const publicPayload = buildPublicProjectPayload(pagesToSave, cleanSections);
                await setDoc(publicProjectRef, {
                    ...publicPayload,
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
    const pid = prompt("プロジェクト名を入力してください:", state.projectId || "");
    if (!pid) return;

    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'projectId', value: pid } });
    await performSave();
}

/**
 * 後方互換: 旧API `saveProject` を維持する
 * @param {string=} pid - 任意のプロジェクトID
 */
export async function saveProject(pid) {
    requireUid();
    if (pid) dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'projectId', value: pid } });
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
    const uid = requireUid();

    try {
        const timestamp = Date.now();
        // オリジナルファイル名はURLから推測（簡易的）
        const filename = "cropped_" + timestamp;
        const thumbPath = `users/${uid}/dsf/thumbs/${timestamp}_${filename}_thumb.webp`;

        // Canvasで描画
        const img = new Image();
        img.crossOrigin = "anonymous"; // CORS対応トライ
        img.src = bgUrl;

        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
        });

        // サムネイルサイズ (9:16)
        const targetW = 320;
        // height = 320 * (16/9) = 568.88...
        const targetH = Math.round(targetW * (16 / 9));

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');

        // 白背景（透明画像対策）
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, targetW, targetH);

        // 描画
        // オリジナルキャンバス(360x640)に対する比率
        const baseW = 360;
        const baseH = 640;
        const ratio = targetW / baseW; // 320/360 = 0.888...

        // pos.x, pos.y は 360x640 基準の移動量
        // pos.scale は拡大率
        // imgは width:100%, height:100%, object-fit:cover 相当で描画されている
        // つまり、imgの描画サイズは baseW x baseH (のアスペクト比維持)

        ctx.save();

        // 中心基準で変形するため、中心へ移動
        const safePos = {
            x: Number.isFinite(Number(pos?.x)) ? Number(pos.x) : 0,
            y: Number.isFinite(Number(pos?.y)) ? Number(pos.y) : 0,
            scale: Math.max(0.1, Number.isFinite(Number(pos?.scale)) ? Number(pos.scale) : 1),
            rotation: Number.isFinite(Number(pos?.rotation)) ? Number(pos.rotation) : 0
        };

        ctx.translate(targetW / 2, targetH / 2);
        ctx.translate(safePos.x * ratio, safePos.y * ratio);
        ctx.rotate((safePos.rotation * Math.PI) / 180);
        ctx.scale(safePos.scale, safePos.scale);

        // imgを描画。object-fit:cover の挙動を再現する必要がある。
        // imgのアスペクト比と枠のアスペクト比を比較
        const imgAspect = img.width / img.height;
        const frameAspect = baseW / baseH;

        let drawW, drawH;
        if (imgAspect > frameAspect) {
            // 画像が横長 -> 縦を合わせる
            drawH = targetH;
            drawW = targetH * imgAspect;
        } else {
            // 画像が縦長 -> 横を合わせる
            drawW = targetW;
            drawH = targetW / imgAspect;
        }

        // 中心に描画
        ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);

        ctx.restore();

        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.8));

        // アップロード
        const thumbRef = ref(storage, thumbPath);
        const snap = await uploadBytes(thumbRef, blob);
        const thumbUrl = await getDownloadURL(snap.ref);

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

    const originalText = document.getElementById('text-label').innerText;
    document.getElementById('text-label').innerText = "処理中...";

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
            document.getElementById('text-label').innerText = "ローカル保存中...";

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
            const newSections = [...state.sections];
            newSections[state.activeIdx].background = mainUrl;
            newSections[state.activeIdx].thumbnail = thumbUrl;
            newSections[state.activeIdx].imagePosition = { x: 0, y: 0, scale: 1, rotation: 0 };
            newSections[state.activeIdx].imageBasePosition = { x: 0, y: 0, scale: 1, rotation: 0 };
            dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: newSections } });

            refresh();
            triggerAutoSave();

            document.getElementById('text-label').innerText = "完了！";
            setTimeout(() => { document.getElementById('text-label').innerText = originalText; }, 2000);
            return;
        }

        // --- ログイン時の Firebase Storage 保存処理 ---
        const uid = state.uid;
        const mainPath = `users/${uid}/dsf/${timestamp}_${filename}.webp`;
        const thumbPath = `users/${uid}/dsf/thumbs/${timestamp}_${filename}_thumb.webp`;

        document.getElementById('text-label').innerText = "アップロード中...";

        // 2. アップロード
        const mainRef = ref(storage, mainPath);
        const thumbRef = ref(storage, thumbPath);

        const [mainSnap, thumbSnap] = await Promise.all([
            uploadBytes(mainRef, mainBlob),
            uploadBytes(thumbRef, thumbBlob)
        ]);

        // 3. URL取得
        const [mainUrl, thumbUrl] = await Promise.all([
            getDownloadURL(mainSnap.ref),
            getDownloadURL(thumbSnap.ref)
        ]);

        // 4. ステート更新
        const newSections = [...state.sections];
        newSections[state.activeIdx].background = mainUrl;
        newSections[state.activeIdx].thumbnail = thumbUrl; // サムネイル保存
        newSections[state.activeIdx].imagePosition = { x: 0, y: 0, scale: 1, rotation: 0 };
        newSections[state.activeIdx].imageBasePosition = { x: 0, y: 0, scale: 1, rotation: 0 };
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: newSections } });

        refresh();
        triggerAutoSave();

        document.getElementById('text-label').innerText = "完了！";
        setTimeout(() => {
            document.getElementById('text-label').innerText = originalText;
        }, 2000);
    } catch (e) {
        console.error(e);
        alert("保存失敗: " + e.message);
        document.getElementById('text-label').innerText = originalText;
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
        dispatch({ type: actionTypes.SET_TITLE, payload: data.title || '' });
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'pages', value: data.pages || [] } });
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: data.blocks || [] } });
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: data.sections } });
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

        const mainRef = ref(storage, mainPath);
        const thumbRef = ref(storage, thumbPath);
        const [mainSnap, thumbSnap] = await Promise.all([
            uploadBytes(mainRef, mainBlob),
            uploadBytes(thumbRef, thumbBlob)
        ]);
        const [mainUrl, thumbUrl] = await Promise.all([
            getDownloadURL(mainSnap.ref),
            getDownloadURL(thumbSnap.ref)
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

        const mainRef = ref(storage, mainPath);
        const thumbRef = ref(storage, thumbPath);
        const [mainSnap, thumbSnap] = await Promise.all([
            uploadBytes(mainRef, mainBlob),
            uploadBytes(thumbRef, thumbBlob)
        ]);
        const [mainUrl, thumbUrl] = await Promise.all([
            getDownloadURL(mainSnap.ref),
            getDownloadURL(thumbSnap.ref)
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
