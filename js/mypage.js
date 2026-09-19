import { preparePrivateProjectAction, runPrivateProjectAction } from './private-project-actions.js';
import { addDoc, collection, doc, getDocs, limit, orderBy, query, runTransaction, serverTimestamp, setDoc, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { auth, db } from './firebase-core.js';
import { ensureUserBootstrap } from './firebase.js';
import { handleRedirectResult, initGIS, renderGISButton, signInWithGoogle, signOutUser } from './gis-auth.js';
import { applyTheme, bindThemePreferenceListener } from './theme.js';
import { getEffectivePlanTier, normalizePlanTier, planAllowsPublicScheduling, planAllowsUnlimitedListing } from './publication.js';

const LANG_STORAGE_KEY = 'dsf_portal_lang';
const SUPPORTED_LANGS = ['ja', 'en'];

const STRINGS = {
    ja: {
        documentTitle: 'マイページ | DSF Horizon',
        studioLink: 'Studio',
        heroTitle: 'マイページ',
        heroDesc: 'アカウント状態、現在のプラン、プラン変更リクエストを管理します。',
        signIn: 'サインイン',
        signOut: 'サインアウト',
        signInFailed: 'サインインに失敗しました',
        signOutFailed: 'サインアウトに失敗しました',
        authRequiredTitle: 'サインインが必要です',
        authRequiredDesc: 'プランとアカウント状態を確認するには Google でサインインしてください。',
        signInWithGoogle: 'Googleでサインイン',
        account: 'アカウント',
        currentPlan: '現在のプラン',
        planChange: 'プラン変更',
        requestHistory: 'リクエスト履歴',
        publicProfile: '公開プロフィール',
        publicProfileDesc: 'Horizonやレビューで表示されるDSF用の公開名です。Googleアカウント名やメールアドレスとは分けて管理します。',
        publicName: '公開名',
        publicNamePlaceholder: '例: 山田哲史',
        publicHandle: 'ハンドル',
        publicHandlePlaceholder: '@name_123',
        publicHandleHelp: '4〜20文字の半角英小文字・数字・_。初回設定後は変更できません。',
        publicHandleLocked: '設定済みのハンドルは変更できません。',
        publicBio: '紹介文',
        publicBioPlaceholder: '作品や活動について短く紹介してください。',
        avatarImage: 'プロフィール画像',
        backgroundImage: '背景画像',
        editAvatarImage: 'プロフィール画像を変更',
        editBackgroundImage: '背景画像を変更',
        imageEditTitleAvatar: 'プロフィール画像を調整',
        imageEditTitleBackground: '背景画像を調整',
        chooseImage: '画像を選択',
        avatarZoom: 'アイコン切り抜き',
        backgroundZoom: '背景切り抜き',
        imageDragHelp: '画像をドラッグして切り抜き位置を調整できます。',
        applyImageCrop: 'この画像を使う',
        cancel: 'キャンセル',
        savePublicProfile: '公開プロフィールを保存',
        publicProfileSaved: '公開プロフィールを保存しました',
        publicProfileSaveFailed: '公開プロフィールの保存に失敗しました',
        publicProfileNameRequired: '公開名を入力してください。',
        publicProfileHandleInvalid: 'ハンドルは4〜20文字の半角英小文字・数字・_で入力してください。',
        publicProfileHandleTaken: 'このハンドルはすでに使用されています。',
        publicProfileHandleLockedError: '設定済みのハンドルは変更できません。',
        publicProfileImageInvalid: '画像ファイルを選択してください。',
        labelName: '名前',
        labelEmail: 'メール',
        labelStatus: '状態',
        labelModeration: 'モデレーション',
        labelTier: 'プラン種別',
        labelPlanStatus: 'プラン状態',
        currentPlanBadge: '現在のプラン',
        planBadge: 'プラン',
        currentPlanButton: '現在のプラン',
        requestPlanChange: (planName) => `${planName}へ変更をリクエスト`,
        requestCancel: '解約をリクエスト',
        planRequestSavedTitle: 'リクエストを保存しました',
        planRequestSavedDesc: '運営または決済連携後にプランへ反映されます。',
        billingNote: '決済連携前のため、ここでの操作はプラン変更リクエストとして保存されます。運営または決済システムの処理後に実際のプランへ反映されます。',
        downgradeNote: '解約・ダウングレード後は作品の掲載可能期間が再評価され、FREEでは発行から14日を超えた公開/限定公開作品は下書き扱いになります。',
        noRequests: 'まだリクエストはありません。',
        statusActive: '有効',
        statusDisabled: '停止中',
        planStatusActive: '有効',
        planStatusTrialing: 'トライアル中',
        planStatusCanceled: '解約済み',
        planStatusPastDue: '支払い確認中',
        moderationNormal: '通常',
        moderationHold: '保留中',
        listingLimit: '掲載可能期間',
        listingUnlimited: '無期限',
        listingFreeLimit: '発行から14日',
        publicScheduling: '公開期限予約',
        available: '利用可',
        unavailable: '利用不可',
        planFeatureFreeListing: '掲載可能期間: 発行から14日',
        planFeatureUnlimitedListing: '掲載可能期間: 無期限',
        planFeatureNoScheduling: '公開期限予約: なし',
        planFeatureScheduling: '公開期限予約: あり',
        planFeatureTeam: 'チーム運用向け',
        authError: '認証エラー',
        accountLoadFailed: 'アカウントを読み込めませんでした',
        initFailed: '初期化に失敗しました',
        requestActionChange: '変更',
        requestActionCancel: '解約',
        requestStatusRequested: 'リクエスト済み',
    },
    en: {
        documentTitle: 'My Page | DSF Horizon',
        studioLink: 'Studio',
        heroTitle: 'My Page',
        heroDesc: 'Manage your account status, current plan, and plan change requests.',
        signIn: 'Sign in',
        signOut: 'Sign out',
        signInFailed: 'Sign-in failed',
        signOutFailed: 'Sign-out failed',
        authRequiredTitle: 'Sign in required',
        authRequiredDesc: 'Sign in with Google to view your plan and account status.',
        signInWithGoogle: 'Sign in with Google',
        account: 'Account',
        currentPlan: 'Current Plan',
        planChange: 'Plan Change',
        requestHistory: 'Request History',
        publicProfile: 'Public Profile',
        publicProfileDesc: 'This DSF public identity appears on Horizon and reviews. It is separate from your Google name and email address.',
        publicName: 'Public name',
        publicNamePlaceholder: 'Example: Tetsushi Yamada',
        publicHandle: 'Handle',
        publicHandlePlaceholder: '@name_123',
        publicHandleHelp: '4-20 lowercase letters, numbers, or underscores. It cannot be changed after first setup.',
        publicHandleLocked: 'Your handle is locked after setup.',
        publicBio: 'Bio',
        publicBioPlaceholder: 'Briefly introduce your work or activity.',
        avatarImage: 'Profile image',
        backgroundImage: 'Background image',
        editAvatarImage: 'Change profile image',
        editBackgroundImage: 'Change background image',
        imageEditTitleAvatar: 'Adjust profile image',
        imageEditTitleBackground: 'Adjust background image',
        chooseImage: 'Choose image',
        avatarZoom: 'Avatar crop',
        backgroundZoom: 'Background crop',
        imageDragHelp: 'Drag the image to adjust the crop position.',
        applyImageCrop: 'Use this image',
        cancel: 'Cancel',
        savePublicProfile: 'Save public profile',
        publicProfileSaved: 'Public profile saved',
        publicProfileSaveFailed: 'Could not save public profile',
        publicProfileNameRequired: 'Enter a public name.',
        publicProfileHandleInvalid: 'Use 4-20 lowercase letters, numbers, or underscores for the handle.',
        publicProfileHandleTaken: 'This handle is already taken.',
        publicProfileHandleLockedError: 'Your handle cannot be changed after setup.',
        publicProfileImageInvalid: 'Choose an image file.',
        labelName: 'Name',
        labelEmail: 'Email',
        labelStatus: 'Status',
        labelModeration: 'Moderation',
        labelTier: 'Tier',
        labelPlanStatus: 'Status',
        currentPlanBadge: 'Current Plan',
        planBadge: 'Plan',
        currentPlanButton: 'Current plan',
        requestPlanChange: (planName) => `Request change to ${planName}`,
        requestCancel: 'Request cancellation',
        planRequestSavedTitle: 'Request saved',
        planRequestSavedDesc: 'The plan will be updated after operations or billing processing.',
        billingNote: 'Billing integration is not connected yet, so actions here are saved as plan change requests. The actual plan is updated after operations or billing processing.',
        downgradeNote: 'After cancellation or downgrade, listing limits are re-evaluated. On FREE, public or unlisted works older than 14 days from publication are treated as drafts.',
        noRequests: 'No requests yet.',
        statusActive: 'Active',
        statusDisabled: 'Disabled',
        planStatusActive: 'Active',
        planStatusTrialing: 'Trialing',
        planStatusCanceled: 'Canceled',
        planStatusPastDue: 'Past due',
        moderationNormal: 'Normal',
        moderationHold: 'On hold',
        listingLimit: 'Listing limit',
        listingUnlimited: 'Unlimited',
        listingFreeLimit: '14 days from publication',
        publicScheduling: 'Public expiry scheduling',
        available: 'Available',
        unavailable: 'Unavailable',
        planFeatureFreeListing: 'Listing limit: 14 days from publication',
        planFeatureUnlimitedListing: 'Listing limit: unlimited',
        planFeatureNoScheduling: 'Public expiry scheduling: none',
        planFeatureScheduling: 'Public expiry scheduling: available',
        planFeatureTeam: 'For team operations',
        authError: 'Authentication error',
        accountLoadFailed: 'Could not load account',
        initFailed: 'Initialization failed',
        requestActionChange: 'Change',
        requestActionCancel: 'Cancel',
        requestStatusRequested: 'Requested',
    },
};

let currentLang = (() => {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (saved && SUPPORTED_LANGS.includes(saved)) return saved;
    const browser = navigator.language?.slice(0, 2).toLowerCase();
    return SUPPORTED_LANGS.includes(browser) ? browser : 'ja';
})();

let currentUser = null;
let currentAccount = null;
let currentRequests = [];
let activeProfileImageKind = 'avatar';
let profileImageModalSnapshot = null;
let profileImageDrag = null;
const HANDLE_RE = /^[a-z0-9_]{4,20}$/;
const RESERVED_HANDLES = new Set(['admin', 'administrator', 'support', 'help', 'dsf', 'horizon', 'studio', 'viewer', 'works', 'press']);
const profileImageDraft = {
    avatar: createImageDraft('avatar', 320, 320),
    background: createImageDraft('background', 1440, 480)
};

function createImageDraft(kind, width, height) {
    return {
        kind,
        width,
        height,
        file: null,
        image: null,
        objectUrl: '',
        zoom: 1,
        offsetX: 0,
        offsetY: 0
    };
}

function t(key, ...args) {
    const value = STRINGS[currentLang]?.[key] ?? STRINGS.ja[key] ?? key;
    return typeof value === 'function' ? value(...args) : value;
}

function planCards() {
    return [
        { tier: 'free', name: 'FREE', features: [t('planFeatureFreeListing'), t('planFeatureNoScheduling')] },
        { tier: 'plus', name: 'PLUS', features: [t('planFeatureUnlimitedListing'), t('planFeatureNoScheduling')] },
        { tier: 'pro', name: 'PRO', features: [t('planFeatureUnlimitedListing'), t('planFeatureScheduling')] },
        { tier: 'business', name: 'BUSINESS', features: [t('planFeatureUnlimitedListing'), t('planFeatureScheduling'), t('planFeatureTeam')] }
    ];
}

function applyI18n() {
    document.documentElement.lang = currentLang;
    document.title = t('documentTitle');
    document.querySelectorAll('[data-i18n]').forEach((el) => {
        el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('.js-lang-switcher .lang-btn').forEach((button) => {
        button.classList.toggle('active', button.dataset.lang === currentLang);
    });
}

function renderCurrentView() {
    applyI18n();
    renderAuthSlot(currentUser);
    if (!currentUser) {
        renderSignedOut();
    } else if (currentAccount) {
        renderAccount();
    }
}

function bindLangSwitcher() {
    document.querySelectorAll('.js-lang-switcher .lang-btn').forEach((button) => {
        button.addEventListener('click', () => {
            const lang = button.dataset.lang;
            if (!SUPPORTED_LANGS.includes(lang) || lang === currentLang) return;
            currentLang = lang;
            localStorage.setItem(LANG_STORAGE_KEY, lang);
            renderCurrentView();
        });
    });
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function normalizeHandle(value) {
    return String(value || '').trim().replace(/^@+/, '').toLowerCase();
}

function isGoogleAccountAvatarUrl(url) {
    const value = String(url || '');
    return !!value && (value === currentUser?.photoURL || value === currentAccount?.photoURL);
}

function getPublicProfileAvatarUrl() {
    const url = currentAccount?.publicProfile?.avatarUrl;
    if (typeof url !== 'string' || isGoogleAccountAvatarUrl(url)) return '';
    return url;
}

function getPublicProfile() {
    return {
        displayName: currentAccount?.publicProfile?.displayName || currentUser?.displayName || '',
        handle: currentAccount?.publicProfile?.handle || currentAccount?.handle || null,
        bio: currentAccount?.publicProfile?.bio || '',
        avatarUrl: getPublicProfileAvatarUrl(),
        backgroundUrl: currentAccount?.publicProfile?.backgroundUrl || ''
    };
}

function resetProfileDrafts() {
    Object.values(profileImageDraft).forEach((draft) => {
        if (draft.objectUrl) URL.revokeObjectURL(draft.objectUrl);
        draft.file = null;
        draft.image = null;
        draft.objectUrl = '';
        draft.zoom = 1;
        draft.offsetX = 0;
        draft.offsetY = 0;
    });
}

function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function clampDraftOffset(draft, drawWidth, drawHeight) {
    const maxX = Math.max(0, (drawWidth - draft.width) / 2);
    const maxY = Math.max(0, (drawHeight - draft.height) / 2);
    draft.offsetX = clampNumber(Number(draft.offsetX) || 0, -maxX, maxX);
    draft.offsetY = clampNumber(Number(draft.offsetY) || 0, -maxY, maxY);
}

function drawImageToCanvas(draft, canvas) {
    canvas.width = draft.width;
    canvas.height = draft.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!draft.image) return false;
    const sourceWidth = draft.image.naturalWidth || draft.image.width;
    const sourceHeight = draft.image.naturalHeight || draft.image.height;
    const scale = Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight) * draft.zoom;
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    clampDraftOffset(draft, drawWidth, drawHeight);
    ctx.drawImage(
        draft.image,
        (canvas.width - drawWidth) / 2 + draft.offsetX,
        (canvas.height - drawHeight) / 2 + draft.offsetY,
        drawWidth,
        drawHeight
    );
    return true;
}

function setRenderedImageFromCanvas(rendered, canvas, quality = 0.84) {
    if (!rendered) return;
    rendered.src = canvas.toDataURL('image/webp', quality);
    rendered.hidden = false;
}

function drawProfilePreview(kind) {
    const draft = profileImageDraft[kind];
    const canvas = document.querySelector(`[data-profile-canvas="${kind}"]`);
    const rendered = document.querySelector(`[data-profile-rendered="${kind}"]`);
    if (!draft || !canvas) return;
    const profile = getPublicProfile();
    const fallbackUrl = kind === 'avatar' ? profile.avatarUrl : profile.backgroundUrl;
    const fallbackImg = document.querySelector(`[data-profile-fallback="${kind}"]`);

    if (!draft.image) {
        if (fallbackImg) fallbackImg.hidden = !fallbackUrl;
        if (rendered) rendered.hidden = true;
        canvas.hidden = true;
        return;
    }

    if (fallbackImg) fallbackImg.hidden = true;
    canvas.hidden = true;
    if (drawImageToCanvas(draft, canvas)) setRenderedImageFromCanvas(rendered, canvas);
}

function drawProfileModalPreview(kind) {
    const draft = profileImageDraft[kind];
    const canvas = document.querySelector('[data-profile-modal-canvas]');
    const rendered = document.querySelector('[data-profile-modal-rendered]');
    const empty = document.querySelector('[data-profile-modal-empty]');
    if (!draft || !canvas || !rendered) return;
    if (!draft.image) {
        rendered.hidden = true;
        if (empty) empty.hidden = false;
        return;
    }
    if (empty) empty.hidden = true;
    if (drawImageToCanvas(draft, canvas)) setRenderedImageFromCanvas(rendered, canvas);
}

function canvasToWebP(canvas, quality = 0.82) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) reject(new Error('WebP encode failed'));
            else resolve(blob);
        }, 'image/webp', quality);
    });
}

