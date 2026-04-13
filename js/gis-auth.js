/**
 * gis-auth.js — Google Identity Services + Firebase Auth 連携
 *
 * signInWithPopup/signInWithRedirect を GIS (One Tap + ボタン) に置き換え。
 * Firebase Auth はセッション管理として維持。
 */
import { GoogleAuthProvider, signInWithCredential, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { auth } from './firebase-core.js';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

let _gisReady = false;
let _gisReadyPromise = null;

// ── GIS ライブラリ読み込み ──────────────────────────────────────

function _loadGisScript() {
    if (_gisReadyPromise) return _gisReadyPromise;
    _gisReadyPromise = new Promise((resolve) => {
        if (window.google?.accounts?.id) { _gisReady = true; resolve(); return; }
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.defer = true;
        s.onload = () => { _gisReady = true; resolve(); };
        s.onerror = () => { console.error('[GIS] script load failed'); resolve(); };
        document.head.appendChild(s);
    });
    return _gisReadyPromise;
}

// ── GIS コールバック → Firebase Auth ────────────────────────────

async function _handleCredentialResponse(response, authInstance = auth) {
    if (!response?.credential) return;
    const firebaseCredential = GoogleAuthProvider.credential(response.credential);
    try {
        await signInWithCredential(authInstance, firebaseCredential);
    } catch (err) {
        console.error('[GIS] signInWithCredential error:', err);
    }
}

// ── 初期化 ─────────────────────────────────────────────────────

let _initialized = false;
let _initializedAuth = null;

function _normalizeInitOptions(arg) {
    if (typeof arg === 'string') return { buttonContainerId: arg };
    return arg || {};
}

function _canAttemptGisPrompt() {
    return !!(_gisReady && window.google?.accounts?.id) &&
        location.hostname !== 'localhost' &&
        location.hostname !== '127.0.0.1';
}

/**
 * GIS を初期化する。
 * @param {string} [buttonContainerId] - Google ボタンを描画するDOM要素のID（省略時はOne Tapのみ）
 */
export async function initGIS(arg) {
    const options = _normalizeInitOptions(arg);
    const buttonContainerId = options.buttonContainerId;
    const authInstance = options.authInstance || auth;
    const autoPrompt = options.autoPrompt !== false;
    await _loadGisScript();
    if (!_gisReady || !window.google?.accounts?.id) {
        console.warn('[GIS] library not available');
        return false;
    }

    if (!_initialized || _initializedAuth !== authInstance) {
        const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
        google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: (response) => _handleCredentialResponse(response, authInstance),
            auto_select: true,
            cancel_on_tap_outside: false,
            itp_support: true,
            use_fedcm_for_prompt: !isLocalhost,
        });
        _initialized = true;
        _initializedAuth = authInstance;
    }

    // One Tap プロンプト表示（localhost では FedCM エラーになるためスキップ）
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (autoPrompt && !isLocal) {
        google.accounts.id.prompt();
    }

    // ボタン描画
    if (buttonContainerId) {
        const el = document.getElementById(buttonContainerId);
        if (el) {
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
async function _signInWithFirebase(authInstance = auth) {
    const provider = new GoogleAuthProvider();
    if (_isMobile()) {
        await signInWithRedirect(authInstance, provider);
    } else {
        try {
            await signInWithPopup(authInstance, provider);
        } catch (err) {
            if (err.code === 'auth/popup-blocked' || err.code === 'auth/popup-closed-by-user') {
                await signInWithRedirect(authInstance, provider);
            } else {
                throw err;
            }
        }
    }
}

// ── 公開 API ───────────────────────────────────────────────────

/**
 * Google ログインを促す（ボタンクリック用）。
 * まず GIS prompt を試し、利用できない時だけ Firebase popup/redirect へフォールバックする。
 */
export async function signInWithGoogle(arg) {
    const options = _normalizeInitOptions(arg);
    const authInstance = options.authInstance || auth;

    await initGIS({ authInstance, autoPrompt: false });

    if (_canAttemptGisPrompt()) {
        const promptResult = await new Promise((resolve) => {
            let settled = false;
            const done = (value) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };

            try {
                google.accounts.id.prompt((notification) => {
                    if (notification?.isNotDisplayed?.() || notification?.isSkippedMoment?.()) {
                        done('fallback');
                        return;
                    }
                    done('prompted');
                });
                setTimeout(() => done('prompted'), 800);
            } catch (err) {
                console.warn('[GIS] prompt failed, falling back:', err);
                done('fallback');
            }
        });

        if (promptResult !== 'fallback') return;
    }

    await _signInWithFirebase(authInstance);
}

/**
 * signInWithRedirect 後のリダイレクト結果を処理する。
 * アプリ起動時に呼ぶ。
 */
export async function handleRedirectResult(authInstance = auth) {
    try {
        await getRedirectResult(authInstance);
    } catch (err) {
        if (err.code !== 'auth/null-provider-id') {
            console.error('[GIS] handleRedirectResult error:', err);
        }
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
    if (window.google?.accounts?.id) {
        google.accounts.id.disableAutoSelect();
    }
    await signOut(authInstance);
}

export function onAuthChanged(callback) {
    return onAuthStateChanged(auth, callback);
}
