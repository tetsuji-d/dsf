/**
 * shapes.js — 吹き出し形状レジストリ
 *
 * render(textW, textH, b, isSelected) → {
 *   svgWidth, svgHeight, viewBox, svgContent,
 *   textCenterX, textCenterY, tailTipX, tailTipY
 * }
 *
 * カラーは b.fillColor, b.strokeColor で制御
 */

const SHAPES = {};

export function registerShape(name, shape) { SHAPES[name] = shape; }
export function getShape(name) { return SHAPES[name] || SHAPES['speech']; }
export function getShapeNames() { return Object.keys(SHAPES); }

// ===== ヘルパー関数 =====
function getColors(b, isSelected) {
    const fill = b.fillColor || '#ffffff';
    const stroke = isSelected ? 'var(--primary)' : (b.strokeColor || '#000000');
    const sw = isSelected ? 3 : 2;
    return { fill, stroke, sw };
}

// ============================================================
//  speech（角丸長方形 + ベジエしっぽ）
// ============================================================
registerShape('speech', {
    label: '角丸フキダシ',
    render(textW, textH, b, isSelected) {
        const pad = 10;
        const w = textW + pad * 2;
        const h = textH + pad * 2;
        const cr = Math.min(14, w / 4, h / 4);
        const m = 4;
        const { fill, stroke, sw } = getColors(b, isSelected);

        const rx = m, ry = m, rw = w, rh = h;
        const cx = rx + rw / 2, cy = ry + rh / 2;

        const tailX = b.tailX || 0;
        const tailY = b.tailY || 20;
        const tailTipX = cx + tailX;
        const tailTipY = cy + rh / 2 + tailY;

        const dx = tailTipX - cx, dy = tailTipY - cy;
        let attachSide = 'bottom';
        if (Math.abs(dx) > Math.abs(dy)) {
            attachSide = dx > 0 ? 'right' : 'left';
        } else {
            attachSide = dy > 0 ? 'bottom' : 'top';
        }

        const baseW = 16;
        let d = '';
        d += `M ${rx + cr} ${ry} `;

        if (attachSide === 'top') {
            const bx = Math.max(rx + cr + baseW, Math.min(rx + rw - cr - baseW, tailTipX));
            const jl = bx - baseW / 2, jr = bx + baseW / 2;
            d += `H ${jl} `;
            d += `Q ${jl} ${ry - baseW / 2} ${tailTipX} ${tailTipY} `;
            d += `Q ${jr} ${ry - baseW / 2} ${jr} ${ry} `;
        }
        d += `H ${rx + rw - cr} Q ${rx + rw} ${ry} ${rx + rw} ${ry + cr} `;

        if (attachSide === 'right') {
            const by = Math.max(ry + cr + baseW, Math.min(ry + rh - cr - baseW, tailTipY));
            const jt = by - baseW / 2, jb = by + baseW / 2;
            d += `V ${jt} Q ${rx + rw + baseW / 2} ${jt} ${tailTipX} ${tailTipY} Q ${rx + rw + baseW / 2} ${jb} ${rx + rw} ${jb} `;
        }
        d += `V ${ry + rh - cr} Q ${rx + rw} ${ry + rh} ${rx + rw - cr} ${ry + rh} `;

        if (attachSide === 'bottom') {
            const bx = Math.max(rx + cr + baseW, Math.min(rx + rw - cr - baseW, tailTipX));
            const jl = bx - baseW / 2, jr = bx + baseW / 2;
            d += `H ${jr} Q ${jr} ${ry + rh + baseW / 2} ${tailTipX} ${tailTipY} Q ${jl} ${ry + rh + baseW / 2} ${jl} ${ry + rh} `;
        }
        d += `H ${rx + cr} Q ${rx} ${ry + rh} ${rx} ${ry + rh - cr} `;

        if (attachSide === 'left') {
            const by = Math.max(ry + cr + baseW, Math.min(ry + rh - cr - baseW, tailTipY));
            const jt = by - baseW / 2, jb = by + baseW / 2;
            d += `V ${jb} Q ${rx - baseW / 2} ${jb} ${tailTipX} ${tailTipY} Q ${rx - baseW / 2} ${jt} ${rx} ${jt} `;
        }
        d += `V ${ry + cr} Q ${rx} ${ry} ${rx + cr} ${ry} Z`;

        const minX = Math.min(rx, tailTipX - 2), maxX = Math.max(rx + rw, tailTipX + 2);
        const minY = Math.min(ry, tailTipY - 2), maxY = Math.max(ry + rh, tailTipY + 2);
        const offsetX = minX < 0 ? -minX + m : 0, offsetY = minY < 0 ? -minY + m : 0;
        const svgW = Math.ceil((maxX - minX) + m * 2), svgH = Math.ceil((maxY - minY) + m * 2);

        return {
            svgWidth: svgW, svgHeight: svgH, viewBox: `0 0 ${svgW} ${svgH}`,
            svgContent: `<g transform="translate(${offsetX}, ${offsetY})"><path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></g>`,
            textCenterX: cx + offsetX, textCenterY: cy + offsetY,
            tailTipX: tailTipX + offsetX, tailTipY: tailTipY + offsetY
        };
    }
});

