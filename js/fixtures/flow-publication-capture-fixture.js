/** Development-only browser fixture for 9A-5B Flow publication capture. */

import {
    createFlowPublicationCompositionCaptureSession,
} from '../flow-publication-composition-capture.js';
import { projectFlowPaginationToDsfV2 } from '../flow-publication-projection.js';
import {
    DSF_FONT_REGISTRY_KIND,
    DSF_FONT_REGISTRY_SCHEMA_VERSION,
} from '../dsf-font-registry.js';

if (!import.meta.env.DEV) {
    throw new Error('Flow publication capture fixture is available only on the development server.');
}

const FONT_ID = 'fixture-flow-publication-noto-sans-jp';
const FONT_SHA256 = 'c'.repeat(64);
const FONT_REGISTRY = Object.freeze({
    schemaVersion: DSF_FONT_REGISTRY_SCHEMA_VERSION,
    registryKind: DSF_FONT_REGISTRY_KIND,
    fonts: Object.freeze({
        [FONT_ID]: Object.freeze({
            declaration: Object.freeze({
                family: 'Noto Sans JP',
                version: 'local-capture-fixture-1',
                source: 'registry',
                href: 'https://assets.dsf.ink/fonts/fixture-flow-publication-noto-sans-jp.woff2',
                sha256: FONT_SHA256,
            }),
            asset: Object.freeze({
                format: 'woff2',
                mimeType: 'font/woff2',
                byteLength: 123456,
                immutable: true,
            }),
            license: Object.freeze({
                spdxId: 'OFL-1.1',
                licenseHref: 'https://openfontlicense.org/open-font-license-official-text/',
                rightsHolder: 'Synthetic local fixture only',
                reviewedAt: '2026-08-23',
                reviewedBy: 'Automated local fixture',
                allowsWebDistribution: true,
                allowsPortableEmbedding: true,
            }),
            capabilities: Object.freeze({
                languages: Object.freeze(['ja']),
                writingModes: Object.freeze(['horizontal-tb', 'vertical-rl']),
                fontWeights: Object.freeze([400, 700]),
                fontStyles: Object.freeze(['normal']),
            }),
        }),
    }),
});

const LONG_PARAGRAPH = Array.from({ length: 44 }, (_, index) => (
    `${index + 1}。冬の金沢は静かだった。神谷はホテルの窓から、雪の降る街を眺めていた。`
)).join('');

function createFlowGroup(writingMode) {
    const suffix = writingMode === 'vertical-rl' ? 'vertical' : 'horizontal';
    return {
        id: `fixture-flow-${suffix}`,
        kind: 'flow',
        flow: {
            document: {
                schemaVersion: 1,
                layoutType: 'flow',
                id: `fixture-document-${suffix}`,
                sourceLanguage: 'ja',
                sections: [{
                    id: `fixture-section-${suffix}`,
                    title: { ja: '第一章' },
                    blocks: [
                        { id: `fixture-heading-${suffix}`, type: 'heading', level: 1, texts: { ja: '第一章　冬の金沢' } },
                        { id: `fixture-long-${suffix}`, type: 'paragraph', texts: { ja: LONG_PARAGRAPH } },
                        { id: `fixture-break-${suffix}`, type: 'pageBreak' },
                        { id: `fixture-empty-${suffix}`, type: 'paragraph', texts: { ja: '' } },
                        {
                            id: `fixture-after-${suffix}`,
                            type: 'paragraph',
                            texts: { ja: '「行くか」\n彼はコートを手に取った。改ページ後もsemantic sourceは失われない。' },
                        },
                    ],
                }],
            },
            layout: {
                padding: { top: 24, right: 24, bottom: 24, left: 24 },
                typographyByLanguage: {
                    ja: {
                        writingMode,
                        fontFamily: "'Noto Sans JP',sans-serif",
                        fontSize: 16,
                        fontWeight: '400',
                        lineHeight: 1.8,
                        letterSpacing: 0,
                        textAlign: 'start',
                        paragraphSpacing: 12,
                        headingSpacing: 18,
                        textColor: '#1f1b16',
                        paperColor: '#f7f1df',
                    },
                },
            },
        },
    };
}

function sourceTextByBlock(group) {
    return new Map(group.flow.document.sections.flatMap((section) => (
        section.blocks
            .filter((block) => block.type === 'heading' || block.type === 'paragraph')
            .map((block) => [block.id, block.texts.ja])
    )));
}

