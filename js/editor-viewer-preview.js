import { state } from "./state.js";
import { getUILang } from "./i18n-studio.js";
import { hasFlowGroups } from "./flow-project-model.js";
import { prepareProjectForSave } from "./project-persistence.js";
let working = false;
export async function openEditorViewerPreview() {
  if (working) return;
  const en = getUILang() === "en", nonce = crypto.randomUUID(), controller = new AbortController();
  const child = window.open("/viewer.html?editorPreview=" + nonce, "_blank");
  if (!child) {
    alert(en ? "Allow pop-ups to open the preview." : "プレビューを開くためポップアップを許可してください。");
    return;
  }
  const fields = () => ({ version: state.version, blocks: state.blocks, sections: state.sections, projectAssets: state.projectAssets, languages: state.languages, defaultLang: state.defaultLang, languageConfigs: state.languageConfigs, book: { mode: state.book?.mode || state.bookMode || "simple" }, bookMode: state.bookMode, title: state.title, meta: state.meta, projectId: state.projectId, localProjectId: state.localProjectId });
  const initial = JSON.stringify(fields()), languages = [...state.languages || [state.defaultLang || "ja"]];
  const check = () => {
    if (controller.signal.aborted || JSON.stringify(fields()) !== initial) throw new Error(controller.signal.aborted ? "PREVIEW_CANCELLED" : "PREVIEW_CHANGED");
  };
  let ready = false, blob = null, sent = false;
  const send = () => {
    if (!ready || !blob || sent) return;
    sent = true;
    child.postMessage({ type: "dsf-editor-preview-package", nonce, blob }, location.origin);
  };
  const receive = (e) => {
    if (e.source !== child || e.origin !== location.origin || e.data?.nonce !== nonce) return;
    if (e.data.type === "dsf-editor-preview-ready") {
      ready = true;
      send();
    }
    if (e.data.type === "dsf-editor-preview-loaded") cleanup();
  };
  const timer = setInterval(() => {
    if (child.closed) {
      controller.abort();
      cleanup();
    }
  }, 500);
  const deadline = setTimeout(() => {
    controller.abort();
    cleanup();
  }, 3e5);
  const cleanup = () => {
    clearInterval(timer);
    clearTimeout(deadline);
    window.removeEventListener("message", receive);
    blob = null;
  };
  window.addEventListener("message", receive);
  working = true;
  const dialog = document.createElement("dialog");
  dialog.className = "editor-preview-progress";
  const text = document.createElement("p");
  text.textContent = en ? "Preparing Viewer preview…" : "Viewerプレビューを準備中…";
  const cancel = document.createElement("button");
  cancel.textContent = en ? "Cancel" : "キャンセル";
  const abort = () => {
    controller.abort();
    child.close();
    cleanup();
  };
  cancel.onclick = abort;
  dialog.oncancel = abort;
  dialog.append(text, cancel);
  document.body.append(dialog);
  dialog.showModal();
  try {
    const project = prepareProjectForSave(structuredClone(fields()));
    if (hasFlowGroups(project)) {
      const { createEditorFlowPreview } = await import("./press.js");
      blob = await createEditorFlowPreview({ project, languages, signal: controller.signal, check, onProgress: () => check() });
    } else {
      const { buildDSF } = await import("./export.js");
      blob = await buildDSF({ preview: true, languages, check });
    }
    check();
    if (!(blob instanceof Blob)) throw new Error("PREVIEW_EMPTY");
    send();
  } catch (error) {
    if (import.meta.env.DEV) console.warn("[Editor preview]", error.code || error.message);
    if (!controller.signal.aborted) alert(en ? "Preview could not be prepared. Check the page composition, images and Flow layout. If you edited the project during preparation, try again." : "プレビューを準備できませんでした。ページ構成・画像・Flowの組版を確認してください。準備中に編集した場合はもう一度お試しください。");
    child.close();
    cleanup();
  } finally {
    working = false;
    dialog.remove();
  }
}
