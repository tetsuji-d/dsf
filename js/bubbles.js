/**
 * bubbles.js — 吹き出し管理（追加・選択・ドラッグ・描画）
 * テキスト外形に合わせてバブル形状を動的に生成する
 * 多言語対応: texts[lang] からテキストを取得し言語別配置を適用
 */
import { state } from './state.js';
import { pushState } from './history.js';
import { triggerAutoSave } from './firebase.js';
import { getShape, getShapeNames } from './shapes.js';
import { getLangProps } from './lang.js';

/** 固定フォントサイズ */
const FONT_SIZE = 12;
/** 行高さ倍率 */
const LINE_HEIGHT = 1.4;
/** 1文字あたりの幅（日本語全角基準） */
const CHAR_W = FONT_SIZE;
/** 英語の文字幅（半角基準） */
const CHAR_W_EN = FONT_SIZE * 0.6;
/** 1行あたりの高さ */
const LINE_H = Math.round(FONT_SIZE * LINE_HEIGHT);

/**
 * テキストの描画サイズを計測する
 */
function measureText(text, isVertical, lang) {
    if (!text) return { width: CHAR_W * 3, height: LINE_H };
    const lines = text.split('\n');
    const charW = (lang === 'en') ? CHAR_W_EN : CHAR_W;
    const maxLen = Math.max(1, ...lines.map(l => l.length));
    const numLines = Math.max(1, lines.length);

    if (isVertical) {
        return { width: numLines * LINE_H, height: maxLen * charW };
    }
    return { width: maxLen * charW, height: numLines * LINE_H };
}

/**
 * バブルから現在の言語のテキストを取得する
 */
export function getBubbleText(b) {
    const lang = state.activeLang;
    if (b.texts && b.texts[lang] !== undefined) {
        return b.texts[lang];
    }
    // 後方互換: texts が無い場合は text を使う
    return b.text || '';
}

/**
 * バブルのテキストを現在の言語で設定する
 */
export function setBubbleText(b, text) {
    const lang = state.activeLang;
    if (!b.texts) b.texts = {};
    b.texts[lang] = text;
    // 後方互換: text フィールドも更新
    b.text = text;
}

/**
 * バブルの現在の言語の位置を取得する
 */
export function getBubblePos(b) {
    const lang = state.activeLang;
    if (b.positions && b.positions[lang]) {
        return b.positions[lang];
    }
    // 後方互換: positions が無い場合は x, y を使う
    return { x: b.x, y: b.y };
}

/**
 * バブルの現在の言語の位置を設定する
 */
export function setBubblePos(b, x, y) {
    const lang = state.activeLang;
    if (!b.positions) b.positions = {};
    b.positions[lang] = { x, y };
    // 後方互換: x, y フィールドも更新
    b.x = x;
    b.y = y;
}

/**
 * 吹き出し1つ分のHTMLを生成する
 */
export function renderBubbleHTML(b, i, isSelected, sectionWritingMode) {
    const shapeName = b.shape || 'speech';
    const shape = getShape(shapeName);
    const lang = state.activeLang;
    const langProps = getLangProps(lang);

    // 言語に応じたwritingMode（言語が対応していない場合はhorizontal-tb）
    const allowedModes = langProps.writingModes;
    const isVertical = allowedModes.includes(sectionWritingMode) && sectionWritingMode === 'vertical-rl';

    // テキスト取得・計測
    const text = getBubbleText(b);
    const { width: textW, height: textH } = measureText(text, isVertical, lang);
    const layout = shape.render(textW, textH, b, isSelected);

    // 言語別の位置を取得
    const pos = getBubblePos(b);

    // テキスト表示（\n → <br>）
    const displayText = (text || '').split('\n').map(l => l || '&nbsp;').join('<br>');

    // 言語別のtext-align
    const textAlign = langProps.align;

    // 選択中: 直接編集可能
    const editAttrs = isSelected
        ? `contenteditable="true" onmousedown="event.stopPropagation()" oninput="onBubbleTextInput(event, ${i})" onblur="onBubbleTextBlur()"`
        : '';
    const editStyle = isSelected
        ? 'pointer-events:auto; cursor:text;'
        : 'pointer-events:none;';

    const vtClass = isVertical ? 'v-text' : '';

    // 選択中: 移動ハンドルを表示
    const handleHTML = isSelected
        ? `<div class="bubble-handle" onmousedown="onHandleDown(event, ${i})" ontouchstart="onHandleDown(event, ${i})"><span class="material-icons">open_with</span></div>`
        : '';

    return `
        <div class="bubble-svg"
             style="top:${pos.y}%; left:${pos.x}%;"
             onmousedown="selectBubble(event, ${i})">
            <svg width="${layout.svgWidth}" height="${layout.svgHeight}" viewBox="${layout.viewBox}">
                ${layout.svgContent}
            </svg>
            <div class="bubble-text ${vtClass}"
                 style="font-size:${FONT_SIZE}px; left:${layout.textCenterX}px; top:${layout.textCenterY}px; text-align:${textAlign}; ${editStyle}"
                 ${editAttrs}>${displayText}</div>
            ${handleHTML}
        </div>
    `;
}

