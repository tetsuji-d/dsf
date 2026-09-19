import { collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { auth, db } from './firebase-core.js';
import { ensureUserBootstrap } from './firebase.js';
import { handleRedirectResult, renderGISButton, signInWithGoogle, signOutUser } from './gis-auth.js';

const ADMIN_UI_LANG_KEY = 'dsf_admin_ui_lang';
const ADMIN_UI = {
    ja: {
        kicker_operations: '運営',
        title_users: 'ユーザー',
        title_works: '作品',
        title_reviews: 'レビュー',
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
        feedback_minimal_users: 'ユーザー・作品・レビューを運営確認できます。',
        search_placeholder: 'displayName / email / uid で検索',
        search_works_placeholder: 'タイトル / 作者 / workId で検索',
        search_reviews_placeholder: '本文 / 読者 / workId で検索',
        count_users: '{count}件',
        count_works: '{count}件',
        count_reviews: '{count}件',
        count_zero: '0件',
        empty_no_match: '一致するユーザーがいません。',
        empty_no_work_match: '一致する作品がありません。',
        empty_no_review_match: '一致するレビューがありません。',
        empty_select_user: 'ユーザーを選択してください。',
        empty_select_work: '作品を選択してください。',
        empty_select_review: 'レビューを選択してください。',
        detail_actions: '導線',
        action_view_user_works: 'このユーザーの作品',
        action_view_user_reviews: '関連レビュー',
        action_open_user: 'ユーザーを開く',
        action_open_work: '作品を開く',
        action_open_reviews: 'レビューを開く',
        action_open_viewer: 'Viewerで開く',
        action_sync_snapshot: '公開スナップショット再同期',
        detail_author: '作者',
        detail_reader: '読者',
        detail_work: '作品',
        detail_review: 'レビュー',
        detail_publication: '公開情報',
        detail_body: '本文',
        detail_created_at: '作成日時',
        detail_updated_at: '更新日時',
        detail_reactions: 'リアクション',
        detail_delivery: '配信データ',
        delivery_public_snapshot: '公開スナップショット',
        delivery_release_snapshot: 'Release fallback',
        delivery_available: 'あり',
        delivery_missing: 'なし',
        sync_snapshot_confirm: 'release snapshot から public_projects に dsfPages を補完します。続行しますか？',
        sync_snapshot_success: '公開スナップショットを再同期しました。',
        sync_snapshot_failed: '公開スナップショットの再同期に失敗しました: {message}',
        sync_snapshot_not_allowed: 'このロールでは再同期できません',
        sync_snapshot_missing_release: 'releaseId または作者UIDがないため再同期できません。',
        sync_snapshot_empty_release: 'release snapshot に dsfPages がありません。',
        sync_snapshot_private_authoring: 'この作品は作者のWorks画面から公開情報を更新してください。',
        review_status_title: 'レビュー状態',
        review_status_published: '公開',
        review_status_hidden: '非表示',
        review_status_removed: '削除扱い',
        review_status_confirm: 'レビュー状態を {status} に変更します。続行しますか？',
        review_status_success: 'レビュー状態を更新しました。',
        review_status_failed: 'レビュー状態の更新に失敗しました: {message}',
        load_works_failed: '作品の読み込みに失敗しました: {message}',
        load_reviews_failed: 'レビューの読み込みに失敗しました: {message}',
        detail_uid: 'UID',
        detail_handle: 'ハンドル',
        detail_plan: 'プラン',
        detail_billing: '課金同期',
        detail_last_login: '最終ログイン',
        detail_status: '状態',
        detail_storage: '保存領域',
        detail_entitlements: '利用権限',
        manual_plan_title: '手動プラン設定',
        manual_plan_desc: 'テスト・不具合対応用です。Stripe との同期前提ではなく、Firestore の projection を直接更新します。',
        manual_plan_tier: 'プラン',
        manual_plan_status: '状態',
        manual_plan_apply: 'プランを反映',
        manual_plan_not_allowed: 'このロールではプランを変更できません',
        manual_plan_confirm: '{tier} / {status} を手動反映します。Stripe の正本とは同期されません。続行しますか？',
        manual_plan_success: 'プランを手動更新しました。',
        manual_plan_failed: 'プラン更新に失敗しました: {message}',
        status_disabled: '無効化',
        status_hold: 'モデレーション保留',
        entitlement_canCreateProject: 'プロジェクト作成',
        entitlement_canUsePremiumPaper: 'プレミアム用紙',
        entitlement_canPublishPrivately: '限定公開',
        entitlement_canUseAdvancedAnalytics: '高度な分析',
        entitlement_canManageLabel: 'レーベル管理',
        entitlement_canUseUnlimitedListing: '掲載可能期間 無期限',
        entitlement_canSchedulePublicExpiry: '公開期限予約',
        entitlement_enabled: '利用可',
        entitlement_disabled: '不可',
        action_disable: 'アカウントを停止',
        action_enable: '停止を解除',
        action_hold: '保留にする',
        action_release_hold: '保留を解除',
        action_not_allowed: 'このロールでは変更できません',
        confirm_disable: 'このユーザーのログイン後操作を停止します。続行しますか？',
        confirm_enable: 'このユーザーの停止を解除します。続行しますか？',
        confirm_hold: 'このユーザーの公開・投稿を保留します。続行しますか？',
        confirm_release_hold: 'このユーザーのモデレーション保留を解除します。続行しますか？',
        update_success: 'ユーザー状態を更新しました。',
        update_failed: 'ユーザー状態の更新に失敗しました: {message}',
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
        title_works: 'Works',
        title_reviews: 'Reviews',
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
        feedback_minimal_users: 'Users, works, and reviews are available for operations review.',
        search_placeholder: 'Search by displayName / email / uid',
        search_works_placeholder: 'Search by title / author / workId',
        search_reviews_placeholder: 'Search by body / reader / workId',
        count_users: '{count} users',
        count_works: '{count} works',
        count_reviews: '{count} reviews',
        count_zero: '0 users',
        empty_no_match: 'No matching users.',
        empty_no_work_match: 'No matching works.',
        empty_no_review_match: 'No matching reviews.',
        empty_select_user: 'Select a user.',
        empty_select_work: 'Select a work.',
        empty_select_review: 'Select a review.',
        detail_actions: 'Routes',
        action_view_user_works: 'Works by this user',
        action_view_user_reviews: 'Related reviews',
        action_open_user: 'Open user',
        action_open_work: 'Open work',
        action_open_reviews: 'Open reviews',
        action_open_viewer: 'Open in Viewer',
        action_sync_snapshot: 'Resync public snapshot',
        detail_author: 'Author',
        detail_reader: 'Reader',
        detail_work: 'Work',
        detail_review: 'Review',
        detail_publication: 'Publication',
        detail_body: 'Body',
        detail_created_at: 'Created at',
        detail_updated_at: 'Updated at',
        detail_reactions: 'Reactions',
        detail_delivery: 'Delivery Data',
        delivery_public_snapshot: 'Public snapshot',
        delivery_release_snapshot: 'Release fallback',
        delivery_available: 'available',
        delivery_missing: 'missing',
        sync_snapshot_confirm: 'Copy dsfPages from the release snapshot into public_projects. Continue?',
        sync_snapshot_success: 'Public snapshot resynced.',
        sync_snapshot_failed: 'Failed to resync public snapshot: {message}',
        sync_snapshot_not_allowed: 'This role cannot resync snapshots',
        sync_snapshot_missing_release: 'Cannot resync because releaseId or author UID is missing.',
        sync_snapshot_empty_release: 'The release snapshot has no dsfPages.',
        sync_snapshot_private_authoring: 'Update this publication from the owner’s Works screen.',
        review_status_title: 'Review Status',
        review_status_published: 'Published',
        review_status_hidden: 'Hidden',
        review_status_removed: 'Removed',
        review_status_confirm: 'Change review status to {status}. Continue?',
        review_status_success: 'Review status updated.',
        review_status_failed: 'Failed to update review status: {message}',
        load_works_failed: 'Failed to load works: {message}',
        load_reviews_failed: 'Failed to load reviews: {message}',
        detail_uid: 'UID',
        detail_handle: 'Handle',
        detail_plan: 'Plan',
        detail_billing: 'Billing Sync',
        detail_last_login: 'Last Login',
        detail_status: 'Status',
        detail_storage: 'Storage Namespace',
        detail_entitlements: 'Entitlements',
        manual_plan_title: 'Manual Plan Override',
        manual_plan_desc: 'For testing and incident response. This directly updates the Firestore projection and does not sync from Stripe.',
        manual_plan_tier: 'Plan',
        manual_plan_status: 'Status',
        manual_plan_apply: 'Apply plan',
        manual_plan_not_allowed: 'This role cannot change plans',
        manual_plan_confirm: 'Apply {tier} / {status} manually. This will not sync with Stripe. Continue?',
        manual_plan_success: 'Plan updated manually.',
        manual_plan_failed: 'Failed to update plan: {message}',
        status_disabled: 'disabled',
        status_hold: 'moderationHold',
        entitlement_canCreateProject: 'Create projects',
        entitlement_canUsePremiumPaper: 'Premium paper',
        entitlement_canPublishPrivately: 'Private publishing',
        entitlement_canUseAdvancedAnalytics: 'Advanced analytics',
        entitlement_canManageLabel: 'Label management',
        entitlement_canUseUnlimitedListing: 'Unlimited listing',
        entitlement_canSchedulePublicExpiry: 'Schedule public expiry',
        entitlement_enabled: 'enabled',
        entitlement_disabled: 'disabled',
        action_disable: 'Disable account',
        action_enable: 'Enable account',
        action_hold: 'Place hold',
        action_release_hold: 'Release hold',
        action_not_allowed: 'This role cannot change this setting',
        confirm_disable: 'Disable this user after sign-in. Continue?',
        confirm_enable: 'Enable this user. Continue?',
        confirm_hold: 'Place this user on publishing and posting hold. Continue?',
        confirm_release_hold: 'Release this user from moderation hold. Continue?',
        update_success: 'User status updated.',
        update_failed: 'Failed to update user status: {message}',
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
    activeSection: 'users',
    users: [],
    filteredUsers: [],
    selectedUid: null,
    works: [],
    filteredWorks: [],
    selectedWorkId: null,
    reviews: [],
    filteredReviews: [],
    selectedReviewId: null,
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

function dateMillis(value) {
    const date = typeof value?.toDate === 'function' ? value.toDate() : (value instanceof Date ? value : null);
    return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

function compactText(value, max = 140) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function entitlementLabel(key) {
    return t(`entitlement_${key}`);
}

function entitlementValue(value) {
    return value ? t('entitlement_enabled') : t('entitlement_disabled');
}

function userLabel(uid) {
    const user = state.users.find((entry) => entry.uid === uid);
    if (!user) return uid || '—';
    return user.displayName || user.email || uid || '—';
}

function getViewerRole(tokenResult) {
    const token = tokenResult?.claims || {};
    if (token.admin === true) return 'ADMIN';
    if (token.operator === true) return 'OPERATOR';
    if (token.moderator === true) return 'MODERATOR';
    return null;
}

function canManageDisabled() {
    return state.viewerRole === 'ADMIN' || state.viewerRole === 'OPERATOR';
}

function canManageModerationHold() {
    return state.viewerRole === 'ADMIN' || state.viewerRole === 'OPERATOR' || state.viewerRole === 'MODERATOR';
}

function canManagePlan() {
    return state.viewerRole === 'ADMIN' || state.viewerRole === 'OPERATOR';
}

function canSyncPublicSnapshot() {
    return state.viewerRole === 'ADMIN' || state.viewerRole === 'OPERATOR';
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
    const contents = document.querySelectorAll('.admin-content');
    if (shell) {
        shell.classList.remove('is-booting');
        shell.classList.toggle('is-gated', visible);
    }
    if (gate) gate.hidden = !visible;
    contents.forEach((content) => {
        content.hidden = visible || content.id !== `admin-${state.activeSection}-view`;
    });
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
    pills.push(`<span class="admin-pill is-plan">${escapeHtml((user.plan?.effectiveTier || user.plan?.tier || 'free').toUpperCase())}</span>`);
    return pills.join('');
}

function normalizeManualPlanTier(tier) {
    const value = String(tier || 'free').trim().toLowerCase();
    return ['free', 'plus', 'pro', 'business'].includes(value) ? value : 'free';
}

function normalizeManualPlanStatus(status) {
    const value = String(status || 'active').trim().toLowerCase();
    return ['active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired'].includes(value)
        ? value
        : 'active';
}

function effectiveTierForManualPlan(tier, status) {
    return ['active', 'trialing'].includes(status) ? tier : 'free';
}

function entitlementsForManualPlan(effectiveTier) {
    const isPaid = ['plus', 'pro', 'business'].includes(effectiveTier);
    const canSchedule = ['pro', 'business'].includes(effectiveTier);
    return {
        canCreateProject: true,
        canUsePremiumPaper: false,
        canPublishPrivately: isPaid,
        canUseAdvancedAnalytics: canSchedule,
        canManageLabel: effectiveTier === 'business',
        canUseUnlimitedListing: isPaid,
        canSchedulePublicExpiry: canSchedule
    };
}

function renderManualPlanForm(user) {
    const tier = normalizeManualPlanTier(user.plan?.effectiveTier || user.plan?.tier);
    const status = normalizeManualPlanStatus(user.plan?.status);
    const disabled = canManagePlan() ? '' : 'disabled';
    return `
        <div class="admin-detail-section admin-plan-manual">
            <div class="admin-section-heading">
                <div>
                    <h3>${escapeHtml(t('manual_plan_title'))}</h3>
                    <p>${escapeHtml(t('manual_plan_desc'))}</p>
                </div>
            </div>
            <div class="admin-plan-form">
                <label>
                    <span>${escapeHtml(t('manual_plan_tier'))}</span>
                    <select data-plan-tier ${disabled}>
                        ${['free', 'plus', 'pro', 'business'].map((value) => `
                            <option value="${escapeHtml(value)}" ${value === tier ? 'selected' : ''}>${escapeHtml(value.toUpperCase())}</option>
                        `).join('')}
                    </select>
                </label>
                <label>
                    <span>${escapeHtml(t('manual_plan_status'))}</span>
                    <select data-plan-status ${disabled}>
                        ${['active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired'].map((value) => `
                            <option value="${escapeHtml(value)}" ${value === status ? 'selected' : ''}>${escapeHtml(value)}</option>
                        `).join('')}
                    </select>
                </label>
                <button type="button"
                    class="admin-status-action is-warning"
                    data-plan-apply
                    ${canManagePlan() ? '' : 'disabled'}
                    title="${escapeHtml(canManagePlan() ? '' : t('manual_plan_not_allowed'))}">
                    ${escapeHtml(t('manual_plan_apply'))}
                </button>
            </div>
        </div>
    `;
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
                <p>${escapeHtml(user.plan?.tier || 'free')} / ${escapeHtml(user.plan?.effectiveTier || user.plan?.tier || 'free')} / ${escapeHtml(user.plan?.status || 'active')}</p>
            </div>
            <div class="admin-detail-card">
                <h3>${escapeHtml(t('detail_billing'))}</h3>
                <p>${escapeHtml(user.billing?.provider || 'none')} / ${escapeHtml(user.billing?.stripeSubscriptionStatus || '—')}</p>
            </div>
            <div class="admin-detail-card">
                <h3>${escapeHtml(t('detail_last_login'))}</h3>
                <p>${escapeHtml(formatDate(user.lastLoginAt))}</p>
            </div>
        </div>
        <div class="admin-detail-section">
            <h3>${escapeHtml(t('detail_actions'))}</h3>
            <div class="admin-action-row">
                <button type="button" class="admin-status-action" data-open-user-works="${escapeHtml(user.uid)}">
                    ${escapeHtml(t('action_view_user_works'))}
                </button>
                <button type="button" class="admin-status-action" data-open-user-reviews="${escapeHtml(user.uid)}">
                    ${escapeHtml(t('action_view_user_reviews'))}
                </button>
            </div>
        </div>
        ${renderManualPlanForm(user)}
        <div class="admin-detail-section">
            <h3>${escapeHtml(t('detail_status'))}</h3>
            <div class="admin-detail-stack">
                <div class="admin-detail-card admin-status-card">
                    <p>${escapeHtml(t('status_disabled'))}: ${user.status?.disabled ? t('bool_true') : t('bool_false')}</p>
                    <button type="button"
                        class="admin-status-action ${user.status?.disabled ? 'is-safe' : 'is-danger'}"
                        data-status-field="disabled"
                        data-status-next="${user.status?.disabled ? 'false' : 'true'}"
                        ${canManageDisabled() ? '' : 'disabled'}
                        title="${escapeHtml(canManageDisabled() ? '' : t('action_not_allowed'))}">
                        ${escapeHtml(user.status?.disabled ? t('action_enable') : t('action_disable'))}
                    </button>
                </div>
                <div class="admin-detail-card admin-status-card">
                    <p>${escapeHtml(t('status_hold'))}: ${user.status?.moderationHold ? t('bool_true') : t('bool_false')}</p>
                    <button type="button"
                        class="admin-status-action ${user.status?.moderationHold ? 'is-safe' : 'is-warning'}"
                        data-status-field="moderationHold"
                        data-status-next="${user.status?.moderationHold ? 'false' : 'true'}"
                        ${canManageModerationHold() ? '' : 'disabled'}
                        title="${escapeHtml(canManageModerationHold() ? '' : t('action_not_allowed'))}">
                        ${escapeHtml(user.status?.moderationHold ? t('action_release_hold') : t('action_hold'))}
                    </button>
                </div>
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
                        <h3>${escapeHtml(entitlementLabel(key))}</h3>
                        <p>${escapeHtml(entitlementValue(value))}</p>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    detailEl.querySelectorAll('[data-status-field]').forEach((button) => {
        button.addEventListener('click', () => {
            const field = button.dataset.statusField;
            const nextValue = button.dataset.statusNext === 'true';
            updateUserStatus(user.uid, field, nextValue).catch((e) => {
                setFeedback('error', t('update_failed', { message: e?.message || String(e) }));
            });
        });
    });

    detailEl.querySelector('[data-plan-apply]')?.addEventListener('click', () => {
        const tier = detailEl.querySelector('[data-plan-tier]')?.value || 'free';
        const status = detailEl.querySelector('[data-plan-status]')?.value || 'active';
        updateUserPlan(user.uid, tier, status).catch((e) => {
            setFeedback('error', t('manual_plan_failed', { message: e?.message || String(e) }));
        });
    });

    detailEl.querySelector('[data-open-user-works]')?.addEventListener('click', () => {
        openWorksForUser(user.uid).catch((e) => setFeedback('error', t('load_works_failed', { message: e?.message || String(e) })));
    });

    detailEl.querySelector('[data-open-user-reviews]')?.addEventListener('click', () => {
        openReviewsForUser(user.uid).catch((e) => setFeedback('error', t('load_reviews_failed', { message: e?.message || String(e) })));
    });
}

function workSearchText(work) {
    return [
        work.title,
        work.authorName,
        work.authorUid,
        work.workId,
        work.projectId,
        work.releaseId,
        work.dsfStatus
    ].map((value) => String(value || '').toLowerCase()).join(' ');
}

function reviewSearchText(review) {
    return [
        review.body,
        review.readerName,
        review.readerUid,
        review.authorUid,
        review.workId,
        review.projectId,
        review.releaseId,
        review.status
    ].map((value) => String(value || '').toLowerCase()).join(' ');
}

function renderWorksList() {
    const listEl = document.getElementById('admin-work-list');
    const countEl = document.getElementById('admin-work-count');
    if (!listEl || !countEl) return;

    countEl.textContent = t('count_works', { count: state.filteredWorks.length });

    if (!state.filteredWorks.length) {
        listEl.innerHTML = `
            <div class="admin-empty-state">
                <div>
                    <span class="material-icons" aria-hidden="true">search_off</span>
                    <p>${escapeHtml(t('empty_no_work_match'))}</p>
                </div>
            </div>
        `;
        return;
    }

    listEl.innerHTML = state.filteredWorks.map((work) => `
        <button type="button" class="admin-user-item ${work.workId === state.selectedWorkId ? 'is-active' : ''}" data-work-id="${escapeHtml(work.workId)}" role="listitem">
            <div class="admin-work-row">
                ${work.thumbnail ? `<img class="admin-work-thumb" src="${escapeHtml(work.thumbnail)}" alt="">` : `<span class="admin-work-thumb is-empty material-icons" aria-hidden="true">auto_stories</span>`}
                <div class="admin-work-copy">
                    <p class="admin-user-name">${escapeHtml(work.title || 'Untitled')}</p>
                    <p class="admin-user-email">${escapeHtml(work.authorName || userLabel(work.authorUid))}</p>
                    <p class="admin-user-meta">${escapeHtml(work.workId || work.id || '')}</p>
                </div>
                <div class="admin-pill-row">
                    <span class="admin-pill">${escapeHtml(work.dsfStatus || 'public')}</span>
                    <span class="admin-pill">${escapeHtml(formatDate(work.updatedAt))}</span>
                </div>
            </div>
        </button>
    `).join('');

    listEl.querySelectorAll('[data-work-id]').forEach((button) => {
        button.addEventListener('click', () => {
            state.selectedWorkId = button.dataset.workId;
            renderWorksList();
            renderWorkDetail();
        });
    });
}

function renderWorkDetail() {
    const detailEl = document.getElementById('admin-work-detail');
    if (!detailEl) return;
    const work = state.filteredWorks.find((entry) => entry.workId === state.selectedWorkId)
        || state.works.find((entry) => entry.workId === state.selectedWorkId);
    if (!work) {
        detailEl.innerHTML = `
            <div class="admin-empty-state">
                <div>
                    <span class="material-icons" aria-hidden="true">auto_stories</span>
                    <p>${escapeHtml(t('empty_select_work'))}</p>
                </div>
            </div>
        `;
        return;
    }
    const viewerUrl = `/viewer.html?work=${encodeURIComponent(work.workId || '')}`;
    const publicSnapshotPages = Array.isArray(work.dsfPages) ? work.dsfPages.length : 0;
    const canSyncSnapshot = canSyncPublicSnapshot() && !!work.authorUid && !!work.workId && !!work.releaseId;

    detailEl.innerHTML = `
        <div class="admin-detail-header">
            <div>
                <p class="admin-detail-name">${escapeHtml(work.title || 'Untitled')}</p>
                <p class="admin-detail-email">${escapeHtml(work.authorName || userLabel(work.authorUid))}</p>
            </div>
            <div class="admin-pill-row">
                <span class="admin-pill">${escapeHtml(work.dsfStatus || 'public')}</span>
                <span class="admin-pill">${escapeHtml(`${Number(work.pageCount || 0)} pages`)}</span>
            </div>
        </div>
        <div class="admin-detail-grid">
            <div class="admin-detail-card">
                <h3>workId</h3>
                <p>${escapeHtml(work.workId || '—')}</p>
            </div>
            <div class="admin-detail-card">
                <h3>projectId</h3>
                <p>${escapeHtml(work.projectId || '—')}</p>
            </div>
            <div class="admin-detail-card">
                <h3>releaseId</h3>
                <p>${escapeHtml(work.releaseId || '—')}</p>
            </div>
            <div class="admin-detail-card">
                <h3>${escapeHtml(t('detail_updated_at'))}</h3>
                <p>${escapeHtml(formatDate(work.updatedAt))}</p>
            </div>
        </div>
        <div class="admin-detail-section">
            <h3>${escapeHtml(t('detail_author'))}</h3>
            <div class="admin-detail-card">
                <p>${escapeHtml(userLabel(work.authorUid))}</p>
                <p class="admin-user-meta">${escapeHtml(work.authorUid || '—')}</p>
            </div>
        </div>
        <div class="admin-detail-section">
            <h3>${escapeHtml(t('detail_publication'))}</h3>
            <div class="admin-detail-grid">
                <div class="admin-detail-card">
                    <h3>listedFrom</h3>
                    <p>${escapeHtml(formatDate(work.publication?.listedFrom))}</p>
                </div>
                <div class="admin-detail-card">
                    <h3>listedUntil</h3>
                    <p>${escapeHtml(formatDate(work.publication?.listedUntil))}</p>
                </div>
                <div class="admin-detail-card">
                    <h3>publicFrom</h3>
                    <p>${escapeHtml(formatDate(work.publication?.publicFrom))}</p>
                </div>
                <div class="admin-detail-card">
                    <h3>publicUntil</h3>
                    <p>${escapeHtml(formatDate(work.publication?.publicUntil))}</p>
                </div>
            </div>
        </div>
        <div class="admin-detail-section">
            <h3>${escapeHtml(t('detail_delivery'))}</h3>
            <div class="admin-detail-grid">
                <div class="admin-detail-card">
                    <h3>${escapeHtml(t('delivery_public_snapshot'))}</h3>
                    <p>${escapeHtml(publicSnapshotPages > 0 ? `${t('delivery_available')} / ${publicSnapshotPages} pages` : t('delivery_missing'))}</p>
                </div>
                <div class="admin-detail-card">
                    <h3>${escapeHtml(t('delivery_release_snapshot'))}</h3>
                    <p>${escapeHtml(work.releaseId ? t('delivery_available') : t('delivery_missing'))}</p>
                </div>
            </div>
        </div>
        <div class="admin-detail-section">
            <h3>${escapeHtml(t('detail_actions'))}</h3>
            <div class="admin-action-row">
                <a class="admin-status-action admin-action-link" href="${escapeHtml(viewerUrl)}" target="_blank" rel="noopener">${escapeHtml(t('action_open_viewer'))}</a>
                <button type="button"
                    class="admin-status-action ${publicSnapshotPages > 0 ? 'is-safe' : 'is-warning'}"
                    data-sync-work-snapshot="${escapeHtml(work.workId || '')}"
                    ${canSyncSnapshot ? '' : 'disabled'}
                    title="${escapeHtml(canSyncPublicSnapshot() ? '' : t('sync_snapshot_not_allowed'))}">
                    ${escapeHtml(t('action_sync_snapshot'))}
                </button>
                <button type="button" class="admin-status-action" data-open-work-reviews="${escapeHtml(work.workId)}">${escapeHtml(t('action_open_reviews'))}</button>
                <button type="button" class="admin-status-action" data-open-work-user="${escapeHtml(work.authorUid || '')}">${escapeHtml(t('action_open_user'))}</button>
            </div>
        </div>
    `;

    detailEl.querySelector('[data-open-work-reviews]')?.addEventListener('click', () => {
        openReviewsForWork(work.workId).catch((e) => setFeedback('error', t('load_reviews_failed', { message: e?.message || String(e) })));
    });
    detailEl.querySelector('[data-open-work-user]')?.addEventListener('click', () => openUser(work.authorUid));
    detailEl.querySelector('[data-sync-work-snapshot]')?.addEventListener('click', () => {
        syncPublicWorkSnapshot(work.workId).catch((e) => {
            setFeedback('error', t('sync_snapshot_failed', { message: e?.message || String(e) }));
        });
    });
}

function renderReviewsList() {
    const listEl = document.getElementById('admin-review-list');
    const countEl = document.getElementById('admin-review-count');
    if (!listEl || !countEl) return;

    countEl.textContent = t('count_reviews', { count: state.filteredReviews.length });

    if (!state.filteredReviews.length) {
        listEl.innerHTML = `
            <div class="admin-empty-state">
                <div>
                    <span class="material-icons" aria-hidden="true">search_off</span>
                    <p>${escapeHtml(t('empty_no_review_match'))}</p>
                </div>
            </div>
        `;
        return;
    }

    listEl.innerHTML = state.filteredReviews.map((review) => `
        <button type="button" class="admin-user-item ${review.key === state.selectedReviewId ? 'is-active' : ''}" data-review-key="${escapeHtml(review.key)}" role="listitem">
            <div class="admin-user-row">
                <div>
                    <p class="admin-user-name">${escapeHtml(review.readerName || userLabel(review.readerUid))}</p>
                    <p class="admin-user-email">${escapeHtml(compactText(review.body, 96) || '—')}</p>
                    <p class="admin-user-meta">${escapeHtml(review.workId || '')} / ${escapeHtml(formatDate(review.createdAt))}</p>
                </div>
                <div class="admin-pill-row">
                    <span class="admin-pill">${escapeHtml(review.status || 'published')}</span>
                    <span class="admin-pill">good ${escapeHtml(String(review.goodCount || 0))}</span>
                    <span class="admin-pill">bad ${escapeHtml(String(review.badCount || 0))}</span>
                </div>
            </div>
        </button>
    `).join('');

    listEl.querySelectorAll('[data-review-key]').forEach((button) => {
        button.addEventListener('click', () => {
            state.selectedReviewId = button.dataset.reviewKey;
            renderReviewsList();
            renderReviewDetail();
        });
    });
}

function renderReviewDetail() {
    const detailEl = document.getElementById('admin-review-detail');
    if (!detailEl) return;
    const review = state.filteredReviews.find((entry) => entry.key === state.selectedReviewId)
        || state.reviews.find((entry) => entry.key === state.selectedReviewId);
    if (!review) {
        detailEl.innerHTML = `
            <div class="admin-empty-state">
                <div>
                    <span class="material-icons" aria-hidden="true">rate_review</span>
                    <p>${escapeHtml(t('empty_select_review'))}</p>
                </div>
            </div>
        `;
        return;
    }

    detailEl.innerHTML = `
        <div class="admin-detail-header">
            <div>
                <p class="admin-detail-name">${escapeHtml(review.readerName || userLabel(review.readerUid))}</p>
                <p class="admin-detail-email">${escapeHtml(review.workId || '—')}</p>
            </div>
            <div class="admin-pill-row">
                <span class="admin-pill">${escapeHtml(review.status || 'published')}</span>
            </div>
        </div>
        <div class="admin-detail-section">
            <h3>${escapeHtml(t('detail_body'))}</h3>
            <div class="admin-review-body">${escapeHtml(review.body || '—')}</div>
        </div>
        <div class="admin-detail-grid">
            <div class="admin-detail-card">
                <h3>reviewId</h3>
                <p>${escapeHtml(review.reviewId || '—')}</p>
            </div>
            <div class="admin-detail-card">
                <h3>workId</h3>
                <p>${escapeHtml(review.workId || '—')}</p>
            </div>
            <div class="admin-detail-card">
                <h3>${escapeHtml(t('detail_created_at'))}</h3>
                <p>${escapeHtml(formatDate(review.createdAt))}</p>
            </div>
            <div class="admin-detail-card">
                <h3>${escapeHtml(t('detail_updated_at'))}</h3>
                <p>${escapeHtml(formatDate(review.updatedAt))}</p>
            </div>
            <div class="admin-detail-card">
                <h3>${escapeHtml(t('detail_reader'))}</h3>
                <p>${escapeHtml(userLabel(review.readerUid))}</p>
            </div>
            <div class="admin-detail-card">
                <h3>${escapeHtml(t('detail_author'))}</h3>
                <p>${escapeHtml(userLabel(review.authorUid))}</p>
            </div>
            <div class="admin-detail-card">
                <h3>${escapeHtml(t('detail_reactions'))}</h3>
                <p>good ${escapeHtml(String(review.goodCount || 0))} / bad ${escapeHtml(String(review.badCount || 0))}</p>
            </div>
        </div>
        <div class="admin-detail-section">
            <h3>${escapeHtml(t('review_status_title'))}</h3>
            <div class="admin-action-row">
                ${['published', 'hidden', 'removed'].map((status) => `
                    <button type="button"
                        class="admin-status-action ${status === 'published' ? 'is-safe' : (status === 'removed' ? 'is-danger' : 'is-warning')}"
                        data-review-status="${escapeHtml(status)}"
                        ${status === review.status ? 'disabled' : ''}>
                        ${escapeHtml(t(`review_status_${status}`))}
                    </button>
                `).join('')}
            </div>
        </div>
        <div class="admin-detail-section">
            <h3>${escapeHtml(t('detail_actions'))}</h3>
            <div class="admin-action-row">
                <button type="button" class="admin-status-action" data-open-review-work="${escapeHtml(review.workId || '')}">${escapeHtml(t('action_open_work'))}</button>
                <button type="button" class="admin-status-action" data-open-review-reader="${escapeHtml(review.readerUid || '')}">${escapeHtml(t('action_open_user'))}</button>
                <button type="button" class="admin-status-action" data-open-review-author="${escapeHtml(review.authorUid || '')}">${escapeHtml(t('detail_author'))}</button>
            </div>
        </div>
    `;

    detailEl.querySelectorAll('[data-review-status]').forEach((button) => {
        button.addEventListener('click', () => {
            updateReviewStatus(review.workId, review.reviewId, button.dataset.reviewStatus).catch((e) => {
                setFeedback('error', t('review_status_failed', { message: e?.message || String(e) }));
            });
        });
    });
    detailEl.querySelector('[data-open-review-work]')?.addEventListener('click', () => {
        openWork(review.workId).catch((e) => setFeedback('error', t('load_works_failed', { message: e?.message || String(e) })));
    });
    detailEl.querySelector('[data-open-review-reader]')?.addEventListener('click', () => openUser(review.readerUid));
    detailEl.querySelector('[data-open-review-author]')?.addEventListener('click', () => openUser(review.authorUid));
}

function applyAdminStaticI18n() {
    document.documentElement.lang = adminUiLang === 'en' ? 'en' : 'ja';
    document.querySelectorAll('[data-admin-i18n]').forEach((el) => {
        const key = el.dataset.adminI18n;
        el.textContent = t(key);
    });
    const search = document.getElementById('admin-user-search');
    if (search) search.placeholder = t('search_placeholder');
    const workSearch = document.getElementById('admin-work-search');
    if (workSearch) workSearch.placeholder = t('search_works_placeholder');
    const reviewSearch = document.getElementById('admin-review-search');
    if (reviewSearch) reviewSearch.placeholder = t('search_reviews_placeholder');
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
    setAdminSection(state.activeSection, { skipLoad: true });
    const roleBadge = document.getElementById('admin-role-badge');
    if (roleBadge && !state.viewerRole) roleBadge.textContent = t('role_staff');
    if (state.viewerRole || state.users.length) {
        renderUserList();
        renderUserDetail();
        renderWorksList();
        renderWorkDetail();
        renderReviewsList();
        renderReviewDetail();
    }
}

window.setAdminUiLang = (lang) => {
    if (!ADMIN_UI[lang]) return;
    adminUiLang = lang;
    localStorage.setItem(ADMIN_UI_LANG_KEY, lang);
    rerenderAdminUi();
};

function setAdminSection(section, options = {}) {
    const nextSection = ['users', 'works', 'reviews'].includes(section) ? section : 'users';
    state.activeSection = nextSection;
    document.querySelectorAll('.admin-nav-link').forEach((button) => {
        button.classList.toggle('is-active', button.dataset.section === nextSection);
    });
    document.querySelectorAll('.admin-content').forEach((content) => {
        content.hidden = content.id !== `admin-${nextSection}-view`;
    });
    const title = document.querySelector('.admin-title');
    if (title) title.textContent = t(`title_${nextSection}`);

    if (options.skipLoad) return;
    if (nextSection === 'works' && !state.works.length) {
        loadWorks().catch((e) => setFeedback('error', t('load_works_failed', { message: e?.message || String(e) })));
    }
    if (nextSection === 'reviews' && !state.reviews.length) {
        loadReviews().catch((e) => setFeedback('error', t('load_reviews_failed', { message: e?.message || String(e) })));
    }
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

function applyWorkSearch() {
    const input = document.getElementById('admin-work-search');
    const q = String(input?.value || '').trim().toLowerCase();
    state.filteredWorks = q
        ? state.works.filter((work) => workSearchText(work).includes(q))
        : [...state.works];

    if (!state.filteredWorks.some((entry) => entry.workId === state.selectedWorkId)) {
        state.selectedWorkId = state.filteredWorks[0]?.workId || null;
    }

    renderWorksList();
    renderWorkDetail();
}

function applyReviewSearch() {
    const input = document.getElementById('admin-review-search');
    const q = String(input?.value || '').trim().toLowerCase();
    state.filteredReviews = q
        ? state.reviews.filter((review) => reviewSearchText(review).includes(q))
        : [...state.reviews];

    if (!state.filteredReviews.some((entry) => entry.key === state.selectedReviewId)) {
        state.selectedReviewId = state.filteredReviews[0]?.key || null;
    }

    renderReviewsList();
    renderReviewDetail();
}

async function loadUsers() {
    const snapshot = await getDocs(query(collection(db, 'users'), orderBy('lastLoginAt', 'desc'), limit(200)));
    state.users = snapshot.docs.map((docSnap) => ({ uid: docSnap.id, ...docSnap.data() }));
    state.filteredUsers = [...state.users];
    state.selectedUid = state.filteredUsers[0]?.uid || null;
    applySearch();
}

async function loadWorks() {
    const snapshot = await getDocs(query(collection(db, 'public_projects'), orderBy('updatedAt', 'desc'), limit(200)));
    state.works = snapshot.docs
        .map((docSnap) => ({
            id: docSnap.id,
            workId: docSnap.data()?.workId || docSnap.id,
            ...docSnap.data()
        }))
        .sort((a, b) => dateMillis(b.updatedAt) - dateMillis(a.updatedAt));
    state.filteredWorks = [...state.works];
    state.selectedWorkId = state.filteredWorks[0]?.workId || null;
    applyWorkSearch();
}

async function loadReviews() {
    if (!state.works.length) await loadWorks();
    const workIds = [...new Set(state.works.map((work) => work.workId).filter(Boolean))].slice(0, 200);
    const reviewGroups = await Promise.all(workIds.map(async (workId) => {
        try {
            const snapshot = await getDocs(query(collection(db, 'reviews', workId, 'items'), limit(50)));
            return snapshot.docs.map((docSnap) => {
                const data = docSnap.data() || {};
                const reviewId = data.reviewId || docSnap.id;
                return {
                    key: `${workId}/${reviewId}`,
                    reviewId,
                    workId,
                    ...data
                };
            });
        } catch (error) {
            console.warn('[admin] review load skipped:', workId, error);
            return [];
        }
    }));
    state.reviews = reviewGroups.flat()
        .sort((a, b) => dateMillis(b.createdAt) - dateMillis(a.createdAt));
    state.filteredReviews = [...state.reviews];
    state.selectedReviewId = state.filteredReviews[0]?.key || null;
    applyReviewSearch();
}

async function updateUserStatus(uid, field, value) {
    if (!uid || (field !== 'disabled' && field !== 'moderationHold')) return;
    if (field === 'disabled' && !canManageDisabled()) return;
    if (field === 'moderationHold' && !canManageModerationHold()) return;

    const confirmKey = field === 'disabled'
        ? (value ? 'confirm_disable' : 'confirm_enable')
        : (value ? 'confirm_hold' : 'confirm_release_hold');
    if (!window.confirm(t(confirmKey))) return;

    const user = state.users.find((entry) => entry.uid === uid);
    if (!user) return;
    const nextStatus = {
        disabled: !!user.status?.disabled,
        moderationHold: !!user.status?.moderationHold,
        [field]: value
    };

    await updateDoc(doc(db, 'users', uid), { status: nextStatus });
    state.users = state.users.map((entry) => entry.uid === uid
        ? { ...entry, status: nextStatus }
        : entry);
    applySearch();
    setFeedback('info', t('update_success'));
}

async function updateUserPlan(uid, rawTier, rawStatus) {
    if (!uid || !canManagePlan()) return;
    const tier = normalizeManualPlanTier(rawTier);
    const status = normalizeManualPlanStatus(rawStatus);
    const effectiveTier = effectiveTierForManualPlan(tier, status);
    if (!window.confirm(t('manual_plan_confirm', {
        tier: tier.toUpperCase(),
        status
    }))) return;

    const user = state.users.find((entry) => entry.uid === uid);
    if (!user) return;
    const nextPlan = {
        ...(user.plan || {}),
        tier,
        effectiveTier,
        status,
        provider: 'manual',
        trialEndsAt: user.plan?.trialEndsAt ?? null,
        currentPeriodStart: user.plan?.currentPeriodStart ?? null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        canceledAt: status === 'canceled' ? new Date() : null,
        updatedAt: serverTimestamp()
    };
    const nextEntitlements = {
        ...(user.entitlements || {}),
        ...entitlementsForManualPlan(effectiveTier)
    };

    await updateDoc(doc(db, 'users', uid), {
        plan: nextPlan,
        entitlements: nextEntitlements
    });

    state.users = state.users.map((entry) => entry.uid === uid
        ? {
            ...entry,
            plan: {
                ...nextPlan,
                updatedAt: new Date()
            },
            entitlements: nextEntitlements
        }
        : entry);
    applySearch();
    setFeedback('info', t('manual_plan_success'));
}

async function updateReviewStatus(workId, reviewId, status) {
    if (!workId || !reviewId || !['published', 'hidden', 'removed'].includes(status)) return;
    if (!canManageModerationHold()) return;
    if (!window.confirm(t('review_status_confirm', { status }))) return;

    await updateDoc(doc(db, 'reviews', workId, 'items', reviewId), {
        status,
        updatedAt: serverTimestamp()
    });
    const updateLocal = (review) => review.workId === workId && review.reviewId === reviewId
        ? { ...review, status, updatedAt: new Date() }
        : review;
    state.reviews = state.reviews.map(updateLocal);
    state.filteredReviews = state.filteredReviews.map(updateLocal);
    renderReviewsList();
    renderReviewDetail();
    setFeedback('info', t('review_status_success'));
}

function buildPublicSnapshotPayload(work, releaseData) {
    const dsfPages = Array.isArray(releaseData.dsfPages) ? releaseData.dsfPages : [];
    return {
        title: work.title || releaseData.title || 'Untitled',
        projectId: work.projectId || releaseData.projectId || '',
        workId: work.workId || releaseData.workId || '',
        releaseId: work.releaseId || releaseData.releaseId || '',
        authorUid: work.authorUid || releaseData.authorUid || '',
        authorName: work.authorName || '',
        thumbnail: work.thumbnail || null,
        updatedAt: serverTimestamp(),
        dsfStatus: work.dsfStatus || 'public',
        publication: work.publication || releaseData.publication || null,
        dsfPages,
        dsfLangs: Array.isArray(releaseData.dsfLangs) ? releaseData.dsfLangs : (Array.isArray(work.dsfLangs) ? work.dsfLangs : []),
        pageCount: dsfPages.length,
        dsfPageCount: releaseData.dsfPageCount || dsfPages.length,
        dsfPublishedAt: releaseData.dsfPublishedAt || null,
        dsfRenderStamp: releaseData.dsfRenderStamp || null,
        dsfResolution: releaseData.dsfResolution || work.dsfResolution || '',
        dsfQuality: releaseData.dsfQuality || work.dsfQuality || null,
        dsfQualityMode: releaseData.dsfQualityMode || '',
        dsfQualityProfile: releaseData.dsfQualityProfile || null,
        dsfTotalBytes: releaseData.dsfTotalBytes || work.dsfTotalBytes || 0,
        book: releaseData.book || null,
        bookMode: releaseData.bookMode || releaseData.book?.mode || 'simple',
        languageConfigs: releaseData.languageConfigs || {},
        languages: Array.isArray(releaseData.languages) ? releaseData.languages : (Array.isArray(releaseData.dsfLangs) ? releaseData.dsfLangs : ['ja']),
        defaultLang: releaseData.defaultLang || releaseData.languages?.[0] || releaseData.dsfLangs?.[0] || 'ja',
        labelName: releaseData.labelName || '',
        rating: releaseData.rating || 'all',
        license: releaseData.license || 'all-rights-reserved',
        meta: releaseData.meta || {}
    };
}

async function syncPublicWorkSnapshot(workId) {
    if (!workId || !canSyncPublicSnapshot()) return;
    const work = state.works.find((entry) => entry.workId === workId);
    if (!work) return;
    if (work.authoringBackend === 'r2-private') throw new Error(t('sync_snapshot_private_authoring'));
    if (!work.authorUid || !work.releaseId) throw new Error(t('sync_snapshot_missing_release'));
    if (!window.confirm(t('sync_snapshot_confirm'))) return;

    const releaseRef = doc(db, 'users', work.authorUid, 'works', work.workId, 'releases', work.releaseId);
    const releaseSnap = await getDoc(releaseRef);
    if (!releaseSnap.exists()) throw new Error(t('sync_snapshot_missing_release'));
    const releaseData = releaseSnap.data() || {};
    if (!Array.isArray(releaseData.dsfPages) || releaseData.dsfPages.length === 0) {
        throw new Error(t('sync_snapshot_empty_release'));
    }

    const payload = buildPublicSnapshotPayload(work, releaseData);
    await setDoc(doc(db, 'public_projects', work.workId), payload, { merge: true });
    const localPayload = {
        ...payload,
        id: work.id || work.workId,
        updatedAt: new Date()
    };
    state.works = state.works.map((entry) => entry.workId === work.workId
        ? { ...entry, ...localPayload }
        : entry);
    applyWorkSearch();
    setFeedback('info', t('sync_snapshot_success'));
}

function openUser(uid) {
    if (!uid) return;
    setAdminSection('users', { skipLoad: true });
    const input = document.getElementById('admin-user-search');
    if (input) input.value = uid;
    state.selectedUid = uid;
    applySearch();
}

async function openWork(workId) {
    if (!workId) return;
    if (!state.works.length) await loadWorks();
    setAdminSection('works', { skipLoad: true });
    const input = document.getElementById('admin-work-search');
    if (input) input.value = workId;
    state.selectedWorkId = workId;
    applyWorkSearch();
}

async function openWorksForUser(uid) {
    if (!uid) return;
    if (!state.works.length) await loadWorks();
    setAdminSection('works', { skipLoad: true });
    const input = document.getElementById('admin-work-search');
    if (input) input.value = uid;
    applyWorkSearch();
}

async function openReviewsForUser(uid) {
    if (!uid) return;
    if (!state.reviews.length) await loadReviews();
    setAdminSection('reviews', { skipLoad: true });
    const input = document.getElementById('admin-review-search');
    if (input) input.value = uid;
    applyReviewSearch();
}

async function openReviewsForWork(workId) {
    if (!workId) return;
    if (!state.reviews.length) await loadReviews();
    setAdminSection('reviews', { skipLoad: true });
    const input = document.getElementById('admin-review-search');
    if (input) input.value = workId;
    applyReviewSearch();
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
    setAdminSection(state.activeSection, { skipLoad: true });
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

    document.querySelectorAll('.admin-nav-link').forEach((button) => {
        button.addEventListener('click', () => setAdminSection(button.dataset.section));
    });
    document.getElementById('admin-user-search')?.addEventListener('input', applySearch);
    document.getElementById('admin-work-search')?.addEventListener('input', applyWorkSearch);
    document.getElementById('admin-review-search')?.addEventListener('input', applyReviewSearch);

    onAuthStateChanged(auth, async (user) => {
        try {
            if (!user) {
                state.viewerRole = null;
                state.users = [];
                state.filteredUsers = [];
                state.selectedUid = null;
                state.works = [];
                state.filteredWorks = [];
                state.selectedWorkId = null;
                state.reviews = [];
                state.filteredReviews = [];
                state.selectedReviewId = null;
                state.activeSection = 'users';
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
