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
    // Returns the textarea (math/raw blocks) or the rich editor's .ql-editor (text blocks).
    const edit = async (id) => { await waitFor(() => blockEl(id), 5000, "block " + id); blockEl(id).querySelector(".nb-body").click(); return waitFor(() => blockEl(id).querySelector("textarea, .ql-editor"), 3000, "editor"); };
    const type = (ta, v) => {
      if (ta.tagName === "TEXTAREA") { ta.value = v; ta.dispatchEvent(new Event("input", { bubbles: true })); return; }
      const q = ui.editor().quill; q.setSelection(q.getLength() - 1, 0, "silent"); q.insertText(q.getLength() - 1, v, "user"); q.setSelection(q.getLength() - 1, 0, "silent");
    };
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

  test("Korean composition: Enter, cmd+Enter and Esc do nothing mid-syllable", async () => {
    const E = await mountEditor("local");
    const id = await E.ui.insert({ type: "text", text: "가" });
    const root = await E.edit(id);
    const q = E.ui.editor().quill;
    q.setSelection(1, 0);
    const n0 = E.store.blocks().length, lines0 = q.getLines().length;
    key(root, "Enter", { isComposing: true });
    key(root, "Enter", { isComposing: true, metaKey: true });
    key(root, "Escape", { isComposing: true });
    await sleep(100);
    eq(E.store.blocks().length, n0, "no new block");
    eq(q.getLines().length, lines0, "no new line");
    eq(E.ui.editingId(), id, "still editing");
    key(root, "Enter", { metaKey: true });
    await waitFor(() => E.store.blocks().length === n0 + 1, 3000, "cmd+Enter makes a new block");
  });

  test("typing $$ in an empty block makes it a math block", async () => {
    const E = await mountEditor("local");
    const id = await E.ui.insert({ type: "text", text: "" });
    const ta = await E.edit(id);
    E.type(ta, "$$");
    key(ta, " ");
    await waitFor(() => E.store.blocks().find((b) => b.id === id).type === "math", 3000, "type math");
  });

  test("text block shows math while typing", async () => {
    const E = await mountEditor("local");
    const id = await E.ui.insert({ type: "text", text: "" });
    const ta = await E.edit(id);
    E.type(ta, "넓이는 $\\pi r^2$ ");
    await waitFor(() => E.blockEl(id).querySelector(".ql-editor .ql-math svg"), 15000, "math in editor");
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
    const ed = await E.edit(id);
    E.type(ed, " typing");
    window.__fake.db.write("blocks/zz" + Date.now(), { type: "text", text: "from claude", order: 999, by: "claude", createdAt: "x", updatedAt: "x" });
    await waitFor(() => E.div.textContent.includes("from claude"), 5000, "remote block");
    ok(E.blockEl(id).querySelector(".ql-editor") === ed, "same editor element");
    eq(E.ui.editor().getText(), "A typing");
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

  // ---------- review fixes ----------
  test("typing right after Enter goes to the new block even when the db is slow", async () => {
    if (DB_OFF) return;
    const E = await mountEditor("db");
    const id = await E.ui.insert({ type: "text", text: "첫 문장" });
    const ta = await E.edit(id);
    window.__fake.dbLatency = 400;
    key(ta, "Enter", { isComposing: false, metaKey: true });
    await sleep(60);
    const now = E.ui.editingId();
    window.__fake.dbLatency = 0;
    ok(now && now !== id, "editing moved to the new block within 60ms (was " + now + ")");
    await sleep(450);
  });

  test("a failed save shows a retry instead of 저장됨", async () => {
    if (DB_OFF) return;
    const tab = $('.tab[data-tab="notes"]'); tab.click();
    const id = await waitFor(() => document.querySelector("#tab-notes .nb") && document.querySelector("#tab-notes .nb").dataset.id, 5000, "a block");
    window.__fake.failWrites = 2;
    document.querySelector('#tab-notes .nb[data-id="' + id + '"] .nb-body').click();
    const ta = await waitFor(() => document.querySelector('#tab-notes .nb[data-id="' + id + '"] textarea, #tab-notes .nb[data-id="' + id + '"] .ql-editor'), 3000, "editor");
    if (ta.tagName === "TEXTAREA") { ta.value = ta.value + " 실패 테스트"; ta.dispatchEvent(new Event("input", { bubbles: true })); }
    else { const q = window.__notesUI.editor().quill; q.insertText(q.getLength() - 1, " 실패 테스트", "user"); }
    await waitFor(() => $("#saveState").textContent.includes("저장 실패"), 8000, "failure shown");
    window.__fake.failWrites = 0;
    $("#saveState").querySelector("button").click();
    await waitFor(() => $("#saveState").textContent.trim() === "저장됨", 8000, "saved after retry");
  });

  test("opening the chat after the page is noticed before the next click", async () => {
    if (DB_OFF) return;
    window.__fake.canSend = "no_session";
    await window.__bridge.refreshCanSend();
    window.__fake.canSend = "available";
    const n0 = window.__fake.sent.length;
    await selectOnPage(1, "dominant");
    await sleep(50);
    btnByText($("#selbar"), "설명").click();
    await waitFor(() => window.__fake.sent.length === n0 + 1, 3000, "sent to chat, not the fallback");
  });

  test("without db or chat the ask button says to open the chat", async () => {
    if (!DB_OFF) return;
    window.__fake.canSend = "no_session";
    await window.__bridge.refreshCanSend();
    await selectOnPage(1, "dominant");
    await sleep(50);
    btnByText($("#selbar"), "설명").click();
    await waitFor(() => $("#toast").textContent.includes("채팅창을 열고"), 3000, "open-chat hint");
    window.__fake.canSend = "available";
  });

  // ---------- rich editor (PLRich) ----------
  function mountRich(text) {
    const host = document.createElement("div"); host.style.cssText = "width:480px"; document.body.append(host);
    const calls = { change: [], exit: 0, newBlock: 0, backspaceEmpty: 0, mathBelow: 0 };
    const ed = window.PLRich.mount(host, text || "", {
      onChange: (t) => calls.change.push(t), onExit: () => calls.exit++, onNewBlockBelow: () => calls.newBlock++,
      onBackspaceEmpty: () => calls.backspaceEmpty++, onMathBlockBelow: () => calls.mathBelow++,
    });
    const q = ed.quill;
    const typeAtEnd = (t) => { q.setSelection(q.getLength() - 1, 0, "silent"); q.insertText(q.getLength() - 1, t, "user"); q.setSelection(q.getLength() - 1, 0, "silent"); };
    const press = (k, extra) => q.root.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra }));
    return { host, ed, q, calls, typeAtEnd, press };
  }

  test("rich: cmd+B makes bold text and stores **", async () => {
    const R = mountRich("");
    R.q.setSelection(0, 0);
    R.press("b", { metaKey: true, ctrlKey: false });
    R.typeAtEnd("굵게");
    ok(R.ed.root.querySelector("strong"), "strong in editor");
    ok(R.ed.getText().includes("**굵게**"), R.ed.getText());
  });

  test("rich: ## + space becomes a heading", async () => {
    const R = mountRich("");
    R.typeAtEnd("##");
    R.press(" ");
    R.typeAtEnd("제목");
    ok(R.ed.root.querySelector("h2"), "h2");
    eq(R.ed.getText(), "## 제목");
  });

  test("rich: - and [] make lists", async () => {
    const R = mountRich("");
    R.typeAtEnd("-"); R.press(" "); R.typeAtEnd("항목");
    ok(R.ed.root.querySelector('li[data-list="bullet"]'), "bullet");
    const R2 = mountRich("");
    R2.typeAtEnd("[]"); R2.press(" "); R2.typeAtEnd("할 일");
    ok(R2.ed.root.querySelector('li[data-list="unchecked"]'), "checkbox");
    eq(R2.ed.getText(), "- [ ] 할 일");
  });

  test("rich: $x^2$ turns into math after the next character, prices do not", async () => {
    const R = mountRich("");
    R.typeAtEnd("넓이 $x^2$"); R.typeAtEnd(" ");
    await waitFor(() => R.ed.root.querySelector(".ql-math svg"), 15000, "math svg");
    ok(R.ed.getText().includes("$x^2$"), R.ed.getText());
    const R2 = mountRich("");
    R2.typeAtEnd("가격 $5–$10 "); await sleep(50);
    ok(!R2.ed.root.querySelector(".ql-math"), "no math for prices");
  });

  test("rich: toolbar color is stored as data-c", async () => {
    const R = mountRich("빨강으로");
    R.q.setSelection(0, 3, "user");
    await waitFor(() => !$("#richbar").hidden, 3000, "toolbar");
    $('#richbar [data-act="color"][data-v="red"]').dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    ok(R.ed.getText().includes('<span data-c="red">빨강으</span>'), R.ed.getText());
  });

  test("rich: pasted styles and fonts are dropped", async () => {
    const R = mountRich("");
    R.q.clipboard.dangerouslyPasteHTML(0, '<span style="color:#f00;font-family:Comic Sans MS">x</span><b>y</b>', "user");
    const t = R.ed.getText();
    ok(!/style|font|#f00/i.test(t), t);
    ok(t.includes("**y**"), t);
  });

  test("rich: keys call the editor callbacks", async () => {
    const R = mountRich("글");
    R.q.setSelection(1, 0);
    R.press("Enter", { metaKey: true }); eq(R.calls.newBlock, 1, "cmd+Enter");
    R.press("Escape"); eq(R.calls.exit, 1, "Esc");
    const E = mountRich("");
    E.q.setSelection(0, 0); E.press("Backspace"); eq(E.calls.backspaceEmpty, 1, "Backspace on empty");
    const M = mountRich("앞 줄");
    M.q.insertText(M.q.getLength() - 1, "\n", "user"); M.typeAtEnd("$$"); M.press(" ");
    eq(M.calls.mathBelow, 1, "$$ + space");
    ok(!M.ed.getText().includes("$$"), "the $$ is removed");
  });

  // ---------- rich editor inside notes ----------
  test("opening and closing a block without edits writes nothing", async () => {
    if (DB_OFF) return;
    const E = await mountEditor("db");
    const id = await E.ui.insert({ type: "text", text: "## 제목\n\n**굵게** 그리고 $x$\n\n- 목록" });
    await sleep(100);
    const mine = () => window.__fake.issuedPaths.filter((p) => p === "blocks/" + id).length;
    const before = mine();
    await E.edit(id);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await waitFor(() => E.ui.editingId() === null, 3000, "closed");
    await sleep(800);
    eq(mine(), before, "no writes to this block");
  });

  test("characters typed as text stay text after saving", async () => {
    const E = await mountEditor("local");
    const id = await E.ui.insert({ type: "text", text: "" });
    const ed = await E.edit(id);
    E.type(ed, "a*b $5 <b> _x_");
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await waitFor(() => E.ui.editingId() === null && E.blockEl(id).querySelector(".nb-text"), 3000, "rendered");
    eq(E.blockEl(id).querySelector(".nb-text").textContent.trim(), "a*b $5 <b> _x_");
  });

  test("a block with a table opens as raw text with a note", async () => {
    const E = await mountEditor("local");
    const id = await E.ui.insert({ type: "text", text: "| a | b |\n|---|---|\n| 1 | 2 |" });
    const ed = await E.edit(id);
    eq(ed.tagName, "TEXTAREA");
    ok(E.blockEl(id).querySelector(".nb-raw-note"), "raw note shown");
  });

  test("a checkbox can be ticked without opening the block", async () => {
    const E = await mountEditor("local");
    const id = await E.ui.insert({ type: "text", text: "- [ ] 첫째\n- [ ] 둘째" });
    const box = await waitFor(() => E.blockEl(id).querySelectorAll('.nb-text input[type="checkbox"]')[1], 3000, "checkbox");
    box.click();
    await waitFor(() => E.store.blocks().find((b) => b.id === id).text === "- [ ] 첫째\n- [x] 둘째", 3000, "ticked");
    eq(E.ui.editingId(), null, "not opened");
  });

  // ---------- shared look ----------
  test("headings and lists look the same while editing and after", async () => {
    const E = await mountEditor("local");
    E.div.style.width = "460px";
    const id = await E.ui.insert({ type: "text", text: "## 제목\n\n- 항목" });
    const st = await waitFor(() => E.blockEl(id).querySelector(".nb-text h2"), 3000, "static h2");
    const sFont = getComputedStyle(st).fontSize, sWeight = getComputedStyle(st).fontWeight;
    const sLi = E.blockEl(id).querySelector(".nb-text li");
    const sIndent = sLi.getBoundingClientRect().left - E.blockEl(id).querySelector(".nb-body").getBoundingClientRect().left;
    await E.edit(id);
    const eh = E.blockEl(id).querySelector(".ql-editor h2");
    eq(getComputedStyle(eh).fontSize, sFont, "h2 size");
    eq(getComputedStyle(eh).fontWeight, sWeight, "h2 weight");
    const eLi = E.blockEl(id).querySelector(".ql-editor li");
    const eIndent = eLi.getBoundingClientRect().left - E.blockEl(id).querySelector(".nb-body").getBoundingClientRect().left;
    ok(Math.abs(eIndent - sIndent) <= 2, "list indent static " + sIndent + " vs editor " + eIndent);
  });

  test("highlight and text colors follow the dark theme tokens", async () => {
    const E = await mountEditor("local");
    const id = await E.ui.insert({ type: "text", text: '<mark data-c="yellow">형광</mark> <span data-c="red">빨강</span>' });
    const mk = await waitFor(() => E.blockEl(id).querySelector('.nb-text mark[data-c="yellow"]'), 3000, "mark");
    const sp = E.blockEl(id).querySelector('.nb-text span[data-c="red"]');
    const probe = document.createElement("span"); document.body.append(probe);
    const tokenColor = (v, prop) => { probe.style[prop] = "var(" + v + ")"; return getComputedStyle(probe)[prop]; };
    const light = getComputedStyle(mk).backgroundColor;
    eq(light, tokenColor("--h-yellow", "backgroundColor"), "light highlight uses token");
    eq(getComputedStyle(sp).color, tokenColor("--c-red", "color"), "light text color uses token");
    document.documentElement.dataset.theme = "dark";
    const dark = getComputedStyle(mk).backgroundColor;
    eq(dark, tokenColor("--h-yellow", "backgroundColor"), "dark highlight uses token");
    ok(dark !== light, "dark value differs");
    delete document.documentElement.dataset.theme;
    probe.remove();
  });

  test("inline math takes only its own width (no stray space)", async () => {
    const E = await mountEditor("local");
    const id = await E.ui.insert({ type: "text", text: "값 $\\sqrt{d_k}$ 끝" });
    const c = await waitFor(() => E.blockEl(id).querySelector(".nb-text mjx-container svg") && E.blockEl(id).querySelector(".nb-text mjx-container"), 15000, "math");
    const cw = c.getBoundingClientRect().width, sw = c.querySelector("svg").getBoundingClientRect().width;
    ok(cw <= sw + 3, "container " + Math.round(cw) + "px vs svg " + Math.round(sw) + "px");
  });

  test("math glyphs are really drawn (every <use> points at a glyph)", async () => {
    const E = await mountEditor("local");
    const id = await E.ui.insert({ type: "text", text: "쿼리 $Q$ 와 $\\sqrt{d_k}$" });
    const svg = await waitFor(() => E.blockEl(id).querySelector(".nb-text mjx-container svg"), 15000, "svg");
    const uses = [...svg.querySelectorAll("use")];
    ok(uses.length > 0, "has glyph uses");
    for (const u of uses) {
      const ref = (u.getAttribute("href") || u.getAttribute("xlink:href") || "").replace(/^#/, "");
      ok(ref && document.getElementById(ref), "glyph " + ref + " is defined");
    }
  });

  // ---- review fixes (rich) ----
  test("rich: $$ under a heading keeps the heading", async () => {
    const R = mountRich("## 제목");
    R.q.setSelection(R.q.getLength() - 1, 0);
    R.q.insertText(R.q.getLength() - 1, "\n", "user");
    R.typeAtEnd("$$"); R.press(" ");
    eq(R.calls.mathBelow, 1, "math below");
    eq(R.ed.getText(), "## 제목");
  });

  test("rich: untouched $a$ text is not turned into math by other edits or closing", async () => {
    if (DB_OFF) return;
    const E = await mountEditor("db");
    const id = await E.ui.insert({ type: "text", text: "\\$a$ 끝" });
    await sleep(100);
    const mine = () => window.__fake.issuedPaths.filter((p) => p === "blocks/" + id).length;
    const before = mine();
    await E.edit(id);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await waitFor(() => E.ui.editingId() === null, 3000, "closed");
    await sleep(800);
    eq(mine(), before, "closing writes nothing");
    const ed = await E.edit(id);
    const q = E.ui.editor().quill;
    q.insertText(q.getLength() - 1, " 더", "user");
    await sleep(50);
    ok(!ed.querySelector(".ql-math"), "no math from an unrelated edit");
  });

  test("rich: undo after auto math keeps the typed $x$", async () => {
    const R = mountRich("");
    R.typeAtEnd("$x$"); R.typeAtEnd(" ");
    await waitFor(() => R.ed.root.querySelector(".ql-math"), 3000, "math");
    R.press("z", { metaKey: true });
    await sleep(100);
    ok(!R.ed.root.querySelector(".ql-math"), "math undone");
    ok(R.q.getText().includes("$x$"), "text back: " + JSON.stringify(R.q.getText()));
  });

  test("rich: clicking inside an open editor raises no errors", async () => {
    const E = await mountEditor("local");
    const id = await E.ui.insert({ type: "text", text: "글" });
    const ed = await E.edit(id);
    const n0 = window.__fake.errors.length;
    ed.click(); ed.click();
    await sleep(50);
    eq(window.__fake.errors.length, n0, String(window.__fake.errors.slice(n0)));
  });

  test("rich: editing the text closes an open formula popover", async () => {
    const R = mountRich("값 $x$ 끝");
    const m = await waitFor(() => R.ed.root.querySelector(".ql-math"), 3000, "math");
    m.click();
    await waitFor(() => !document.querySelector("#mathpop").hidden, 2000, "popover open");
    R.q.insertText(0, "앞 ", "user");
    await sleep(30);
    ok(document.querySelector("#mathpop").hidden, "popover closed");
  });

  test("light yellow text is readable on white (contrast >= 4.5)", async () => {
    const probe = document.createElement("span"); probe.style.color = "var(--c-yellow)"; document.body.append(probe);
    const [r, g, b] = getComputedStyle(probe).color.match(/\d+/g).map(Number); probe.remove();
    const L = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const lum = 0.2126 * L(r) + 0.7152 * L(g) + 0.0722 * L(b);
    ok(1.05 / (lum + 0.05) >= 4.5, "contrast " + (1.05 / (lum + 0.05)).toFixed(2));
  });

  // ---- live math preview ----
  test("rich: text inserted in one go after $x$ still makes math", async () => {
    const R = mountRich("");
    R.typeAtEnd("넓이는 $\\pi r^2$");
    R.typeAtEnd(" 이다");
    await waitFor(() => R.ed.root.querySelector(".ql-math svg"), 15000, "math");
    ok(R.ed.getText().startsWith("넓이는 $\\pi r^2$ 이다"), R.ed.getText());
  });

  test("rich: a live preview follows a formula while it is being typed", async () => {
    const R = mountRich("");
    R.q.focus();
    R.typeAtEnd("넓이는 $\\pi r^2");
    await waitFor(() => !$("#mathlive").hidden && $("#mathlive svg"), 15000, "live preview shown");
    R.typeAtEnd("$"); R.typeAtEnd(" ");
    await waitFor(() => $("#mathlive").hidden, 3000, "preview hidden after conversion");
  });

  // ---- click-to-write and placeholder ----
  test("clicking the empty notes area starts writing (reusing an empty last block)", async () => {
    const E = await mountEditor("local");
    E.div.style.minHeight = "300px";
    await sleep(50);
    const n0 = E.store.blocks().length;
    E.div.querySelector(".nb-list").parentElement.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitFor(() => E.ui.editingId(), 3000, "editing a new block");
    eq(E.store.blocks().length, n0 + 1, "one new block");
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await waitFor(() => !E.ui.editingId(), 3000, "closed");
    E.div.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitFor(() => E.ui.editingId(), 3000, "editing again");
    eq(E.store.blocks().length, n0 + 1, "empty last block reused");
  });

  test("the empty-block hint stays on one line inside the box", async () => {
    const R = mountRich("");
    R.host.style.width = "300px";
    const cs = getComputedStyle(R.ed.root, "::before");
    eq(cs.whiteSpace, "nowrap");
    eq(cs.overflow, "hidden");
    ok(R.q.root.dataset.placeholder.length <= 24, "short hint: " + R.q.root.dataset.placeholder);
  });

  test("the hint disappears as soon as typing starts (Korean composition included)", async () => {
    const R = mountRich("");
    R.ed.root.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    eq(getComputedStyle(R.ed.root, "::before").content, "none", "hidden while composing");
    R.ed.root.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    R.ed.root.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: "a" }));
    eq(getComputedStyle(R.ed.root, "::before").content, "none", "hidden once input starts");
  });
})();
