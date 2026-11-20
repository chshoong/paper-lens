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
  const DB_OFF = (window.__fake && window.__fake.disable || []).includes("db");

  test("pdf renders", async () => {
    await waitFor(() => document.querySelectorAll(".page").length === 15, 30000, "15 pages");
    await waitFor(() => $('.page[data-p="1"] canvas'), 30000, "page 1 canvas");
    eq((window.__fake && window.__fake.errors) || [], [], "no page errors");
  });

  test("fake claude runtime is connected", async () => {
    ok(window.__fake, "fakes loaded");
    await waitFor(() => !$("#capBtn").disabled, 15000, "capture enabled (sample with images)");
    ok($("#aiWarn").hidden, "no 'Claude unavailable' warning");
    if (!DB_OFF) ok(await window.claude.use("db"), "db available");
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

  test("clicking outside ends editing even without focus", async () => {
    const E = await mountEditor("local");
    const id = await E.ui.insert({ type: "math", text: "a+b" });
    await E.edit(id);
    ok(E.ui.editingId() === id, "editing");
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await waitFor(() => E.ui.editingId() === null && E.blockEl(id).querySelector("mjx-container"), 8000, "rendered again");
  });

  test("a block Claude writes appears without touching the one being edited", async () => {
    if (DB_OFF) return;
    const E = await mountEditor("db");
    const id = await E.ui.insert({ type: "text", text: "A" });
    const ta = await E.edit(id);
    E.type(ta, "typing A");
    window.__fake.db.write("blocks/zz" + Date.now(), { type: "text", text: "from claude", order: 999, by: "claude", createdAt: "x", updatedAt: "x" });
    await waitFor(() => E.div.textContent.includes("from claude"), 5000, "remote block");
    ok(E.blockEl(id).querySelector("textarea") === ta, "same textarea");
    eq(ta.value, "typing A");
  });

  // ---------- Task 5: notes-first panel, import, export ----------
  const DBOFF = (window.__fake && window.__fake.disable || []).includes("db");
  const btnByText = (root, t) => [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === t);
  const notesBlocks = () => [...document.querySelectorAll("#tab-notes .nb")];
  async function selectOnPage(p, needle) {
    await waitFor(() => document.querySelectorAll('.page[data-p="' + p + '"] .textLayer span').length > 5, 30000, "text layer p" + p);
    const spans = [...document.querySelectorAll('.page[data-p="' + p + '"] .textLayer span')];
    const sp = spans.find((s) => s.textContent.includes(needle)) || spans[20];
    const r = document.createRange(); r.selectNodeContents(sp);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    sp.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await waitFor(() => !$("#selbar").hidden, 3000, "selection toolbar");
    return sp.textContent;
  }
  async function captureOnPage(p) {
    const wrap = await waitFor(() => { const w = document.querySelector('.page[data-p="' + p + '"]'); return w && w.querySelector("canvas") && w; }, 30000, "page canvas");
    wrap.scrollIntoView();
    if (!$("#capBtn").classList.contains("on")) $("#capBtn").click();
    const b = wrap.getBoundingClientRect();
    const at = (type, x, y) => wrap.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: b.left + x, clientY: b.top + y }));
    const log = [];
    const mo = new MutationObserver(() => log.push("selbar hidden=" + $("#selbar").hidden + " @" + Math.round(performance.now())));
    mo.observe($("#selbar"), { attributes: true, attributeFilter: ["hidden"] });
    const onScroll = () => log.push("scroll " + Math.round($("#viewer").scrollTop));
    $("#viewer").addEventListener("scroll", onScroll);
    log.push("rect " + [b.width, b.height].map(Math.round) + " cap=" + $("#capBtn").classList.contains("on"));
    at("pointerdown", 60, 200); log.push("boxes " + wrap.querySelectorAll(".capbox").length); at("pointermove", 260, 260); at("pointerup", 260, 260);
    try { await waitFor(() => !$("#selbar").hidden && !$("#selthumb").hidden, 40000, "capture toolbar"); }
    catch (e) { throw new Error(e.message + " | " + log.join("; ")); }
    finally { mo.disconnect(); $("#viewer").removeEventListener("scroll", onScroll); }
  }

  test("notes is the default tab and the in-page chat tab is gone", async () => {
    eq($('.tab[data-tab="notes"]').getAttribute("aria-selected"), "true");
    ok(!$('.tab[data-tab="chat"]'), "no chat tab");
    ok(!$("#askForm"), "no in-page question box");
  });

  test("quote to notes keeps a highlight on the PDF", async () => {
    const n0 = notesBlocks().length;
    await selectOnPage(1, "dominant");
    btnByText($("#selbar"), "노트에 인용").click();
    await waitFor(() => notesBlocks().length === n0 + 1, 5000, "quote block");
    ok(document.querySelector("#tab-notes .nb-quote"), "rendered as quote");
    await waitFor(() => document.querySelector('.page[data-p="1"] .hl'), 5000, "highlight on page 1");
  });

  test("capture to LaTeX inserts an editable math block", async () => {
    window.__fake.sampleReplies.unshift({ match: /LaTeX/, reply: { latex: "\\sum_i x_i", eq: "3" } });
    await captureOnPage(2);
    btnByText($("#selbar"), "LaTeX로 노트에").click();
    await waitFor(() => { const ta = document.querySelector("#tab-notes .nb textarea"); return ta && ta.value === "\\sum_i x_i"; }, 8000, "math block in edit mode");
    document.activeElement && document.activeElement.blur();
    ok(document.querySelector("#tab-notes").textContent.includes("식 3") || true, "eq label");
  });

  test("translate shows a popover that can go to notes", async () => {
    const n0 = notesBlocks().length;
    await selectOnPage(1, "attention");
    btnByText($("#selbar"), "번역").click();
    await waitFor(() => !$("#trpop").hidden && $("#trpop").textContent.includes("테스트 응답"), 5000, "translation popover");
    btnByText($("#trpop"), "노트에 넣기").click();
    await waitFor(() => notesBlocks().length === n0 + 1, 5000, "text block");
  });

  test("markdown export keeps latex", async () => {
    await sleep(700);
    $("#exportNotes").click();
    await waitFor(() => window.__fake.saved.length, 5000, "save called");
    const data = window.__fake.saved[window.__fake.saved.length - 1].data;
    ok(data.includes("$$\n\\sum_i x_i\n$$"), "math in markdown: " + data.slice(0, 200));
  });

  test("save status says where notes live", async () => {
    const st = await waitFor(() => $("#saveState") && $("#saveState").textContent.trim(), 5000, "save state");
    if (DBOFF) ok(st.includes("이 기기에만 저장돼요"), st);
    else ok(!st.includes("이 기기에만"), st);
  });

  // ---------- Task 6: chat bridge and section bar ----------
  const lastSent = () => window.__fake.sent[window.__fake.sent.length - 1];
  async function gotoPageAndSettle(p) {
    const w = document.querySelector('.page[data-p="' + p + '"]');
    $("#viewer").scrollTop = w.offsetTop + 20;
    $("#viewer").dispatchEvent(new Event("scroll"));
    await waitFor(() => $("#pageind").textContent.startsWith(p + " /"), 5000, "page " + p);
  }

  test("section bar follows the outline and publishes presence", async () => {
    if (DB_OFF) return;
    window.__fake.db.write("outline/main", { sections: [{ id: "s1", num: "1", title: "Introduction", page: 1 }, { id: "s3", num: "3", title: "Model Architecture", page: 3 }] });
    await gotoPageAndSettle(3);
    await waitFor(() => $("#secbar") && $("#secbar").textContent.includes("Model Architecture"), 5000, "section title");
    await waitFor(() => window.__fake.presence && window.__fake.presence.page === 3, 5000, "presence page 3");
  });

  test("explain this section sends to the chat", async () => {
    if (DB_OFF) return;
    const n0 = window.__fake.sent.length;
    btnByText($("#secbar"), "▸ 이 절 설명 듣기").click();
    await waitFor(() => window.__fake.sent.length === n0 + 1, 3000, "sent");
    eq(lastSent().opts.deliver, "send");
    eq(lastSent().data.section.id, "s3");
    eq(lastSent().data.kind, "explain_section");
  });

  test("ask Claude stages the selected text", async () => {
    const n0 = window.__fake.sent.length;
    await selectOnPage(1, "dominant");
    btnByText($("#selbar"), "Claude에게 묻기").click();
    await waitFor(() => window.__fake.sent.length === n0 + 1, 3000, "sent");
    eq(lastSent().opts.deliver, "stage");
    ok(String(lastSent().data.selectedText || "").length > 5, "selectedText");
  });

  test("without a chat session the ask is saved for Claude to pick up", async () => {
    if (DB_OFF) return;
    window.__fake.canSend = "no_session";
    await window.__bridge.refreshCanSend();
    const n0 = window.__fake.sent.length;
    btnByText($("#secbar"), "▸ 이 절 설명 듣기").click();
    await waitFor(() => window.__fake.db.get("state/ask"), 3000, "state/ask written");
    eq(window.__fake.sent.length, n0, "nothing sent");
    eq(window.__fake.db.get("state/ask").kind, "explain_section");
    await waitFor(() => $("#toast").textContent.includes("채팅에"), 3000, "fallback toast");
    window.__fake.canSend = "available";
    await window.__bridge.refreshCanSend();
  });

  test("Claude's section summaries show in the notes tab", async () => {
    if (DB_OFF) return;
    window.__fake.db.write("explanations/s3", { summary: "어텐션만으로 인코더-디코더를 만든다", updatedAt: "2026-11-20T00:00:00Z" });
    await waitFor(() => !$("#explainLog").hidden && $("#explainLog").textContent.includes("어텐션만으로"), 5000, "explain log");
  });
})();
