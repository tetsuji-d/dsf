import { DSF_PRODUCTION_FONT_REGISTRY } from '../../js/dsf-font-registry.js';
import { fetchDsfProductionFontRuntimeLease } from '../../js/dsf-production-font-runtime.js';
import { createFlowGroupBlock } from '../../js/flow-project-model.js';
import { renderFlowGeneratedPage } from '../../js/flow-dom-measurer.js';
import { createFlowPublicationCompositionCaptureSession } from '../../js/flow-publication-composition-capture.js';
import { projectFlowPaginationToDsfV2 } from '../../js/flow-publication-projection.js';
import { createDsfFixedTextPageElement, prepareDsfViewerFixedTextContext } from '../../js/viewer-fixed-text.js';
import { DSF_DELIVERY_LAYOUT_MODEL, DSF_DELIVERY_SCHEMA_VERSION } from '../../js/dsf-delivery-v2.js';
import { CANONICAL_PAGE_HEIGHT, CANONICAL_PAGE_WIDTH } from '../../js/page-geometry.js';
import { serializeDsfReleaseJson } from '../../js/dsf-release-assembly.js';
import { sha256DsfBytes } from '../../js/dsf-release-byte-sealing.js';
import { deserializeProject, serializeProject } from '../../js/project-persistence.js';
import { segmentGraphemes } from '../../js/grapheme.js';

// Not a Vite build input. No network request or fixture work runs outside DEV.
const development = import.meta.env?.DEV === true;
const input = (name) => document.getElementById(`fixture-${name}`);
const fontRegistry = DSF_PRODUCTION_FONT_REGISTRY;
const fontLeases = new Map();
const abortController = new AbortController();
const families = ['Noto Sans JP', 'Noto Serif JP'];
const writingModes = ['vertical-rl', 'horizontal-tb'];
let busy = false;

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function resolveFontId(family) {
    const entries = Object.entries(fontRegistry.fonts).filter(([, entry]) => entry.declaration.family === family);
    assert(entries.length === 1, `認定fontを一意に解決できません: ${family}`);
    return entries[0][0];
}

async function getFontLease(fontId) {
    if (!fontLeases.has(fontId)) {
        const pending = fetchDsfProductionFontRuntimeLease({
            registry: fontRegistry, fontId, documentRef: document,
            fontWeights: [400, 700], signal: abortController.signal,
        });
        fontLeases.set(fontId, pending);
        pending.catch(() => fontLeases.delete(fontId));
    }
    return fontLeases.get(fontId);
}

function createGroup({ family, weight, writingMode, structure, source, caseId, textAlign }) {
    const blocks = structure === 'heading'
        ? [{ id: `${caseId}-heading`, type: 'heading', level: 2, texts: { ja: source } }]
        : structure === 'structure'
            ? [
                { id: `${caseId}-heading`, type: 'heading', level: 2, texts: { ja: '構造…確認' } },
                { id: `${caseId}-text-a`, type: 'paragraph', texts: { ja: source } },
                { id: `${caseId}-break`, type: 'pageBreak' },
                { id: `${caseId}-empty`, type: 'paragraph', texts: { ja: '' } },
                { id: `${caseId}-text-b`, type: 'paragraph', texts: { ja: source } },
            ]
            : [{ id: `${caseId}-text`, type: 'paragraph', texts: { ja: source } }];
    return createFlowGroupBlock({
        id: `${caseId}-group`, sourceLanguage: 'ja', writingMode,
        document: {
            id: `${caseId}-document`, sourceLanguage: 'ja',
            sections: [{
                id: `${caseId}-section`, title: { ja: '約物比較' },
                blocks,
            }],
        },
        layout: { typographyByLanguage: { ja: { writingMode, fontFamily: family, fontWeight: weight, textAlign } } },
    });
}

function sourceEntries(group) {
    return group.flow.document.sections.flatMap((section) => section.blocks
        .filter((block) => block.type === 'heading' || block.type === 'paragraph')
        .map((block) => ({
            blockId: block.id,
            text: block.texts.ja,
            segments: segmentGraphemes(block.texts.ja, 'ja'),
        })));
}

