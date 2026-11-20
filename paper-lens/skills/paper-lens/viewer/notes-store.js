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

    // Writes to one document run one at a time. A failed write is retried once; if it fails again the
    // block is kept in `failed` (shown to the reader with a retry) until a later write of it succeeds.
    const failed = new Map();      // id -> latest block that could not be saved
    let inflight = 0;
    const statusCbs = new Set();
    const tellStatus = () => statusCbs.forEach((cb) => { try { cb(); } catch {} });
    const RETRYABLE = new Set(["unavailable", "upstream_error", "deadline_exceeded", "resource_exhausted", "aborted", undefined]);
    function attempt(id, block, retried) {
      if (mode !== "db") { persistLocal(); failed.delete(id); return Promise.resolve(); }
      inflight++; tellStatus();
      return db.doc("blocks/" + id).set(bodyOf(block)).then(
        () => { inflight--; failed.delete(id); tellStatus(); },
        (e) => {
          inflight--;
          if (!retried && RETRYABLE.has(e && e.code)) {
            return new Promise((r) => setTimeout(r, 300 + Math.random() * 400)).then(() => attempt(id, block, true));
          }
          console.warn("note write failed", id, e);
          failed.set(id, block); tellStatus();
        });
    }
    function chain(id, fn) {
      const p = (chains.get(id) || Promise.resolve()).then(fn, fn).catch(() => {});
      chains.set(id, p);
      return p;
    }
    const writeDoc = (id, block) => chain(id, () => attempt(id, block, false));
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
    function neighbours(opts, l) {
      if (opts && opts.before) { const i = l.findIndex((b) => b.id === opts.before); if (i >= 0) return [i > 0 ? l[i - 1].order : null, l[i].order]; }
      if (opts && opts.after) { const i = l.findIndex((b) => b.id === opts.after); if (i >= 0) return [l[i].order, i + 1 < l.length ? l[i + 1].order : null]; }
      return [l.length ? l[l.length - 1].order : null, null];
    }
    // Midpoints halve the gap on every insert at the same spot; renumber before they run out of precision.
    function renumber(excludeId) {
      list().filter((b) => b.id !== excludeId).forEach((b, i) => {
        if (b.order === i + 1) return;
        const nb = { ...remote.get(b.id), order: i + 1 };
        remote.set(b.id, nb);
        writeDoc(b.id, nb);
      });
    }
    function orderFor(opts, excludeId) {
      let [lo, hi] = neighbours(opts, list().filter((b) => b.id !== excludeId));
      if (lo != null && hi != null && hi - lo < 1e-6) {
        renumber(excludeId);
        [lo, hi] = neighbours(opts, list().filter((b) => b.id !== excludeId));
      }
      return window.PLCore.orderBetween(lo, hi);
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
    // Leaving the page: issue every unsaved edit right now instead of queueing it behind a write in
    // flight (the page may be gone before that one is acknowledged). The latest full block wins.
    function flushLeaving() {
      for (const id of [...pending.keys()]) {
        clearTimeout(timers.get(id)); timers.delete(id);
        const base = remote.get(id);
        const full = base && { ...base, ...pending.get(id), updatedAt: nowIso() };
        pending.delete(id);
        if (!full) continue;
        remote.set(id, full);
        if (mode === "db") db.doc("blocks/" + id).set(bodyOf(full)).catch(() => { failed.set(id, full); tellStatus(); });
        else persistLocal();
      }
    }
    window.addEventListener("pagehide", flushLeaving);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushLeaving(); });

    return {
      mode,
      subscribe(cb) { listeners.add(cb); start(); setTimeout(() => cb(list()), 0); return () => listeners.delete(cb); },
      async add(partial, opts) {
        const id = newId(), t = nowIso();
        const block = { type: "text", text: "", by: "me", createdAt: t, updatedAt: t, ...partial, id, order: orderFor(opts) };
        remote.set(id, block); optimistic.add(id);
        emit();
        writeDoc(id, block); // in the background, so the caller can focus the new block at once
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
      status: () => ({ pending: new Set(pending.keys()), inflight, failed: new Set(failed.keys()) }),
      onStatus(cb) { statusCbs.add(cb); return () => statusCbs.delete(cb); },
      retryFailed() {
        const ids = [...failed.keys()];
        return Promise.all(ids.map((id) => {
          const b = remote.get(id);
          if (!b) { failed.delete(id); return null; }
          return chain(id, () => attempt(id, { ...b, updatedAt: nowIso() }, false));
        })).then(tellStatus);
      },
      blocks: list,
    };
  }

  window.PLStore = { create };
})();