async function selectProfileImage(kind, file) {
    const draft = profileImageDraft[kind];
    if (!draft || !file?.type?.startsWith('image/')) throw new Error(t('publicProfileImageInvalid'));
    draft.file = file;
    draft.objectUrl = await readFileAsDataUrl(file);
    draft.zoom = 1;
    draft.offsetX = 0;
    draft.offsetY = 0;
    draft.image = await loadImageElement(draft.objectUrl);
    const range = document.querySelector(`[data-profile-zoom="${kind}"]`);
    if (range) range.value = '1';
    const modalRange = document.querySelector('[data-profile-modal-zoom]');
    if (modalRange) modalRange.value = '1';
    drawProfileModalPreview(kind);
    drawProfilePreview(kind);
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error(t('publicProfileImageInvalid')));
        reader.readAsDataURL(file);
    });
}

async function loadImageElement(src) {
    const image = new Image();
    image.decoding = 'async';
    image.src = src;
    if (typeof image.decode === 'function') {
        await image.decode().catch(() => null);
        if (image.naturalWidth) return image;
    }
    return new Promise((resolve, reject) => {
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(t('publicProfileImageInvalid')));
    });
}

async function uploadProfileImage(kind) {
    const draft = profileImageDraft[kind];
    if (!draft?.image || !currentUser) return null;
    const canvas = document.createElement('canvas');
    drawImageToCanvas(draft, canvas);
    const blob = await canvasToWebP(canvas, kind === 'avatar' ? 0.84 : 0.8);
    const path = `users/${currentUser.uid}/profile/${kind}_${Date.now()}.webp`;
    const body = new FormData();
    body.append('file', blob, `${kind}.webp`);
    body.append('path', path);
    const token = await currentUser.getIdToken(false);
    const res = await fetch('/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Upload failed: ${res.status}`);
    return json.url || null;
}

function formatDate(value) {
    const date = value?.toDate?.() || (value instanceof Date ? value : null);
    if (!date || Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString(currentLang === 'en' ? 'en-US' : 'ja-JP');
}

function formatRequestAction(action) {
    if (action === 'change') return t('requestActionChange');
    if (action === 'cancel') return t('requestActionCancel');
    return action || '';
}

function formatRequestStatus(status) {
    if (!status || status === 'requested') return t('requestStatusRequested');
    return status;
}

function formatPlanStatus(status) {
    if (!status || status === 'active') return t('planStatusActive');
    if (status === 'trialing') return t('planStatusTrialing');
    if (status === 'canceled' || status === 'cancelled') return t('planStatusCanceled');
    if (status === 'past_due') return t('planStatusPastDue');
    return status;
}

function setFeedback(type, title, description = '') {
    const el = document.getElementById('mypage-feedback');
    if (!el) return;
    el.className = `portal-feedback is-${type}`;
    el.innerHTML = `
        <div class="portal-feedback-box">
            <p class="portal-feedback-title">${escapeHtml(title)}</p>
            ${description ? `<p class="portal-feedback-desc">${escapeHtml(description)}</p>` : ''}
        </div>
    `;
}

function clearFeedback() {
    const el = document.getElementById('mypage-feedback');
    if (el) {
        el.className = 'portal-feedback';
        el.innerHTML = '';
    }
}

function renderAuthSlot(user) {
    const el = document.getElementById('mypage-auth');
    if (!el) return;
    if (!user) {
        el.innerHTML = `<div id="gis-btn-mypage"></div><button type="button" class="header-pill-btn" id="mypage-signin-fallback">${escapeHtml(t('signIn'))}</button>`;
        renderGISButton('gis-btn-mypage', { authInstance: auth, buttonOptions: { theme: 'outline', size: 'large' } })
            .catch((e) => console.warn('[MyPage] GIS render failed:', e));
        document.getElementById('mypage-signin-fallback')?.addEventListener('click', () => {
            signInWithGoogle({ authInstance: auth }).catch((e) => setFeedback('error', t('signInFailed'), e?.message || String(e)));
        });
        return;
    }
    el.innerHTML = `<button type="button" class="header-pill-btn" id="mypage-signout">${escapeHtml(t('signOut'))}</button>`;
    document.getElementById('mypage-signout')?.addEventListener('click', () => {
        signOutUser(auth).catch((e) => setFeedback('error', t('signOutFailed'), e?.message || String(e)));
    });
}

function renderSignedOut() {
    const el = document.getElementById('mypage-content');
    if (!el) return;
    el.innerHTML = `
        <section class="mypage-card mypage-auth-card">
            <h2>${escapeHtml(t('authRequiredTitle'))}</h2>
            <p class="mypage-note">${escapeHtml(t('authRequiredDesc'))}</p>
            <div id="gis-btn-mypage-main"></div>
            <button type="button" class="mypage-action-btn" id="mypage-main-signin">${escapeHtml(t('signInWithGoogle'))}</button>
        </section>
    `;
    renderGISButton('gis-btn-mypage-main', { authInstance: auth, buttonOptions: { theme: 'outline', size: 'large' } })
        .catch((e) => console.warn('[MyPage] main GIS render failed:', e));
    document.getElementById('mypage-main-signin')?.addEventListener('click', () => {
        signInWithGoogle({ authInstance: auth }).catch((e) => setFeedback('error', t('signInFailed'), e?.message || String(e)));
    });
}

function renderPublicProfileSection() {
    const profile = getPublicProfile();
    const handle = normalizeHandle(profile.handle);
    const handleLocked = !!handle;
    return `
        <section class="mypage-card mypage-profile-card">
            <div class="mypage-section-heading">
                <div>
                    <h2>${escapeHtml(t('publicProfile'))}</h2>
                    <p class="mypage-note">${escapeHtml(t('publicProfileDesc'))}</p>
                </div>
                <button type="button" class="mypage-action-btn" data-public-profile-save>${escapeHtml(t('savePublicProfile'))}</button>
            </div>
            <div class="mypage-profile-preview">
                <button type="button" class="mypage-profile-background" data-profile-edit="background" aria-label="${escapeHtml(t('editBackgroundImage'))}">
                    ${profile.backgroundUrl ? `<img src="${escapeHtml(profile.backgroundUrl)}" alt="" data-profile-fallback="background">` : `<div class="mypage-profile-placeholder" data-profile-fallback="background"></div>`}
                    <img class="mypage-profile-rendered" alt="" data-profile-rendered="background" hidden>
                    <canvas data-profile-canvas="background" hidden></canvas>
                    <span class="mypage-profile-edit-chip">${escapeHtml(t('editBackgroundImage'))}</span>
                </button>
                <button type="button" class="mypage-profile-avatar" data-profile-edit="avatar" aria-label="${escapeHtml(t('editAvatarImage'))}">
                    ${profile.avatarUrl ? `<img src="${escapeHtml(profile.avatarUrl)}" alt="" data-profile-fallback="avatar">` : `<div class="mypage-profile-avatar-placeholder" data-profile-fallback="avatar">${escapeHtml((profile.displayName || '?').slice(0, 1))}</div>`}
                    <img class="mypage-profile-rendered" alt="" data-profile-rendered="avatar" hidden>
                    <canvas data-profile-canvas="avatar" hidden></canvas>
                    <span class="mypage-profile-avatar-chip">${escapeHtml(t('editAvatarImage'))}</span>
                </button>
            </div>
            <div class="mypage-profile-form">
                <label class="mypage-field">
                    <span>${escapeHtml(t('publicName'))}</span>
                    <input type="text" data-public-profile-name maxlength="80" value="${escapeHtml(profile.displayName)}" placeholder="${escapeHtml(t('publicNamePlaceholder'))}">
                </label>
                <label class="mypage-field">
                    <span>${escapeHtml(t('publicHandle'))}</span>
                    <input type="text" data-public-profile-handle maxlength="21" value="${handle ? `@${escapeHtml(handle)}` : ''}" placeholder="${escapeHtml(t('publicHandlePlaceholder'))}" ${handleLocked ? 'disabled' : ''}>
                    <small>${escapeHtml(handleLocked ? t('publicHandleLocked') : t('publicHandleHelp'))}</small>
                </label>
                <label class="mypage-field mypage-field-wide">
                    <span>${escapeHtml(t('publicBio'))}</span>
                    <textarea data-public-profile-bio maxlength="280" rows="3" placeholder="${escapeHtml(t('publicBioPlaceholder'))}">${escapeHtml(profile.bio)}</textarea>
                </label>
            </div>
            ${renderProfileImageModal()}
        </section>
    `;
}

function renderProfileImageModal() {
    return `
        <div class="mypage-image-modal" data-profile-modal hidden>
            <div class="mypage-image-modal-panel" role="dialog" aria-modal="true" aria-labelledby="profile-image-modal-title">
                <div class="mypage-image-modal-head">
                    <h3 id="profile-image-modal-title" data-profile-modal-title>${escapeHtml(t('imageEditTitleAvatar'))}</h3>
                    <button type="button" class="mypage-modal-close" data-profile-modal-dismiss aria-label="${escapeHtml(t('cancel'))}">×</button>
                </div>
                <div class="mypage-image-modal-preview" data-profile-modal-preview>
                    <span data-profile-modal-empty>${escapeHtml(t('chooseImage'))}</span>
                    <img alt="" data-profile-modal-rendered hidden>
                    <canvas data-profile-modal-canvas hidden></canvas>
                </div>
                <p class="mypage-image-modal-help">${escapeHtml(t('imageDragHelp'))}</p>
                <div class="mypage-image-modal-controls">
                    <button type="button" class="mypage-file-btn" data-profile-modal-pick>${escapeHtml(t('chooseImage'))}</button>
                    <input class="mypage-file-input" type="file" accept="image/*" data-profile-modal-file>
                    <label class="mypage-range">
                        <span data-profile-modal-zoom-label>${escapeHtml(t('avatarZoom'))}</span>
                        <input type="range" min="1" max="2.5" step="0.05" value="1" data-profile-modal-zoom>
                    </label>
                </div>
                <div class="mypage-image-modal-actions">
                    <button type="button" class="mypage-file-btn" data-profile-modal-cancel>${escapeHtml(t('cancel'))}</button>
                    <button type="button" class="mypage-action-btn" data-profile-modal-apply>${escapeHtml(t('applyImageCrop'))}</button>
                </div>
            </div>
        </div>
    `;
}

function renderAccount() {
    const el = document.getElementById('mypage-content');
    if (!el || !currentUser || !currentAccount) return;
    const planTier = getEffectivePlanTier(currentAccount);
    const planStatus = currentAccount.plan?.status || 'active';
    const planAccount = { plan: currentAccount.plan || {} };
    const cards = planCards().map((plan) => {
        const current = plan.tier === planTier;
        return `
            <article class="mypage-plan-card ${current ? 'is-current' : ''}">
                <div>
                    <span>${escapeHtml(current ? t('currentPlanBadge') : t('planBadge'))}</span>
                    <strong>${escapeHtml(plan.name)}</strong>
                </div>
                <ul>${plan.features.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
                <button type="button" class="mypage-action-btn" data-plan-request="${escapeHtml(plan.tier)}" ${current ? 'disabled' : ''}>
                    ${current ? escapeHtml(t('currentPlanButton')) : escapeHtml(t('requestPlanChange', plan.name))}
                </button>
            </article>
        `;
    }).join('');

    el.innerHTML = `
        ${renderPublicProfileSection()}
        <section class="mypage-card">
            <h2>${escapeHtml(t('account'))}</h2>
            <div class="mypage-account-grid">
                <div class="mypage-info-tile"><span>${escapeHtml(t('labelName'))}</span><strong>${escapeHtml(currentUser.displayName || '—')}</strong></div>
                <div class="mypage-info-tile"><span>${escapeHtml(t('labelEmail'))}</span><strong>${escapeHtml(currentUser.email || '—')}</strong></div>
                <div class="mypage-info-tile"><span>${escapeHtml(t('labelStatus'))}</span><strong>${escapeHtml(currentAccount.status?.disabled ? t('statusDisabled') : t('statusActive'))}</strong></div>
                <div class="mypage-info-tile"><span>${escapeHtml(t('labelModeration'))}</span><strong>${escapeHtml(currentAccount.status?.moderationHold ? t('moderationHold') : t('moderationNormal'))}</strong></div>
            </div>
        </section>
        <section class="mypage-card">
            <h2>${escapeHtml(t('currentPlan'))}</h2>
            <div class="mypage-account-grid">
                <div class="mypage-info-tile"><span>${escapeHtml(t('labelTier'))}</span><strong>${escapeHtml(planTier.toUpperCase())}</strong></div>
                <div class="mypage-info-tile"><span>${escapeHtml(t('labelPlanStatus'))}</span><strong>${escapeHtml(formatPlanStatus(planStatus))}</strong></div>
                <div class="mypage-info-tile"><span>${escapeHtml(t('listingLimit'))}</span><strong>${escapeHtml(planAllowsUnlimitedListing(planAccount) ? t('listingUnlimited') : t('listingFreeLimit'))}</strong></div>
                <div class="mypage-info-tile"><span>${escapeHtml(t('publicScheduling'))}</span><strong>${escapeHtml(planAllowsPublicScheduling(planAccount) ? t('available') : t('unavailable'))}</strong></div>
            </div>
            <p class="mypage-note">${escapeHtml(t('billingNote'))}</p>
        </section>
        <section class="mypage-card">
            <h2>${escapeHtml(t('planChange'))}</h2>
            <div class="mypage-plan-grid">${cards}</div>
            <p class="mypage-note">${escapeHtml(t('downgradeNote'))}</p>
            <button type="button" class="mypage-action-btn" data-plan-cancel>${escapeHtml(t('requestCancel'))}</button>
        </section>
        <section class="mypage-card">
            <h2>${escapeHtml(t('requestHistory'))}</h2>
            <div class="mypage-request-grid">
                ${currentRequests.length ? currentRequests.map((request) => `
                    <div class="mypage-request-row">
                        <span>${escapeHtml(formatRequestStatus(request.status))}</span>
                        <strong>${escapeHtml(formatRequestAction(request.action))} / ${escapeHtml((request.requestedTier || '').toUpperCase())}</strong>
                        <p class="mypage-note">${escapeHtml(formatDate(request.createdAt))}</p>
                    </div>
                `).join('') : `<p class="mypage-note">${escapeHtml(t('noRequests'))}</p>`}
            </div>
        </section>
    `;

    bindPublicProfileEvents(el);
    el.querySelectorAll('[data-plan-request]').forEach((button) => {
        button.addEventListener('click', () => requestPlanChange(button.dataset.planRequest, 'change'));
    });
    el.querySelector('[data-plan-cancel]')?.addEventListener('click', () => requestPlanChange('free', 'cancel'));
}

function openProfileImageModal(kind) {
    const draft = profileImageDraft[kind];
    const modal = document.querySelector('[data-profile-modal]');
    if (!draft || !modal) return;
    activeProfileImageKind = kind;
    profileImageModalSnapshot = { ...draft };
    modal.hidden = false;
    modal.dataset.kind = kind;
    const title = modal.querySelector('[data-profile-modal-title]');
    const zoomLabel = modal.querySelector('[data-profile-modal-zoom-label]');
    const range = modal.querySelector('[data-profile-modal-zoom]');
    const preview = modal.querySelector('[data-profile-modal-preview]');
    if (title) title.textContent = kind === 'avatar' ? t('imageEditTitleAvatar') : t('imageEditTitleBackground');
    if (zoomLabel) zoomLabel.textContent = kind === 'avatar' ? t('avatarZoom') : t('backgroundZoom');
    if (range) range.value = String(draft.zoom || 1);
    if (preview) preview.classList.toggle('is-avatar', kind === 'avatar');
    drawProfileModalPreview(kind);
}

function closeProfileImageModal({ restore = false } = {}) {
    const modal = document.querySelector('[data-profile-modal]');
    if (restore && profileImageModalSnapshot) {
        profileImageDraft[activeProfileImageKind] = { ...profileImageModalSnapshot };
        drawProfilePreview(activeProfileImageKind);
    }
    profileImageModalSnapshot = null;
    if (modal) modal.hidden = true;
}

function updateProfileModalDrag(event) {
    if (!profileImageDrag) return;
    const draft = profileImageDraft[activeProfileImageKind];
    const preview = document.querySelector('[data-profile-modal-preview]');
    if (!draft || !preview) return;
    const rect = preview.getBoundingClientRect();
    const scaleX = draft.width / Math.max(1, rect.width);
    const scaleY = draft.height / Math.max(1, rect.height);
    draft.offsetX = profileImageDrag.startOffsetX + (event.clientX - profileImageDrag.startX) * scaleX;
    draft.offsetY = profileImageDrag.startOffsetY + (event.clientY - profileImageDrag.startY) * scaleY;
    drawProfileModalPreview(activeProfileImageKind);
    drawProfilePreview(activeProfileImageKind);
}

function endProfileModalDrag(event) {
    if (!profileImageDrag) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    profileImageDrag = null;
    event.currentTarget.classList.remove('is-dragging');
}

function bindPublicProfileEvents(root) {
    root.querySelectorAll('[data-profile-edit]').forEach((button) => {
        button.addEventListener('click', () => openProfileImageModal(button.dataset.profileEdit));
    });
    root.querySelectorAll('[data-profile-modal-cancel]').forEach((button) => {
        button.addEventListener('click', () => closeProfileImageModal({ restore: true }));
    });
    root.querySelectorAll('[data-profile-modal-dismiss]').forEach((button) => {
        button.addEventListener('click', () => closeProfileImageModal({ restore: false }));
    });
    root.querySelector('[data-profile-modal]')?.addEventListener('click', (event) => {
        if (event.target === event.currentTarget) closeProfileImageModal({ restore: false });
    });
    root.querySelector('[data-profile-modal-pick]')?.addEventListener('click', () => {
        const input = root.querySelector('[data-profile-modal-file]');
        if (!input) return;
        input.value = '';
        input.click();
    });
    root.querySelector('[data-profile-modal-file]')?.addEventListener('change', async (event) => {
        try {
            await selectProfileImage(activeProfileImageKind, event.currentTarget.files?.[0]);
        } catch (e) {
            setFeedback('error', t('publicProfileSaveFailed'), e?.message || String(e));
        }
    });
    root.querySelector('[data-profile-modal-zoom]')?.addEventListener('input', (event) => {
        const draft = profileImageDraft[activeProfileImageKind];
        if (!draft) return;
        draft.zoom = Number(event.currentTarget.value) || 1;
        drawProfileModalPreview(activeProfileImageKind);
        drawProfilePreview(activeProfileImageKind);
    });
    const modalPreview = root.querySelector('[data-profile-modal-preview]');
    modalPreview?.addEventListener('pointerdown', (event) => {
        const draft = profileImageDraft[activeProfileImageKind];
        if (!draft?.image) return;
        event.preventDefault();
        modalPreview.setPointerCapture?.(event.pointerId);
        modalPreview.classList.add('is-dragging');
        profileImageDrag = {
            startX: event.clientX,
            startY: event.clientY,
            startOffsetX: draft.offsetX || 0,
            startOffsetY: draft.offsetY || 0
        };
    });
    modalPreview?.addEventListener('pointermove', updateProfileModalDrag);
    modalPreview?.addEventListener('pointerup', endProfileModalDrag);
    modalPreview?.addEventListener('pointercancel', endProfileModalDrag);
    root.querySelector('[data-profile-modal-apply]')?.addEventListener('click', () => {
        drawProfilePreview(activeProfileImageKind);
        closeProfileImageModal({ restore: false });
    });
    root.querySelectorAll('[data-profile-pick]').forEach((button) => {
        button.addEventListener('click', () => {
            const input = root.querySelector(`[data-profile-file="${button.dataset.profilePick}"]`);
            if (!input) return;
            input.value = '';
            input.click();
        });
    });
    root.querySelectorAll('[data-profile-file]').forEach((input) => {
        input.addEventListener('change', async () => {
            const kind = input.dataset.profileFile;
            try {
                await selectProfileImage(kind, input.files?.[0]);
            } catch (e) {
                setFeedback('error', t('publicProfileSaveFailed'), e?.message || String(e));
            }
        });
    });
    root.querySelectorAll('[data-profile-zoom]').forEach((input) => {
        input.addEventListener('input', () => {
            const draft = profileImageDraft[input.dataset.profileZoom];
            if (!draft) return;
            draft.zoom = Number(input.value) || 1;
            drawProfilePreview(draft.kind);
        });
    });
    root.querySelector('[data-public-profile-save]')?.addEventListener('click', () => {
        savePublicProfile().catch((e) => {
            console.error('[MyPage] public profile save failed:', e);
            setFeedback('error', t('publicProfileSaveFailed'), e?.message || String(e));
        });
    });
}

async function savePublicProfile() {
    if (!currentUser?.uid || !currentAccount) return;
    const name = String(document.querySelector('[data-public-profile-name]')?.value || '').trim();
    const submittedHandle = normalizeHandle(document.querySelector('[data-public-profile-handle]')?.value || '');
    const existingHandle = normalizeHandle(currentAccount.publicProfile?.handle || currentAccount.handle || '');
    const bio = String(document.querySelector('[data-public-profile-bio]')?.value || '').trim().slice(0, 280);
    if (!name) throw new Error(t('publicProfileNameRequired'));
    if (submittedHandle && (!HANDLE_RE.test(submittedHandle) || RESERVED_HANDLES.has(submittedHandle))) {
        throw new Error(t('publicProfileHandleInvalid'));
    }
    if (existingHandle && submittedHandle && submittedHandle !== existingHandle) {
        throw new Error(t('publicProfileHandleLockedError'));
    }

    const saveBtn = document.querySelector('[data-public-profile-save]');
    if (saveBtn) saveBtn.disabled = true;
    try {
        const currentProfile = getPublicProfile();
        const [avatarUrl, backgroundUrl] = await Promise.all([
            uploadProfileImage('avatar'),
            uploadProfileImage('background')
        ]);
        const finalHandle = existingHandle || submittedHandle || null;
        const nextProfile = {
            displayName: name.slice(0, 80),
            handle: finalHandle,
            bio,
            avatarUrl: avatarUrl || currentProfile.avatarUrl || '',
            backgroundUrl: backgroundUrl || currentProfile.backgroundUrl || '',
            updatedAt: null
        };
        const userRef = doc(db, 'users', currentUser.uid);
        const handleRef = finalHandle ? doc(db, 'handles', finalHandle) : null;

        await runTransaction(db, async (tx) => {
            const userSnap = await tx.get(userRef);
            if (!userSnap.exists()) throw new Error(t('accountLoadFailed'));
            const live = userSnap.data() || {};
            const liveHandle = normalizeHandle(live.publicProfile?.handle || live.handle || '');
            if (liveHandle && finalHandle !== liveHandle) throw new Error(t('publicProfileHandleLockedError'));
            if (!liveHandle && finalHandle && handleRef) {
                const handleSnap = await tx.get(handleRef);
                if (handleSnap.exists() && handleSnap.data()?.uid !== currentUser.uid) {
                    throw new Error(t('publicProfileHandleTaken'));
                }
                if (!handleSnap.exists()) {
                    tx.set(handleRef, {
                        handle: finalHandle,
                        uid: currentUser.uid,
                        createdAt: serverTimestamp()
                    });
                }
            }
            tx.update(userRef, {
                handle: finalHandle,
                publicProfile: nextProfile
            });
        });
        await syncPublicProfileSnapshots(nextProfile).catch((e) => {
            console.warn('[MyPage] public profile snapshot sync skipped:', e?.message || e);
        });

        currentAccount = {
            ...currentAccount,
            handle: finalHandle,
            publicProfile: {
                ...nextProfile,
                updatedAt: null
            }
        };
        resetProfileDrafts();
        clearFeedback();
        setFeedback('info', t('publicProfileSaved'));
        renderAccount();
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

async function syncPublicProfileSnapshots(profile) {
    if (!currentUser?.uid) return;
    const snap = await getDocs(query(collection(db, 'public_projects'), where('authorUid', '==', currentUser.uid), limit(50)));
    const updates = snap.docs.map(async (entry) => {
        const projectId = entry.data()?.projectId;
        if (projectId) {
            const context = await preparePrivateProjectAction(projectId);
            if (context) return runPrivateProjectAction(context, 'profile');
        }
        return setDoc(entry.ref, {
        authorName: profile.displayName || '',
        authorHandle: profile.handle || null,
        authorAvatarUrl: profile.avatarUrl || '',
        authorProfile: {
            displayName: profile.displayName || '',
            handle: profile.handle || null,
            avatarUrl: profile.avatarUrl || '',
            backgroundUrl: profile.backgroundUrl || '',
            bio: profile.bio || ''
        },
        updatedAt: serverTimestamp()
    }, { merge: true });
    }).map(promise => promise.catch((e) => {
        console.warn('[MyPage] public project profile sync skipped:', e?.code || e?.message);
    }));
    await Promise.all(updates);
}

async function loadPlanRequests(uid) {
    const ref = collection(db, 'users', uid, 'planChangeRequests');
    const snap = await getDocs(query(ref, orderBy('createdAt', 'desc'), limit(10))).catch(() => ({ docs: [] }));
    currentRequests = snap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

async function requestPlanChange(requestedTier, action) {
    if (!currentUser?.uid || !currentAccount) return;
    const tier = normalizePlanTier(requestedTier);
    await addDoc(collection(db, 'users', currentUser.uid, 'planChangeRequests'), {
        uid: currentUser.uid,
        action,
        requestedTier: tier,
        currentTier: normalizePlanTier(currentAccount.plan?.tier),
        currentStatus: String(currentAccount.plan?.status || 'active'),
        status: 'requested',
        note: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });
    clearFeedback();
    setFeedback('info', t('planRequestSavedTitle'), t('planRequestSavedDesc'));
    await loadPlanRequests(currentUser.uid);
    renderAccount();
}

async function loadAccount(user) {
    currentUser = user;
    if (!user) {
        currentAccount = null;
        currentRequests = [];
        renderSignedOut();
        return;
    }
    currentAccount = await ensureUserBootstrap(user);
    await loadPlanRequests(user.uid);
    renderAccount();
}

async function init() {
    applyTheme();
    bindThemePreferenceListener();
    applyI18n();
    bindLangSwitcher();
    const redirectOutcome = await handleRedirectResult(auth);
    if (redirectOutcome?.error) {
        setFeedback('error', t('authError'), redirectOutcome.error?.message || String(redirectOutcome.error));
    }
    await initGIS({ authInstance: auth });
    onAuthStateChanged(auth, (user) => {
        renderAuthSlot(user);
        loadAccount(user).catch((e) => {
            console.error('[MyPage] account load failed:', e);
            setFeedback('error', t('accountLoadFailed'), e?.message || String(e));
        });
    });
}

init().catch((e) => {
    console.warn('[MyPage] bootstrap failed:', e);
    setFeedback('error', t('initFailed'), e?.message || String(e));
});
