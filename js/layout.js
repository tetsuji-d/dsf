/**
 * layout.js — Fixed 9:16 text composition for deterministic paging.
 */

import { CANONICAL_PAGE_WIDTH, CANONICAL_PAGE_HEIGHT } from './page-geometry.js';

/** 本文枠は正規論理ページ（`page-geometry`）の内側余白として導出する */
const FRAME_PAD_X = 20;
const FRAME_PAD_Y = 20;
const DEFAULT_FRAME = {
    x: FRAME_PAD_X,
    y: FRAME_PAD_Y,
    w: CANONICAL_PAGE_WIDTH - FRAME_PAD_X * 2,
    h: CANONICAL_PAGE_HEIGHT - FRAME_PAD_Y * 2
};
export const LAYOUT_VERSION = 2;
const DEFAULT_FONT_PRESET = 'gothic';

const FONT_PRESETS = {
    gothic: {
        label: 'ゴシック',
        ja: "'Noto Sans JP','Hiragino Sans','Hiragino Kaku Gothic ProN','Yu Gothic UI',sans-serif",
        en: "'Noto Sans',Arial,'Helvetica Neue','Segoe UI',sans-serif"
    },
    mincho: {
        label: '明朝',
        ja: "'Noto Serif JP','Hiragino Mincho ProN','Yu Mincho',serif",
        en: "'Noto Serif',Georgia,'Times New Roman',serif"
    },
    ui: {
        label: 'UI Sans',
        ja: "'Yu Gothic UI',Meiryo,sans-serif",
        en: "'Segoe UI',Arial,sans-serif"
    }
};

const KINSOKU_LINE_START = new Set(Array.from('、。，．・：；！？)]}〉》」』】ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮー'));
const KINSOKU_LINE_END = new Set(Array.from('([<{〈《「『【'));

function countChars(text) {
    return Array.from(text || '').length;
}

function splitByChars(text, maxChars) {
    if (!text) return ['', ''];
    const arr = Array.from(text);
    if (arr.length <= maxChars) return [text, ''];
    return [arr.slice(0, maxChars).join(''), arr.slice(maxChars).join('')];
}

