/**
 * portal.js — DSF Portal (index.html) の一覧表示ロジック
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, query, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyBj3U-wFKnsWlwId4OHAyerEGMiRYhQN0o",
    authDomain: "vmnn-26345.firebaseapp.com",
    projectId: "vmnn-26345",
    storageBucket: "vmnn-26345.firebasestorage.app",
    messagingSenderId: "166808261830",
    appId: "1:166808261830:web:c218463dd04297749eb3c7",
    measurementId: "G-N639C3XCVQ"
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
const feedbackContainer = document.getElementById("portal-feedback");
const statusText = document.getElementById("feed-status");

const portalState = {
    isLoading: false,
    hasError: false,
    query: "",
    projects: []
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
    return `/viewer.html?project=${encodeURIComponent(projectId)}&author=${encodeURIComponent(authorUid)}`;
}

function cardMarkup(project) {
    const safeTitle = escapeHtml(project.title);
    const safeAuthor = escapeHtml(project.authorName);
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
    return portalState.projects.filter((project) =>
        project.titleSearch.includes(queryText) || project.authorSearch.includes(queryText)
    );
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
    const title = normalizeText(data.title, "無題のプロジェクト");
    const authorName = normalizeText(data.authorName, "名無し");
    const authorUid = normalizeText(data.authorUid, "");
    return {
        id: docSnap.id,
        title,
        titleSearch: title.toLowerCase(),
        authorName,
        authorSearch: authorName.toLowerCase(),
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