// ============================================================
//  oval（楕円 + ベジエしっぽ）
// ============================================================
registerShape('oval', {
    label: '楕円フキダシ',
    render(textW, textH, b, isSelected) {
        const padX = 18, padY = 14;
        const rx = textW / 2 + padX;
        const ry = textH / 2 + padY;
        const m = 4;
        const { fill, stroke, sw } = getColors(b, isSelected);

        const cx = rx + m, cy = ry + m;

        const tailX = b.tailX || 0;
        const tailY = b.tailY || 20;
        const tipX = cx + tailX;
        const tipY = cy + ry + tailY;

        // しっぽの根本：楕円上の最近接点
        const angle = Math.atan2(tipY - cy, tipX - cx);
        const baseX = cx + rx * Math.cos(angle);
        const baseY = cy + ry * Math.sin(angle);
        const baseW = 10;
        const perpAngle = angle + Math.PI / 2;
        const jlX = baseX + Math.cos(perpAngle) * baseW / 2;
        const jlY = baseY + Math.sin(perpAngle) * baseW / 2;
        const jrX = baseX - Math.cos(perpAngle) * baseW / 2;
        const jrY = baseY - Math.sin(perpAngle) * baseW / 2;

        const svgW = Math.ceil(cx * 2 + m * 2 + Math.max(0, Math.abs(tailX) - rx + 4));
        const svgH = Math.ceil(cy * 2 + m * 2 + Math.max(0, tailY));

        const minX = Math.min(cx - rx, tipX) - m;
        const maxX = Math.max(cx + rx, tipX) + m;
        const minY = Math.min(cy - ry, tipY) - m;
        const maxY = Math.max(cy + ry, tipY) + m;
        const offX = minX < 0 ? -minX : 0;
        const offY = minY < 0 ? -minY : 0;
        const vW = Math.ceil(maxX - minX);
        const vH = Math.ceil(maxY - minY);

        const ellipseClipId = `ec_${Math.random().toString(36).slice(2, 7)}`;
        const svgContent = `
            <defs>
                <clipPath id="${ellipseClipId}">
                    <ellipse cx="${cx + offX}" cy="${cy + offY}" rx="${rx}" ry="${ry}"/>
                </clipPath>
            </defs>
            <polygon points="${jlX + offX},${jlY + offY} ${tipX + offX},${tipY + offY} ${jrX + offX},${jrY + offY}"
                fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
            <ellipse cx="${cx + offX}" cy="${cy + offY}" rx="${rx}" ry="${ry}"
                fill="${fill}" stroke="${stroke}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>`;

        return {
            svgWidth: vW, svgHeight: vH, viewBox: `0 0 ${vW} ${vH}`,
            svgContent,
            textCenterX: cx + offX, textCenterY: cy + offY,
            tailTipX: tipX + offX, tailTipY: tipY + offY
        };
    }
});

// ============================================================
//  rect（直角矩形 / しっぽなし）
// ============================================================
registerShape('rect', {
    label: '四角形',
    render(textW, textH, b, isSelected) {
        const pad = 14;
        const w = textW + pad * 2, h = textH + pad * 2;
        const m = 4;
        const { fill, stroke, sw } = getColors(b, isSelected);

        const rx = m, ry = m, rw = w, rh = h;
        const cx = rx + rw / 2, cy = ry + rh / 2;

        const rectPath = `M ${rx} ${ry} H ${rx + rw} V ${ry + rh} H ${rx} Z`;

        const vW = Math.ceil(rw + m * 2);
        const vH = Math.ceil(rh + m * 2);

        return {
            svgWidth: vW, svgHeight: vH, viewBox: `0 0 ${vW} ${vH}`,
            svgContent: `<path d="${rectPath}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="miter" vector-effect="non-scaling-stroke"/>`,
            textCenterX: cx, textCenterY: cy,
            // しっぽを完全に無くすため、しっぽの先端座標を中央と同じに設定（UI上で非表示にするため）
            tailTipX: cx, tailTipY: cy
        };
    }
});

