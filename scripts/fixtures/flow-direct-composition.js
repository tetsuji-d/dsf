import { renderFlowGeneratedPage, resolveFlowDomTypography } from '../../js/flow-dom-measurer.js';
import { createCanonicalFlowPageBox } from '../../js/flow-pagination.js';
import { getFlowSourcePointClientRect } from '../../js/flow-source-mapping.js';
import { alignFlowDirectCompositionElement } from '../../js/flow-direct-composition.js';
import { segmentGraphemes } from '../../js/grapheme.js';

// Not a Vite build input. Even if opened through another server, no fixture runs.
const development = import.meta.env?.DEV === true;
const report = document.getElementById('fixture-report');
const input = (name) => document.getElementById(`fixture-${name}`);
const pageBox = createCanonicalFlowPageBox();
let renderId = 0;

function fragment(text, blockType) {
    return {
        sectionId: 'fixture-section', blockId: 'fixture-block', blockType, languageKey: 'ja',
        text, headingLevel: blockType === 'heading' ? 1 : undefined,
        sourceRange: { start: 0, end: text.length, startGrapheme: 0, endGrapheme: segmentGraphemes(text, 'ja').length },
        isBlockStart: true, isBlockEnd: true,
    };
}

function localRect(pageElement, rect) {
    const pageRect = pageElement.getBoundingClientRect();
    const scaleX = pageElement.offsetWidth / pageRect.width;
    const scaleY = pageElement.offsetHeight / pageRect.height;
    return {
        left: (rect.left - pageRect.left) * scaleX,
        top: (rect.top - pageRect.top) * scaleY,
        width: rect.width * scaleX,
        height: rect.height * scaleY,
    };
}

function measureGrapheme(element, start, end) {
    const range = document.createRange();
    range.setStart(element.firstChild, start);
    range.setEnd(element.firstChild, end);
    const rect = [...range.getClientRects()].find((item) => item.width > 0 && item.height > 0);
    if (!rect) throw new Error('先頭文字の実測矩形が取得できません。');
    return rect;
}

