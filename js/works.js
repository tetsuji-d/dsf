/**
 * works.js — Works Room
 * 発行済み作品の DSF ステータス管理
 */
import {
    collection, getDocs, doc, updateDoc, setDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { state } from './state.js';
import { db } from './firebase.js';

const DSF_STATUS_LABELS = {
    draft:    { label: '下書き',   icon: 'edit_note', cls: 'dsf-draft'    },
    unlisted: { label: '限定公開', icon: 'link', cls: 'dsf-unlisted' },
    public:   { label: '公開',     icon: 'public', cls: 'dsf-public'   },
    private:  { label: '非公開',   icon: 'lock', cls: 'dsf-private'  },
};

/**
 * Works Room を開く。
 * @param {boolean} roomMode - true のとき #works-room にインライン描画、false のときモーダル
 */
export async function openWorksRoom(roomMode = false) {
    const listEl = roomMode
        ? document.getElementById('works-room-list')
        : document.getElementById('works-list');
    const modalEl = document.getElementById('works-modal');

    if (!roomMode && modalEl) modalEl.classList.add('visible');
    if (!listEl) return;

    listEl.innerHTML = '<div class="works-loading">読み込み中...</div>';

    if (!state.uid) {
        listEl.innerHTML = '<div class="works-loading">ログインが必要です</div>';
        return;
    }

    try {
        const snap = await getDocs(collection(db, 'users', state.uid, 'projects'));
        const projects = [];
        snap.forEach(docSnap => {
            const d = docSnap.data() || {};
            // DSF 発行済みのもの（dsfPages あり）のみ Works Room に表示
            if (!d.dsfPages?.length) return;
            projects.push({
                id:             docSnap.id,
                workId:         d.workId || docSnap.id,
                releaseId:      d.releaseId || null,
                title:          d.title || '無題のプロジェクト',
                dsfStatus:      d.dsfStatus || 'draft',
                thumbnail:      _getThumbnail(d),
                pageCount:      d.dsfPages?.length || 0,
                dsfPublishedAt: d.dsfPublishedAt?.toDate?.() || new Date(0),
                dsfResolution:  d.dsfResolution || '—',
                dsfQuality:     d.dsfQuality || '—',
                dsfLangs:       d.dsfLangs || [],
            });
        });
        projects.sort((a, b) => b.dsfPublishedAt - a.dsfPublishedAt);

        if (!projects.length) {
            listEl.innerHTML = `
                <div class="works-empty">
                    <span class="material-icons" style="font-size:48px;color:#555;display:block;margin-bottom:12px;">library_books</span>
                    <p>発行済み作品がありません</p>
                    <p class="works-empty-sub">Press Room でレンダリング・発行するとここに表示されます。</p>
                    <button class="home-action-btn" onclick="window.switchRoom('press')" style="margin-top:16px;">
                        <span class="material-icons">publish</span> Press Room へ
                    </button>
                </div>`;
            return;
        }

        listEl.innerHTML = projects.map(p => _renderRow(p)).join('');

        // DSF ステータス変更イベント
        listEl.querySelectorAll('.works-dsf-select').forEach(sel => {
            sel.addEventListener('change', async () => {
                const pid       = sel.dataset.pid;
                const newStatus = sel.value;
                const row       = sel.closest('.works-row');
                const badge     = row?.querySelector('.works-dsf-badge');
                sel.dataset.prev = newStatus;
                if (badge) {
                    const info = DSF_STATUS_LABELS[newStatus] || DSF_STATUS_LABELS.draft;
                    badge.innerHTML = `${_statusIcon(info.icon)}<span>${info.label}</span>`;
                    badge.className   = `works-dsf-badge ${info.cls}`;
                }
                const proj = projects.find(x => x.id === pid);
                await _updateDsfStatus(pid, newStatus, proj);
            });
        });

        // 削除ボタン
        listEl.querySelectorAll('.works-btn-delete').forEach(btn => {
            btn.addEventListener('click', async () => {
                const pid = btn.dataset.deletePid;
                const proj = projects.find(x => x.id === pid);
                if (!confirm(`「${pid}」を削除しますか？\nこの操作は取り消せません。`)) return;
                try {
                    await deleteDoc(doc(db, 'users', state.uid, 'projects', pid));
                    if (proj?.workId) {
                        await deleteDoc(doc(db, 'public_projects', proj.workId)).catch(() => {});
                    }
                    await deleteDoc(doc(db, 'public_projects', pid)).catch(() => {});
                    btn.closest('.works-row')?.remove();
                } catch (err) {
                    alert('削除に失敗しました: ' + err.message);
                }
            });
        });

    } catch (err) {
        console.error('[Works] load error:', err);
        listEl.innerHTML = `<div class="works-loading">読み込みに失敗しました: ${err.message}</div>`;
    }
}

/** Works Room モーダルを閉じる */
export function closeWorksRoom() {
    document.getElementById('works-modal')?.classList.remove('visible');
}

// ---- Private helpers -------------------------------------------------------

function _renderRow(p) {
    const dsf  = DSF_STATUS_LABELS[p.dsfStatus] || DSF_STATUS_LABELS.draft;
    const date = p.dsfPublishedAt.getFullYear() > 1970
        ? p.dsfPublishedAt.toLocaleDateString('ja-JP')
        : '—';
    const thumb = p.thumbnail
        ? `<img src="${_esc(p.thumbnail)}" alt="" loading="lazy">`
        : `<div class="works-thumb-placeholder"><span class="material-icons">image</span></div>`;
    const langs = p.dsfLangs.length ? p.dsfLangs.map(l => l.toUpperCase()).join(' / ') : '—';

    return `
        <div class="works-row" data-pid="${_esc(p.id)}" data-work-id="${_esc(p.workId || p.id)}">
            <div class="works-thumb">${thumb}</div>
            <div class="works-info">
                <div class="works-title">${_esc(p.title || p.id)}</div>
                <div class="works-meta">${p.pageCount}ページ · ${langs} · ${p.dsfResolution} · 品質${p.dsfQuality}%</div>
                <div class="works-meta">${date} 発行</div>
            </div>
            <div class="works-controls">
                <span class="works-dsf-badge ${dsf.cls}">${_statusIcon(dsf.icon)}<span>${dsf.label}</span></span>
                <select class="works-dsf-select" data-pid="${_esc(p.id)}" data-prev="${_esc(p.dsfStatus)}">
                    <option value="draft"    ${p.dsfStatus === 'draft'    ? 'selected' : ''}>下書き</option>
                    <option value="unlisted" ${p.dsfStatus === 'unlisted' ? 'selected' : ''}>限定公開</option>
                    <option value="public"   ${p.dsfStatus === 'public'   ? 'selected' : ''}>公開</option>
                    <option value="private"  ${p.dsfStatus === 'private'  ? 'selected' : ''}>非公開</option>
                </select>
                <button class="works-btn-copy"
                    onclick="window.copyViewerUrl('${_esc(p.id)}')"
                    title="ビューワーURLをコピー"><span class="material-icons" aria-hidden="true">link</span><span>URLコピー</span></button>
                <button class="works-btn-edit"
                    onclick="window.loadAndOpenProject('${_esc(p.id)}')"
                    title="エディターで開く"><span class="material-icons" aria-hidden="true">edit</span><span>編集</span></button>
                <button class="works-btn-press"
                    onclick="window.loadAndRepress('${_esc(p.id)}')"
                    title="再レンダリング"><span class="material-icons" aria-hidden="true">autorenew</span><span>再発行</span></button>
                <button class="works-btn-delete"
                    data-delete-pid="${_esc(p.id)}"
                    title="プロジェクトを削除"><span class="material-icons" aria-hidden="true">delete</span><span>削除</span></button>
            </div>
        </div>`;
}

async function _updateDsfStatus(pid, newStatus, proj) {
    if (!state.uid || !pid) return;
    const workId = proj?.workId || pid;
    try {
        await updateDoc(doc(db, 'users', state.uid, 'projects', pid), {
            dsfStatus: newStatus,
            visibility: newStatus === 'draft' ? 'private' : newStatus,
        });

        const publicRef = doc(db, 'public_projects', workId);
        if ((newStatus === 'public' || newStatus === 'unlisted') && proj) {
            await setDoc(publicRef, {
                title:      proj.title || '無題のプロジェクト',
                projectId:  pid,
                workId,
                releaseId:  proj.releaseId || null,
                authorUid:  state.uid,
                authorName: state.user?.displayName || state.user?.email || '',
                thumbnail:  proj.thumbnail || null,
                updatedAt:  serverTimestamp(),
                dsfStatus:  newStatus,
                dsfLangs:   proj.dsfLangs || [],
                pageCount:  proj.pageCount || 0,
            }, { merge: true });
            if (workId !== pid) {
                await deleteDoc(doc(db, 'public_projects', pid)).catch(() => {});
            }
        } else {
            // ステータスを更新してからドキュメント削除を試みる
            await setDoc(publicRef, { dsfStatus: newStatus }, { merge: true }).catch(() => {});
            await deleteDoc(publicRef).catch((e) => console.warn('[Works] public_projects delete:', e.message));
            if (workId !== pid) {
                await deleteDoc(doc(db, 'public_projects', pid)).catch(() => {});
            }
        }
    } catch (err) {
        console.error('[Works] dsfStatus update error:', err);
        alert('ステータスの更新に失敗しました: ' + err.message);
    }
}

function _getThumbnail(data) {
    // DSF ページの最初の URL をサムネイルとして使う
    const dsfPages = Array.isArray(data.dsfPages) ? data.dsfPages : [];
    const first = dsfPages[0];
    if (first?.urls) {
        const lang = Object.keys(first.urls)[0];
        if (lang) return first.urls[lang];
    }
    // フォールバック: DSP のサムネイル
    const pages = Array.isArray(data.pages) ? data.pages : [];
    const pg = pages.find(p => p?.content?.thumbnail || p?.content?.background);
    if (pg?.content?.thumbnail) return pg.content.thumbnail;
    if (pg?.content?.background) return pg.content.background;
    return null;
}

function _esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function _statusIcon(name) {
    return `<span class="material-icons" aria-hidden="true">${_esc(name)}</span>`;
}
