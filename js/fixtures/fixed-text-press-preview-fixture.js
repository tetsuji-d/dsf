/** Local-only font declarations for the 9A-3B Press preview. */

const GOOGLE_FONTS_STYLESHEET = 'https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;700&family=Noto+Sans+JP:wght@400;700&family=Noto+Serif:wght@400;700&family=Noto+Serif+JP:wght@400;700&display=swap';

const FONT_FIXTURES = Object.freeze({
    'Noto Sans JP': Object.freeze({
        id: 'fixture-press-noto-sans-jp',
        declaration: Object.freeze({
            family: 'Noto Sans JP',
            version: 'local-press-preview-1',
            source: 'registry',
            href: GOOGLE_FONTS_STYLESHEET,
            sha256: '1'.repeat(64),
        }),
    }),
    'Noto Serif JP': Object.freeze({
        id: 'fixture-press-noto-serif-jp',
        declaration: Object.freeze({
            family: 'Noto Serif JP',
            version: 'local-press-preview-1',
            source: 'registry',
            href: GOOGLE_FONTS_STYLESHEET,
            sha256: '2'.repeat(64),
        }),
    }),
    'Noto Sans': Object.freeze({
        id: 'fixture-press-noto-sans',
        declaration: Object.freeze({
            family: 'Noto Sans',
            version: 'local-press-preview-1',
            source: 'registry',
            href: GOOGLE_FONTS_STYLESHEET,
            sha256: '3'.repeat(64),
        }),
    }),
    'Noto Serif': Object.freeze({
        id: 'fixture-press-noto-serif',
        declaration: Object.freeze({
            family: 'Noto Serif',
            version: 'local-press-preview-1',
            source: 'registry',
            href: GOOGLE_FONTS_STYLESHEET,
            sha256: '4'.repeat(64),
        }),
    }),
});

function getPrimaryFontFamily(fontFamily) {
    return String(fontFamily || '')
        .split(',')[0]
        .trim()
        .replace(/^['"]|['"]$/g, '');
}

export function getFixedTextPressPreviewFontFixture(fontFamily) {
    const fixture = FONT_FIXTURES[getPrimaryFontFamily(fontFamily)];
    if (!fixture) return null;
    return {
        id: fixture.id,
        declaration: { ...fixture.declaration },
    };
}
