/**
 * gis-auth.js — Google Identity Services + Firebase Auth 連携
 *
 * signInWithPopup/signInWithRedirect を GIS (One Tap + ボタン) に置き換え。
 * Firebase Auth はセッション管理として維持。
 */
import { GoogleAuthProvider, signInWithCredential, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { auth, authReady } from './firebase-core.js';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

function getGoogleOAuthClientId() {
    const raw = typeof GOOGLE_CLIENT_ID === 'string' ? GOOGLE_CLIENT_ID : '';
    return raw.trim();
}

/** iOS / iPadOS（実機・PWA） */
function _isIOSLike() {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua)) return true;
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

/**
 * One Tap 自動表示を抑止する環境（実機モバイル / 狭いビューポート）。
 * DevTools の iPhone エミュは pointer が fine のままなので、幅ベースも見る。
 */
export function isMobileGisEnvironment() {
    if (typeof window === 'undefined') return false;
    if (_isIOSLike()) return true;
    try {
        if (window.matchMedia('(max-width: 1024px)').matches) return true;
    } catch (_) { /* noop */ }
    return window.innerWidth <= 1024;
}

let _gisReady = false;
let _gisReadyPromise = null;

// ── GIS ライブラリ読み込み ──────────────────────────────────────

function _loadGisScript() {
    if (_gisReadyPromise) return _gisReadyPromise;
    _gisReadyPromise = new Promise((resolve) => {
        const finish = () => {
            _gisReady = !!window.google?.accounts?.id;
            resolve();
        };
        if (window.google?.accounts?.id) {
            _gisReady = true;
            resolve();
            return;
        }
        const existing = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
        if (existing) {
            if (window.google?.accounts?.id) {
                finish();
                return;
            }
            existing.addEventListener('load', finish, { once: true });
            existing.addEventListener('error', () => {
                console.error('[GIS] script load failed');
                resolve();
            }, { once: true });
            return;
        }
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.defer = true;
        s.onload = finish;
        s.onerror = () => {
            console.error('[GIS] script load failed');
            resolve();
        };
        document.head.appendChild(s);
    });
    return _gisReadyPromise;
}

// ── GIS コールバック → Firebase Auth ────────────────────────────

async function _handleCredentialResponse(response, authInstance = auth) {
    if (!response?.credential) return;
    await authReady;
    const firebaseCredential = GoogleAuthProvider.credential(response.credential);
    try {
        const result = await signInWithCredential(authInstance, firebaseCredential);
        window.dispatchEvent(new CustomEvent('dsf-auth-signed-in', {
            detail: { user: result?.user || authInstance.currentUser || null }
        }));
        return result;
    } catch (err) {
        console.error('[GIS] signInWithCredential error:', err);
        window.dispatchEvent(new CustomEvent('dsf-auth-error', { detail: { error: err } }));
    }
}

// ── 初期化 ─────────────────────────────────────────────────────

let _initialized = false;
let _initializedAuth = null;

function _normalizeInitOptions(arg) {
    if (typeof arg === 'string') return { buttonContainerId: arg };
    return arg || {};
}

/**
 * GIS を初期化する。
 * @param {string} [buttonContainerId] - Google ボタンを描画するDOM要素のID（省略時はOne Tapのみ）
 */
