/** Development-only font registry shaped like production for 9A-6A Press checks. */

import {
    DSF_FONT_REGISTRY_KIND,
    DSF_FONT_REGISTRY_SCHEMA_VERSION,
} from '../dsf-font-registry.js';

const CJK_LANGUAGES = Object.freeze(['ja', 'zh-cn', 'zh-tw', 'ko']);
const LATIN_LANGUAGES = Object.freeze(['en', 'en-us', 'en-gb', 'fr', 'es', 'de', 'pt', 'it', 'ru']);

function createFixtureEntry({ family, id, hashCharacter, languages, writingModes }) {
    return Object.freeze({
        declaration: Object.freeze({
            family,
            version: 'local-flow-press-preflight-1',
            source: 'registry',
            href: `https://assets.dsf.ink/fonts/${id}.woff2`,
            sha256: hashCharacter.repeat(64),
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
            languages,
            writingModes,
            fontWeights: Object.freeze([400, 700]),
            fontStyles: Object.freeze(['normal']),
        }),
    });
}

const FONT_IDS_BY_FAMILY = Object.freeze({
    'Noto Sans JP': 'fixture-flow-press-noto-sans-jp',
    'Noto Serif JP': 'fixture-flow-press-noto-serif-jp',
    'Noto Sans': 'fixture-flow-press-noto-sans',
    'Noto Serif': 'fixture-flow-press-noto-serif',
});

export const FLOW_PRESS_PREFLIGHT_FIXTURE_FONT_REGISTRY = Object.freeze({
    schemaVersion: DSF_FONT_REGISTRY_SCHEMA_VERSION,
    registryKind: DSF_FONT_REGISTRY_KIND,
    fonts: Object.freeze({
        [FONT_IDS_BY_FAMILY['Noto Sans JP']]: createFixtureEntry({
            family: 'Noto Sans JP',
            id: FONT_IDS_BY_FAMILY['Noto Sans JP'],
            hashCharacter: '5',
            languages: CJK_LANGUAGES,
            writingModes: Object.freeze(['horizontal-tb', 'vertical-rl']),
        }),
        [FONT_IDS_BY_FAMILY['Noto Serif JP']]: createFixtureEntry({
            family: 'Noto Serif JP',
            id: FONT_IDS_BY_FAMILY['Noto Serif JP'],
            hashCharacter: '6',
            languages: CJK_LANGUAGES,
            writingModes: Object.freeze(['horizontal-tb', 'vertical-rl']),
        }),
        [FONT_IDS_BY_FAMILY['Noto Sans']]: createFixtureEntry({
            family: 'Noto Sans',
            id: FONT_IDS_BY_FAMILY['Noto Sans'],
            hashCharacter: '7',
            languages: LATIN_LANGUAGES,
            writingModes: Object.freeze(['horizontal-tb']),
        }),
        [FONT_IDS_BY_FAMILY['Noto Serif']]: createFixtureEntry({
            family: 'Noto Serif',
            id: FONT_IDS_BY_FAMILY['Noto Serif'],
            hashCharacter: '8',
            languages: LATIN_LANGUAGES,
            writingModes: Object.freeze(['horizontal-tb']),
        }),
    }),
});

function primaryFontFamily(value) {
    return String(value || '')
        .split(',')[0]
        .trim()
        .replace(/^['"]|['"]$/g, '');
}

export function resolveFlowPressPreflightFixtureFont(fontFamily, language, writingMode) {
    const fontId = FONT_IDS_BY_FAMILY[primaryFontFamily(fontFamily)];
    const font = fontId ? FLOW_PRESS_PREFLIGHT_FIXTURE_FONT_REGISTRY.fonts[fontId] : null;
    if (!font
        || !font.capabilities.languages.includes(language)
        || !font.capabilities.writingModes.includes(writingMode)) return null;
    return Object.freeze({ fontId, font });
}
