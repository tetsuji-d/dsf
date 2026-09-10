// Fixed-page authoring objects. Public delivery uses flattened WebP pages.
import { getShape } from "./shapes.js";
import { getLangProps } from "./lang.js";
import { graphicOrder } from "./graphic-object-model.js";
import { loadImageForCanvas } from "./asset-fetch.js";
const images = /* @__PURE__ */ new Map();
async function getImage(url) {
  if (!images.has(url)) images.set(url, loadImageForCanvas(url).then(({ img, revoke }) => {
    revoke();
    return img;
  }).catch((e) => {
    images.delete(url);
    throw e;
  }));
  const result = images.get(url);
  while (images.size > 3) images.delete(images.keys().next().value);
  return result;
}
function getGraphicFrame(object, language) {
  return object.frames?.[language] || object.frame;
}
async function drawGraphicObject(ctx, o, assets, language, defaultLanguage) {
  if (!o.visible) return;
  const f = getGraphicFrame(o, language), s = o.style, w = f.width, h = f.height;
  ctx.save();
  ctx.translate(f.x + w / 2, f.y + h / 2);
  ctx.rotate(f.rotation * Math.PI / 180);
  ctx.translate(-w / 2, -h / 2);
  try {
    if (o.kind === "image") {
      const asset = assets.find((a) => a.id === o.assetId);
      if (!asset) throw new Error("Missing graphic image");
      const img = await getImage(asset.background), c = o.crop;
      ctx.globalAlpha = o.opacity;
      ctx.translate(o.flipX ? w : 0, o.flipY ? h : 0);
      ctx.scale(o.flipX ? -1 : 1, o.flipY ? -1 : 1);
      ctx.drawImage(img, c.x * img.width, c.y * img.height, c.width * img.width, c.height * img.height, 0, 0, w, h);
      return;
    }
    const path = new Path2D(), k = o.shape || "rect";
    if (k === "ellipse") path.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    else if (k === "roundRect") path.roundRect(0, 0, w, h, Math.min(w, h) * 0.12);
    else if (k === "speech") {
      path.moveTo(0, 0);
      path.lineTo(w, 0);
      path.lineTo(w, h * 0.8);
      path.lineTo(w * 0.35, h * 0.8);
      path.lineTo(w * 0.15, h);
      path.lineTo(w * 0.15, h * 0.8);
      path.lineTo(0, h * 0.8);
      path.closePath();
    } else if (k === "line" || k === "arrow") {
      path.moveTo(0, h / 2);
      path.lineTo(w, h / 2);
      if (k === "arrow") {
        path.moveTo(w - 16, h / 2 - 10);
        path.lineTo(w, h / 2);
        path.lineTo(w - 16, h / 2 + 10);
      }
    } else path.rect(0, 0, w, h);
    if (!["line", "arrow"].includes(k)) {
      ctx.globalAlpha = s.fillOpacity;
      ctx.fillStyle = s.fill;
      ctx.fill(path);
    }
    if (s.lineWidth) {
      ctx.globalAlpha = s.strokeOpacity;
      ctx.lineWidth = s.lineWidth;
      ctx.strokeStyle = s.stroke;
      ctx.stroke(path);
    }
    ctx.globalAlpha = 1;
    if (["line", "arrow"].includes(k)) return;
    const text = o.texts[language] ?? o.texts[defaultLanguage] ?? "";
    ctx.font = `${s.italic ? "italic " : ""}${s.bold ? "bold " : ""}${s.fontSize}px ${s.fontFamily}`;
    ctx.fillStyle = s.color;
    ctx.textBaseline = "top";
    const pad = s.padding, lineHeight = s.fontSize * 1.4;
    ctx.beginPath();
    ctx.rect(pad, pad, Math.max(0, w - pad * 2), Math.max(0, h - pad * 2));
    ctx.clip();
    if (s.writingMode === "vertical-rl") {
      const count = Math.max(1, Math.floor((h - pad * 2) / s.fontSize));
      const columns = [];
      for (const paragraph of text.split("\n")) {
        let chars = Array.from(paragraph);
        if (!chars.length) columns.push([]);
        while (chars.length) columns.push(chars.splice(0, count));
      }
      const used = columns.length * lineHeight;
      let x = s.valign === "center" ? (w + used) / 2 - lineHeight : s.valign === "bottom" ? pad + used - lineHeight : w - pad - lineHeight;
      columns.forEach((chars) => {
        const space = h - pad * 2 - chars.length * s.fontSize;
        const y = pad + (s.align === "center" ? space / 2 : s.align === "right" ? space : 0);
        chars.forEach((ch, i) => ctx.fillText(ch, x, y + i * s.fontSize));
        x -= lineHeight;
      });
    } else {
      const lines = [];
      for (const paragraph of text.split("\n")) {
        let line = "";
        for (const token of paragraph.split(/(\s+)/)) {
          if (line && ctx.measureText(line + token).width > w - 2 * pad) {
            lines.push(line);
            line = "";
          }
          for (const ch of token) {
            if (line && ctx.measureText(line + ch).width > w - 2 * pad) {
              lines.push(line);
              line = "";
            }
            line += ch;
          }
        }
        lines.push(line);
      }
      const total = lines.length * lineHeight;
      let y = s.valign === "center" ? (h - total) / 2 : s.valign === "bottom" ? h - pad - total : pad;
      for (const line of lines) {
        const width = ctx.measureText(line).width, x = s.align === "center" ? (w - width) / 2 : s.align === "right" ? w - pad - width : pad;
        ctx.fillText(line, x, y);
        if (s.underline) {
          ctx.fillRect(x, y + s.fontSize + 1, width, 1);
        }
        y += lineHeight;
      }
    }
  } finally {
    ctx.restore();
  }
}
async function renderGraphicLayerCanvas(o, assets, language, defaultLanguage, scale = 2) {
  const c = document.createElement("canvas");
  c.width = 360 * scale;
  c.height = 640 * scale;
  const ctx = c.getContext("2d");
  ctx.scale(scale, scale);
  await drawGraphicObject(ctx, o, assets, language, defaultLanguage);
  return c;
}
async function compositeGraphicObjects(baseBlob, section, assets, language, defaultLanguage, width, height, encode) {
  if (!section.graphicObjects?.length && !section.objectOrder) return baseBlob;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (baseBlob) {
    const bitmap = await createImageBitmap(baseBlob);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
  } else {
    ctx.fillStyle = section.backgroundColor || "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.scale(width / 360, height / 640);
  for (const o of graphicOrder(section)) {
    if (o.legacy) {
      await drawLegacyBubble(ctx, o.legacy, language, section.writingMode);
    } else await drawGraphicObject(ctx, o, assets, language, defaultLanguage);
  }
  return encode(canvas);
}
async function drawLegacyBubble(ctx, b, lang, writingMode) {
  if (b.visible === false) return;
  const props = getLangProps(lang), vertical = props.writingModes.includes(writingMode) && writingMode === "vertical-rl";
  const text = b.texts?.[lang] ?? b.text ?? "", lines = text.split("\n"), cw = lang === "en" ? 7.2 : 12;
  const tw = vertical ? lines.length * 17 : Math.max(1, ...lines.map((l2) => l2.length)) * cw;
  const th = vertical ? Math.max(1, ...lines.map((l2) => l2.length)) * cw : lines.length * 17;
  const l = getShape(b.shape || "speech").render(text ? tw : 36, text ? th : 17, b, false), pos = b.positions?.[lang] || b;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${l.svgWidth}" height="${l.svgHeight}" viewBox="${l.viewBox}">${l.svgContent}</svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const img = new Image();
  try {
    img.src = url;
    await img.decode();
    ctx.save();
    ctx.translate((pos.x || 0) * 3.6 - l.svgWidth / 2, (pos.y || 0) * 6.4 - l.svgHeight / 2);
    ctx.drawImage(img, 0, 0);
    ctx.fillStyle = b.fontColor || (b.shape === "urchin" ? "#ffffff" : "#000000");
    ctx.font = "12px sans-serif";
    ctx.textBaseline = "top";
    if (vertical) lines.forEach((line, i) => Array.from(line).forEach((ch, j) => ctx.fillText(ch, l.textCenterX + tw / 2 - (i + 1) * 17, l.textCenterY - th / 2 + j * cw)));
    else lines.forEach((line, i) => {
      const width = ctx.measureText(line).width;
      ctx.fillText(line, l.textCenterX - (props.align === "left" ? tw : width) / 2, l.textCenterY - th / 2 + i * 17);
    });
    ctx.restore();
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function appendGraphicPreview(container, section, assets, language, defaultLanguage) {
  const marker = {};
  container._graphicPreview = marker;
  for (const [i, o] of graphicOrder(section).entries()) {
    if (o.legacy) continue;
    const c = await renderGraphicLayerCanvas(o, assets, language, defaultLanguage);
    if (container._graphicPreview !== marker || !container.isConnected) return;
    c.className = "graphic-paint";
    c.style.zIndex = String((i + 1) * 2);
    container.append(c);
  }
}
async function appendGraphicThumbnail(container, section, assets, language, defaultLanguage) {
  const c = document.createElement("canvas");
  c.width = 360;
  c.height = 640;
  const ctx = c.getContext("2d");
  for (const o of graphicOrder(section)) {
    if (o.legacy) await drawLegacyBubble(ctx, o.legacy, language, section.writingMode);
    else await drawGraphicObject(ctx, o, assets, language, defaultLanguage);
  }
  if (!container.isConnected) return;
  c.className = "graphic-paint";
  container.append(c);
}
export {
  appendGraphicPreview,
  appendGraphicThumbnail,
  compositeGraphicObjects,
  drawGraphicObject,
  drawLegacyBubble,
  getGraphicFrame,
  renderGraphicLayerCanvas
};