function assertProjectionSourceComplete(group, projection) {
    const source = sourceTextByBlock(group);
    const projected = new Map();
    for (const page of projection.manifest.pages) {
        for (const line of page.lines) {
            for (const run of line.runs) {
                projected.set(run.source.blockId, `${projected.get(run.source.blockId) || ''}${run.text}`);
            }
        }
    }
    for (const [blockId, text] of source) {
        if (projected.get(blockId) !== text) {
            throw new Error(`Projected source mismatch for ${blockId}.`);
        }
    }
    return true;
}

async function runCase(writingMode) {
    const group = createFlowGroup(writingMode);
    const revision = 15;
    const session = await createFlowPublicationCompositionCaptureSession({
        ownerDocument: document,
        flowGroup: group,
        language: 'ja',
        revision,
        fontRegistry: FONT_REGISTRY,
        fontId: FONT_ID,
    });
    try {
        const pagination = session.paginate({ maxPages: 100 });
        const snapshot = session.capture(pagination);
        const projection = projectFlowPaginationToDsfV2({
            flowGroup: group,
            language: 'ja',
            revision,
            pagination,
            compositionSnapshot: snapshot,
            fontRegistry: FONT_REGISTRY,
            fontId: FONT_ID,
            pageIds: pagination.pages.map((_, index) => (
                `${group.id}-ja-${String(index + 1).padStart(4, '0')}`
            )),
            pageLabels: pagination.pages.map((_, index) => String(index + 1)),
        });
        if (!projection.ok) {
            throw new Error(`${projection.publicationBlocked?.code}: ${projection.publicationBlocked?.message}`);
        }
        const sourceComplete = assertProjectionSourceComplete(group, projection);
        return {
            writingMode,
            pageCount: pagination.pages.length,
            manualBreakCount: pagination.pages.filter((page) => page.manualBreakBefore).length,
            lineCount: projection.summary.lineCount,
            runCount: projection.summary.runCount,
            sourceComplete,
            hyphenation: snapshot.evidence.hyphenation,
            fontFamily: session.font.declaration.family,
            rendererVersion: snapshot.rendererVersion,
            measurementCalls: session.getMetrics().totalCalls,
        };
    } finally {
        session.dispose();
    }
}

function renderResult(result) {
    const article = document.createElement('article');
    article.className = 'capture-result-card';
    article.dataset.testid = `capture-result-${result.writingMode}`;
    article.dataset.writingMode = result.writingMode;
    article.dataset.pageCount = String(result.pageCount);
    article.dataset.lineCount = String(result.lineCount);
    article.dataset.runCount = String(result.runCount);
    article.dataset.sourceComplete = String(result.sourceComplete);
    article.dataset.hyphenation = result.hyphenation;
    article.innerHTML = `
        <h2>${result.writingMode === 'vertical-rl' ? '縦書き' : '横書き'} <small>${result.writingMode}</small></h2>
        <dl>
            <dt>generated pages</dt><dd>${result.pageCount}</dd>
            <dt>captured lines / columns</dt><dd>${result.lineCount}</dd>
            <dt>semantic runs</dt><dd>${result.runCount}</dd>
            <dt>manual pageBreak</dt><dd>${result.manualBreakCount}</dd>
            <dt>source no-loss</dt><dd class="capture-ok">${result.sourceComplete ? 'OK' : 'NG'}</dd>
            <dt>hyphenation</dt><dd>${result.hyphenation}</dd>
            <dt>certified family</dt><dd>${result.fontFamily}</dd>
            <dt>renderer</dt><dd>v${result.rendererVersion}</dd>
            <dt>DOM measurements</dt><dd>${result.measurementCalls}</dd>
        </dl>
    `;
    return article;
}

async function main() {
    const status = document.getElementById('capture-status');
    const detail = document.getElementById('capture-detail');
    const resultsElement = document.getElementById('capture-results');
    const errorElement = document.getElementById('capture-error');
    try {
        const results = [];
        for (const writingMode of ['horizontal-tb', 'vertical-rl']) {
            status.textContent = `${writingMode} を実DOM計測しています`;
            results.push(await runCase(writingMode));
        }
        resultsElement.replaceChildren(...results.map(renderResult));
        document.body.dataset.captureState = 'ready';
        document.body.dataset.captureCaseCount = String(results.length);
        status.textContent = '9A-5B local capture OK';
        detail.textContent = '横書き・縦書きとも、生成ページ数、Range座標、source run、9A-5A投影が一致しました。';
    } catch (error) {
        document.body.dataset.captureState = 'error';
        status.textContent = '9A-5B local capture failed';
        detail.textContent = error?.code || error?.name || 'Unknown error';
        errorElement.hidden = false;
        errorElement.textContent = error?.stack || error?.message || String(error);
        console.error('[Flow publication capture fixture]', error);
    }
}

main();
