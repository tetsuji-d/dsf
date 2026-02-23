/**
 * portal.js — DSF Portal (index.html) の一覧表示ロジック
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, query, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- Firebase Config (DSF Project) ---
const firebaseConfig = {
    apiKey: "AIzaSyBj3U-wFKnsWlwId4OHAyerEGMiRYhQN0o",
    authDomain: "vmnn-26345.firebaseapp.com",
    projectId: "vmnn-26345",
    storageBucket: "vmnn-26345.firebasestorage.app",
    messagingSenderId: "166808261830",
    appId: "1:166808261830:web:c218463dd04297749eb3c7",
    measurementId: "G-N639C3XCVQ"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// DOM Elements
const feedContainer = document.getElementById('public-feed');

/**
 * Cloudflare Optimize Image URL helper
 */
function getOptimizedThumbUrl(originalUrl) {
    if (!originalUrl || typeof originalUrl !== 'string') return '';
    const ENABLE_CLOUDFLARE = true;
    const CF_DOMAIN = 'https://dsf.ink';

    if (ENABLE_CLOUDFLARE && originalUrl.includes('firebasestorage.googleapis.com')) {
        return `${CF_DOMAIN}/cdn-cgi/image/width=400,format=auto,quality=80/${originalUrl}`;
    }
    return originalUrl;
}

/**
 * Fetch and render public projects
 */
async function loadPublicProjects() {
    try {
        const q = query(
            collection(db, "public_projects"),
            orderBy("publishedAt", "desc"),
            limit(20)
        );

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            feedContainer.innerHTML = `
                <div style="color:var(--portal-sub); padding:40px; text-align:center; width: 100%; grid-column: 1 / -1;">
                    <div style="font-size:32px; margin-bottom:12px;">🌱</div>
                    公開されている作品がまだありません。<br>Studioから作品を公開してみましょう。
                </div>`;
            return;
        }

        // Clear loading
        feedContainer.innerHTML = '';

        // Render Cards
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const projectId = docSnap.id;

            // Build the Viewer URL with parameters
            const viewerUrl = `/viewer.html?project=${encodeURIComponent(projectId)}&author=${encodeURIComponent(data.authorUid)}`;

            const title = data.title || '無題のプロジェクト';
            const authorName = data.authorName || '名無し';
            const thumbUrl = data.thumbnail || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=400&auto=format&fit=crop';

            // Format Date safely
            let dateStr = '';
            if (data.publishedAt && data.publishedAt.toDate) {
                const d = data.publishedAt.toDate();
                dateStr = `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`;
            }

            const cardHtml = `
                <a href="${viewerUrl}" class="project-card">
                    <div class="card-thumb-container">
                        <img src="${getOptimizedThumbUrl(thumbUrl)}" class="card-thumb" alt="Thumbnail" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=400&auto=format&fit=crop'">
                    </div>
                    <div class="card-info">
                        <div class="card-title">${escapeHtml(title)}</div>
                        <div class="card-author">${escapeHtml(authorName)}</div>
                        <div class="card-meta">${dateStr}</div>
                    </div>
                </a>
            `;

            // Insert
            feedContainer.insertAdjacentHTML('beforeend', cardHtml);
        });

    } catch (e) {
        console.error("Error fetching public projects:", e);
        // Fallback for when the collection index is missing or permissions fail (we will fix permissions in rules)
        feedContainer.innerHTML = `
            <div style="color:#ef4444; padding:40px; text-align:center; width: 100%; grid-column: 1 / -1;">
                作品リストの読み込みに失敗しました。
            </div>`;
    }
}

// Simple HTML escape
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Init
document.addEventListener('DOMContentLoaded', () => {
    loadPublicProjects();
});
