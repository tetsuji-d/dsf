import { resolveProjectDisplayTitle } from './project-display-title.js';
import { EDITION_FOLDERS, editionIdFor, editionFolder } from './edition-policy.js';
import { buildPublicViewerUrl } from './viewer-release-route.js';
import { selectProjectListingThumbnail } from './project-listing-thumbnail.js';
import { toDate } from './publication.js';

export const editionListFolder = state => state.status === 'disposed' && state.cleanupPending ? 'archived' : editionFolder(state);
export const editionStatusLabel = (status, locale = 'ja') => ({
    ja: { public: '公開', unlisted: '限定公開', private: '非公開', archived: 'アーカイブ' },
    en: { public: 'Public', unlisted: 'Unlisted', private: 'Private', archived: 'Archive' },
})[locale === 'en' ? 'en' : 'ja'][status] || '—';
export const editionListCounts = rows => Object.fromEntries(EDITION_FOLDERS.map(folder => [folder, rows.filter(row => editionListFolder(row.state) === folder).length]));

/** One owner-edition inventory for Home and Reads. Partial loads never become totals. */
export async function loadEditionList({ uid, locale = 'ja', origin, scope, isCurrent = () => true, records, publicRecords }) {
    const assertCurrent = () => { if (!isCurrent()) throw new Error('EDITION_SESSION_CHANGED'); };
    assertCurrent();
    if (scope && scope.viewKind() !== 'all' && !scope.catalogueReady()) { await scope.load(); assertCurrent(); }
    // Start release/state reads as soon as Works arrives. A slow legacy query or
    // one slow work must not hold up every subsequent group of six works.
    const groupsPromise = records(['users', uid, 'works']).then(async works => {
        assertCurrent();
        let next = 0;
        const groups = new Array(works.length);
        await Promise.all(Array.from({ length: Math.min(6, works.length) }, async () => {
            while (next < works.length) {
                assertCurrent();
                const index = next++, work = works[index];
                const [releases, states] = await Promise.all([
                    records(['users', uid, 'works', work.id, 'releases']),
                    records(['users', uid, 'works', work.id, 'edition_states']),
                ]);
                assertCurrent(); groups[index] = { work, releases, states };
            }
        }));
        return groups;
    });
    const [groups, projects, legacy] = await Promise.all([groupsPromise, records(['users', uid, 'projects']), publicRecords(uid)]);
    assertCurrent();
    const rows = [], title = value => resolveProjectDisplayTitle(value, { locale });
    for (const { work, releases, states } of groups) {
            const workId = work.id;
            assertCurrent();
            const byId = new Map(states.map(s => [s.id, s]));
            const entries = [...releases, ...states.filter(s => s.cleanupPending && !releases.some(r => r.id === s.id))];
            rows.push(...await Promise.all(entries.map(async release => {
                const releaseId = release.id, old = legacy.find(index => index.workId === workId && index.releaseId === releaseId);
                const editionState = byId.get(releaseId) || { editionId: await editionIdFor(uid, workId, releaseId), revision: 0,
                    status: old?.dsfStatus || 'private', publication: old?.publication || release.publication || {},
                    firstPublishedAtMs: old ? 1 : null, successorEditionId: null };
                const date = toDate(release.createdAt) || toDate(release.dsfPublishedAt);
                const issuedTitle = title(editionState.publicSnapshot || release) || title(old || {});
                return { workId, releaseId, projectId: release.projectId || work.projectId, state: editionState,
                    needsEditionMigration: !!old && !byId.has(releaseId),
                    shareUrl: old && !byId.has(releaseId) ? buildPublicViewerUrl(origin, workId, releaseId) : '',
                    title: issuedTitle || title(work) || (locale === 'en' ? 'Untitled' : '無題'),
                    titleIsWorkName: !issuedTitle && !!title(work),
                    thumbnail: editionState.status === 'disposed' ? '' : editionState.publicSnapshot?.thumbnail || selectProjectListingThumbnail({}, { release }) || old?.thumbnail || '',
                    date: date?.toLocaleString(locale === 'en' ? 'en-US' : 'ja-JP') || '—', sort: date?.getTime() || 0 };
            })));
        assertCurrent();
    }
    // Keep pre-Release publications visible, explicitly marked for migration.
    for (const project of projects) {
        if (rows.some(row => row.projectId === project.id) || !(project.dsfPages?.length || project.dsfSchemaVersion === 2)) continue;
        const date = toDate(project.dsfPublishedAt);
        const publicIndex = legacy.find(index => index.projectId === project.id || index.workId === (project.workId || project.id) || index.id === (project.workId || project.id));
        rows.push({ legacy: true, workId: project.workId || project.id, projectId: project.id,
            shareUrl: publicIndex ? buildPublicViewerUrl(origin, publicIndex.workId || project.workId || project.id, publicIndex.releaseId || '') : '',
            title: title(project) || project.projectName || (locale === 'en' ? 'Untitled' : '無題'), date: date?.toLocaleString(locale === 'en' ? 'en-US' : 'ja-JP') || '—', sort: date?.getTime() || 0,
            state: { editionId: 'legacy_' + rows.length, status: project.dsfStatus || 'private', publication: project.publication || {} } });
    }
    assertCurrent();
    const visible = rows.filter(row => row.state.status !== 'disposed' || row.state.cleanupPending);
    return filterEditionList(visible, scope);
}

export function filterEditionList(rows, scope) {
    if (scope && scope.viewKind() !== 'all') {
        if (!scope.catalogueReady()) throw new Error('EDITION_SCOPE_UNAVAILABLE');
        const allowed = new Set(scope.filter(rows.map(row => ({ id: row.projectId }))).map(row => row.id));
        return rows.filter(row => allowed.has(row.projectId)).sort((a, b) => b.sort - a.sort);
    }
    return [...rows].sort((a, b) => b.sort - a.sort);
}
