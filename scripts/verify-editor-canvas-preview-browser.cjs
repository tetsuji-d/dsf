const { chromium } = require(process.env.DSF_PLAYWRIGHT_MODULE || "playwright"), assert = require("node:assert/strict");
(async () => {
  const b = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const p = await b.newPage({ viewport: { width: 1600, height: 1e3 } }), errors = [];
    p.on("console", (m) => {
      if (m.text().includes("[Editor preview]")) console.log(m.text());
    });
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("dialog", async (d) => {
      console.log("DIALOG", d.message());
      await d.dismiss();
    });
    await p.goto("http://127.0.0.1:5178/studio?room=editor");
    await p.waitForFunction(() => typeof window.changeBlock === "function");
    await p.evaluate(async () => {
      const { state } = await import("/js/state.js"), { createFlowGroupBlock } = await import("/js/flow-project-model.js");
      const c2 = document.createElement("canvas");
      c2.width = 360;
      c2.height = 640;
      c2.getContext("2d").fillRect(0, 0, 360, 640);
      const background = c2.toDataURL("image/webp");
      state.blocks = [{ id: "a", kind: "page", content: { pageKind: "image", background, bubbles: [] } }, createFlowGroupBlock({ id: "flow", sourceLanguage: "ja", writingMode: "vertical-rl", document: { sourceLanguage: "ja", sections: [{ id: "s", title: { ja: "試験" }, blocks: [{ id: "p", type: "paragraph", texts: { ja: "未保存のプレビューを確認します。".repeat(15) } }] }] } }), { id: "b", kind: "page", content: { pageKind: "image", background, bubbles: [] } }];
      state.sections = (await import("/js/blocks.js")).extractSectionsFromBlocks(state.blocks);
      Object.assign(state, { activeBlockIdx: 0, activeIdx: 0, activeBubbleIdx: null, defaultLang: "ja", activeLang: "ja", languages: ["ja"], projectAssets: [], localProjectId: "flow-preview-test", projectId: null, version: 6, bookMode: "none", book: { mode: "none" } });
      window.setStudioUILang("en");
      window.changeBlock(0);
    });
    await p.locator(".flow-canvas-page-slot[data-page-kind=flow]").first().waitFor();
    assert.ok(await p.locator(".flow-canvas-page-slot[data-joined-after=true]").count() > 0);
    const before = await p.evaluate(async () => (await import("/js/state.js")).state.blocks.map((b2) => b2.id));
    const caption = p.locator(".editor-canvas-drag-handle[data-editor-unit-id=flow]").first(), target = p.locator(".flow-canvas-page-slot[data-editor-unit-id=b]");
    const c = await caption.boundingBox(), t = await target.boundingBox();
    await p.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
    await p.mouse.down();
    await p.waitForTimeout(500);
    await p.mouse.move(t.x + Math.min(t.width - 20, 20), t.y + 40, { steps: 8 });
    await p.mouse.up();
    const after = await p.evaluate(async () => (await import("/js/state.js")).state.blocks.map((b2) => b2.id));
    assert.notDeepEqual(after, before);
    await p.locator("#btn-undo").click();
    assert.deepEqual(await p.evaluate(async () => (await import("/js/state.js")).state.blocks.map((b2) => b2.id)), before);
    console.log("Long press moved whole Flow and Undo restored it");
    await p.locator(".editor-canvas-boundary").first().click({ button: "right" });
    assert.ok(await p.locator("#context-menu button").count() > 0);
    await p.getByRole("button", { name: "Image page", exact: true }).click();
    assert.equal(await p.evaluate(async () => (await import("/js/state.js")).state.blocks.length), before.length + 1);
    await p.locator("#btn-undo").click();
    assert.deepEqual(await p.evaluate(async () => (await import("/js/state.js")).state.blocks.map((b2) => b2.id)), before);
    console.log("Flow mixed spread, long press and boundary insertion / Undo passed");
    const popup = p.waitForEvent("popup");
    await p.locator("#btn-editor-preview").click();
    const viewer = await popup;
    viewer.on("pageerror", (e) => errors.push(e.message));
    viewer.on("dialog", async (d) => {
      console.log("VIEWER", d.message());
      await d.dismiss();
    });
    await viewer.waitForSelector(".viewer-page-image", { timeout: 12e4 });
    console.log("Flow portable Viewer opened", await viewer.locator(".viewer-page-image").count());
    assert.deepEqual(errors, []);
    await viewer.close();
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
