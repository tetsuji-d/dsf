/**
 * Press 用: エディター preview と同じ HTML を組み立てる（縦書きは CSS vertical-rl）。
 * app.js の renderTextPreview とロジックを共有（重複最小化のため関数のみ抽出）。
 */
import {
    composeText,
    getWritingModeFromConfigs,
    getFontPresetFromConfigs,
    parseRubyTokens,
    tokensToPlainText,
    alignRubyToLines
} from './layout.js';

function escHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

const VERTICAL_GLYPH_MAP = Object.freeze({
    'ー': '︱',
    '―': '︱',
    '—': '︱',
    '–': '︲',
    '…': '︙',
    '‥': '︰',
    '、': '︑',
    '。': '︒',
    '，': '︐',
    '：': '︓',
    '；': '︔',
    '！': '︕',
    '？': '︖',
    '（': '︵',
    '）': '︶',
    '｛': '︷',
    '｝': '︸',
    '〔': '︹',
    '〕': '︺',
    '【': '︻',
    '】': '︼',
    '《': '︽',
    '》': '︾',
    '〈': '︿',
    '〉': '﹀',
    '「': '﹁',
    '」': '﹂',
    '『': '﹃',
    '』': '﹄',
    '［': '﹇',
    '］': '﹈'
});

export function verticalGlyphText(text) {
    return Array.from(String(text || ''), ch => VERTICAL_GLYPH_MAP[ch] || ch).join('');
}

const TCY_STYLE = [
    'text-combine-upright:all',
    '-webkit-text-combine:horizontal',
    'font-variant-numeric:tabular-nums',
    'letter-spacing:-0.05em',
    'font-feature-settings:normal',
    '-webkit-font-feature-settings:normal'
].join(';');

function markupTcyText(text) {
    if (!text) return '';
    const chars = Array.from(String(text || ''));
    return chars.map(ch => escHtml(verticalGlyphText(ch))).join('');
}

function markupVerticalLine(rawLine) {
    if (!rawLine) return '\u00a0';
    return markupTcyText(rawLine) || '\u00a0';
}

const VERTICAL_CONTAINER_STYLE = [
    'display:flex',
    'flex-direction:row-reverse',
    'height:100%',
    'align-items:flex-start',
    'overflow:hidden'
].join(';');

const VERTICAL_COL_BASE_STYLE = [
    'writing-mode:vertical-rl',
    '-webkit-writing-mode:vertical-rl',
    'text-orientation:mixed',
    'flex-shrink:0',
    'height:100%',
    'overflow:hidden',
    'font-feature-settings:"vert" 1,"vkna" 1',
    '-webkit-font-feature-settings:"vert" 1,"vkna" 1',
    'hanging-punctuation:allow-end',
    'text-autospace:ideograph-alpha',
    '-webkit-text-autospace:ideograph-alpha',
    'text-spacing:ideograph-alpha ideograph-numeric'
].join(';');

const RUBY_OVERLAY_STYLE = [
    'position:absolute',
    'inset:0',
    'pointer-events:none',
    'overflow:visible'
].join(';');

const RUBY_ANN_BASE_STYLE = [
    'position:absolute',
    'writing-mode:vertical-rl',
    '-webkit-writing-mode:vertical-rl',
    'text-orientation:mixed',
    'white-space:nowrap',
    'overflow:visible',
    'pointer-events:none',
    'color:inherit',
    'line-height:1.2',
    'letter-spacing:0',
    'font-feature-settings:"vert" 1,"vkna" 1',
    '-webkit-font-feature-settings:"vert" 1,"vkna" 1'
].join(';');

const HORIZONTAL_BASE_STYLE = [
    'width:100%',
    'overflow:hidden'
].join(';');

const PARA_STYLE = [
    'margin:0',
    'text-align:justify',
    'text-justify:inter-word',
    'hyphens:auto',
    '-webkit-hyphens:auto',
    'word-break:break-word',
    'overflow-wrap:break-word'
].join(';');