export async function initGIS(arg) {
    const options = _normalizeInitOptions(arg);
    const buttonContainerId = options.buttonContainerId;
    const authInstance = options.authInstance || auth;
    await authReady;
    const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    /** FedCM 無効時に GSI が NetworkError になる事例があるため非 FedCM 経路に固定 */
    const wantOneTap = options.autoPrompt !== false && !isMobileGisEnvironment();
    await _loadGisScript();
    if (!_gisReady || !window.google?.accounts?.id) {
        console.warn('[GIS] library not available');
        return false;
    }

    const clientId = getGoogleOAuthClientId();
    if (!clientId) {
        console.warn('[GIS] VITE_GOOGLE_CLIENT_ID is missing; Google Sign-In disabled.');
        return false;
    }

    if (!_initialized || _initializedAuth !== authInstance) {
        try {
            google.accounts.id.initialize({
                client_id: clientId,
                callback: (response) => _handleCredentialResponse(response, authInstance),
                auto_select: false,
                cancel_on_tap_outside: false,
                itp_support: true,
                use_fedcm_for_prompt: false,
            });
            _initialized = true;
            _initializedAuth = authInstance;
        } catch (err) {
            console.warn('[GIS] initialize failed:', err);
            return false;
        }
    }

    // One Tap 自動プロンプト（localhost / モバイルではスキップ）
    if (wantOneTap && !isLocalhost) {
        try {
            google.accounts.id.prompt();
        } catch (err) {
            console.warn('[GIS] prompt failed:', err);
        }
    }

    // ボタン描画
    if (buttonContainerId) {
        const el = document.getElementById(buttonContainerId);
        if (el) {
            try {
                el.innerHTML = '';
                google.accounts.id.renderButton(el, {
                    theme: 'outline',
                    size: 'large',
                    type: 'standard',
                    shape: 'rectangular',
                    text: 'signin_with',
                    logo_alignment: 'left',
                    ...options.buttonOptions
                });
            } catch (err) {
                console.warn('[GIS] renderButton failed:', err);
                return false;
            }
            return true;
        }
    }
    return true;
}

// ── Firebase popup/redirect フォールバック ──────────────────────

function _isMobile() {
    return window.innerWidth <= 768 || ('ontouchstart' in window && window.innerWidth <= 1024);
}

/**
 * Firebase Auth の popup または redirect でサインイン（GIS フォールバック用）。
 */
async function _signInWithFirebase(authInstance = auth, options = {}) {
    await authReady;
    const provider = new GoogleAuthProvider();
    if (options.redirect || _isMobile()) {
        await signInWithRedirect(authInstance, provider);
        return null;
    } else {
        try {
            const result = await signInWithPopup(authInstance, provider);
            window.dispatchEvent(new CustomEvent('dsf-auth-signed-in', {
                detail: { user: result?.user || authInstance.currentUser || null }
            }));
            return result;
        } catch (err) {
            if (err.code === 'auth/popup-blocked') {
                await signInWithRedirect(authInstance, provider);
                return null;
            } else {
                throw err;
            }
        }
    }
}

// ── 公開 API ───────────────────────────────────────────────────

/**
 * Google ログインを促す（ボタンクリック用）。
 * 明示クリックでは One Tap prompt を使わず、Firebase popup/redirect に直行する。
 * GIS prompt は「自動表示」用で、クリック操作の完了判定に使うと未ログインのまま戻る経路ができる。
 */
export async function signInWithGoogle(arg) {
    const options = _normalizeInitOptions(arg);
    const authInstance = options.authInstance || auth;

    return _signInWithFirebase(authInstance, {
        redirect: !!(options.redirect || options.forceRedirect),
    });
}

/**
 * signInWithRedirect 後のリダイレクト結果を処理する。
 * アプリ起動時に呼ぶ。
 */
export async function handleRedirectResult(authInstance = auth, options = {}) {
    await authReady;
    try {
        const result = await getRedirectResult(authInstance);
        return { result, error: null };
    } catch (err) {
        if (err.code === 'auth/null-provider-id') {
            return { result: null, error: null };
        }
        console.error('[GIS] handleRedirectResult error:', err);
        if (options.throwOnError) throw err;
        return { result: null, error: err };
    }
}

export async function renderGISButton(buttonContainerId, options = {}) {
    return initGIS({
        ...options,
        buttonContainerId,
        autoPrompt: options.autoPrompt ?? false,
    });
}

export async function signOutUser(authInstance = auth) {
    await authReady;
    if (window.google?.accounts?.id) {
        google.accounts.id.disableAutoSelect();
    }
    await signOut(authInstance);
}

export function onAuthChanged(callback, authInstance = auth) {
    return onAuthStateChanged(authInstance, callback);
}
