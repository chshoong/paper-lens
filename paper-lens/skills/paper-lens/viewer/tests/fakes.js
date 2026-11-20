// Fake window.claude for local development and UI checks. Never shipped in a published bundle.
// Disable a capability with ?disable=db,room (comma list) on the dev page URL.
(function () {
  "use strict";
  const params = new URLSearchParams(location.search);
  const F = (window.__fake = {
    disable: (params.get("disable") || "").split(",").filter(Boolean),
    sampleReplies: [],
    sampleCalls: [],
    presence: null,
    canSend: "available",
    sent: [],
    saved: [],
    uploads: [],
    errors: [],
  });
  window.addEventListener("error", (e) => F.errors.push(String(e.message || e)));
  window.addEventListener("unhandledrejection", (e) => F.errors.push("unhandled: " + String((e.reason && (e.reason.message || e.reason.code)) || e.reason)));

  // ---------- sample ----------
  const pick = (input) => {
    const text = typeof input === "string" ? input : JSON.stringify(input);
    const hit = F.sampleReplies.find((r) => r.match.test(text));
    return hit ? hit.reply : "테스트 응답";
  };
  async function sample(input, opts = {}) {
    F.sampleCalls.push({ input, opts });
    await new Promise((r) => setTimeout(r, 10));
    const reply = pick(input);
    const text = typeof reply === "string" ? reply : JSON.stringify(reply);
    opts.onText && opts.onText({ text, delta: text });
    return { text, truncated: false, modelTierApplied: opts.modelTier || "default" };
  }
  sample.json = async (input, opts = {}) => {
    F.sampleCalls.push({ input, opts, json: true });
    await new Promise((r) => setTimeout(r, 10));
    const reply = pick(input);
    return typeof reply === "string" ? JSON.parse(reply === "테스트 응답" ? "{}" : reply) : reply;
  };
  sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 20e6, mediaTypes: ["image/png", "image/jpeg"] } });

  // ---------- db (in-memory, db.d.ts shapes) ----------
  const store = new Map(); // path -> data
  const listeners = new Set(); // {kind:"doc"|"query", path, order, cb}
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const snapDoc = (path) => {
    const d = store.get(path);
    return { id: path.split("/").pop(), exists: d !== undefined, data: () => (d === undefined ? undefined : Object.freeze(clone(d))), metadata: { fromCache: false, hasPendingWrites: false } };
  };
  const childrenOf = (col) => [...store.keys()].filter((k) => k.startsWith(col + "/") && k.split("/").length === col.split("/").length + 1);
  const snapQuery = (col, order) => {
    let keys = childrenOf(col);
    keys.sort((a, b) => {
      if (order) {
        const va = store.get(a)[order.field], vb = store.get(b)[order.field];
        if (va !== vb) return (va === undefined ? 1 : vb === undefined ? -1 : va < vb ? -1 : 1) * (order.dir === "desc" ? -1 : 1);
      }
      return a < b ? -1 : 1;
    });
    const docs = keys.map(snapDoc);
    return { docs, size: docs.length, empty: !docs.length, docChanges: () => docs.map((doc, i) => ({ type: "added", doc, oldIndex: -1, newIndex: i })), metadata: { fromCache: false, hasPendingWrites: false } };
  };
  const notify = (path) => {
    setTimeout(() => {
      for (const l of listeners) {
        if (l.kind === "doc" && l.path === path) l.cb(snapDoc(path));
        if (l.kind === "query" && path.startsWith(l.path + "/") && path.split("/").length === l.path.split("/").length + 1) l.cb(snapQuery(l.path, l.order));
      }
    }, 0);
  };
  const write = (path, data) => { store.set(path, clone(data)); F.dbWrites = (F.dbWrites || 0) + 1; notify(path); };
  const merge = (a, b) => { const o = { ...a }; for (const k in b) o[k] = b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a[k] && typeof a[k] === "object" ? merge(a[k], b[k]) : b[k]; return o; };
  let idn = 0;
  const docRef = (path) => ({
    id: path.split("/").pop(), path,
    get: async () => snapDoc(path),
    set: async (data) => { write(path, data); },
    update: async (data) => { if (!store.has(path)) throw { code: "invalid_argument", message: "missing" }; write(path, merge(store.get(path), data)); },
    delete: async () => { store.delete(path); notify(path); },
    onSnapshot(cb) { const l = { kind: "doc", path, cb }; listeners.add(l); setTimeout(() => cb(snapDoc(path)), 0); return () => listeners.delete(l); },
    collection: (sub) => colRef(path + "/" + sub),
  });
  const query = (path, order) => ({
    orderBy: (field, dir) => query(path, { field, dir }),
    where: () => query(path, order),
    limit: () => query(path, order),
    get: async () => snapQuery(path, order),
    onSnapshot(cb) { const l = { kind: "query", path, order, cb }; listeners.add(l); setTimeout(() => cb(snapQuery(path, order)), 0); return () => listeners.delete(l); },
  });
  const colRef = (path) => Object.assign(query(path), {
    path,
    doc: (id) => docRef(path + "/" + (id || "fake" + ++idn)),
    add: async (data) => { const r = docRef(path + "/fake" + ++idn); await r.set(data); return r; },
  });
  const db = { doc: docRef, collection: colRef };
  F.db = { write, get: (p) => (store.has(p) ? clone(store.get(p)) : undefined), keys: () => [...store.keys()], store };

  // ---------- others ----------
  let an = 0;
  const assets = { upload: async (blob) => { const id = "a" + String(++an).padStart(31, "0"); const url = URL.createObjectURL(blob); F.uploads.push({ id, blob }); return { id, url, sizeBytes: blob.size, contentType: blob.type }; } };
  const user = { id: async () => "u1", me: async () => ({ id: "u1" }), isOwner: () => true, canEdit: () => true, can: () => true };
  const room = {
    presence: async (p) => { F.presence = { ...(F.presence || {}), ...p }; },
    canSendToClaudeSession: async () => F.canSend,
    sendToClaudeSession: (data, opts) => {
      if (!/^available/.test(F.canSend)) return Promise.reject({ code: "claude_unavailable", message: "no session" });
      F.sent.push({ data, opts: opts || {} });
      return Promise.resolve({ to: "pane" });
    },
    on: () => () => {}, emit: async () => {}, onPeers: () => () => {},
  };
  const downloads = { save: async (req) => { F.saved.push(req); return { status: "saved" }; } };

  const caps = { sample, db, assets, user, room, downloads };
  window.claude = { use: async (name) => (F.disable.includes(name) ? null : caps[name] || null) };
})();
