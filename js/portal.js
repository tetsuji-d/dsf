/**
 * portal.js — DSF Portal (index.html) のロジック
 * i18n対応: UI言語 + コンテンツ言語の切り替え
 */
import { collection, query, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { db, auth } from './firebase-core.js';
import { ensureUserBootstrap } from './firebase.js';
import { initGIS, renderGISButton, signInWithGoogle, handleRedirectResult, signOutUser } from './gis-auth.js';
import { applyTheme, bindThemePreferenceListener, getThemeMode, setThemeMode as persistThemeMode } from './theme.js';

const DEFAULT_THUMB_URL = "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=400&auto=format&fit=crop";
const FETCH_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 120;
const LANG_STORAGE_KEY = "dsf_portal_lang";
const SUPPORTED_LANGS = ["ja", "en"];

// ---- i18n ----------------------------------------------------------------

const STRINGS = {
    ja: {
        horizonBrand:    "DSF Horizon",
        libraryName:     "Horizon",
        libraryHomeTitle:"情報の広がりは、地平線を超えていく。",
        libraryHomeDesc: "公開作品を探し、気になる作品をすぐ開ける Reader 向けホームです。",
        createMenu:      "作成",
        drawerHome:      "ホーム",
        drawerHistory:   "履歴",
        drawerCategories:"コンテンツカテゴリ",
        drawerOffline:   "オフライン",
        sectionTitle:    "最新・注目作品",
        searchLabel:     "作品を検索",
        searchPlaceholder: "作品タイトル・作者名で検索",
        studioBtn:       "Studioを起動",
        navProjects:     "プロジェクト",
        navEditor:       "エディター",
        navPress:        "プレスルーム",
        navWorks:        "ワークス",
        signinBtn:       "サインイン",
        signoutBtn:      "サインアウト",
        authError:       "認証エラー",
        uiLabel:         "UI",
        themeLabel:      "表示モード",
        modeDevice:      "デバイス",
        modeLight:       "ライト",
        modeDark:        "ダーク",
        restrictedMode:  "制限付きモード",
        location:        "言語・地域",
        settings:        "設定",
        help:            "ヘルプ",
        feedback:        "フィードバック",
        loading:         "作品を読み込み中...",
        loadError:       "作品リストの読み込みに失敗しました。",
        loadErrorDesc:   "時間をおいて再試行してください。",
        retry:           "再試行",
        noProjects:      "公開作品はまだありません",
        noProjectsDesc:  "最初の作品を公開してギャラリーを始めましょう。",
        launchStudio:    "Studioを起動",
        noResults:       "検索結果が見つかりません",
        noResultsDesc:   "キーワードを変えて再検索してください。",
        unavailableBadge: "公開準備中",
        untitled:        "無題のプロジェクト",
        anonymous:       "名無し",
        showingCount:    (n) => `${n}件を表示中`,
        unavailableNote: (base, n) => `${base}（${n}件は公開準備中）`,
    },
    en: {
        horizonBrand:    "DSF Horizon",
        libraryName:     "Horizon",
        libraryHomeTitle:"Where the information spreads beyond the line.",
        libraryHomeDesc: "Browse public works and open them in moments—a reader-first home.",
        createMenu:      "Create",
        drawerHome:      "Home",
        drawerHistory:   "History",
        drawerCategories:"Categories",
        drawerOffline:   "Offline",
        sectionTitle:    "Latest & Featured",
        searchLabel:     "Search works",
        searchPlaceholder: "Search by title or author",
        studioBtn:       "Launch Studio",
        navProjects:     "Projects",
        navEditor:       "Editor",
        navPress:        "Press",
        navWorks:        "Works",
        signinBtn:       "Sign in",
        signoutBtn:      "Sign out",
        authError:       "Authentication error",
        uiLabel:         "UI",
        themeLabel:      "Theme",
        modeDevice:      "Device",
        modeLight:       "Light",
        modeDark:        "Dark",
        restrictedMode:  "Restricted Mode",
        location:        "Language & Region",
        settings:        "Settings",
        help:            "Help",
        feedback:        "Feedback",
        loading:         "Loading works...",
        loadError:       "Failed to load works.",
        loadErrorDesc:   "Please try again later.",
        retry:           "Retry",
        noProjects:      "No public works yet",
        noProjectsDesc:  "Publish your first work to start the gallery.",
        launchStudio:    "Launch Studio",
        noResults:       "No results found",
        noResultsDesc:   "Try searching with different keywords.",
        unavailableBadge: "Coming soon",
        untitled:        "Untitled Project",
        anonymous:       "Anonymous",
        showingCount:    (n) => `Showing ${n} work${n !== 1 ? "s" : ""}`,
        unavailableNote: (base, n) => `${base} (${n} unavailable)`,
    },
};

let currentLang = (() => {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (saved && SUPPORTED_LANGS.includes(saved)) return saved;
    const browser = navigator.language?.slice(0, 2).toLowerCase();
    return SUPPORTED_LANGS.includes(browser) ? browser : "ja";
})();

function t(key) {
    return STRINGS[currentLang]?.[key] ?? STRINGS.ja[key] ?? key;
}

/** 多言語フィールド取得: { ja:"...", en:"..." } または文字列、フォールバックあり */
function localize(value, fallback = "") {
    if (!value) return fallback;
    if (typeof value === "string") return value || fallback;
    if (value[currentLang]) return value[currentLang];
    // フォールバック: 他の言語で最初に見つかったもの
    const first = Object.values(value).find((v) => v && typeof v === "string");
    return first || fallback;
}

function applyI18n() {
    // data-i18n: textContent
    document.querySelectorAll("[data-i18n]").forEach((el) => {
        const key = el.dataset.i18n;
        el.textContent = t(key);
    });
    // data-i18n-placeholder: placeholder属性
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
        const key = el.dataset.i18nPlaceholder;
        el.placeholder = t(key);
    });
    // html[lang]
    document.documentElement.lang = currentLang;
}

