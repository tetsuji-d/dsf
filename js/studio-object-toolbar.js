// Fixed-page authoring objects. Public delivery uses flattened WebP pages.
import { initializeGraphicObjects, createGraphicObject, graphicOrder, GRAPHIC_SHAPES } from "./graphic-object-model.js";
import { renderGraphicLayerCanvas, getGraphicFrame } from "./graphic-object-renderer.js";
import "../css/studio-object-toolbar.css";
const el = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
const icons = { rect: '<rect x="3" y="5" width="22" height="17"/>', roundRect: '<rect x="3" y="5" width="22" height="17" rx="5"/>', ellipse: '<ellipse cx="14" cy="14" rx="11" ry="9"/>', line: '<path d="M3 23L25 4"/>', arrow: '<path d="M3 23L25 4M14 4H25V15"/>', speech: '<path d="M3 4H25V20H12L5 25V20H3Z"/>' };
const names = { rect: ["四角形", "Rectangle"], roundRect: ["角丸四角形", "Rounded rectangle"], ellipse: ["楕円", "Ellipse"], line: ["直線", "Line"], arrow: ["矢印", "Arrow"], speech: ["吹き出し", "Speech"] };
function createStudioObjectToolbar({ state, commit, refresh, prepareImage, selectLegacy, canEdit, editText, finishText }) {
  let selected = null, pageKey = "", root, tools, popup, busy = false, sequence = 0;
  const label = (ja, en) => document.documentElement.lang?.startsWith("en") ? en : ja;
  const key = () => [state.projectId, state.localProjectId, state.uid, state.activeBlockIdx, state.activeLang].join("|");
  const block = () => state.blocks?.[state.activeBlockIdx];
  const object = () => block()?.content?.graphicObjects?.find((o) => o.id === selected);
  const id = () => `object_${crypto.randomUUID()}`;
  function change(fn) {
    if (block()?.kind !== "page" || !canEdit()) return;
    closePopup();
    commit((c) => {
      initializeGraphicObjects(c, id);
      fn(c);
    });
  }
  function update(fn) {
    const current = object();
    if (!current || current.locked) return;
    const target = current.id;
    change((c) => {
      const o = c.graphicObjects.find((o2) => o2.id === target);
      if (o) fn(o);
    });
  }
  function closePopup() {
    popup?.remove();
    popup = null;
  }
  function button(parent, icon, title, action, active = false) {
    const b = el("button");
    b.type = "button";
    b.title = title;
    b.setAttribute("aria-label", title);
    b.className = "graphic-tool" + (active ? " active" : "");
    const span = el("span", icon, "material-icons");
    b.append(span);
    b.onmousedown = (e) => e.preventDefault();
    b.onclick = action;
    parent.append(b);
    return b;
  }
  function pop(anchor) {
    closePopup();
    popup = el("div", null, "graphic-popup");
    document.body.append(popup);
    const r = anchor.getBoundingClientRect();
    popup.style.top = `${Math.min(r.bottom + 4, innerHeight - 220)}px`;
    popup.style.left = `${Math.max(6, Math.min(r.left, innerWidth - 300))}px`;
    return popup;
  }
  function add(kind, options = {}) {
    selected = id();
    state.activeBubbleIdx = null;
    change((c) => {
      const o = createGraphicObject(kind, selected, state.activeLang, options);
      o.name = options.name || label(kind === "text" ? "テキスト" : kind === "image" ? "画像" : "図形", kind);
      if (kind === "text") o.texts[state.activeLang] = label("テキスト", "Text");
      if (kind === "image") {
        const a = state.projectAssets.find((a2) => a2.id === o.assetId);
        o.frame.height = Math.min(400, o.frame.width * a.height / a.width);
        o.frame.width = o.frame.height * a.width / a.height;
      }
      c.graphicObjects.push(o);
      c.objectOrder.push(o.id);
    });
  }
  function placeAsset(assetId) {
    if (block()?.kind !== "page" || !canEdit()) return;
    const a = state.projectAssets?.find((a2) => a2.id === assetId);
    if (!a) return;
    add("image", { assetId, name: a.name });
  }
  async function upload(replace = false) {
    if (busy) return;
    const input = el("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      const context = key(), target = object()?.id;
      busy = true;
      try {
        const image = await prepareImage(file, { maxLongEdge: 7680 });
        if (key() !== context) return;
        const asset = { id: `asset_${crypto.randomUUID()}`, name: file.name, background: image.mainUrl, thumbnail: image.thumbUrl, width: image.width, height: image.height, byteLength: image.byteLength, mimeType: "image/webp" };
        const newId = id();
        commit((c) => {
          initializeGraphicObjects(c, id);
          state.version = 6;
          state.projectAssets = [...state.projectAssets || [], asset];
          const old = replace && c.graphicObjects.find((o) => o.id === target && !o.locked);
          if (old) {
            old.assetId = asset.id;
            old.crop = { x: 0, y: 0, width: 1, height: 1 };
          } else {
            const o = createGraphicObject("image", newId, state.activeLang, { assetId: asset.id, name: asset.name });
            o.frame.height = Math.min(400, 240 * asset.height / asset.width);
            o.frame.width = o.frame.height * asset.width / asset.height;
            c.graphicObjects.push(o);
            c.objectOrder.push(o.id);
            selected = newId;
            state.activeBubbleIdx = null;
          }
        });
      } catch {
        alert(label("画像を追加できませんでした。画像形式・容量と接続を確認してください。", "Unable to add image. Check its format, size and connection."));
      } finally {
        busy = false;
      }
    };
    input.click();
  }
  function numeric(parent, title, value, min, max, fn, step = 1) {
    const wrap = el("label", title, "graphic-field"), input = el("input");
    input.type = "number";
    Object.assign(input, { value, min, max, step });
    input.setAttribute("aria-label", title);
    input.title = title;
    input.onchange = () => {
      const n = Number(input.value);
      if (Number.isFinite(n) && n >= min && n <= max) fn(n);
      else input.value = value;
    };
    wrap.append(input);
    parent.append(wrap);
  }
  function palette(anchor, property) {
    const o = object();
    if (!o) return;
    const p = pop(anchor);
    p.append(el("strong", label("色と透明度", "Color and transparency")));
    const sw = el("div", null, "graphic-swatches");
    p.append(sw);
    for (const color of ["#ffffff", "#000000", "#172c40", "#2563eb", "#0891b2", "#16a34a", "#eab308", "#ea580c", "#dc2626", "#9333ea", "#f7f1df", "#94a3b8"]) {
      const b = el("button");
      b.title = color;
      b.setAttribute("aria-label", color);
      b.style.background = color;
      b.onclick = () => update((o2) => {
        o2.style[property] = color;
        if (property !== "color") o2.style[property + "Opacity"] = 1;
      });
      sw.append(b);
    }
    const custom = el("input");
    custom.type = "color";
    custom.value = o.style[property];
    custom.title = label("任意の色", "Custom color");
    custom.onchange = () => update((o2) => o2.style[property] = custom.value);
    p.append(custom);
    if (property !== "color") {
      numeric(p, label("透明度 %", "Transparency %"), Math.round(100 * (1 - o.style[property + "Opacity"])), 0, 100, (v) => update((o2) => o2.style[property + "Opacity"] = 1 - v / 100));
      const none = el("button", label("なし", "None"));
      none.onclick = () => update((o2) => o2.style[property + "Opacity"] = 0);
      p.append(none);
    }
  }
  function remove() {
    const target = selected;
    change((c) => {
      c.graphicObjects = c.graphicObjects.filter((o) => o.id !== target);
      c.objectOrder = c.objectOrder.filter((v) => v !== target);
      selected = null;
    });
  }
  function layers(anchor) {
    const p = pop(anchor);
    p.append(el("strong", label("重なり — 上が前面", "Layers — front first")));
    for (const entry of [...graphicOrder(block().content)].reverse()) {
      const o = entry.legacy || entry, row = el("div", null, "graphic-layer-row");
      row.draggable = true;
      row.ondragstart = (e) => e.dataTransfer.setData("text/dsf-layer", entry.id || `legacy:${entry.index}`);
      row.ondragover = (e) => e.preventDefault();
      row.ondrop = (e) => {
        e.preventDefault();
        const source = e.dataTransfer.getData("text/dsf-layer");
        change((c) => {
          const src = source.startsWith("legacy:") ? c.bubbles[Number(source.split(":")[1])]?.id : source;
          const dst = entry.id || c.bubbles[entry.index]?.id;
          if (src === dst || !c.objectOrder.includes(src)) return;
          c.objectOrder = c.objectOrder.filter((v) => v !== src);
          c.objectOrder.splice(c.objectOrder.indexOf(dst) + 1, 0, src);
        });
      };
      const name = el("button", o.name || o.text?.slice(0, 18) || label("吹き出し", "Speech"));
      name.title = label("選択 / ダブルクリックで名前変更", "Select / double-click to rename");
      name.onclick = () => {
        if (entry.legacy) {
          selected = null;
          selectLegacy(entry.index);
        } else {
          selected = o.id;
          state.activeBubbleIdx = null;
          refresh();
        }
      };
      name.ondblclick = () => {
        const value = prompt(label("名前", "Name"), o.name || "");
        if (value?.trim()) change((c) => {
          const dest = entry.legacy ? c.bubbles[entry.index] : c.graphicObjects.find((v) => v.id === o.id);
          dest.name = value.trim().slice(0, 512);
        });
      };
      row.append(name);
      const edit = (fn) => change((c) => fn(entry.legacy ? c.bubbles[entry.index] : c.graphicObjects.find((v) => v.id === o.id)));
      button(row, o.visible === false ? "visibility_off" : "visibility", label("表示切替", "Toggle visibility"), () => edit((v) => v.visible = v.visible === false));
      button(row, o.locked ? "lock" : "lock_open", label("ロック切替", "Toggle lock"), () => edit((v) => v.locked = !v.locked));
      p.append(row);
    }
    p.append(el("small", label("背景（固定） · ドラッグで重なりを変更", "Background (fixed) · Drag to reorder")));
  }
  function ensure() {
    if (root) return;
    root = el("div", null, "graphic-toolbar");
    root.id = "graphic-toolbar";
    (document.querySelector(".ribbon-panel-row") || document.querySelector("#editor-main")).append(root);
    window.addEventListener("resize", () => requestAnimationFrame(render));
    document.addEventListener("pointerdown", (e) => {
      if (popup && !popup.contains(e.target) && !root.contains(e.target)) closePopup();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closePopup();
      if (!object() || e.target.closest("input,textarea,select,[contenteditable=true]")) return;
      if (["Delete", "Backspace"].includes(e.key)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!object().locked) remove();
      }
    }, true);
  }
  function controls() {
    root.replaceChildren();
    button(root, "text_fields", label("テキストボックスを追加", "Add text box"), () => add("text"));
    const shapes = button(root, "category", label("図形を追加", "Add shape"), () => {
      const p = pop(shapes), grid = el("div", null, "graphic-shape-gallery");
      p.append(grid);
      for (const shape of GRAPHIC_SHAPES) {
        const b = el("button");
        b.innerHTML = `<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.7">${icons[shape]}</svg>`;
        b.title = label(...names[shape]);
        b.setAttribute("aria-label", b.title);
        b.onclick = () => add("shape", { shape, name: b.title });
        grid.append(b);
      }
    });
    button(root, "add_photo_alternate", label("画像を配置", "Place image"), () => upload());
    const layer = button(root, "layers", label("重なり一覧", "Layers"), () => layers(layer));
    tools = el("div", null, "graphic-object-tools");
    root.append(tools);
    const o = object();
    if (!o) {
      legacyControls();
      return;
    }
    root.dataset.selected = o.id;
    const caption = el("span", o.name, "graphic-object-name");
    caption.title = label("ダブルクリックで名前変更", "Double-click to rename");
    caption.ondblclick = () => {
      const name = prompt(label("名前", "Name"), o.name);
      if (name?.trim()) update((v) => v.name = name.trim().slice(0, 512));
    };
    tools.append(caption);
    if (o.kind !== "image") {
      for (const [prop, icon, title] of [["fill", "format_color_fill", label("塗りつぶし", "Fill")], ["stroke", "border_color", label("枠線", "Outline")], ["color", "format_color_text", label("文字色", "Text color")]]) {
        const b = button(tools, icon, title, () => palette(b, prop));
      }
      numeric(tools, label("線幅", "Line"), o.style.lineWidth, 0, 30, (v) => update((o2) => o2.style.lineWidth = v));
      if (!["line", "arrow"].includes(o.shape)) {
        const font = el("select");
        font.title = label("フォント", "Font");
        font.setAttribute("aria-label", font.title);
        for (const [v, ja, en] of [["serif", "明朝", "Serif"], ["sans-serif", "ゴシック", "Sans serif"]]) {
          const opt = el("option", label(ja, en));
          opt.value = v;
          font.append(opt);
        }
        font.value = o.style.fontFamily;
        font.onchange = () => update((o2) => o2.style.fontFamily = font.value);
        tools.append(font);
        numeric(tools, label("文字", "Size"), o.style.fontSize, 6, 200, (v) => update((o2) => o2.style.fontSize = v));
        for (const [prop, icon, ja, en] of [["bold", "format_bold", "太字", "Bold"], ["italic", "format_italic", "斜体", "Italic"], ["underline", "format_underlined", "下線", "Underline"]]) button(tools, icon, label(ja, en), () => update((o2) => o2.style[prop] = !o2.style[prop]), o.style[prop]);
        for (const [v, ja, en] of [["left", "先頭揃え", "Start"], ["center", "中央揃え", "Center"], ["right", "末尾揃え", "End"]]) button(tools, `format_align_${v}`, label(ja, en), () => update((o2) => o2.style.align = v), o.style.align === v);
        for (const [v, ja, en] of [["top", "上揃え", "Top"], ["center", "中央配置", "Middle"], ["bottom", "下揃え", "Bottom"]]) button(tools, `vertical_align_${v}`, label(ja, en), () => update((o2) => o2.style.valign = v), o.style.valign === v);
        button(tools, "text_rotation_down", label("縦書き／横書き", "Writing direction"), () => update((o2) => o2.style.writingMode = o2.style.writingMode === "vertical-rl" ? "horizontal-tb" : "vertical-rl"), o.style.writingMode === "vertical-rl");
        numeric(tools, label("余白", "Padding"), o.style.padding, 0, 200, (v) => update((o2) => o2.style.padding = v));
      }
    } else {
      button(tools, "image", label("画像を差し替え", "Replace image"), () => upload(true));
      numeric(tools, label("透明度 %", "Transparency %"), Math.round((1 - o.opacity) * 100), 0, 100, (v) => update((o2) => o2.opacity = 1 - v / 100));
      button(tools, "flip", label("左右反転", "Flip horizontal"), () => update((o2) => o2.flipX = !o2.flipX), o.flipX);
      button(tools, "flip_camera_android", label("上下反転", "Flip vertical"), () => update((o2) => o2.flipY = !o2.flipY), o.flipY);
      const crop = button(tools, "crop", label("切り抜き", "Crop"), () => {
        const p = pop(crop);
        p.append(el("strong", label("元画像内の範囲（%）", "Source region (%)")));
        for (const [prop, title] of [["x", "X"], ["y", "Y"], ["width", label("幅", "Width")], ["height", label("高さ", "Height")]]) numeric(p, title, Math.round(o.crop[prop] * 100), prop === "x" || prop === "y" ? 0 : 1, 100, (v) => update((o2) => {
          const c = { ...o2.crop, [prop]: v / 100 };
          if (c.x + c.width <= 1 && c.y + c.height <= 1) o2.crop = c;
        }));
        const reset = el("button", label("切り抜きを解除", "Reset crop"));
        reset.onclick = () => update((o2) => o2.crop = { x: 0, y: 0, width: 1, height: 1 });
        p.append(reset);
      });
    }
    const frame = getGraphicFrame(o, state.activeLang);
    numeric(tools, label("回転 °", "Rotate °"), frame.rotation, -180, 180, (v) => update((o2) => setFrame(o2, { ...getGraphicFrame(o2, state.activeLang), rotation: v })));
    button(tools, "flip_to_front", label("最前面へ", "Bring to front"), () => change((c) => {
      c.objectOrder = c.objectOrder.filter((v) => v !== selected);
      c.objectOrder.push(selected);
    }));
    button(tools, "flip_to_back", label("最背面へ", "Send to back"), () => change((c) => {
      c.objectOrder = c.objectOrder.filter((v) => v !== selected);
      c.objectOrder.unshift(selected);
    }));
    button(tools, "content_copy", label("複製", "Duplicate"), () => {
      const copy = structuredClone(o);
      copy.id = id();
      copy.name += " " + label("コピー", "copy");
      copy.frame.x += 12;
      copy.frame.y += 12;
      change((c) => {
        c.graphicObjects.push(copy);
        c.objectOrder.push(copy.id);
        selected = copy.id;
      });
    });
    button(tools, "delete", label("削除", "Delete"), () => {
      if (!o.locked) remove();
    });
    if (o.locked) tools.querySelectorAll("button,input,select").forEach((n) => n.disabled = true);
  }
  function legacyControls() {
    const index = state.activeBubbleIdx, b = block()?.content?.bubbles?.[index];
    if (!b) return;
    const mutate = (fn) => {
      if (b.locked) return;
      change((c) => fn(c.bubbles[index]));
    };
    for (const [prop, title] of [["fillColor", label("塗り", "Fill")], ["strokeColor", label("枠線", "Outline")], ["fontColor", label("文字色", "Text color")]]) {
      const input = el("input");
      input.type = "color";
      input.value = b[prop] || (prop === "fillColor" ? "#ffffff" : "#000000");
      input.title = title;
      input.setAttribute("aria-label", title);
      input.onchange = () => mutate((o) => o[prop] = input.value);
      tools.append(input);
    }
    const shape = el("select");
    shape.title = label("既存の吹き出し形状", "Legacy shape");
    const original = document.getElementById("prop-shape");
    if (original) {
      shape.innerHTML = original.innerHTML;
      shape.value = b.shape || "speech";
      shape.onchange = () => mutate((o) => o.shape = shape.value);
      tools.append(shape);
    }
    const text = button(tools, "edit", label("本文を編集", "Edit text"), () => {
      const p = pop(text), input = el("textarea");
      input.value = b.texts?.[state.activeLang] ?? b.text ?? "";
      input.rows = 5;
      p.append(input);
      const save = el("button", label("適用", "Apply"));
      save.onclick = () => mutate((o) => {
        o.texts ||= {};
        o.texts[state.activeLang] = input.value;
        o.text = input.value;
      });
      p.append(save);
      input.focus();
    });
    button(tools, "delete", label("削除", "Delete"), () => {
      if (b.locked) return;
      change((c) => {
        const target = c.bubbles[index].id;
        c.bubbles.splice(index, 1);
        c.objectOrder = c.objectOrder.filter((v) => v !== target);
        state.activeBubbleIdx = null;
      });
    });
  }
  function setFrame(o, f) {
    if (state.activeLang === state.defaultLang) o.frame = f;
    else {
      o.frames ||= {};
      o.frames[state.activeLang] = f;
    }
  }
  function attachHandle(hit, o) {
    const handle = el("span", null, "graphic-resize");
    handle.title = label("サイズ変更", "Resize");
    hit.append(handle);
    hit.onpointerdown = (e) => {
      if (e.button !== 0 || e.target.tagName === "TEXTAREA") return;
      e.preventDefault();
      e.stopPropagation();
      if (o.locked) return;
      selected = o.id;
      state.activeBubbleIdx = null;
      controls();
      document.body.classList.add("graphic-object-selected");
      document.querySelectorAll(".graphic-hit.selected").forEach((n) => n.classList.remove("selected"));
      hit.classList.add("selected");
      const f = { ...getGraphicFrame(o, state.activeLang) }, px = e.clientX, py = e.clientY, scale = hit.parentElement.getBoundingClientRect().width / 360, resize = e.target === handle, context = key();
      let next = f;
      hit.setPointerCapture(e.pointerId);
      hit.onpointermove = (ev) => {
        const dx = (ev.clientX - px) / scale, dy = (ev.clientY - py) / scale;
        if (resize) {
          const angle = f.rotation * Math.PI / 180, rx = dx * Math.cos(angle) + dy * Math.sin(angle), ry = -dx * Math.sin(angle) + dy * Math.cos(angle);
          const w = Math.max(1, Math.min(3600, f.width + rx)), h = o.kind === "image" ? w * f.height / f.width : Math.max(1, Math.min(6400, f.height + ry));
          next = { ...f, width: w, height: Math.min(6400, h) };
        } else next = { ...f, x: Math.max(-3600, Math.min(3600, f.x + dx)), y: Math.max(-6400, Math.min(6400, f.y + dy)) };
        Object.assign(hit.style, { left: next.x + "px", top: next.y + "px", width: next.width + "px", height: next.height + "px" });
      };
      hit.onpointerup = () => {
        hit.onpointermove = null;
        hit.onpointerup = null;
        if (key() !== context) return;
        if (JSON.stringify(f) !== JSON.stringify(next)) update((o2) => setFrame(o2, next));
      };
      hit.onpointercancel = () => {
        hit.onpointermove = null;
        refresh();
      };
    };
    hit.ondblclick = (e) => {
      if (o.kind === "image" || o.locked || ["line", "arrow"].includes(o.shape)) return;
      e.stopPropagation();
      const context = key(), text = el("textarea");
      text.value = o.texts[state.activeLang] ?? o.texts[state.defaultLang] ?? "";
      text.setAttribute("aria-label", label("オブジェクト本文", "Object text"));
      text.style.writingMode = o.style.writingMode;
      text.style.fontSize = o.style.fontSize + "px";
      text.style.color = o.style.color;
      text.oninput = () => {
        if (key() === context) editText(o.id, state.activeLang, text.value);
      };
      text.onpointerdown = (e2) => e2.stopPropagation();
      text.onkeydown = (e2) => e2.stopPropagation();
      text.onblur = () => {
        if (key() === context) finishText();
      };
      hit.append(text);
      text.focus();
    };
  }
  function render() {
    ensure();
    const host = innerWidth >= 1024 ? document.querySelector(".ribbon-panel-row") : document.getElementById("editor-room");
    if (root.parentElement !== host) {
      if (innerWidth >= 1024) host.append(root);
      else host.insertBefore(root, document.getElementById("workspace"));
    }
    const fixed = block()?.kind === "page";
    document.body.classList.toggle("graphic-page-context", fixed);
    ++sequence;
    root.hidden = !fixed;
    const context = key();
    if (pageKey !== context) {
      closePopup();
      pageKey = context;
    }
    if (state.activeBubbleIdx != null) selected = null;
    if (!object()) selected = null;
    document.body.classList.toggle("graphic-object-selected", !!selected || !!block()?.content?.bubbles?.[state.activeBubbleIdx]);
    if (!fixed) return;
    controls();
    if (!canEdit()) root.querySelectorAll("button,input,select").forEach((n) => n.disabled = true);
    const layer = document.getElementById("bubble-layer");
    if (!layer) return;
    layer.querySelectorAll(".graphic-paint,.graphic-hit").forEach((n) => n.remove());
    const ordered = graphicOrder(block().content);
    if (ordered.some((o) => !o.legacy)) layer.style.display = "block";
    const token = ++sequence;
    for (const [i, o] of ordered.entries()) {
      if (o.legacy) {
        const legacy = layer.querySelector(`#bubble-svg-${o.index}`);
        if (legacy) {
          legacy.style.zIndex = String((i + 1) * 2);
          legacy.style.display = o.legacy.visible === false ? "none" : "";
          legacy.style.pointerEvents = o.legacy.locked ? "none" : "";
        }
        continue;
      }
      if (!o.visible) continue;
      renderGraphicLayerCanvas(o, state.projectAssets || [], state.activeLang, state.defaultLang).then((c) => {
        if (sequence !== token) return;
        c.className = "graphic-paint";
        c.style.zIndex = String((i + 1) * 2);
        layer.append(c);
      }).catch(() => {
        if (sequence === token && !root.querySelector("[role=alert]")) {
          const note = el("span", label("画像を表示できません。再読込してください。", "Unable to show image. Please reload."));
          note.setAttribute("role", "alert");
          root.append(note);
        }
      });
      const f = getGraphicFrame(o, state.activeLang), hit = el("div", null, "graphic-hit" + (o.id === selected ? " selected" : ""));
      hit.dataset.objectId = o.id;
      Object.assign(hit.style, { left: f.x + "px", top: f.y + "px", width: f.width + "px", height: f.height + "px", transform: `rotate(${f.rotation}deg)`, zIndex: String((i + 1) * 2 + 1), pointerEvents: o.locked || !canEdit() ? "none" : "auto" });
      layer.append(hit);
      attachHandle(hit, o);
    }
  }
  return { render, placeAsset, upload, addText: () => add("text") };
}
export {
  createStudioObjectToolbar
};
