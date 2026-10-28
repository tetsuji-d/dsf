/** Reads manages editions; the manuscript Trash is a separate feature. */
import { openEditionReads, disposeEditionReads } from './edition-reads.js';
import { collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { state } from './state.js';
import { auth, db } from './firebase.js';
import { t } from './i18n-studio.js';
import { fetchDsfReleaseInventoryPages } from './dsf-release-inventory-client.js';
import { createDsfReleaseStorageAudit } from './dsf-release-orphan-inventory.js';
function _assertCurrentWorksOwner(uid) {
    if (!uid || state.uid !== uid) throw new Error('Reads owner session changed. Reopen Reads.');
}
let readsScope = () => null, readsSelection = {};
export function selectReadsEdition(folder = 'private', editionId = '') { readsSelection = { folder, editionId }; }
export function configureReadsScope(read) { readsScope = read; }
export async function openWorksRoom(roomMode = false) {
    const root = document.getElementById(roomMode ? 'works-room-list' : 'works-list');
    if (!roomMode) document.getElementById('works-modal')?.classList.add('visible');
    if (!root) return;
    root.innerHTML = '<div data-edition-reads-root></div>';
    if (state.uid) {
        root.insertAdjacentHTML('beforeend', _renderReleaseStorageAuditPanel());
        _bindReleaseStorageAuditPanel(root, state.uid);
    }
    const selection = readsSelection; readsSelection = {};
    await openEditionReads(root.querySelector('[data-edition-reads-root]'), readsScope(), selection);
}

/** Works Room モーダルを閉じる */
export function closeWorksRoom() {
    disposeEditionReads();
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
    const [projectsSnapshot, worksSnapshot, publicSnapshot, editionSnapshot] = await Promise.all([
        getDocs(collection(db, 'users', ownerUid, 'projects')),
        getDocs(collection(db, 'users', ownerUid, 'works')),
        getDocs(query(collection(db, 'public_projects'), where('authorUid', '==', ownerUid))),
        getDocs(query(collection(db, 'public_editions'), where('authorUid', '==', ownerUid))),
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
    const publicIndexes = [...publicSnapshot.docs, ...editionSnapshot.docs.filter(snapshot => ['public','unlisted'].includes(snapshot.data().dsfStatus))].map((snapshot) => ({
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

export async function refreshWorksRoomLanguage(roomMode = true) {
    await openWorksRoom(roomMode); return true;
}
function _esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function _statusIcon(name) {
    return `<span class="material-icons" aria-hidden="true">${_esc(name)}</span>`;
}
