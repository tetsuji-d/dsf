import { collection, getDocs, limit, orderBy, query } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { auth, db } from './firebase-core.js';
import { ensureUserBootstrap } from './firebase.js';
import { handleRedirectResult, renderGISButton, signInWithGoogle, signOutUser } from './gis-auth.js';

const state = {
    authChecked: false,
    viewerRole: null,
    users: [],
    filteredUsers: [],
    selectedUid: null,
    gateMode: 'signin'
};

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
    const el = document.getElementById('admin-feedback');
    if (!el) return;
    if (!message) {
        el.innerHTML = '';
        return;
    }
    el.innerHTML = `<div class="admin-feedback-box is-${escapeHtml(type)}">${escapeHtml(message)}</div>`;
}

function renderGate({ mode = 'signin', user = null } = {}) {
    state.gateMode = mode;
    const kicker = document.getElementById('admin-gate-kicker');
    const title = document.getElementById('admin-gate-title');
    const message = document.getElementById('admin-gate-message');
    const account = document.getElementById('admin-gate-account');
    const gisHost = document.getElementById('gis-btn-admin');
    if (!kicker || !title || !message || !account || !gisHost) return;

    kicker.textContent = 'DSF ADMIN CONSOLE';
    gisHost.hidden = false;
    account.hidden = true;
    account.innerHTML = '';

    if (mode === 'loading') {
        title.textContent = '権限を確認しています';
        message.innerHTML = 'この画面は DSF 運営向けです。ログイン状態と custom claims を確認しています。';
        gisHost.hidden = true;
        return;
    }

    if (mode === 'forbidden') {
        title.textContent = 'アクセス権限がありません';
        message.innerHTML = 'この URL は DSF 運営向けです。<code>admin</code> / <code>operator</code> / <code>moderator</code> の custom claims を持つ Google アカウントだけが入れます。';
        if (user) {
            account.hidden = false;
            account.innerHTML = `
                <strong>${escapeHtml(user.displayName || 'Signed in user')}</strong><br>
                <span>${escapeHtml(user.email || 'no-email')}</span>
            `;
        }
        gisHost.hidden = true;
        return;
    }

    title.textContent = '運営権限が必要です';
    message.innerHTML = 'Google アカウントでログインし、custom claims で <code>admin</code> / <code>operator</code> / <code>moderator</code> を持つユーザーだけが入れます。';
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
        host.innerHTML = `<button type="button" class="admin-role-badge" id="admin-signin-btn">Google Sign-In</button>`;
        host.querySelector('#admin-signin-btn')?.addEventListener('click', () => signInWithGoogle({ redirect: true }));
        return;
    }

    host.innerHTML = `
        <div class="admin-toolbar-meta">
            <span class="admin-role-badge">${escapeHtml(role || 'SIGNED IN')}</span>
            <button type="button" class="admin-role-badge" id="admin-signout-btn">Sign out</button>
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

    countEl.textContent = `${state.filteredUsers.length} users`;

    if (!state.filteredUsers.length) {
        listEl.innerHTML = `
            <div class="admin-empty-state">
                <div>
                    <span class="material-icons" aria-hidden="true">search_off</span>
                    <p>一致するユーザーがいません。</p>
                </div>
            </div>
        `;
        return;
    }

    listEl.innerHTML = state.filteredUsers.map((user) => `
        <button type="button" class="admin-user-item ${user.uid === state.selectedUid ? 'is-active' : ''}" data-uid="${escapeHtml(user.uid)}" role="listitem">
            <div class="admin-user-row">
                <div>
                    <p class="admin-user-name">${escapeHtml(user.displayName || '(no displayName)')}</p>
                    <p class="admin-user-email">${escapeHtml(user.email || 'no-email')}</p>
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
                    <p>ユーザーを選択してください。</p>
                </div>
            </div>
        `;
        return;
    }

    detailEl.innerHTML = `
        <div class="admin-detail-header">
            <div>
                <p class="admin-detail-name">${escapeHtml(user.displayName || '(no displayName)')}</p>
                <p class="admin-detail-email">${escapeHtml(user.email || 'no-email')}</p>
            </div>
            <div class="admin-pill-row">${buildUserPills(user)}</div>
        </div>
        <div class="admin-detail-grid">
            <div class="admin-detail-card">
                <h3>UID</h3>
                <p>${escapeHtml(user.uid)}</p>
            </div>
            <div class="admin-detail-card">
                <h3>Handle</h3>
                <p>${escapeHtml(user.handle || '—')}</p>
            </div>
            <div class="admin-detail-card">
                <h3>Plan</h3>
                <p>${escapeHtml(user.plan?.tier || 'free')} / ${escapeHtml(user.plan?.status || 'active')}</p>
            </div>
            <div class="admin-detail-card">
                <h3>Last Login</h3>
                <p>${escapeHtml(formatDate(user.lastLoginAt))}</p>
            </div>
        </div>
        <div class="admin-detail-section">
            <h3>Status</h3>
            <div class="admin-detail-stack">
                <div class="admin-detail-card"><p>disabled: ${user.status?.disabled ? 'true' : 'false'}</p></div>
                <div class="admin-detail-card"><p>moderationHold: ${user.status?.moderationHold ? 'true' : 'false'}</p></div>
            </div>
        </div>
        <div class="admin-detail-section">
            <h3>Storage Namespace</h3>
            <code>${escapeHtml(user.storage?.authoringRoot || '')}\n${escapeHtml(user.storage?.publishRoot || '')}</code>
        </div>
        <div class="admin-detail-section">
            <h3>Entitlements</h3>
            <div class="admin-detail-grid">
                ${Object.entries(user.entitlements || {}).map(([key, value]) => `
                    <div class="admin-detail-card">
                        <h3>${escapeHtml(key)}</h3>
                        <p>${value ? 'true' : 'false'}</p>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

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
    setFeedback('info', 'Users 画面の最小構成です。権限編集 UI は次段階で追加します。');
    await loadUsers();
}

async function init() {
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
            setFeedback('error', error?.message || 'Admin console の初期化に失敗しました。');
        }
    });
}

init();
