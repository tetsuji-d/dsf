/**
 * portal.js — DSF Portal (index.html) のロジック
 * i18n対応: UI言語 + コンテンツ言語の切り替え
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, query, where, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
    apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId:             import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId:     import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const DEFAULT_THUMB_URL = "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=400&auto=format&fit=crop";
const FETCH_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 120;
const LANG_STORAGE_KEY = "dsf_portal_lang";
const SUPPORTED_LANGS = ["ja", "en"];

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// ---- i18n ----------------------------------------------------------------

const STRINGS = {
    ja: {
        sectionTitle:    "最新・注目作品",
        searchLabel:     "作品を検索",
        searchPlaceholder: "作品タイトル・作者名で検索",
        studioBtn:       "Studioを起動",
        signinBtn:       "サインイン",
        signoutBtn:      "サインアウト",
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
        sectionTitle:    "Latest & Featured",
        searchLabel:     "Search works",
        searchPlaceholder: "Search by title or author",
        studioBtn:       "Launch Studio",
        signinBtn:       "Sign in",
        signoutBtn:      "Sign out",
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
    document.querySelectorAll(".lang-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.lang === currentLang);
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

function buildViewerUrl(projectId, authorUid) {
    return `/viewer.html?project=${encodeURIComponent(projectId)}&author=${encodeURIComponent(authorUid)}`;
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
        const href = escapeHtml(buildViewerUrl(project.id, project.authorUid));
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
        renderEmptyState(t("noProjects"), t("noProjectsDesc"), t("launchStudio"), "/studio.html");
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
        const q = query(collection(db, "public_projects"), where("dsfStatus", "==", "public"), orderBy("updatedAt", "desc"), limit(FETCH_LIMIT));
        const snap = await getDocs(q);
        portalState.projects = snap.docs.map(normalizeProject);
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

function renderAuthArea(user) {
    const authArea = document.getElementById("auth-area");
    if (!authArea) return;
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
                <div class="auth-dropdown" id="auth-dropdown">
                    <div class="auth-dropdown-name">${displayName}</div>
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
        document.getElementById("btn-signout").addEventListener("click", () => signOut(auth));
    } else {
        authArea.innerHTML = `
            <button type="button" class="btn-signin" id="btn-signin">
                <span class="material-icons" aria-hidden="true">login</span>
                ${escapeHtml(t("signinBtn"))}
            </button>
        `;
        document.getElementById("btn-signin").addEventListener("click", async () => {
            const provider = new GoogleAuthProvider();
            try {
                await signInWithPopup(auth, provider);
            } catch (err) {
                if (err?.code === 'auth/popup-blocked' ||
                    err?.code === 'auth/popup-closed-by-user' ||
                    err?.code === 'auth/cancelled-popup-request') {
                    signInWithRedirect(auth, provider);
                } else {
                    console.error("[Portal] sign-in error", err);
                }
            }
        });
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

function bindLangSwitcher() {
    document.getElementById("lang-switcher")?.addEventListener("click", (e) => {
        const btn = e.target.closest(".lang-btn");
        if (btn?.dataset.lang) setLang(btn.dataset.lang);
    });
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
}

// ---- Init ----------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
    applyI18n();
    updateLangSwitcher();
    bindLangSwitcher();
    bindEvents();
    onAuthStateChanged(auth, (user) => renderAuthArea(user));
    getRedirectResult(auth).catch((err) => console.error("[Portal] redirect result error", err));
    loadPublicProjects();
});
