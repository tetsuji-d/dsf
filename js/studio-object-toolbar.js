import { initializeGraphicObjects, createGraphicObject, graphicOrder, GRAPHIC_SHAPES } from "./graphic-object-model.js";
import { renderGraphicLayerCanvas, getGraphicFrame } from "./graphic-object-renderer.js";
import "../css/studio-object-toolbar.css";
import { getUILang } from "./i18n-studio.js";
import { resizeGraphicFrame, rotateGraphicFrame, cropGraphicFrame, clamp } from "./graphic-object-geometry.js";
const el = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
const icons = { rect: '<rect x="3" y="5" width="22" height="17"/>', roundRect: '<rect x="3" y="5" width="22" height="17" rx="5"/>', ellipse: '<ellipse cx="14" cy="14" rx="11" ry="9"/>', line: '<path d="M3 23L25 4"/>', arrow: '<path d="M3 23L25 4M14 4H25V15"/>', speech: '<path d="M3 4H25V20H12L5 25V20H3Z"/>' };
const names = { rect: ["四角形", "Rectangle"], roundRect: ["角丸四角形", "Rounded rectangle"], ellipse: ["楕円", "Ellipse"], line: ["直線", "Line"], arrow: ["矢印", "Arrow"], speech: ["吹き出し", "Speech"] };
function createStudioObjectToolbar({ state, commit, refresh, prepareImage, selectLegacy, canEdit, editText, finishText, commitBlocks, activateAt, flow }) {
  const fixedCommit=commit,fixedCanEdit=canEdit;
  commit=fn=>flow?.active()?flow.commit(fn):fixedCommit(fn);
  canEdit=()=>flow?.active()?flow.canEdit():fixedCanEdit();
  let selected = null, pageKey = "", root, tools, popup, busy = false, sequence = 0, clipboard = null, cropCleanup = null;
  const label = (ja, en) => getUILang() === "en" ? en : ja;
  const key = () => [state.projectId, state.localProjectId, state.uid, state.activeBlockIdx, state.activeLang].join("|");
  const block = () => flow?.active() ? flow.asBlock() : state.blocks?.[state.activeBlockIdx];
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
    cropCleanup?.();
    cropCleanup = null;
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
  const projectKey = () => [state.uid, state.projectId, state.localProjectId].join("|");
  function copy(cut = false) {
    const o = object();
    if (flow?.active() || !o || cut && o.locked) return;
    clipboard = { project: projectKey(), source: block().id, object: structuredClone(o), cut, signature: JSON.stringify(o) };
    closePopup();
  }
  function canPaste() {
    return !flow?.active() && clipboard?.project === projectKey() && block()?.kind === "page" && canEdit() && (!clipboard.cut || state.blocks.some((b) => b.id === clipboard.source && b.content?.graphicObjects?.some((o) => o.id === clipboard.object.id && !o.locked && JSON.stringify(o) === clipboard.signature)));
  }
  function paste() {
    if (!canPaste()) return;
    const clip = clipboard, target = block().id, newId = id();
    const ok = commitBlocks?.((blocks) => {
      const dest = blocks.find((b) => b.id === target);
      initializeGraphicObjects(dest.content, id);
      if (clip.cut) {
        const src = blocks.find((b) => b.id === clip.source);
        src.content.graphicObjects = src.content.graphicObjects.filter((o) => o.id !== clip.object.id);
        src.content.objectOrder = src.content.objectOrder.filter((v) => v !== clip.object.id);
      }
      dest.content.graphicObjects.push({ ...structuredClone(clip.object), id: newId });
      dest.content.objectOrder.push(newId);
    });
    if (ok) {
      selected = newId;
      state.activeBubbleIdx = null;
      if (clip.cut) clipboard = null;
      refresh();
    }
    closePopup();
  }
  function duplicate() {
    const o = object();
    if (!o || o.locked) return;
    const copy2 = structuredClone(o);
    copy2.id = id();
    copy2.name += " " + label("コピー", "copy");
    for (const f of [copy2.frame, ...Object.values(copy2.frames || {})]) {
      f.x = clamp(f.x + 12, -3600, 3600);
      f.y = clamp(f.y + 12, -6400, 6400);
    }
    change((c) => {
      c.graphicObjects.push(copy2);
      c.objectOrder.push(copy2.id);
      selected = copy2.id;
    });
  }
  function order(direction) {
    if (!object() || object().locked) return;
    change((c) => {
      const i = c.objectOrder.indexOf(selected);
      c.objectOrder.splice(i, 1);
      const at = direction === "top" ? c.objectOrder.length : direction === "bottom" ? 0 : direction === "up" ? Math.min(i + 1, c.objectOrder.length) : Math.max(0, i - 1);
      c.objectOrder.splice(at, 0, selected);
    });
  }
  function resetImage() {
    update((o) => {
      o.crop = { x: 0, y: 0, width: 1, height: 1 };
      o.flipX = false;
      o.flipY = false;
      setFrame(o, { ...getGraphicFrame(o, state.activeLang), rotation: 0 });
    });
  }
  function contextMenu(x, y, pageOnly = false) {
    const anchor = { getBoundingClientRect: () => ({ left: x, bottom: y }) }, p = pop(anchor), context = key(), target = selected;
    p.classList.add("graphic-context-menu");
    p.setAttribute("role", "menu");
    const add2 = (ja, en, run, disabled = false) => {
      const b = el("button", label(ja, en));
      b.setAttribute("role", "menuitem");
      b.disabled = disabled;
      b.onclick = () => {
        if (key() !== context || selected !== target) {
          closePopup();
          return;
        }
        run();
        closePopup();
      };
      p.append(b);
    };
    const sep = () => p.append(el("hr"));
    const o = pageOnly ? null : object();
    if (o) {
      if(!flow?.active()){
        add2("切り取り", "Cut", () => copy(true), o.locked);
        add2("コピー", "Copy", () => copy(false));sep();
      }
      if (o.kind === "image") {
        add2("トリミング", "Crop", () => {
          closePopup();
          openCrop();
        }, o.locked);
        p.lastChild.onclick = () => {
          if (key() === context && selected === target) {
            closePopup();
            openCrop();
          }
        };
        add2("左右反転", "Flip horizontal", () => update((v) => v.flipX = !v.flipX), o.locked);
        sep();
      }
      if(!flow?.active()){
      const i = block().content.objectOrder.indexOf(o.id), last = block().content.objectOrder.length - 1;
      add2("最前面に移動", "Bring to front", () => order("top"), o.locked || i === last);
      add2("前面に移動", "Bring forward", () => order("up"), o.locked || i === last);
      add2("背面に移動", "Send backward", () => order("down"), o.locked || i === 0);
      add2("最背面に移動", "Send to back", () => order("bottom"), o.locked || i === 0);
      }
      if (o.kind === "image") {
        sep();
        add2("画像のリセット", "Reset image", resetImage, o.locked);
        add2("画像の差し替え", "Replace image", () => upload(true), o.locked);
      }
      sep();
      if(!flow?.active())add2("複製", "Duplicate", duplicate, o.locked);
      add2("削除", "Delete", remove, o.locked);
    } else add2("貼り付け", "Paste", paste, !canPaste());
    const rect = p.getBoundingClientRect();
    p.style.top = clamp(y, 6, innerHeight - rect.height - 6) + "px";
    const choices = [...p.querySelectorAll("button:not(:disabled)")];
    choices[0]?.focus({ preventScroll: true });
    p.onkeydown = (e) => {
      if (["ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        const i = choices.indexOf(document.activeElement);
        choices[(i + (e.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length]?.focus();
      }
    };
  }
  function openCrop() {
    const o = object();
    if (!o || o.kind !== "image" || o.locked) return;
    const context = key(), target = o.id, source = state.projectAssets.find((a) => a.id === o.assetId);
    if (!source) return;
    const p = pop(root);
    p.classList.add("graphic-crop-popup", "graphic-crop-inline-controls");
    p.setAttribute("role", "dialog");
    p.setAttribute("aria-label", label("画像のトリミング", "Crop image"));
    p.append(el("strong", label("トリミング", "Crop image")), el("small", label("黒いハンドルで範囲を変更。枠内をドラッグして構図を調整します。", "Drag black handles to crop. Drag inside the frame to adjust the composition.")));
    const stage = el("div", null, "graphic-crop-stage"), img = el("img");
    img.src = source.background;
    img.alt = "";
    img.draggable = false;
    stage.append(img);
    const layer = flow?.active() ? flow.layer(selected) : document.getElementById("bubble-layer"), f = getGraphicFrame(o, state.activeLang), sx = f.width / o.crop.width, sy = f.height / o.crop.height;
    if (!layer) {
      closePopup();
      return;
    }
    const overlay = el("div", null, "graphic-crop-overlay");
    Object.assign(overlay.style, { left: f.x + f.width / 2 + "px", top: f.y + f.height / 2 + "px", transform: `rotate(${f.rotation}deg) scale(${o.flipX ? -1 : 1},${o.flipY ? -1 : 1})` });
    Object.assign(stage.style, { width: sx + "px", height: sy + "px", left: -o.crop.x * sx - f.width / 2 + "px", top: -o.crop.y * sy - f.height / 2 + "px" });
    overlay.append(stage);
    layer.append(overlay);
    const paintLayer = layer.querySelector(`.graphic-paint[data-object-id="${o.id}"]`), oldVisibility = paintLayer?.style.visibility;
    if (paintLayer) paintLayer.style.visibility = "hidden";
    cropCleanup = () => {
      overlay.remove();
      if (paintLayer) paintLayer.style.visibility = oldVisibility;
    };
    let crop = { ...o.crop }, pan = {x:0,y:0};
    const frame = el("div", null, "graphic-crop-frame");
    stage.append(frame);
    for (const k of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
      const h = el("span", null, "graphic-crop-handle");
      h.dataset.corner = k;
      h.title = label("切り抜き範囲", "Crop bounds");
      frame.append(h);
    }
    const paint = () => {
      Object.assign(frame.style,{left:crop.x*100+'%',top:crop.y*100+'%',width:crop.width*100+'%',height:crop.height*100+'%'});
      stage.style.left=(-o.crop.x*sx-f.width/2-pan.x*sx)+'px';
      stage.style.top=(-o.crop.y*sy-f.height/2-pan.y*sy)+'px';
    };
    paint();
    frame.onpointerdown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const start = { ...crop }, startPan={...pan}, x = e.clientX, y = e.clientY, scale = layer.getBoundingClientRect().width / 360, k = e.target.dataset.corner;
      frame.setPointerCapture(e.pointerId);
      frame.onpointermove = (ev) => {
        const a = f.rotation * Math.PI / 180, px = (ev.clientX - x) / scale, py = (ev.clientY - y) / scale, dx = (px * Math.cos(a) + py * Math.sin(a)) / sx * (o.flipX ? -1 : 1), dy = (-px * Math.sin(a) + py * Math.cos(a)) / sy * (o.flipY ? -1 : 1);
        let c = { ...start };
        if (!k) {
          c.x = clamp(start.x - dx, 0, 1 - start.width);
          c.y = clamp(start.y - dy, 0, 1 - start.height);
          pan={x:startPan.x+c.x-start.x,y:startPan.y+c.y-start.y};
        } else {
          if (k.includes("w")) {
            c.x = clamp(start.x + dx, 0, start.x + start.width - 0.01);
            c.width = start.x + start.width - c.x;
          }
          if (k.includes("e")) c.width = clamp(start.width + dx, 0.01, 1 - start.x);
          if (k.includes("n")) {
            c.y = clamp(start.y + dy, 0, start.y + start.height - 0.01);
            c.height = start.y + start.height - c.y;
          }
          if (k.includes("s")) c.height = clamp(start.height + dy, 0.01, 1 - start.y);
        }
        crop = c;
        paint();
      };
      frame.onpointerup = () => {
        frame.onpointermove = null;
      };
      frame.onpointercancel = () => {
        frame.onpointermove = null;
        crop = start;pan=startPan;
        paint();
      };
    };
    const done = el("button", label("適用", "Apply")), cancel = el("button", label("取消", "Cancel"));
    done.onclick = () => {
      if (key() !== context || selected !== target) {
        closePopup();
        return;
      }
      update((v) => {
        const f2 = getGraphicFrame(v, state.activeLang);
        const next = cropGraphicFrame(f2, v.crop, {...crop,x:crop.x-pan.x,y:crop.y-pan.y}, v.flipX, v.flipY);
        if (next.width < 1 || next.height < 1 || next.width > 3600 || next.height > 6400) return;
        setFrame(v, next);
        v.crop = { ...crop };
      });
    };
    cancel.onclick = closePopup;
    p.append(done, cancel);
    p.onkeydown = (e) => {
      if (e.key === "Enter" && !e.target.closest("button")) done.click();
    };
    done.focus({ preventScroll: true });
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
    document.addEventListener("studio-ui-language-change", () => {
      closePopup();
      render();
    });
    window.addEventListener("resize", () => requestAnimationFrame(render));
    document.addEventListener("contextmenu", (e) => {
      if (e.target.closest(".graphic-hit,input,textarea,[contenteditable=true]")) return;
      if (!e.target.closest('#canvas-stage,[data-testid="editor-fixed-page"]')) return;
      if (activateAt?.(e.target) === false || block()?.kind !== "page") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      selected = null;
      controls();
      contextMenu(e.clientX, e.clientY, true);
    }, true);
    document.addEventListener("pointerdown", (e) => {
      if (popup && !popup.contains(e.target) && !root.contains(e.target) && !e.target.closest(".graphic-crop-overlay")) closePopup();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closePopup();
      if (e.target.closest("input,textarea,select,[contenteditable=true]") || !canEdit()) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "v" && canPaste()) {
          e.preventDefault();
          e.stopImmediatePropagation();
          paste();
          return;
        }
        if (!flow?.active() && (k === "c" || k === "x") && object() && !getSelection()?.toString()) {
          e.preventDefault();
          e.stopImmediatePropagation();
          copy(k === "x");
          return;
        }
      }
      if (!object()) return;
      if (e.key === "ContextMenu" || e.shiftKey && e.key === "F10") {
        e.preventDefault();
        const r = document.querySelector(".graphic-hit.selected")?.getBoundingClientRect();
        if (r) contextMenu(r.left, r.top);
        return;
      }
      if (["Delete", "Backspace"].includes(e.key)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!object().locked) remove();
      }
    }, true);
  }
  function controls() {
    root.replaceChildren();
    if(!flow?.active()) button(root, "text_fields", label("テキストボックスを追加", "Add text box"), () => add("text"));
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
    const layer = !flow?.active() && button(root, "layers", label("重なり一覧", "Layers"), () => layers(layer));
    tools = el("div", null, "graphic-object-tools");
    root.append(tools);
    const o = object();
    if(flow?.active())flow.controls(root,tools,selected,id=>{selected=id;render();},button,pop,numeric);
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
        const chip = el("span", null, "graphic-color-chip");
        chip.style.background = o.style[prop];
        chip.style.opacity = prop === "color" ? 1 : o.style[prop + "Opacity"];
        b.append(chip);
        b.title = title + " · " + o.style[prop] + (prop !== "color" ? " · " + Math.round(o.style[prop + "Opacity"] * 100) + "%" : "");
      }
      numeric(tools, label("線幅", "Line"), o.style.lineWidth, 0, 30, (v) => update((o2) => o2.style.lineWidth = v));
      if (!flow?.active() && !["line", "arrow"].includes(o.shape)) {
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
      button(tools, "crop", label("トリミング", "Crop"), openCrop);
      button(tools, "restore", label("画像のリセット", "Reset image"), resetImage);
    }
    const frame = getGraphicFrame(o, state.activeLang);
    numeric(tools, label("回転 °", "Rotate °"), frame.rotation, -180, 180, (v) => update((o2) => setFrame(o2, { ...getGraphicFrame(o2, state.activeLang), rotation: v })));
    if(!flow?.active()) button(tools, "flip_to_front", label("最前面へ", "Bring to front"), () => order("top"));
    if(!flow?.active()) button(tools, "flip_to_back", label("最背面へ", "Send to back"), () => order("bottom"));
    if(!flow?.active()) button(tools, "content_copy", label("複製", "Duplicate"), duplicate);
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
    for (const corner of ["nw", "ne", "sw", "se"]) {
      const handle = el("span", null, "graphic-resize");
      handle.dataset.corner = corner;
      handle.title = label("サイズ変更", "Resize");
      hit.append(handle);
    }
    const rotation = el("span", "↻", "graphic-rotate");
    rotation.title = label("回転（Shiftで15°刻み）", "Rotate (Shift: 15° steps)");
    hit.append(rotation);
    hit.tabIndex = 0;
    hit.setAttribute("aria-label", o.name);
    hit.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      selected = o.id;
      state.activeBubbleIdx = null;
      controls();
      contextMenu(e.clientX, e.clientY);
    };
    hit.onpointerdown = (e) => {
      if (e.button !== 0 || e.target.tagName === "TEXTAREA") return;
      e.preventDefault();
      e.stopPropagation();
      if (o.locked) return;
      getSelection()?.removeAllRanges();
      hit.focus({ preventScroll: true });
      selected = o.id;
      state.activeBubbleIdx = null;
      controls();
      document.body.classList.add("graphic-object-selected");
      document.querySelectorAll(".graphic-hit.selected").forEach((n) => n.classList.remove("selected"));
      hit.classList.add("selected");
      const f = { ...getGraphicFrame(o, state.activeLang) }, px = e.clientX, py = e.clientY, scale = hit.parentElement.getBoundingClientRect().width / 360, resize = e.target.dataset.corner, rotating = e.target === rotation, context = key();
      const box = hit.getBoundingClientRect(), cx = box.x + box.width / 2, cy = box.y + box.height / 2, startAngle = Math.atan2(py - cy, px - cx);
      let next = f;
      hit.setPointerCapture(e.pointerId);
      hit.onpointermove = (ev) => {
        const dx = (ev.clientX - px) / scale, dy = (ev.clientY - py) / scale;
        if (rotating) next = rotateGraphicFrame(f, startAngle, Math.atan2(ev.clientY - cy, ev.clientX - cx), ev.shiftKey);
        else if (resize) next = resizeGraphicFrame(f, resize, dx, dy, o.kind === "image" && !ev.shiftKey);
        else next = { ...f, x: clamp(f.x + dx, -3600, 3600), y: clamp(f.y + dy, -6400, 6400) };
        Object.assign(hit.style, { left: next.x + "px", top: next.y + "px", width: next.width + "px", height: next.height + "px", transform: `rotate(${next.rotation}deg)` });
        const paint = hit.parentElement.querySelector(`.graphic-paint[data-object-id="${o.id}"]`);
        if (paint) {
          const m = new DOMMatrix().translate(next.x + next.width / 2, next.y + next.height / 2).rotate(next.rotation).scale(next.width / f.width, next.height / f.height).rotate(-f.rotation).translate(-f.x - f.width / 2, -f.y - f.height / 2);
          paint.style.transformOrigin = "0 0";
          paint.style.transform = m.toString();
        }
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
      if (flow?.active() || o.kind === "image" || o.locked || ["line", "arrow"].includes(o.shape)) return;
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
    flow?.render({selected,attachHandle});
    if (!fixed) return;
    controls();
    if (!canEdit()) root.querySelectorAll("button,input,select").forEach((n) => n.disabled = true);
    if(flow?.active())return;
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
        c.dataset.objectId = o.id;
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
