import { mountEditionReads } from '../../js/edition-reads-view.js';
import { editionIdFor, nextEditionStatus } from '../../js/edition-policy.js';
import { resolvePublicEdition } from '../../js/edition-reader.js';
import { confirmEditionAction } from '../../js/edition-dialog.js';

let rows, view, locale = 'ja', owner = true, failNext = false, hangNext = false;
// Exercise the same legacy selectors as the real Studio shell, not width alone.
const phoneQuery = matchMedia('(max-width: 1023px)');
const syncDevice = () => { document.body.dataset.device = phoneQuery.matches ? 'mobile' : 'desktop'; };
phoneQuery.addEventListener('change', syncDevice); syncDevice();
const root = document.getElementById('fixture-reads'), output = document.getElementById('fixture-log');
const reset = async () => {
    view?.dispose(); owner = true;
    rows = await Promise.all([['novel','first','図書館 ALPHA','初版'],['novel','second','図書館 ALPHA','第二版'],['photos','first','写真集','']].map(async ([workId,releaseId,title,editionLabel], index) => ({
        workId, releaseId, title, date:'2026/10/24', sort:Date.UTC(2026,9,24-index,2,30), thumbnail: workId === 'novel' && releaseId === 'first' ? 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="90" height="160"><path fill="white" d="M0 0h90v160H0z"/><text x="45" y="80" text-anchor="middle" font-size="8">白い表紙</text></svg>') : '', state: { editionLabel, revision:0, editionId:await editionIdFor('fixture',workId,releaseId),status:'private',firstPublishedAtMs:null },
    })));
    output.textContent = ''; mount();
};
function mount() {
    view?.dispose();
    view = mountEditionReads(root, {
        locale: () => locale, isCurrent: () => owner,
        loadTimeoutMs: 2000,
        load: async () => { if (hangNext) { hangNext = false; return new Promise(() => {}); } return structuredClone(rows); },
        confirm: message => confirmEditionAction(message, locale),
        async execute(row, action, extra) {
            if (failNext) { failNext = false; throw Object.assign(new Error('通信を再試行してください'), { code:'TEST_NETWORK_FAILURE' }); }
            const stored = rows.find(other => other.state.editionId === row.state.editionId);
            if (stored.state.revision !== row.state.revision) throw new Error('EDITION_CHANGED');
            const status = action === 'stats' ? stored.state.status : nextEditionStatus(stored.state.status, action);
            stored.state = { ...stored.state, revision:stored.state.revision+1, status,
                firstPublishedAtMs: stored.state.firstPublishedAtMs || (['public','unlisted'].includes(status) ? Date.now() : null),
                ...(action==='successor'?{successorEditionId: rows.find(other=>other.workId===row.workId&&other.releaseId===extra.successorReleaseId)?.state.editionId||null}:{}),
                ...(action==='label'?{editionLabel:extra.editionLabel}:{}),
                ...(action==='embed'?{embedPolicy:extra.embedPolicy}:{}),
                ...(action==='stats'?{viewCounts:{views:12,embed:4,reader:8}}:{}),
            };
            output.textContent = `${stored.title}: ${status}\n${stored.state.editionId}`;
            return structuredClone(stored.state);
        },
        copy: async url => { output.textContent = url; },
        preview: async row => {
            const records = new Map(rows.map(row=>[row.state.editionId,{...row,authorUid:'fixture',dsfStatus:row.state.status,successorEditionId:row.state.successorEditionId}]));
            const result = await resolvePublicEdition(row.state.editionId, async id=>records.get(id));
            output.textContent = `Reader: ${row.title} / ${result.available?'閲覧可能':'非公開'} / ${row.state.editionId}`;
        },
    });
}
document.getElementById('fixture-reset').onclick = reset;
document.getElementById('fixture-light').onclick = () => { document.body.dataset.theme = 'light'; };
document.getElementById('fixture-dark').onclick = () => { document.body.dataset.theme = 'dark'; };
document.getElementById('fixture-lang').onclick = () => { locale=locale==='ja'?'en':'ja'; mount(); };
document.getElementById('fixture-fail').onclick = () => { failNext=true; };
document.getElementById('fixture-hang').onclick = () => { hangNext=true; view.refresh(); };
document.getElementById('fixture-owner').onclick = () => { owner=false;view.dispose();root.textContent='アカウントが変わりました。リーズを開き直してください。'; };
await reset();
