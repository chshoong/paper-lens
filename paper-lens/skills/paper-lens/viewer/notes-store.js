// Paper Lens: note block storage. One API over the artifact db (blocks/{id}) or, without db,
// this browser's localStorage. Local edits are debounced and overlay remote snapshots so a
// block being typed into is never overwritten by someone else's write.
(function () {
  "use strict";
  const DEBOUNCE_MS = 600;
  const nowIso = () => new Date().toISOString();
  const newId = () => "b_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const bodyOf = (b) => { const o = {}; for (const k in b) if (k !== "id" && b[k] !== undefined) o[k] = b[k]; return o; };

  function create({ db, localKey, legacyNotes }) {
    const mode = db ? "db" : "local";
    let remote = new Map();        // id -> block as last known from the backend (plus our own writes)
    const optimistic = new Set();  // ids added here and not yet seen in a snapshot
    const pending = new Map();     // id -> unsaved patch
    const timers = new Map();
    const chains = new Map();      // id -> promise of the last write to that doc
    const listeners = new Set();
    let started = false;

    const list = () => [...remote.values()].map((b) => (pending.has(b.id) ? { ...b, ...pending.get(b.id) } : b))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : 1));
    const emit = () => { const l = list(); listeners.forEach((cb) => { try { cb(l); } catch (e) { console.error(e); } }); };

    // ---- backend ----
    const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
    const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
    const persistLocal = () => lsSet(localKey + ":blocks", [...remote.values()]);

    function chain(id, fn) {
      const p = (chains.get(id) || Promise.resolve()).then(fn, fn);
      chains.set(id, p.catch((e) => console.warn("note write failed", id, e)));
      return p;
    }
    const writeDoc = (id, block) => chain(id, () => (mode === "db" ? db.doc("blocks/" + id).set(bodyOf(block)) : (persistLocal(), Promise.resolve())));
    const deleteDoc = (id) => chain(id, () => (mode === "db" ? db.doc("blocks/" + id).delete() : (persistLocal(), Promise.resolve())));

    async function migrate(existingCount) {
      if (!legacyNotes || !legacyNotes.length || existingCount) return;
      if (mode === "db") {
        const marker = await db.doc("meta/migrated").get();
        if (marker.exists) return;
        await db.doc("meta/migrated").set({ at: nowIso(), count: legacyNotes.length });
      } else {
        if (lsGet(localKey + ":migrated", false)) return;
        lsSet(localKey + ":migrated", true);
      }
      for (const b of window.PLCore.migrateLegacyNotes(legacyNotes, nowIso())) {
        const id = newId();
        const block = { ...b, id };
        remote.set(id, block); optimistic.add(id);
        await writeDoc(id, block);
      }
      emit();
    }

    function start() {
      if (started) return; started = true;
      if (mode === "db") {
        let first = true;
        db.collection("blocks").orderBy("order").onSnapshot((snap) => {
          const next = new Map();
          for (const d of snap.docs) { next.set(d.id, { ...d.data(), id: d.id }); optimistic.delete(d.id); }
          for (const id of optimistic) if (remote.has(id)) next.set(id, remote.get(id));
          remote = next;
          emit();
          if (first) { first = false; migrate(snap.size).catch((e) => console.warn("migration failed", e)); }
        }, (e) => console.warn("notes subscription ended", e));
      } else {
        for (const b of lsGet(localKey + ":blocks", [])) if (b && b.id) remote.set(b.id, b);
        setTimeout(() => { emit(); migrate(remote.size); }, 0);
      }
    }

    // ---- ordering ----
    function orderFor(opts, excludeId) {
      const l = list().filter((b) => b.id !== excludeId);
      const O = window.PLCore.orderBetween;
      if (opts && opts.before) {
        const i = l.findIndex((b) => b.id === opts.before);
        if (i >= 0) return O(i > 0 ? l[i - 1].order : null, l[i].order);
      }
      if (opts && opts.after) {
        const i = l.findIndex((b) => b.id === opts.after);
        if (i >= 0) return O(l[i].order, i + 1 < l.length ? l[i + 1].order : null);
      }
      return O(l.length ? l[l.length - 1].order : null, null);
    }

    // ---- api ----
    function commit(id) {
      clearTimeout(timers.get(id)); timers.delete(id);
      const patch = pending.get(id);
      pending.delete(id);
      const base = remote.get(id);
      if (!patch || !base) return Promise.resolve();
      const full = { ...base, ...patch, updatedAt: nowIso() };
      remote.set(id, full);
      return writeDoc(id, full);
    }
    const flushNow = () => Promise.all([...pending.keys()].map(commit));
    window.addEventListener("pagehide", flushNow);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushNow(); });

    return {
      mode,
      subscribe(cb) { listeners.add(cb); start(); setTimeout(() => cb(list()), 0); return () => listeners.delete(cb); },
      async add(partial, opts) {
        const id = newId(), t = nowIso();
        const block = { type: "text", text: "", by: "me", createdAt: t, updatedAt: t, ...partial, id, order: orderFor(opts) };
        remote.set(id, block); optimistic.add(id);
        emit();
        await writeDoc(id, block);
        return id;
      },
      update(id, patch) {
        if (!remote.has(id)) return;
        pending.set(id, { ...(pending.get(id) || {}), ...patch });
        emit();
        clearTimeout(timers.get(id));
        timers.set(id, setTimeout(() => commit(id), DEBOUNCE_MS));
      },
      flush: () => flushNow().then(() => undefined),
      async remove(id) {
        clearTimeout(timers.get(id)); timers.delete(id); pending.delete(id);
        remote.delete(id); optimistic.delete(id);
        emit();
        await deleteDoc(id);
      },
      async move(id, opts) {
        const b = remote.get(id); if (!b) return;
        const moved = { ...b, ...(pending.get(id) || {}), order: orderFor(opts, id), updatedAt: nowIso() };
        pending.delete(id); clearTimeout(timers.get(id));
        remote.set(id, moved);
        emit();
        await writeDoc(id, moved);
      },
      pendingIds: () => new Set(pending.keys()),
      blocks: list,
    };
  }

  window.PLStore = { create };
})();