// ============================================================
//  cloud（雲フキダシ — 滑らかな雲形状）
// ============================================================
registerShape('cloud', {
    label: '雲フキダシ',
    render(textW, textH, b, isSelected) {
        const padX = 22, padY = 18;
        const bW = textW + padX * 2;
        const bH = textH + padY * 2;
        const m = 8;
        const { fill, stroke, sw } = getColors(b, isSelected);

        const cx = bW / 2 + m, cy = bH / 2 + m;
        const rx = bW / 2, ry = bH / 2;

        // 楕円の輪郭にN個のQ-bezierバンプを配置して滑らかな雲形状を生成
        const N = 14;
        const bumpAmp = Math.min(rx, ry) * 0.22;

        let d = '';
        for (let i = 0; i < N; i++) {
            const t0 = i / N;
            const t1 = (i + 0.5) / N;
            const t2 = (i + 1) / N;
            const ang0 = t0 * Math.PI * 2 - Math.PI / 2;
            const ang1 = t1 * Math.PI * 2 - Math.PI / 2;
            const ang2 = t2 * Math.PI * 2 - Math.PI / 2;
            // ellipse内側の接続点
            const p0 = [cx + rx * Math.cos(ang0), cy + ry * Math.sin(ang0)];
            // バンプの頂点（楕円よりbumpAmp外側）
            const peak = [cx + (rx + bumpAmp) * Math.cos(ang1), cy + (ry + bumpAmp) * Math.sin(ang1)];
            const p2 = [cx + rx * Math.cos(ang2), cy + ry * Math.sin(ang2)];
            if (i === 0) d += `M ${p0[0].toFixed(1)} ${p0[1].toFixed(1)} `;
            d += `Q ${peak[0].toFixed(1)} ${peak[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)} `;
        }
        d += 'Z';

        const tailX = b.tailX || 0;
        const tailY = b.tailY || 20;
        const tipX = cx + tailX;
        const tipY = cy + ry + bumpAmp + tailY;
        const d1x = cx + tailX * 0.3, d1y = cy + ry + bumpAmp + tailY * 0.3;
        const d2x = cx + tailX * 0.6, d2y = cy + ry + bumpAmp + tailY * 0.6;

        const minX = cx - rx - bumpAmp - m;
        const maxX = Math.max(cx + rx + bumpAmp, tipX) + m;
        const minY = cy - ry - bumpAmp - m;
        const maxY = Math.max(cy + ry + bumpAmp, tipY) + m;
        const offX = minX < 0 ? -minX : 0, offY = minY < 0 ? -minY : 0;
        const vW = Math.ceil(maxX - minX), vH = Math.ceil(maxY - minY);

        const svgContent = `<g transform="translate(${offX},${offY})">
            <path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
            <circle cx="${d1x}" cy="${d1y}" r="5" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>
            <circle cx="${d2x}" cy="${d2y}" r="3.5" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>
            <circle cx="${tipX}" cy="${tipY}" r="2" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>
        </g>`;

        return {
            svgWidth: vW, svgHeight: vH, viewBox: `0 0 ${vW} ${vH}`,
            svgContent,
            textCenterX: cx + offX, textCenterY: cy + offY,
            tailTipX: tipX + offX, tailTipY: tipY + offY
        };
    }
});



