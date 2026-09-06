import { renderReleaseHistoryControl, bindReleaseHistoryPanels } from '../../js/works-release-history-panel.js';
import { releaseInspectionKey } from '../../js/works-release-history.js';

if (import.meta.env.DEV) {
    const now = Date.now();
    const base = 'https://fixture.dsf.invalid';
    const makeRelease = id => ({ projectId: 'project', workId: 'work', releaseId: id,
        dsfLangs: ['ja', 'en'], dsfPublishedAt: new Date(now - (id === 'old' ? 60000 : 1000)),
        dsfPages: [{ urls: { ja: `${base}/users/owner/dsf/work/${id}/ja/page.webp`, en: `${base}/users/owner/dsf/work/${id}/en/page.webp` }, bytesByLang: { ja: 42, en: 42 } }],
        dsfTotalBytes: 84, publication: { listedFrom: new Date(now - 60000) },
    });
    const entries = ['new', 'old'].map(id => ({ id, data: makeRelease(id) }));
    const list = document.getElementById('list');
    let mode = 'normal', user, listener, dispose = () => {}, count;
    const services = {
        currentUser: () => user,
        subscribe: callback => { listener = callback; return () => { listener = null; }; },
        r2PublicBaseUrl: base,
        read: async path => {
            document.getElementById('reads').textContent = `読み取り ${++count} / 書き込み 0`;
            if (mode === 'failure') throw new Error('Never show this token=fixture-secret');
            if (path.length === 2 && path[0] === 'users') return { status: {} };
            if (path.includes('releases')) return entries.find(entry => entry.id === path.at(-1))?.data;
            if (path.includes('projects')) return { uid: 'owner', workId: 'work', releaseId: 'new' };
            if (path.includes('works')) return { ownerUid: 'owner', workId: 'work', projectId: 'project', latestProjectId: 'project', latestReleaseId: 'new', title: '検証作品' };
            return { authorUid: 'owner', workId: 'work', releaseId: 'new', dsfStatus: 'public',
                publication: { listedFrom: new Date(now - 60000), listedUntil: new Date(now + 86400000), publicFrom: new Date(now - 1000) } };
        },
        page: async () => ({ entries: mode === 'empty' ? [] : structuredClone(entries), cursor: null, hasMore: false }),
        inventory: async () => [],
        inspect: async input => ({ key: releaseInspectionKey(input), status: mode === 'partial' ? 'incomplete' : 'verified',
            reason: mode === 'partial' ? 'incomplete' : null, checkedAt: Date.now(),
            pageCounts: { ja: 1, en: 1 }, kindsByLanguage: { ja: { fixedText: 0, webp: 1 }, en: { fixedText: 0, webp: 1 } } }),
    };
    const reset = value => {
        dispose(); mode = value; count = 0; user = { uid: 'owner', getIdToken: async () => 'fixture-only' };
        list.innerHTML = `<div data-pid="project" data-work-id="work">${renderReleaseHistoryControl()}</div>`;
        dispose = bindReleaseHistoryPanels(list, 'owner', services);
        list.querySelector('details').open = true;
    };
    for (const id of ['empty', 'normal', 'failure', 'partial']) document.getElementById(id).onclick = () => reset(id);
    document.getElementById('signout').onclick = () => { user = null; listener?.(null); };
    reset('normal');
}
