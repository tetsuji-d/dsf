import { collection, getDocs, limit, orderBy, query } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { auth, db } from './firebase-core.js';
import { ensureUserBootstrap } from './firebase.js';
import { handleRedirectResult, renderGISButton, signInWithGoogle, signOutUser } from './gis-auth.js';

const ADMIN_UI_LANG_KEY = 'dsf_admin_ui_lang';
const ADMIN_UI = {
    ja: {
        kicker_operations: '運営',
        title_users: 'ユーザー',
        nav_users: 'ユーザー',
        nav_works: '作品',
        nav_reviews: 'レビュー',
        badge_signed_in: 'SIGNED IN',
        auth_signin: 'Googleでログイン',
        auth_signout: 'サインアウト',
        gate_brand: 'DSF ADMIN CONSOLE',
        gate_loading_title: '権限を確認しています',
        gate_loading_message: 'この画面は DSF 運営向けです。ログイン状態と custom claims を確認しています。',
        gate_forbidden_title: 'アクセス権限がありません',
        gate_forbidden_message: 'この URL は DSF 運営向けです。<code>admin</code> / <code>operator</code> / <code>moderator</code> の custom claims を持つ Google アカウントだけが入れます。',
        gate_signin_title: '運営権限が必要です',
        gate_signin_message: 'Google アカウントでログインし、custom claims で <code>admin</code> / <code>operator</code> / <code>moderator</code> を持つユーザーだけが入れます。',
        feedback_minimal_users: 'ユーザー画面の最小構成です。権限編集 UI は次段階で追加します。',
        search_placeholder: 'displayName / email / uid で検索',
        count_users: '{count}件',
        count_zero: '0件',
        empty_no_match: '一致するユーザーがいません。',
        empty_select_user: 'ユーザーを選択してください。',
        detail_uid: 'UID',
        detail_handle: 'ハンドル',
        detail_plan: 'プラン',
        detail_last_login: '最終ログイン',
        detail_status: '状態',
        detail_storage: '保存領域',
        detail_entitlements: '利用権限',
        status_disabled: '無効化',
        status_hold: 'モデレーション保留',
        role_staff: '運営',
        fallback_no_display_name: '（displayName 未設定）',
        fallback_no_email: 'メール未設定',
        fallback_signed_in_user: 'ログイン中のユーザー',
        bool_true: 'true',
        bool_false: 'false',
        init_failed: 'Admin Console の初期化に失敗しました。'
    },
    en: {
        kicker_operations: 'Operations',
        title_users: 'Users',
        nav_users: 'Users',
        nav_works: 'Works',
        nav_reviews: 'Reviews',
        badge_signed_in: 'SIGNED IN',
        auth_signin: 'Google Sign-In',
        auth_signout: 'Sign out',
        gate_brand: 'DSF ADMIN CONSOLE',
        gate_loading_title: 'Checking access',
        gate_loading_message: 'This screen is for DSF operations staff. Verifying your login state and custom claims.',
        gate_forbidden_title: 'Access denied',
        gate_forbidden_message: 'This URL is restricted to DSF operations staff. Only Google accounts with <code>admin</code>, <code>operator</code>, or <code>moderator</code> custom claims can enter.',
        gate_signin_title: 'Staff access required',
        gate_signin_message: 'Sign in with Google. Only users with <code>admin</code>, <code>operator</code>, or <code>moderator</code> custom claims can enter.',
        feedback_minimal_users: 'This is the minimal Users screen. Role editing UI will be added in the next phase.',
        search_placeholder: 'Search by displayName / email / uid',
        count_users: '{count} users',
        count_zero: '0 users',
        empty_no_match: 'No matching users.',
        empty_select_user: 'Select a user.',
        detail_uid: 'UID',
        detail_handle: 'Handle',
        detail_plan: 'Plan',
        detail_last_login: 'Last Login',
        detail_status: 'Status',
        detail_storage: 'Storage Namespace',
        detail_entitlements: 'Entitlements',
        status_disabled: 'disabled',
        status_hold: 'moderationHold',
        role_staff: 'STAFF',
        fallback_no_display_name: '(no displayName)',
        fallback_no_email: 'no-email',
        fallback_signed_in_user: 'Signed in user',
        bool_true: 'true',
        bool_false: 'false',
        init_failed: 'Failed to initialize the Admin Console.'
    }
};

let adminUiLang = localStorage.getItem(ADMIN_UI_LANG_KEY) || (navigator.language?.toLowerCase().startsWith('ja') ? 'ja' : 'en');
if (!ADMIN_UI[adminUiLang]) adminUiLang = 'ja';

const state = {
    authChecked: false,
    viewerRole: null,
    users: [],
    filteredUsers: [],
    selectedUid: null,
    gateMode: 'signin',
    feedback: { type: '', message: '', key: null }
};

