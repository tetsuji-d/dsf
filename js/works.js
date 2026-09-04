/**
 * works.js — Works Room
 * 発行済み作品の DSF ステータス管理
 */
import {
    collection, getDocs, doc, deleteDoc, serverTimestamp, writeBatch, runTransaction
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
import { resolveWorksDsfRelease } from './works-dsf-release.js';
import { createWorksPublicationTransition } from './works-publication-transition.js';

const DSF_STATUS_LABELS = {
    draft:    { labelKey: 'works_status_draft',   icon: 'edit_note', cls: 'dsf-draft'    },
    unlisted: { labelKey: 'works_status_unlisted', icon: 'link', cls: 'dsf-unlisted' },
    public:   { labelKey: 'works_status_public',     icon: 'public', cls: 'dsf-public'   },
    private:  { labelKey: 'works_status_private',   icon: 'lock', cls: 'dsf-private'  },
};

function _statusInfo(status) {
    const info = DSF_STATUS_LABELS[status] || DSF_STATUS_LABELS.draft;
    return { ...info, label: t(info.labelKey) };
}

function _getWorksAllowedContentOrigins() {
    const configured = String(import.meta.env.VITE_R2_PUBLIC_URL || '').trim();
    if (!configured) return [];
    try {
        const url = new URL(configured);
        return url.protocol === 'https:' ? [url.origin] : [];
    } catch (_) {
        return [];
    }
}

function _resolveWorksRelease(data, pid) {
    return resolveWorksDsfRelease(data, {
        uid: state.uid,
        workId: data.workId || pid,
        releaseId: data.releaseId || '',
        allowedContentOrigins: _getWorksAllowedContentOrigins(),
    });
}

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

    listEl.innerHTML = `<div class="works-loading">${_esc(t('works_loading'))}</div>`;

    if (!state.uid) {
        listEl.innerHTML = `<div class="works-loading">${_esc(t('works_login_required'))}</div>`;
        return;
    }

    try {
        const account = await assertAccountCanEdit();
        const snap = await getDocs(collection(db, 'users', state.uid, 'projects'));
        const projects = [];
        for (const docSnap of snap.docs) {
            const d = docSnap.data() || {};
            let release;
            try {
                release = _resolveWorksRelease(d, docSnap.id);
            } catch (error) {
                console.warn('[Works] invalid DSF release metadata skipped:', docSnap.id, error?.message || error);
                continue;
            }
            const reconciled = await _reconcileProjectPublication(docSnap.id, d, account);
            projects.push({
                ...d,
                ...release.deliveryFields,
                id:             docSnap.id,
                workId:         d.workId || docSnap.id,
                releaseId:      d.releaseId || null,
                releaseKind:    release.releaseKind,
                title:          d.title || t('works_untitled'),
                dsfStatus:      reconciled.dsfStatus || 'draft',
                thumbnail:      _getThumbnail(d),
                pageCount:      release.pageCount,
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
                    <p>${_esc(t('works_empty_title'))}</p>
                    <p class="works-empty-sub">${_esc(t('works_empty_body'))}</p>
                    <button class="home-action-btn" onclick="window.switchRoom('press')" style="margin-top:16px;">
                        <span class="material-icons">publish</span> ${_esc(t('works_open_press'))}
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
                    const info = _statusInfo(newStatus);
                    badge.innerHTML = `${_statusIcon(info.icon)}<span>${info.label}</span>`;
                    badge.className   = `works-dsf-badge ${info.cls}`;
                }
                const proj = projects.find(x => x.id === pid);
                const updated = await _updateDsfStatus(pid, newStatus, proj, row);
                if (updated && proj) {
                    proj.dsfStatus = newStatus;
                    proj.publication = updated;
                    sel.dataset.prev = newStatus;
                    _refreshViewerAction(row, proj);
                    _refreshRowPublication(row, proj, account);
                } else {
                    sel.value = prevStatus;
                    if (badge) {
                        const info = _statusInfo(prevStatus);
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
                if (!confirm(t('works_delete_confirm', { name: proj?.title || pid }))) return;
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
                    alert(t('works_delete_failed', { message: err.message }));
                }
            });
        });

    } catch (err) {
        console.error('[Works] load error:', err);
        listEl.innerHTML = `<div class="works-loading">${_esc(t('works_load_failed', { message: err.message }))}</div>`;
    }
}

/** Works Room モーダルを閉じる */
export function closeWorksRoom() {
    document.getElementById('works-modal')?.classList.remove('visible');
}

// ---- Private helpers -------------------------------------------------------

