import { searchFlowText } from './flow-search.js';
import {createFlowReplacePlan} from './flow-replace.js';
import { getUILang } from './i18n-studio.js';
import '../css/studio-flow-search.css';

export function createStudioFlowSearch({ state, reveal, canNavigate, canReplace, applyReplacement }) {
    let root, input, scope, language, count, casing, previous, next, close, timer, index = -1, matches = [], stamp = '', generation = 0;
    let replaceToggle, replaceRow, replacement, replaceOne, replaceAll, replaceStatus, allPlan, onePlan, busy=false, preparedOptions='';
    const text = (ja, en) => getUILang() === 'en' ? en : ja;
    const button = () => document.getElementById('btn-flow-search');
    const optionsKey=()=>JSON.stringify([input.value,replacement.value,scope.value,language.value,casing.getAttribute('aria-pressed'),scope.value==='current'?state.blocks?.[state.activeBlockIdx]?.id:null]);
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
        replaceToggle.title=text('置換を表示 (Ctrl+H)','Show replace (Ctrl+H)');replaceToggle.setAttribute('aria-label',replaceToggle.title);
        replacement.placeholder=text('置換後の文字（空欄で削除）','Replace with (empty to delete)');replacement.setAttribute('aria-label',replacement.placeholder);
        replaceOne.textContent=text('現在を置換','Replace current');
        if (root.hidden) return;
        const active = state.blocks?.[state.activeBlockIdx];
        const result = scope.value === 'current' && active?.kind !== 'flow' ? { matches: [], truncated: false }
            : searchFlowText(state.blocks, { query: input.value, languageKey: language.value, groupId: scope.value === 'current' ? active.id : null, caseSensitive: casing.getAttribute('aria-pressed') === 'true' });
        const rows = new Map();
        for (const match of result.matches) rows.set(JSON.stringify([match.groupId, match.sectionId, match.blockId]), match.expectedText);
        const signature = JSON.stringify([input.value, language.value, scope.value, casing.getAttribute('aria-pressed'), [...rows], result.matches.map(({expectedText, ...match}) => match)]);
        if (stamp !== signature) { stamp = signature; index = -1; generation++; delete replaceStatus.dataset.result; replaceStatus.textContent=''; }
        matches = result.matches;
        count.textContent = `${index < 0 ? 0 : index + 1} / ${matches.length}${result.truncated ? '+' : ''}`;
        previous.disabled = next.disabled = !matches.length || busy;
        allPlan=onePlan=null;preparedOptions=optionsKey();
        if(!replaceRow.hidden){
            try {
                const options={query:input.value,replacement:replacement.value,languageKey:language.value,groupId:scope.value==='current'?active?.id:null,caseSensitive:casing.getAttribute('aria-pressed')==='true'};
                if(input.value && (scope.value!=='current'||active?.kind==='flow')) {
                    allPlan=createFlowReplacePlan(state.blocks,options);
                    if(matches[index])onePlan=createFlowReplacePlan(state.blocks,{...options,match:matches[index]});
                }
                replaceAll.textContent=text(`すべて置換 (${allPlan?.count||0}件)`,`Replace all (${allPlan?.count||0})`);
                replaceAll.title=allPlan?.rubyReviewCount?text(`ルビ ${allPlan.rubyReviewCount}件が要確認になります`,`${allPlan.rubyReviewCount} ruby annotations will need review`):text('表示上限に関係なく全件を置換','Replace all matches, including those beyond the display limit');
                if(!replaceStatus.dataset.result)replaceStatus.textContent=allPlan?.rubyReviewCount?replaceAll.title:'';
            } catch(error) { replaceStatus.textContent=errorText(error); }
        }
        replaceOne.disabled=busy||!canReplace()||!onePlan?.count;
        replaceAll.disabled=busy||!canReplace()||!allPlan?.count;
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
    function errorText(error){
        if(error.code==='REPLACE_TOO_MANY')return text('5万件を超えています。検索範囲を絞ってください','More than 50,000 changes. Narrow the search scope.');
        if(error.code==='REPLACE_STALE'||error.code==='REPLACE_PLAN_INVALID')return text('本文や設定が変更されました。再検索してください','Text or settings changed. Search again.');
        if(error.code==='REPLACE_TEXT_INVALID')return text('置換文字は改行なし・4096文字以内で指定してください','Use at most 4,096 characters without line breaks.');
        return text('注釈や配置の範囲を保てないため置換していません。範囲を確認してください','Nothing was replaced because annotation or placement ranges could not be preserved. Check the matches.');
    }
    async function replace(all){
        const plan=all?allPlan:onePlan,current=matches[index];
        if(busy||!canReplace()||!plan?.count)return;
        if(optionsKey()!==preparedOptions){update();replaceStatus.textContent=text('検索条件を更新しました。件数を確認して再度置換してください','Search options updated. Review the count and replace again.');return;}
        busy=true;generation++;replaceOne.disabled=replaceAll.disabled=true;
        try {
            const result=applyReplacement(plan);
            index=-1;stamp='';update();
            replaceStatus.dataset.result='true';replaceStatus.textContent=text(`${result.count}件を置換しました。元に戻すで一括取消できます`,`${result.count} replaced. Undo restores this operation.`);
            if(!all && matches.length){
                const nextIndex=matches.findIndex(m=>m.groupId===current.groupId&&m.blockId===current.blockId&&m.start>=current.start+plan.replacement.length);
                index=nextIndex>0?nextIndex-1:-1;
                busy=false;await move(1);
            }
        } catch(error){replaceStatus.dataset.result='true';replaceStatus.textContent=errorText(error);}
        finally{busy=false;update();}
    }
    function showReplace(show){replaceRow.hidden=!show;replaceToggle.setAttribute('aria-expanded',String(show));update();}
    function hide() { generation++; root.hidden = true; button().setAttribute('aria-expanded','false'); }
    function ensure() {
        if (root) return;
        root = document.createElement('div'); root.id = 'flow-search-bar'; root.hidden = true; root.setAttribute('role','search');
        root.innerHTML = '<input type="search" maxlength="512"><select class="search-scope"><option value="current"></option><option value="all"></option></select><select class="search-language"></select><button type="button" class="search-case" aria-pressed="false">Aa</button><span role="status" aria-live="polite"></span><button type="button" class="search-previous">↑</button><button type="button" class="search-next">↓</button><button type="button" class="search-replace-toggle" aria-expanded="false">↔</button><button type="button" class="search-close">×</button><div class="search-replace-row" hidden><input class="search-replacement" type="text" maxlength="4096"><button type="button" class="search-replace-one"></button><button type="button" class="search-replace-all"></button><span class="replace-status" role="status" aria-live="polite"></span></div>';
        document.getElementById('editor-main').prepend(root);
        input = root.querySelector('input'); scope = root.querySelector('.search-scope'); language = root.querySelector('.search-language'); count = root.querySelector('[role=status]'); casing = root.querySelector('.search-case'); previous = root.querySelector('.search-previous'); next = root.querySelector('.search-next'); close = root.querySelector('.search-close');
        replaceToggle=root.querySelector('.search-replace-toggle');replaceRow=root.querySelector('.search-replace-row');replacement=root.querySelector('.search-replacement');replaceOne=root.querySelector('.search-replace-one');replaceAll=root.querySelector('.search-replace-all');replaceStatus=root.querySelector('.replace-status');
        replaceToggle.onclick=()=>showReplace(replaceRow.hidden);replaceOne.onclick=()=>replace(false);replaceAll.onclick=()=>replace(true);
        root.addEventListener('input',()=>{delete replaceStatus.dataset.result;});root.addEventListener('change',()=>{delete replaceStatus.dataset.result;});
        replacement.oninput=()=>{delete replaceStatus.dataset.result;update();};
        input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(update, 120); });
        scope.onchange = language.onchange = update;
        casing.onclick = () => { casing.setAttribute('aria-pressed', String(casing.getAttribute('aria-pressed') !== 'true')); update(); };
        previous.onclick = () => move(-1); next.onclick = () => move(1); close.onclick = hide;
        root.addEventListener('keydown', e => { if(e.isComposing) return; if(e.key === 'Escape') { e.preventDefault();e.stopPropagation();hide(); } if(e.key === 'Enter' && (e.target===input||e.target===replacement)) { e.preventDefault(); e.stopPropagation(); if(e.target===replacement)replace(false);else move(e.shiftKey ? -1 : 1); } });
        document.addEventListener('studio-ui-language-change', () => {delete replaceStatus.dataset.result;replaceStatus.textContent='';update();});
    }
    function open() { ensure(); update(); root.hidden = false; button().setAttribute('aria-expanded','true'); update(); input.focus();input.select(); }
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && ['f','h'].includes(e.key.toLowerCase()) && !e.isComposing && button()?.getClientRects().length && !document.querySelector('dialog[open]')) { e.preventDefault(); e.stopPropagation();open();if(e.key.toLowerCase()==='h')showReplace(true); }
    }, true);
    button().onclick = open;
    ensure(); update();
    return { update };
}
