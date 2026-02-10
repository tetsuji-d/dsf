/**
 * shapes.js — 吹き出し形状レジストリ
 * 各形状タイプのレンダリング関数を登録・取得する
 * 今後のバリエーション追加に対応
 */

const SHAPES = {};

/**
 * 形状を登録する
 * @param {string} name - 形状名
 * @param {object} shape - { svgWidth, svgHeight, viewBox, textBounds, render(b) }
 */
export function registerShape(name, shape) {
    SHAPES[name] = shape;
}

/**
 * 形状を取得する（未登録の場合は 'speech' にフォールバック）
 * @param {string} name - 形状名
 * @returns {object} 形状定義
 */
export function getShape(name) {
    return SHAPES[name] || SHAPES['speech'];
}

/**
 * 登録済み形状名の一覧を返す
 * @returns {string[]}
 */
export function getShapeNames() {
    return Object.keys(SHAPES);
}

// ============================================================
//  組み込み形状: speech（楕円 + 尻尾の通常吹き出し）
// ============================================================
const SPEECH = {
    svgWidth: 150,
    svgHeight: 130,
    viewBox: '0 0 150 130',
    textBounds: { width: 82, height: 52, top: '36%' },

    /**
     * 吹き出しSVGの内部要素を返す
     * 3レイヤー方式: (1)尻尾の塗り+線 (2)楕円を上に重ねる (3)白マスクで繋ぎ目を消す
     * @param {object} b - バブルデータ { tailX, tailY }
     * @param {boolean} isSelected
     * @returns {string} SVG innerHTML
     */
    render(b, isSelected) {
        const cx = 75, cy = 50, rx = 65, ry = 40;
        const tailX = b.tailX || 10;
        const tailY = b.tailY || 25;

        // 尻尾を接続する角度（楕円底部の左右）
        const spread = 0.25;
        const baseAngle = Math.PI / 2;
        const a1 = baseAngle - spread;
        const a2 = baseAngle + spread;

        // 楕円上の接続点
        const p1x = cx + rx * Math.cos(a1);
        const p1y = cy + ry * Math.sin(a1);
        const p2x = cx + rx * Math.cos(a2);
        const p2y = cy + ry * Math.sin(a2);

        // 尻尾の先端
        const tipX = cx + tailX;
        const tipY = cy + ry + tailY;

        // 白マスクの範囲（接続点間の楕円ストロークを消す）
        const maskX = Math.min(p1x, p2x) + 1;
        const maskW = Math.abs(p1x - p2x) - 2;
        const maskY = Math.min(p1y, p2y) - 2;

        const selectedStroke = isSelected ? 'var(--primary)' : 'black';
        const strokeWidth = isSelected ? 3 : 2;

        return `
            <!-- Layer 1: 尻尾（塗り+線） -->
            <polygon points="${p2x.toFixed(1)},${p2y.toFixed(1)} ${tipX},${tipY} ${p1x.toFixed(1)},${p1y.toFixed(1)}"
                     fill="white" stroke="${selectedStroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>
            <!-- Layer 2: 楕円（上に重ねて内部の尻尾線を隠す） -->
            <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"
                     fill="white" stroke="${selectedStroke}" stroke-width="${strokeWidth}"/>
            <!-- Layer 3: 白マスク（楕円底部の接続部分のストロークを消す） -->
            <rect x="${maskX.toFixed(1)}" y="${maskY.toFixed(1)}" width="${maskW.toFixed(1)}" height="6"
                  fill="white" stroke="none"/>
        `;
    }
};
registerShape('speech', SPEECH);

// ============================================================
//  組み込み形状: thought（考え中の雲形吹き出し）
// ============================================================
registerShape('thought', {
    svgWidth: 150,
    svgHeight: 130,
    viewBox: '0 0 150 130',
    textBounds: { width: 78, height: 48, top: '36%' },

    render(b, isSelected) {
        const stroke = isSelected ? 'var(--primary)' : 'black';
        const sw = isSelected ? 3 : 2;
        const tipX = 75 + (b.tailX || 10);
        const tipY = 90 + (b.tailY || 25);

        return `
            <ellipse cx="75" cy="48" rx="62" ry="38" fill="white" stroke="${stroke}" stroke-width="${sw}"/>
            <ellipse cx="${tipX - 8}" cy="92" rx="8" ry="6" fill="white" stroke="${stroke}" stroke-width="${sw}"/>
            <ellipse cx="${tipX - 2}" cy="106" rx="5" ry="4" fill="white" stroke="${stroke}" stroke-width="${sw}"/>
            <ellipse cx="${tipX}" cy="${tipY}" rx="3" ry="2.5" fill="white" stroke="${stroke}" stroke-width="${sw}"/>
        `;
    }
});

// ============================================================
//  組み込み形状: shout（叫び吹き出し）
// ============================================================
registerShape('shout', {
    svgWidth: 160,
    svgHeight: 130,
    viewBox: '0 0 160 130',
    textBounds: { width: 80, height: 50, top: '36%' },

    render(b, isSelected) {
        const stroke = isSelected ? 'var(--primary)' : 'black';
        const sw = isSelected ? 3 : 2;
        const tipX = 80 + (b.tailX || 10);
        const tipY = 50 + 40 + (b.tailY || 25);

        return `
            <polygon points="80,2 100,20 120,5 115,30 145,25 120,48 150,55 118,62 140,85 105,72 95,95 82,68 ${tipX},${tipY} 62,68 55,95 48,72 20,85 42,62 10,55 40,48 15,25 45,30 40,5 60,20"
                     fill="white" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>
        `;
    }
});
