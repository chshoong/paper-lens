// Paper Lens: block notes. Text blocks are always-on rich editors (one continuous, Notion-like page);
// math blocks and Markdown the rich editor cannot hold (tables, code) are edited as raw text.
(function () {
  "use strict";

  // ---------- math ----------
  // Converting one formula at a time skips MathJax's document pass, which is what adds its stylesheet
  // (that stylesheet hides the screen-reader MathML; without it each formula gets stray width).
  let styled = false;
  const ready = () => {
    const p = window.MathJax && window.MathJax.startup && window.MathJax.startup.promise;
    if (!p) return Promise.reject(new Error("MathJax not loaded"));
    return p.then(() => {
      if (!styled && window.MathJax.svgStylesheet) { styled = true; document.head.appendChild(window.MathJax.svgStylesheet()); }
    });
  };
  const PLMath = {
    async render(latex, display) {
      try {
        await ready();
        const node = await window.MathJax.tex2svgPromise(latex, { display: !!display });
        const err = node.querySelector("[data-mjx-error]");
        return { node, error: err ? err.getAttribute("data-mjx-error") || "수식 오류" : null };
      } catch (e) {
        const code = document.createElement("code");
        code.textContent = (display ? "$$" : "$") + latex + (display ? "$$" : "$");
        return { node: code, error: null };
      }
    },
    async renderRich(el, text) {
      const segs = window.PLCore.splitMath(text);
      const maths = [];
      let src = "";
      for (const s of segs) {
        if (s.kind === "text") src += s.value;
        else {
          const i = maths.push(s) - 1;
          src += s.kind === "display" ? '\n\n<div class="mph" data-i="' + i + '"></div>\n\n' : '<span class="mph" data-i="' + i + '"></span>';
        }
      }
      el.innerHTML = window.DOMPurify.sanitize(window.marked.parse(src, { gfm: true, breaks: true }));
      await Promise.all([...el.querySelectorAll(".mph")].map(async (ph) => {
        const m = maths[+ph.dataset.i];
        if (!m) return;
        const { node, error } = await PLMath.render(m.value, m.kind === "display");
        if (error) node.classList.add("nb-err-math");
        ph.replaceWith(node);
      }));
      return el;
    },
  };

  // ---------- editor ----------
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const k in attrs || {}) {
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    for (const c of kids) if (c != null) n.append(c);
    return n;
  }

  function mount(container, store, opts) {
    opts = opts || {};
    container.classList.add("notes-ed");
    const listEl = el("div", { class: "nb-list" });
    const empty = el("div", { class: "nb-empty", hidden: "" },
      el("p", { text: "여기를 눌러 바로 써보세요." }),
      el("p", { class: "muted", text: "## 제목, - 목록, [] 체크박스, $x^2$ 수식 · PDF에서 문장을 골라 '노트에 인용'하거나 수식을 캡처해 넣을 수도 있어요." }));
    container.append(empty, listEl);

    let blocks = [];
    let editing = null;          // {id, rich} for the focused rich block, {id, ta, preview} for a raw/math block
    const nodes = new Map();     // id -> {root, body, key, rich}
    const previewTimers = new Map();
    let focusWanted = null;      // {id, at}

    const blockById = (id) => blocks.find((b) => b.id === id);
    const keyOf = (b) => [b.type, b.text, b.page, b.eq, b.assetId, b.by].join("\u0001");
    const C = () => window.PLRichConvert;
    const canRich = (b) => b.type === "text" && !!window.PLRich && !!C() && C().roundTrips(b.text || "");
    const indexOf = (id) => blocks.findIndex((x) => x.id === id);

    function srcLink(b, label) {
      return el("button", { type: "button", class: "nb-src", text: label, onclick: (e) => { e.stopPropagation(); opts.onGotoPage && opts.onGotoPage(b.page); } });
    }
    function renderBody(b, body) {
      body.textContent = "";
      body.className = "nb-body nb-" + b.type;
      if (b.type === "math") {
        if (!String(b.text || "").trim()) { body.append(el("span", { class: "muted", text: "빈 수식 · 눌러서 LaTeX 입력" })); return; }
        const wrap = el("div", { class: "nb-math" });
        body.append(wrap);
        PLMath.render(b.text, true).then(({ node, error }) => {
          wrap.append(node);
          if (error) body.append(el("div", { class: "nb-err", text: "수식 오류: " + error }));
        });
        if (b.page != null) body.append(srcLink(b, "p." + b.page + (b.eq ? " · 식 " + b.eq : "")));
      } else if (b.type === "quote") {
        const q = el("blockquote", { class: "nb-quote" });
        body.append(q);
        PLMath.renderRich(q, b.text || "");
        if (b.page != null) body.append(srcLink(b, "p." + b.page));
      } else if (b.type === "image") {
        if (b.assetId) body.append(el("img", { src: opts.assetUrl ? opts.assetUrl(b.assetId) : "/_blob/" + b.assetId, alt: "p." + (b.page ?? "?") + " 캡처" }));
        if (b.text) { const cap = el("div", { class: "nb-cap" }); body.append(cap); PLMath.renderRich(cap, b.text); }
        if (b.page != null) body.append(srcLink(b, "p." + b.page));
      } else {
        // Raw-markdown text (tables, code...) that the rich editor cannot hold.
        const md = el("div", { class: "md nb-text" });
        body.append(md);
        PLMath.renderRich(md, b.text || "");
      }
    }

    function menuFor(b) {
      const pop = el("div", { class: "nb-pop", hidden: "" });
      const item = (label, fn) => pop.append(el("button", { type: "button", text: label, onclick: (e) => { e.stopPropagation(); pop.hidden = true; fn(); } }));
      item("위로 옮기기", () => { const i = indexOf(b.id); if (i > 0) store.move(b.id, { before: blocks[i - 1].id }); });
      item("아래로 옮기기", () => { const i = indexOf(b.id); if (i >= 0 && i + 1 < blocks.length) store.move(b.id, { after: blocks[i + 1].id }); });
      if (b.type === "text" || b.type === "math") item(b.type === "text" ? "수식 블록으로 바꾸기" : "글 블록으로 바꾸기", () => store.update(b.id, { type: b.type === "text" ? "math" : "text" }));
      if (opts.onAskClaude && window.PLBridge) item("Claude에게 묻기", () => opts.onAskClaude(blockById(b.id) || b));
      item("삭제", () => store.remove(b.id));
      return pop;
    }

    function buildNode(b) {
      const body = el("div", { class: "nb-body" });
      const pop = menuFor(b);
      const handle = el("button", { type: "button", class: "nb-handle", title: "끌어서 옮기기 · 눌러서 메뉴", "aria-label": "블록 메뉴", draggable: "true" });
      handle.innerHTML = '<svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><g fill="currentColor"><circle cx="2.5" cy="3" r="1.3"/><circle cx="7.5" cy="3" r="1.3"/><circle cx="2.5" cy="8" r="1.3"/><circle cx="7.5" cy="8" r="1.3"/><circle cx="2.5" cy="13" r="1.3"/><circle cx="7.5" cy="13" r="1.3"/></g></svg>';
      const tools = el("div", { class: "nb-tools" }, handle, pop);
      const root = el("div", { class: "nb", "data-id": b.id }, tools, body);
      handle.addEventListener("click", (e) => {
        e.stopPropagation();
        container.querySelectorAll(".nb-pop").forEach((p) => p !== tools.querySelector(".nb-pop") && (p.hidden = true));
        const p = tools.querySelector(".nb-pop"); p.hidden = !p.hidden;
      });
      body.addEventListener("click", (e) => {
        if (e.target.closest("a,button")) return;
        const n = nodes.get(b.id);
        if (n && n.rich) { if (!e.target.closest(".ql-editor")) n.rich.focus("end"); else editing = { id: b.id, rich: n.rich }; return; }
        startEdit(b.id);
      });
      handle.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", b.id); root.classList.add("dragging"); });
      handle.addEventListener("dragend", () => root.classList.remove("dragging"));
      root.addEventListener("dragover", (e) => { e.preventDefault(); root.classList.add("dropover"); });
      root.addEventListener("dragleave", () => root.classList.remove("dropover"));
      root.addEventListener("drop", (e) => {
        e.preventDefault(); root.classList.remove("dropover");
        const from = e.dataTransfer.getData("text/plain");
        if (!from || from === b.id) return;
        const r = root.getBoundingClientRect();
        store.move(from, e.clientY < r.top + r.height / 2 ? { before: b.id } : { after: b.id });
      });
      return { root, body, key: null, rich: null };
    }

    // ----- rich (always-on) text blocks -----
    function mountRich(id, n, text) {
      n.body.textContent = "";
      n.body.className = "nb-body nb-rich-host";
      const rich = window.PLRich.mount(n.body, text, {
        onChange: (t) => {
          if (rich.quill.getText().trim() === "$$") { toMath(id); return; }
          store.update(id, { text: t });
        },
        onFocus: () => { if (editing && editing.id !== id && !editing.rich) stopEdit(); editing = { id, rich }; },
        // Selection events can arrive late (e.g. after a merge moved focus); only clear if focus really left.
        onBlur: () => setTimeout(() => { if (editing && editing.id === id && editing.rich === rich && !rich.hasFocus()) editing = null; }, 0),
        onExit: () => rich.blur(),
        onNewBlockBelow: () => api.insert({ type: "text", text: "" }, { focus: "start", afterId: id }),
        onSplit: (rest) => api.insert({ type: "text", text: rest }, { focus: "start", afterId: id }),
        onBackspaceEmpty: () => removeAndGoUp(id),
        onBackspaceAtStart: (md) => mergeUp(id, md),
        onArrowOut: (dir) => moveFocus(id, dir),
        onMathBlockBelow: () => {
          if (!rich.getText().trim()) toMath(id);
          else api.insert({ type: "math", text: "" }, { focus: true, afterId: id });
        },
      });
      n.rich = rich;
    }
    function dropRich(n) { if (n.rich) { const r = n.rich; n.rich = null; if (editing && editing.rich === r) editing = null; r.destroy(); } }
    function toMath(id) {
      const n = nodes.get(id);
      if (n) dropRich(n);
      store.update(id, { type: "math", text: "" });
      setTimeout(() => startEdit(id), 0);
    }
    function focusBlock(id, at) {
      const n = nodes.get(id), b = blockById(id);
      if (!n || !b) return;
      if (n.rich) { n.rich.focus(at); editing = { id, rich: n.rich }; }
      else startEdit(id);
    }
    function moveFocus(id, dir) {
      const i = indexOf(id), t = blocks[dir === "up" ? i - 1 : i + 1];
      if (t) focusBlock(t.id, dir === "up" ? "end" : "start");
    }
    function removeAndGoUp(id) {
      const i = indexOf(id), prev = i > 0 ? blocks[i - 1] : null;
      store.remove(id);
      if (prev) setTimeout(() => focusBlock(prev.id, "end"), 0);
    }
    function mergeUp(id, md) {
      const i = indexOf(id), prev = i > 0 ? blocks[i - 1] : null;
      if (!prev) return;
      if (prev.type === "text" && C().roundTrips(prev.text || "")) {
        const pn = nodes.get(prev.id);
        const { text, at } = C().mergeMd(prev.text || "", md);
        if (pn && pn.rich) pn.rich.setText(text);
        store.update(prev.id, { text });
        store.remove(id);
        setTimeout(() => focusBlock(prev.id, at), 0);
      } else if (!md.trim()) removeAndGoUp(id);
    }

    function sync(list) {
      blocks = list;
      empty.hidden = list.length > 0;
      const seen = new Set();
      let prev = null;
      for (const b of list) {
        seen.add(b.id);
        let n = nodes.get(b.id);
        if (!n) { n = buildNode(b); nodes.set(b.id, n); }
        const isEditing = editing && editing.id === b.id;
        const k = keyOf(b);
        if (n.key !== k) {
          const pop = n.root.querySelector(".nb-pop");
          if (pop) pop.replaceWith(menuFor(b));
          n.root.classList.toggle("nb-claude", b.by === "claude");
        }
        if (canRich(b)) {
          if (!n.rich) { mountRich(b.id, n, b.text || ""); n.key = k; }
          else if (n.key !== k && !isEditing) {
            if (n.rich.getText() !== C().normalize(b.text || "")) n.rich.setText(b.text || "");
            n.key = k;
          } else if (n.key !== k) n.key = k;
        } else {
          if (n.rich && !isEditing) dropRich(n);
          if (!n.rich && !isEditing && n.key !== k) { renderBody(b, n.body); n.key = k; }
        }
        n.root.classList.toggle("nb-is-math", b.type === "math");
        const want = prev ? prev.nextSibling : listEl.firstChild;
        if (want !== n.root) listEl.insertBefore(n.root, want);
        prev = n.root;
      }
      for (const [id, n] of nodes) if (!seen.has(id)) { dropRich(n); if (editing && editing.id === id) editing = null; n.root.remove(); nodes.delete(id); }
      if (focusWanted && nodes.has(focusWanted.id)) { const f = focusWanted; focusWanted = null; focusBlock(f.id, f.at); }
    }

    // ----- raw textarea editing (math blocks, unsupported markdown) -----
    function schedulePreview(id, ta, preview) {
      clearTimeout(previewTimers.get(id));
      previewTimers.set(id, setTimeout(() => {
        const b = blockById(id); if (!b) return;
        const v = ta.value;
        if (b.type === "math") {
          preview.hidden = !v.trim();
          if (!v.trim()) return;
          PLMath.render(v, true).then(({ node, error }) => {
            if (ta.value !== v) return;
            preview.textContent = ""; preview.append(node);
            if (error) preview.append(el("div", { class: "nb-err", text: "수식 오류: " + error }));
          });
        } else if (v.includes("$")) {
          preview.hidden = false;
          const tmp = el("div", { class: "md" });
          PLMath.renderRich(tmp, v).then(() => { if (ta.value !== v) return; preview.textContent = ""; preview.append(tmp); });
        } else preview.hidden = true;
      }, 150));
    }
    function autosize(ta) { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight + 2, 420) + "px"; }

    function startEdit(id, at) {
      const n = nodes.get(id), b = blockById(id);
      if (!n || !b) return;
      if (n.rich) { focusBlock(id, at || "end"); return; }
      if (editing && editing.id === id) { if (editing.ta) editing.ta.focus(); return; }
      if (editing) stopEdit();
      const ta = el("textarea", { class: "nb-input", rows: "1", spellcheck: b.type === "math" ? "false" : "true", placeholder: b.type === "math" ? "LaTeX 수식 (예: \\frac{a}{b})" : "" });
      ta.value = b.text || "";
      const preview = el("div", { class: "nb-preview", hidden: "" });
      n.body.textContent = "";
      n.body.className = "nb-body nb-editing nb-" + b.type;
      if (b.type === "text") n.body.append(el("div", { class: "nb-raw-note", text: "표·코드가 있어 원문으로 편집해요" }));
      n.body.append(ta, preview);
      editing = { id, ta, preview };
      autosize(ta);
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      if (ta.value) schedulePreview(id, ta, preview);
      ta.addEventListener("input", () => {
        autosize(ta);
        const cur = blockById(id);
        if (cur && cur.type === "text" && ta.value.trim() === "$$") {
          ta.value = "";
          store.update(id, { type: "math", text: "" });
          n.body.className = "nb-body nb-editing nb-math";
          ta.placeholder = "LaTeX 수식 (예: \\frac{a}{b})";
          preview.hidden = true;
          return;
        }
        store.update(id, { text: ta.value });
        schedulePreview(id, ta, preview);
      });
      ta.addEventListener("keydown", (e) => {
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter" && !e.shiftKey && (b.type === "math" || e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          api.insert({ type: "text", text: "" }, { focus: "start", afterId: id });
        } else if (e.key === "Backspace" && ta.value === "") {
          e.preventDefault();
          editing = null;
          removeAndGoUp(id);
        } else if (e.key === "Escape") ta.blur();
        else if (e.key === "ArrowUp" && ta.selectionStart === 0) { e.preventDefault(); stopEdit(); moveFocus(id, "up"); }
        else if (e.key === "ArrowDown" && ta.selectionEnd === ta.value.length) { e.preventDefault(); stopEdit(); moveFocus(id, "down"); }
      });
      ta.addEventListener("blur", () => setTimeout(() => { if (editing && editing.ta === ta && document.activeElement !== ta) stopEdit(); }, 120));
    }

    function stopEdit() {
      if (!editing) return;
      const { id, rich } = editing;
      editing = null;
      if (rich) { rich.blur(); return; }
      const n = nodes.get(id), b = blockById(id);
      if (n && b) {
        if (canRich(b)) { mountRich(id, n, b.text || ""); n.key = keyOf(b); }
        else { renderBody(b, n.body); n.key = keyOf(b); }
      }
    }

    document.addEventListener("click", (e) => { if (!e.target.closest(".nb-tools")) container.querySelectorAll(".nb-pop").forEach((p) => (p.hidden = true)); });
    // Clicking outside the block being edited ends editing, even if it never had focus.
    document.addEventListener("mousedown", (e) => {
      if (!editing || e.target.closest('.nb[data-id="' + editing.id + '"]')) return;
      if (window.PLRich && window.PLRich.isOwnUi(e.target)) return;
      stopEdit();
    });

    const api = {
      async insert(partial, o) {
        o = o || {};
        const id = await store.add(partial, o.afterId ? { after: o.afterId } : undefined);
        if (o.focus) {
          const at = o.focus === "start" ? "start" : "end";
          if (nodes.has(id)) focusBlock(id, at); else focusWanted = { id, at };
        }
        return id;
      },
      editingId: () => (editing ? editing.id : null),
      editor: () => (editing && editing.rich) || null,
      edit: (id) => startEdit(id),
    };
    // Like Notion: clicking the empty space below the notes starts writing at the end.
    container.addEventListener("click", (e) => {
      if (e.target.closest(".nb, button, a, input, textarea, select")) return;
      if (window.PLRich && window.PLRich.isOwnUi(e.target)) return;
      const last = blocks[blocks.length - 1];
      if (last && last.type === "text" && !String(last.text || "").trim()) focusBlock(last.id, "end");
      else api.insert({ type: "text", text: "" }, { focus: true });
    });
    store.subscribe(sync);
    return api;
  }

  window.PLMath = PLMath;
  window.PLNotesUI = { mount };
})();