function canonicalRangeRect(pageElement, range) {
    const pageRect = pageElement.getBoundingClientRect();
    const rect = range.getBoundingClientRect();
    const scaleX = pageElement.offsetWidth / pageRect.width;
    const scaleY = pageElement.offsetHeight / pageRect.height;
    return {
        left: (rect.left - pageRect.left) * scaleX,
        top: (rect.top - pageRect.top) * scaleY,
        width: rect.width * scaleX,
        height: rect.height * scaleY,
    };
}

function recordGlyphRange(target, key, pageIndex, pageElement, textNode, start, end) {
    assert(textNode?.nodeType === Node.TEXT_NODE, `glyph text nodeが見つかりません: ${key}`);
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
    const rect = canonicalRangeRect(pageElement, range);
    assert(Object.values(rect).every(Number.isFinite), `glyphのcanonical座標が不正です: ${key}`);
    assert(!target.has(key), `glyph source offsetが重複しました: ${key}`);
    target.set(key, { pageIndex, rect, zeroArea: rect.width <= 0 || rect.height <= 0 });
}

function collectFlowGlyphRanges(pageList, pagination) {
    const ranges = new Map();
    pagination.pages.forEach((page, pageIndex) => {
        const pageElement = pageList.children[pageIndex];
        page.fragments.forEach((fragment, fragmentIndex) => {
            if (!fragment.text) return;
            const element = pageElement.querySelector(`[data-flow-fragment-index="${fragmentIndex}"]`);
            const textNode = element?.firstChild;
            segmentGraphemes(fragment.text, 'ja').forEach((segment, localIndex) => {
                const graphemeOffset = fragment.sourceRange.startGrapheme + localIndex;
                recordGlyphRange(ranges, `${fragment.blockId}:${graphemeOffset}`, pageIndex,
                    pageElement, textNode, segment.index, segment.end);
            });
        });
    });
    return ranges;
}

function collectViewerGlyphRanges(pageList, manifest) {
    const ranges = new Map();
    manifest.pages.forEach((page, pageIndex) => {
        const pageElement = pageList.children[pageIndex];
        const lineElements = [...pageElement.querySelectorAll(':scope > .viewer-fixed-text-line')];
        page.lines.forEach((line, lineIndex) => {
            const runElements = [...lineElements[lineIndex].querySelectorAll(':scope > .viewer-fixed-text-run')];
            line.runs.forEach((run, runIndex) => {
                const walker = document.createTreeWalker(runElements[runIndex], NodeFilter.SHOW_TEXT);
                const parts = [];
                let offset = 0;
                while (walker.nextNode()) {
                    const node = walker.currentNode;
                    parts.push({ node, start: offset, end: offset + node.data.length });
                    offset += node.data.length;
                }
                segmentGraphemes(run.text, 'ja').forEach((segment, localIndex) => {
                    const part = parts.find((entry) => entry.start <= segment.index && entry.end >= segment.end);
                    assert(part, 'Viewer DOMに原文のUTF-16 rangeがありません。');
                    recordGlyphRange(ranges, `${run.source.blockId}:${run.source.startGrapheme + localIndex}`,
                        pageIndex, pageElement, part.node, segment.index - part.start, segment.end - part.start);
                });
            });
        });
    });
    return ranges;
}

