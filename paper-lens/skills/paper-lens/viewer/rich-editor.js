// Paper Lens: the WYSIWYG editor for one note block, built on Quill 2.
// mount(host, text, cb) shows `text` (stored Markdown) formatted, and reports edits back as Markdown.
// cb: onChange(text), onExit(), onNewBlockBelow(), onBackspaceEmpty(), onMathBlockBelow().
(function () {
  "use strict";
  if (!window.Quill) return;
  const Quill = window.Quill;
  const C = () => window.PLRichConvert;
  const COLORS = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "red"];
  const COLOR_KO = { default: "기본", gray: "회색", brown: "갈색", orange: "주황", yellow: "노랑", green: "초록", blue: "파랑", purple: "보라", red: "빨강" };
  const FORMATS = ["bold", "italic", "underline", "strike", "code", "link", "header", "list", "indent", "blockquote", "color", "highlight", "size", "mathInline"];

  // ---------- registration (once) ----------
  const Parchment = Quill.import("parchment");
  const inline = { scope: Parchment.Scope.INLINE };
  Quill.register({
    "formats/color": new Parchment.Attributor("color", "data-c", { ...inline, whitelist: COLORS }),
    "formats/highlight": new Parchment.Attributor("highlight", "data-h", { ...inline, whitelist: COLORS }),
    "formats/size": new Parchment.Attributor("size", "data-s", { ...inline, whitelist: ["small", "large"] }),
  }, true);

  const Embed = Quill.import("blots/embed");
  class MathInline extends Embed {
    static create(value) {
      const node = super.create(value);
      node.setAttribute("data-latex", value);
      const holder = document.createElement("span");
      holder.className = "ql-math-r";
      holder.textContent = value;
      node.append(holder);
      if (window.PLMath) window.PLMath.render(value, false).then(({ node: svg, error }) => {
        holder.textContent = ""; holder.append(svg);
        node.classList.toggle("ql-math-err", !!error);
      });
      return node;
    }
    static value(node) { return node.getAttribute("data-latex") || ""; }
  }
  MathInline.blotName = "mathInline"; MathInline.tagName = "span"; MathInline.className = "ql-math";
  Quill.register(MathInline, true);

  // ---------- shared floating UI ----------
  let active = null; // the editor whose selection the toolbar acts on
  let lastHighlight = "yellow";
  const bar = document.createElement("div");
  bar.id = "richbar"; bar.hidden = true; bar.setAttribute("role", "toolbar"); bar.setAttribute("aria-label", "글자 꾸미기");
  const pop = document.createElement("div");
  pop.id = "mathpop"; pop.hidden = true; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "수식 고치기");
  const live = document.createElement("div");
  live.id = "mathlive"; live.hidden = true; live.setAttribute("aria-hidden", "true");
  let liveOwner = null;
  const mountUi = () => { if (!bar.isConnected) document.body.append(bar, pop, live); };

  function btn(label, act, v, title, extraClass) {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.act = act; if (v != null) b.dataset.v = v;
    b.title = title || label; b.setAttribute("aria-label", title || label);
    b.className = "rb" + (extraClass ? " " + extraClass : "");
    b.innerHTML = label;
    return b;
  }
  function group(...kids) { const g = document.createElement("span"); g.className = "rb-g"; kids.forEach((k) => g.append(k)); return g; }
  function menu(label, title, items) {
    const wrap = document.createElement("span"); wrap.className = "rb-menu";
    const open = btn(label + " ▾", "menu", null, title);
    const list = document.createElement("span"); list.className = "rb-list"; list.hidden = true;
    items.forEach((it) => list.append(it));
    open.addEventListener("mousedown", (e) => { e.preventDefault(); bar.querySelectorAll(".rb-list").forEach((l) => l !== list && (l.hidden = true)); list.hidden = !list.hidden; });
    wrap.append(open, list);
    return wrap;
  }
  const swatch = (act, c) => btn(act === "color" ? "가" : "", act, c, (act === "color" ? "글자색 " : "형광펜 ") + COLOR_KO[c], "sw sw-" + act + " c-" + c);
  bar.append(
    group(btn("<b>B</b>", "bold", null, "굵게 (⌘B)"), btn("<i>I</i>", "italic", null, "기울임 (⌘I)"), btn("<u>U</u>", "underline", null, "밑줄 (⌘U)"), btn("<s>S</s>", "strike", null, "취소선 (⌘⇧S)"), btn("&lt;/&gt;", "code", null, "코드 (⌘E)")),
    group(
      menu("제목", "제목 크기", [btn("본문", "header", "0"), btn("제목 1", "header", "1"), btn("제목 2", "header", "2"), btn("제목 3", "header", "3")]),
      menu("크기", "글자 크기", [btn("작게", "size", "small"), btn("보통", "size", ""), btn("크게", "size", "large")]),
    ),
    group(
      menu("<span class='rb-a'>가</span>", "글자색", COLORS.map((c) => swatch("color", c))),
      menu("<span class='rb-hl'>형광펜</span>", "형광펜 (⌘⇧H)", COLORS.map((c) => swatch("highlight", c))),
    ),
    group(btn("∑ 수식으로", "toMath", null, "고른 글자를 수식으로")),
  );
  bar.addEventListener("mousedown", (e) => {
    const b = e.target.closest("button"); if (!b || !active) return;
    e.preventDefault();
    const act = b.dataset.act, v = b.dataset.v;
    if (act === "menu") return;
    active.apply(act, v);
    bar.querySelectorAll(".rb-list").forEach((l) => (l.hidden = true));
  });

  // ---------- editor ----------
  function mount(host, text, cb) {
    cb = cb || {};
    mountUi();
    const el = document.createElement("div");
    el.className = "nb-rich";
    host.append(el);
    let quill;
    const keyIsComposing = (ev) => ev && (ev.isComposing || ev.keyCode === 229);
    const bindings = {
      header: { key: " ", collapsed: true, prefix: /^#{1,3}$/, format: { list: false, "code-block": false }, handler(range, ctx) {
        const n = ctx.prefix.length;
        quill.deleteText(range.index - n, n, "user");
        quill.formatLine(range.index - n, 1, "header", n, "user");
        return false;
      } },
      quote: { key: " ", collapsed: true, prefix: /^>$/, handler(range) {
        quill.deleteText(range.index - 1, 1, "user");
        quill.formatLine(range.index - 1, 1, "blockquote", true, "user");
        return false;
      } },
      mathBelow: { key: " ", collapsed: true, prefix: /^\$\$$/, handler(range) {
        const at = range.index - 2;
        quill.deleteText(at, 2, "user");
        // Drop the now-empty line without disturbing its neighbours' line formats (heading, list, ...).
        const len = quill.getLength();
        if (len > 1) {
          if (at + 1 < len) quill.deleteText(at, 1, "user"); // its own newline: the next line moves up intact
          else if (at > 0) {
            const [prevLine] = quill.getLine(at - 1);
            const fmt = prevLine ? prevLine.formats() : {};
            quill.deleteText(at - 1, 1, "user");
            if (Object.keys(fmt).length) quill.formatLine(at - 1, 1, fmt, "user");
          }
        }
        cb.onMathBlockBelow && cb.onMathBlockBelow();
        return false;
      } },
      strike: { key: "s", shortKey: true, shiftKey: true, handler(range, ctx) { quill.format("strike", !ctx.format.strike, "user"); return false; } },
      code: { key: "e", shortKey: true, handler(range, ctx) { quill.format("code", !ctx.format.code, "user"); return false; } },
      highlight: { key: "h", shortKey: true, shiftKey: true, handler(range, ctx) { quill.format("highlight", ctx.format.highlight ? false : lastHighlight, "user"); return false; } },
      newBlock: { key: "Enter", shortKey: true, handler() { flushMath(); cb.onNewBlockBelow && cb.onNewBlockBelow(); return false; } },
      exit: { key: "Escape", handler() { if (!pop.hidden) { closePop(false); return false; } cb.onExit && cb.onExit(); return false; } },
      backspaceEmpty: { key: "Backspace", collapsed: true, handler(range, ctx) {
        if (quill.getLength() <= 1) { cb.onBackspaceEmpty && cb.onBackspaceEmpty(); return false; }
        // At the very start: a formatted first line (heading, list, quote) loses its format first, like Notion.
        if (range.index === 0 && !Object.keys(ctx.format || {}).some((k) => ["header", "list", "blockquote", "indent"].includes(k)) && cb.onBackspaceAtStart) {
          cb.onBackspaceAtStart(C().deltaToMd(quill.getContents()));
          return false;
        }
        return true;
      } },
      split: { key: "Enter", collapsed: true, handler(range, ctx) {
        // Lists and quotes keep Quill's own Enter (next item, or leave the list on an empty item).
        if (!cb.onSplit || ctx.format.list || ctx.format.blockquote || ctx.format["code-block"]) return true;
        flushMath();
        const sel = quill.getSelection() || range;
        const len = quill.getLength();
        const lineFmt = {}; for (const k of ["header", "list", "blockquote", "indent"]) lineFmt[k] = (ctx.format && ctx.format[k]) || false;
        const rest = quill.getContents(sel.index, len - sel.index);
        const restMd = /\S/.test(rest.ops.map((o) => (typeof o.insert === "string" ? o.insert : "x")).join("")) ? C().deltaToMd(rest) : "";
        if (len - 1 - sel.index > 0) {
          quill.deleteText(sel.index, len - 1 - sel.index, "user");
          quill.formatLine(sel.index, 1, lineFmt, "user");
        }
        cb.onSplit(restMd);
        return false;
      } },
      arrowUp: { key: "ArrowUp", collapsed: true, handler(range) {
        if (!cb.onArrowOut) return true;
        const top = quill.getBounds(range.index).top, first = quill.getBounds(0).top;
        if (top - first > 4) return true;
        cb.onArrowOut("up"); return false;
      } },
      arrowDown: { key: "ArrowDown", collapsed: true, handler(range) {
        if (!cb.onArrowOut) return true;
        const b = quill.getBounds(range.index), end = quill.getBounds(quill.getLength() - 1);
        if (end.top - b.top > 4) return true;
        cb.onArrowOut("down"); return false;
      } },
    };
    quill = new Quill(el, {
      formats: FORMATS,
      modules: { toolbar: false, keyboard: { bindings } },
      placeholder: "## 제목, - 목록, $수식$",
    });
    // Our key handling runs before Quill's defaults (e.g. its "Enter at end of a heading").
    const ours = new Set(Object.values(bindings).map((b) => b.handler));
    for (const k of Object.keys(quill.keyboard.bindings)) {
      const arr = quill.keyboard.bindings[k];
      if (Array.isArray(arr)) arr.sort((x, y) => (ours.has(y.handler) ? 1 : 0) - (ours.has(x.handler) ? 1 : 0));
    }
    // Keep only our formats on paste (Quill already drops formats not in `formats`; colors outside the palette are dropped by the whitelist).
    quill.clipboard.addMatcher(Node.ELEMENT_NODE, (node, delta) => {
      delta.ops.forEach((op) => { if (op.attributes) for (const k of Object.keys(op.attributes)) if (!FORMATS.includes(k)) delete op.attributes[k]; });
      return delta;
    });
    // IME (Korean): keys pressed mid-syllable must not act on the half-built text. An Enter that ends a
    // syllable is replayed once, right after the composition commits, as a normal Enter (new block);
    // the browser's own line break is prevented. Chrome on macOS also sends a plain Enter keydown
    // right after: whichever arrives first runs, the other is dropped.
    let afterComp = null; // {shift, meta, t, done}
    const replayEnter = (p) => {
      const ev = new KeyboardEvent("keydown", { key: "Enter", shiftKey: p.shift, metaKey: p.meta, ctrlKey: false, bubbles: true, cancelable: true });
      ev.__plReplay = true;
      quill.root.dispatchEvent(ev);
    };
    quill.root.addEventListener("keydown", (e) => {
      if (keyIsComposing(e)) {
        if (e.key === "Enter") { e.preventDefault(); afterComp = { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey, t: 0, done: false, armed: true }; }
        e.stopImmediatePropagation();
        return;
      }
      if (e.key === "Enter" && !e.__plReplay && afterComp && afterComp.t && Date.now() - afterComp.t < 150) {
        if (afterComp.done) { e.preventDefault(); e.stopImmediatePropagation(); }
        else afterComp.done = true; // the real one goes through; the replay is cancelled
      }
    }, true);
    quill.root.addEventListener("compositionend", () => {
      if (!afterComp || !afterComp.armed) return;
      const p = afterComp; p.armed = false; p.t = Date.now();
      setTimeout(() => { if (!p.done) { p.done = true; replayEnter(p); } }, 30);
    });

    // Hide the empty-block hint the moment input starts; with an IME, Quill only learns about
    // the text at compositionend, so the hint would otherwise sit on top of the first syllables.
    let composing = false;
    const hint = (on) => quill.root.classList.toggle("pl-typing", !on);
    quill.root.addEventListener("compositionstart", () => { composing = true; hint(false); });
    quill.root.addEventListener("compositionend", () => { composing = false; setTimeout(() => hint(quill.getLength() <= 1), 0); });
    quill.root.addEventListener("beforeinput", (e) => { if (e.inputType && e.inputType.startsWith("insert")) hint(false); });
    quill.on("text-change", () => { if (!composing) hint(quill.getLength() <= 1); });

    quill.setContents(C().mdToDelta(text), "silent");
    let last = C().deltaToMd(quill.getContents());

    // $...$ becomes inline math right when the reader types the character after the closing $
    // (and that character is not a digit), only at the caret. Undo/redo never re-promotes.
    let dirty = false, undoing = false;
    quill.root.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z" || e.key === "y")) { undoing = true; setTimeout(() => (undoing = false), 0); }
    }, true);
    function docString() {
      let s = "";
      for (const op of quill.getContents().ops) s += typeof op.insert === "string" ? op.insert : "￼";
      return s;
    }
    const MATH_AT_END = /(^|[^\\$])\$([^\s$][^$\n\uFFFC]*?[^\s\\$]|[^\s$\\])\$$/;
    function promoteAt(endIndex, kept) {
      const m = MATH_AT_END.exec(docString().slice(0, endIndex));
      if (!m) return false;
      const len = m[2].length + 2, at = endIndex - len;
      const fmt = quill.getFormat(at, 1);
      quill.history.cutoff(); // undo takes back the conversion only
      quill.deleteText(at, len, "user");
      quill.insertEmbed(at, "mathInline", m[2], "user");
      const keep = {}; for (const k of ["bold", "italic", "underline", "strike", "color", "highlight", "size"]) if (fmt[k]) keep[k] = fmt[k];
      if (Object.keys(keep).length) quill.formatText(at, 1, keep, "user");
      quill.setSelection(at + 1 + kept, 0, "silent");
      quill.history.cutoff();
      return true;
    }
    // Where the inserted text of this change ends (from the change itself, not the caret).
    function insertRange(delta) {
      let idx = 0, range = null;
      for (const op of delta.ops || []) {
        if (typeof op.retain === "number") idx += op.retain;
        else if (typeof op.insert === "string") { range = { start: idx, end: idx + op.insert.length }; idx += op.insert.length; }
        else if (op.insert) idx += 1;
      }
      return range;
    }
    // The first inserted character decides: "$x$" + " 이다" (typed, pasted or IME-committed) converts.
    // Every $..$ whose following character arrived in this change converts (typed, pasted, IME commit).
    function promoteTyped(delta) {
      const r = insertRange(delta);
      if (!r) return;
      const text = docString();
      const from = text.lastIndexOf("\n", r.start - 1) + 1;
      const re = /(^|[^\\$])\$([^\s$][^$\n\uFFFC]*?[^\s\\$]|[^\s$\\])\$(?=[^\d$\n])/g;
      const hits = [];
      let m;
      const seg = text.slice(from, r.end);
      while ((m = re.exec(seg))) {
        const after = from + m.index + m[0].length; // index of the character after the closing $
        if (after >= r.start && after < r.end) hits.push(after);
      }
      if (!hits.length) return;
      const tail = text.length - r.end;
      for (const after of hits.reverse()) promoteAt(after, Math.max(0, r.end - after));
      quill.setSelection(docString().length - tail, 0, "silent"); // caret back to the end of the insert
    }
    // When leaving the block, a formula typed at the very end of the caret's line is converted too.
    function flushMath() {
      if (!dirty) return;
      const sel = quill.getSelection() || { index: quill.getLength() - 1 };
      const s2 = docString();
      let end = sel.index; while (end < s2.length && s2[end] !== "\n") end++;
      promoteAt(end, 0);
    }

    // Live preview while a formula is being typed: from the opening $ up to the caret.
    let liveTimer = null;
    function updateLive() {
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => {
        const sel = quill.hasFocus() ? quill.getSelection() : null;
        if (!sel || sel.length) { if (liveOwner === api) live.hidden = true; return; }
        const text = docString();
        const lineStart = text.lastIndexOf("\n", sel.index - 1) + 1;
        const before = text.slice(lineStart, sel.index);
        const dollars = [];
        for (let i = 0; i < before.length; i++) if (before[i] === "$" && before[i - 1] !== "\\" && before[i + 1] !== "$" && before[i - 1] !== "$") dollars.push(i);
        let latex = null;
        if (dollars.length % 2 === 1) latex = before.slice(dollars[dollars.length - 1] + 1);
        else if (dollars.length && dollars[dollars.length - 1] === before.length - 1) latex = before.slice(dollars[dollars.length - 2] + 1, before.length - 1);
        if (!latex || /^\s/.test(latex) || !/[A-Za-z\\^_{]/.test(latex) || latex.includes("\uFFFC")) { if (liveOwner === api) live.hidden = true; return; }
        liveOwner = api;
        window.PLMath && window.PLMath.render(latex, false).then(({ node, error }) => {
          if (liveOwner !== api) return;
          live.textContent = ""; live.append(node);
          live.classList.toggle("err", !!error);
          live.hidden = false;
          const b = quill.getBounds(sel.index), rr = quill.root.getBoundingClientRect();
          live.style.left = Math.min(Math.max(8, rr.left + b.left - 12), window.innerWidth - live.offsetWidth - 8) + "px";
          live.style.top = Math.min(rr.top + b.bottom + 6, window.innerHeight - live.offsetHeight - 8) + "px";
        });
      }, 90);
    }
    quill.on("selection-change", updateLive);

    function emit() {
      const t = C().deltaToMd(quill.getContents());
      if (t !== last) { last = t; cb.onChange && cb.onChange(t); }
    }
    let promoting = false;
    quill.on("text-change", (delta, old, source) => {
      if (source !== "user") return;
      dirty = true;
      if (!pop.hidden && popAt && popAt.quill === quill && !promoting) closePop(false); // indices moved
      if (!promoting && !undoing) { promoting = true; try { promoteTyped(delta); } finally { promoting = false; } }
      emit();
      updateLive();
    });

    // toolbar follows this editor's selection
    function placeBar(range) {
      if (!range || !range.length || !quill.hasFocus()) { if (active === api) bar.hidden = true; return; }
      active = api;
      bar.hidden = false;
      const b = quill.getBounds(range.index, range.length);
      const r = quill.root.getBoundingClientRect();
      const w = bar.offsetWidth, h = bar.offsetHeight;
      let top = r.top + b.top - h - 8;
      if (top < 8) top = r.top + b.bottom + 8;
      bar.style.top = top + "px";
      bar.style.left = Math.min(Math.max(8, r.left + b.left + b.width / 2 - w / 2), window.innerWidth - w - 8) + "px";
    }
    quill.on("selection-change", (range, old, source) => { if (range) placeBar(range); else if (active === api) setTimeout(() => { if (!quill.hasFocus()) bar.hidden = true; }, 150); });
    quill.on("text-change", () => { const r = quill.getSelection(); if (r && r.length) placeBar(r); });

    // click a formula to edit it
    let popAt = null;
    quill.root.addEventListener("mousedown", (e) => { if (!e.target.closest(".ql-math") && !pop.hidden && popAt && popAt.quill === quill) closePop(false); });
    quill.root.addEventListener("click", (e) => {
      const n = e.target.closest(".ql-math");
      if (!n) return;
      const blot = Quill.find(n);
      if (!blot) return;
      openPop(quill.getIndex(blot), n.getAttribute("data-latex") || "", n);
    });
    function openPop(index, latex, anchor) {
      popAt = { index, quill };
      active = api;
      pop.innerHTML = "";
      const ta = document.createElement("textarea");
      ta.className = "mp-in"; ta.value = latex; ta.rows = 2; ta.spellcheck = false;
      ta.setAttribute("aria-label", "LaTeX 수식");
      const prev = document.createElement("div"); prev.className = "mp-prev";
      const hint = document.createElement("div"); hint.className = "mp-hint"; hint.textContent = "Enter 반영 · Esc 취소";
      pop.append(ta, prev, hint);
      const draw = () => window.PLMath && window.PLMath.render(ta.value || " ", false).then(({ node, error }) => { prev.textContent = ""; prev.append(node); if (error) { const er = document.createElement("div"); er.className = "nb-err"; er.textContent = "수식 오류: " + error; prev.append(er); } });
      ta.addEventListener("input", draw);
      ta.addEventListener("keydown", (e) => {
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); closePop(true); }
        else if (e.key === "Escape") { e.preventDefault(); closePop(false); }
      });
      pop.hidden = false;
      const r = anchor.getBoundingClientRect();
      pop.style.left = Math.min(Math.max(8, r.left), window.innerWidth - 340) + "px";
      pop.style.top = Math.min(r.bottom + 8, window.innerHeight - 160) + "px";
      draw(); ta.focus(); ta.select();
    }
    function closePop(commit) {
      if (pop.hidden || !popAt || popAt.quill !== quill) return;
      const v = pop.querySelector(".mp-in").value.trim();
      pop.hidden = true;
      const at = popAt.index; popAt = null;
      if (commit) {
        promoting = true;
        quill.deleteText(at, 1, "user");
        if (v) quill.insertEmbed(at, "mathInline", v, "user");
        quill.setSelection(at + (v ? 1 : 0), 0, "user");
        promoting = false;
      } else quill.focus();
    }

    quill.on("selection-change", (range, old) => {
      if (range && !old) cb.onFocus && cb.onFocus();
      else if (!range && old) cb.onBlur && cb.onBlur();
    });

    const api = {
      root: quill.root,
      quill,
      getText: () => C().deltaToMd(quill.getContents()),
      // Show new stored text (a remote change) without reporting it back as an edit.
      setText(md) {
        quill.setContents(C().mdToDelta(md), "silent");
        last = C().deltaToMd(quill.getContents());
        hint(quill.getLength() <= 1);
      },
      hasFocus: () => quill.hasFocus(),
      blur() { flushMath(); emit(); quill.blur(); },
      focus(at) {
        quill.focus();
        const end = quill.getLength() - 1;
        const i = at === "start" ? 0 : typeof at === "number" ? Math.max(0, Math.min(at, end)) : end;
        quill.setSelection(i, 0, "user");
      },
      apply(act, v) {
        const range = quill.getSelection(true);
        const f = quill.getFormat(range);
        if (["bold", "italic", "underline", "strike", "code"].includes(act)) quill.format(act, !f[act], "user");
        else if (act === "header") quill.format("header", v === "0" ? false : +v, "user");
        else if (act === "size") quill.format("size", v || false, "user");
        else if (act === "color") quill.format("color", v === "default" ? false : v, "user");
        else if (act === "highlight") { if (v === "default") quill.format("highlight", false, "user"); else { lastHighlight = v; quill.format("highlight", v, "user"); } }
        else if (act === "toMath" && range.length) {
          const t = quill.getText(range.index, range.length).replace(/\n/g, " ").trim();
          quill.deleteText(range.index, range.length, "user");
          if (t) quill.insertEmbed(range.index, "mathInline", t, "user");
          quill.setSelection(range.index + 1, 0, "user");
        }
      },
      destroy() {
        flushMath();
        emit();
        if (active === api) { bar.hidden = true; pop.hidden = true; active = null; }
        if (liveOwner === api) { live.hidden = true; liveOwner = null; }
        el.remove();
      },
    };
    return api;
  }

  // Close menus/popover when clicking elsewhere.
  document.addEventListener("mousedown", (e) => {
    if (!e.target.closest("#richbar")) bar.querySelectorAll(".rb-list").forEach((l) => (l.hidden = true));
  });

  window.PLRich = { mount, COLORS, COLOR_KO, isOwnUi: (node) => !!(node && node.closest && node.closest("#richbar, #mathpop")) };
})();
