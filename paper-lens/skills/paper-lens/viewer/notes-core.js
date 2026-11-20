// Paper Lens: pure helpers for notes, export and the chat bridge. No DOM, no network.
(function () {
  "use strict";

  function orderBetween(a, b) {
    if (a == null && b == null) return 1;
    if (a == null) return b - 1;
    if (b == null) return a + 1;
    return (a + b) / 2;
  }

  // Split text into plain text, $inline$ and $$display$$ math.
  // A single $ opens math only when followed by a non-space and closes only after a non-space and
  // not right before a digit (so "$5–$10" stays text).
  // \$ is a literal dollar.
  function splitMath(s) {
    s = String(s || "");
    const out = [];
    let buf = "";
    const flush = () => { if (buf) { out.push({ kind: "text", value: buf }); buf = ""; } };
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === "\\" && s[i + 1] === "$") { buf += "$"; i += 2; continue; }
      if (c === "$" && s[i + 1] === "$") {
        const j = s.indexOf("$$", i + 2);
        if (j > i + 2) { flush(); out.push({ kind: "display", value: s.slice(i + 2, j).trim() }); i = j + 2; continue; }
        buf += "$$"; i += 2; continue;
      }
      if (c === "$") {
        const next = s[i + 1];
        let j = -1;
        if (next && !/\s/.test(next)) {
          for (let k = i + 1; k < s.length; k++) {
            if (s[k] === "$" && s[k - 1] !== "\\" && !/\s/.test(s[k - 1]) && s[k + 1] !== "$" && !/\d/.test(s[k + 1] || "")) { j = k; break; }
          }
        }
        if (j > i + 1) { flush(); out.push({ kind: "inline", value: s.slice(i + 1, j) }); i = j + 1; continue; }
        buf += "$"; i += 1; continue;
      }
      buf += c; i += 1;
    }
    flush();
    return out;
  }

  const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

  function blocksToMarkdown(blocks, meta) {
    const parts = ["# " + ((meta && meta.title) || "논문 노트")];
    if (meta && meta.source) parts.push("출처: " + meta.source);
    for (const b of [...(blocks || [])].sort(byOrder)) {
      const text = String(b.text || "");
      if (b.type === "math") {
        let s = "$$\n" + text + "\n$$";
        if (b.page != null) s += "\n*(p." + b.page + (b.eq ? ", 식 " + b.eq : "") + ")*";
        parts.push(s);
      } else if (b.type === "quote") {
        parts.push(text.split("\n").map((l) => "> " + l).join("\n") + (b.page != null ? "\n> — p." + b.page : ""));
      } else if (b.type === "image") {
        parts.push("*(그림: p." + (b.page ?? "?") + " 캡처)*");
      } else if (text.trim()) {
        parts.push(text);
      }
    }
    return parts.join("\n\n") + "\n";
  }

  function migrateLegacyNotes(legacy, now) {
    const out = [];
    const push = (b) => out.push({ by: "me", createdAt: now, updatedAt: now, ...b, order: out.length + 1 });
    for (const n of legacy || []) {
      if (!n) continue;
      if (n.quote) {
        push({ type: "quote", text: n.quote, page: n.page ?? null, rects: n.rects || null });
        if (n.memo) push({ type: "text", text: "메모: " + n.memo, page: n.page ?? null });
      } else if (n.answer) {
        let text = "**" + (n.label || "노트") + "**" + (n.page != null ? " (p." + n.page + ")" : "") + "\n\n" + n.answer;
        if (n.memo) text += "\n\n메모: " + n.memo;
        push({ type: "text", text, page: n.page ?? null });
      } else if (n.memo) {
        push({ type: "text", text: "메모: " + n.memo, page: n.page ?? null });
      }
    }
    return out;
  }

  function stripDelims(s) {
    s = String(s).trim();
    const fence = s.match(/^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/);
    if (fence) s = fence[1].trim();
    for (const [a, b] of [["$$", "$$"], ["\\[", "\\]"], ["$", "$"]]) {
      if (s.startsWith(a) && s.endsWith(b) && s.length > a.length + b.length) { s = s.slice(a.length, s.length - b.length).trim(); break; }
    }
    return s;
  }

  function parseLatexReply(v) {
    let latex = null, eq = null;
    if (typeof v === "string") latex = v;
    else if (v && typeof v === "object" && typeof v.latex === "string") { latex = v.latex; eq = v.eq ?? v.eqNumber ?? null; }
    if (latex == null) return null;
    latex = stripDelims(latex);
    if (!latex) return null;
    eq = eq == null ? null : String(eq).replace(/[()\s]/g, "") || null;
    return { latex, eq };
  }

  // Controls, private-use and format characters are refused by sendToClaudeSession; pdf.js text
  // often carries private-use glyphs from math fonts. Keep tab/newline and the ZWNJ/ZWJ joiners.
  const REFUSED = /[\p{Cc}\p{Co}\p{Cf}]/gu;
  const KEEP = new Set(["\t", "\n", "\r", "\u200C", "\u200D"]);
  function clean(v) {
    if (typeof v === "string") return v.replace(REFUSED, (c) => (KEEP.has(c) ? c : ""));
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === "object") { const o = {}; for (const k in v) if (v[k] !== undefined) o[k] = clean(v[k]); return o; }
    return v;
  }
  const bytes = (o) => new TextEncoder().encode(JSON.stringify(o)).length;

  function toClaudePayload(obj, maxBytes) {
    maxBytes = maxBytes || 4000;
    const p = clean(obj || {});
    for (let guard = 0; guard < 40 && bytes(p) > maxBytes; guard++) {
      // Shorten the longest top-level string field.
      let key = null;
      for (const k in p) if (typeof p[k] === "string" && (key == null || p[k].length > p[key].length)) key = k;
      if (key == null || p[key].length < 8) break;
      const over = bytes(p) - maxBytes;
      const cut = Math.max(Math.ceil(over / 2) + 2, Math.floor(p[key].length * 0.2));
      p[key] = p[key].slice(0, Math.max(0, p[key].length - cut)) + "…";
    }
    return p;
  }

  function sectionForPage(outline, page) {
    const secs = outline && Array.isArray(outline.sections) ? outline.sections : null;
    if (!secs || !(page >= 1)) return null;
    let hit = null;
    for (const s of secs) if ((s.page ?? Infinity) <= page) hit = s;
    return hit;
  }

  window.PLCore = { orderBetween, splitMath, blocksToMarkdown, migrateLegacyNotes, parseLatexReply, toClaudePayload, sectionForPage };
})();