function compareGlyphRanges(group, normalPages, fixedPages, pagination, manifest) {
    const flow = collectFlowGlyphRanges(normalPages, pagination);
    const viewer = collectViewerGlyphRanges(fixedPages, manifest);
    const expectedKeys = sourceEntries(group).flatMap((entry) => (
        entry.segments.map((_, index) => `${entry.blockId}:${index}`)
    ));
    let compared = 0;
    let zeroAreaExcluded = 0;
    let deltaMaxPx = 0;
    let worstGlyph = null;
    for (const key of expectedKeys) {
        const flowGlyph = flow.get(key);
        const viewerGlyph = viewer.get(key);
        assert(flowGlyph, `通常Flowのsource offsetが欠落しました: ${key}`);
        assert(viewerGlyph, `Viewerのsource offsetが欠落しました: ${key}`);
        assert(flowGlyph.pageIndex === viewerGlyph.pageIndex, `glyphのpageが一致しません: ${key}`);
        if (flowGlyph.zeroArea || viewerGlyph.zeroArea) {
            assert(flowGlyph.zeroArea === viewerGlyph.zeroArea, `glyphの零面積判定が一致しません: ${key}`);
            zeroAreaExcluded += 1;
            continue;
        }
        assert(flowGlyph.pageIndex === viewerGlyph.pageIndex, `glyphのpageが一致しません: ${key}`);
        const delta = Math.max(...['left', 'top', 'width', 'height'].map((field) => (
            Math.abs(flowGlyph.rect[field] - viewerGlyph.rect[field])
        )));
        if (delta > deltaMaxPx) {
            deltaMaxPx = delta;
            worstGlyph = { key, pageIndex: flowGlyph.pageIndex, flow: flowGlyph.rect, viewer: viewerGlyph.rect };
        }
        compared += 1;
    }
    assert(flow.size === expectedKeys.length, '通常Flowのglyph source offset集合が原稿と一致しません。');
    assert(viewer.size === expectedKeys.length, 'Viewerのglyph source offset集合が原稿と一致しません。');
    assert(deltaMaxPx <= 0.5, `glyph座標差が0.5pxを超えました: ${deltaMaxPx.toFixed(4)}px ${JSON.stringify(worstGlyph)}`);
    return { expectedGlyphs: expectedKeys.length, comparedGlyphs: compared, zeroAreaExcluded, deltaMaxPx };
}

async function createViewerContext(projection, lease) {
    const fontId = projection.font.id;
    assert(lease.evidence.sha256 === projection.font.declaration.sha256, 'captureと実font bytesのhashが一致しません。');
    // As in portable Viewer loading, the verified font gets a runtime-only family.
    // The projection and production declaration remain unchanged.
    const runtimeDeclaration = { ...projection.font.declaration, family: lease.runtimeFontFamily };
    const manifestHash = await sha256DsfBytes(new TextEncoder().encode(serializeDsfReleaseJson(projection.manifest)));
    const bundle = {
        index: {
            schemaVersion: DSF_DELIVERY_SCHEMA_VERSION, layoutModel: DSF_DELIVERY_LAYOUT_MODEL,
            canonicalPage: { width: CANONICAL_PAGE_WIDTH, height: CANONICAL_PAGE_HEIGHT, aspectRatio: '9:16' },
            defaultLang: 'ja', fonts: { [fontId]: runtimeDeclaration },
            languages: { ja: {
                href: 'content/fixture-ja.json', pageCount: projection.manifest.pages.length,
                sha256: manifestHash, pageDirection: projection.writingMode === 'vertical-rl' ? 'rtl' : 'ltr',
            } },
        },
        manifests: { ja: projection.manifest },
    };
    return prepareDsfViewerFixedTextContext({
        bundle, language: 'ja', certifiedFonts: { [fontId]: runtimeDeclaration }, fontFaceSet: document.fonts,
    });
}

function makeColumn(label, kind) {
    const figure = document.createElement('figure');
    const caption = document.createElement('figcaption');
    caption.textContent = label;
    const pages = document.createElement('div');
    pages.className = 'fixture-page-list';
    pages.dataset.kind = kind;
    figure.append(caption, pages);
    return { figure, pages };
}

