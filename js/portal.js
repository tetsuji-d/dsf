/**
 * portal.js — DSF Portal (index.html) の一覧表示ロジック
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, query, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

const DEFAULT_THUMB_URL = "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=400&auto=format&fit=crop";
const FETCH_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 120;
const ENABLE_CLOUDFLARE_IMAGE_DELIVERY = false;
const CF_DOMAIN = "https://dsf.ink";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const feedContainer = document.getElementById("public-feed");
const searchInput = document.getElementById("portal-search");
const languageSelect = document.getElementById("portal-lang");
const feedbackContainer = document.getElementById("portal-feedback");
const statusText = document.getElementById("feed-status");
const PORTAL_LANG_STORAGE_KEY = "dsf-portal-lang";

function normalizeLangCode(value, fallback = "ja") {
    if (typeof value !== "string") return fallback;
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return fallback;
    return trimmed.split("-")[0] || fallback;
}

function getInitialPortalLang() {
    try {
        const saved = localStorage.getItem(PORTAL_LANG_STORAGE_KEY);
        if (saved) return normalizeLangCode(saved);
    } catch (_) {
        // ignore
    }
    return normalizeLangCode(navigator.language || "ja");
}

const portalState = {
    isLoading: false,
    hasError: false,
    query: "",
    projects: [],
    activeLang: getInitialPortalLang(),
    availableLangs: ["ja", "en"]
};

let searchDebounceTimer = null;

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function normalizeText(value, fallback = "") {
    if (typeof value !== "string") return fallback;
    const trimmed = value.trim();
    return trimmed || fallback;
}

function normalizeLocalizedMap(value) {
    if (!value || typeof value !== "object") return {};
    const out = {};
    for (const [lang, text] of Object.entries(value)) {
        if (typeof text !== "string") continue;
        const trimmed = text.trim();
        if (trimmed) out[normalizeLangCode(lang)] = trimmed;
    }
    return out;
}

function getLocalizedValue(map, preferredLang, fallbackLangs = [], fallback = "") {
    if (preferredLang && typeof map[preferredLang] === "string" && map[preferredLang]) {
        return map[preferredLang];
    }
    for (const lang of fallbackLangs) {
        if (typeof map[lang] === "string" && map[lang]) return map[lang];
    }
    const first = Object.values(map).find((v) => typeof v === "string" && v);
    return first || fallback;
}

function uniqueLangs(values) {
    return [...new Set((Array.isArray(values) ? values : [])
        .map((v) => normalizeLangCode(v, ""))
        .filter(Boolean))];
}

function getLangLabel(code) {
    const labels = {
        ja: "日本語",
        en: "English",
        zh: "中文",
        ko: "한국어",
        fr: "Français",
        de: "Deutsch",
        es: "Español"
    };
    return labels[code] || code.toUpperCase();
}

function getProjectDisplayTitle(project) {
    return getLocalizedValue(
        project.titles || {},
        portalState.activeLang,
        [project.defaultLang, ...(project.languages || [])],
        project.title || "無題のプロジェクト"
    );
}

function getProjectDisplaySubtitle(project) {
    return getLocalizedValue(
        project.subtitles || {},
        portalState.activeLang,
        [project.defaultLang, ...(project.languages || [])],
        project.subtitle || ""
    );
}

function getProjectDisplayAuthor(project) {
    return getLocalizedValue(
        project.authors || {},
        portalState.activeLang,
        [project.defaultLang, ...(project.languages || [])],
        project.authorName || "名無し"
    );
}

function getOptimizedThumbUrl(originalUrl) {
    if (!originalUrl || typeof originalUrl !== "string") return DEFAULT_THUMB_URL;
    if (ENABLE_CLOUDFLARE_IMAGE_DELIVERY && originalUrl.includes("firebasestorage.googleapis.com")) {
        return `${CF_DOMAIN}/cdn-cgi/image/width=400,format=auto,quality=80/${originalUrl}`;
    }
    return originalUrl;
}

function formatPublishedAt(publishedAt) {
    if (!publishedAt) return "";
    const dateObj = typeof publishedAt.toDate === "function"
        ? publishedAt.toDate()
        : (publishedAt instanceof Date ? publishedAt : null);
    if (!dateObj || Number.isNaN(dateObj.getTime())) return "";
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
    const dd = String(dateObj.getDate()).padStart(2, "0");
    return `${yyyy}/${mm}/${dd}`;
}

function setStatus(text) {
    if (statusText) statusText.textContent = text || "";
}

function clearFeedback() {
    if (!feedbackContainer) return;
    feedbackContainer.className = "portal-feedback";
    feedbackContainer.innerHTML = "";
}

function showFeedback(type, title, description = "", withRetry = false) {
    if (!feedbackContainer) return;
    feedbackContainer.className = `portal-feedback is-${type}`;
    feedbackContainer.innerHTML = `
        <div class="portal-feedback-box" role="status">
            <p class="portal-feedback-title">${escapeHtml(title)}</p>
            ${description ? `<p class="portal-feedback-desc">${escapeHtml(description)}</p>` : ""}
            ${withRetry ? '<button type="button" class="portal-retry-btn" data-action="retry-load">再試行</button>' : ""}
        </div>
    `;
}

function renderLoadingSkeleton(count = 6) {
    if (!feedContainer) return;
    const skeleton = Array.from({ length: count }, () => `
        <article class="project-card card-skeleton" aria-hidden="true">
            <div class="card-thumb-container"></div>
            <div class="card-info">
                <div class="card-skeleton-line w-80"></div>
                <div class="card-skeleton-line w-50"></div>
                <div class="card-skeleton-line w-30"></div>
            </div>
        </article>
    `).join("");
    feedContainer.innerHTML = skeleton;
}

function buildViewerUrl(projectId, authorUid) {
    const lang = normalizeLangCode(portalState.activeLang || "ja");
    return `/viewer.html?project=${encodeURIComponent(projectId)}&author=${encodeURIComponent(authorUid)}&lang=${encodeURIComponent(lang)}`;
}

function cardMarkup(project) {
    const safeTitle = escapeHtml(getProjectDisplayTitle(project));
    const safeSubtitle = escapeHtml(getProjectDisplaySubtitle(project));
    const safeAuthor = escapeHtml(getProjectDisplayAuthor(project));
    const safeDate = escapeHtml(project.publishedDate);
    const thumbUrl = escapeHtml(getOptimizedThumbUrl(project.thumbnail || DEFAULT_THUMB_URL));
    const cardBody = `
        <div class="card-thumb-container">
            <img
                src="${thumbUrl}"
                class="card-thumb"
                alt="${safeTitle} のサムネイル"
                loading="lazy"
                onerror="this.src='${DEFAULT_THUMB_URL}'"
            >
            ${project.canOpen ? "" : '<span class="card-badge">公開準備中</span>'}
        </div>
        <div class="card-info">
            <div class="card-title">${safeTitle}</div>
            ${safeSubtitle ? `<div class="card-subtitle">${safeSubtitle}</div>` : ""}
            <div class="card-author">${safeAuthor}</div>
            <div class="card-meta">${safeDate}</div>
        </div>
    `;

    if (project.canOpen) {
        const viewerUrl = escapeHtml(buildViewerUrl(project.id, project.authorUid));
        return `<a href="${viewerUrl}" class="project-card" data-role="project-card">${cardBody}</a>`;
    }
    return `<article class="project-card is-disabled" aria-disabled="true">${cardBody}</article>`;
}

function renderEmptyState(title, description, ctaLabel = "", ctaHref = "") {
    if (!feedContainer) return;
    feedContainer.innerHTML = `
        <section class="portal-empty" role="status">
            <p class="portal-empty-icon" aria-hidden="true">🌱</p>
            <h3 class="portal-empty-title">${escapeHtml(title)}</h3>
            <p class="portal-empty-desc">${escapeHtml(description)}</p>
            ${ctaLabel && ctaHref ? `<a href="${escapeHtml(ctaHref)}" class="btn-empty-action">${escapeHtml(ctaLabel)}</a>` : ""}
        </section>
    `;
}

function getFilteredProjects() {
    const queryText = portalState.query.trim().toLowerCase();
    if (!queryText) return portalState.projects;
    return portalState.projects.filter((project) => project.searchText.includes(queryText));
}

function syncAvailableLanguages() {
    const set = new Set(["ja", "en"]);
    portalState.projects.forEach((project) => {
        (project.languages || []).forEach((lang) => set.add(normalizeLangCode(lang)));
        if (project.defaultLang) set.add(normalizeLangCode(project.defaultLang));
    });
    portalState.availableLangs = [...set];
    if (!portalState.availableLangs.includes(portalState.activeLang)) {
        portalState.activeLang = portalState.availableLangs[0] || "ja";
    }
}

function renderLanguageOptions() {
    if (!languageSelect) return;
    const langs = portalState.availableLangs.length ? portalState.availableLangs : ["ja", "en"];
    languageSelect.innerHTML = langs
        .map((lang) => `<option value="${escapeHtml(lang)}">${escapeHtml(getLangLabel(lang))}</option>`)
        .join("");
    languageSelect.value = portalState.activeLang;
}

function renderProjects() {
    if (!feedContainer) return;
    if (portalState.isLoading) {
        renderLoadingSkeleton();
        return;
    }
    if (portalState.hasError) {
        feedContainer.innerHTML = "";
        return;
    }

    if (!portalState.projects.length) {
        setStatus("公開作品はまだありません");
        renderEmptyState("公開作品はまだありません", "最初の作品を公開してギャラリーを始めましょう。", "Studioを起動", "/studio.html");
        return;
    }

    const filtered = getFilteredProjects();
    if (!filtered.length) {
        setStatus("検索結果は0件です");
        renderEmptyState("検索結果が見つかりません", "キーワードを変えて再検索してください。");
        return;
    }

    feedContainer.innerHTML = filtered.map(cardMarkup).join("");

    const unavailableCount = filtered.filter((p) => !p.canOpen).length;
    const baseStatus = `${filtered.length}件を表示中`;
    if (unavailableCount > 0) {
        setStatus(`${baseStatus}（${unavailableCount}件は公開準備中）`);
    } else {
        setStatus(baseStatus);
    }
}

function normalizeProject(docSnap) {
    const data = docSnap.data() || {};
    const titles = normalizeLocalizedMap(data.titles);
    const subtitles = normalizeLocalizedMap(data.subtitles);
    const fallbackLang = normalizeLangCode(data.defaultLang || "ja");
    const languages = uniqueLangs([
        ...(Array.isArray(data.languages) ? data.languages : []),
        ...Object.keys(titles),
        ...Object.keys(subtitles),
        fallbackLang
    ]);
    const defaultLang = languages.includes(fallbackLang) ? fallbackLang : (languages[0] || "ja");
    const title = getLocalizedValue(
        titles,
        defaultLang,
        languages,
        normalizeText(data.title, "無題のプロジェクト")
    );
    const subtitle = getLocalizedValue(
        subtitles,
        defaultLang,
        languages,
        normalizeText(data.subtitle, "")
    );
    const authorName = normalizeText(data.authorName, "名無し");
    const authors = normalizeLocalizedMap(data.authors);
    const authorDisplay = getLocalizedValue(authors, defaultLang, languages, authorName);
    const authorUid = normalizeText(data.authorUid, "");
    const searchText = [
        title,
        subtitle,
        authorDisplay,
        ...Object.values(titles),
        ...Object.values(subtitles),
        ...Object.values(authors)
    ].join(" ").toLowerCase();
    return {
        id: docSnap.id,
        title,
        subtitle,
        titles,
        subtitles,
        languages,
        defaultLang,
        searchText,
        authorName: authorDisplay,
        authors,
        authorUid,
        canOpen: !!authorUid,
        thumbnail: normalizeText(data.thumbnail, DEFAULT_THUMB_URL),
        publishedDate: formatPublishedAt(data.publishedAt)
    };
}

async function loadPublicProjects() {
    if (!feedContainer) return;

    portalState.isLoading = true;
    portalState.hasError = false;
    setStatus("作品を読み込み中...");
    clearFeedback();
    renderLoadingSkeleton();

    try {
        const q = query(
            collection(db, "public_projects"),
            orderBy("publishedAt", "desc"),
            limit(FETCH_LIMIT)
        );
        const snapshot = await getDocs(q);
        portalState.projects = snapshot.docs.map(normalizeProject);
        syncAvailableLanguages();
        renderLanguageOptions();
        portalState.isLoading = false;
        renderProjects();
    } catch (error) {
        console.error("[Portal] Error fetching public projects:", error);
        portalState.projects = [];
        portalState.isLoading = false;
        portalState.hasError = true;
        setStatus("読み込みに失敗しました");
        feedContainer.innerHTML = "";
        showFeedback("error", "作品リストの読み込みに失敗しました。", "時間をおいて再試行してください。", true);
    }
}

function bindEvents() {
    if (searchInput) {
        searchInput.addEventListener("input", () => {
            if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                portalState.query = searchInput.value || "";
                renderProjects();
            }, SEARCH_DEBOUNCE_MS);
        });
        searchInput.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            searchInput.value = "";
            portalState.query = "";
            renderProjects();
        });
    }

    if (languageSelect) {
        languageSelect.value = portalState.activeLang;
        languageSelect.addEventListener("change", () => {
            portalState.activeLang = normalizeLangCode(languageSelect.value, "ja");
            try {
                localStorage.setItem(PORTAL_LANG_STORAGE_KEY, portalState.activeLang);
            } catch (_) {
                // ignore
            }
            renderProjects();
        });
    }

    if (feedbackContainer) {
        feedbackContainer.addEventListener("click", (event) => {
            const button = event.target.closest("[data-action='retry-load']");
            if (button) loadPublicProjects();
        });
    }
}

document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    loadPublicProjects();
});
