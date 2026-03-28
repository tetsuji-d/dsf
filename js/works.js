/**
 * works.js — Works Room モーダル
 * 発行済みプロジェクトの公開ステータス管理
 */
import {
    collection, getDocs, doc, updateDoc, setDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { state } from './state.js';
import { db } from './firebase.js';

const VISIBILITY_LABELS = {
    private:  { label: '非公開',   icon: '🔒', cls: 'vis-private'  },
    unlisted: { label: '限定公開', icon: '🔗', cls: 'vis-unlisted' },
    public:   { label: '公開',     icon: '🌍', cls: 'vis-public'   },
};

/** Works Room モーダルを開く */
export async function openWorksRoom() {
    const modal = document.getElementById('works-modal');
    const list  = document.getElementById('works-list');
    if (!modal || !list) return;

    modal.classList.add('visible');
    list.innerHTML = '<div class="works-loading">読み込み中...</div>';

    if (!state.uid) {
        list.innerHTML = '<div class="works-loading">ログインが必要です</div>';
        return;
    }

    try {
        const snap = await getDocs(collection(db, 'users', state.uid, 'projects'));
        const projects = [];
        snap.forEach(docSnap => {
            const d = docSnap.data() || {};
            projects.push({
                id:          docSnap.id,
                title:       d.title || '無題のプロジェクト',
                visibility:  d.visibility || 'private',
                thumbnail:   getThumbnail(d),
                pageCount:   getPageCount(d),
                lastUpdated: d.lastUpdated?.toDate?.() || new Date(0),
                authorName:  d.ownerEmail || '',
            });
        });
        projects.sort((a, b) => b.lastUpdated - a.lastUpdated);

        if (!projects.length) {
            list.innerHTML = `
                <div class="works-empty">
                    <p>プロジェクトがありません</p>
                    <p class="works-empty-sub">まず Editor Room でプロジェクトを作成・保存してください。</p>
                </div>`;
            return;
        }

        list.innerHTML = projects.map(p => renderRow(p)).join('');

        // 公開ステータス変更
        list.querySelectorAll('.works-vis-select').forEach(sel => {
            sel.addEventListener('change', async () => {
                const pid        = sel.dataset.pid;
                const newVis     = sel.value;
                const row        = sel.closest('.works-row');
                const badge      = row?.querySelector('.works-vis-badge');
                const prevVis    = sel.dataset.prev;
                sel.dataset.prev = newVis;
                if (badge) {
                    const info = VISIBILITY_LABELS[newVis] || VISIBILITY_LABELS.private;
                    badge.textContent = `${info.icon} ${info.label}`;
                    badge.className   = `works-vis-badge ${info.cls}`;
                }
                await updateVisibility(pid, newVis, prevVis, p => p.id === pid ? projects.find(x => x.id === pid) : null);
            });
        });

    } catch (err) {
        console.error('[Works] load error:', err);
        list.innerHTML = `<div class="works-loading">読み込みに失敗しました: ${err.message}</div>`;
    }
}

/** Works Room モーダルを閉じる */
export function closeWorksRoom() {
    document.getElementById('works-modal')?.classList.remove('visible');
}

// ---- Private helpers -------------------------------------------------------

function renderRow(p) {
    const vis  = VISIBILITY_LABELS[p.visibility] || VISIBILITY_LABELS.private;
    const date = p.lastUpdated.getFullYear() > 1970
        ? p.lastUpdated.toLocaleDateString('ja-JP')
        : '—';
    const thumb = p.thumbnail
        ? `<img src="${escHtml(p.thumbnail)}" alt="" loading="lazy">`
        : `<div class="works-thumb-placeholder">📄</div>`;

    return `
        <div class="works-row" data-pid="${escHtml(p.id)}">
            <div class="works-thumb">${thumb}</div>
            <div class="works-info">
                <div class="works-title">${escHtml(p.title || p.id)}</div>
                <div class="works-meta">${p.pageCount}ページ · ${date}</div>
            </div>
            <div class="works-controls">
                <span class="works-vis-badge ${vis.cls}">${vis.icon} ${vis.label}</span>
                <select class="works-vis-select" data-pid="${escHtml(p.id)}" data-prev="${escHtml(p.visibility)}">
                    <option value="private"  ${p.visibility === 'private'  ? 'selected' : ''}>🔒 非公開</option>
                    <option value="unlisted" ${p.visibility === 'unlisted' ? 'selected' : ''}>🔗 限定公開</option>
                    <option value="public"   ${p.visibility === 'public'   ? 'selected' : ''}>🌍 公開</option>
                </select>
                <button class="works-btn-edit" onclick="loadAndOpenProject('${escHtml(p.id)}')" title="エディターで開く">✏️ 編集</button>
            </div>
        </div>`;
}

async function updateVisibility(pid, newVis, _prevVis, _finder) {
    if (!state.uid || !pid) return;
    try {
        await updateDoc(doc(db, 'users', state.uid, 'projects', pid), {
            visibility: newVis,
        });

        const publicRef = doc(db, 'public_projects', pid);
        if (newVis === 'public') {
            // public_projects に登録（最低限のメタデータのみ）
            const projSnap = await getDocs(collection(db, 'users', state.uid, 'projects'));
            let meta = null;
            projSnap.forEach(d => { if (d.id === pid) meta = d.data(); });
            if (meta) {
                await setDoc(publicRef, {
                    title:      meta.title || '無題のプロジェクト',
                    authorUid:  state.uid,
                    authorName: meta.ownerEmail || state.user?.displayName || '',
                    thumbnail:  getThumbnail(meta),
                    updatedAt:  serverTimestamp(),
                    visibility: 'public',
                }, { merge: true });
            }
        } else {
            await deleteDoc(publicRef).catch(() => {});
        }
    } catch (err) {
        console.error('[Works] visibility update error:', err);
        alert('ステータスの更新に失敗しました: ' + err.message);
    }
}

function getThumbnail(data) {
    const pages = Array.isArray(data.pages) ? data.pages : [];
    const first = pages.find(p => p?.content?.thumbnail || p?.content?.background);
    if (first?.content?.thumbnail) return first.content.thumbnail;
    if (first?.content?.background) return first.content.background;
    const blocks = Array.isArray(data.blocks) ? data.blocks : [];
    const page = blocks.find(b => b?.kind === 'page');
    if (page?.content?.thumbnail) return page.content.thumbnail;
    if (page?.content?.background) return page.content.background;
    const sects = Array.isArray(data.sections) ? data.sections : [];
    return sects[0]?.thumbnail || sects[0]?.background || null;
}

function getPageCount(data) {
    const pages = (Array.isArray(data.pages) ? data.pages : [])
        .filter(p => p?.pageType === 'normal_image' || p?.pageType === 'normal_text').length;
    if (pages > 0) return pages;
    const blocks = (Array.isArray(data.blocks) ? data.blocks : [])
        .filter(b => b?.kind === 'page').length;
    if (blocks > 0) return blocks;
    return Array.isArray(data.sections) ? data.sections.length : 0;
}

function escHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
