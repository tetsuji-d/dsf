/**
 * gis-auth.js — Google Identity Services + Firebase Auth 連携
 *
 * signInWithPopup/signInWithRedirect を GIS (One Tap + ボタン) に置き換え。
 * Firebase Auth はセッション管理として維持。
 */
import { GoogleAuthProvider, signInWithCredential, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { auth } from './firebase.js';

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

function _handleCredentialResponse(response) {
    if (!response?.credential) return;
    const firebaseCredential = GoogleAuthProvider.credential(response.credential);
    signInWithCredential(auth, firebaseCredential)
        .catch((err) => console.error('[GIS] signInWithCredential error:', err));
}

// ── 初期化 ─────────────────────────────────────────────────────

let _initialized = false;

/**
 * GIS を初期化する。
 * @param {string} [buttonContainerId] - Google ボタンを描画するDOM要素のID（省略時はOne Tapのみ）
 */
export async function initGIS(buttonContainerId) {
    await _loadGisScript();
    if (!_gisReady || !window.google?.accounts?.id) {
        console.warn('[GIS] library not available');
        return;
    }

    if (!_initialized) {
        google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: _handleCredentialResponse,
            auto_select: true,
            cancel_on_tap_outside: false,
            itp_support: true,
        });
        _initialized = true;
    }

    // One Tap プロンプト表示
    google.accounts.id.prompt();

    // ボタン描画
    if (buttonContainerId) {
        const el = document.getElementById(buttonContainerId);
        if (el) {
            google.accounts.id.renderButton(el, {
                theme: 'outline',
                size: 'large',
                type: 'standard',
                shape: 'rectangular',
                text: 'signin_with',
                logo_alignment: 'left',
            });
        }
    }
}

// ── 公開 API ───────────────────────────────────────────────────

/**
 * Google ログインを促す（One Tap プロンプトを表示）。
 * ボタンクリック以外のプログラム的トリガー用。
 */
export async function signInWithGoogle() {
    await _loadGisScript();
    if (_gisReady && window.google?.accounts?.id) {
        if (!_initialized) {
            google.accounts.id.initialize({
                client_id: GOOGLE_CLIENT_ID,
                callback: _handleCredentialResponse,
                auto_select: false,
                cancel_on_tap_outside: false,
                itp_support: true,
            });
            _initialized = true;
        }
        google.accounts.id.prompt();
    }
}

export async function signOutUser() {
    if (window.google?.accounts?.id) {
        google.accounts.id.disableAutoSelect();
    }
    await signOut(auth);
}

export function onAuthChanged(callback) {
    return onAuthStateChanged(auth, callback);
}