/** 利用可能な形状名の一覧を返す */
export { getShapeNames };

// クリックでの追加は廃止（Zoom/Panと競合するため）
// 選択解除のみ行う
export function handleCanvasClick(e, refresh) {
    if (e.target.id === 'main-img' || e.target.classList.contains('text-layer')) {
        // 背景クリックで選択解除
        pushState();
        state.activeBubbleIdx = null;
        refresh();
        triggerAutoSave();
    }
}

// FABなどから呼び出すための追加関数
export function addBubbleAtCenter(refresh) {
    if (state.sections[state.activeIdx].type === 'text') return;

    // 中央に追加 (50%, 50%)
    const lang = state.activeLang;
    const defaultText = lang === 'en' ? 'Text' : 'セリフ';
    const posX = 50;
    const posY = 50;

    const newBubble = {
        x: posX, y: posY,
        tailX: 0, tailY: 20,
        text: defaultText,
        texts: { [lang]: defaultText },
        positions: { [lang]: { x: posX, y: posY } },
        shape: 'speech'
    };

    // pushStateは呼び出し元(app.js)で行うか、ここで
    // app.jsで呼び出すので、ここではデータ操作のみ
    state.sections[state.activeIdx].bubbles.push(newBubble);
    state.activeBubbleIdx = state.sections[state.activeIdx].bubbles.length - 1;
    refresh();
}

/**
 * 吹き出しを選択し、ドラッグを開始する
 */
/**
 * 吹き出しを選択する（ドラッグはしない）
 */
export function selectBubble(e, i, refresh) {
    e.stopPropagation();
    state.activeBubbleIdx = i;
    refresh();
    // ドラッグはハンドルで行うため、ここでは開始しない
}

/**
 * 吹き出しのドラッグ開始（ハンドルから呼ばれる）
 */
export function onHandleDown(e, i) {
    e.stopPropagation();
    // refresh関数はapp.jsから渡せないため、global function頼みになるが、
    // ここでは startDrag を呼び出す。startDrag は refresh を引数にとるが...
    // 解決策: window.refresh を利用するか、selectBubble経由で渡されたrefreshを使う仕組みにする。
    // 現状の設計では renderBubbleHTML の中に埋め込む onclick 文字列なので refresh を渡すのは困難。
    // app.js で window.handleCanvasClick = ... と同様に、window.onHandleDown を定義して refresh を注入するのが良い。
}

/**
 * 吹き出しのドラッグ処理
 */
// 改良版: Zoom/Pan対応のドラッグ処理
export function startDrag(e, i, refresh) {
    // 座標計算は canvas-transform-layer 基準で行う必要がある
    // getBoundingClientRect of transform-layer
    const layer = document.getElementById('canvas-transform-layer');
    if (!layer) return; // Should not happen

    const getClientPos = (evt) => {
        if (evt.touches && evt.touches.length > 0) {
            return { x: evt.touches[0].clientX, y: evt.touches[0].clientY };
        }
        return { x: evt.clientX, y: evt.clientY };
    };

    const move = (me) => {
        if (me.type === 'touchmove') me.preventDefault();

        // レイヤーの矩形（Zoom/Pan適用済み）を取得
        const rect = layer.getBoundingClientRect();
        const pos = getClientPos(me);

        // レイヤー内での相対座標(%)を計算
        // rect.left, rect.top はウィンドウ座標系でのレイヤー位置
        // rect.width, rect.height はスケール適用後のサイズ
        const x = ((pos.x - rect.left) / rect.width * 100).toFixed(1);
        const y = ((pos.y - rect.top) / rect.height * 100).toFixed(1);

        setBubblePos(state.sections[state.activeIdx].bubbles[i], x, y);
        refresh();
    };
    const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        window.removeEventListener('touchmove', move);
        window.removeEventListener('touchend', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', up);
}
