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

function wrapWordParagraphWithRanges(paragraph, maxWidthPx, font, sourceStart) {
    const text = String(paragraph || '');
    const tokens = [];
    const re = /\s+|\S+/g;
    let match;
    while ((match = re.exec(text)) !== null) {
        tokens.push({
            text: match[0],
            start: match.index,
            end: match.index + match[0].length,
            isSpace: /^\s+$/.test(match[0])
        });
    }

    const lines = [];
    let line = '';
    let lineEnd = 0;

    function pushLine(endOverride = lineEnd) {
        const out = line.trimEnd();
        if (out) {
            lines.push({
                text: out,
                sourceEnd: sourceStart + endOverride,
                breakAfter: false
            });
        }
        line = '';
        lineEnd = endOverride;
    }

    for (const token of tokens) {
        if (!token.text) continue;

        if (token.isSpace) {
            if (!line) {
                lineEnd = token.end;
                continue;
            }
            const candidate = line + token.text;
            if (measureTextWidth(candidate, font) <= maxWidthPx) {
                line = candidate;
                lineEnd = token.end;
            } else {
                pushLine(token.end);
            }
            continue;
        }

        const candidate = line ? line + token.text : token.text;
        if (measureTextWidth(candidate, font) <= maxWidthPx) {
            line = candidate;
            lineEnd = token.end;
            continue;
        }

        if (line) {
            pushLine(lineEnd);
        }

        if (measureTextWidth(token.text, font) <= maxWidthPx) {
            line = token.text;
            lineEnd = token.end;
            continue;
        }

        const chunks = splitTokenByWidth(token.text, maxWidthPx, font);
        let offset = token.start;
        for (let i = 0; i < chunks.length; i += 1) {
            const chunk = chunks[i];
            const chunkEnd = offset + chunk.length;
            if (i < chunks.length - 1) {
                lines.push({
                    text: chunk,
                    sourceEnd: sourceStart + chunkEnd,
                    breakAfter: false
                });
            } else {
                line = chunk;
                lineEnd = chunkEnd;
            }
            offset = chunkEnd;
        }
    }

    if (line) pushLine(lineEnd);
    return lines;
}

function composeHorizontalWithPreset(rawText, preset) {
    const normalized = normalizeText(rawText);
    const paragraphs = normalized.split('\n');
    const lines = [];
    const maxWidthPx = preset.frame.w;
    const font = `${preset.font.size}px ${preset.font.family}`;
    let sourceOffset = 0;

    for (let i = 0; i < paragraphs.length; i += 1) {
        const para = paragraphs[i];
        const hasTrailingNewline = i < paragraphs.length - 1;
        if (!para) {
            lines.push({
                text: '',
                sourceEnd: sourceOffset + (hasTrailingNewline ? 1 : 0),
                breakAfter: true
            });
        } else {
            const wrapped = wrapWordParagraphWithRanges(para, maxWidthPx, font, sourceOffset);
            if (wrapped.length) {
                if (hasTrailingNewline) {
                    wrapped[wrapped.length - 1].sourceEnd = sourceOffset + para.length + 1;
                    wrapped[wrapped.length - 1].breakAfter = true;
                }
                lines.push(...wrapped);
            }
        }
        sourceOffset += para.length + (hasTrailingNewline ? 1 : 0);
    }

    const maxLines = preset.rules.maxLines;
    const fitted = lines.slice(0, maxLines);
    const overflow = lines.length > maxLines;
    const consumedEnd = fitted.length
        ? fitted[fitted.length - 1].sourceEnd
        : 0;
    let overflowText = overflow ? normalized.slice(consumedEnd) : '';
    if (overflowText) overflowText = overflowText.replace(/^[ \t]+/, '');

    return {
        lines: fitted.map(line => line.text),
        lineBreaks: fitted.map(line => !!line.breakAfter),
        overflow,
        overflowText,
        pageText: normalized.slice(0, consumedEnd).trimEnd()
    };
}

