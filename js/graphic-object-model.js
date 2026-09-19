// Fixed-page authoring objects. Public delivery uses flattened WebP pages.
import {validateImageCaption} from './image-caption.js';
const GRAPHIC_SHAPES = ["rect", "roundRect", "ellipse", "line", "arrow", "speech"];
const color = (value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
const finite = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
function validateGraphicObjects(project) {
  const assets = new Set((project.projectAssets || []).map((a) => a.id));
  for (const block of [...project.blocks || [], ...(project.blocks || []).flatMap(b => (b?.flow?.layout?.anchoredObjects || []).map(e => ({kind:"page",content:{graphicObjects:[e.graphic],objectOrder:[e.graphic?.id]}})))]) {
    if (block?.kind !== "page") continue;
    const c = block.content || {};
    if (c.graphicObjects === void 0 && c.objectOrder === void 0) continue;
    if (!Array.isArray(c.graphicObjects) || !Array.isArray(c.objectOrder)) throw new Error("Invalid graphic object collection");
    const ids = /* @__PURE__ */ new Set();
    for (const o of [...c.bubbles || [], ...c.graphicObjects]) {
      if (typeof o.id !== "string" || !o.id || ids.has(o.id)) throw new Error("Invalid graphic object ID");
      ids.add(o.id);
    }
    for (const o of c.graphicObjects) {
      if(o.members !== undefined)throw new Error("Runtime graphic bundle cannot be persisted");
      validateImageCaption(o);
      const f = o.frame, st = o.style;
      if (!["image", "shape", "text"].includes(o.kind) || typeof o.name !== "string" || o.name.length > 512 || typeof o.visible !== "boolean" || typeof o.locked !== "boolean" || !f || !st || !finite(f.x, -3600, 3600) || !finite(f.y, -6400, 6400) || !finite(f.width, 1, 3600) || !finite(f.height, 1, 6400) || !finite(f.rotation, -180, 180) || !color(st.fill) || !color(st.stroke) || !color(st.color) || !finite(st.fillOpacity, 0, 1) || !finite(st.strokeOpacity, 0, 1) || !finite(st.lineWidth, 0, 30) || !finite(st.fontSize, 6, 200) || !finite(st.padding, 0, 200) || !["serif", "sans-serif"].includes(st.fontFamily) || !["left", "center", "right"].includes(st.align) || !["top", "center", "bottom"].includes(st.valign) || !["horizontal-tb", "vertical-rl"].includes(st.writingMode)) throw new Error("Invalid graphic object style or frame");
      for (const f2 of Object.values(o.frames || {})) if (!f2 || !finite(f2.x, -3600, 3600) || !finite(f2.y, -6400, 6400) || !finite(f2.width, 1, 3600) || !finite(f2.height, 1, 6400) || !finite(f2.rotation, -180, 180)) throw new Error("Invalid language graphic frame");
      if (["bold", "italic", "underline"].some((k) => typeof st[k] !== "boolean")) throw new Error("Invalid graphic font flag");
      if (o.kind === "image" && ["flipX", "flipY"].some((k) => typeof o[k] !== "boolean")) throw new Error("Invalid graphic flip");
      if (o.kind === "shape" && !GRAPHIC_SHAPES.includes(o.shape)) throw new Error("Invalid graphic shape");
      if (o.kind === "image") {
        const crop = o.crop;
        if (!assets.has(o.assetId) || !finite(o.opacity, 0, 1) || !crop || !finite(crop.x, 0, 1) || !finite(crop.y, 0, 1) || !finite(crop.width, 1e-3, 1) || !finite(crop.height, 1e-3, 1) || crop.x + crop.width > 1.000001 || crop.y + crop.height > 1.000001) throw new Error("Invalid graphic asset or crop");
      }
      if (!o.texts || typeof o.texts !== "object" || Array.isArray(o.texts) || Object.values(o.texts).some((v) => typeof v !== "string")) throw new Error("Invalid graphic text");
    }
    if (c.objectOrder.length !== ids.size || new Set(c.objectOrder).size !== ids.size || c.objectOrder.some((id) => !ids.has(id))) throw new Error("Invalid graphic object order");
  }
  return project;
}
function initializeGraphicObjects(content, idFactory) {
  content.graphicObjects ||= [];
  content.bubbles ||= [];
  for (const b of content.bubbles) b.id ||= idFactory();
  const ids = [...content.bubbles, ...content.graphicObjects].map((o) => o.id);
  content.objectOrder = [...(content.objectOrder || []).filter((id) => ids.includes(id)), ...ids.filter((id) => !content.objectOrder?.includes(id))];
  return content;
}
function createGraphicObject(kind, id, language, options = {}) {
  return {
    id,
    kind,
    name: options.name || kind,
    visible: true,
    locked: false,
    frame: { x: 60, y: 160, width: 240, height: 160, rotation: 0 },
    style: { fill: "#ffffff", fillOpacity: kind === "text" ? 0 : 1, stroke: "#243c52", strokeOpacity: kind === "text" ? 0 : 1, lineWidth: 2, color: "#172c40", fontSize: 24, fontFamily: "serif", bold: false, italic: false, underline: false, padding: 14, align: "center", valign: "center", writingMode: "horizontal-tb" },
    texts: { [language]: kind === "text" ? "Text" : "" },
    ...kind === "shape" ? { shape: options.shape || "rect" } : {},
    ...kind === "image" ? { assetId: options.assetId, opacity: 1, flipX: false, flipY: false, crop: { x: 0, y: 0, width: 1, height: 1 } } : {}
  };
}
function graphicOrder(content) {
  const objects = [...(content.bubbles || []).map((b, index) => ({ id: b.id, legacy: b, index })), ...content.graphicObjects || []];
  return content.objectOrder ? content.objectOrder.map((id) => objects.find((o) => o.id === id)).filter(Boolean) : objects;
}
export {
  GRAPHIC_SHAPES,
  createGraphicObject,
  graphicOrder,
  initializeGraphicObjects,
  validateGraphicObjects
};
