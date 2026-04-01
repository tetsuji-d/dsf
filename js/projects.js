/**
 * projects.js — プロジェクト一覧モーダル管理
 */
import { collection, getDocs, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { state } from './state.js';
import { db } from './firebase.js';
import { normalizeProjectDataV5 } from './pages.js';

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
        const snapshot = await getDocs(collection(db, "users", state.uid, "projects"));
        const projects = [];
        snapshot.forEach(docSnap => {
            const normalized = normalizeProjectDataV5(docSnap.data() || {});
            projects.push({
                id: docSnap.id,
                version: normalized.version,
                title: normalized.title || '',
                pages: normalized.pages || [],
                blocks: normalized.blocks || [],
                sections: normalized.sections || [],
                languages: normalized.languages || ['ja'],
                defaultLang: normalized.defaultLang || (normalized.languages?.[0] || 'ja'),
                languageConfigs: normalized.languageConfigs || null,
                uiPrefs: normalized.uiPrefs || null,
                lastUpdated: normalized.lastUpdated?.toDate?.() || new Date(0)
            });
        });

        // 更新日時の降順でソート
        projects.sort((a, b) => b.lastUpdated - a.lastUpdated);

        if (projects.length === 0) {
            grid.innerHTML = '<div class="project-loading">保存されたプロジェクトはありません</div>';
            return;
        }

        grid.innerHTML = projects.map(p => {
            const cover = getCoverImage(p.pages, p.blocks, p.sections, p.dsfPages);
            const dateStr = p.lastUpdated.toLocaleDateString('ja-JP');
            const pageCount = getPageCount(p.pages, p.blocks, p.sections);
            return `
                <div class="project-card" data-id="${p.id}">
                    <div class="project-card-thumb">
                        ${cover
                    ? `<img src="${cover}" alt="${p.id}">`
                    : `<div class="project-card-text-thumb">${getPreviewText(p.sections)}</div>`
                }
                    </div>
                    <div class="project-card-info">
                        <div class="project-card-title">${p.id}</div>
                        <div class="project-card-meta">${pageCount}ページ · ${dateStr}</div>
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
                    onLoadProject(pid, project.sections, project.languages, project.defaultLang, project.languageConfigs, project.title, project.uiPrefs, project.pages, project.blocks, project.version);
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
function getCoverImage(pages, blocks, sections, dsfPages) {
    // DSF 発行済みなら R2 WebP を優先（imagePosition 反映済み）
    if (Array.isArray(dsfPages) && dsfPages.length > 0) {
        const first = dsfPages[0];
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

function getPageCount(pages, blocks, sections) {
    const pageCount = (Array.isArray(pages) ? pages : []).filter((p) =>
        p?.pageType === 'normal_image' || p?.pageType === 'normal_text'
    ).length;
    if (pageCount > 0) return pageCount;
    const blockPages = (Array.isArray(blocks) ? blocks : []).filter((b) => b?.kind === 'page').length;
    if (blockPages > 0) return blockPages;
    return Array.isArray(sections) ? sections.length : 0;
}