function updateLangSwitcher() {
    document.querySelectorAll(".js-lang-switcher .lang-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.lang === currentLang);
    });
}

function updateThemeSwitcher() {
    document.querySelectorAll(".js-theme-switcher .theme-mode-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.themeMode === getThemeMode());
    });
}

// ---- State ---------------------------------------------------------------

const portalState = {
    isLoading: false,
    hasError: false,
    query: "",
    projects: [],
};

let searchDebounceTimer = null;

// ---- Utilities -----------------------------------------------------------

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function getOptimizedThumbUrl(url) {
    return (url && typeof url === "string") ? url : DEFAULT_THUMB_URL;
}

function formatDate(publishedAt) {
    if (!publishedAt) return "";
    const d = typeof publishedAt.toDate === "function"
        ? publishedAt.toDate()
        : (publishedAt instanceof Date ? publishedAt : null);
    if (!d || isNaN(d.getTime())) return "";
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}/${mm}/${dd}`;
}

function buildViewerUrl(workId, authorUid) {
    void authorUid;
    return `/viewer.html?work=${encodeURIComponent(workId)}`;
}

// ---- Rendering -----------------------------------------------------------

function setStatus(text) {
    const el = document.getElementById("feed-status");
    if (el) el.textContent = text || "";
}

function clearFeedback() {
    const el = document.getElementById("portal-feedback");
    if (el) { el.className = "portal-feedback"; el.innerHTML = ""; }
}

function showFeedback(type, title, description = "", withRetry = false) {
    const el = document.getElementById("portal-feedback");
    if (!el) return;
    el.className = `portal-feedback is-${type}`;
    el.innerHTML = `
        <div class="portal-feedback-box" role="status">
            <p class="portal-feedback-title">${escapeHtml(title)}</p>
            ${description ? `<p class="portal-feedback-desc">${escapeHtml(description)}</p>` : ""}
            ${withRetry ? `<button type="button" class="portal-retry-btn" data-action="retry-load">${escapeHtml(t("retry"))}</button>` : ""}
        </div>
    `;
}

function renderLoadingSkeleton(count = 6) {
    const el = document.getElementById("public-feed");
    if (!el) return;
    el.innerHTML = Array.from({ length: count }, () => `
        <article class="project-card card-skeleton" aria-hidden="true">
            <div class="card-thumb-container"></div>
            <div class="card-info">
                <div class="card-skeleton-line w-80"></div>
                <div class="card-skeleton-line w-50"></div>
                <div class="card-skeleton-line w-30"></div>
            </div>
        </article>
    `).join("");
}

function cardMarkup(project) {
    // コンテンツを現在の言語でローカライズ
    const title      = escapeHtml(localize(project.titleRaw, t("untitled")));
    const authorName = escapeHtml(localize(project.authorNameRaw, t("anonymous")));
    const thumb      = escapeHtml(getOptimizedThumbUrl(project.thumbnail));
    const date       = escapeHtml(project.publishedDate);

    const body = `
        <div class="card-thumb-container">
            <img src="${thumb}" class="card-thumb" alt="${title}" loading="lazy"
                onerror="this.src='${DEFAULT_THUMB_URL}'">
            ${project.canOpen ? "" : `<span class="card-badge">${escapeHtml(t("unavailableBadge"))}</span>`}
        </div>
        <div class="card-info">
            <div class="card-title">${title}</div>
            <div class="card-author">${authorName}</div>
            <div class="card-meta">${date}</div>
        </div>
    `;

    if (project.canOpen) {
        const href = escapeHtml(buildViewerUrl(project.workId || project.id, project.authorUid));
        return `<a href="${href}" class="project-card" data-role="project-card">${body}</a>`;
    }
    return `<article class="project-card is-disabled" aria-disabled="true">${body}</article>`;
}

function renderEmptyState(title, description, ctaLabel = "", ctaHref = "") {
    const el = document.getElementById("public-feed");
    if (!el) return;
    el.innerHTML = `
        <section class="portal-empty" role="status">
            <p class="portal-empty-icon" aria-hidden="true">🌱</p>
            <h3 class="portal-empty-title">${escapeHtml(title)}</h3>
            <p class="portal-empty-desc">${escapeHtml(description)}</p>
            ${ctaLabel && ctaHref ? `<a href="${escapeHtml(ctaHref)}" class="btn-empty-action">${escapeHtml(ctaLabel)}</a>` : ""}
        </section>
    `;
}

function getFilteredProjects() {
    const q = portalState.query.trim().toLowerCase();
    if (!q) return portalState.projects;
    return portalState.projects.filter((p) => {
        const title  = localize(p.titleRaw, "").toLowerCase();
        const author = localize(p.authorNameRaw, "").toLowerCase();
        return title.includes(q) || author.includes(q);
    });
}

function renderProjects() {
    const feedEl = document.getElementById("public-feed");
    if (!feedEl) return;

    if (portalState.isLoading) { renderLoadingSkeleton(); return; }
    if (portalState.hasError) { feedEl.innerHTML = ""; return; }

    if (!portalState.projects.length) {
        setStatus(t("noProjects"));
        renderEmptyState(t("noProjects"), t("noProjectsDesc"), t("launchStudio"), "/studio.html?room=home");
        return;
    }

    const filtered = getFilteredProjects();
    if (!filtered.length) {
        setStatus(t("noResults"));
        renderEmptyState(t("noResults"), t("noResultsDesc"));
        return;
    }

    feedEl.innerHTML = filtered.map(cardMarkup).join("");

    const unavailable = filtered.filter((p) => !p.canOpen).length;
    const base = t("showingCount")(filtered.length);
    setStatus(unavailable > 0 ? t("unavailableNote")(base, unavailable) : base);
}

// ---- Data ----------------------------------------------------------------

function normalizeProject(docSnap) {
    const data = docSnap.data() || {};
    const authorUid = typeof data.authorUid === "string" ? data.authorUid.trim() : "";
    return {
        id:            docSnap.id,
        projectId:     typeof data.projectId === "string" ? data.projectId : "",
        workId:        typeof data.workId === "string" ? data.workId : docSnap.id,
        titleRaw:      data.title ?? "",        // 文字列 or { ja, en } オブジェクト
        authorNameRaw: data.authorName ?? "",   // 文字列 or { ja, en } オブジェクト
        authorUid,
        canOpen:       !!authorUid,
        thumbnail:     typeof data.thumbnail === "string" ? data.thumbnail : DEFAULT_THUMB_URL,
        publishedDate: formatDate(data.updatedAt),
    };
}

async function loadPublicProjects() {
    const feedEl = document.getElementById("public-feed");
    if (!feedEl) return;

    portalState.isLoading = true;
    portalState.hasError = false;
    setStatus(t("loading"));
    clearFeedback();
    renderLoadingSkeleton();

    try {
        const q = query(collection(db, "public_projects"), orderBy("updatedAt", "desc"), limit(FETCH_LIMIT));
        const snap = await getDocs(q);
        portalState.projects = snap.docs
            .filter(d => (d.data().dsfStatus || 'public') === 'public')
            .map(normalizeProject);
        portalState.isLoading = false;
        renderProjects();
    } catch (err) {
        console.error("[Portal] fetch error:", err);
        portalState.projects = [];
        portalState.isLoading = false;
        portalState.hasError = true;
        feedEl.innerHTML = "";
        setStatus(t("loadError"));
        showFeedback("error", t("loadError"), t("loadErrorDesc"), true);
    }
}

// ---- Auth UI -------------------------------------------------------------

function mountPortalGisButton() {
    if (auth.currentUser) return;
    const host = document.getElementById('gis-btn-portal');
    if (!host) return;
    host.innerHTML = '';
    renderGISButton('gis-btn-portal', {
        authInstance: auth,
        buttonOptions: {
            theme: 'outline',
            size: 'large',
            type: 'standard',
            shape: 'rectangular',
            text: 'signin_with',
            logo_alignment: 'left',
        }
    }).catch((err) => console.warn('[Portal] GIS button render failed:', err));
}

function renderAuthArea(user) {
    const authArea = document.getElementById("auth-area");
    if (!authArea) return;
    const currentThemeMode = getThemeMode();
    if (user) {
        const photoUrl   = escapeHtml(user.photoURL || "");
        const displayName = escapeHtml(user.displayName || user.email || "User");
        const initials   = (user.displayName || "U").charAt(0).toUpperCase();
        authArea.innerHTML = `
            <div class="auth-user">
                <button type="button" class="auth-avatar-btn" id="btn-avatar"
                    aria-label="アカウントメニュー" aria-expanded="false">
                    ${photoUrl
                        ? `<img src="${photoUrl}" alt="${displayName}" referrerpolicy="no-referrer">`
                        : `<span class="auth-initials">${escapeHtml(initials)}</span>`}
                </button>
                <div class="auth-dropdown auth-panel" id="auth-dropdown">
                    <div class="auth-dropdown-name">${displayName}</div>
                    <div class="auth-panel-section">
                        <div class="auth-panel-label">${escapeHtml(t("themeLabel"))}</div>
                        <div class="theme-mode-switcher js-theme-switcher" role="group" aria-label="${escapeHtml(t("themeLabel"))}">
                            <button type="button" class="theme-mode-btn ${currentThemeMode === 'device' ? 'active' : ''}" data-theme-mode="device">${escapeHtml(t("modeDevice"))}</button>
                            <button type="button" class="theme-mode-btn ${currentThemeMode === 'light' ? 'active' : ''}" data-theme-mode="light">${escapeHtml(t("modeLight"))}</button>
                            <button type="button" class="theme-mode-btn ${currentThemeMode === 'dark' ? 'active' : ''}" data-theme-mode="dark">${escapeHtml(t("modeDark"))}</button>
                        </div>
                    </div>
                    <div class="auth-panel-links">
                        <button type="button" class="auth-panel-link"><span class="material-icons">visibility_off</span><span>${escapeHtml(t("restrictedMode"))}</span></button>
                        <button type="button" class="auth-panel-link"><span class="material-icons">public</span><span>${escapeHtml(t("location"))}</span></button>
                        <button type="button" class="auth-panel-link"><span class="material-icons">settings</span><span>${escapeHtml(t("settings"))}</span></button>
                        <button type="button" class="auth-panel-link"><span class="material-icons">help_outline</span><span>${escapeHtml(t("help"))}</span></button>
                        <button type="button" class="auth-panel-link"><span class="material-icons">feedback</span><span>${escapeHtml(t("feedback"))}</span></button>
                    </div>
                    <button type="button" class="btn-signout" id="btn-signout">${escapeHtml(t("signoutBtn"))}</button>
                </div>
            </div>
        `;
        const avatarBtn = document.getElementById("btn-avatar");
        const dropdown  = document.getElementById("auth-dropdown");
        avatarBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const isOpen = dropdown.classList.toggle("open");
            avatarBtn.setAttribute("aria-expanded", String(isOpen));
        });
        document.addEventListener("click", () => dropdown.classList.remove("open"));
        document.getElementById("btn-signout").addEventListener("click", async () => {
            try {
                await signOutUser(auth);
            } catch (error) {
                console.error('[Portal] sign-out failed:', error);
                showFeedback("error", t("authError"), error?.message || String(error), true);
            }
        });
        bindThemeSwitcher();
    } else {
        authArea.innerHTML = `
            <div class="auth-user">
                <button type="button" class="auth-avatar-btn" id="btn-avatar" aria-label="${escapeHtml(t('signinBtn'))}" aria-expanded="false">
                    <span class="material-icons" aria-hidden="true">account_circle</span>
                </button>
                <div class="auth-dropdown auth-panel" id="auth-dropdown">
                    <div class="auth-dropdown-name">${escapeHtml(t('signinBtn'))}</div>
                    <div class="auth-panel-section">
                        <div class="auth-panel-label">${escapeHtml(t("themeLabel"))}</div>
                        <div class="theme-mode-switcher js-theme-switcher" role="group" aria-label="${escapeHtml(t("themeLabel"))}">
                            <button type="button" class="theme-mode-btn ${currentThemeMode === 'device' ? 'active' : ''}" data-theme-mode="device">${escapeHtml(t("modeDevice"))}</button>
                            <button type="button" class="theme-mode-btn ${currentThemeMode === 'light' ? 'active' : ''}" data-theme-mode="light">${escapeHtml(t("modeLight"))}</button>
                            <button type="button" class="theme-mode-btn ${currentThemeMode === 'dark' ? 'active' : ''}" data-theme-mode="dark">${escapeHtml(t("modeDark"))}</button>
                        </div>
                    </div>
                    <div class="auth-panel-section">
                        <div id="gis-btn-portal"></div>
                        <button type="button" class="btn-signin-fallback" id="btn-signin-fallback" aria-label="${escapeHtml(t('signinBtn'))}">
                            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/></svg>
                            ${escapeHtml(t('signinBtn'))}
                        </button>
                    </div>
                    <div class="auth-panel-links">
                        <button type="button" class="auth-panel-link"><span class="material-icons">visibility_off</span><span>${escapeHtml(t("restrictedMode"))}</span></button>
                        <button type="button" class="auth-panel-link"><span class="material-icons">public</span><span>${escapeHtml(t("location"))}</span></button>
                        <button type="button" class="auth-panel-link"><span class="material-icons">settings</span><span>${escapeHtml(t("settings"))}</span></button>
                        <button type="button" class="auth-panel-link"><span class="material-icons">help_outline</span><span>${escapeHtml(t("help"))}</span></button>
                        <button type="button" class="auth-panel-link"><span class="material-icons">feedback</span><span>${escapeHtml(t("feedback"))}</span></button>
                    </div>
                </div>
            </div>
        `;
        const avatarBtn = document.getElementById("btn-avatar");
        const dropdown  = document.getElementById("auth-dropdown");
        avatarBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            const isOpen = dropdown.classList.toggle("open");
            avatarBtn.setAttribute("aria-expanded", String(isOpen));
            if (isOpen) {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => mountPortalGisButton());
                });
            }
        });
        document.addEventListener("click", () => dropdown.classList.remove("open"));
        document.getElementById('btn-signin-fallback')?.addEventListener('click', async () => {
            try {
                await signInWithGoogle({ authInstance: auth });
            } catch (error) {
                console.error('[Portal] sign-in failed:', error);
                showFeedback("error", t("authError"), error?.message || String(error), true);
            }
        });
        bindThemeSwitcher();
    }
}

// ---- Language Switcher ---------------------------------------------------

function setLang(lang) {
    if (!SUPPORTED_LANGS.includes(lang) || lang === currentLang) return;
    currentLang = lang;
    localStorage.setItem(LANG_STORAGE_KEY, lang);
    applyI18n();
    updateLangSwitcher();
    renderAuthArea(auth.currentUser); // サインインボタン文言更新
    renderProjects();                 // カード再レンダリング（言語切替）
}

function setThemeMode(mode) {
    if (mode === getThemeMode()) return;
    persistThemeMode(mode);
    updateThemeSwitcher();
}

function bindLangSwitcher() {
    document.querySelectorAll(".js-lang-switcher").forEach((switcher) => switcher.addEventListener("click", (e) => {
        const btn = e.target.closest(".lang-btn");
        if (btn?.dataset.lang) setLang(btn.dataset.lang);
    }));
}

function bindThemeSwitcher() {
    document.querySelectorAll(".js-theme-switcher").forEach((switcher) => switcher.addEventListener("click", (e) => {
        const btn = e.target.closest(".theme-mode-btn");
        if (btn?.dataset.themeMode) setThemeMode(btn.dataset.themeMode);
    }));
}

// ---- Events --------------------------------------------------------------

function bindEvents() {
    const searchInput = document.getElementById("portal-search");
    if (searchInput) {
        searchInput.addEventListener("input", () => {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                portalState.query = searchInput.value || "";
                renderProjects();
            }, SEARCH_DEBOUNCE_MS);
        });
        searchInput.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            searchInput.value = "";
            portalState.query = "";
            renderProjects();
        });
    }

    document.getElementById("portal-feedback")?.addEventListener("click", (e) => {
        if (e.target.closest("[data-action='retry-load']")) loadPublicProjects();
    });

    const scrim = document.getElementById('portal-scrim');
    const drawer = document.getElementById('library-drawer');
    const menuBtn = document.getElementById('btn-library-menu');
    const closeBtn = document.getElementById('btn-library-menu-close');
    const createBtn = document.getElementById('btn-create-menu');
    const createPopover = document.getElementById('create-menu-popover');

    const closeDrawer = () => {
        drawer?.classList.remove('open');
        if (drawer) drawer.setAttribute('aria-hidden', 'true');
        if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
        if (scrim) scrim.hidden = true;
    };

    const openDrawer = () => {
        drawer?.classList.add('open');
        if (drawer) drawer.setAttribute('aria-hidden', 'false');
        if (menuBtn) menuBtn.setAttribute('aria-expanded', 'true');
        if (scrim) scrim.hidden = false;
    };

    menuBtn?.addEventListener('click', () => {
        if (drawer?.classList.contains('open')) closeDrawer();
        else openDrawer();
    });
    closeBtn?.addEventListener('click', closeDrawer);
    scrim?.addEventListener('click', () => {
        closeDrawer();
        createPopover?.classList.remove('open');
        createBtn?.setAttribute('aria-expanded', 'false');
    });

    createBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = !createPopover?.classList.contains('open');
        createPopover?.classList.toggle('open', next);
        createBtn.setAttribute('aria-expanded', String(next));
    });

    document.addEventListener('click', (e) => {
        if (!createPopover || !createBtn) return;
        if (createPopover.contains(e.target) || createBtn.contains(e.target)) return;
        createPopover.classList.remove('open');
        createBtn.setAttribute('aria-expanded', 'false');
    });
}

// ---- Init ----------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
    void (async () => {
        applyTheme();
        bindThemePreferenceListener(() => {
            updateThemeSwitcher();
        });
        applyI18n();
        updateLangSwitcher();
        bindLangSwitcher();
        updateThemeSwitcher();
        bindEvents();
        const redirectOutcome = await handleRedirectResult(auth);
        if (redirectOutcome?.error) {
            showFeedback("error", t("authError"), redirectOutcome.error?.message || String(redirectOutcome.error), true);
        }
        if (redirectOutcome?.result?.user) {
            await ensureUserBootstrap(redirectOutcome.result.user).catch((e) => console.warn('[Portal] redirect bootstrap failed:', e));
        } else if (auth.currentUser) {
            await ensureUserBootstrap(auth.currentUser).catch((e) => console.warn('[Portal] current-user bootstrap failed:', e));
        }
        await initGIS({ authInstance: auth });
        onAuthStateChanged(auth, (user) => {
            if (user) {
                void ensureUserBootstrap(user).catch((e) => console.warn('[Portal] user bootstrap failed:', e));
            }
            renderAuthArea(user);
        });
        loadPublicProjects();
    })().catch((e) => console.warn('[Portal] bootstrap failed:', e));
});