async function render() {
    if (!development) return;
    const current = ++renderId;
    report.dataset.state = 'loading';
    report.textContent = 'フォント読み込み・実測中…';
    try {
        const writingMode = input('mode').value;
        const blockType = input('block').value;
        const scale = Number(input('scale').value);
        const prefix = input('prefix').value;
        const preedit = input('text').value;
        const typography = resolveFlowDomTypography('ja', {}, writingMode, {
            languageConfigs: { ja: { fontPreset: input('font').value } },
        });
        const family = typography.fontFamily.split(',')[0];
        const fontSpec = `${blockType === 'heading' ? 700 : 400} ${typography.fontSize * (blockType === 'heading' ? 1.5 : 1)}px ${family}`;
        const faces = await document.fonts.load(fontSpec, `${prefix}${preedit}日本語`);
        await document.fonts.ready;
        if (current !== renderId) return;
        if (!faces.length || faces.some((face) => face.status !== 'loaded') || !document.fonts.check(fontSpec, prefix + preedit)) {
            throw new Error(`指定書体が読み込めませんでした: ${fontSpec}`);
        }

        const live = input('live');
        const expected = input('expected');
        const sourcePage = { fragments: [fragment(prefix, blockType)] };
        for (const [pageElement, page, shell] of [
            [live, sourcePage, input('live-shell')],
            [expected, { fragments: [fragment(prefix + preedit, blockType)] }, input('expected-shell')],
        ]) {
            renderFlowGeneratedPage(pageElement, { page, pageBox, typography, writingMode, languageKey: 'ja', hyphenation: 'none' });
            pageElement.style.transform = `scale(${scale})`;
            shell.style.width = `${pageBox.width * scale}px`;
            shell.style.height = `${pageBox.height * scale}px`;
        }
        if (!preedit) {
            report.dataset.state = 'empty';
            report.textContent = '変換中文字が空です。計測は行いません。';
            return;
        }
        const sourcePoint = {
            sectionId: 'fixture-section', blockId: 'fixture-block', blockType, languageKey: 'ja',
            utf16Offset: prefix.length, graphemeOffset: segmentGraphemes(prefix, 'ja').length, affinity: 'backward',
        };
        const caretRect = getFlowSourcePointClientRect(live, sourcePage, sourcePoint, { writingMode });
        if (!caretRect) throw new Error('本番source mappingで入力位置を取得できません。');
        const caret = localRect(live, caretRect);
        const sourceStyle = getComputedStyle(live.querySelector('.flow-dom-block'));
        const composition = document.createElement('span');
        composition.className = 'flow-direct-composition';
        composition.dataset.flowWritingMode = writingMode;
        composition.dataset.testid = 'fixture-composition';
        composition.lang = 'ja';
        composition.textContent = preedit;
        Object.assign(composition.style, {
            left: `${caret.left}px`, top: `${caret.top}px`, writingMode, textOrientation: 'mixed', direction: 'ltr',
            fontFamily: sourceStyle.fontFamily, fontSize: sourceStyle.fontSize,
            fontWeight: sourceStyle.fontWeight, lineHeight: sourceStyle.lineHeight,
            letterSpacing: sourceStyle.letterSpacing, fontFeatureSettings: sourceStyle.fontFeatureSettings,
            color: sourceStyle.color,
        });
        live.appendChild(composition);
        const correction = alignFlowDirectCompositionElement({
            pageElement: live, compositionElement: composition, caretRect, writingMode, languageKey: 'ja',
        });
        if (!correction) throw new Error('実測による変換文字補正が失敗しました。');
        const indicator = document.createElement('span');
        indicator.className = 'fixture-caret';
        Object.assign(indicator.style, {
            left: `${caret.left}px`, top: `${caret.top}px`,
            width: `${writingMode === 'vertical-rl' ? caret.width : 1}px`,
            height: `${writingMode === 'vertical-rl' ? 1 : caret.height}px`,
        });
        live.appendChild(indicator);

        const first = segmentGraphemes(preedit, 'ja')[0];
        const actualRect = localRect(live, measureGrapheme(composition, first.index, first.end));
        const expectedRect = localRect(expected, measureGrapheme(
            expected.querySelector('.flow-dom-block'), prefix.length + first.index, prefix.length + first.end,
        ));
        const vertical = writingMode === 'vertical-rl';
        const inlineDelta = vertical ? actualRect.top - expectedRect.top : actualRect.left - expectedRect.left;
        const crossDelta = vertical
            ? actualRect.left + actualRect.width / 2 - expectedRect.left - expectedRect.width / 2
            : actualRect.top + actualRect.height / 2 - expectedRect.top - expectedRect.height / 2;
        const pass = Math.abs(inlineDelta) <= 0.5 && Math.abs(crossDelta) <= 0.5;
        report.dataset.state = pass ? 'pass' : 'fail';
        report.dataset.inlineDelta = String(inlineDelta);
        report.dataset.crossDelta = String(crossDelta);
        report.textContent = `${pass ? 'PASS' : 'FAIL'}: 通常描画との先頭位置差 ${inlineDelta.toFixed(4)}px / 行・列中心差 ${crossDelta.toFixed(4)}px（許容各0.5論理px）\n`
            + `mode=${writingMode}, block=${blockType}, scale=${scale}\n`
            + `font=${fontSpec}, loadedFaces=${faces.length}, status=${document.fonts.status}\n`
            + `source fontSize=${sourceStyle.fontSize}, lineHeight=${sourceStyle.lineHeight}, letterSpacing=${sourceStyle.letterSpacing}\n`
            + `actual=${JSON.stringify(actualRect)}\nexpected=${JSON.stringify(expectedRect)}\ncorrection=${JSON.stringify(correction)}\n`
            + 'これはDOM位置の確認です。OS変換候補の確認結果ではありません。';
    } catch (error) {
        if (current !== renderId) return;
        report.dataset.state = 'error';
        report.textContent = `ERROR: ${error.message}`;
    }
}

if (development) {
    for (const name of ['mode', 'font', 'block', 'scale']) input(name).addEventListener('change', render);
    for (const name of ['prefix', 'text']) input(name).addEventListener('input', render);
    input('render').addEventListener('click', render);
    input('sample').addEventListener('change', () => {
        input('prefix').value = 'テクノロジーどうしよう';
        input('text').value = {
            japanese: 'おはよう', mixed: 'ABCおはよう12', decomposed: 'か\u3099e\u0301👨‍👩‍👧‍👦',
        }[input('sample').value];
        render();
    });
    render();
} else {
    report.dataset.state = 'disabled';
    report.textContent = 'このfixtureはVite development server専用です。';
}