async function renderCase(settings) {
    const { family, weight, writingMode, structure, source, caseId, textAlign } = settings;
    const group = createGroup(settings);
    const expectedSource = sourceEntries(group).map((entry) => entry.text).join('');
    const originalGroup = JSON.stringify(group);
    const fontId = resolveFontId(family);
    const lease = await getFontLease(fontId);
    const session = await createFlowPublicationCompositionCaptureSession({
        ownerDocument: document, flowGroup: group, language: 'ja', revision: 1,
        fontRegistry, fontId, runtimeFontFamily: lease.runtimeFontFamily,
    });
    try {
        const pagination = session.paginate({ maxPages: 20 });
        const snapshot = session.capture(pagination);
        const projection = projectFlowPaginationToDsfV2({
            flowGroup: group, language: 'ja', revision: 1, pagination, compositionSnapshot: snapshot,
            fontRegistry, fontId,
            pageIds: pagination.pages.map((_, index) => `${caseId}-page-${index + 1}`),
            pageLabels: pagination.pages.map((_, index) => String(index + 1)),
        });
        assert(projection.ok, `${projection.publicationBlocked?.code}: ${projection.publicationBlocked?.message}`);
        const paginationText = pagination.pages.flatMap((page) => page.fragments).map((fragment) => fragment.text).join('');
        const projectedText = projection.manifest.pages.flatMap((page) => page.lines)
            .flatMap((line) => line.runs).map((run) => run.text).join('');
        assert(paginationText === expectedSource, 'paginationで原文が変化しました。');
        assert(projectedText === expectedSource, 'fixedText projectionで原文が変化しました。');
        const serialized = serializeProject({
            version: 6, blocks: [group], sections: [], pages: [],
            languages: ['ja'], defaultLang: 'ja', activeLang: 'ja',
        });
        const restored = deserializeProject(serialized);
        assert(JSON.stringify(restored.blocks[0]) === originalGroup, '保存再読込でFlow sourceが変化しました。');
        assert(JSON.stringify(group) === originalGroup, '検証処理がFlow sourceを変更しました。');
        const viewerContext = await createViewerContext(projection, lease);

        const article = document.createElement('article');
        article.className = 'fixture-case';
        article.dataset.testid = caseId;
        article.dataset.family = family;
        article.dataset.weight = String(weight);
        article.dataset.writingMode = writingMode;
        article.dataset.structure = structure;
        const heading = document.createElement('h2');
        heading.textContent = `${family} / ${weight} / ${writingMode} / ${structure}`;
        const row = document.createElement('div');
        row.className = 'fixture-pages';
        const normal = makeColumn('通常Flow（実認定font）', 'flow');
        const fixed = makeColumn('capture → projection → 固定テキストViewer', 'viewer');
        row.append(normal.figure, fixed.figure);
        article.append(heading, row);
        for (let index = 0; index < pagination.pages.length; index += 1) {
            const pageElement = document.createElement('div');
            pageElement.className = 'fixture-page';
            renderFlowGeneratedPage(pageElement, {
                page: pagination.pages[index], pageBox: session.pageBox,
                typography: { ...session.typography, fontFamily: `"${lease.runtimeFontFamily}"` },
                writingMode, languageKey: 'ja', hyphenation: 'none',
            });
            normal.pages.append(pageElement);
            fixed.pages.append(createDsfFixedTextPageElement({
                documentRef: document, page: viewerContext.manifest.pages[index], context: viewerContext,
            }));
        }
        input('results').append(article);
        const renderedFlowText = [...normal.pages.querySelectorAll('.flow-dom-block')]
            .map((element) => element.dataset.sourceStart === element.dataset.sourceEnd ? '' : element.textContent).join('');
        assert(renderedFlowText === expectedSource, '通常Flow DOMの原文が一致しません。');
        assert(fixed.pages.textContent === expectedSource, 'Viewer DOMの原文が一致しません。');
        const glyphRanges = compareGlyphRanges(group, normal.pages, fixed.pages, pagination, projection.manifest);
        article.dataset.glyphDeltaMaxPx = String(glyphRanges.deltaMaxPx);
        article.dataset.comparedGlyphs = String(glyphRanges.comparedGlyphs);

        const forced = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = '比較専用：従来のfeature指定（縦書きのみforced vert / vkna、50%）';
        const shell = document.createElement('div');
        shell.className = 'fixture-forced-shell';
        shell.style.width = `${CANONICAL_PAGE_WIDTH / 2}px`;
        shell.style.height = `${CANONICAL_PAGE_HEIGHT / 2}px`;
        const clone = normal.pages.firstElementChild.cloneNode(true);
        clone.style.transform = 'scale(0.5)';
        clone.querySelectorAll('.flow-dom-block').forEach((element) => {
            element.style.fontFeatureSettings = writingMode === 'vertical-rl' ? '"vert" 1, "vkna" 1' : 'normal';
        });
        shell.append(clone);
        forced.append(summary, shell);
        article.append(forced);
        const result = {
            caseId, family, weight, writingMode, structure, textAlign, fontId,
            fontSha256: lease.evidence.sha256, fontBytes: lease.evidence.byteLength,
            sourceUnchanged: true, paginationNoLoss: true, projectionNoLoss: true,
            sourceRoundtrip: true, viewerTextNoLoss: true, capture: snapshot.status,
            rendererVersion: snapshot.rendererVersion, pages: pagination.pages.length,
            lines: projection.summary.lineCount,
            glyphRanges,
            flowFontFeatures: normal.pages.querySelector('.flow-dom-block')
                ? getComputedStyle(normal.pages.querySelector('.flow-dom-block')).fontFeatureSettings : null,
            viewerFontFeatures: fixed.pages.querySelector('.viewer-fixed-text-line')
                ? getComputedStyle(fixed.pages.querySelector('.viewer-fixed-text-line')).fontFeatureSettings : null,
        };
        const detail = document.createElement('pre');
        detail.dataset.state = 'pass';
        detail.textContent = JSON.stringify(result, null, 2);
        article.append(detail);
        article.dataset.state = 'pass';
        return result;
    } finally {
        session.dispose();
    }
}

