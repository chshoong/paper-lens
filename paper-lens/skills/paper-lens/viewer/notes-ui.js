// Paper Lens: block note editor with LaTeX (MathJax SVG). Click a block to edit its source,
// click away to see it rendered. Text blocks take Markdown with $inline$ / $$display$$ math.
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
      el("p", { text: "여기에 직접 정리해 보세요. 글에는 $x^2$처럼, 따로 둘 수식은 $$ 로 시작하면 돼요." }),
      el("p", { class: "muted", text: "PDF에서 문장을 드래그해 '노트에 인용'하거나, 수식을 캡처해 'LaTeX로 노트에'로 가져올 수도 있어요." }));
    const addBar = el("div", { class: "nb-add" },
      el("button", { type: "button", class: "mini", text: "＋ 글", onclick: () => api.insert({ type: "text", text: "" }, { focus: true }) }),
      el("button", { type: "button", class: "mini", text: "＋ 수식", onclick: () => api.insert({ type: "math", text: "" }, { focus: true }) }));
    container.append(empty, listEl, addBar);

    let blocks = [];
    let editing = null;          // {id, ta, preview}
    const nodes = new Map();     // id -> {root, body, key}
    const previewTimers = new Map();
    let focusWanted = null;

    const blockById = (id) => blocks.find((b) => b.id === id);
    const keyOf = (b) => [b.type, b.text, b.page, b.eq, b.assetId, b.by].join("\u0001");

    function renderBody(b, body) {
      body.textContent = "";
      body.className = "nb-body nb-" + b.type;
      if (b.type === "math") {
        if (!String(b.text || "").trim()) { body.append(el("span", { class: "muted", text: "빈 수식 (눌러서 LaTeX 입력)" })); return; }
        const wrap = el("div", { class: "nb-math" });
        body.append(wrap);
        PLMath.render(b.text, true).then(({ node, error }) => {
          wrap.append(node);
          if (error) body.append(el("div", { class: "nb-err", text: "수식 오류: " + error }));
        });
        if (b.page != null) body.append(el("button", { type: "button", class: "nb-src", text: "p." + b.page + (b.eq ? " · 식 " + b.eq : ""), onclick: (e) => { e.stopPropagation(); opts.onGotoPage && opts.onGotoPage(b.page); } }));
      } else if (b.type === "quote") {
        const q = el("blockquote", { class: "nb-quote" });
        body.append(q);
        PLMath.renderRich(q, b.text || "");
        if (b.page != null) body.append(el("button", { type: "button", class: "nb-src", text: "p." + b.page + " ↗", onclick: (e) => { e.stopPropagation(); opts.onGotoPage && opts.onGotoPage(b.page); } }));
      } else if (b.type === "image") {
        if (b.assetId) body.append(el("img", { src: opts.assetUrl ? opts.assetUrl(b.assetId) : "/_blob/" + b.assetId, alt: "p." + (b.page ?? "?") + " 캡처" }));
        if (b.text) { const cap = el("div", { class: "nb-cap" }); body.append(cap); PLMath.renderRich(cap, b.text); }
        if (b.page != null) body.append(el("button", { type: "button", class: "nb-src", text: "p." + b.page + " ↗", onclick: (e) => { e.stopPropagation(); opts.onGotoPage && opts.onGotoPage(b.page); } }));
      } else {
        if (!String(b.text || "").trim()) { body.append(el("span", { class: "muted", text: "빈 글 (눌러서 쓰기)" })); return; }
        const md = el("div", { class: "md nb-text" });
        body.append(md);
        PLMath.renderRich(md, b.text).then(() => wireCheckboxes(b, md));
      }
    }

    // Task-list checkboxes can be ticked without opening the block: toggle the nth "- [ ]" marker.
    function wireCheckboxes(b, md) {
      md.querySelectorAll('input[type="checkbox"]').forEach((box, n) => {
        box.disabled = false;
        box.addEventListener("click", (e) => {
          e.stopPropagation();
          const cur = blockById(b.id); if (!cur) return;
          let k = -1;
          const text = String(cur.text || "").replace(/^(\s*[-*+] \[)( |x|X)(\] )/gm, (m0, a, v, c) => (++k === n ? a + (v === " " ? "x" : " ") + c : m0));
          store.update(b.id, { text });
        });
      });
    }

    function menuFor(b) {
      const pop = el("div", { class: "nb-pop", hidden: "" });
      const item = (label, fn) => pop.append(el("button", { type: "button", text: label, onclick: (e) => { e.stopPropagation(); pop.hidden = true; fn(); } }));
      const idx = () => blocks.findIndex((x) => x.id === b.id);
      item("위로", () => { const i = idx(); if (i > 0) store.move(b.id, { before: blocks[i - 1].id }); });
      item("아래로", () => { const i = idx(); if (i >= 0 && i + 1 < blocks.length) store.move(b.id, { after: blocks[i + 1].id }); });
      if (b.type === "text" || b.type === "math") item(b.type === "text" ? "수식 블록으로" : "글 블록으로", () => store.update(b.id, { type: b.type === "text" ? "math" : "text" }));
      if (opts.onAskClaude && window.PLBridge) item("Claude에게 묻기", () => opts.onAskClaude(blockById(b.id) || b));
      item("지우기", () => store.remove(b.id));
      const btn = el("button", { type: "button", class: "nb-menu", title: "블록 메뉴", "aria-label": "블록 메뉴", text: "⋯", onclick: (e) => { e.stopPropagation(); container.querySelectorAll(".nb-pop").forEach((p) => p !== pop && (p.hidden = true)); pop.hidden = !pop.hidden; } });
      return el("div", { class: "nb-tools" }, btn, pop);
    }

    function buildNode(b) {
      const body = el("div", { class: "nb-body" });
      const handle = el("span", { class: "nb-handle", title: "끌어서 순서 바꾸기", draggable: "true", text: "⋮⋮" });
      const root = el("div", { class: "nb", "data-id": b.id }, handle, body);
      if (b.by === "claude") root.append(el("span", { class: "nb-by", text: "Claude" }));
      root.append(menuFor(b));
      body.addEventListener("click", (e) => { if (e.target.closest("a,button")) return; startEdit(b.id); });
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
      return { root, body, key: null };
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
        if (!isEditing && n.key !== k) {
          // Rebuild tools when type/by changed so the menu matches.
          n.root.querySelector(".nb-tools").replaceWith(menuFor(b));
          n.root.querySelector(".nb-by")?.remove();
          if (b.by === "claude") n.root.insertBefore(el("span", { class: "nb-by", text: "Claude" }), n.root.querySelector(".nb-tools"));
          renderBody(b, n.body);
          n.key = k;
        }
        n.root.classList.toggle("nb-is-math", b.type === "math");
        const want = prev ? prev.nextSibling : listEl.firstChild;
        if (want !== n.root) listEl.insertBefore(n.root, want);
        prev = n.root;
      }
      for (const [id, n] of nodes) if (!seen.has(id)) { if (editing && editing.id === id) editing = null; n.root.remove(); nodes.delete(id); }
      if (focusWanted && nodes.has(focusWanted)) { const id = focusWanted; focusWanted = null; startEdit(id); }
    }

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
        } else {
          preview.hidden = true;
        }
      }, 150));
    }

    function autosize(ta) { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight + 2, 420) + "px"; }

    function startEdit(id) {
      if (editing && editing.id === id) { if (editing.rich) editing.rich.quill.focus(); else editing.ta.focus(); return; }
      if (editing) stopEdit();
      const n = nodes.get(id), b = blockById(id);
      if (!n || !b) return;
      if (b.type === "text" && window.PLRich && window.PLRichConvert && window.PLRichConvert.roundTrips(b.text || "")) { startRich(id, n, b); return; }
      const ta = el("textarea", { class: "nb-input", rows: "1", spellcheck: b.type === "math" ? "false" : "true", placeholder: b.type === "math" ? "LaTeX 수식 (예: \\frac{a}{b})" : "글 쓰기. 수식은 $x^2$, Enter는 새 블록" });
      ta.value = b.text || "";
      const preview = el("div", { class: "nb-preview", hidden: "" });
      n.body.textContent = "";
      n.body.className = "nb-body nb-editing nb-" + b.type;
      if (b.type === "text") n.body.append(el("div", { class: "nb-raw-note", text: "이 블록은 원문으로 편집돼요 (표·코드처럼 꾸밈 편집기가 다루지 않는 내용이 있어요)" }));
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
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          api.insert({ type: "text", text: "" }, { focus: true, afterId: id });
        } else if (e.key === "Backspace" && ta.value === "") {
          e.preventDefault();
          const i = blocks.findIndex((x) => x.id === id);
          const prevId = i > 0 ? blocks[i - 1].id : null;
          editing = null;
          store.remove(id);
          if (prevId) setTimeout(() => startEdit(prevId), 0);
        } else if (e.key === "Escape") {
          ta.blur();
        }
      });
      ta.addEventListener("blur", () => setTimeout(() => { if (editing && editing.ta === ta && document.activeElement !== ta) stopEdit(); }, 120));
    }

    function startRich(id, n, b) {
      n.body.textContent = "";
      n.body.className = "nb-body nb-editing nb-rich-host";
      let rich = null;
      const removeAndGoUp = () => {
        const i = blocks.findIndex((x) => x.id === id);
        const prevId = i > 0 ? blocks[i - 1].id : null;
        if (rich) { rich.destroy(); rich = null; }
        editing = null;
        store.remove(id);
        if (prevId) setTimeout(() => startEdit(prevId), 0);
      };
      rich = window.PLRich.mount(n.body, b.text || "", {
        onChange: (t) => {
          if (!rich) return; // closing after the block became a math block
          if (rich.quill.getText().trim() === "$$") { toMath(); return; }
          store.update(id, { text: t });
        },
        onExit: () => stopEdit(),
        onNewBlockBelow: () => api.insert({ type: "text", text: "" }, { focus: true, afterId: id }),
        onBackspaceEmpty: removeAndGoUp,
        onMathBlockBelow: () => {
          if (rich && !rich.getText().trim()) toMath();
          else api.insert({ type: "math", text: "" }, { focus: true, afterId: id });
        },
      });
      function toMath() {
        const r = rich; rich = null; editing = null;
        if (r) r.destroy();
        store.update(id, { type: "math", text: "" });
        setTimeout(() => startEdit(id), 0);
      }
      editing = { id, rich };
      rich.focus();
    }

    function stopEdit() {
      if (!editing) return;
      const { id, rich } = editing;
      editing = null;
      if (rich) rich.destroy();
      const n = nodes.get(id), b = blockById(id);
      if (n && b) { renderBody(b, n.body); n.key = keyOf(b); }
    }

    document.addEventListener("click", (e) => { if (!e.target.closest(".nb-tools")) container.querySelectorAll(".nb-pop").forEach((p) => (p.hidden = true)); });
    // Clicking anywhere outside the block being edited ends editing, even if the textarea never had focus.
    document.addEventListener("mousedown", (e) => {
      if (!editing || e.target.closest('.nb[data-id="' + editing.id + '"]')) return;
      if (window.PLRich && window.PLRich.isOwnUi(e.target)) return;
      stopEdit();
    });

    const api = {
      async insert(partial, o) {
        o = o || {};
        const id = await store.add(partial, o.afterId ? { after: o.afterId } : undefined);
        if (o.focus) { if (nodes.has(id)) startEdit(id); else focusWanted = id; }
        return id;
      },
      editingId: () => (editing ? editing.id : null),
      editor: () => (editing && editing.rich) || null,
      edit: (id) => startEdit(id),
    };
    store.subscribe(sync);
    return api;
  }

  window.PLMath = PLMath;
  window.PLNotesUI = { mount };
})();
