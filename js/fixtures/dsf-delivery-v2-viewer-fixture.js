const FIXTURE_HASH = 'c'.repeat(64);
const FIXTURE_FONT_HREF = 'https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;700&display=swap';

export const DSF_DELIVERY_V2_VIEWER_FIXTURE_ID = 'dsf-delivery-v2';
export const DSF_DELIVERY_V2_FIXTURE_IMAGE_HREF = 'fixtures/dsf-delivery-v2-cover.webp';

export const DSF_DELIVERY_V2_FIXTURE_FONT_CERTIFICATES = Object.freeze({
    'fixture-noto-serif-jp': Object.freeze({
        family: 'Noto Serif JP',
        version: 'fixture-1',
        source: 'registry',
        href: FIXTURE_FONT_HREF,
        sha256: FIXTURE_HASH,
    }),
});

function fixedTextLine({
    x,
    y,
    width,
    height,
    text,
    styleRef = 'body',
    writingMode = 'horizontal-tb',
    textOrientation = 'mixed',
    runStyleRef,
    blockId,
}) {
    return {
        x,
        y,
        width,
        height,
        writingMode,
        textOrientation,
        styleRef,
        runs: [{
            text,
            ...(runStyleRef ? { styleRef: runStyleRef } : {}),
            source: {
                blockId,
                startGrapheme: 0,
                endGrapheme: [...text].length,
            },
        }],
    };
}

