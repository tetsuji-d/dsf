const { chromium } = require(process.env.DSF_PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
(async () => {
  const b = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const p = await b.newPage({ viewport: { width: 1600, height: 1e3 } }), errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("dialog", async (d) => {
      console.log("DIALOG", d.message());
      await d.dismiss();
    });
    await p.goto("http://127.0.0.1:5178/studio?room=editor");
    await p.waitForFunction(() => typeof window.changeBlock === "function");
    await p.evaluate(async () => {
      const { state } = await import("/js/state.js");
      state.blocks = [{ id: "a", kind: "page", content: { pageKind: "image", bubbles: [] } }, { id: "b", kind: "page", content: { pageKind: "image", bubbles: [] } }];
      state.sections = (await import("/js/blocks.js")).extractSectionsFromBlocks(state.blocks);
      Object.assign(state, { activeBlockIdx: 0, activeIdx: 0, activeBubbleIdx: null, defaultLang: "ja", activeLang: "ja", languages: ["ja"], projectAssets: [], localProjectId: "test", projectId: null, version: 6, bookMode: "none", book: { mode: "none" } });
      window.setStudioUILang("en");
      window.changeBlock(0);
    });
    assert.equal(await p.locator('#flow-image-insert,#fab-add-bubble').count(),0);
    const openPasteMenu=()=>p.locator('#canvas-stage').click({button:'right',position:{x:20,y:40}});
    const menuCount=()=>p.locator('.graphic-context-menu').count();
    await openPasteMenu();assert.equal(await menuCount(),1);
    await p.locator('#canvas-stage').evaluate(e=>{
      e.addEventListener('pointerdown',event=>event.stopPropagation(),{once:true});
      e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    });assert.equal(await menuCount(),0);
    await openPasteMenu();await p.keyboard.press('Escape');assert.equal(await menuCount(),0);
    await openPasteMenu();await p.locator('#canvas-view').dispatchEvent('scroll');assert.equal(await menuCount(),0);
    await openPasteMenu();await p.locator('#ribbon-print').click({button:'right'});assert.equal(await menuCount(),0);
    console.log('Context menu closes after stopped pointer events, Escape, scroll and another right click');
    await p.getByRole("button", { name: "Add shape", exact: true }).click();
    await p.getByRole("button", { name: "Ellipse", exact: true }).click();
    assert.equal(await p.locator(".graphic-resize").count(), 4);
    await p.evaluate(async()=>{(await import('/js/firebase.js')).triggerAutoSave();});
    assert.match(await p.locator('#save-status').textContent(),/Unsaved/);
    await p.evaluate(()=>window.setStudioUILang('ja'));
    assert.match(await p.locator('#save-status').textContent(),/未保存/);
    await p.evaluate(()=>window.setStudioUILang('en'));
    await p.waitForFunction(()=>document.getElementById('save-status').dataset.saveStatus==='saved');
    assert.match(await p.locator('#save-status').textContent(),/Saved \(Local\)/);

    const read = () => p.evaluate(async () => JSON.parse(JSON.stringify((await import("/js/state.js")).state.blocks)));
    await p.locator(".graphic-hit").click();
    await p.keyboard.press("Control+c");
    await p.evaluate(() => window.changeBlock(1));
    await p.locator("#canvas-stage").click({ button: "right", position: { x: 20, y: 40 } });
    await p.getByRole("menuitem", { name: "Paste", exact: true }).click();
    assert.deepEqual((await read()).map((b2) => b2.content.graphicObjects?.length || 0), [1, 1]);
    assert.deepEqual((await read())[0].content.graphicObjects[0].frame, (await read())[1].content.graphicObjects[0].frame);
    await p.locator(".graphic-hit").click();
    await p.keyboard.press("Control+x");
    await p.evaluate(() => window.changeBlock(0));
    await p.locator("#canvas-stage").click({ position: { x: 20, y: 40 } });
    await p.keyboard.press("Control+v");
    assert.deepEqual((await read()).map((b2) => b2.content.graphicObjects?.length || 0), [2, 0]);
    await p.locator("#btn-undo").click();
    assert.deepEqual((await read()).map((b2) => b2.content.graphicObjects?.length || 0), [1, 1]);
    console.log("EN + keyboard/menu copy, cut paste, geometry and atomic Undo passed");
    await p.evaluate(() => window.changeBlock(0));
    await p.locator(".graphic-hit").click();
    const before = (await read())[0].content.graphicObjects[0].frame;
    const h = await p.locator(".graphic-resize[data-corner=nw]").boundingBox();
    await p.mouse.move(h.x + 4, h.y + 4);
    await p.mouse.down();
    await p.mouse.move(h.x - 25, h.y - 25, { steps: 5 });
    await p.mouse.up();
    const after = (await read())[0].content.graphicObjects[0].frame;
    assert.ok(after.width > before.width);
    assert.ok(Math.abs(after.x + after.width - before.x - before.width) < 0.01);
    await p.locator("#btn-undo").click();
    console.log("Opposite-corner resize anchor passed");
    const popup = p.waitForEvent("popup");
    await p.locator("#btn-editor-preview").click();
    const viewer = await popup;
    viewer.on("pageerror", (e) => errors.push(e.message));
    viewer.on("dialog", async (d) => {
      console.log("VIEWER", d.message());
      await d.dismiss();
    });
    await viewer.waitForSelector(".viewer-page-image", { timeout: 6e4 });
    assert.ok(await viewer.locator(".viewer-page-image").count());
    console.log("Unsaved Fixed page -> actual Viewer passed");
    await viewer.close();
    assert.deepEqual(errors, []);
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
