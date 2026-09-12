import { searchFlowText } from './flow-search.js';
import { getUILang } from './i18n-studio.js';
import '../css/studio-flow-search.css';

export function createStudioFlowSearch({ state, reveal, canNavigate }) {
    let root, input, scope, language, count, casing, previous, next, close, timer, index = -1, matches = [], stamp = '', generation = 0;
    const text = (ja, en) => getUILang() === 'en' ? en : ja;
    const button = () => document.getElementById('btn-flow-search');
    function update() {
        if (!root) return;
        const languages = state.languages?.length ? state.languages : [state.defaultLang || 'ja'];
        const key = languages.join('|');
        if (language.dataset.languages !== key) {
            const old = language.value;
            language.replaceChildren(...languages.map(value => new Option(value.toUpperCase(), value)));
            language.value = languages.includes(old) ? old : languages.includes(state.activeLang) ? state.activeLang : languages[0];
            language.dataset.languages = key;
        }
        button().title = text('Flow原稿を検索 (Ctrl+F)', 'Find in Flow manuscripts (Ctrl+F)');
        button().setAttribute('aria-label', button().title);
        input.placeholder = text('Flow原稿を検索', 'Find in Flow manuscripts'); input.setAttribute('aria-label', input.placeholder);
        scope.setAttribute('aria-label', text('検索範囲', 'Search scope'));
        scope.options[0].text = text('現在のFlow', 'Current Flow'); scope.options[1].text = text('作品内の全Flow', 'All Flow manuscripts');
        language.setAttribute('aria-label', text('検索言語', 'Search language'));
        for (const [el, ja, en] of [[previous,'前の一致','Previous match'],[next,'次の一致','Next match'],[close,'検索を閉じる','Close search'],[casing,'大文字・小文字を区別','Match case']]) { el.title = text(ja,en); el.setAttribute('aria-label', el.title); }
        if (root.hidden) return;
        const active = state.blocks?.[state.activeBlockIdx];
        const result = scope.value === 'current' && active?.kind !== 'flow' ? { matches: [], truncated: false }
            : searchFlowText(state.blocks, { query: input.value, languageKey: language.value, groupId: scope.value === 'current' ? active.id : null, caseSensitive: casing.getAttribute('aria-pressed') === 'true' });
        const rows = new Map();
        for (const match of result.matches) rows.set(JSON.stringify([match.groupId, match.sectionId, match.blockId]), match.expectedText);
        const signature = JSON.stringify([input.value, language.value, scope.value, casing.getAttribute('aria-pressed'), [...rows], result.matches.map(({expectedText, ...match}) => match)]);
        if (stamp !== signature) { stamp = signature; index = -1; generation++; }
        matches = result.matches;
        count.textContent = `${index < 0 ? 0 : index + 1} / ${matches.length}${result.truncated ? '+' : ''}`;
        previous.disabled = next.disabled = !matches.length;
    }
    async function move(direction) {
        update();
        if (!matches.length || !canNavigate()) return;
        index = index < 0 ? (direction < 0 ? matches.length - 1 : 0) : (index + direction + matches.length) % matches.length;
        const token = ++generation, match = matches[index];
        const ok = await reveal(match, () => token === generation && !root.hidden);
        if (token !== generation) return;
        if (!ok) { count.textContent = text('移動できません。再検索してください', 'Unable to navigate. Search again.'); return; }
        update();
    }
    function hide() { generation++; root.hidden = true; button().setAttribute('aria-expanded','false'); }
    function ensure() {
        if (root) return;
        root = document.createElement('div'); root.id = 'flow-search-bar'; root.hidden = true; root.setAttribute('role','search');
        root.innerHTML = '<input type="search" maxlength="512"><select class="search-scope"><option value="current"></option><option value="all"></option></select><select class="search-language"></select><button type="button" class="search-case" aria-pressed="false">Aa</button><span role="status" aria-live="polite"></span><button type="button" class="search-previous">↑</button><button type="button" class="search-next">↓</button><button type="button" class="search-close">×</button>';
        document.getElementById('editor-main').prepend(root);
        input = root.querySelector('input'); scope = root.querySelector('.search-scope'); language = root.querySelector('.search-language'); count = root.querySelector('[role=status]'); casing = root.querySelector('.search-case'); previous = root.querySelector('.search-previous'); next = root.querySelector('.search-next'); close = root.querySelector('.search-close');
        input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(update, 120); });
        scope.onchange = language.onchange = update;
        casing.onclick = () => { casing.setAttribute('aria-pressed', String(casing.getAttribute('aria-pressed') !== 'true')); update(); };
        previous.onclick = () => move(-1); next.onclick = () => move(1); close.onclick = hide;
        root.addEventListener('keydown', e => { if(e.isComposing) return; if(e.key === 'Escape') { e.preventDefault();e.stopPropagation();hide(); } if(e.key === 'Enter') { e.preventDefault(); move(e.shiftKey ? -1 : 1); } });
        document.addEventListener('studio-ui-language-change', update);
    }
    function open() { ensure(); update(); root.hidden = false; button().setAttribute('aria-expanded','true'); update(); input.focus();input.select(); }
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f' && !e.isComposing && button()?.getClientRects().length && !document.querySelector('dialog[open]')) { e.preventDefault(); e.stopPropagation();open(); }
    }, true);
    button().onclick = open;
    ensure(); update();
    return { update };
}