export function createDsfDeliveryV2ViewerFixture() {
    const styles = {
        body: {
            fontRef: 'fixture-noto-serif-jp',
            fontSize: 16,
            fontWeight: 400,
            fontStyle: 'normal',
            lineHeight: 1.75,
            letterSpacing: 0.15,
            color: '#2b2520',
            textDecoration: 'none',
            textAlign: 'start',
        },
        heading: {
            fontRef: 'fixture-noto-serif-jp',
            fontSize: 26,
            fontWeight: 700,
            fontStyle: 'normal',
            lineHeight: 1.25,
            letterSpacing: 1.2,
            color: '#312820',
            textDecoration: 'none',
            textAlign: 'start',
        },
        emphasis: {
            fontRef: 'fixture-noto-serif-jp',
            fontSize: 18,
            fontWeight: 700,
            fontStyle: 'normal',
            lineHeight: 1.6,
            letterSpacing: 0.4,
            color: '#7c2d12',
            textDecoration: 'none',
            textAlign: 'start',
        },
    };

    const pages = [
        {
            id: 'fixture-cover',
            renderKind: 'image',
            pageLabel: 'WebP画像ページ',
            sourceAnchor: { kind: 'fixed', blockId: 'fixture-cover' },
            image: {
                href: DSF_DELIVERY_V2_FIXTURE_IMAGE_HREF,
                width: 1080,
                height: 1920,
                mimeType: 'image/webp',
            },
        },
        {
            id: 'fixture-horizontal',
            renderKind: 'fixedText',
            pageLabel: '固定テキスト・横書き',
            sourceAnchor: {
                kind: 'flow',
                flowGroupId: 'fixture-story',
                sectionId: 'fixture-section-1',
                firstBlockId: 'fixture-heading-1',
                blockProgress: 0,
            },
            background: { color: '#fffaf0' },
            lines: [
                fixedTextLine({ x: 28, y: 42, width: 304, height: 40, text: '第一章　冬の金沢', styleRef: 'heading', blockId: 'fixture-heading-1' }),
                fixedTextLine({ x: 30, y: 122, width: 300, height: 30, text: '冬の金沢は静かだった。', blockId: 'fixture-paragraph-1' }),
                fixedTextLine({ x: 30, y: 164, width: 300, height: 30, text: '神谷はホテルの窓から、', blockId: 'fixture-paragraph-1' }),
                fixedTextLine({ x: 30, y: 206, width: 300, height: 30, text: '雪の降る街を眺めていた。', blockId: 'fixture-paragraph-1' }),
                fixedTextLine({ x: 30, y: 276, width: 300, height: 34, text: '「行くか」', runStyleRef: 'emphasis', blockId: 'fixture-paragraph-2' }),
                fixedTextLine({ x: 30, y: 344, width: 300, height: 30, text: '彼はコートを手に取った。', blockId: 'fixture-paragraph-3' }),
                fixedTextLine({ x: 30, y: 548, width: 300, height: 24, text: '固定座標・Viewer内リフローなし', blockId: 'fixture-note-1' }),
            ],
        },
        {
            id: 'fixture-vertical',
            renderKind: 'fixedText',
            pageLabel: '固定テキスト・縦書き',
            sourceAnchor: {
                kind: 'flow',
                flowGroupId: 'fixture-story',
                sectionId: 'fixture-section-1',
                firstBlockId: 'fixture-paragraph-4',
                blockProgress: 0.55,
            },
            background: { color: '#f7f2e8' },
            lines: [
                fixedTextLine({ x: 310, y: 34, width: 28, height: 560, text: '第二章　雪の音', styleRef: 'heading', writingMode: 'vertical-rl', textOrientation: 'mixed', blockId: 'fixture-heading-2' }),
                fixedTextLine({ x: 258, y: 48, width: 24, height: 540, text: '窓の向こうで、雪は静かに降り続いていた。', writingMode: 'vertical-rl', textOrientation: 'mixed', blockId: 'fixture-paragraph-4' }),
                fixedTextLine({ x: 212, y: 48, width: 24, height: 540, text: '文字は端末幅に合わせて組み直されない。', writingMode: 'vertical-rl', textOrientation: 'mixed', blockId: 'fixture-paragraph-5' }),
                fixedTextLine({ x: 166, y: 48, width: 24, height: 540, text: 'ページ全体だけが一様に拡大縮小される。', writingMode: 'vertical-rl', textOrientation: 'mixed', blockId: 'fixture-paragraph-6' }),
                fixedTextLine({ x: 94, y: 82, width: 26, height: 440, text: '縦書き固定テキスト', runStyleRef: 'emphasis', writingMode: 'vertical-rl', textOrientation: 'upright', blockId: 'fixture-note-2' }),
            ],
        },
        {
            id: 'fixture-literal-text',
            renderKind: 'fixedText',
            pageLabel: '安全な文字列描画',
            sourceAnchor: {
                kind: 'flow',
                flowGroupId: 'fixture-story',
                sectionId: 'fixture-section-1',
                firstBlockId: 'fixture-paragraph-7',
                blockProgress: 0.9,
            },
            background: { color: '#f3f7f6' },
            lines: [
                fixedTextLine({ x: 28, y: 44, width: 304, height: 40, text: '拡大しても文字は鮮明', styleRef: 'heading', blockId: 'fixture-heading-3' }),
                fixedTextLine({ x: 30, y: 132, width: 300, height: 30, text: '本文は画像ではなくDOM文字です。', blockId: 'fixture-paragraph-7' }),
                fixedTextLine({ x: 30, y: 190, width: 300, height: 30, text: '<script>alert("実行されない")</script>', blockId: 'fixture-paragraph-8' }),
                fixedTextLine({ x: 30, y: 248, width: 300, height: 30, text: '上の文字列はtextContentで表示しています。', blockId: 'fixture-paragraph-9' }),
                fixedTextLine({ x: 30, y: 528, width: 300, height: 30, text: '9A-2 local fixture', runStyleRef: 'emphasis', blockId: 'fixture-note-3' }),
            ],
        },
    ];

    const index = {
        schemaVersion: 2,
        layoutModel: 'fixed-page-hybrid-1',
        canonicalPage: { width: 360, height: 640, aspectRatio: '9:16' },
        defaultLang: 'ja',
        fonts: {
            'fixture-noto-serif-jp': { ...DSF_DELIVERY_V2_FIXTURE_FONT_CERTIFICATES['fixture-noto-serif-jp'] },
        },
        languages: {
            ja: {
                href: 'content/ja.json',
                pageCount: pages.length,
                sha256: FIXTURE_HASH,
                pageDirection: 'rtl',
            },
        },
    };

    return {
        index,
        manifests: {
            ja: {
                schemaVersion: 1,
                language: 'ja',
                styles,
                pages,
            },
        },
    };
}

export function createDsfDeliveryV2FixtureImageDataUrl(documentRef) {
    const canvas = documentRef.createElement('canvas');
    canvas.width = 360;
    canvas.height = 640;
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, 360, 640);
    gradient.addColorStop(0, '#0f172a');
    gradient.addColorStop(0.55, '#334155');
    gradient.addColorStop(1, '#9f1239');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 360, 640);
    context.fillStyle = 'rgba(255,255,255,0.92)';
    context.textAlign = 'center';
    context.font = '700 28px serif';
    context.fillText('DSF delivery v2', 180, 270);
    context.font = '18px serif';
    context.fillText('WebP image page', 180, 310);
    context.font = '14px sans-serif';
    context.fillText('次ページから固定テキスト', 180, 356);
    return canvas.toDataURL('image/webp', 0.84);
}
