/**
 * projects.js — プロジェクト一覧モーダル管理
 */
import { collection, getDocs, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { state } from './state.js';
import { db } from './firebase.js';

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
            const data = docSnap.data();
            projects.push({
                id: docSnap.id,
                title: data.title || '',
                sections: data.sections || [],
                languages: data.languages || ['ja'],
                languageConfigs: data.languageConfigs || null,
                uiPrefs: data.uiPrefs || null,
                lastUpdated: data.lastUpdated?.toDate?.() || new Date(0)
            });
        });

        // 更新日時の降順でソート
        projects.sort((a, b) => b.lastUpdated - a.lastUpdated);

        if (projects.length === 0) {
            grid.innerHTML = '<div class="project-loading">保存されたプロジェクトはありません</div>';
            return;
        }

        grid.innerHTML = projects.map(p => {
            const cover = getCoverImage(p.sections);
            const dateStr = p.lastUpdated.toLocaleDateString('ja-JP');
            const pageCount = p.sections.length;
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
                    onLoadProject(pid, project.sections, project.languages, project.languageConfigs, project.title, project.uiPrefs);
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
function getCoverImage(sections) {
    if (!sections || sections.length === 0) return null;
    const first = sections[0];
    if (first.type === 'image') {
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
