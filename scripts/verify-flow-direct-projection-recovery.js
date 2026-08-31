import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the actual private Studio handlers without importing app.js's browser
// bootstrap or adding production test hooks. Only DOM/runtime dependencies are
// stubbed; the navigation, request deduplication, pause and IME handlers are real.
const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const functionNames = [
    'handleFlowDirectNavigation',
    'pauseFlowDirectEditForProjection',
    'requestEditorFlowProjection',
    'handleEditorFlowRuntimeInvalidated',
    'handleFlowDirectCompositionStart',
    'handleFlowDirectCompositionEnd',
];
const handlers = functionNames.map((name) => {
    const match = appSource.match(new RegExp(`^function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, 'm'));
    assert.ok(match, `Private handler ${name} must exist in app.js`);
    return match[0];
}).join('\n\n');

function freezeDeep(value) {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(freezeDeep);
        Object.freeze(value);
    }
    return value;
}

function fixture(writingMode = 'vertical-rl', selection = [2, 2, 'none']) {
    const text = '雪の朝です';
    const group = freezeDeep({ id: 'flow-group', kind: 'flow', flow: { document: {
        sourceLanguage: 'ja', sections: [{ id: 'chapter', blocks: [
            { id: 'body', type: 'paragraph', texts: { ja: text, en: 'Snowy morning' }, future: { keep: true } },
        ] }],
    } } });
    const stats = { requests: 0, generations: 0, projectionReads: 0, aborts: 0,
        renders: 0, refreshes: 0, formatSyncs: 0, selectionUpdates: [], moves: [],
        commits: 0, resumes: 0, errors: [], history: ['unchanged-history'] };
    const classes = new Set();
    const pageElement = { classList: { add: name => classes.add(name), remove: name => classes.delete(name) } };
    const page = { kind: 'flow', groupId: group.id, flowPageIndex: 0, languageKey: 'ja', writingMode, page: {} };
    const ready = { pages: [{ kind: 'fixed', groupId: 'not-flow' }, page], totalPageCount: 2 };
    const proxy = {
        isConnected: true, value: text, dataset: {}, _flowDirectPageElement: pageElement,
        selectionStart: selection[0], selectionEnd: selection[1], selectionDirection: selection[2],
        setSelectionRange(start, end, direction) {
            this.selectionStart = start;
            this.selectionEnd = end;
            this.selectionDirection = direction;
        },
    };
    const state = freezeDeep({ version: 6, defaultLang: 'ja', blocks: [group], sections: [] });
    const sourceBefore = JSON.stringify(state);
    const historyBefore = JSON.stringify(stats.history);
    const pending = [];
    const model = { projection: null, signature: 'revision-1', groupExists: true,
        activeBlock: group, room: 'editor', sourceSelected: false };
    const render = { dataset: {}, style: {} };
    let context;
    const forbidden = name => () => assert.fail(`${name} must not mutate authoring/history during recovery`);
    const sandbox = {
        state, console: { error: (...args) => stats.errors.push(args) },
        document: { getElementById: () => render, querySelector: () => null },
        AbortController: class extends AbortController {
            abort(...args) { stats.aborts += 1; super.abort(...args); }
        },
        clearTimeout: forbidden('clearTimeout without a scheduled timer'),
        _flowDirectEditProxy: proxy,
        _flowDirectEditSession: Object.freeze({ groupId: group.id, sectionId: 'chapter', blockId: 'body',
            blockType: 'paragraph', languageKey: 'ja', writingMode, expectedText: text,
            selectionStart: selection[0], selectionEnd: selection[1], selectionDirection: selection[2],
            sourcePoint: { sectionId: 'chapter', blockId: 'body', blockType: 'paragraph', languageKey: 'ja',
                utf16Offset: selection[2] === 'backward' ? selection[0] : selection[1], affinity: 'forward' } }),
        _flowCanvasView: { ensurePage: () => pageElement, getMountedPages: () => [] },
        _flowDirectPreferredInlinePosition: null,
        _flowAuthoringComposing: false,
        _flowDirectCompositionText: '',
        _flowDirectCompositionRange: null,
        _flowAuthoringReflowTimer: null,
        _editorFlowProjectionController: null,
        _editorFlowProjectionRequestKey: '',
        _editorFlowProjectionRequestId: 0,
        _flowAuthoringRenderedRevision: 1,
        _flowAuthoringSourceRevision: 1,
        getFlowGroupById: id => model.groupExists && id === group.id ? group : null,
        getActiveBlock: () => model.activeBlock,
        getCurrentRoom: () => model.room,
        hasFlowGroups: () => model.groupExists,
        isFlowSourceSelected: () => model.sourceSelected,
        getEditorFlowProjectionLanguage: () => 'ja',
        getEditorPageProjection: () => { stats.projectionReads += 1; return model.projection; },
        createFlowRuntimeProjectionSignature: () => model.signature,
        getCachedFlowRuntimePageProjection: () => model.projection,
        createFlowRuntimePageProjection: (_state, options) => {
            assert.equal(_state, state);
            assert.equal(options.sessionScope, 'editor');
            stats.generations += 1;
            return new Promise(resolve => pending.push({ resolve, options }));
        },
        updateFlowDirectSelectionFromProxy: (target, options) => {
            assert.equal(target, proxy);
            stats.selectionUpdates.push({ ...options });
        },
        syncFlowDirectFormatControls: () => { stats.formatSyncs += 1; },
        getSelectedFlowRuntimePageIndex: () => 0,
        createFlowDirectSourcePoint: (session, _text, offset, affinity) => ({
            sectionId: session.sectionId, blockId: session.blockId, blockType: session.blockType,
            languageKey: session.languageKey, utf16Offset: offset, graphemeOffset: offset, affinity,
        }),
        findFlowSourcePointInPages: (pages, point) => {
            assert.equal(pages.length, 1, 'navigation must use the recovered Flow group, not fixed pages');
            assert.equal(pages[0], page);
            assert.equal(point.blockId, 'body');
            return { pageIndex: 0 };
        },
        moveFlowDirectProxyToPage: index => stats.moves.push(index),
        setSelectedFlowRuntimePageIndex: () => {},
        syncThumbSelectionDom: () => {},
        syncPageNavigationSlider: () => {},
        syncEditorPageCounters: () => {},
        clampEditorFlowProjectionSelection: () => {},
        renderThumbs: () => {},
        updateActiveFlowAuthoringStatus: () => {},
        renderEditorFlowGeneratedPage: (active, projection) => {
            assert.equal(active, group);
            assert.equal(projection, ready);
            stats.renders += 1;
            // Successful rendering remounts the proxy in Studio. Simulate only
            // that lifecycle boundary; DOM/caret geometry is tested separately.
            delete proxy.dataset.flowReflowPending;
            classes.delete('flow-direct-edit-reflow-pending');
        },
        refresh: () => { stats.refreshes += 1; context.requestEditorFlowProjection(model.activeBlock); },
        renderFlowDirectEditIndicators: () => {},
        commitFlowDirectEdit: target => {
            assert.equal(target, proxy);
            assert.equal(target.value, text, 'this fixture cancels IME without changing source');
            stats.commits += 1;
        },
        scheduleFlowAuthoringReflow: (id, options) => {
            assert.equal(id, group.id);
            assert.equal(options.immediate, true);
            stats.resumes += 1;
            context.requestEditorFlowProjection(group);
        },
        pushState: forbidden('pushState'), dispatch: forbidden('dispatch'),
        applyFlowAuthoringEdit: forbidden('applyFlowAuthoringEdit'), triggerAutoSave: forbidden('triggerAutoSave'),
    };
    context = vm.createContext(sandbox);
    vm.runInContext(`'use strict';\n${handlers}`, context, { filename: 'app.js:projection-recovery-handlers' });
    const request = context.requestEditorFlowProjection;
    context.requestEditorFlowProjection = (...args) => { stats.requests += 1; return request(...args); };
    return {
        group, proxy, context, model, stats, classes, ready, pending,
        selectionSnapshot: () => [proxy.selectionStart, proxy.selectionEnd, proxy.selectionDirection],
        unchanged() {
            assert.equal(JSON.stringify(state), sourceBefore, 'source/translations/unknown fields must remain unchanged');
            assert.equal(JSON.stringify(stats.history), historyBefore, 'recovery must not create an undo entry');
            assert.equal(context._flowAuthoringSourceRevision, 1, 'recovery must not advance the authoring revision');
            assert.deepEqual(stats.errors, [], 'recovery must not emit console errors');
        },
        async complete(index = pending.length - 1) {
            model.projection = ready;
            pending[index].resolve(ready);
            await new Promise(resolve => setImmediate(resolve));
        },
    };
}

function keyEvent(overrides = {}) {
    return { key: 'Home', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false,
        prevented: false, preventDefault() { this.prevented = true; }, ...overrides };
}

for (const writingMode of ['vertical-rl', 'horizontal-tb']) {
    for (const alreadyPending of [false, true]) {
        const f = fixture(writingMode, [1, 4, 'backward']);
        if (alreadyPending) f.proxy.dataset.flowReflowPending = 'true';
        const before = f.selectionSnapshot();
        const event = keyEvent();
        assert.equal(f.context.handleFlowDirectNavigation(event, f.proxy), true);
        assert.equal(event.prevented, true);
        assert.equal(f.stats.projectionReads, 1, 'each navigation must read the projection once');
        assert.equal(f.stats.generations, 1, 'a missing projection must start recovery, even if pending was already set');
        assert.equal(f.proxy.dataset.flowReflowPending, 'true');
        assert.ok(f.classes.has('flow-direct-edit-reflow-pending'));
        assert.deepEqual(f.stats.selectionUpdates[0], { allowPending: true, navigate: false });
        assert.deepEqual(f.selectionSnapshot(), before, 'recovery must preserve backward selection');
        f.unchanged();

        const controller = f.context._editorFlowProjectionController;
        for (let repeat = 0; repeat < 5; repeat += 1) {
            assert.equal(f.context.handleFlowDirectNavigation(keyEvent(), f.proxy), true);
        }
        assert.equal(f.stats.requests, 6);
        assert.equal(f.stats.generations, 1, 'repeated keys must deduplicate the same runtime request');
        assert.equal(f.context._editorFlowProjectionController, controller);
        assert.equal(f.stats.aborts, 0, 'key repeat must not continually abort pagination');
        assert.deepEqual(f.selectionSnapshot(), before);

        await f.complete();
        assert.equal(f.stats.renders, 1);
        assert.equal(f.context._editorFlowProjectionController, null);
        assert.equal(f.proxy.dataset.flowReflowPending, undefined);
        const readsBefore = f.stats.projectionReads;
        assert.equal(f.context.handleFlowDirectNavigation(keyEvent(), f.proxy), true);
        assert.equal(f.stats.projectionReads, readsBefore + 1);
        assert.deepEqual(f.selectionSnapshot(), [0, 0, 'none'], 'Ctrl+Home must work after recovery without reopening the page');
        assert.deepEqual(f.stats.moves, [0]);
        f.unchanged();
    }
}

// A stale/missing runtime context must not start work or touch a different proxy.
for (const missing of ['old-proxy', 'group', 'session', 'canvas']) {
    const f = fixture();
    let target = f.proxy;
    if (missing === 'old-proxy') target = { ...f.proxy, dataset: {} };
    if (missing === 'group') f.model.groupExists = false;
    if (missing === 'session') f.context._flowDirectEditSession = null;
    if (missing === 'canvas') f.context._flowCanvasView = null;
    assert.equal(f.context.handleFlowDirectNavigation(keyEvent(), target), true);
    assert.equal(f.stats.requests, 0, missing);
    assert.equal(f.stats.projectionReads, 0, missing);
    assert.deepEqual(f.selectionSnapshot(), [2, 2, 'none']);
    f.unchanged();
}
for (const overrides of [{ key: 'a' }, { altKey: true }, { key: 'ArrowLeft', ctrlKey: true }]) {
    const f = fixture();
    const event = keyEvent(overrides);
    assert.equal(f.context.handleFlowDirectNavigation(event, f.proxy), false);
    assert.equal(event.prevented, false);
    assert.equal(f.stats.requests, 0);
}

// A valid cached projection with a pending edit remains gated until remount.
{
    const f = fixture();
    f.model.projection = f.ready;
    f.proxy.dataset.flowReflowPending = 'true';
    f.context.handleFlowDirectNavigation(keyEvent(), f.proxy);
    assert.equal(f.stats.requests, 0);
    assert.deepEqual(f.selectionSnapshot(), [2, 2, 'none']);
    f.unchanged();
}

// The pause helper only owns the current direct session's group.
for (const blocked of ['different-group', 'no-proxy', 'composing']) {
    const f = fixture();
    if (blocked === 'no-proxy') f.context._flowDirectEditProxy = null;
    if (blocked === 'composing') f.context._flowAuthoringComposing = true;
    f.context.pauseFlowDirectEditForProjection(blocked === 'different-group' ? { id: 'another' } : f.group);
    assert.equal(f.proxy.dataset.flowReflowPending, undefined);
    assert.equal(f.stats.selectionUpdates.length, 0);
    assert.equal(f.stats.formatSyncs, 0);
}

// A signature change while an old request is pending must start a fresh request,
// not become permanently stuck behind the previous controller/dedup key.
{
    const f = fixture();
    f.context.handleFlowDirectNavigation(keyEvent(), f.proxy);
    f.model.signature = 'revision-2-after-fixed-page-autosave';
    f.context.handleFlowDirectNavigation(keyEvent(), f.proxy);
    assert.equal(f.stats.generations, 2);
    assert.equal(f.stats.aborts, 1);
    assert.equal(f.pending[0].options.signal.aborted, true);
    f.pending[0].resolve(f.ready);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.stats.renders, 0, 'the superseded projection must never replace the current view');
    await f.complete(1);
    f.context.handleFlowDirectNavigation(keyEvent(), f.proxy);
    assert.deepEqual(f.selectionSnapshot(), [0, 0, 'none']);
    f.unchanged();
}

// Font completion/request during IME must not refresh/remount the active proxy.
// Cancellation changes no text, but compositionend must still resume pagination.
for (const invalidation of ['fonts', 'request']) {
    const f = fixture('vertical-rl', [1, 4, 'backward']);
    f.model.projection = f.ready;
    f.context.handleFlowDirectCompositionStart({ target: f.proxy });
    assert.equal(f.proxy.dataset.flowCompositionResumeReflow, 'false');
    f.model.projection = null;
    if (invalidation === 'fonts') f.context.handleEditorFlowRuntimeInvalidated();
    else f.context.requestEditorFlowProjection(f.group);
    assert.equal(f.proxy.dataset.flowCompositionResumeReflow, 'true');
    assert.equal(f.context._flowAuthoringComposing, true);
    assert.equal(f.stats.refreshes, 0);
    assert.equal(f.stats.generations, 0);
    assert.equal(f.stats.renders, 0);
    assert.equal(f.context._flowDirectEditProxy, f.proxy);
    assert.deepEqual(f.selectionSnapshot(), [1, 4, 'backward']);
    f.context.handleFlowDirectCompositionEnd({ target: f.proxy, data: '' });
    assert.equal(f.context._flowAuthoringComposing, false);
    assert.equal(f.stats.commits, 1);
    assert.equal(f.stats.resumes, 1, 'even a canceled/unchanged composition must resume invalidated layout');
    assert.equal(f.stats.generations, 1);
    await f.complete();
    assert.equal(f.stats.renders, 1);
    f.context.handleFlowDirectNavigation(keyEvent(), f.proxy);
    assert.deepEqual(f.selectionSnapshot(), [0, 0, 'none']);
    f.unchanged();
}

// Ordinary font invalidation still refreshes and marks direct editing pending.
{
    const f = fixture();
    f.context.handleEditorFlowRuntimeInvalidated();
    assert.equal(f.stats.refreshes, 1);
    assert.equal(f.stats.generations, 1);
    assert.equal(f.proxy.dataset.flowReflowPending, 'true');
    await f.complete();
    f.unchanged();
}

console.log('Flow direct projection recovery verification passed.');