function _renderRow(p, account = {}) {
    const dsf  = _statusInfo(p.dsfStatus);
    const date = p.dsfPublishedAt.getFullYear() > 1970
        ? p.dsfPublishedAt.toLocaleDateString(getUILang() === 'en' ? 'en-US' : 'ja-JP')
        : '—';
    const thumb = p.thumbnail
        ? `<img src="${_esc(p.thumbnail)}" alt="" loading="lazy">`
        : `<div class="works-thumb-placeholder"><span class="material-icons">image</span></div>`;
    const langs = p.dsfLangs.length ? p.dsfLangs.map(l => l.toUpperCase()).join(' / ') : '—';
    const publicationMeta = _renderPublicationMeta(p.publication, p.dsfStatus);
    const publicationEditor = _renderPublicationEditor(p, account);
    const size = p.dsfTotalBytes ? ` · ${(p.dsfTotalBytes / (1024 * 1024)).toFixed(1)} MB` : '';
    const releaseMeta = p.releaseKind === 'horizon-v2'
        ? t('works_meta_v2', { pages: p.pageCount, langs, size })
        : t('works_meta', {
            pages: p.pageCount,
            langs,
            resolution: p.dsfResolution,
            quality: p.dsfQuality,
            size,
        });
    return `
        <div class="works-row" data-pid="${_esc(p.id)}" data-work-id="${_esc(p.workId || p.id)}">
            <div class="works-thumb">${thumb}</div>
            <div class="works-info">
                <div class="works-title">${_esc(p.title || p.id)}</div>
                <div class="works-meta">${_esc(releaseMeta)}</div>
                <div data-publication-meta>${publicationMeta}</div>
                ${publicationEditor}
                <div class="works-meta">${_esc(t('works_published_on', { date }))}</div>
            </div>
            <div class="works-controls">
                <span class="works-dsf-badge ${dsf.cls}">${_statusIcon(dsf.icon)}<span>${dsf.label}</span></span>
                <select class="works-dsf-select" data-pid="${_esc(p.id)}" data-prev="${_esc(p.dsfStatus)}">
                    <option value="draft"    ${p.dsfStatus === 'draft'    ? 'selected' : ''}>${_esc(t('works_status_draft'))}</option>
                    <option value="unlisted" ${p.dsfStatus === 'unlisted' ? 'selected' : ''}>${_esc(t('works_status_unlisted'))}</option>
                    <option value="public"   ${p.dsfStatus === 'public'   ? 'selected' : ''}>${_esc(t('works_status_public'))}</option>
                    <option value="private"  ${p.dsfStatus === 'private'  ? 'selected' : ''}>${_esc(t('works_status_private'))}</option>
                </select>
                ${_renderViewerAction(p)}
                <button class="works-btn-edit"
                    onclick="window.loadAndOpenProject('${_esc(p.id)}')"
                    title="${_esc(t('works_edit_title'))}"><span class="material-icons" aria-hidden="true">edit</span><span>${_esc(t('works_edit'))}</span></button>
                <button class="works-btn-press"
                    onclick="window.loadAndRepress('${_esc(p.id)}')"
                    title="${_esc(t('works_republish_title'))}"><span class="material-icons" aria-hidden="true">autorenew</span><span>${_esc(t('works_republish'))}</span></button>
                <button class="works-btn-delete"
                    data-delete-pid="${_esc(p.id)}"
                    title="${_esc(t('works_delete_title'))}"><span class="material-icons" aria-hidden="true">delete</span><span>${_esc(t('works_delete'))}</span></button>
            </div>
        </div>`;
}

function _renderViewerAction(p) {
    const ownerOnly = p.dsfStatus === 'draft' || p.dsfStatus === 'private';
    if (ownerOnly) {
        const label = p.dsfStatus === 'draft' ? t('works_draft_preview') : t('works_private_preview');
        return `<button class="works-btn-copy works-btn-preview" data-works-viewer-action
            onclick="window.openDraftViewer('${_esc(p.id)}')"
            title="${_esc(t('works_open_owner_preview', { label }))}"><span class="material-icons" aria-hidden="true">preview</span><span>${_esc(label)}</span></button>`;
    }
    return `<button class="works-btn-copy" data-works-viewer-action
        onclick="window.copyViewerUrl('${_esc(p.id)}')"
        title="${_esc(t('works_copy_url_title'))}"><span class="material-icons" aria-hidden="true">link</span><span>${_esc(t('works_copy_url'))}</span></button>`;
}

