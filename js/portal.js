/**
 * portal.js — DSF Portal (index.html) の一覧表示ロジック
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    getFirestore,
    collection,
    query,
    orderBy,
    limit,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

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
const ENABLE_CLOUDFLARE_IMAGE_DELIVERY = false;
const CF_DOMAIN = "https://dsf.ink";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

let currentUser = null;
let searchDebounceTimer = null;

const feedContainer = document.getElementById("public-feed");
const searchInput = document.getElementById("portal-search");
const feedbackContainer = document.getElementById("portal-feedback");
const statusText = document.getElementById("feed-status");
const myProjectsSection = document.getElementById("my-projects-section");
const myProjectsGrid = document.getElementById("my-projects-grid");
const authArea = document.getElementById("auth-area");

const portalState = {
    isLoading: false,
    hasError: false,
    query: "",
    projects: []
};

// ── Utilities ──────────────────────────────────────────────────────────────

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

function formatDate(value) {
    if (!value) return "";
    const dateObj = typeof value.toDate === "function"
        ? value.toDate()
        : (value instanceof Date ? value : null);
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

// ── Auth UI ─────────────────────────────────────────────────────────────────

function updateAuthUI() {
    if (!authArea) return;
    if (currentUser) {
        const name = escapeHtml(currentUser.displayName || currentUser.email || "ユーザー");
        authArea.innerHTML = `
            <span class="auth-user-name">${name}</span>
            <button class="btn-signout" id="btn-signout">サインアウト</button>
        `;
        document.getElementById("btn-signout")?.addEventListener("click", () => signOut(auth));
    } else {
        authArea.innerHTML = `<button class="btn-signin" id="btn-signin">Googleでサインイン</button>`;
        document.getElementById("btn-signin")?.addEventListener("click", () => {
            signInWithPopup(auth, googleProvider).catch((err) => {
                console.error("[Portal] Sign-in error:", err);
            });
        });
    }
}

// ── My Projects ──────────────────────────────────────────────────────────────

function getMyProjectCover(data) {
    const blocks = Array.isArray(data.blocks) ? data.blocks : [];
    for (const b of blocks) {
        if (b?.kind === 'page' && b.content) {
            if (b.content.thumbnail) return b.content.thumbnail;
            if (b.content.background) return b.content.background;
        }
    }
    const sections = Array.isArray(data.sections) ? data.sections : [];
    if (sections[0]?.thumbnail) return sections[0].thumbnail;
    if (sections[0]?.background) return sections[0].background;
    return "";
}

function getMyProjectPageCount(data) {
    const blocks = Array.isArray(data.blocks) ? data.blocks : [];
    const pageBlocks = blocks.filter((b) => b?.kind === 'page').length;
    if (pageBlocks > 0) return pageBlocks;
    return Array.isArray(data.sections) ? data.sections.length : 0;
}

async function loadMyProjects() {
    if (!myProjectsSection || !myProjectsGrid || !currentUser) return;
    myProjectsSection.classList.remove("hidden");
    myProjectsGrid.innerHTML = '<div class="my-projects-loading">読み込み中...</div>';

    try {
        const snapshot = await getDocs(
            collection(db, "users", currentUser.uid, "projects")
        );
        const projects = [];
        snapshot.forEach((docSnap) => {
            const data = docSnap.data() || {};
            projects.push({
                id: docSnap.id,
                title: normalizeText(data.title, "無題"),
                cover: getMyProjectCover(data),
                pageCount: getMyProjectPageCount(data),
                lastUpdated: data.lastUpdated,
                visibility: data.visibility || "private"
            });
        });

        projects.sort((a, b) => {
            const ta = a.lastUpdated?.toDate?.()?.getTime() ?? 0;
            const tb = b.lastUpdated?.toDate?.()?.getTime() ?? 0;
            return tb - ta;
        });

        if (!projects.length) {
            myProjectsGrid.innerHTML = '<p class="my-projects-empty">保存済みプロジェクトはありません</p>';
            return;
        }

        myProjectsGrid.innerHTML = projects.map((p) => {
            const thumb = escapeHtml(getOptimizedThumbUrl(p.cover || DEFAULT_THUMB_URL));
            const editUrl = escapeHtml(`/studio.html?id=${encodeURIComponent(p.id)}`);
            const visiBadge = p.visibility === 'public'
                ? '<span class="visi-badge is-public">公開</span>'
                : '<span class="visi-badge is-private">非公開</span>';
            return `
                <a href="${editUrl}" class="my-project-card">
                    <div class="card-thumb-container">
                        <img src="${thumb}" class="card-thumb" alt="${escapeHtml(p.title)}" loading="lazy"
                            onerror="this.src='${DEFAULT_THUMB_URL}'">
                        ${visiBadge}
                    </div>
                    <div class="card-info">
                        <div class="card-title">${escapeHtml(p.title) || escapeHtml(p.id)}</div>
                        <div class="card-meta">${p.pageCount}ページ · ${formatDate(p.lastUpdated)}</div>
                    </div>
                </a>
            `;
        }).join("");
    } catch (err) {
        console.error("[Portal] My projects load error:", err);
        myProjectsGrid.innerHTML = `<p class="my-projects-empty">読み込みに失敗しました</p>`;
    }
}

function clearMyProjects() {
    if (!myProjectsSection) return;
    myProjectsSection.classList.add("hidden");
    if (myProjectsGrid) myProjectsGrid.innerHTML = "";
}

// ── Public Feed ──────────────────────────────────────────────────────────────

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
    setStatus(unavailableCount > 0 ? `${baseStatus}（${unavailableCount}件は公開準備中）` : baseStatus);
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
        publishedDate: formatDate(data.publishedAt)
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

// ── Events ───────────────────────────────────────────────────────────────────

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

// ── Init ─────────────────────────────────────────────────────────────────────

onAuthStateChanged(auth, (user) => {
    currentUser = user || null;
    updateAuthUI();
    if (user) {
        loadMyProjects();
    } else {
        clearMyProjects();
    }
});

document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    loadPublicProjects();
});
