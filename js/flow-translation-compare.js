import { setFlowComparisonEnabled } from './flow-editor-session.js';
/** Editor-only comparison. Views reuse the live editor; no authoring data is copied back. */
import { createFlowRuntimePageProjection, createFlowRuntimeProjectionSignature } from './flow-runtime-pages.js';
import { deriveFlowTranslationStatus } from './flow-translation-state.js';
import { t } from './i18n-studio.js';
import '../css/flow-translation-compare.css';

// Correspondence is semantic, never a page-number equality. Interpolate between
// common paragraph starts, including paragraphs continued across several pages.
export function mapComparisonPosition(fromPages, toPages, position) {
    const anchors = pages => {
        const result = new Map();
        pages.forEach((page, i) => {
            if (page.kind === 'fixed') result.set(`fixed:${page.blockId}`, i);
            const fragments = page.page?.fragments || [];
            fragments.forEach((fragment, j) => {
                const key = `${page.groupId}:${fragment.sectionId}:${fragment.blockId}`;
                if (!result.has(key)) result.set(key, i + j / Math.max(1, fragments.length));
            });
        });
        return result;
    };
    const from = anchors(fromPages), to = anchors(toPages);
    const pairs = [...from].filter(([key]) => to.has(key)).map(([key, x]) => [x, to.get(key)]);
    pairs.unshift([0, 0]); pairs.push([fromPages.length, toPages.length]);
    for (let i = 1; i < pairs.length; i++) {
        if (position <= pairs[i][0]) {
            const [x0, y0] = pairs[i - 1], [x1, y1] = pairs[i];
            return y0 + (y1 - y0) * Math.max(0, Math.min(1, (position - x0) / (x1 - x0 || 1)));
        }
    }
    return toPages.length;
}