// ============================================================
//  wave（波形フキダシ）
// ============================================================
registerShape('wave', {
    label: '波フキダシ',
    render(textW, textH, b, isSelected) {
        const pad = 14;
        const w = textW + pad * 2, h = textH + pad * 2;
        const m = 8;
        const { fill, stroke, sw } = getColors(b, isSelected);

        const rx = m, ry = m;
        const cx = rx + w / 2, cy = ry + h / 2;
        const amp = 7;

        // Catmull-Romスプラインで自然な波を生成
        function catmullPath(pts) {
            if (pts.length < 2) return '';
            let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)} `;
            for (let i = 0; i < pts.length - 1; i++) {
                const p0 = pts[Math.max(0, i - 1)];
                const p1 = pts[i];
                const p2 = pts[i + 1];
                const p3 = pts[Math.min(pts.length - 1, i + 2)];
                const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
                const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
                const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
                const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
                d += `C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${cp2x.toFixed(1)} ${cp2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)} `;
            }
            return d;
        }

        // 4辺の波点を生成
        const wN = Math.max(4, Math.round(w / 18));
        const hN = Math.max(3, Math.round(h / 18));

        function makeEdgePts(x0, y0, x1, y1, n, direction) {
            const pts = [];
            for (let i = 0; i <= n; i++) {
                const t = i / n;
                const bx = x0 + (x1 - x0) * t;
                const by = y0 + (y1 - y0) * t;
                // 法線方向にamp
                const sign = (i % 2 === 0) ? 1 : -1;
                const nx = -(y1 - y0) / Math.hypot(x1 - x0, y1 - y0) * amp * sign * direction;
                const ny = (x1 - x0) / Math.hypot(x1 - x0, y1 - y0) * amp * sign * direction;
                pts.push([bx + nx, by + ny]);
            }
            return pts;
        }

        const topPts = makeEdgePts(rx, ry, rx + w, ry, wN, 1);
        const rightPts = makeEdgePts(rx + w, ry, rx + w, ry + h, hN, 1);
        const botPts = makeEdgePts(rx + w, ry + h, rx, ry + h, wN, 1);
        const leftPts = makeEdgePts(rx, ry + h, rx, ry, hN, 1);

        // しっぽ（bottom辺の中央から突き出し）
        const tailX = b.tailX || 0;
        const tailY = b.tailY || 20;
        const tipX = cx + tailX;
        const tipY = cy + h / 2 + amp + tailY;
        const baseW = 14;

        // 分割: bottom辺の右半分→しっぽ→左半分
        const midIdx = Math.floor(botPts.length / 2);
        const botR = botPts.slice(0, midIdx + 1);
        const botL = botPts.slice(midIdx);

        const allPts = [
            ...topPts,
            ...rightPts.slice(1),
            ...botR.slice(1),
            [cx + tailX + baseW / 2, cy + h / 2 + amp],
            [tipX, tipY],
            [cx + tailX - baseW / 2, cy + h / 2 + amp],
            ...botL.slice(1),
            ...leftPts.slice(1)
        ];

        let d = catmullPath(allPts) + ' Z';

        const margin = amp + m;
        const minX = Math.min(rx - margin, tipX - m);
        const maxX = Math.max(rx + w + margin, tipX + m);
        const minY = Math.min(ry - margin, tipY - m);
        const maxY = Math.max(ry + h + margin, tipY + m);
        const offX = minX < 0 ? -minX : 0, offY = minY < 0 ? -minY : 0;
        const vW = Math.ceil(maxX - minX), vH = Math.ceil(maxY - minY);

        return {
            svgWidth: vW, svgHeight: vH, viewBox: `0 0 ${vW} ${vH}`,
            svgContent: `<g transform="translate(${offX},${offY})"><path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></g>`,
            textCenterX: cx + offX, textCenterY: cy + offY,
            tailTipX: tipX + offX, tailTipY: tipY + offY
        };
    }
});

// ============================================================
//  explosion（爆発フキダシ — 内向き凹みスパイク）
// ============================================================
registerShape('explosion', {
    label: '爆発フキダシ',
    render(textW, textH, b, isSelected) {
        const pad = 8;
        const bRx = textW / 2 + pad + 8;
        const bRy = textH / 2 + pad + 8;
        const m = 8;
        const { fill, stroke, sw } = getColors(b, isSelected);

        // 爆発：外向きスパイクの谷をベジエ曲線で丸めて
        // 「矩形を円でブーリアン差し引いた」ような形状を近似
        const cx = bRx + m + 14, cy = bRy + m + 14;
        const outerRx = bRx + 14, outerRy = bRy + 14;
        const innerRx = bRx * 0.7, innerRy = bRy * 0.7;
        const spikeN = 12;
        const pts = [];
        for (let i = 0; i < spikeN * 2; i++) {
            const ang = (i / (spikeN * 2)) * Math.PI * 2 - Math.PI / 2;
            const isOuter = i % 2 === 0;
            const r_x = isOuter ? outerRx : innerRx;
            const r_y = isOuter ? outerRy : innerRy;
            pts.push(`${(cx + r_x * Math.cos(ang)).toFixed(1)},${(cy + r_y * Math.sin(ang)).toFixed(1)}`);
        }

        // cubic bezierで谷部分を丸める
        function buildExplosionPath(pts) {
            const n = pts.length;
            let d = `M ${pts[0]} `;
            for (let i = 0; i < n; i++) {
                const cur = pts[i].split(',').map(Number);
                const next = pts[(i + 1) % n].split(',').map(Number);
                const next2 = pts[(i + 2) % n].split(',').map(Number);
                if (i % 2 === 1) { // 谷（内側）→ベジエで丸める
                    const cp1x = cur[0] + (next[0] - cur[0]) * 0.4;
                    const cp1y = cur[1] + (next[1] - cur[1]) * 0.4;
                    const cp2x = cur[0] + (next[0] - cur[0]) * 0.6;
                    const cp2y = cur[1] + (next[1] - cur[1]) * 0.6;
                    d += `L ${cur[0]} ${cur[1]} `;
                } else { // 外側の峰 → そのまま
                    d += `L ${cur[0]} ${cur[1]} `;
                }
            }
            return d + 'Z';
        }

        const tailX = b.tailX || 0;
        const tailY = b.tailY || 20;
        const tipX = cx + tailX;
        const tipY = cy + outerRy + tailY;
        const d1x = cx + tailX * 0.3, d1y = cy + outerRy + tailY * 0.3;
        const d2x = cx + tailX * 0.65, d2y = cy + outerRy + tailY * 0.65;

        const minX = cx - outerRx - m, maxX = Math.max(cx + outerRx, tipX) + m;
        const minY = cy - outerRy - m, maxY = Math.max(cy + outerRy, tipY) + m;
        const offX = minX < 0 ? -minX : 0, offY = minY < 0 ? -minY : 0;
        const vW = Math.ceil(maxX - minX), vH = Math.ceil(maxY - minY);

        return {
            svgWidth: vW, svgHeight: vH, viewBox: `0 0 ${vW} ${vH}`,
            svgContent: `<g transform="translate(${offX},${offY})">
                <polygon points="${pts.join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
                <circle cx="${d1x}" cy="${d1y}" r="3" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>
                <circle cx="${d2x}" cy="${d2y}" r="2" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>
                <circle cx="${tipX}" cy="${tipY}" r="1.5" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>
            </g>`,
            textCenterX: cx + offX, textCenterY: cy + offY,
            tailTipX: tipX + offX, tailTipY: tipY + offY
        };
    }
});

// ============================================================
//  thought（思考フキダシ）
// ============================================================
registerShape('thought', {
    label: '思考フキダシ',
    render(textW, textH, b, isSelected) {
        const padX = 16, padY = 14;
        const rx = textW / 2 + padX;
        const ry = textH / 2 + padY;
        const m = 8;
        const { fill, stroke, sw } = getColors(b, isSelected);

        const cx = rx + m, cy = ry + m;

        // 8点の不均一なベジエ曲線で「ぽよっとした」楕円を生成
        // 各コントロールポイントを楕円から少しランダムにずらす
        function blobPath(cx, cy, rx, ry) {
            // 8方向の輪郭点（均等でない変形）
            const bumps = [1.05, 0.92, 1.08, 0.95, 1.04, 0.93, 1.06, 0.96];
            const n = 8;
            function pt(i) {
                const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
                const amp = bumps[i % bumps.length];
                return [cx + rx * amp * Math.cos(ang), cy + ry * amp * Math.sin(ang)];
            }
            let d = '';
            for (let i = 0; i < n; i++) {
                const p0 = pt(i);
                const p1 = pt((i + 1) % n);
                const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
                // 制御点を少し外側に引く
                const ang = ((i + 0.5) / n) * Math.PI * 2 - Math.PI / 2;
                const cpR = Math.max(rx, ry) * 0.82;
                const cp = [cx + cpR * Math.cos(ang) * 1.12, cy + ry * Math.sin(ang) * 1.12];
                if (i === 0) d += `M ${p0[0].toFixed(1)} ${p0[1].toFixed(1)} `;
                d += `Q ${cp[0].toFixed(1)} ${cp[1].toFixed(1)} ${p1[0].toFixed(1)} ${p1[1].toFixed(1)} `;
            }
            return d + 'Z';
        }

        const tailX = b.tailX || 0, tailY = b.tailY || 25;
        const tipX = cx + tailX, tipY = cy + ry * 1.06 + tailY;

        const ang = Math.atan2(tipY - cy, tipX - cx);
        const edgeX = cx + rx * Math.cos(ang);
        const edgeY = cy + ry * Math.sin(ang);
        const d1x = edgeX + (tipX - edgeX) * 0.28, d1y = edgeY + (tipY - edgeY) * 0.28;
        const d2x = edgeX + (tipX - edgeX) * 0.62, d2y = edgeY + (tipY - edgeY) * 0.62;

        const minX = cx - rx * 1.12 - m, maxX = Math.max(cx + rx * 1.12, tipX) + m;
        const minY = cy - ry * 1.12 - m, maxY = Math.max(cy + ry * 1.12, tipY) + m;
        const offX = minX < 0 ? -minX : 0, offY = minY < 0 ? -minY : 0;
        const vW = Math.ceil(maxX - minX), vH = Math.ceil(maxY - minY);

        return {
            svgWidth: vW, svgHeight: vH, viewBox: `0 0 ${vW} ${vH}`,
            svgContent: `<g transform="translate(${offX},${offY})">
                <path d="${blobPath(cx, cy, rx, ry)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>
                <ellipse cx="${d1x}" cy="${d1y}" rx="6" ry="5" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>
                <ellipse cx="${d2x}" cy="${d2y}" rx="4" ry="3.5" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>
                <circle cx="${tipX}" cy="${tipY}" r="2.5" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>
            </g>`,
            textCenterX: cx + offX, textCenterY: cy + offY,
            tailTipX: tipX + offX, tailTipY: tipY + offY
        };
    }
});

// ============================================================
//  digital（電子音フキダシ — 多角形 + 鋭いしっぽ）
// ============================================================
registerShape('digital', {
    label: '電子音フキダシ',
    render(textW, textH, b, isSelected) {
        const pad = 14;
        const w = textW + pad * 2, h = textH + pad * 2;
        const m = 4;
        const { fill, stroke, sw } = getColors(b, isSelected);

        const cx = w / 2 + m, cy = h / 2 + m;

        // 五角形近似（上辺を少し削る変形四角形）
        const pts = [
            [cx - w / 2, cy - h * 0.1],     // 左
            [cx - w * 0.3, cy - h / 2],      // 左上
            [cx + w * 0.3, cy - h / 2],      // 右上
            [cx + w / 2, cy - h * 0.1],      // 右
            [cx + w / 2, cy + h / 2],        // 右下
            [cx - w / 2, cy + h / 2],        // 左下
        ];

        const tailX = b.tailX || 0;
        const tailY = b.tailY || 16;
        const tipX = cx + tailX;
        const tipY = cy + h / 2 + tailY;
        const baseW = 12;
        const jl = cx - baseW / 2, jr = cx + baseW / 2;

        const allPts = [...pts.map(p => p.join(',')), `${jr},${cy + h / 2}`, `${tipX},${tipY}`, `${jl},${cy + h / 2}`];
        // insert tail into the bottom edge
        const polyPts = [
            pts[0].join(','), pts[1].join(','), pts[2].join(','),
            pts[3].join(','), pts[4].join(','),
            `${jr},${cy + h / 2}`, `${tipX},${tipY}`, `${jl},${cy + h / 2}`,
            pts[5].join(',')
        ];

        const vW = Math.ceil(w + m * 2 + 4);
        const vH = Math.ceil(cy + h / 2 + tailY + m * 2);

        return {
            svgWidth: vW, svgHeight: vH, viewBox: `0 0 ${vW} ${vH}`,
            svgContent: `<polygon points="${polyPts.join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`,
            textCenterX: cx, textCenterY: cy,
            tailTipX: tipX, tailTipY: tipY
        };
    }
});

