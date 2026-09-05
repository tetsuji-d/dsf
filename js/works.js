/**
 * works.js — Works Room
 * 発行済み作品の DSF ステータス管理
 */
import {
    collection, getDocs, doc, deleteDoc, serverTimestamp, writeBatch, runTransaction, query, where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { state } from './state.js';
import { assertAccountCanEdit, assertAccountCanPublish, auth, db } from './firebase.js';
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
import { resolveProjectDisplayTitle, resolveProjectName } from './project-display-title.js';
import { selectProjectListingThumbnail } from './project-listing-thumbnail.js';
import { fetchDsfReleaseInventoryPages } from './dsf-release-inventory-client.js';
import { createDsfReleaseStorageAudit } from './dsf-release-orphan-inventory.js';
import {
    createDsfReleaseOperationDiagnostic,
    DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS,
} from './dsf-release-operation-diagnostic.js';

const DSF_STATUS_LABELS = {
    draft:    { labelKey: 'works_status_draft',   icon: 'edit_note', cls: 'dsf-draft'    },
    unlisted: { labelKey: 'works_status_unlisted', icon: 'link', cls: 'dsf-unlisted' },
    public:   { labelKey: 'works_status_public',     icon: 'public', cls: 'dsf-public'   },
    private:  { labelKey: 'works_status_private',   icon: 'lock', cls: 'dsf-private'  },
};
let _worksViewCache = null;
let _worksViewLoadState = { uid: null, phase: 'idle', error: '' };
let _worksLoadGeneration = 0;
const _worksPendingProjectKeys = new Set();

function _statusInfo(status) {
    const info = DSF_STATUS_LABELS[status] || DSF_STATUS_LABELS.draft;
    return { ...info, label: t(info.labelKey) };
}

function _isCurrentWorksLoad(uid, generation) {
    return state.uid === uid && _worksLoadGeneration === generation;
}

function _assertCurrentWorksOwner(uid) {
    if (!uid || state.uid !== uid) {
        throw new Error('Works owner session changed. Reopen Works and try again.');
    }
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

function _resolveWorksRelease(data, pid, uid = state.uid) {
    return resolveWorksDsfRelease(data, {
        uid,
        workId: data.workId || pid,
        releaseId: data.releaseId || '',
        allowedContentOrigins: _getWorksAllowedContentOrigins(),
    });
}

/**
 * Works Room を開く。
 * @param {boolean} roomMode - true のとき #works-room にインライン描画、false のときモーダル
 * @param {{ useCache?: boolean }} options - UI再翻訳時だけ取得済みデータを再利用
 */
export async function openWorksRoom(roomMode = false, options = {}) {
    const listEl = roomMode
        ? document.getElementById('works-room-list')
        : document.getElementById('works-list');
    const modalEl = document.getElementById('works-modal');

    if (!roomMode && modalEl) modalEl.classList.add('visible');
    if (!listEl) return;

    if (!state.uid) {
        _worksLoadGeneration += 1;
        _worksViewCache = null;
        _worksViewLoadState = { uid: null, phase: 'login', error: '' };
        listEl.innerHTML = `<div class="works-loading">${_esc(t('works_login_required'))}</div>`;
        return;
    }

    const ownerUid = state.uid;
    const cachedView = options.useCache === true && _worksViewCache?.uid === ownerUid
        ? _worksViewCache
        : null;
    const loadGeneration = cachedView ? _worksLoadGeneration : ++_worksLoadGeneration;
    if (!cachedView) {
        _worksViewCache = null;
        _worksViewLoadState = { uid: ownerUid, phase: 'loading', error: '' };
        listEl.innerHTML = `<div class="works-loading">${_esc(t('works_loading'))}</div>`;
    }

    try {
        const account = cachedView ? cachedView.account : await assertAccountCanEdit();
        if (!_isCurrentWorksLoad(ownerUid, loadGeneration)) return;
        const projects = cachedView ? cachedView.projects : [];
        if (!cachedView) {
            const snap = await getDocs(collection(db, 'users', ownerUid, 'projects'));
            if (!_isCurrentWorksLoad(ownerUid, loadGeneration)) return;
            for (const docSnap of snap.docs) {
                if (!_isCurrentWorksLoad(ownerUid, loadGeneration)) return;
                const d = docSnap.data() || {};
                let release;
                try {
                    release = _resolveWorksRelease(d, docSnap.id, ownerUid);
                } catch (error) {
                    console.warn('[Works] invalid DSF release metadata skipped:', docSnap.id, error?.message || error);
                    continue;
                }
                const reconciled = await _reconcileProjectPublication(docSnap.id, d, account, ownerUid);
                if (!_isCurrentWorksLoad(ownerUid, loadGeneration)) return;
                projects.push({
                    ...d,
                    ...release.deliveryFields,
                    id:             docSnap.id,
                    workId:         d.workId || docSnap.id,
                    releaseId:      d.releaseId || null,
                    releaseKind:    release.releaseKind,
                    title:          d.title || '',
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
            if (!_isCurrentWorksLoad(ownerUid, loadGeneration)) return;
            _worksViewCache = { uid: ownerUid, account, projects };
            _worksViewLoadState = { uid: ownerUid, phase: 'ready', error: '' };
        }

        if (!_isCurrentWorksLoad(ownerUid, loadGeneration)) return;

        const worksContent = !projects.length
            ? `
                <div class="works-empty">
                    <span class="material-icons" style="font-size:48px;color:#555;display:block;margin-bottom:12px;">library_books</span>
                    <p>${_esc(t('works_empty_title'))}</p>
                    <p class="works-empty-sub">${_esc(t('works_empty_body'))}</p>
                    <button class="home-action-btn" onclick="window.switchRoom('press')" style="margin-top:16px;">
                        <span class="material-icons">publish</span> ${_esc(t('works_open_press'))}
                    </button>
                </div>`
            : projects.map(p => _renderRow(p, account)).join('');

        listEl.innerHTML = `${_renderReleaseStorageAuditPanel()}${worksContent}`;
        _bindReleaseStorageAuditPanel(listEl, ownerUid);
        if (!projects.length) return;
        projects.forEach(project => {
            if (_isWorksProjectPending(ownerUid, project.id)) {
                _setWorksProjectPending(listEl, project.id, true);
            }
        });

        // DSF ステータス変更イベント
        listEl.querySelectorAll('.works-dsf-select').forEach(sel => {
            sel.addEventListener('change', async () => {
                const pid       = sel.dataset.pid;
                const newStatus = sel.value;
                const row       = sel.closest('.works-row');
                const badge     = row?.querySelector('.works-dsf-badge');
                const prevStatus = sel.dataset.prev || 'draft';
                const proj = projects.find(x => x.id === pid);
                if (!_beginWorksProjectMutation(listEl, ownerUid, pid)) {
                    sel.value = prevStatus;
                    return;
                }
                try {
                    if (badge) {
                        const info = _statusInfo(newStatus);
                        badge.innerHTML = `${_statusIcon(info.icon)}<span>${info.label}</span>`;
                        badge.className   = `works-dsf-badge ${info.cls}`;
                    }
                    const updated = await _updateDsfStatus(pid, newStatus, proj, row, ownerUid);
                    if (updated && proj) {
                        proj.dsfStatus = newStatus;
                        proj.publication = updated;
                        _patchCurrentWorksCache(ownerUid, pid, {
                            dsfStatus: newStatus,
                            publication: updated,
                        }, proj);
                        sel.dataset.prev = newStatus;
                        if (row?.isConnected) {
                            _refreshViewerAction(row, proj);
                            _refreshRowPublication(row, proj, account, ownerUid);
                        } else {
                            void refreshWorksRoomLanguage(roomMode);
                        }
                    } else {
                        sel.value = prevStatus;
                        if (badge) {
                            const info = _statusInfo(prevStatus);
                            badge.innerHTML = `${_statusIcon(info.icon)}<span>${info.label}</span>`;
                            badge.className = `works-dsf-badge ${info.cls}`;
                        }
                    }
                } finally {
                    _endWorksProjectMutation(listEl, ownerUid, pid);
                }
            });
        });

        listEl.querySelectorAll('.works-publication-save').forEach(btn => {
            btn.addEventListener('click', async () => {
                const pid = btn.dataset.pid;
                const row = btn.closest('.works-row');
                const proj = projects.find(x => x.id === pid);
                if (!_beginWorksProjectMutation(listEl, ownerUid, pid)) return;
                try {
                    const updated = await _updatePublicationWindow(pid, proj, row, ownerUid);
                    if (updated && proj) {
                        proj.publication = updated;
                        _patchCurrentWorksCache(ownerUid, pid, { publication: updated }, proj);
                        if (row?.isConnected) {
                            _refreshRowPublication(row, proj, account, ownerUid);
                        } else {
                            void refreshWorksRoomLanguage(roomMode);
                        }
                    }
                } finally {
                    _endWorksProjectMutation(listEl, ownerUid, pid);
                }
            });
        });

        // 削除ボタン
        listEl.querySelectorAll('.works-btn-delete').forEach(btn => {
            btn.addEventListener('click', async () => {
                const pid = btn.dataset.deletePid;
                const proj = projects.find(x => x.id === pid);
                const row = btn.closest('.works-row');
                if (state.uid !== ownerUid) return;
                if (!confirm(t('works_delete_confirm', { name: _getWorksDisplayTitle(proj) }))) return;
                if (!_beginWorksProjectMutation(listEl, ownerUid, pid)) return;
                try {
                    const batch = writeBatch(db);
                    batch.delete(doc(db, 'users', ownerUid, 'projects', pid, 'authoring', 'current'));
                    batch.delete(doc(db, 'users', ownerUid, 'projects', pid));
                    stageProjectSummaryDelete(batch, db, ownerUid, pid);
                    await batch.commit();
                    if (proj?.workId) {
                        await deleteDoc(doc(db, 'public_projects', proj.workId)).catch(() => {});
                    }
                    await deleteDoc(doc(db, 'public_projects', pid)).catch(() => {});
                    _removeWorksProject(projects, pid);
                    if (_worksViewCache?.uid === ownerUid && _worksViewCache.projects !== projects) {
                        _removeWorksProject(_worksViewCache.projects, pid);
                    }
                    if (row?.isConnected) {
                        row.remove();
                    } else {
                        void refreshWorksRoomLanguage(roomMode);
                    }
                } catch (err) {
                    alert(t('works_delete_failed', { message: err.message }));
                } finally {
                    _endWorksProjectMutation(listEl, ownerUid, pid);
                }
            });
        });

    } catch (err) {
        if (!_isCurrentWorksLoad(ownerUid, loadGeneration)) return;
        console.error('[Works] load error:', err);
        _worksViewCache = null;
        _worksViewLoadState = { uid: ownerUid, phase: 'error', error: err?.message || String(err) };
        listEl.innerHTML = `<div class="works-loading">${_esc(t('works_load_failed', { message: err.message }))}</div>`;
    }
}

/** Works Room モーダルを閉じる */
export function closeWorksRoom() {
    document.getElementById('works-modal')?.classList.remove('visible');
}

// ---- Private helpers -------------------------------------------------------

function _renderReleaseStorageAuditPanel() {
    return `
        <section class="works-release-audit" data-works-release-audit>
            <div class="works-release-audit-head">
                <div>
                    <h3>${_esc(t('works_release_audit_title'))}</h3>
                    <p>${_esc(t('works_release_audit_description'))}</p>
                </div>
                <button type="button" class="works-release-audit-run"
                    data-works-release-audit-run>
                    <span class="material-icons" aria-hidden="true">fact_check</span>
                    <span>${_esc(t('works_release_audit_run'))}</span>
                </button>
            </div>
            <div class="works-release-audit-result"
                data-works-release-audit-result aria-live="polite" hidden></div>
        </section>`;
}

function _bindReleaseStorageAuditPanel(listEl, ownerUid) {
    const panel = listEl?.querySelector('[data-works-release-audit]');
    const button = panel?.querySelector('[data-works-release-audit-run]');
    const result = panel?.querySelector('[data-works-release-audit-result]');
    if (!panel || !button || !result) return;

    button.addEventListener('click', async () => {
        if (button.disabled) return;
        button.disabled = true;
        panel.setAttribute('aria-busy', 'true');
        result.hidden = false;
        result.className = 'works-release-audit-result is-loading';
        result.setAttribute('role', 'status');
        result.innerHTML = `<span class="works-release-audit-spinner" aria-hidden="true"></span>${_esc(t('works_release_audit_running'))}`;
        try {
            _assertCurrentWorksOwner(ownerUid);
            const user = auth.currentUser;
            if (!user || user.uid !== ownerUid) {
                throw Object.assign(new Error('Owner session is unavailable.'), {
                    code: 'DSF_RELEASE_INVENTORY_AUTH_REQUIRED',
                });
            }
            const token = await user.getIdToken(false);
            _assertCurrentWorksOwner(ownerUid);
            const [inventoryPages, references] = await Promise.all([
                fetchDsfReleaseInventoryPages({ token }),
                _loadReleaseStorageAuditReferences(ownerUid),
            ]);
            _assertCurrentWorksOwner(ownerUid);
            const audit = createDsfReleaseStorageAudit({
                uid: ownerUid,
                inventoryPages,
                ...references,
            });
            if (!panel.isConnected || state.uid !== ownerUid) return;
            result.className = 'works-release-audit-result is-ready';
            result.setAttribute('role', 'status');
            result.innerHTML = _renderReleaseStorageAuditResult(audit);
        } catch (error) {
            console.error('[Works] release storage audit failed:', error?.code || error?.name || 'unknown');
            if (!panel.isConnected || state.uid !== ownerUid) return;
            const code = typeof error?.code === 'string' ? error.code : 'DSF_RELEASE_AUDIT_FAILED';
            result.className = 'works-release-audit-result is-error';
            result.setAttribute('role', 'alert');
            result.innerHTML = `<strong>${_esc(t('works_release_audit_error'))}</strong><code>${_esc(code)}</code>`;
        } finally {
            if (panel.isConnected) {
                button.disabled = false;
                panel.removeAttribute('aria-busy');
            }
        }
    });
}

async function _loadReleaseStorageAuditReferences(ownerUid) {
    _assertCurrentWorksOwner(ownerUid);
    const [projectsSnapshot, worksSnapshot, publicSnapshot] = await Promise.all([
        getDocs(collection(db, 'users', ownerUid, 'projects')),
        getDocs(collection(db, 'users', ownerUid, 'works')),
        getDocs(query(collection(db, 'public_projects'), where('authorUid', '==', ownerUid))),
    ]);
    _assertCurrentWorksOwner(ownerUid);
    const works = worksSnapshot.docs.map((snapshot) => ({
        ...snapshot.data(),
        workId: snapshot.id,
    }));
    const releases = [];
    const batchSize = 8;
    for (let start = 0; start < works.length; start += batchSize) {
        const batch = works.slice(start, start + batchSize);
        const snapshots = await Promise.all(batch.map((work) => getDocs(
            collection(db, 'users', ownerUid, 'works', work.workId, 'releases'),
        )));
        _assertCurrentWorksOwner(ownerUid);
        snapshots.forEach((snapshot, index) => {
            const workId = batch[index].workId;
            snapshot.docs.forEach((releaseSnapshot) => {
                releases.push({
                    ...releaseSnapshot.data(),
                    workId,
                    releaseId: releaseSnapshot.id,
                });
            });
        });
    }
    const publicIndexes = publicSnapshot.docs.map((snapshot) => ({
        ...snapshot.data(),
        workId: snapshot.data()?.workId || snapshot.id,
    }));
    return {
        projects: projectsSnapshot.docs.map((snapshot) => ({
            ...snapshot.data(),
            projectId: snapshot.id,
        })),
        works,
        releases,
        publicIndexes,
    };
}

function _releaseAuditClassificationLabel(classification) {
    const keys = {
        published: 'works_release_audit_class_published',
        current: 'works_release_audit_class_current',
        'historical-release': 'works_release_audit_class_historical',
        'detached-release-history': 'works_release_audit_class_detached',
        'recent-untracked-upload': 'works_release_audit_class_recent_untracked',
        'aged-untracked-upload': 'works_release_audit_class_aged_untracked',
        'untracked-upload-unknown-age': 'works_release_audit_class_unknown_age',
        'referenced-release-missing': 'works_release_audit_class_reference_missing',
    };
    return t(keys[classification] || 'works_release_audit_class_unknown');
}

function _releaseAuditActionLabel(action) {
    const keys = {
        retain: 'works_release_audit_action_retain',
        repair: 'works_release_audit_action_repair',
        review: 'works_release_audit_action_review',
        wait: 'works_release_audit_action_wait',
    };
    return t(keys[action] || 'works_release_audit_action_review');
}

function _formatReleaseAuditBytes(value) {
    const bytes = Number.isFinite(value) && value >= 0 ? value : 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function _renderReleaseStorageAuditResult(audit) {
    const groups = audit.releaseGroups || [];
    const grouped = new Map();
    groups.forEach((group) => {
        if (!grouped.has(group.classification)) grouped.set(group.classification, []);
        grouped.get(group.classification).push(group);
    });
    const priority = [
        'referenced-release-missing',
        'detached-release-history',
        'aged-untracked-upload',
        'untracked-upload-unknown-age',
        'recent-untracked-upload',
        'published',
        'current',
        'historical-release',
    ];
    const statusText = audit.complete
        ? t('works_release_audit_complete')
        : t('works_release_audit_incomplete');
    const summary = t('works_release_audit_summary', {
        roots: audit.summary.releaseRootCount,
        files: audit.summary.returnedObjectCount,
        size: _formatReleaseAuditBytes(audit.summary.totalReleaseBytes),
        issues: audit.issues.length,
    });
    const groupMarkup = priority
        .filter((classification) => grouped.has(classification))
        .map((classification) => {
            const items = grouped.get(classification);
            const shouldOpen = items.some((item) => ['repair', 'review'].includes(item.recommendedAction));
            const itemMarkup = items.map((item) => {
                const issues = item.issueCodes.length
                    ? `<code>${_esc(item.issueCodes.join(', '))}</code>`
                    : '';
                return `
                    <li>
                        <span><b>${_esc(item.workId)}</b> / ${_esc(item.releaseId)}</span>
                        <span>${_esc(t('works_release_audit_group_meta', {
                            files: item.fileCount,
                            size: _formatReleaseAuditBytes(item.totalBytes),
                            action: _releaseAuditActionLabel(item.recommendedAction),
                        }))}</span>
                        ${issues}
                    </li>`;
            }).join('');
            return `
                <details class="works-release-audit-group" ${shouldOpen ? 'open' : ''}>
                    <summary>
                        <span>${_esc(_releaseAuditClassificationLabel(classification))}</span>
                        <span>${items.length}</span>
                    </summary>
                    <ul>${itemMarkup}</ul>
                </details>`;
        }).join('');
    const empty = groups.length ? '' : `<p class="works-release-audit-empty">${_esc(t('works_release_audit_empty'))}</p>`;
    return `
        <div class="works-release-audit-summary">
            <span class="${audit.complete ? 'is-complete' : 'is-incomplete'}">${_esc(statusText)}</span>
            <strong>${_esc(summary)}</strong>
        </div>
        <p class="works-release-audit-readonly">
            <span class="material-icons" aria-hidden="true">visibility</span>
            ${_esc(t('works_release_audit_review_only'))}
        </p>
        ${empty}${groupMarkup}`;
}

function _clearWorksOperationDiagnostic(row) {
    const target = row?.querySelector('[data-works-operation-diagnostic]');
    if (!target) return;
    target.hidden = true;
    target.className = 'works-operation-diagnostic';
    target.replaceChildren();
}

function _renderWorksOperationDiagnostic(row, error, requestedStatus) {
    const target = row?.querySelector('[data-works-operation-diagnostic]');
    if (!target) return;
    const diagnostic = createDsfReleaseOperationDiagnostic(error);
    const classificationKeys = {
        [DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS.RETRY_SAFE]: 'works_operation_retry_safe',
        [DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS.REFRESH_REQUIRED]: 'works_operation_refresh_required',
        [DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS.BLOCKED]: 'works_operation_blocked',
    };
    const safeParts = [diagnostic.code, diagnostic.remoteCode, diagnostic.path].filter(Boolean);
    const isTitleRequired = diagnostic.code === 'WORKS_PUBLICATION_TITLE_REQUIRED';
    const isThumbnailRequired = diagnostic.code === 'WORKS_PUBLICATION_THUMBNAIL_REQUIRED'
        || diagnostic.code === 'WORKS_PUBLICATION_THUMBNAIL_INVALID';
    let actionMarkup = '';
    if (diagnostic.classification === DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS.RETRY_SAFE) {
        actionMarkup = `<button type="button" data-works-operation-retry>${_esc(t('works_operation_retry'))}</button>`;
    } else if (diagnostic.classification === DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS.REFRESH_REQUIRED) {
        actionMarkup = `<button type="button" data-works-operation-refresh>${_esc(t('works_operation_refresh'))}</button>`;
    }
    target.hidden = false;
    target.className = `works-operation-diagnostic is-${_esc(diagnostic.classification)}`;
    target.setAttribute('role', 'alert');
    target.innerHTML = `
        <div>
            <strong>${_esc(isTitleRequired
                ? t('works_publication_title_required')
                : isThumbnailRequired
                    ? t('works_publication_thumbnail_required')
                    : t(classificationKeys[diagnostic.classification]))}</strong>
            <span>${_esc(t('works_operation_diagnostic_code', { code: safeParts.join(' · ') }))}</span>
        </div>
        ${actionMarkup}`;

    target.querySelector('[data-works-operation-retry]')?.addEventListener('click', () => {
        const select = row.querySelector('.works-dsf-select');
        if (!select || select.disabled) return;
        select.value = requestedStatus;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    target.querySelector('[data-works-operation-refresh]')?.addEventListener('click', () => {
        const listEl = row.closest('#works-room-list, #works-list');
        void openWorksRoom(listEl?.id === 'works-room-list');
    });
}

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
    const explicitWorkTitle = resolveProjectDisplayTitle(p, { locale: getUILang() });
    const projectName = resolveProjectName(p);
    const displayTitle = explicitWorkTitle || projectName || t('works_untitled');
    const nameContext = explicitWorkTitle && projectName
        ? t('works_project_name', { name: projectName })
        : (!explicitWorkTitle && projectName ? t('works_title_fallback') : '');
    return `
        <div class="works-row" data-pid="${_esc(p.id)}" data-work-id="${_esc(p.workId || p.id)}" data-release-id="${_esc(p.releaseId || '')}">
            <div class="works-thumb">${thumb}</div>
            <div class="works-info">
                <div class="works-title">${_esc(displayTitle)}</div>
                ${nameContext ? `<div class="works-name-context">${_esc(nameContext)}</div>` : ''}
                <div class="works-meta">${_esc(releaseMeta)}</div>
                <div data-publication-meta>${publicationMeta}</div>
                ${publicationEditor}
                <div class="works-meta">${_esc(t('works_published_on', { date }))}</div>
                <div class="works-operation-diagnostic" data-works-operation-diagnostic hidden></div>
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

function _setWorksProjectPending(listEl, pid, pending) {
    if (!listEl || !pid) return;
    Array.from(listEl.querySelectorAll('.works-row'))
        .filter(row => row.dataset.pid === pid)
        .forEach(row => {
            row.querySelectorAll('.works-dsf-select, .works-publication-save, .works-btn-delete')
                .forEach(control => {
                    if (pending) {
                        if (control.dataset.worksPendingWasDisabled === undefined) {
                            control.dataset.worksPendingWasDisabled = control.disabled ? 'true' : 'false';
                        }
                        control.disabled = true;
                        return;
                    }
                    if (control.dataset.worksPendingWasDisabled === undefined) return;
                    control.disabled = control.dataset.worksPendingWasDisabled === 'true';
                    delete control.dataset.worksPendingWasDisabled;
                });
        });
}

function _worksProjectMutationKey(ownerUid, pid) {
    return `${ownerUid || ''}\u0000${pid || ''}`;
}

function _isWorksProjectPending(ownerUid, pid) {
    return _worksPendingProjectKeys.has(_worksProjectMutationKey(ownerUid, pid));
}

function _patchCurrentWorksCache(ownerUid, pid, patch, sourceProject = null) {
    if (_worksViewCache?.uid !== ownerUid) return;
    const cachedProject = _worksViewCache.projects.find(project => project.id === pid);
    if (!cachedProject || cachedProject === sourceProject) return;
    Object.assign(cachedProject, patch);
}

function _removeWorksProject(projects, pid) {
    const projectIndex = projects.findIndex(project => project.id === pid);
    if (projectIndex >= 0) projects.splice(projectIndex, 1);
}

function _beginWorksProjectMutation(listEl, ownerUid, pid) {
    const key = _worksProjectMutationKey(ownerUid, pid);
    if (!ownerUid || !pid || _worksPendingProjectKeys.has(key)) return false;
    _worksPendingProjectKeys.add(key);
    _setWorksProjectPending(listEl, pid, true);
    return true;
}

function _endWorksProjectMutation(listEl, ownerUid, pid) {
    _worksPendingProjectKeys.delete(_worksProjectMutationKey(ownerUid, pid));
    _setWorksProjectPending(listEl, pid, false);
}

/** UI言語切替時に、取得済みのWorks一覧だけを再翻訳して描画する。 */
export async function refreshWorksRoomLanguage(roomMode = true) {
    const listEl = roomMode
        ? document.getElementById('works-room-list')
        : document.getElementById('works-list');
    if (_worksViewCache?.uid !== state.uid) {
        if (listEl) {
            const isCurrentError = state.uid && _worksViewLoadState.uid === state.uid
                && _worksViewLoadState.phase === 'error';
            const message = !state.uid
                ? t('works_login_required')
                : isCurrentError
                    ? t('works_load_failed', { message: _worksViewLoadState.error })
                    : t('works_loading');
            listEl.innerHTML = `<div class="works-loading">${_esc(message)}</div>`;
        }
        return false;
    }
    const pendingPublicationValues = new Map(
        Array.from(listEl?.querySelectorAll('.works-row') || []).map(row => [
            row.dataset.pid,
            {
                publicFrom: row.querySelector('[data-public-from]')?.value || '',
                publicUntil: row.querySelector('[data-public-until]')?.value || '',
            },
        ]),
    );
    await openWorksRoom(roomMode, { useCache: true });
    Array.from(listEl?.querySelectorAll('.works-row') || []).forEach(row => {
        const pending = pendingPublicationValues.get(row.dataset.pid);
        if (!pending) return;
        const publicFrom = row.querySelector('[data-public-from]');
        const publicUntil = row.querySelector('[data-public-until]');
        if (publicFrom) publicFrom.value = pending.publicFrom;
        if (publicUntil) publicUntil.value = pending.publicUntil;
    });
    return true;
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
    const uid = options.ownerUid || state.uid;
    if (!uid || !pid) throw new Error('Publication transition requires an authenticated owner and project.');
    _assertCurrentWorksOwner(uid);
    const expectedStatus = options.expectedStatus || null;
    const fallbackAuthorName = state.user?.displayName || state.user?.email || '';

    return runTransaction(db, async (transaction) => {
        _assertCurrentWorksOwner(uid);
        const projectRef = doc(db, 'users', uid, 'projects', pid);
        const projectSnapshot = await transaction.get(projectRef);
        _assertCurrentWorksOwner(uid);
        if (!projectSnapshot.exists()) throw new Error('公開元のProjectが見つかりません。');
        const project = projectSnapshot.data() || {};
        const currentStatus = project.dsfStatus || 'draft';
        if (expectedStatus && currentStatus !== expectedStatus) {
            throw Object.assign(
                new Error('作品の公開状態が別の操作で変更されました。Worksを開き直して再試行してください。'),
                { code: 'WORKS_PUBLICATION_STATE_STALE' },
            );
        }

        const workId = String(project.workId || pid).trim();
        const releaseId = String(project.releaseId || '').trim();
        let work = null;
        let release = null;
        if (releaseId) {
            const workSnapshot = await transaction.get(doc(db, 'users', uid, 'works', workId));
            _assertCurrentWorksOwner(uid);
            const releaseSnapshot = await transaction.get(doc(db, 'users', uid, 'works', workId, 'releases', releaseId));
            _assertCurrentWorksOwner(uid);
            work = workSnapshot.exists() ? workSnapshot.data() : null;
            release = releaseSnapshot.exists() ? releaseSnapshot.data() : null;
        }

        const publicIndexes = {};
        const publicRef = doc(db, 'public_projects', workId);
        const publicSnapshot = await transaction.get(publicRef);
        _assertCurrentWorksOwner(uid);
        publicIndexes[workId] = publicSnapshot.exists() ? publicSnapshot.data() : null;
        if (workId !== pid) {
            const legacyPublicSnapshot = await transaction.get(doc(db, 'public_projects', pid));
            _assertCurrentWorksOwner(uid);
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
            publicationThumbnailR2BaseUrl: import.meta.env.VITE_R2_PUBLIC_URL,
            publicationThumbnailFirebaseStorageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
            publicIndexes,
        });

        _assertCurrentWorksOwner(uid);

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

async function _reconcileProjectPublication(pid, data, account, ownerUid = state.uid) {
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
                ownerUid,
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

function _refreshRowPublication(row, proj, account = {}, ownerUid = state.uid) {
    if (!row || !proj) return;
    const listEl = row.closest('#works-room-list, #works-list');
    const roomMode = listEl?.id === 'works-room-list';
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
            if (!_beginWorksProjectMutation(listEl, ownerUid, proj.id)) return;
            try {
                const updated = await _updatePublicationWindow(proj.id, proj, row, ownerUid);
                if (updated) {
                    proj.publication = updated;
                    _patchCurrentWorksCache(ownerUid, proj.id, { publication: updated }, proj);
                    if (row.isConnected) {
                        _refreshRowPublication(row, proj, account, ownerUid);
                    } else {
                        void refreshWorksRoomLanguage(roomMode);
                    }
                }
            } finally {
                _endWorksProjectMutation(listEl, ownerUid, proj.id);
            }
        });
    }
    if (_isWorksProjectPending(ownerUid, proj.id)) {
        _setWorksProjectPending(listEl, proj.id, true);
    }
}

async function _updateDsfStatus(pid, newStatus, proj, row, ownerUid = state.uid) {
    if (!ownerUid || state.uid !== ownerUid || !pid) return null;
    _clearWorksOperationDiagnostic(row);
    try {
        let account = null;
        if (newStatus === 'public' || newStatus === 'unlisted') {
            account = await assertAccountCanPublish();
        } else {
            account = await assertAccountCanEdit();
        }
        if (state.uid !== ownerUid) return null;
        const publication = _publicationFromRow(row, proj?.publication || {}, newStatus, account);
        if ((newStatus === 'public' || newStatus === 'unlisted') && !isPublicationActive(publication, newStatus)) {
            const reason = getPublicationExpireReason(publication, newStatus, new Date());
            if (reason) {
                throw new Error(t('works_publication_cannot_publish_expired'));
            }
        }
        const plan = await _commitWorksPublicationTransition(pid, newStatus, publication, account, {
            expectedStatus: proj?.dsfStatus || 'draft',
            ownerUid,
        });
        if (state.uid !== ownerUid) return null;
        return plan.projectPatch.publication;
    } catch (err) {
        console.error('[Works] dsfStatus update error:', err);
        _renderWorksOperationDiagnostic(row, err, newStatus);
        return null;
    }
}

async function _updatePublicationWindow(pid, proj, row, ownerUid = state.uid) {
    if (!ownerUid || state.uid !== ownerUid || !pid || !proj) return null;
    const status = proj.dsfStatus || 'draft';
    if (!(status === 'public' || status === 'unlisted')) {
        alert(t('works_publication_visible_only'));
        return null;
    }
    try {
        const account = await assertAccountCanPublish();
        if (state.uid !== ownerUid) return null;
        const publication = _publicationFromRow(row, proj.publication || {}, status, account);
        const expiredReason = getPublicationExpireReason(publication, status, new Date());
        if (expiredReason) throw new Error(t('works_publication_cannot_publish_expired'));
        const plan = await _commitWorksPublicationTransition(pid, status, publication, account, {
            expectedStatus: status,
            ownerUid,
        });
        if (state.uid !== ownerUid) return null;
        alert(t('works_publication_saved'));
        return plan.projectPatch.publication;
    } catch (err) {
        console.error('[Works] publication update error:', err);
        alert(t('works_period_failed', { message: err.message }));
        return null;
    }
}

function _getThumbnail(data) {
    return selectProjectListingThumbnail(data) || null;
}

function _getWorksDisplayTitle(project) {
    return resolveProjectDisplayTitle(project, {
        locale: getUILang(),
        includeProjectName: true,
    }) || t('works_untitled');
}

function _esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function _statusIcon(name) {
    return `<span class="material-icons" aria-hidden="true">${_esc(name)}</span>`;
}