function composeWithPreset(rawText, preset) {
    const normalized = normalizeText(rawText);
    if (preset.writingMode === 'horizontal-tb') {
        return composeHorizontalWithPreset(normalized, preset);
    }

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
        lineBreaks: fittedLines.map(() => false),
        overflow,
        overflowText,
        pageText: fittedLines.join('\n')
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
        lineBreaks: out.lineBreaks || out.lines.map(() => false),
        overflow: out.overflow,
        overflowText: out.overflowText,
        pageText: out.pageText,
        fontPreset: FONT_PRESETS[fontPreset] ? fontPreset : DEFAULT_FONT_PRESET,
        styleHash: `${preset.writingMode}:${preset.font.family}:${preset.font.size}:${preset.rules.maxLines}:${preset.rules.charsPerLine}`
    };
}

// ─── ページネーション ────────────────────────────────────────────────────────

/** 手動改ページマーカー。行単独で "===" と入力する。 */
export const PAGE_BREAK_MARKER = '===';

/**
 * テキストを 1 ページ分ずつに分割する。
 *
 * - 行単独の "===" は手動改ページとして扱われる。
 * - 1 ページに収まりきらない場合は overflowText を次ページの入力とし、
 *   自動的にページを追加する。
 *
 * @param {string} rawText   ルビ除去済みのプレーンテキスト
 * @param {string} lang
 * @param {string} writingMode
 * @param {string} [fontPreset]
 * @returns {string[]}  各ページに収まるテキストの配列（最低 1 要素）
 */
export function paginateText(rawText, lang, writingMode, fontPreset = DEFAULT_FONT_PRESET) {
    const normalized = normalizeText(rawText);
    const preset = getLangPreset(lang, writingMode, fontPreset);

    // 行単独の "===" で手動改ページ分割
    const manualSegments = normalized.split(/^===$/m);

    const pages = [];
    for (const segment of manualSegments) {
        if (!segment.trim()) continue; // 空セグメントはスキップ
        let remaining = segment;
        let guard = 500; // 無限ループ防止
        while (remaining && guard-- > 0) {
            const result = composeWithPreset(remaining, preset);
            pages.push((result.pageText || result.lines.join('\n')).trimEnd());
            if (!result.overflow) break;
            remaining = result.overflowText || '';
        }
    }

    return pages.length ? pages : [''];
}

// ─── Ruby (furigana) support ────────────────────────────────────────────────

/**
 * {base|ruby} マークアップをトークン配列に解析する。
 * 入力例: "今日は{漢字|かんじ}が好き" →
 *   [ {kind:'text', text:'今日は'},
 *     {kind:'ruby', base:'漢字', ruby:'かんじ'},
 *     {kind:'text', text:'が好き'} ]
 *
 * @param {string} rawText
 * @returns {Array<{kind:'text',text:string}|{kind:'ruby',base:string,ruby:string}>}
 */
export function parseRubyTokens(rawText) {
    // 全角の {}| を半角に正規化してからパースする（日本語 IME 全角入力対応）
    const text = normalizeText(rawText)
        .replace(/｛/g, '{')
        .replace(/｜/g, '|')
        .replace(/｝/g, '}');
    const tokens = [];
    const re = /\{([^|{}]+)\|([^|{}]*)\}/g;
    let lastIdx = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
        if (m.index > lastIdx) {
            tokens.push({ kind: 'text', text: text.slice(lastIdx, m.index) });
        }
        tokens.push({ kind: 'ruby', base: m[1], ruby: m[2] });
        lastIdx = re.lastIndex;
    }
    if (lastIdx < text.length) {
        tokens.push({ kind: 'text', text: text.slice(lastIdx) });
    }
    return tokens;
}