// ============================================================
//  flash（フラッシュフキダシ — 放射線のみ）
// ============================================================
registerShape('flash', {
    label: 'フラッシュフキダシ',
    render(textW, textH, b, isSelected) {
        const padX = 16, padY = 12;
        const innerRx = textW / 2 + padX;
        const innerRy = textH / 2 + padY;
        const m = 8;
        const { fill, stroke, sw } = getColors(b, isSelected);

        const outerMargin = 36;
        const cx = innerRx + m + outerMargin;
        const cy = innerRy + m + outerMargin;

        // 96本の放射線（長さをばらつかせてより自然に）
        const lineCount = 96;
        const gradId = `fg_${Math.random().toString(36).slice(2, 7)}`;
        let lines = '';
        for (let i = 0; i < lineCount; i++) {
            const ang = (i / lineCount) * Math.PI * 2;
            // 楕円表面から出発
            const x1 = cx + innerRx * Math.cos(ang);
            const y1 = cy + innerRy * Math.sin(ang);
            // 交互に長短の放射線
            const lenVar = (i % 3 === 0) ? 1.0 : (i % 3 === 1) ? 0.7 : 0.85;
            const outerR = Math.max(innerRx, innerRy) + outerMargin * lenVar;
            const x2 = cx + (innerRx + outerR * Math.cos(ang) * lenVar);
            const y2 = cy + (innerRy + outerR * Math.sin(ang) * lenVar);
            const lineLen = Math.hypot(x2 - x1, y2 - y1);
            lines += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}" stroke-width="${i % 3 === 0 ? sw : sw * 0.6}" opacity="${i % 3 === 0 ? 1 : 0.7}" vector-effect="non-scaling-stroke"/>`;
        }

        const vW = Math.ceil(cx * 2 + m);
        const vH = Math.ceil(cy * 2 + m);

        // 楕円: 外形線なし、グラデーション塗り（中央不透明→外縁透明）
        const svgContent = `<defs>
            <radialGradient id="${gradId}" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="${fill}" stop-opacity="1"/>
                <stop offset="70%" stop-color="${fill}" stop-opacity="0.9"/>
                <stop offset="100%" stop-color="${fill}" stop-opacity="0"/>
            </radialGradient>
        </defs>
        ${lines}
        <ellipse cx="${cx}" cy="${cy}" rx="${innerRx}" ry="${innerRy}" fill="url(#${gradId})" stroke="none"/>`;

        return {
            svgWidth: vW, svgHeight: vH, viewBox: `0 0 ${vW} ${vH}`,
            svgContent,
            textCenterX: cx, textCenterY: cy,
            tailTipX: cx, tailTipY: cy + innerRy + 20
        };
    }
});