export function createFlowTranslationCompare({ container, createView, model, canSwitch, activate, changed, review, openTranslation }) {
    let enabled = false, target = '', selectedBlock = '', selectedGroup = '';
    let retainedSource = '';
    const sourceLanguage = () => model().group?.flow?.document?.sourceLanguage || retainedSource || model().state.defaultLang;
    let primary = null, serial = 0, controller = null, sync = true;
    const views = new Map();
    const root = document.createElement('div'); root.id = 'flow-translation-compare'; root.hidden = true;
    const left = document.createElement('section'), right = document.createElement('section');
    left.className = right.className = 'flow-compare-pane';
    left.dataset.compareSide = 'source'; right.dataset.compareSide = 'target';
    const head = document.createElement('header'), otherHead = document.createElement('header');
    const sourceLabel = document.createElement('strong'); head.append(sourceLabel);
    const iconButton = (id, icon, handler) => {
        const button = document.createElement('button'); button.type = 'button'; button.id = id;
        const glyph = document.createElement('span'); glyph.className = 'material-icons'; glyph.textContent = icon; glyph.setAttribute('aria-hidden','true');
        button.append(glyph); button.addEventListener('click', () => { if (canSwitch()) handler(); }); return button;
    };
    const units = () => (model().group?.flow?.document?.sections || []).flatMap(section => section.blocks.filter(block => ['heading','paragraph'].includes(block.type)));
    function selectUnit(delta) {
        const list = units(); const index = Math.max(0,list.findIndex(block=>block.id === selectedBlock));
        selectedBlock = list[Math.max(0,Math.min(list.length-1,index+delta))]?.id || ''; selectedGroup = model().group?.id;
        for (const view of views.values()) {
            if (view.viewport.hidden) continue;
            const i = view.getPages().findIndex(page=>page.groupId === selectedGroup && page.page?.fragments.some(fragment=>fragment.blockId === selectedBlock));
            if (i >= 0) view.ensurePage(i);
        }
        highlight();
    }
    const previous = iconButton('flow-compare-previous','navigate_before',()=>selectUnit(-1));
    const next = iconButton('flow-compare-next','navigate_next',()=>selectUnit(1)); head.append(previous,next);
    const confirm = iconButton('flow-compare-confirm','done',()=> {
        if (confirm.disabled) return;
        review({groupId:selectedGroup,blockId:selectedBlock,languageKey:target});
    });
    const settings = iconButton('flow-compare-translation-settings','translate',()=>openTranslation(target));
    const targetSelect = document.createElement('select'); targetSelect.id = 'flow-compare-language';
    const status = document.createElement('span'); status.setAttribute('role', 'status'); status.className = 'flow-compare-status';
    const syncButton = document.createElement('button'); syncButton.type = 'button'; syncButton.id = 'flow-compare-sync';
    syncButton.addEventListener('click', () => { sync = !sync; labels(); if (sync && primary) follow(primary); });
    otherHead.append(targetSelect, syncButton, confirm, settings, status); left.append(head); right.append(otherHead);
    const divider = document.createElement('div'); divider.className = 'flow-compare-divider'; divider.tabIndex = 0;
    divider.setAttribute('role', 'separator'); divider.setAttribute('aria-orientation', 'vertical');
    divider.setAttribute('aria-valuemin', '30'); divider.setAttribute('aria-valuemax', '70');
    let ratio = 50;
    const setRatio = value => {
        ratio = Math.max(30, Math.min(70, value)); root.style.setProperty('--compare-ratio', ratio + '%');
        divider.setAttribute('aria-valuenow', String(Math.round(ratio)));
        views.forEach(view => view.resize({reveal:false}));
    };
    setRatio(50);
    divider.addEventListener('keydown', event => { if (['ArrowLeft','ArrowRight'].includes(event.key)) { event.preventDefault(); setRatio(ratio + (event.key === 'ArrowLeft' ? -2 : 2)); } });
    divider.addEventListener('pointerdown', event => {
        if (!canSwitch()) return;
        event.preventDefault(); divider.setPointerCapture(event.pointerId);
    });
    divider.addEventListener('pointermove', event => {
        if (!divider.hasPointerCapture(event.pointerId)) return;
        const rect = root.getBoundingClientRect(); setRatio((event.clientX - rect.left) / rect.width * 100);
    });
    root.append(left, divider, right); container.append(root);
    const controls = document.createElement('div'); controls.className = 'flow-compare-mode'; controls.setAttribute('role','group');
    const normal = document.createElement('button'), split = document.createElement('button');
    normal.type = split.type = 'button'; normal.id = 'flow-compare-normal'; split.id = 'flow-compare-split';
    for (const button of [normal, split]) button.setAttribute('aria-controls', root.id);
    controls.append(normal, split);
    document.querySelector('[data-ribbon-panel="view"]').prepend(controls);
    normal.addEventListener('click', () => setEnabled(false)); split.addEventListener('click', () => setEnabled(true));
    targetSelect.addEventListener('change', () => {
        if (!canSwitch()) { targetSelect.value = target; return; }
        target = targetSelect.value; activate(target); changed();
    });
    function languages() {
        const {state} = model(); const source = sourceLanguage();
        return (state.languages || []).filter(key => key !== source);
    }
    function labels() {
        const {state, group} = model(); const source = sourceLanguage();
        if (group?.kind === 'flow') retainedSource = source;
        previous.disabled = next.disabled = settings.disabled = group?.kind !== 'flow';
        normal.textContent = t('compare_normal'); split.textContent = t('compare_split');
        normal.title = t('compare_normal'); split.title = t('compare_split');
        normal.setAttribute('aria-pressed', String(!enabled)); split.setAttribute('aria-pressed', String(enabled));
        split.disabled = !enabled && (!group || group.kind !== 'flow' || !languages().length);
        controls.setAttribute('aria-label', t('compare_mode')); divider.setAttribute('aria-label', t('compare_resize'));
        for (const [button,key] of [[previous,'compare_previous'],[next,'compare_next'],[confirm,'compare_confirm'],[settings,'compare_settings']]) { button.title = t(key); button.setAttribute('aria-label',t(key)); }
        sourceLabel.textContent = `${t('compare_source')} · ${source?.toUpperCase() || ''}`;
        targetSelect.setAttribute('aria-label',t('compare_language'));
        const keys = languages();
        if (JSON.stringify([...targetSelect.options].map(o=>o.value)) !== JSON.stringify(keys)) {
            targetSelect.replaceChildren(...keys.map(key => new Option(key.toUpperCase(), key)));
        }
        targetSelect.value = target;
        syncButton.textContent = t('compare_sync'); syncButton.title = t('compare_sync'); syncButton.setAttribute('aria-pressed',String(sync));
        left.dataset.active = String(state.activeLang === source); right.dataset.active = String(state.activeLang === target);
    }
    function setEnabled(value) {
        if (enabled === value || !canSwitch()) return;
        if (value && (model().group?.kind !== 'flow' || !languages().length)) return;
        enabled = value; setFlowComparisonEnabled(value); serial++; controller?.abort();
        const {state, group} = model();
        if (value) {
            const source = sourceLanguage();
            retainedSource = source;
            target = state.activeLang !== source && languages().includes(state.activeLang) ? state.activeLang : languages()[0];
        } else {
            views.forEach(view => { view.setVisible(false); container.append(view.viewport); });
            primary = null;
        }
        root.hidden = !enabled; container.classList.toggle('flow-compare-active', enabled); labels(); changed(enabled);
    }
    function getView(language) {
        const source = sourceLanguage();
        if (language !== source) target = language;
        let view = views.get(language);
        if (!view) {
            view = createView(language);
            view.viewport.id = 'flow-compare-viewport-' + language;
            view.viewport.querySelector('.flow-canvas-track').removeAttribute('id');
            views.set(language, view);
        }
        views.forEach((candidate,key) => { if (key !== source && key !== target) candidate.setVisible(false); });
        (language === source ? left : right).append(view.viewport);
        return view;
    }
    function follow(view) {
        if (!enabled || !sync) return;
        const source = sourceLanguage();
        const other = views.get(view === views.get(source) ? target : source);
        if (!other || !other.getPages().length) return;
        other.setReadingPosition(mapComparisonPosition(view.getPages(), other.getPages(), view.getReadingPosition()));
    }
    function highlight() {
        if (!enabled) return;
        const {group} = model();
        const review = group?.kind === 'flow' && target ? deriveFlowTranslationStatus(group,target) : null;
        const stale = new Set(review?.body?.ids?.stale || []);
        confirm.disabled = selectedGroup !== group?.id || !units().some(block=>block.id === selectedBlock && typeof block.texts?.[target] === 'string');
        for (const [language, view] of views) for (const entry of view.getMountedPages()) {
            for (const element of entry.pageElement.querySelectorAll('[data-flow-block-id]')) {
                element.classList.toggle('flow-compare-selected', entry.page.groupId === selectedGroup && element.dataset.flowBlockId === selectedBlock);
                element.classList.toggle('flow-compare-missing', language === target && !entry.page.isSourceFallback && entry.page.groupId === group?.id && (review?.body?.ids?.missing || []).includes(element.dataset.flowBlockId));
                element.dataset.compareMissingLabel = t('compare_missing_short');
                element.classList.toggle('flow-compare-stale', language === target && entry.page.groupId === group?.id && stale.has(element.dataset.flowBlockId));
            }
        }
        const missing = review?.body?.counts?.missing || 0, count = review?.body?.counts?.stale || 0;
        status.textContent = group?.kind !== 'flow' ? '' : missing ? t('compare_missing') : count ? `${t('compare_review')} · ${count}` : t('compare_ready');
        status.title = status.textContent;
        status.dataset.review = String(!!(missing || count));
    }
    async function update(activeView) {
        if (!enabled) return;
        primary = activeView; labels(); highlight();
        const {state, group} = model(); if (!['flow','page'].includes(group?.kind)) return;
        const source = sourceLanguage();
            retainedSource = source;
        const otherLanguage = state.activeLang === source ? target : source;
        if (!otherLanguage) return;
        const key = createFlowRuntimeProjectionSignature(state, otherLanguage, state.sections, document, 'editor-compare');
        const other = getView(otherLanguage);
        if (other._compareSignature === key) { other.setVisible(true); other.resize({reveal:false}); if (sync) { if (group.kind === 'page') other.ensurePage(other.getPages().findIndex(page=>page.blockId === group.id)); else follow(activeView); } highlight(); return; }
        controller?.abort(); controller = new AbortController(); const request = ++serial;
        // Do not leave an obsolete editable page visible during async pagination.
        other.setVisible(false);
        try {
            const result = await createFlowRuntimePageProjection(state, {languageKey:otherLanguage, fixedPages:state.sections,
                sessionScope:'editor-compare',signal:controller.signal});
            if (!enabled || request !== serial || key !== createFlowRuntimeProjectionSignature(model().state,otherLanguage,model().state.sections,document,'editor-compare')) return;
            other._compareSignature = key;
            other.update(result.pages, Math.max(0,result.pages.findIndex(page=>page.groupId === group.id || page.blockId === group.id)), `${state.localProjectId || state.projectId || 'local'}:${otherLanguage}`);
            if (sync) follow(activeView); highlight();
        } catch(error) { if (error.name !== 'AbortError' && request === serial) status.textContent = t('compare_error'); }
    }
    container.addEventListener('pointerdown', event => {
        const element = event.target.closest('[data-flow-block-id]');
        if (element) { selectedBlock = element.dataset.flowBlockId; selectedGroup = element.closest('[data-flow-runtime-key]')?._flowPageEntry?.groupId || model().group?.id;
            for (const view of views.values()) {
                if (view.viewport.contains(element) || view.viewport.hidden) continue;
                const index = view.getPages().findIndex(page => page.groupId === selectedGroup && page.page?.fragments.some(fragment => fragment.blockId === selectedBlock));
                if (sync && index >= 0) view.ensurePage(index);
            }
            highlight(); }
    }, true);
    labels();
    return { get enabled(){return enabled;}, getView, update, follow, highlight, labels, setEnabled,
        resize() { if (enabled) views.forEach(view => { if (!view.viewport.hidden) view.resize({reveal:false}); }); },
        activateView(view, language) { if (!enabled || !canSwitch()) return false; primary = view; activate(language,view); labels(); return true; },
    };
}
