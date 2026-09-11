/** Desktop presentation adapter. Authoring, history, assets and persistence stay with their existing controllers. */
import { t } from './i18n-studio.js';
import '../css/studio-flow-ribbon.css';

let initialized = false;
let context = { active: false, source: false, language: '', writingMode: 'vertical-rl' };
let refreshFrame = 0;
const byId = id => document.getElementById(id);
const desktop = () => window.matchMedia('(min-width: 1024px)').matches;
const mirrors = [];
let imageContext = { active: false, adjusting: false, bubbleSelected: false, position: null };
let noteHome, noteAnchor;
function icon(name) {
    const span = document.createElement('span');
    span.className = 'material-icons'; span.setAttribute('aria-hidden', 'true'); span.textContent = name;
    return span;
}
function labelButton(button, name, key) {
    button.type = 'button'; button.classList.add('studio-ribbon-icon');
    button.removeAttribute('data-i18n');
    button.dataset.i18nTitle = key; button.dataset.i18nAria = key;
    button.title = t(key); button.setAttribute('aria-label', t(key));
    button.replaceChildren(icon(name));
    return button;
}
function button(name, key, onClick) {
    const b = labelButton(document.createElement('button'), name, key);
    if (onClick) b.addEventListener('click', onClick);
    return b;
}
function group(parent, key) {
    const div = document.createElement('div'); div.className = 'flow-ribbon-group';
    div.setAttribute('role', 'group'); div.dataset.i18nAria = key; div.setAttribute('aria-label', t(key));
    parent.append(div); return div;
}
function originalAction(parent, id, name, key, extra = {}) {
    const b = button(name, key, () => {
        const original = byId(id);
        if (original && !original.disabled && !original.hidden) original.click();
    });
    b.dataset.ribbonOriginal = id; Object.assign(b.dataset, extra); parent.append(b);
    mirrors.push({ element: b, id, kind: 'button' }); return b;
}
function selectMirror(parent, id, key) {
    const original = byId(id), select = original.cloneNode(true);
    select.id = 'ribbon-' + id; select.removeAttribute('data-testid'); select.removeAttribute('onchange');
    select.dataset.i18nAria = key; select.setAttribute('aria-label', t(key));
    select.addEventListener('change', () => {
        if (original.disabled) return;
        original.value = select.value; original.dispatchEvent(new Event('change', { bubbles: true }));
        refreshFlowRibbon();
    });
    parent.append(select); mirrors.push({ element: select, id, kind: 'select' }); return select;
}
function alignment(parent, id, names, keys) {
    const div = group(parent, 'ribbon_page_alignment'); div.classList.add('flow-ribbon-alignment');
    const values = id.endsWith('inline') ? ['start', 'center', 'end', 'justify'] : ['start', 'center', 'end'];
    values.forEach((value, index) => {
        const b = button(names[index], keys[index], () => {
            const original = byId(id); if (original.disabled) return;
            original.value = value; original.dispatchEvent(new Event('change', { bubbles: true })); refreshFlowRibbon();
        });
        b.dataset.alignmentKey = keys[index]; b.dataset.alignmentAxis = id.endsWith('inline') ? 'inline' : 'block';
        b.dataset.ribbonOriginal = id; b.dataset.ribbonValue = value;
        div.append(b); mirrors.push({ element: b, id, kind: 'choice', value });
    });
    return div;
}
function displayGroup(parent) {
    const div = group(parent, 'ribbon_display'); div.classList.add('flow-ribbon-display');
    for (const [key, name] of [['ruler', 'straighten'], ['guides', 'grid_3x3'], ['line', 'format_color_fill'], ['ruled', 'view_headline']]) {
        const b = button(name, 'ribbon_display_' + key, () => {
            if (key === 'ruled') {
                const select = byId('flow-direct-guide-mode'); select.value = select.value === 'off' ? 'ruled' : 'off';
                select.dispatchEvent(new Event('change', { bubbles: true }));
            } else document.querySelector(`[data-flow-indent-display="${key}"]`)?.click();
            refreshFlowRibbon();
        });
        b.dataset.ribbonDisplay = key; div.append(b);
    }
}
function installTooltip(root) {
    const tip = document.createElement('div'); tip.id = 'studio-ribbon-tooltip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true;
    document.body.append(tip);
    const hide = () => { tip.hidden = true; };
    const show = event => {
        const target = event.target.closest('button,select,input');
        if (!target || !root.contains(target)) return;
        const text = target.getAttribute('title') || target.getAttribute('aria-label'); if (!text) return;
        tip.textContent = text; tip.hidden = false;
        const rect = target.getBoundingClientRect();
        tip.style.left = Math.max(8, Math.min(innerWidth - tip.offsetWidth - 8, rect.left)) + 'px';
        tip.style.top = Math.min(innerHeight - tip.offsetHeight - 8, rect.bottom + 6) + 'px';
    };
    root.addEventListener('mouseover', show); root.addEventListener('focusin', show);
    root.addEventListener('mouseout', hide); root.addEventListener('focusout', hide); root.addEventListener('click', hide);
    window.addEventListener('scroll', hide, true); window.addEventListener('resize', hide);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
}
export function initFlowRibbon() {
    if (initialized) return;
    initialized = true;
    noteHome=byId('page-lock-note').parentElement; noteAnchor=byId('page-lock-note').nextElementSibling;
    const root = byId('ribbon-bar'); root.classList.add('studio-compact-ribbon');
    const home = root.querySelector('[data-ribbon-panel="home"]');
    const arrange = root.querySelector('[data-ribbon-panel="arrange"]');
    const insert = root.querySelector('[data-ribbon-panel="insert"]');
    const tabs = root.querySelector('.ribbon-tabs'); tabs.setAttribute('role', 'tablist');
    const tabRow = document.createElement('div'); tabRow.className = 'ribbon-row ribbon-command-row';
    root.querySelector('.ribbon-top-row').after(tabRow); tabRow.append(tabs);
    tabRow.append(root.querySelector('.ribbon-auth'));
    const quick = document.createElement('div'); quick.className = 'ribbon-quick'; tabRow.append(quick);
    for (const [id, name, key] of [['btn-undo','undo','btn_undo'],['btn-redo','redo','btn_redo'],['btn-save','save','btn_save'],['btn-share','share','btn_share']]) {
        quick.append(labelButton(byId(id), name, key));
    }
    const settings = root.querySelector('[onclick="openProjectSettings()"]');
    settings.id = 'ribbon-project-settings'; root.querySelector('.ribbon-top-left').prepend(labelButton(settings, 'description', 'btn_project_settings'));
    root.querySelector('.ribbon-top-left').after(root.querySelector('.ribbon-work-title-group'));
    const full = button('fullscreen', 'ribbon_fullscreen', async () => {
        try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
        catch { byId('ribbon-status').textContent = t('ribbon_fullscreen_unavailable'); }
    });
    full.id = 'ribbon-fullscreen'; quick.append(full);
    const print = button('print', 'ribbon_print', () => import('./editor-print.js').then(m => m.openEditorPrint()));
    print.id = 'ribbon-print'; quick.append(print);
    const zoom = byId('canvas-zoom-select');
    zoom.dataset.i18nTitle = 'ribbon_canvas_zoom'; zoom.dataset.i18nAria = 'ribbon_canvas_zoom';
    zoom.title = t('ribbon_canvas_zoom'); zoom.setAttribute('aria-label', t('ribbon_canvas_zoom'));
    const collapse = button('expand_less', 'ribbon_collapse', () => {
        const collapsed = root.classList.toggle('ribbon-collapsed');
        labelButton(collapse, collapsed ? 'expand_more' : 'expand_less', collapsed ? 'ribbon_expand' : 'ribbon_collapse');
        collapse.setAttribute('aria-expanded', String(!collapsed));
        window.dispatchEvent(new Event('resize'));
    });
    collapse.id = 'ribbon-collapse'; collapse.setAttribute('aria-expanded', 'true');
    root.querySelector('.ribbon-panel-row').id = 'ribbon-commands';
    collapse.setAttribute('aria-controls', 'ribbon-commands'); quick.append(collapse);

    document.addEventListener('fullscreenchange', () => {
        const on = !!document.fullscreenElement;
        labelButton(full, on ? 'fullscreen_exit' : 'fullscreen', on ? 'ribbon_fullscreen_exit' : 'ribbon_fullscreen'); full.setAttribute('aria-pressed', String(on));
    });
    const viewTab = document.createElement('button'); viewTab.className = 'ribbon-tab'; viewTab.dataset.ribbonTab = 'view'; viewTab.dataset.i18n = 'tab_view'; viewTab.textContent = t('tab_view');
    tabs.querySelector('[data-ribbon-tab="export"]').before(viewTab);
    const view = document.createElement('div'); view.className = 'ribbon-panel'; view.dataset.ribbonPanel = 'view'; root.querySelector('.ribbon-panel-row').append(view);
    // Reuse the existing canvas controls on View for both Flow and Fixed pages.
    const canvasView=group(view,'label_canvas');
    canvasView.append(arrange.querySelector('[onclick="resetCanvasView()"]'));
    view.append(arrange.querySelector('.ribbon-canvas-zoom'));
    for(const tab of tabs.querySelectorAll('.ribbon-tab')){
        const key=tab.dataset.ribbonTab, panel=root.querySelector(`[data-ribbon-panel="${key}"]`);
        tab.id='studio-ribbon-tab-'+key; tab.setAttribute('aria-controls','studio-ribbon-panel-'+key);
        panel.id='studio-ribbon-panel-'+key; panel.setAttribute('role','tabpanel'); panel.setAttribute('aria-labelledby',tab.id);
    }
    const nav = group(home, 'ribbon_navigation'); home.prepend(nav);
    const toc = document.querySelector('#icon-bar [data-drawer="toc"]'); nav.append(labelButton(toc, 'format_list_bulleted', 'icon_toc'));
    const assets = byId('btn-toggle-sidebar'); assets.dataset.drawer = 'assets'; nav.append(labelButton(assets, 'image', 'icon_assets'));
    labelButton(byId('btn-toggle-panel'), 'tune', 'btn_edit_panel');
    // Remove only emptied layout wrappers, keeping all live original controls and IDs.
    home.querySelectorAll(':scope > .ribbon-group').forEach(g => { if (!g.children.length) g.remove(); });
    const flow = document.createElement('div'); flow.id = 'flow-ribbon-home'; flow.className = 'flow-ribbon-tools'; home.append(flow);
    const edit = group(flow, 'ribbon_manuscript');
    originalAction(edit, 'flow-open-source', 'article', 'flow_open_source');
    originalAction(edit, 'flow-direct-resume', 'edit', 'flow_direct_resume');
    originalAction(edit, 'flow-direct-page-break', 'insert_page_break', 'flow_direct_page_break');
    const image = button('add_photo_alternate', 'flow_image_insert'); image.dataset.flowInsertImage = ''; edit.append(image);
    const format = group(flow, 'flow_direct_format_label'); selectMirror(format, 'flow-direct-block-format', 'flow_direct_format_label');
    const formatScope = document.createElement('small'); formatScope.dataset.i18n = 'ribbon_selected_paragraph'; formatScope.textContent = t('ribbon_selected_paragraph'); format.append(formatScope);
    const indent = group(flow, 'ribbon_indent'); indent.id = 'flow-ribbon-indent';
    const emptyIndent = document.createElement('span'); emptyIndent.className='flow-indent-empty'; emptyIndent.dataset.i18n='ribbon_click_text'; emptyIndent.textContent=t('ribbon_click_text'); indent.append(emptyIndent);
    const annotations = group(flow, 'ribbon_annotations');
    for (const [name, key, mode] of [['translate', 'ribbon_ruby', 'reading'], ['format_color_text', 'ribbon_emphasis', 'mark']]) {
        const b = button(name, key); b.dataset.flowAnnotationButton = ''; b.dataset.flowAnnotationFocus = mode; annotations.append(b);
    }
    alignment(flow, 'flow-placement-inline', ['format_align_left','format_align_center','format_align_right','format_align_justify'], ['ribbon_align_start','ribbon_align_center','ribbon_align_end','ribbon_align_justify']);
    displayGroup(flow);
    const placement = document.createElement('div'); placement.id = 'flow-ribbon-placement'; placement.className = 'flow-ribbon-tools'; arrange.prepend(placement);
    const scope = group(placement, 'flow_placement_scope'); selectMirror(scope, 'flow-placement-scope', 'flow_placement_scope');
    const title = group(placement, 'ribbon_title_page');
    originalAction(title, 'flow-make-title', 'title', 'flow_make_title');
    originalAction(title, 'flow-restore-body', 'subject', 'flow_restore_body');
    alignment(placement, 'flow-placement-inline', ['format_align_left','format_align_center','format_align_right','format_align_justify'], ['ribbon_align_start','ribbon_align_center','ribbon_align_end','ribbon_align_justify']);
    alignment(placement, 'flow-placement-block', ['align_vertical_top','align_vertical_center','align_vertical_bottom'], ['ribbon_block_start','ribbon_block_center','ribbon_block_end']);
    const direction = group(placement, 'flow_writing_mode_label'); direction.id = 'ribbon-source-direction'; selectMirror(direction, 'flow-authoring-writing-mode', 'flow_writing_mode_label');
    const display = document.createElement('div'); display.id = 'flow-ribbon-view'; display.className = 'flow-ribbon-tools'; view.append(display); displayGroup(display);
    const flowInsert = document.createElement('div'); flowInsert.id = 'flow-ribbon-insert'; flowInsert.className = 'flow-ribbon-tools'; insert.append(flowInsert);
    originalAction(flowInsert, 'flow-direct-page-break', 'insert_page_break', 'flow_direct_page_break');
    const insertImage = button('add_photo_alternate', 'flow_image_insert'); insertImage.dataset.flowInsertImage = ''; flowInsert.append(insertImage);
    const imageTools = document.createElement('div'); imageTools.id = 'image-ribbon-home'; imageTools.className = 'flow-ribbon-tools'; home.append(imageTools);
    const imageActions = group(imageTools, 'ribbon_image_tools');
    const change = button('image', 'btn_change_image', () => {
        if (imageContext.active) byId('file-upload').click();
    }); imageActions.append(change);
    const adjust = button('crop_free', 'btn_adjust', () => {
        if (imageContext.active) byId('btn-adjust-img-panel').click();
    }); adjust.id = 'ribbon-image-adjust'; imageActions.append(adjust);
    const remove = button('delete_outline', 'btn_delete', () => {
        if (imageContext.active && !byId('btn-delete-active').disabled) byId('btn-delete-active').click();
    }); remove.id = 'ribbon-image-delete'; imageActions.append(remove);
    const transforms = group(imageTools, 'ribbon_image_transform'); transforms.id = 'ribbon-image-transform';
    for (const [name, key, action] of [
        ['zoom_in', 'ribbon_image_zoom_in', () => window.adjustImageZoom(.1)],
        ['zoom_out', 'ribbon_image_zoom_out', () => window.adjustImageZoom(-.1)],
        ['flip', 'ribbon_image_flip', () => window.toggleImageFlipX()],
        ['restart_alt', 'ribbon_image_reset', () => window.resetImageTransform()],
    ]) transforms.append(button(name, key, () => { if (imageContext.active && imageContext.adjusting) action(); }));
    const rotationLabel = document.createElement('label'); rotationLabel.className = 'ribbon-image-rotation';
    const rotation = document.createElement('input'); rotation.id='ribbon-image-rotation'; rotation.type='number'; rotation.min='-180'; rotation.max='180'; rotation.step='.5';
    rotation.dataset.i18nTitle='ribbon_image_rotation'; rotation.dataset.i18nAria='ribbon_image_rotation'; rotation.title=t('ribbon_image_rotation'); rotation.setAttribute('aria-label',t('ribbon_image_rotation'));
    rotation.addEventListener('change', () => { if (imageContext.active && imageContext.adjusting && rotation.value !== '') window.commitRibbonImageRotation(rotation.value); });
    rotationLabel.append(icon('rotate_right'), rotation, document.createTextNode('°')); transforms.append(rotationLabel);
    const imageHint=document.createElement('small'); imageHint.dataset.i18n='ribbon_image_hint'; imageHint.textContent=t('ribbon_image_hint'); transforms.append(imageHint);
    const done=button('check', 'ribbon_image_done', () => { if (imageContext.active && imageContext.adjusting) window.toggleImageAdjustment(); }); transforms.append(done);
    for (const b of root.querySelectorAll('.ribbon-panel .btn-tool')) {
        if (b.classList.contains('studio-ribbon-icon')) continue;
        const key = b.querySelector('[data-i18n]')?.dataset.i18n || b.dataset.i18n;
        const name = b.querySelector('.material-icons')?.textContent.trim()
            || (b.getAttribute('onclick')?.includes('fitCanvasView') ? 'fit_screen' : 'filter_1');
        if (key) labelButton(b, name, key);
        else {
            const text = b.title || b.textContent.trim();
            b.classList.add('studio-ribbon-icon'); b.title = text; b.setAttribute('aria-label', text); b.replaceChildren(icon(name));
        }
    }
    const top = root.querySelector('.ribbon-top-row');
    const flatLayout = () => {
        const wide = desktop();
        (wide ? top : tabRow).append(quick);
        (wide ? root.querySelector('.ribbon-panel-row') : tabRow).append(root.querySelector('.ribbon-auth'));
        root.querySelectorAll('.ribbon-panel').forEach(panel => {
            panel.setAttribute('role', wide ? 'group' : 'tabpanel');
            if (wide) { panel.removeAttribute('aria-labelledby'); panel.setAttribute('aria-label', t('tab_' + panel.dataset.ribbonPanel)); }
            else { panel.removeAttribute('aria-label'); panel.setAttribute('aria-labelledby', 'studio-ribbon-tab-' + panel.dataset.ribbonPanel); }
        });
    };
    flatLayout(); window.matchMedia('(min-width: 1024px)').addEventListener('change', flatLayout);
    const status = document.createElement('div'); status.className = 'flow-ribbon-status'; status.innerHTML = '<span id="ribbon-flow-context"></span><span id="ribbon-flow-note"></span><span id="ribbon-flow-scope"></span><span id="ribbon-status" role="status"></span>'; root.append(status);
    root.addEventListener('mousedown', event => {
        // Toolbar clicks must not collapse the semantic text selection; fields retain native focus.
        if (context.active && event.target.closest('.flow-ribbon-tools button')) event.preventDefault();
    });
    root.addEventListener('change', queueRefresh);
    document.addEventListener('dsf-flow-indent-ui-change', queueRefresh);
    tabs.addEventListener('keydown', event => {
        const all = [...tabs.querySelectorAll('.ribbon-tab')], index = all.indexOf(event.target);
        if (index < 0 || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
        event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? all.length-1 : (index+(event.key==='ArrowRight'?1:all.length-1))%all.length;
        all[next].click(); all[next].focus();
    });
    window.addEventListener('resize', () => { queueRefresh(); positionRibbonDrawer(); });
    new ResizeObserver(positionRibbonDrawer).observe(root);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && desktop() && document.body.dataset.room === 'editor' && document.body.classList.contains('drawer-open') && ![...document.querySelectorAll('dialog[open],.project-asset-menu,.context-menu,.ps-overlay')].some(el=>el.getClientRects().length && getComputedStyle(el).visibility!=='hidden')) {
            const trigger = root.querySelector('[data-drawer][aria-expanded="true"]'); window.closeDrawer(); trigger?.focus({ preventScroll: true });
        }
    });
    document.addEventListener('click', event => {
        if (desktop() && document.body.dataset.room === 'editor' && document.body.classList.contains('drawer-open')
            && !event.target.closest('#sidebar,[data-drawer],#btn-toggle-sidebar,dialog,.context-menu,.project-asset-menu')) window.closeDrawer();
    });
    byId('sidebar').addEventListener('click', event=>{
        if(desktop() && event.target.closest('.toc-preview-item')) window.closeDrawer();
    });
    installTooltip(root); refreshFlowRibbon();
}
function queueRefresh() {
    if (!refreshFrame) refreshFrame = requestAnimationFrame(() => { refreshFrame = 0; refreshFlowRibbon(); });
}
function positionRibbonDrawer() {
    if (!initialized) return;
    document.documentElement.style.setProperty('--editor-ribbon-bottom', byId('ribbon-bar').getBoundingClientRect().bottom + 4 + 'px');
}
export function syncFlowRibbonContext(next) {
    context = next;
    if (initialized) refreshFlowRibbon();
}
export function refreshFlowRibbon() {
    if (!initialized) return;
    const active = !!context.active;
    document.body.classList.toggle('flow-ribbon-context', active);
    const note=byId('page-lock-note');
    const noteInRibbon=active && desktop();
    if(noteInRibbon && note.parentElement!==byId('ribbon-flow-note')) byId('ribbon-flow-note').append(note);
    else if(!noteInRibbon && note.parentElement!==noteHome) noteHome.insertBefore(note,noteAnchor);
    byId('flow-ribbon-home').hidden = !active; byId('flow-ribbon-placement').hidden = !active; byId('flow-ribbon-view').hidden = !active; byId('flow-ribbon-insert').hidden = !active;
    byId('ribbon-source-direction').hidden = !context.source;
    const direct = active && !byId('flow-direct-format-props').hidden;
    document.querySelector('.flow-indent-empty').hidden = direct;
    document.querySelectorAll('.flow-ribbon-tools [data-flow-insert-image]').forEach(b => { b.hidden=false; b.disabled=!direct || b.disabled; });
    for (const item of mirrors) {
        const original = byId(item.id), element = item.element;
        const needsDirect = item.id.startsWith('flow-direct-');
        element.disabled = !active || !original || original.disabled || (needsDirect && !direct);
        if (item.kind === 'select' && document.activeElement !== element) element.value = original.value;
        if (item.kind === 'choice') {
            element.setAttribute('aria-pressed', String(original.value === item.value));
            const vertical = context.writingMode === 'vertical-rl';
            const key = element.dataset.alignmentKey + (vertical ? '_vertical' : '');
            element.title = t(key); element.setAttribute('aria-label', t(key));
            element.classList.toggle('vertical-alignment', vertical);
        }
        if (item.id === 'flow-make-title') element.setAttribute('aria-pressed',String(!byId('flow-restore-body').hidden));
        if (item.id === 'flow-restore-body') element.hidden = original.hidden;
        if (item.id === 'flow-open-source') { element.title = original.textContent; element.setAttribute('aria-label', original.textContent); }
    }
    const annotationDisabled = document.querySelector('#flow-direct-format-props [data-flow-annotation-button]')?.disabled ?? true;
    document.querySelectorAll('.flow-ribbon-tools [data-flow-annotation-button]').forEach(b => b.disabled = !direct || annotationDisabled);
    document.querySelectorAll('[data-ribbon-display]').forEach(b => {
        const key = b.dataset.ribbonDisplay;
        const checked = key === 'ruled' ? byId('flow-direct-guide-mode').value === 'ruled' : document.querySelector(`[data-flow-indent-display="${key}"]`)?.checked;
        b.disabled = !direct; b.setAttribute('aria-pressed', String(!!checked));
    });
    const scopeControl = byId('flow-placement-scope');
    const scope = t(scopeControl.value === 'page' ? (scopeControl.dataset.sharedTitle === 'true' ? 'flow_scope_shared_title' : 'flow_scope_page') : 'flow_scope_group');
    byId('ribbon-flow-context').textContent = active ? t(context.source ? 'ribbon_source_context' : 'ribbon_flow_context', { language: context.language?.toUpperCase() || '' }) : '';
    byId('ribbon-flow-scope').textContent = active ? t('ribbon_scope_status', { scope }) : '';
    byId('ribbon-status').textContent = active ? byId('flow-direct-format-status').textContent : '';
    refreshImageRibbon();
    positionRibbonDrawer();
}
export function syncRibbonDrawerButtons(drawer) {
    if (!initialized) return;
    document.querySelectorAll('#ribbon-bar [data-drawer]').forEach(b => {
        b.classList.toggle('active', drawer === b.dataset.drawer); b.setAttribute('aria-expanded', String(drawer === b.dataset.drawer)); b.setAttribute('aria-controls', 'sidebar');
    });
    positionRibbonDrawer();
}

export function syncImageRibbonContext(next) {
    imageContext = next;
    if (initialized) refreshImageRibbon();
}
function refreshImageRibbon() {
    const active = imageContext.active && !context.active;
    document.body.classList.toggle('image-ribbon-context', active && !imageContext.bubbleSelected);
    byId('image-ribbon-home').hidden = !active;
    byId('ribbon-image-transform').hidden = !active || !imageContext.adjusting;
    byId('ribbon-image-adjust').setAttribute('aria-pressed', String(active && imageContext.adjusting));
    byId('ribbon-image-delete').disabled = !active || byId('btn-delete-active').disabled;
    const rotation=byId('ribbon-image-rotation');
    if(document.activeElement!==rotation) rotation.value=String(imageContext.position?.rotation || 0);
}