function baseTextFromTokenLine(tokenLine) {
    if (!tokenLine || !tokenLine.length) return '\u00a0';
    const parts = [];
    for (const tok of tokenLine) {
        parts.push(markupTcyText(tok.kind === 'ruby' ? tok.base : (tok.text || '')));
    }
    return parts.join('') || '\u00a0';
}

function linesIntoParagraphs(lines, lineBreaks = []) {
    const result = [];
    let buf = [];
    function flushBuf() {
        if (!buf.length) return;
        result.push(buf.join(' '));
        buf = [];
    }
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (line === '') {
            flushBuf();
            result.push(null);
        } else {
            buf.push(line);
            if (lineBreaks[i]) flushBuf();
        }
    }
    flushBuf();
    return result;
}

function tokenLinesIntoParagraphs(rubyLines, lines, lineBreaks = []) {
    const result = [];
    let buf = [];

    function flushBuf() {
        if (!buf.length) return;
        const merged = [];
        for (let i = 0; i < buf.length; i++) {
            merged.push(...buf[i]);
            if (i < buf.length - 1) {
                merged.push({ kind: 'text', text: ' ' });
            }
        }
        result.push(merged);
        buf = [];
    }

    for (let i = 0; i < lines.length; i++) {
        if (lines[i] === '') {
            flushBuf();
            result.push(null);
        } else {
            buf.push(rubyLines[i] || []);
            if (lineBreaks[i]) flushBuf();
        }
    }
    flushBuf();
    return result;
}

function getHorizontalTextOffsetY(composed) {
    if (!composed || composed.writingMode !== 'horizontal-tb') return 0;
    return 0;
}

/**
 * @returns {{ rootHtml: string, empty: boolean }}
 *   rootHtml — 360×640 のラスタ用ラッパー内に差し込む HTML（背景・フレーム・本文）
 */