function t(key, vars = {}) {
    const dict = ADMIN_UI[adminUiLang] || ADMIN_UI.ja;
    const value = dict[key] ?? ADMIN_UI.ja[key] ?? key;
    return String(value).replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''));
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatDate(value) {
    if (!value) return '—';
    const date = typeof value?.toDate === 'function' ? value.toDate() : (value instanceof Date ? value : null);
    if (!date || Number.isNaN(date.getTime())) return '—';
    return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function getViewerRole(tokenResult) {
    const token = tokenResult?.claims || {};
    if (token.admin === true) return 'ADMIN';
    if (token.operator === true) return 'OPERATOR';
    if (token.moderator === true) return 'MODERATOR';
    return null;
}

function setFeedback(type, message) {
    state.feedback = { type, message, key: null };
    const el = document.getElementById('admin-feedback');
    if (!el) return;
    if (!message) {
        el.innerHTML = '';
        return;
    }
    el.innerHTML = `<div class="admin-feedback-box is-${escapeHtml(type)}">${escapeHtml(message)}</div>`;
}

function setFeedbackKey(type, key) {
    state.feedback = { type, message: '', key };
    const el = document.getElementById('admin-feedback');
    if (!el) return;
    if (!key) {
        el.innerHTML = '';
        return;
    }
    el.innerHTML = `<div class="admin-feedback-box is-${escapeHtml(type)}">${escapeHtml(t(key))}</div>`;
}

function renderFeedback() {
    const el = document.getElementById('admin-feedback');
    if (!el) return;
    if (state.feedback.key) {
        el.innerHTML = `<div class="admin-feedback-box is-${escapeHtml(state.feedback.type)}">${escapeHtml(t(state.feedback.key))}</div>`;
        return;
    }
    if (!state.feedback.message) {
        el.innerHTML = '';
        return;
    }
    el.innerHTML = `<div class="admin-feedback-box is-${escapeHtml(state.feedback.type)}">${escapeHtml(state.feedback.message)}</div>`;
}

function renderGate({ mode = 'signin', user = null } = {}) {
    state.gateMode = mode;
    const kicker = document.getElementById('admin-gate-kicker');
    const title = document.getElementById('admin-gate-title');
    const message = document.getElementById('admin-gate-message');
    const account = document.getElementById('admin-gate-account');
    const gisHost = document.getElementById('gis-btn-admin');
    if (!kicker || !title || !message || !account || !gisHost) return;

    kicker.textContent = t('gate_brand');
    gisHost.hidden = false;
    account.hidden = true;
    account.innerHTML = '';

    if (mode === 'loading') {
        title.textContent = t('gate_loading_title');
        message.innerHTML = t('gate_loading_message');
        gisHost.hidden = true;
        return;
    }

    if (mode === 'forbidden') {
        title.textContent = t('gate_forbidden_title');
        message.innerHTML = t('gate_forbidden_message');
        if (user) {
            account.hidden = false;
            account.innerHTML = `
                <strong>${escapeHtml(user.displayName || t('fallback_signed_in_user'))}</strong><br>
                <span>${escapeHtml(user.email || t('fallback_no_email'))}</span>
            `;
        }
        gisHost.hidden = true;
        return;
    }

    title.textContent = t('gate_signin_title');
    message.innerHTML = t('gate_signin_message');
}

function setGateVisible(visible) {
    const shell = document.getElementById('admin-shell');
    const gate = document.getElementById('admin-auth-gate');
    const content = document.getElementById('admin-users-view');
    if (shell) {
        shell.classList.remove('is-booting');
        shell.classList.toggle('is-gated', visible);
    }
    if (gate) gate.hidden = !visible;
    if (content) content.hidden = visible;
}

function renderAuthArea(user, role) {
    const host = document.getElementById('admin-auth-area');
    if (!host) return;
    if (!user) {
        host.innerHTML = `<button type="button" class="admin-role-badge" id="admin-signin-btn">${escapeHtml(t('auth_signin'))}</button>`;
        host.querySelector('#admin-signin-btn')?.addEventListener('click', () => signInWithGoogle({ redirect: true }));
        return;
    }

    host.innerHTML = `
        <div class="admin-toolbar-meta">
            <span class="admin-role-badge">${escapeHtml(role || t('badge_signed_in'))}</span>
            <button type="button" class="admin-role-badge" id="admin-signout-btn">${escapeHtml(t('auth_signout'))}</button>
        </div>
    `;
    host.querySelector('#admin-signout-btn')?.addEventListener('click', async () => {
        await signOutUser();
    });
}

function buildUserPills(user) {
    const pills = [];
    if (user.roles?.admin) pills.push('<span class="admin-pill is-staff">ADMIN</span>');
    if (user.roles?.operator) pills.push('<span class="admin-pill is-staff">OPERATOR</span>');
    if (user.roles?.moderator) pills.push('<span class="admin-pill is-staff">MODERATOR</span>');
    if (user.status?.disabled) pills.push('<span class="admin-pill is-disabled">DISABLED</span>');
    if (user.status?.moderationHold) pills.push('<span class="admin-pill is-hold">HOLD</span>');
    pills.push(`<span class="admin-pill is-plan">${escapeHtml((user.plan?.tier || 'free').toUpperCase())}</span>`);
    return pills.join('');
}

function renderUserList() {
    const listEl = document.getElementById('admin-user-list');
    const countEl = document.getElementById('admin-user-count');
    if (!listEl || !countEl) return;

    countEl.textContent = t('count_users', { count: state.filteredUsers.length });

    if (!state.filteredUsers.length) {
        listEl.innerHTML = `
            <div class="admin-empty-state">
                <div>
                    <span class="material-icons" aria-hidden="true">search_off</span>
                    <p>${escapeHtml(t('empty_no_match'))}</p>
                </div>
            </div>
        `;
        return;
    }

    listEl.innerHTML = state.filteredUsers.map((user) => `
        <button type="button" class="admin-user-item ${user.uid === state.selectedUid ? 'is-active' : ''}" data-uid="${escapeHtml(user.uid)}" role="listitem">
            <div class="admin-user-row">
                <div>
                    <p class="admin-user-name">${escapeHtml(user.displayName || t('fallback_no_display_name'))}</p>
                    <p class="admin-user-email">${escapeHtml(user.email || t('fallback_no_email'))}</p>
                    <p class="admin-user-meta">${escapeHtml(user.uid)}</p>
                </div>
                <div class="admin-pill-row">
                    ${buildUserPills(user)}
                </div>
            </div>
        </button>
    `).join('');

    listEl.querySelectorAll('.admin-user-item').forEach((button) => {
        button.addEventListener('click', () => {
            state.selectedUid = button.dataset.uid;
            renderUserList();
            renderUserDetail();
        });
    });
}

function renderUserDetail() {
    const detailEl = document.getElementById('admin-user-detail');
    if (!detailEl) return;
    const user = state.filteredUsers.find((entry) => entry.uid === state.selectedUid)
        || state.users.find((entry) => entry.uid === state.selectedUid);
    if (!user) {
        detailEl.innerHTML = `
            <div class="admin-empty-state">
                <div>
                    <span class="material-icons" aria-hidden="true">person_search</span>
                    <p>${escapeHtml(t('empty_select_user'))}</p>
                </div>
            </div>
        `;
        return;
    }

    detailEl.innerHTML = `
        <div class="admin-detail-header">
            <div>
                <p class="admin-detail-name">${escapeHtml(user.displayName || t('fallback_no_display_name'))}</p>
                <p class="admin-detail-email">${escapeHtml(user.email || t('fallback_no_email'))}</p>
            </div>
            <div class="admin-pill-row">${buildUserPills(user)}</div>
        </div>
        <div class="admin-detail-grid">
            <div class="admin-detail-card">
                <h3>${escapeHtml(t('detail_uid'))}</h3>
                <p>${escapeHtml(user.uid)}</p>
            </div>
            <div class="admin-detail-card">
                <h3>${escapeHtml(t('detail_handle'))}</h3>
                <p>${escapeHtml(user.handle || '—')}</p>
            </div>
            <div class="admin-detail-card">
                <h3>${escapeHtml(t('detail_plan'))}</h3>
                <p>${escapeHtml(user.plan?.tier || 'free')} / ${escapeHtml(user.plan?.status || 'active')}</p>
            </div>
            <div class="admin-detail-card">
                <h3>${escapeHtml(t('detail_last_login'))}</h3>
                <p>${escapeHtml(formatDate(user.lastLoginAt))}</p>
            </div>
        </div>
        <div class="admin-detail-section">
            <h3>${escapeHtml(t('detail_status'))}</h3>
            <div class="admin-detail-stack">
                <div class="admin-detail-card"><p>${escapeHtml(t('status_disabled'))}: ${user.status?.disabled ? t('bool_true') : t('bool_false')}</p></div>
                <div class="admin-detail-card"><p>${escapeHtml(t('status_hold'))}: ${user.status?.moderationHold ? t('bool_true') : t('bool_false')}</p></div>
            </div>
        </div>
        <div class="admin-detail-section">
            <h3>${escapeHtml(t('detail_storage'))}</h3>
            <code>${escapeHtml(user.storage?.authoringRoot || '')}\n${escapeHtml(user.storage?.publishRoot || '')}</code>
        </div>
        <div class="admin-detail-section">
            <h3>${escapeHtml(t('detail_entitlements'))}</h3>
            <div class="admin-detail-grid">
                ${Object.entries(user.entitlements || {}).map(([key, value]) => `
                    <div class="admin-detail-card">
                        <h3>${escapeHtml(key)}</h3>
                        <p>${value ? t('bool_true') : t('bool_false')}</p>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function applyAdminStaticI18n() {
    document.documentElement.lang = adminUiLang === 'en' ? 'en' : 'ja';
    document.querySelectorAll('[data-admin-i18n]').forEach((el) => {
        const key = el.dataset.adminI18n;
        el.textContent = t(key);
    });
    const search = document.getElementById('admin-user-search');
    if (search) search.placeholder = t('search_placeholder');
    document.querySelector('.admin-nav-link[data-section="users"] span:last-child')?.replaceChildren(document.createTextNode(t('nav_users')));
    document.querySelector('.admin-nav-link[data-section="works"] span:last-child')?.replaceChildren(document.createTextNode(t('nav_works')));
    document.querySelector('.admin-nav-link[data-section="reviews"] span:last-child')?.replaceChildren(document.createTextNode(t('nav_reviews')));
    document.querySelectorAll('.admin-ui-lang-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.adminUiLang === adminUiLang);
    });
}

function rerenderAdminUi() {
    applyAdminStaticI18n();
    renderFeedback();
    renderGate({ mode: state.gateMode, user: auth.currentUser || null });
    renderAuthArea(auth.currentUser || null, state.viewerRole);
    const roleBadge = document.getElementById('admin-role-badge');
    if (roleBadge && !state.viewerRole) roleBadge.textContent = t('role_staff');
    if (state.viewerRole || state.users.length) {
        renderUserList();
        renderUserDetail();
    }
}

window.setAdminUiLang = (lang) => {
    if (!ADMIN_UI[lang]) return;
    adminUiLang = lang;
    localStorage.setItem(ADMIN_UI_LANG_KEY, lang);
    rerenderAdminUi();
};

function applySearch() {
    const input = document.getElementById('admin-user-search');
    const q = String(input?.value || '').trim().toLowerCase();
    if (!q) {
        state.filteredUsers = [...state.users];
    } else {
        state.filteredUsers = state.users.filter((user) =>
            String(user.displayName || '').toLowerCase().includes(q)
            || String(user.email || '').toLowerCase().includes(q)
            || String(user.uid || '').toLowerCase().includes(q)
        );
    }

    if (!state.filteredUsers.some((entry) => entry.uid === state.selectedUid)) {
        state.selectedUid = state.filteredUsers[0]?.uid || null;
    }

    renderUserList();
    renderUserDetail();
}

async function loadUsers() {
    const snapshot = await getDocs(query(collection(db, 'users'), orderBy('lastLoginAt', 'desc'), limit(200)));
    state.users = snapshot.docs.map((docSnap) => ({ uid: docSnap.id, ...docSnap.data() }));
    state.filteredUsers = [...state.users];
    state.selectedUid = state.filteredUsers[0]?.uid || null;
    applySearch();
}

async function handleAuthorizedUser(user) {
    await ensureUserBootstrap(user);
    const tokenResult = await user.getIdTokenResult(true);
    const role = getViewerRole(tokenResult);
    renderAuthArea(user, role);

    if (!role) {
        renderGate({ mode: 'forbidden', user });
        setGateVisible(true);
        setFeedback('', '');
        return;
    }

    state.viewerRole = role;
    document.getElementById('admin-role-badge').textContent = role;
    setGateVisible(false);
    setFeedbackKey('info', 'feedback_minimal_users');
    await loadUsers();
}

async function init() {
    applyAdminStaticI18n();
    document.querySelectorAll('[data-admin-ui-lang]').forEach((btn) => {
        btn.addEventListener('click', () => window.setAdminUiLang(btn.dataset.adminUiLang));
    });
    await handleRedirectResult(auth).catch(() => {});
    renderGate({ mode: 'loading', user: null });
    setGateVisible(true);
    renderAuthArea(null, null);
    renderGISButton('gis-btn-admin', { autoPrompt: false }).catch(() => {});

    document.getElementById('admin-user-search')?.addEventListener('input', applySearch);

    onAuthStateChanged(auth, async (user) => {
        try {
            if (!user) {
                state.viewerRole = null;
                state.users = [];
                state.filteredUsers = [];
                state.selectedUid = null;
                renderAuthArea(null, null);
                renderGate({ mode: 'signin', user: null });
                setGateVisible(true);
                setFeedback('', '');
                return;
            }
            await handleAuthorizedUser(user);
        } catch (error) {
            console.error('[admin] init failed:', error);
            setGateVisible(true);
            renderAuthArea(user, null);
            setFeedback('error', error?.message || t('init_failed'));
        }
    });
}

init();