/**
 * トークン配列からルビを除いたベーステキストのみを返す（組版エンジン用）。
 * @param {Array} tokens parseRubyTokens() の返り値
 * @returns {string}
 */
export function tokensToPlainText(tokens) {
    return (tokens || []).map(t => t.kind === 'ruby' ? t.base : t.text).join('');
}

/**
 * composeText の lines 配列にトークンを再整列する。
 *
 * アルゴリズム:
 *   - トークンを「文字単位」の unit リスト（char / ruby group）に展開する。
 *   - 各 composed line の文字数ぶん unit を消費し、token-line を構築する。
 *   - '\n' (段落区切り) は unit リスト側にだけ存在し composed lines には現れないため
 *     各行の処理前に skip する。
 *   - ruby グループは行をまたいで分割しない（収まらない場合は plain text として切り出す）。
 *
 * @param {Array} tokens    parseRubyTokens() の返り値
 * @param {string[]} lines  composeText から返された lines 配列（空文字 = 段落区切り）
 * @returns {Array<Array<{kind:string}>>}  lines と同じ長さの token-line 配列
 */
export function alignRubyToLines(tokens, lines) {
    if (!tokens || !tokens.length || !lines || !lines.length) {
        return (lines || []).map(() => []);
    }

    // トークンを文字単位の unit リストに展開する
    // unit: {kind:'ruby', base, ruby} | {kind:'char', char}
    const units = [];
    for (const tok of tokens) {
        if (tok.kind === 'ruby') {
            units.push({ kind: 'ruby', base: tok.base, ruby: tok.ruby });
        } else {
            for (const ch of Array.from(tok.text || '')) {
                units.push({ kind: 'char', char: ch });
            }
        }
    }

    let unitIdx = 0;

    /** 改行文字 unit を読み飛ばす（段落区切りに相当） */
    function skipNewlines() {
        while (unitIdx < units.length &&
               units[unitIdx].kind === 'char' &&
               units[unitIdx].char === '\n') {
            unitIdx++;
        }
    }

    /** 隣接する text token を結合して出力をコンパクトにする */
    function mergeTextTokens(toks) {
        const out = [];
        for (const t of toks) {
            if (t.kind === 'text' && out.length && out[out.length - 1].kind === 'text') {
                out[out.length - 1] = { kind: 'text', text: out[out.length - 1].text + t.text };
            } else {
                out.push(t);
            }
        }
        return out;
    }

    const result = [];

    for (const line of lines) {
        // 段落区切り（'\n'）を読み飛ばしてから処理
        skipNewlines();

        if (line === '') {
            result.push([]);
            continue;
        }

        const lineLen = Array.from(line).length;
        const lineTokens = [];
        let remaining = lineLen;

        while (remaining > 0 && unitIdx < units.length) {
            const unit = units[unitIdx];

            if (unit.kind === 'char') {
                if (unit.char === '\n') { unitIdx++; continue; }
                lineTokens.push({ kind: 'text', text: unit.char });
                remaining--;
                unitIdx++;
            } else {
                // ruby group
                const baseLen = Array.from(unit.base || '').length;
                if (baseLen <= remaining) {
                    // グループ全体がこの行に収まる
                    lineTokens.push({ kind: 'ruby', base: unit.base, ruby: unit.ruby });
                    remaining -= baseLen;
                    unitIdx++;
                } else {
                    // 収まらない → base の先頭 remaining 文字を plain text として出力し
                    // ruby グループを分割する（ルビなし）
                    const baseChars = Array.from(unit.base || '');
                    lineTokens.push({ kind: 'text', text: baseChars.slice(0, remaining).join('') });
                    // 残りの base を新しい ruby unit として残す
                    units[unitIdx] = {
                        kind: 'ruby',
                        base: baseChars.slice(remaining).join(''),
                        ruby: unit.ruby
                    };
                    remaining = 0;
                }
            }
        }

        result.push(mergeTextTokens(lineTokens));
    }

    return result;
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