export function buildPressTextRasterHtml(section, lang, languageConfigs) {
    const raw = section.texts?.[lang] ?? '';
    const writingMode = getWritingModeFromConfigs(lang, languageConfigs);
    const fontPreset = getFontPresetFromConfigs(lang, languageConfigs);

    let rubyTokens;
    let hasRuby = false;
    let plainText = raw;
    try {
        rubyTokens = parseRubyTokens(raw);
        hasRuby = rubyTokens.some(t => t.kind === 'ruby');
        plainText = hasRuby ? tokensToPlainText(rubyTokens) : raw;
    } catch {
        rubyTokens = [];
        hasRuby = false;
        plainText = raw;
    }

    const composed = composeText(plainText, lang, writingMode, fontPreset);

    let rubyLines = null;
    try {
        rubyLines = hasRuby ? alignRubyToLines(rubyTokens, composed.lines) : null;
    } catch {
        rubyLines = null;
    }

    const pageBg = section.backgroundColor || '#ffffff';
    const { x, y, w, h } = composed.frame;
    const fs = composed.font.size;
    const color = section.textColor || '#000000';
    const frameStyle = [
        `position:absolute`,
        `left:${x}px`,
        `top:${y}px`,
        `width:${w}px`,
        `height:${h}px`,
        `font-family:${composed.font.family}`,
        `font-size:${fs}px`,
        `color:${color}`,
        `letter-spacing:${composed.font.letterSpacing ? `${composed.font.letterSpacing}px` : '0'}`
    ].join(';');

    if (!raw) {
        return {
            empty: true,
            rootHtml: `<div class="press-raster-page" style="position:relative;width:360px;height:640px;background:${pageBg}"></div>`
        };
    }

    let contentInner = '';
    if (composed.writingMode === 'vertical-rl') {
        const fw = w;
        const fh = h;
        const maxCols = composed.rules?.maxLines || 12;
        const charsPerCol = composed.rules?.charsPerLine || 33;
        const fontSize = composed.font.size;
        const colW = Math.floor(fw / maxCols);
        const lineHeight = (colW / fontSize).toFixed(3);
        const letterSpacing = ((fh / charsPerCol) - fontSize).toFixed(3);
        const charPitch = fh / charsPerCol;
        const rubyFontSize = Math.round(fontSize * 0.5);
        const rubyColW = Math.round(fontSize * 0.65);
        const charRightOffset = Math.round((colW - fontSize) / 2);

        const cols = composed.lines.map((line, i) => {
            const content = rubyLines
                ? baseTextFromTokenLine(rubyLines[i])
                : markupVerticalLine(line);
            return `<span class="tpv-col" style="${VERTICAL_COL_BASE_STYLE};width:${colW}px;line-height:${lineHeight};letter-spacing:${letterSpacing}px">${content}</span>`;
        }).join('');

        let rubyOverlay = '';
        if (rubyLines) {
            const anns = [];
            for (let i = 0; i < rubyLines.length; i++) {
                let charOffset = 0;
                for (const tok of rubyLines[i]) {
                    const baseLen = tok.kind === 'ruby'
                        ? Array.from(tok.base || '').length
                        : Array.from(tok.text || '').length;
                    if (tok.kind === 'ruby' && tok.ruby) {
                        const annLeft = fw - i * colW - charRightOffset;
                        const rubyLen = Array.from(tok.ruby).length;
                        const rubyH = Math.round(rubyLen * rubyFontSize * 1.2);
                        const baseH = Math.round(baseLen * charPitch);
                        const annTop = Math.round(charOffset * charPitch + Math.max(0, (baseH - rubyH) / 2));
                        anns.push(
                            `<span class="tpv-ruby-ann" style="${RUBY_ANN_BASE_STYLE};left:${annLeft}px;top:${annTop}px;width:${rubyColW}px;font-size:${rubyFontSize}px">${escHtml(verticalGlyphText(tok.ruby))}</span>`
                        );
                    }
                    charOffset += baseLen;
                }
            }
            if (anns.length) {
                rubyOverlay = `<div class="tpv-ruby-overlay" style="${RUBY_OVERLAY_STYLE}">${anns.join('')}</div>`;
            }
        }
        contentInner = `<div class="tpv-vertical" style="${VERTICAL_CONTAINER_STYLE}">${cols}</div>${rubyOverlay}`;
    } else {
        const lineH = composed.frame.h / (composed.rules?.maxLines || 20);
        const offsetY = getHorizontalTextOffsetY(composed);
        let html;
        if (rubyLines) {
            const tokenParas = tokenLinesIntoParagraphs(rubyLines, composed.lines, composed.lineBreaks);
            html = tokenParas.map(p =>
                p === null
                    ? `<div class="tpv-blank" style="height:${lineH}px"></div>`
                    : `<p class="tpv-para" style="${PARA_STYLE}">${p.map(tok =>
                        tok.kind === 'ruby'
                            ? `<ruby>${markupTcyText(tok.base)}<rt>${escHtml(tok.ruby || '')}</rt></ruby>`
                            : escHtml(tok.text || '')
                    ).join('')}</p>`
            ).join('');
        } else {
            const paras = linesIntoParagraphs(composed.lines, composed.lineBreaks);
            html = paras.map(p =>
                p === null
                    ? `<div class="tpv-blank" style="height:${lineH}px"></div>`
                    : `<p class="tpv-para" style="${PARA_STYLE}">${escHtml(p)}</p>`
            ).join('');
        }
        contentInner =
            `<div class="tpv-horizontal" lang="${lang.toLowerCase()}" style="${HORIZONTAL_BASE_STYLE};line-height:${lineH}px;transform:translateY(${offsetY}px)">${html}</div>`;
    }

    const rootHtml =
        `<div class="press-raster-page" style="position:relative;width:360px;height:640px;background:${pageBg};overflow:hidden">` +
        `<div class="press-raster-frame" style="${frameStyle}" lang="${lang.toLowerCase()}">` +
        `<div class="press-raster-content">${contentInner}</div>` +
        `</div></div>`;

    return { empty: false, rootHtml };
}
