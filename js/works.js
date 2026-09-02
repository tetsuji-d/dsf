/**
 * works.js — Works Room
 * 発行済み作品の DSF ステータス管理
 */
import {
    collection, getDocs, doc, setDoc, deleteDoc, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { state } from './state.js';
import { assertAccountCanEdit, assertAccountCanPublish, db } from './firebase.js';
import { stageProjectSummaryDelete, stageProjectSummaryWrite } from './project-summary-firestore.js';
import {
    formatPublicationDate,
    getPublicationExpireReason,
    isPublicationActive,
    planAllowsPublicScheduling,
    reconcilePublicationForPlan,
    toDate,
    updatePublicationForStatus
} from './publication.js';
import { t, getUILang } from './i18n-studio.js';

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
        const account = await assertAccountCanEdit();
        const snap = await getDocs(collection(db, 'users', state.uid, 'projects'));
        const projects = [];
        for (const docSnap of snap.docs) {
            const d = docSnap.data() || {};
            // DSF 発行済みのもの（dsfPages あり）のみ Works Room に表示
            if (!d.dsfPages?.length) continue;
            const reconciled = await _reconcileProjectPublication(docSnap.id, d, account);
            projects.push({
                ...d,
                id:             docSnap.id,
                workId:         d.workId || docSnap.id,
                releaseId:      d.releaseId || null,
                title:          d.title || '無題のプロジェクト',
                dsfStatus:      reconciled.dsfStatus || 'draft',
                thumbnail:      _getThumbnail(d),
                pageCount:      d.dsfPages?.length || 0,
                dsfPublishedAt: d.dsfPublishedAt?.toDate?.() || new Date(0),
                dsfResolution:  d.dsfResolution || '—',
                dsfQuality:     d.dsfQuality || '—',
                dsfLangs:       d.dsfLangs || [],
                dsfTotalBytes:  d.dsfTotalBytes || 0,
                publication:     reconciled.publication || null,
            });
        }
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

        listEl.innerHTML = projects.map(p => _renderRow(p, account)).join('');

        // DSF ステータス変更イベント
        listEl.querySelectorAll('.works-dsf-select').forEach(sel => {
            sel.addEventListener('change', async () => {
                const pid       = sel.dataset.pid;
                const newStatus = sel.value;
                const row       = sel.closest('.works-row');
                const badge     = row?.querySelector('.works-dsf-badge');
                const prevStatus = sel.dataset.prev || 'draft';
                if (badge) {
                    const info = DSF_STATUS_LABELS[newStatus] || DSF_STATUS_LABELS.draft;
                    badge.innerHTML = `${_statusIcon(info.icon)}<span>${info.label}</span>`;
                    badge.className   = `works-dsf-badge ${info.cls}`;
                }
                const proj = projects.find(x => x.id === pid);
                const updated = await _updateDsfStatus(pid, newStatus, proj, row);
                if (updated && proj) {
                    proj.dsfStatus = newStatus;
                    proj.publication = updated;
                    sel.dataset.prev = newStatus;
                    _refreshRowPublication(row, proj, account);
                } else {
                    sel.value = prevStatus;
                    if (badge) {
                        const info = DSF_STATUS_LABELS[prevStatus] || DSF_STATUS_LABELS.draft;
                        badge.innerHTML = `${_statusIcon(info.icon)}<span>${info.label}</span>`;
                        badge.className = `works-dsf-badge ${info.cls}`;
                    }
                }
            });
        });

        listEl.querySelectorAll('.works-publication-save').forEach(btn => {
            btn.addEventListener('click', async () => {
                const pid = btn.dataset.pid;
                const row = btn.closest('.works-row');
                const proj = projects.find(x => x.id === pid);
                const updated = await _updatePublicationWindow(pid, proj, row);
                if (updated && proj) {
                    proj.publication = updated;
                    _refreshRowPublication(row, proj, account);
                }
            });
        });

        // 削除ボタン
        listEl.querySelectorAll('.works-btn-delete').forEach(btn => {
            btn.addEventListener('click', async () => {
                const pid = btn.dataset.deletePid;
                const proj = projects.find(x => x.id === pid);
                if (!confirm(`「${pid}」を削除しますか？\nこの操作は取り消せません。`)) return;
                try {
                    const batch = writeBatch(db);
                    batch.delete(doc(db, 'users', state.uid, 'projects', pid, 'authoring', 'current'));
                    batch.delete(doc(db, 'users', state.uid, 'projects', pid));
                    stageProjectSummaryDelete(batch, db, state.uid, pid);
                    await batch.commit();
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

function _renderRow(p, account = {}) {
    const dsf  = DSF_STATUS_LABELS[p.dsfStatus] || DSF_STATUS_LABELS.draft;
    const date = p.dsfPublishedAt.getFullYear() > 1970
        ? p.dsfPublishedAt.toLocaleDateString('ja-JP')
        : '—';
    const thumb = p.thumbnail
        ? `<img src="${_esc(p.thumbnail)}" alt="" loading="lazy">`
        : `<div class="works-thumb-placeholder"><span class="material-icons">image</span></div>`;
    const langs = p.dsfLangs.length ? p.dsfLangs.map(l => l.toUpperCase()).join(' / ') : '—';
    const publicationMeta = _renderPublicationMeta(p.publication, p.dsfStatus);
    const publicationEditor = _renderPublicationEditor(p, account);

    return `
        <div class="works-row" data-pid="${_esc(p.id)}" data-work-id="${_esc(p.workId || p.id)}">
            <div class="works-thumb">${thumb}</div>
            <div class="works-info">
                <div class="works-title">${_esc(p.title || p.id)}</div>
                <div class="works-meta">${p.pageCount}ページ · ${langs} · ${p.dsfResolution} · 品質${p.dsfQuality}%${p.dsfTotalBytes ? ` · ${(p.dsfTotalBytes / (1024 * 1024)).toFixed(1)} MB` : ''}</div>
                <div data-publication-meta>${publicationMeta}</div>
                ${publicationEditor}
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

function _formatWorksPublicationDate(value) {
    return formatPublicationDate(value, getUILang() === 'en' ? 'en-US' : 'ja-JP');
}

function _renderPublicationMeta(publication, status = 'draft') {
    if (!publication || typeof publication !== 'object') return '';
    const listedUntil = _formatWorksPublicationDate(publication.listedUntil) || t('publication_no_limit');
    const publicPeriod = _formatPublicationPeriod(publication.publicFrom, publication.publicUntil);
    const notice = _renderPublicationNotice(publication, status);
    return `
        <div class="works-publication-meta">
            <span>${_esc(t('publication_listed_until'))}: ${_esc(listedUntil)}</span>
            <span>${_esc(t('publication_public_period'))}: ${_esc(publicPeriod)}</span>
        </div>
        ${notice}
    `;
}

function _renderPublicationEditor(p, account = {}) {
    const canSchedule = planAllowsPublicScheduling(account);
    const isVisibleStatus = p.dsfStatus === 'public' || p.dsfStatus === 'unlisted';
    const publication = p.publication || {};
    const publicFrom = _toDateTimeLocalValue(publication.publicFrom);
    const publicUntil = _toDateTimeLocalValue(publication.publicUntil);
    const disabled = canSchedule ? '' : 'disabled';
    const saveDisabled = canSchedule && isVisibleStatus ? '' : 'disabled';
    const hint = canSchedule
        ? t('works_publication_schedule_hint')
        : t('works_publication_schedule_locked');
    return `
        <div class="works-publication-editor">
            <label>
                <span>${_esc(t('publication_public_from'))}</span>
                <input type="datetime-local" class="works-publication-input" data-public-from value="${_esc(publicFrom)}" ${disabled}>
            </label>
            <label>
                <span>${_esc(t('publication_public_until'))}</span>
                <input type="datetime-local" class="works-publication-input" data-public-until value="${_esc(publicUntil)}" ${disabled}>
            </label>
            <button class="works-publication-save" data-pid="${_esc(p.id)}" ${saveDisabled}>${_esc(t('works_publication_save'))}</button>
            <p>${_esc(hint)}</p>
        </div>
    `;
}

async function _reconcileProjectPublication(pid, data, account) {
    const status = data.dsfStatus || 'draft';
    const publication = reconcilePublicationForPlan(data.publication || {}, status, account, new Date());
    const expireReason = getPublicationExpireReason(publication, status, new Date());
    const isVisibleStatus = status === 'public' || status === 'unlisted';
    const shouldDowngrade = isVisibleStatus && !!expireReason;
    const nextStatus = shouldDowngrade ? 'draft' : status;
    const nextVisibility = shouldDowngrade ? 'private' : (data.visibility || status);
    const publicationChanged = JSON.stringify(_serializePublication(data.publication || null)) !== JSON.stringify(_serializePublication(publication));
    let appliedStatus = status;
    let appliedPublication = publication;
    let syncError = null;

    // Draft/private legacy works are normalized in-memory only. Persisting every
    // old project on room load can trip stricter rules and should not block read.
    if (shouldDowngrade || (publicationChanged && isVisibleStatus)) {
        try {
            const projectPatch = {
                dsfStatus: nextStatus,
                visibility: nextVisibility,
                publication
            };
            const projectBatch = writeBatch(db);
            projectBatch.update(doc(db, 'users', state.uid, 'projects', pid), projectPatch);
            stageProjectSummaryWrite(projectBatch, db, state.uid, pid, data, projectPatch);
            await projectBatch.commit();
            const workId = data.workId || pid;
            if (shouldDowngrade) {
                await deleteDoc(doc(db, 'public_projects', workId)).catch(() => {});
                if (workId !== pid) await deleteDoc(doc(db, 'public_projects', pid)).catch(() => {});
            } else if (nextStatus === 'public' || nextStatus === 'unlisted') {
                await setDoc(doc(db, 'public_projects', workId), _buildPublicProjectPayload(pid, workId, data, nextStatus, publication, account), { merge: true }).catch((e) => {
                    console.warn('[Works] public publication reconcile skipped:', e?.message || e);
                });
            }
            appliedStatus = nextStatus;
        } catch (err) {
            syncError = err;
            console.warn('[Works] publication reconcile skipped:', err?.message || err);
        }
    }
    return { dsfStatus: appliedStatus, publication: appliedPublication, syncError };
}

function _serializePublication(publication) {
    if (!publication || typeof publication !== 'object') return null;
    const dateValue = (value) => {
        const date = value?.toDate?.() || (value instanceof Date ? value : null);
        return date ? date.toISOString() : value || null;
    };
    return {
        listedFrom: dateValue(publication.listedFrom),
        listedUntil: dateValue(publication.listedUntil),
        publicFrom: dateValue(publication.publicFrom),
        publicUntil: dateValue(publication.publicUntil),
        expiredAt: dateValue(publication.expiredAt),
        expireReason: publication.expireReason || null,
        planSnapshot: publication.planSnapshot ? {
            tier: publication.planSnapshot.tier || null,
            status: publication.planSnapshot.status || null,
            cancelAtPeriodEnd: publication.planSnapshot.cancelAtPeriodEnd === true
        } : null
    };
}

function _formatPublicationPeriod(fromValue, untilValue) {
    const from = _formatWorksPublicationDate(fromValue) || t('publication_immediate');
    const until = _formatWorksPublicationDate(untilValue) || t('publication_no_limit');
    return `${from} - ${until}`;
}

function _renderPublicationNotice(publication, status = 'draft') {
    const reason = publication?.expireReason || getPublicationExpireReason(publication, status, new Date());
    if (!reason) return '';
    const key = reason === 'listing'
        ? 'works_publication_expired_listing'
        : 'works_publication_expired_public';
    return `<div class="works-publication-notice">${_esc(t(key))}</div>`;
}

function _toDateTimeLocalValue(value) {
    const date = toDate(value);
    if (!date) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
    ].join('-') + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function _dateFromDateTimeLocal(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function _publicationFromRow(row, previous = {}, status = 'draft', account = {}) {
    const canSchedule = planAllowsPublicScheduling(account);
    const inputFrom = _dateFromDateTimeLocal(row?.querySelector('[data-public-from]')?.value);
    const inputUntil = _dateFromDateTimeLocal(row?.querySelector('[data-public-until]')?.value);
    const publicFrom = canSchedule
        ? (inputFrom || toDate(previous.publicFrom) || new Date())
        : new Date();
    const publicUntil = canSchedule ? inputUntil : null;
    if (canSchedule && publicFrom && publicUntil && publicUntil.getTime() < publicFrom.getTime()) {
        throw new Error(t('works_publication_invalid_range'));
    }
    return updatePublicationForStatus({
        ...previous,
        publicFrom,
        publicUntil
    }, status, account, new Date());
}

function _refreshRowPublication(row, proj, account = {}) {
    if (!row || !proj) return;
    const meta = row.querySelector('[data-publication-meta]');
    if (meta) meta.innerHTML = _renderPublicationMeta(proj.publication, proj.dsfStatus);
    const info = {
        ...proj,
        publication: proj.publication || {},
    };
    const editor = row.querySelector('.works-publication-editor');
    if (editor) editor.outerHTML = _renderPublicationEditor(info, account);
    const saveBtn = row.querySelector('.works-publication-save');
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const updated = await _updatePublicationWindow(proj.id, proj, row);
            if (updated) {
                proj.publication = updated;
                _refreshRowPublication(row, proj, account);
            }
        });
    }
}

async function _updateDsfStatus(pid, newStatus, proj, row) {
    if (!state.uid || !pid) return;
    const workId = proj?.workId || pid;
    try {
        let account = null;
        if (newStatus === 'public' || newStatus === 'unlisted') {
            account = await assertAccountCanPublish();
        } else {
            account = await assertAccountCanEdit();
        }
        const publication = _publicationFromRow(row, proj?.publication || {}, newStatus, account);
        if ((newStatus === 'public' || newStatus === 'unlisted') && !isPublicationActive(publication, newStatus)) {
            const reason = getPublicationExpireReason(publication, newStatus, new Date());
            if (reason) {
                throw new Error(t('works_publication_cannot_publish_expired'));
            }
        }
        const projectPatch = {
            dsfStatus: newStatus,
            visibility: newStatus === 'draft' ? 'private' : newStatus,
            publication,
        };
        const projectBatch = writeBatch(db);
        projectBatch.update(doc(db, 'users', state.uid, 'projects', pid), projectPatch);
        stageProjectSummaryWrite(projectBatch, db, state.uid, pid, proj, projectPatch);
        await projectBatch.commit();

        const publicRef = doc(db, 'public_projects', workId);
        if ((newStatus === 'public' || newStatus === 'unlisted') && proj) {
            await setDoc(publicRef, _buildPublicProjectPayload(pid, workId, proj, newStatus, publication, account), { merge: true });
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
        return publication;
    } catch (err) {
        console.error('[Works] dsfStatus update error:', err);
        alert('ステータスの更新に失敗しました: ' + err.message);
        return null;
    }
}

async function _updatePublicationWindow(pid, proj, row) {
    if (!state.uid || !pid || !proj) return null;
    const status = proj.dsfStatus || 'draft';
    if (!(status === 'public' || status === 'unlisted')) {
        alert(t('works_publication_visible_only'));
        return null;
    }
    const workId = proj.workId || pid;
    try {
        const account = await assertAccountCanPublish();
        const publication = _publicationFromRow(row, proj.publication || {}, status, account);
        const expiredReason = getPublicationExpireReason(publication, status, new Date());
        if (expiredReason) throw new Error(t('works_publication_cannot_publish_expired'));
        const projectPatch = { publication };
        const projectBatch = writeBatch(db);
        projectBatch.update(doc(db, 'users', state.uid, 'projects', pid), projectPatch);
        stageProjectSummaryWrite(projectBatch, db, state.uid, pid, proj, projectPatch);
        await projectBatch.commit();
        await setDoc(doc(db, 'public_projects', workId), _buildPublicProjectPayload(pid, workId, proj, status, publication, account), { merge: true });
        alert(t('works_publication_saved'));
        return publication;
    } catch (err) {
        console.error('[Works] publication update error:', err);
        alert('公開期間の更新に失敗しました: ' + err.message);
        return null;
    }
}

function _buildPublicProjectPayload(pid, workId, data, status, publication, account = {}) {
    const dsfPages = Array.isArray(data.dsfPages) ? data.dsfPages : [];
    const authorProfile = account?.publicProfile || {};
    const authorName = authorProfile.displayName || state.user?.displayName || state.user?.email || '';
    const authorHandle = authorProfile.handle || account?.handle || null;
    return {
        title: data.title || '無題のプロジェクト',
        projectId: pid,
        workId,
        releaseId: data.releaseId || null,
        authorUid: state.uid,
        authorName,
        authorHandle,
        authorAvatarUrl: authorProfile.avatarUrl || '',
        authorProfile: {
            displayName: authorName,
            handle: authorHandle,
            avatarUrl: authorProfile.avatarUrl || '',
            backgroundUrl: authorProfile.backgroundUrl || '',
            bio: authorProfile.bio || ''
        },
        thumbnail: data.thumbnail || _getThumbnail(data) || null,
        updatedAt: serverTimestamp(),
        dsfStatus: status,
        publication,
        dsfPages,
        dsfLangs: Array.isArray(data.dsfLangs) ? data.dsfLangs : [],
        pageCount: dsfPages.length,
        dsfPageCount: data.dsfPageCount || dsfPages.length,
        dsfPublishedAt: data.dsfPublishedAt || null,
        dsfRenderStamp: data.dsfRenderStamp || null,
        dsfResolution: data.dsfResolution || '',
        dsfQuality: data.dsfQuality || null,
        dsfQualityMode: data.dsfQualityMode || '',
        dsfQualityProfile: data.dsfQualityProfile || null,
        dsfTotalBytes: data.dsfTotalBytes || 0,
        book: data.book || null,
        bookMode: data.bookMode || data.book?.mode || 'simple',
        languageConfigs: data.languageConfigs || {},
        languages: Array.isArray(data.languages) ? data.languages : (Array.isArray(data.dsfLangs) ? data.dsfLangs : ['ja']),
        defaultLang: data.defaultLang || data.languages?.[0] || data.dsfLangs?.[0] || 'ja',
        labelName: data.labelName || '',
        rating: data.rating || 'all',
        license: data.license || 'all-rights-reserved',
        meta: data.meta || {}
    };
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
