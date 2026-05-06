import { addDoc, collection, getDocs, limit, orderBy, query, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
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
        downgradeNote: '解約・ダウングレード後は作品の掲載期限が再評価され、FREEでは発行から14日を超えた公開/限定公開作品は下書き扱いになります。',
        noRequests: 'まだリクエストはありません。',
        statusActive: '有効',
        statusDisabled: '停止中',
        planStatusActive: '有効',
        planStatusTrialing: 'トライアル中',
        planStatusCanceled: '解約済み',
        planStatusPastDue: '支払い確認中',
        moderationNormal: '通常',
        moderationHold: '保留中',
        listingLimit: '掲載期限',
        listingUnlimited: '無期限',
        listingFreeLimit: '発行から14日',
        publicScheduling: '公開期限予約',
        available: '利用可',
        unavailable: '利用不可',
        planFeatureFreeListing: '掲載期限: 発行から14日',
        planFeatureUnlimitedListing: '掲載期限: 無期限',
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

    el.querySelectorAll('[data-plan-request]').forEach((button) => {
        button.addEventListener('click', () => requestPlanChange(button.dataset.planRequest, 'change'));
    });
    el.querySelector('[data-plan-cancel]')?.addEventListener('click', () => requestPlanChange('free', 'cancel'));
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