function normalizeText(raw) {
    return String(raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

let measureCanvas = null;
function getMeasureContext() {
    if (measureCanvas) return measureCanvas.getContext('2d');
    measureCanvas = document.createElement('canvas');
    return measureCanvas.getContext('2d');
}

function measureTextWidth(text, font) {
    const ctx = getMeasureContext();
    if (!ctx) return countChars(text);
    ctx.font = font;
    return ctx.measureText(text || '').width;
}

function resolveFontFamily(lang, fontPreset) {
    const isJa = (lang || '').toLowerCase().startsWith('ja');
    const key = FONT_PRESETS[fontPreset] ? fontPreset : DEFAULT_FONT_PRESET;
    return isJa ? FONT_PRESETS[key].ja : FONT_PRESETS[key].en;
}

function getLangPreset(lang, writingMode, fontPreset = DEFAULT_FONT_PRESET) {
    const isJa = (lang || '').toLowerCase().startsWith('ja');
    const vertical = writingMode === 'vertical-rl';
    const family = resolveFontFamily(lang, fontPreset);
    if (isJa || vertical) {
        return {
            writingMode: 'vertical-rl',
            frame: { ...DEFAULT_FRAME },
            font: {
                family,
                size: 16,
                lineHeight: 1.8,
                letterSpacing: 0
            },
            rules: {
                maxLines: 12,
                charsPerLine: 33,
                maxChars: 400,
                wordBreak: 'break-all',
                kinsoku: true
            }
        };
    }
    return {
        writingMode: 'horizontal-tb',
        frame: { ...DEFAULT_FRAME },
        font: {
            family,
            size: 16,
            lineHeight: 1.8,
            letterSpacing: 0
        },
        rules: {
            maxLines: 20,
            charsPerLine: 32,
            maxChars: 680,
            wordBreak: 'keep-word',
            kinsoku: false
        }
    };
}

function wrapCjkParagraph(paragraph, charsPerLine, kinsoku) {
    const chars = Array.from(paragraph || '');
    const lines = [];
    let buf = '';
    for (let i = 0; i < chars.length; i += 1) {
        const ch = chars[i];
        buf += ch;
        if (countChars(buf) >= charsPerLine) {
            if (kinsoku && i + 1 < chars.length) {
                const next = chars[i + 1];
                if (KINSOKU_LINE_START.has(next)) {
                    buf += next;
                    i += 1;
                }
                const last = Array.from(buf).slice(-1)[0];
                if (KINSOKU_LINE_END.has(last) && lines.length > 0) {
                    const prev = lines.pop();
                    lines.push(prev + last);
                    buf = Array.from(buf).slice(0, -1).join('');
                }
            }
            lines.push(buf);
            buf = '';
        }
    }
    if (buf) lines.push(buf);
    return lines;
}

function splitTokenByWidth(token, maxWidthPx, font) {
    const out = [];
    let rest = String(token || '');
    while (rest) {
        if (measureTextWidth(rest, font) <= maxWidthPx) {
            out.push(rest);
            break;
        }
        let lo = 1;
        let hi = rest.length;
        let fit = 1;
        while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            const part = rest.slice(0, mid);
            if (measureTextWidth(part, font) <= maxWidthPx) {
                fit = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        out.push(rest.slice(0, fit));
        rest = rest.slice(fit);
    }
    return out;
}

function wrapWordParagraph(paragraph, maxWidthPx, font) {
    const tokens = String(paragraph || '').split(/(\s+)/);
    const lines = [];
    let line = '';
    for (const token of tokens) {
        if (!token) continue;
        const isSpace = /^\s+$/.test(token);
        if (isSpace) {
            if (!line) continue;
            const candidate = line + token;
            if (measureTextWidth(candidate, font) <= maxWidthPx) {
                line = candidate;
            } else {
                lines.push(line.trimEnd());
                line = '';
            }
            continue;
        }
        const candidate = line ? line + token : token;
        if (measureTextWidth(candidate, font) <= maxWidthPx) {
            line = candidate;
            continue;
        }
        if (line) {
            lines.push(line.trimEnd());
            line = '';
        }
        if (measureTextWidth(token, font) <= maxWidthPx) {
            line = token;
            continue;
        }
        const chunks = splitTokenByWidth(token, maxWidthPx, font);
        if (chunks.length > 1) {
            lines.push(...chunks.slice(0, -1));
        }
        line = chunks[chunks.length - 1] || '';
    }
    if (line) lines.push(line.trimEnd());
    return lines;
}

function composeWithPreset(rawText, preset) {
    const normalized = normalizeText(rawText);
    const [limitedText, cutByCharLimit] = splitByChars(normalized, preset.rules.maxChars);
    const paragraphs = limitedText.split('\n');
    const lines = [];
    const maxWidthPx = preset.frame.w;
    const font = `${preset.font.size}px ${preset.font.family}`;
    const wrap = preset.rules.wordBreak === 'keep-word'
        ? (p) => wrapWordParagraph(p, maxWidthPx, font)
        : (p) => wrapCjkParagraph(p, preset.rules.charsPerLine, preset.rules.kinsoku);
    const charsPerLine = preset.rules.charsPerLine;

    for (let i = 0; i < paragraphs.length; i += 1) {
        const para = paragraphs[i];
        if (!para) {
            lines.push('');
        } else {
            lines.push(...wrap(para, charsPerLine));
        }
    }

    const maxLines = preset.rules.maxLines;
    let overflow = false;
    let overflowText = cutByCharLimit;
    let fittedLines = lines;
    if (lines.length > maxLines) {
        overflow = true;
        fittedLines = lines.slice(0, maxLines);
        const rest = lines.slice(maxLines).join('\n');
        overflowText = rest + (overflowText || '');
    } else if (overflowText) {
        overflow = true;
    }

    return {
        lines: fittedLines,
        overflow,
        overflowText
    };
}

export function composeText(rawText, lang, writingMode, fontPreset = DEFAULT_FONT_PRESET) {
    const preset = getLangPreset(lang, writingMode, fontPreset);
    const out = composeWithPreset(rawText, preset);
    return {
        version: LAYOUT_VERSION,
        writingMode: preset.writingMode,
        frame: preset.frame,
        font: preset.font,
        rules: preset.rules,
        lines: out.lines,
        overflow: out.overflow,
        overflowText: out.overflowText,
        fontPreset: FONT_PRESETS[fontPreset] ? fontPreset : DEFAULT_FONT_PRESET,
        styleHash: `${preset.writingMode}:${preset.font.family}:${preset.font.size}:${preset.rules.maxLines}:${preset.rules.charsPerLine}`
    };
}

export function getWritingModeFromConfigs(lang, languageConfigs) {
    if (languageConfigs && languageConfigs[lang]?.writingMode) {
        return languageConfigs[lang].writingMode;
    }
    return (lang || '').toLowerCase().startsWith('ja') ? 'vertical-rl' : 'horizontal-tb';
}

export function getFontPresetFromConfigs(lang, languageConfigs) {
    const key = languageConfigs?.[lang]?.fontPreset;
    return FONT_PRESETS[key] ? key : DEFAULT_FONT_PRESET;
}

export function getFontPresetOptions() {
    return Object.entries(FONT_PRESETS).map(([value, cfg]) => ({ value, label: cfg.label }));
}

export function composeCanonicalLayoutsForSections(sections, languages, languageConfigs) {
    const list = Array.isArray(sections) ? sections : [];
    const langs = Array.isArray(languages) && languages.length ? languages : ['ja'];
    for (const s of list) {
        if (!s || s.type !== 'text') continue;
        if (!s.texts || typeof s.texts !== 'object') s.texts = {};
        if (!s.layout || typeof s.layout !== 'object') s.layout = {};
        for (const lang of langs) {
            const raw = s.texts[lang] !== undefined ? s.texts[lang] : (s.text || '');
            const writingMode = getWritingModeFromConfigs(lang, languageConfigs);
            const fontPreset = getFontPresetFromConfigs(lang, languageConfigs);
            s.layout[lang] = composeText(raw, lang, writingMode, fontPreset);
        }
    }
    return list;
}