// ============================================================
//  urchin（ウニフラッシュ — 黒塗り + 密スパイク）
// ============================================================
registerShape('urchin', {
    label: 'ウニフラッシュフキダシ',
    render(textW, textH, b, isSelected) {
        const padX = 14, padY = 10;
        const innerRx = textW / 2 + padX;
        const innerRy = textH / 2 + padY;
        const m = 4;
        const { fill, stroke, sw } = getColors(b, isSelected);

        const bodyFill = b.fillColor || '#000000';
        const bodyStroke = b.strokeColor || '#000000';

        // スパイク長（ハンドルで調整可能）
        const spikeLen = (b.spikeLength !== undefined ? b.spikeLength : 22);
        const clampedSpike = Math.max(4, Math.min(60, spikeLen));

        const outerMargin = clampedSpike + 4;
        const cx = innerRx + m + outerMargin;
        const cy = innerRy + m + outerMargin;

        // 144本のスパイク（密度3倍）
        const spikeN = 144;
        const pts = [];
        for (let i = 0; i < spikeN * 2; i++) {
            const ang = (i / (spikeN * 2)) * Math.PI * 2 - Math.PI / 2;
            const isOuter = i % 2 === 0;
            if (isOuter) {
                // 楕円外周からspikeLenだけ外に突き出す
                const surfX = cx + innerRx * Math.cos(ang);
                const surfY = cy + innerRy * Math.sin(ang);
                // 法線方向（楕円の場合は中心からの方向）
                const nx = Math.cos(ang), ny = Math.sin(ang);
                pts.push(`${(surfX + nx * clampedSpike).toFixed(1)},${(surfY + ny * clampedSpike).toFixed(1)}`);
            } else {
                // 内側の点は楕円表面ちょっと内側
                const surfX = cx + innerRx * Math.cos(ang) * 0.95;
                const surfY = cy + innerRy * Math.sin(ang) * 0.95;
                pts.push(`${surfX.toFixed(1)},${surfY.toFixed(1)}`);
            }
        }

        const total = outerMargin + Math.max(innerRx, innerRy) + m;
        const vW = Math.ceil(cx * 2 + m * 2);
        const vH = Math.ceil(cy * 2 + m * 2);

        // スパイク長調整ハンドルの位置（右方向の代表スパイク先端）
        const hAng = 0; // 0 = 右方向
        const hSurfX = cx + innerRx * Math.cos(hAng);
        const hSurfY = cy + innerRy * Math.sin(hAng);
        const spikeHandleX = hSurfX + Math.cos(hAng) * clampedSpike;
        const spikeHandleY = hSurfY + Math.sin(hAng) * clampedSpike;

        return {
            svgWidth: vW, svgHeight: vH, viewBox: `0 0 ${vW} ${vH}`,
            svgContent: `
                <polygon points="${pts.join(' ')}" fill="${bodyFill}" stroke="${bodyFill}" stroke-width="0.3" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
                <ellipse cx="${cx}" cy="${cy}" rx="${innerRx}" ry="${innerRy}" fill="${bodyFill}" stroke="${bodyStroke}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>
            `,
            textCenterX: cx, textCenterY: cy,
            tailTipX: cx, tailTipY: cy + innerRy + 10,
            spikeHandleX, spikeHandleY
        };
    }
});

