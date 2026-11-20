// UI checks for the dev page (viewer/dev.html). Uses tests/harness.js.
(function () {
  const { test, ok, eq } = window.PLTest;
  const $ = (s) => document.querySelector(s);
  const waitFor = async (fn, ms = 15000, what = "condition") => {
    const t0 = Date.now();
    for (;;) {
      let v; try { v = fn(); } catch { v = null; }
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error("timed out waiting for " + what);
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  window.PLUi = { waitFor, $ };

  test("pdf renders", async () => {
    await waitFor(() => document.querySelectorAll(".page").length === 15, 30000, "15 pages");
    await waitFor(() => $('.page[data-p="1"] canvas'), 30000, "page 1 canvas");
    eq((window.__fake && window.__fake.errors) || [], [], "no page errors");
  });

  test("fake claude runtime is connected", async () => {
    ok(window.__fake, "fakes loaded");
    await waitFor(() => !$("#capBtn").disabled, 15000, "capture enabled (sample with images)");
    ok($("#aiWarn").hidden, "no 'Claude unavailable' warning");
    ok(await window.claude.use("db"), "db available");
  });

  // ---------- Task 4: block editor ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function mountEditor(mode) {
    const div = document.createElement("div");
    div.style.cssText = "width:420px";
    document.body.append(div);
    const store = window.PLStore.create({ db: mode === "db" ? await window.claude.use("db") : null, localKey: "uit" + Math.random(), legacyNotes: [] });
    const ui = window.PLNotesUI.mount(div, store, { onGotoPage() {}, onAskClaude() {}, assetUrl: (id) => "/_blob/" + id });
    const blockEl = (id) => div.querySelector('.nb[data-id="' + id + '"]');
    const edit = async (id) => { await waitFor(() => blockEl(id), 5000, "block " + id); blockEl(id).querySelector(".nb-body").click(); return waitFor(() => blockEl(id).querySelector("textarea"), 3000, "textarea"); };
    const type = (ta, v) => { ta.value = v; ta.dispatchEvent(new Event("input", { bubbles: true })); };
    return { div, store, ui, blockEl, edit, type };
  }
  const key = (ta, k, extra) => ta.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra }));

  test("inline $x^2$ renders as svg", async () => {
    const E = await mountEditor("local");
    const id = await E.ui.insert({ type: "text", text: "넓이 $x^2$" });
    await waitFor(() => E.blockEl(id) && E.blockEl(id).querySelector("mjx-container svg"), 15000, "inline svg");
  });

  test("math block renders without raw latex", async () => {
    const E = await mountEditor("local");
    const id = await E.ui.insert({ type: "math", text: "\\frac{a}{b}" });
    await waitFor(() => E.blockEl(id) && E.blockEl(id).querySelector("mjx-container svg"), 15000, "display svg");
    ok(!E.blockEl(id).textContent.includes("\\frac"), "raw latex hidden");
  });

  test("broken latex shows an error and keeps source", async () => {
    const E = await mountEditor("local");
    const id = await E.ui.insert({ type: "math", text: "\\frac{a" });
    await waitFor(() => E.blockEl(id) && E.blockEl(id).querySelector(".nb-err"), 15000, "error note");
    const ta = await E.edit(id);
    eq(ta.value, "\\frac{a");
  });

  test("Enter during Korean composition does not split the block", async () => {
    const E = await mountEditor("local");
    const id = await E.ui.insert({ type: "text", text: "가" });
    const ta = await E.edit(id);
    const n0 = E.store.blocks().length;
    key(ta, "Enter", { isComposing: true });
    await sleep(100);
    eq(E.store.blocks().length, n0, "composing Enter ignored");
    key(ta, "Enter", { isComposing: false });
    await waitFor(() => E.store.blocks().length === n0 + 1, 3000, "new block");
  });

  test("typing $$ in an empty block makes it a math block", async () => {
    const E = await mountEditor("local");
    const id = await E.ui.insert({ type: "text", text: "" });
    const ta = await E.edit(id);
    E.type(ta, "$$");
    await waitFor(() => E.store.blocks().find((b) => b.id === id).type === "math", 3000, "type math");
  });

  test("text block shows a live math preview while typing", async () => {
    const E = await mountEditor("local");
    const id = await E.ui.insert({ type: "text", text: "" });
    const ta = await E.edit(id);
    E.type(ta, "넓이는 $\\pi r^2$");
    await sleep(200);
    await waitFor(() => E.blockEl(id).querySelector(".nb-preview mjx-container svg"), 15000, "preview svg");
  });

  test("a block Claude writes appears without touching the one being edited", async () => {
    const E = await mountEditor("db");
    const id = await E.ui.insert({ type: "text", text: "A" });
    const ta = await E.edit(id);
    E.type(ta, "typing A");
    window.__fake.db.write("blocks/zz" + Date.now(), { type: "text", text: "from claude", order: 999, by: "claude", createdAt: "x", updatedAt: "x" });
    await waitFor(() => E.div.textContent.includes("from claude"), 5000, "remote block");
    ok(E.blockEl(id).querySelector("textarea") === ta, "same textarea");
    eq(ta.value, "typing A");
  });
})();