function _refreshViewerAction(row, project) {
    const current = row?.querySelector('[data-works-viewer-action]');
    if (!current) return;
    current.outerHTML = _renderViewerAction(project);
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

async function _commitWorksPublicationTransition(pid, status, publication, account, options = {}) {
    const uid = state.uid;
    if (!uid || !pid) throw new Error('Publication transition requires an authenticated owner and project.');
    const expectedStatus = options.expectedStatus || null;
    const fallbackAuthorName = state.user?.displayName || state.user?.email || '';

    return runTransaction(db, async (transaction) => {
        const projectRef = doc(db, 'users', uid, 'projects', pid);
        const projectSnapshot = await transaction.get(projectRef);
        if (!projectSnapshot.exists()) throw new Error('公開元のProjectが見つかりません。');
        const project = projectSnapshot.data() || {};
        const currentStatus = project.dsfStatus || 'draft';
        if (expectedStatus && currentStatus !== expectedStatus) {
            throw new Error('作品の公開状態が別の操作で変更されました。Worksを開き直して再試行してください。');
        }

        const workId = String(project.workId || pid).trim();
        const releaseId = String(project.releaseId || '').trim();
        let work = null;
        let release = null;
        if (releaseId) {
            const workSnapshot = await transaction.get(doc(db, 'users', uid, 'works', workId));
            const releaseSnapshot = await transaction.get(doc(db, 'users', uid, 'works', workId, 'releases', releaseId));
            work = workSnapshot.exists() ? workSnapshot.data() : null;
            release = releaseSnapshot.exists() ? releaseSnapshot.data() : null;
        }

        const publicIndexes = {};
        const publicRef = doc(db, 'public_projects', workId);
        const publicSnapshot = await transaction.get(publicRef);
        publicIndexes[workId] = publicSnapshot.exists() ? publicSnapshot.data() : null;
        if (workId !== pid) {
            const legacyPublicSnapshot = await transaction.get(doc(db, 'public_projects', pid));
            publicIndexes[pid] = legacyPublicSnapshot.exists() ? legacyPublicSnapshot.data() : null;
        }

        const plan = createWorksPublicationTransition({
            uid,
            projectId: pid,
            project,
            work,
            release,
            status,
            publication,
            account,
            fallbackAuthorName,
            allowedContentOrigins: _getWorksAllowedContentOrigins(),
            publicIndexes,
        });

        transaction.update(projectRef, plan.projectPatch);
        stageProjectSummaryWrite(transaction, db, uid, pid, project, plan.projectPatch);
        plan.deleteDocumentIds.forEach((documentId) => {
            transaction.delete(doc(db, 'public_projects', documentId));
        });
        if (plan.publicIndex) {
            transaction.set(
                doc(db, 'public_projects', plan.publicIndex.documentId),
                { ...plan.publicIndex.payload, updatedAt: serverTimestamp() },
            );
        }
        return plan;
    });
}

async function _reconcileProjectPublication(pid, data, account) {
    const status = data.dsfStatus || 'draft';
    const publication = reconcilePublicationForPlan(data.publication || {}, status, account, new Date());
    const expireReason = getPublicationExpireReason(publication, status, new Date());
    const isVisibleStatus = status === 'public' || status === 'unlisted';
    const shouldDowngrade = isVisibleStatus && !!expireReason;
    const nextStatus = shouldDowngrade ? 'draft' : status;
    const publicationChanged = JSON.stringify(_serializePublication(data.publication || null)) !== JSON.stringify(_serializePublication(publication));
    let appliedStatus = status;
    let appliedPublication = shouldDowngrade || (publicationChanged && isVisibleStatus)
        ? (data.publication || null)
        : publication;
    let syncError = null;

    // Draft/private legacy works are normalized in-memory only. Persisting every
    // old project on room load can trip stricter rules and should not block read.
    if (shouldDowngrade || (publicationChanged && isVisibleStatus)) {
        try {
            const plan = await _commitWorksPublicationTransition(pid, nextStatus, publication, account, {
                expectedStatus: status,
            });
            appliedStatus = plan.projectPatch.dsfStatus;
            appliedPublication = plan.projectPatch.publication;
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
        const plan = await _commitWorksPublicationTransition(pid, newStatus, publication, account, {
            expectedStatus: proj?.dsfStatus || 'draft',
        });
        return plan.projectPatch.publication;
    } catch (err) {
        console.error('[Works] dsfStatus update error:', err);
        alert(t('works_status_failed', { message: err.message }));
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
    try {
        const account = await assertAccountCanPublish();
        const publication = _publicationFromRow(row, proj.publication || {}, status, account);
        const expiredReason = getPublicationExpireReason(publication, status, new Date());
        if (expiredReason) throw new Error(t('works_publication_cannot_publish_expired'));
        const plan = await _commitWorksPublicationTransition(pid, status, publication, account, {
            expectedStatus: status,
        });
        alert(t('works_publication_saved'));
        return plan.projectPatch.publication;
    } catch (err) {
        console.error('[Works] publication update error:', err);
        alert(t('works_period_failed', { message: err.message }));
        return null;
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