async function render(all = false) {
    if (!development || busy) return;
    busy = true;
    input('render').disabled = true;
    input('all').disabled = true;
    input('results').replaceChildren();
    const report = input('report');
    report.dataset.state = 'loading';
    const source = input('source').value;
    const structure = input('structure').value;
    const textAlign = input('align').value;
    const cases = [];
    for (const family of all ? families : [input('font').value]) {
        for (const weight of all ? [400, 700] : [Number(input('weight').value)]) {
            for (const writingMode of all ? writingModes : [input('mode').value]) {
                cases.push({ family, weight, writingMode, structure, textAlign, source, caseId: `punctuation-${cases.length + 1}` });
            }
        }
    }
    try {
        const results = [];
        for (const settings of cases) {
            report.textContent = `認定font読み込み・実DOM計測中… ${results.length + 1}/${cases.length}`;
            results.push(await renderCase(settings));
        }
        report.dataset.state = 'pass';
        report.dataset.caseCount = String(results.length);
        const deltaMaxPx = Math.max(...results.map((result) => result.glyphRanges.deltaMaxPx));
        report.textContent = `PASS: ${results.length}条件でcapture・projection・原文無損失・保存再読込・全glyph座標が一致。deltaMax=${deltaMaxPx.toFixed(4)}px。字形の向きは目視確認してください。\n`
            + `structure=${structure}\n`
            + `source=${JSON.stringify(source)}\n`
            + `codePoints=${[...source].map((character) => `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(' ')}`;
    } catch (error) {
        report.dataset.state = 'error';
        report.textContent = `ERROR: ${error.code || error.name}: ${error.message}\n`
            + `context=${JSON.stringify(error.context || error.details || null, null, 2)}`;
    } finally {
        busy = false;
        input('render').disabled = false;
        input('all').disabled = false;
    }
}

if (development) {
    input('render').addEventListener('click', () => render());
    input('all').addEventListener('click', () => render(true));
    window.addEventListener('pagehide', () => {
        abortController.abort();
        for (const lease of fontLeases.values()) lease.then((value) => value.dispose()).catch(() => {});
        fontLeases.clear();
    }, { once: true });
    render();
} else {
    input('report').dataset.state = 'disabled';
    input('report').textContent = 'このfixtureはVite development server専用です。';
    input('render').disabled = true;
    input('all').disabled = true;
}
