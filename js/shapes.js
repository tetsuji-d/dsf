/**
 * shapes.js — 吹き出し形状レジストリ
 * テキストサイズに応じて動的にSVGを生成する（角丸長方形ベース）
 *
 * render(textW, textH, b, isSelected) → {
 *   svgWidth, svgHeight, viewBox, svgContent,
 *   textCenterX, textCenterY
 * }
 */

const SHAPES = {};

export function registerShape(name, shape) { SHAPES[name] = shape; }
export function getShape(name) { return SHAPES[name] || SHAPES['speech']; }
export function getShapeNames() { return Object.keys(SHAPES); }

// ============================================================
//  speech（角丸長方形 + 尻尾）
// ============================================================
registerShape('speech', {
    render(textW, textH, b, isSelected) {
        const pad = 10;
        const w = textW + pad * 2;
        const h = textH + pad * 2;
        const cr = Math.min(14, w / 4, h / 4); // 角丸半径
        const m = 4; // ストロークマージン

        const rx = m;       // 矩形左上X
        const ry = m;       // 矩形左上Y
        const cx = rx + w / 2;
        const cy = ry + h / 2;

        const tailX = b.tailX || 0;
        const tailY = b.tailY || 20;
        const tailCX = cx + tailX;
        const tipY = ry + h + tailY;
        const jl = tailCX - 8;  // 尻尾左接合
        const jr = tailCX + 8;  // 尻尾右接合

        const svgW = Math.ceil(Math.max(rx + w, tailCX + 10) + m);
        const svgH = Math.ceil(tipY + m);

        const stroke = isSelected ? 'var(--primary)' : 'black';
        const sw = isSelected ? 3 : 2;

        const d = [
            `M ${rx + cr} ${ry}`,
            `H ${rx + w - cr}`,
            `Q ${rx + w} ${ry} ${rx + w} ${ry + cr}`,
            `V ${ry + h - cr}`,
            `Q ${rx + w} ${ry + h} ${rx + w - cr} ${ry + h}`,
            `H ${jr}`,
            `L ${tailCX} ${tipY}`,
            `L ${jl} ${ry + h}`,
            `H ${rx + cr}`,
            `Q ${rx} ${ry + h} ${rx} ${ry + h - cr}`,
            `V ${ry + cr}`,
            `Q ${rx} ${ry} ${rx + cr} ${ry}`,
            `Z`
        ].join(' ');

        return {
            svgWidth: svgW, svgHeight: svgH,
            viewBox: `0 0 ${svgW} ${svgH}`,
            svgContent: `<path d="${d}" fill="white" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`,
            textCenterX: cx, textCenterY: cy
        };
    }
});

// ============================================================
//  thought（角丸長方形 + ドット）
// ============================================================
registerShape('thought', {
    render(textW, textH, b, isSelected) {
        const pad = 10;
        const w = textW + pad * 2;
        const h = textH + pad * 2;
        const cr = Math.min(14, w / 4, h / 4);
        const m = 4;

        const rx = m;
        const ry = m;
        const cx = rx + w / 2;
        const cy = ry + h / 2;

        const tailX = b.tailX || 0;
        const tailY = b.tailY || 20;
        const baseY = ry + h + 4;
        const tipX = cx + tailX;
        const tipY = baseY + tailY;
        const d1y = baseY + 4;
        const d2y = baseY + tailY * 0.55;

        const svgW = Math.ceil(Math.max(rx + w, tipX + 6) + m);
        const svgH = Math.ceil(tipY + 6);

        const stroke = isSelected ? 'var(--primary)' : 'black';
        const sw = isSelected ? 3 : 2;

        const rect = [
            `M ${rx + cr} ${ry}`,
            `H ${rx + w - cr}`,
            `Q ${rx + w} ${ry} ${rx + w} ${ry + cr}`,
            `V ${ry + h - cr}`,
            `Q ${rx + w} ${ry + h} ${rx + w - cr} ${ry + h}`,
            `H ${rx + cr}`,
            `Q ${rx} ${ry + h} ${rx} ${ry + h - cr}`,
            `V ${ry + cr}`,
            `Q ${rx} ${ry} ${rx + cr} ${ry}`,
            `Z`
        ].join(' ');

        return {
            svgWidth: svgW, svgHeight: svgH,
            viewBox: `0 0 ${svgW} ${svgH}`,
            svgContent: `
                <path d="${rect}" fill="white" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
                <ellipse cx="${tipX - 6}" cy="${d1y}" rx="7" ry="5" fill="white" stroke="${stroke}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>
                <ellipse cx="${tipX - 2}" cy="${d2y}" rx="5" ry="3.5" fill="white" stroke="${stroke}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>
                <ellipse cx="${tipX}" cy="${tipY}" rx="3" ry="2.5" fill="white" stroke="${stroke}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>
            `,
            textCenterX: cx, textCenterY: cy
        };
    }
});

// ============================================================
//  shout（ギザギザ吹き出し — 動的生成）
// ============================================================
registerShape('shout', {
    render(textW, textH, b, isSelected) {
        const pad = 8;
        const pw = textW + pad * 2;
        const ph = textH + pad * 2;
        const baseRx = Math.max(pw / 2, 25);
        const baseRy = Math.max(ph / 2, 18);
        const spike = 15;
        const m = 4;
        const cx = baseRx + spike + m;
        const cy = baseRy + spike + m;

        const tailX = b.tailX || 0;
        const tailY = b.tailY || 20;
        const tipX = cx + tailX;
        const tipY = cy + baseRy + spike + tailY;

        const numSpikes = 12;
        const total = numSpikes * 2;
        const pts = [];
        let tailDone = false;

        for (let j = 0; j < total; j++) {
            const ang = (j / total) * Math.PI * 2 - Math.PI / 2;
            const isOuter = j % 2 === 0;

            if (isOuter && !tailDone && ang > 1.1 && ang < 2.1) {
                pts.push(`${tipX.toFixed(1)},${tipY.toFixed(1)}`);
                tailDone = true;
            } else {
                const rr_x = isOuter ? baseRx + spike : baseRx;
                const rr_y = isOuter ? baseRy + spike : baseRy;
                pts.push(`${(cx + rr_x * Math.cos(ang)).toFixed(1)},${(cy + rr_y * Math.sin(ang)).toFixed(1)}`);
            }
        }

        const svgW = Math.ceil(cx + baseRx + spike + m);
        const svgH = Math.ceil(tipY + m);

        const stroke = isSelected ? 'var(--primary)' : 'black';
        const sw = isSelected ? 3 : 2;

        return {
            svgWidth: svgW, svgHeight: svgH,
            viewBox: `0 0 ${svgW} ${svgH}`,
            svgContent: `<polygon points="${pts.join(' ')}" fill="white" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`,
            textCenterX: cx, textCenterY: cy
        };
    }
});