// ============================================================
//  shout（ギザギザ吹き出し）← 保持（互換性のため）
// ============================================================
registerShape('shout', {
    label: 'ギザギザフキダシ',
    render(textW, textH, b, isSelected) {
        const pad = 10;
        const pw = textW + pad * 2, ph = textH + pad * 2;
        const baseRx = Math.max(pw / 2, 28), baseRy = Math.max(ph / 2, 20);
        const m = 8;
        const { fill, stroke, sw } = getColors(b, isSelected);

        const cx = baseRx + m + 22, cy = baseRy + m + 22;

        const tailX = b.tailX || 0, tailY = b.tailY || 20;
        const tipX = cx + tailX, tipY = cy + baseRy + tailY + 18;

        // ギザギザは爆発と違い「密な不規則スパイク」で手描き感
        // スパイク数を多くし、内外の半径をアングルごとに不規則に変える
        const numSpikes = 32;
        const total = numSpikes * 2;
        const pts = [];

        // アングルごとに疑似ランダムな振れ幅を決める（シード固定でリロードしても変わらない）
        function pseudoRand(i) {
            const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
            return x - Math.floor(x);
        }

        let tailInserted = false;
        for (let j = 0; j < total; j++) {
            const ang = (j / total) * Math.PI * 2 - Math.PI / 2;
            const isOuter = j % 2 === 0;
            // 不規則な外半径: 基本spikeに±30%のランダム変動
            const spike = 16 + pseudoRand(j) * 10;
            const inset = 4 + pseudoRand(j + total) * 6;
            const orx = baseRx + spike;
            const ory = baseRy + spike;
            const irx = baseRx - inset;
            const iry = baseRy - inset;

            // しっぽは下方向(ang≈π/2)の近くに差し込む
            const bottomAng = Math.PI / 2;
            if (!tailInserted && isOuter && ang > bottomAng - 0.2 && ang < bottomAng + 0.2) {
                pts.push(`${tipX.toFixed(1)},${tipY.toFixed(1)}`);
                tailInserted = true;
            }

            const rr_x = isOuter ? orx : irx;
            const rr_y = isOuter ? ory : iry;
            pts.push(`${(cx + rr_x * Math.cos(ang)).toFixed(1)},${(cy + rr_y * Math.sin(ang)).toFixed(1)}`);
        }

        const minX = cx - baseRx - 22 - m;
        const maxX = Math.max(cx + baseRx + 22, tipX) + m;
        const minY = cy - baseRy - 22 - m;
        const maxY = Math.max(cy + baseRy + 22, tipY) + m;
        const offX = minX < 0 ? -minX : 0, offY = minY < 0 ? -minY : 0;
        const vW = Math.ceil(maxX - minX), vH = Math.ceil(maxY - minY);

        return {
            svgWidth: vW, svgHeight: vH, viewBox: `0 0 ${vW} ${vH}`,
            svgContent: `<g transform="translate(${offX},${offY})"><polygon points="${pts.join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="miter" vector-effect="non-scaling-stroke"/></g>`,
            textCenterX: cx + offX, textCenterY: cy + offY,
            tailTipX: tipX + offX, tailTipY: tipY + offY
        };
    }
});

