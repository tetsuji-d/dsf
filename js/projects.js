/**
 * projects.js — プロジェクト一覧モーダル管理
 */
import { collection, getDocs, deleteDoc, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { state } from './state.js';
import { db } from './firebase.js';

/**
 * クラウドプロジェクト一覧を取得する（サマリーフィールドのみ）。
 * pages / blocks / sections は含まない。プロジェクト読み込みは loadProject() を使うこと。
 */
export async function fetchCloudProjects() {
    if (!state.uid) return [];

    const snapshot = await getDocs(collection(db, "users", state.uid, "projects"));
    const projects = [];
    snapshot.forEach(docSnap => {
        const raw = docSnap.data() || {};
        const lastUpdated = raw.lastUpdated?.toDate?.() ?? new Date(0);
        projects.push({
            id: docSnap.id,
            workId: typeof raw.workId === 'string' ? raw.workId : '',
            projectName: typeof raw.projectName === 'string' ? raw.projectName : '',
            title: typeof raw.title === 'string' ? raw.title : '',
            languages: Array.isArray(raw.languages) ? raw.languages : ['ja'],
            dsfPages: Array.isArray(raw.dsfPages) ? raw.dsfPages : [],
            dsfStatus: typeof raw.dsfStatus === 'string' ? raw.dsfStatus : 'draft',
            dsfPublishedAt: raw.dsfPublishedAt || null,
            releaseId: typeof raw.releaseId === 'string' ? raw.releaseId : '',
            dsfLangs: Array.isArray(raw.dsfLangs) ? raw.dsfLangs : [],
            dsfTotalBytes: Number.isFinite(Number(raw.dsfTotalBytes)) ? Number(raw.dsfTotalBytes) : 0,
            dsfResolution: typeof raw.dsfResolution === 'string' ? raw.dsfResolution : '',
            dsfQuality: Number.isFinite(Number(raw.dsfQuality)) ? Number(raw.dsfQuality) : 0,
            listThumbnail: typeof raw.listThumbnail === 'string' ? raw.listThumbnail : '',
            projectBytes: Number.isFinite(Number(raw.projectBytes)) ? Number(raw.projectBytes) : 0,
            pageCount: Number.isFinite(Number(raw.pageCount)) ? Number(raw.pageCount) : 0,
            lastUpdated,
        });
    });

    projects.sort((a, b) => b.lastUpdated - a.lastUpdated);
    return projects;
}

export async function deleteCloudProject(projectId) {
    if (!state.uid) throw new Error('ログインしてください');
    const projectRef = doc(db, "users", state.uid, "projects", projectId);
    const snap = await getDoc(projectRef);
    const workId = snap.exists() && typeof snap.data()?.workId === 'string'
        ? snap.data().workId
        : '';
    await deleteDoc(doc(db, "users", state.uid, "projects", projectId));
    if (workId) {
        await deleteDoc(doc(db, "public_projects", workId)).catch(() => {});
    }
    await deleteDoc(doc(db, "public_projects", projectId)).catch(() => {});
}

/**
 * プロジェクト一覧モーダルを開く
 * @param {function} onLoadProject - プロジェクト読込時のコールバック(projectId, sections)
 */
export async function openProjectModal(onLoadProject) {
    const modal = document.getElementById('project-modal');
    const grid = document.getElementById('project-grid');

    modal.classList.add('visible');
    grid.innerHTML = '<div class="project-loading">読み込み中...</div>';

    if (!state.uid) {
        grid.innerHTML = '<div class="project-loading">ログインしてください</div>';
        return;
    }

    try {
        const projects = await fetchCloudProjects();

        if (projects.length === 0) {
            grid.innerHTML = '<div class="project-loading">保存されたプロジェクトはありません</div>';
            return;
        }

        grid.innerHTML = projects.map(p => {
            const cover = getCoverImage(p.dsfPages, [], [], []);
            const dateStr = p.lastUpdated.toLocaleDateString('ja-JP');
            const displayName = p.projectName || p.title || p.id;
            return `
                <div class="project-card" data-id="${p.id}">
                    <div class="project-card-thumb">
                        ${cover
                    ? `<img src="${cover}" alt="${displayName}">`
                    : `<div class="project-card-text-thumb">${displayName}</div>`
                }
                    </div>
                    <div class="project-card-info">
                        <div class="project-card-title">${displayName}</div>
                        <div class="project-card-meta">${p.pageCount || '-'}ページ · ${dateStr}</div>
                    </div>
                    <button class="project-card-delete" title="削除" data-delete-id="${p.id}">✕</button>
                </div>
            `;
        }).join('');

        // カードクリックでプロジェクトを読み込む
        grid.querySelectorAll('.project-card').forEach(card => {
            card.addEventListener('click', (e) => {
                // 削除ボタンのクリックは除外
                if (e.target.classList.contains('project-card-delete')) return;
                const pid = card.dataset.id;
                const project = projects.find(p => p.id === pid);
                if (project) {
                    onLoadProject(pid, project.projectName, project.sections, project.languages, project.defaultLang, project.languageConfigs, project.title, project.uiPrefs, project.pages, project.blocks, project.version, project.bookMode, project.book, project.textPaperPreset);
                    closeProjectModal();
                }
            });
        });

        // 削除ボタン
        grid.querySelectorAll('.project-card-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const pid = btn.dataset.deleteId;
                if (!confirm(`「${pid}」を削除しますか？`)) return;
                try {
                    await deleteDoc(doc(db, "users", state.uid, "projects", pid));
                    btn.closest('.project-card').remove();
                } catch (err) {
                    alert("削除に失敗しました: " + err.message);
                }
            });
        });

    } catch (e) {
        grid.innerHTML = `<div class="project-loading">読み込みエラー: ${e.message}</div>`;
        console.error('[DSF] Project list error:', e);
    }
}

