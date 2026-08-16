/**
 * Unicode grapheme-cluster helpers.
 *
 * Flow layout counts user-perceived characters, while source ranges remain
 * UTF-16 offsets so String#slice and DOM selection APIs stay compatible.
 * Adapted from the Gen4 fixed-layout spike at d97e469. Intl.Segmenter is the
 * authoritative path. The legacy fallback covers the scripts currently
 * exposed by DSF (including decomposed Hangul), but is not a full UAX #29
 * implementation for future Indic or RTL language support.
 */

export const GRAPHEME_SEGMENTATION_VERSION = 1;

const segmenterCache = new Map();
const MARK_RE = /^\p{Mark}$/u;
const REGIONAL_INDICATOR_RE = /^\p{Regional_Indicator}$/u;
const EMOJI_MODIFIER_RE = /^\p{Emoji_Modifier}$/u;
const EXTENDED_PICTOGRAPHIC_RE = /^\p{Extended_Pictographic}$/u;
const CONTROL_RE = /^[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]$/u;
const VARIATION_SELECTOR_RE = /^[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]$/u;
const EMOJI_TAG_RE = /^[\u{E0020}-\u{E007F}]$/u;
const ZERO_WIDTH_JOINER = '\u200D';

function getSegmenter(lang) {
    if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return null;
    const requested = String(lang || 'und').trim() || 'und';
    if (segmenterCache.has(requested)) return segmenterCache.get(requested);
    let segmenter;
    try {
        segmenter = new Intl.Segmenter(requested, { granularity: 'grapheme' });
    } catch (_) {
        segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
    }
    segmenterCache.set(requested, segmenter);
    return segmenter;
}

function isExtendingCodePoint(value) {
    return MARK_RE.test(value)
        || EMOJI_MODIFIER_RE.test(value)
        || VARIATION_SELECTOR_RE.test(value)
        || EMOJI_TAG_RE.test(value);
}

function isControlCodePoint(value) {
    return value !== ZERO_WIDTH_JOINER
        && !isExtendingCodePoint(value)
        && CONTROL_RE.test(value);
}

function getLastCodePoint(value) {
    const codePoints = Array.from(value);
    return codePoints[codePoints.length - 1] || '';
}

function canCompleteEmojiZwjSequence(previousSegment, value) {
    if (!previousSegment.endsWith(ZERO_WIDTH_JOINER) || !EXTENDED_PICTOGRAPHIC_RE.test(value)) {
        return false;
    }
    const prefix = Array.from(previousSegment.slice(0, -ZERO_WIDTH_JOINER.length));
    while (prefix.length > 0 && isExtendingCodePoint(prefix[prefix.length - 1])) prefix.pop();
    return EXTENDED_PICTOGRAPHIC_RE.test(prefix[prefix.length - 1] || '');
}

function getHangulSyllableType(value) {
    const codePoint = value.codePointAt(0);
    if ((codePoint >= 0x1100 && codePoint <= 0x115F)
        || (codePoint >= 0xA960 && codePoint <= 0xA97C)) return 'L';
    if ((codePoint >= 0x1160 && codePoint <= 0x11A7)
        || (codePoint >= 0xD7B0 && codePoint <= 0xD7C6)) return 'V';
    if ((codePoint >= 0x11A8 && codePoint <= 0x11FF)
        || (codePoint >= 0xD7CB && codePoint <= 0xD7FB)) return 'T';
    if (codePoint >= 0xAC00 && codePoint <= 0xD7A3) {
        return (codePoint - 0xAC00) % 28 === 0 ? 'LV' : 'LVT';
    }
    return '';
}

function canJoinHangul(previousValue, value) {
    const previousType = getHangulSyllableType(previousValue);
    const currentType = getHangulSyllableType(value);
    return (previousType === 'L' && ['L', 'V', 'LV', 'LVT'].includes(currentType))
        || (['LV', 'V'].includes(previousType) && ['V', 'T'].includes(currentType))
        || (['LVT', 'T'].includes(previousType) && currentType === 'T');
}

function fallbackSegments(value) {
    const clusters = [];
    let regionalIndicatorCount = 0;

    for (const codePoint of Array.from(value)) {
        const previous = clusters[clusters.length - 1];
        const isRegionalIndicator = REGIONAL_INDICATOR_RE.test(codePoint);
        const previousCodePoint = previous ? getLastCodePoint(previous.segment) : '';
        const joinsCrLf = previous?.segment === '\r' && codePoint === '\n';
        const crossesControlBoundary = isControlCodePoint(previousCodePoint)
            || isControlCodePoint(codePoint);
        const joinsPrevious = !!previous && (joinsCrLf || (!crossesControlBoundary && (
            isExtendingCodePoint(codePoint)
            || codePoint === ZERO_WIDTH_JOINER
            || canCompleteEmojiZwjSequence(previous.segment, codePoint)
            || canJoinHangul(previousCodePoint, codePoint)
            || (isRegionalIndicator && regionalIndicatorCount % 2 === 1)
        )));

        if (joinsPrevious) {
            previous.segment += codePoint;
            previous.end += codePoint.length;
        } else {
            const index = previous?.end || 0;
            clusters.push({ segment: codePoint, index, end: index + codePoint.length });
        }

        regionalIndicatorCount = isRegionalIndicator ? regionalIndicatorCount + 1 : 0;
    }

    return clusters;
}

/**
 * @returns {Array<{segment:string,index:number,end:number}>}
 * index/end are UTF-16 offsets into the original string.
 */
export function segmentGraphemes(input, lang = 'und') {
    const value = String(input || '');
    if (!value) return [];
    const segmenter = getSegmenter(lang);
    if (!segmenter) return fallbackSegments(value);
    return Array.from(segmenter.segment(value), (item) => ({
        segment: item.segment,
        index: item.index,
        end: item.index + item.segment.length,
    }));
}

export function splitGraphemes(input, lang = 'und') {
    return segmentGraphemes(input, lang).map((item) => item.segment);
}

export function countGraphemes(input, lang = 'und') {
    return segmentGraphemes(input, lang).length;
}

export function splitAtGraphemeCount(input, maxCount, lang = 'und') {
    const value = String(input || '');
    const limit = Math.max(0, Math.floor(Number(maxCount) || 0));
    if (!value) return ['', ''];
    const segments = segmentGraphemes(value, lang);
    if (segments.length <= limit) return [value, ''];
    const cutOffset = segments[limit]?.index ?? value.length;
    return [value.slice(0, cutOffset), value.slice(cutOffset)];
}
