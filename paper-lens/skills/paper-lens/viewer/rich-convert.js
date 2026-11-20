// Paper Lens: Markdown (notes' stored form) <-> Quill Delta (rich editor), for a small normal form:
// #..### headings, **b** *i* ~~s~~ `c`, [t](url), - / 1. / - [ ] lists (one indent level of 2 spaces),
// > quote, $math$, <u>, <span data-c>, <mark data-c>, <span data-s>, one blank line between blocks,
// "<br>" for an empty paragraph. Anything else does not survive a round trip, and the notes editor
// then opens the block as raw text instead (roundTrips()).
(function () {
  "use strict";
  const COLORS = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "red"];
  const SIZES = ["small", "large"];

  // ---------------- Markdown -> Delta ----------------
  const ESCAPABLE = new Set(["\\", "*", "_", "`", "~", "[", "]", "$", "#", ">", "-", "+", "."]);
  const ENTITIES = { "&lt;": "<", "&gt;": ">", "&amp;": "&" };

  // Does a $...$ inline math span start at i? Same rule as PLCore.splitMath. Returns end index or -1.
  function mathEnd(s, i) {
    if (s[i] !== "$" || s[i + 1] === "$" || s[i - 1] === "$") return -1;
    const next = s[i + 1];
    if (!next || /\s/.test(next)) return -1;
    for (let k = i + 1; k < s.length; k++) {
      if (s[k] === "$" && s[k - 1] !== "\\" && s[k - 1] !== "$" && !/\s/.test(s[k - 1]) && s[k + 1] !== "$" && !/\d/.test(s[k + 1] || "")) return k > i + 1 ? k : -1;
    }
    return -1;
  }

  const OPEN_TAGS = [
    { re: /^<u>/, close: "</u>", attr: () => ({ underline: true }) },
    { re: /^<span data-c="([a-z]+)">/, close: "</span>", attr: (m) => (COLORS.includes(m[1]) ? { color: m[1] } : null) },
    { re: /^<mark data-c="([a-z]+)">/, close: "</mark>", attr: (m) => (COLORS.includes(m[1]) ? { highlight: m[1] } : null) },
    { re: /^<span data-s="([a-z]+)">/, close: "</span>", attr: (m) => (SIZES.includes(m[1]) ? { size: m[1] } : null) },
  ];

  // Parse inline markdown from i until `stop` (or end). Returns {ops, i, closed}.
  function parseInline(s, i, attrs, stop) {
    const ops = [];
    const text = (t) => {
      if (!t) return;
      const last = ops[ops.length - 1];
      if (last && typeof last.insert === "string" && sameAttrs(last.attributes, attrs)) last.insert += t;
      else ops.push(attrs && Object.keys(attrs).length ? { insert: t, attributes: { ...attrs } } : { insert: t });
    };
    const nest = (from, extra, close) => {
      const sub = parseInline(s, from, { ...attrs, ...extra }, close);
      if (!sub.closed) return null;
      for (const op of sub.ops) {
        const last = ops[ops.length - 1];
        if (last && typeof last.insert === "string" && typeof op.insert === "string" && sameAttrs(last.attributes, op.attributes)) last.insert += op.insert;
        else ops.push(op);
      }
      return sub.i;
    };
    while (i < s.length) {
      // Bold first, so "*a **b** c*" nests correctly.
      if (s.startsWith("**", i) && stop !== "**") { const j = nest(i + 2, { bold: true }, "**"); if (j != null) { i = j; continue; } }
      if (stop && s.startsWith(stop, i)) return { ops, i: i + stop.length, closed: true };
      const c = s[i];
      if (c === "\\" && ESCAPABLE.has(s[i + 1])) { text(s[i + 1]); i += 2; continue; }
      if (c === "&") { const ent = Object.keys(ENTITIES).find((e) => s.startsWith(e, i)); if (ent) { text(ENTITIES[ent]); i += ent.length; continue; } }
      if (s.startsWith("~~", i)) { const j = nest(i + 2, { strike: true }, "~~"); if (j != null) { i = j; continue; } }
      if (c === "*" && !s.startsWith("**", i)) { const j = nest(i + 1, { italic: true }, "*"); if (j != null) { i = j; continue; } }
      if (c === "`") { const k = s.indexOf("`", i + 1); if (k > i + 1) { const save = attrs; attrs = { ...attrs, code: true }; text(s.slice(i + 1, k)); attrs = save; i = k + 1; continue; } }
      if (c === "$") { const k = mathEnd(s, i); if (k > 0) { ops.push(attrs && Object.keys(attrs).length ? { insert: { mathInline: s.slice(i + 1, k) }, attributes: { ...attrs } } : { insert: { mathInline: s.slice(i + 1, k) } }); i = k + 1; continue; } }
      if (c === "[") {
        const m = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(s.slice(i));
        if (m) { const sub = parseInline(m[1], 0, { ...attrs, link: m[2] }, null); sub.ops.forEach((o) => ops.push(o)); i += m[0].length; continue; }
      }
      if (c === "<") {
        let done = false;
        for (const t of OPEN_TAGS) {
          const m = t.re.exec(s.slice(i));
          if (!m) continue;
          const a = t.attr(m);
          if (!a) break;
          const j = nest(i + m[0].length, a, t.close);
          if (j != null) { i = j; done = true; }
          break;
        }
        if (done) continue;
      }
      text(c); i += 1;
    }
    return { ops, i, closed: !stop };
  }

  function sameAttrs(a, b) {
    const ka = a ? Object.keys(a) : [], kb = b ? Object.keys(b) : [];
    return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
  }

  const LIST_RE = /^( {2})?(?:- \[( |x)\] |(- )|(\d+)\. )(.*)$/;

  function mdToDelta(text) {
    const ops = [];
    const line = (inline, lineAttrs) => {
      parseInline(inline, 0, {}, null).ops.forEach((o) => ops.push(o));
      ops.push(lineAttrs ? { insert: "\n", attributes: lineAttrs } : { insert: "\n" });
    };
    const src = normalize(text);
    if (!src) return { ops: [{ insert: "\n" }] };
    for (const block of src.split(/\n\n/)) {
      const lines = block.split("\n");
      if (lines.every((l) => LIST_RE.test(l))) {
        for (const l of lines) {
          const m = LIST_RE.exec(l);
          const a = { list: m[2] != null ? (m[2] === "x" ? "checked" : "unchecked") : m[3] ? "bullet" : "ordered" };
          if (m[1]) a.indent = 1;
          line(m[5], a);
        }
        continue;
      }
      const one = lines.join(" ");
      let m;
      if (lines.length === 1 && (m = /^(#{1,3}) (.*)$/.exec(one))) line(m[2], { header: m[1].length });
      else if (lines.length === 1 && (m = /^> (.*)$/.exec(one))) line(m[1], { blockquote: true });
      else if (one === "<br>") ops.push({ insert: "\n" });
      else line(one, null);
    }
    return { ops };
  }

  // ---------------- Delta -> Markdown ----------------
  // Wrapper order, outermost first.
  const WRAP = [
    ["link", (v) => ["[", "](" + v + ")"]],
    ["size", (v) => ['<span data-s="' + v + '">', "</span>"]],
    ["color", (v) => ['<span data-c="' + v + '">', "</span>"]],
    ["highlight", (v) => ['<mark data-c="' + v + '">', "</mark>"]],
    ["underline", () => ["<u>", "</u>"]],
    ["strike", () => ["~~", "~~"]],
    ["bold", () => ["**", "**"]],
    ["italic", () => ["*", "*"]],
  ];

  function escapeText(t, atLineStart) {
    let out = "";
    for (let i = 0; i < t.length; i++) {
      const c = t[i], prev = t[i - 1], next = t[i + 1];
      if (c === "\\" || c === "*" || c === "`" || c === "~") out += "\\" + c;
      else if (c === "_" && !(/[\p{L}\p{N}]/u.test(prev || "") && /[\p{L}\p{N}]/u.test(next || ""))) out += "\\_";
      else if (c === "[" && /^\[[^\]]*\]\(/.test(t.slice(i))) out += "\\[";
      else if (c === "&" && /^&(#\d+|#x[\da-f]+|[a-z]+);/i.test(t.slice(i))) out += "&amp;";
      else if (c === "<" && /[A-Za-z/!?]/.test(next || "")) out += "&lt;";
      else out += c;
    }
    // A $ that would start math is escaped; prices and lone dollars stay as typed.
    if (out.includes("$")) {
      let fixed = "", i = 0;
      while (i < out.length) {
        if (out[i] === "$" && out[i - 1] !== "\\" && (out[i + 1] === "$" || mathEnd(out, i) > 0)) { fixed += "\\$"; i++; continue; }
        fixed += out[i++];
      }
      out = fixed;
    }
    if (atLineStart) {
      out = out.replace(/^(#|>|[-+](?= |$))/, "\\$1").replace(/^(\d+)\. /, "$1\\. ");
    }
    return out;
  }

  function inlineToMd(segs) {
    let out = "";
    const stack = []; // [key, value, closeStr]
    const want = (a) => WRAP.filter(([k]) => a && a[k] != null && a[k] !== false).map(([k, f]) => [k, a[k], f(a[k])]);
    segs.forEach((seg, idx) => {
      const w = want(seg.attributes);
      // Keep the longest prefix of the open stack that is still wanted, in order.
      let keep = 0;
      while (keep < stack.length && w.some(([k, v]) => k === stack[keep][0] && v === stack[keep][1])) keep++;
      while (stack.length > keep) out += stack.pop()[2][1];
      for (const [k, v, wrap] of w) if (!stack.some((s) => s[0] === k)) { out += wrap[0]; stack.push([k, v, wrap]); }
      if (seg.math != null) out += "$" + seg.math + "$";
      else if (seg.attributes && seg.attributes.code) out += "`" + seg.text + "`";
      else out += escapeText(seg.text, idx === 0 && out === "");
    });
    while (stack.length) out += stack.pop()[2][1];
    return out;
  }

  function deltaToMd(delta) {
    const lines = [];
    let segs = [];
    for (const op of (delta && delta.ops) || []) {
      if (typeof op.insert === "string") {
        const parts = op.insert.split("\n");
        parts.forEach((p, k) => {
          if (p) segs.push({ text: p, attributes: op.attributes });
          if (k < parts.length - 1) { lines.push({ segs, attrs: op.insert === "\n" ? op.attributes || null : null }); segs = []; }
        });
      } else if (op.insert && op.insert.mathInline != null) {
        segs.push({ math: op.insert.mathInline, attributes: op.attributes });
      }
    }
    if (segs.length) lines.push({ segs, attrs: null });
    // Drop leading/trailing empty paragraphs (Quill always ends with one).
    const empty = (l) => !l.attrs && !l.segs.length;
    while (lines.length && empty(lines[lines.length - 1])) lines.pop();
    while (lines.length && empty(lines[0])) lines.shift();

    const blocks = [];
    const counters = {};
    let prevList = false;
    for (const l of lines) {
      const a = l.attrs || {};
      const body = inlineToMd(l.segs);
      if (a.list) {
        const ind = a.indent ? 1 : 0;
        if (!prevList) for (const k in counters) delete counters[k];
        if (a.list === "ordered") counters[ind] = (counters[ind] || 0) + 1; else delete counters[ind];
        if (ind === 0) delete counters[1];
        const marker = a.list === "checked" ? "- [x] " : a.list === "unchecked" ? "- [ ] " : a.list === "bullet" ? "- " : counters[ind] + ". ";
        const item = (ind ? "  " : "") + marker + body;
        if (prevList) blocks[blocks.length - 1] += "\n" + item; else blocks.push(item);
        prevList = true;
        continue;
      }
      prevList = false;
      if (a.header) blocks.push("#".repeat(Math.min(3, a.header)) + " " + body);
      else if (a.blockquote) blocks.push("> " + body);
      else blocks.push(body || "<br>");
    }
    return blocks.join("\n\n");
  }

  function normalize(text) {
    return String(text || "").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
  }
  const roundTrips = (text) => { try { return deltaToMd(mdToDelta(text)) === normalize(text); } catch { return false; } };

  window.PLRichConvert = { mdToDelta, deltaToMd, normalize, roundTrips, COLORS, SIZES };
})();