/**
 * プロジェクトモーダルを閉じる
 */
export function closeProjectModal() {
    document.getElementById('project-modal').classList.remove('visible');
}

/**
 * セクション配列から表紙画像URLを取得
 * サムネイルがあれば優先して使用
 */
export function getCoverImage(dsfPages, pages, blocks, sections) {
    // dsfPages (R2 WebP) has imagePosition baked in — use first
    const dsfList = Array.isArray(dsfPages) ? dsfPages : [];
    if (dsfList.length > 0) {
        const first = dsfList[0];
        if (first?.urls) {
            const lang = Object.keys(first.urls)[0];
            if (lang && first.urls[lang]) return first.urls[lang];
        }
    }
    const pageList = Array.isArray(pages) ? pages : [];
    if (pageList.length > 0) {
        const firstNormal = pageList.find((p) => p?.pageType === 'normal_image');
        if (firstNormal?.content?.thumbnail) return firstNormal.content.thumbnail;
        if (firstNormal?.content?.background) return firstNormal.content.background;
    }
    const blockList = Array.isArray(blocks) ? blocks : [];
    const page = blockList.find((b) => b?.kind === 'page');
    const content = page?.content;
    if (content?.pageKind === 'image') {
        if (content.thumbnail) return content.thumbnail;
        if (content.background) return content.background;
    }
    if (!sections || sections.length === 0) return null;
    const first = sections[0];
    if (first?.type === 'image') {
        if (first.thumbnail) return first.thumbnail;
        if (first.background) return first.background;
    }
    return null;
}

/**
 * セクション配列からプレビューテキストを取得
 */
function getPreviewText(sections) {
    if (!sections || sections.length === 0) return '空';
    const first = sections[0];
    if (first.text) return first.text.substring(0, 30);
    return 'イメージ';
}

export function getPageCount(pages, blocks, sections) {
    const pageCount = (Array.isArray(pages) ? pages : []).filter((p) =>
        p?.pageType === 'normal_image' || p?.pageType === 'normal_text'
    ).length;
    if (pageCount > 0) return pageCount;
    const blockPages = (Array.isArray(blocks) ? blocks : []).filter((b) => b?.kind === 'page').length;
    if (blockPages > 0) return blockPages;
    return Array.isArray(sections) ? sections.length : 0;
}
