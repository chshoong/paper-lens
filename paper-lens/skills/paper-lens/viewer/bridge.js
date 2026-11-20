// Paper Lens: link between this page and the reader's Claude chat beside it.
// - send(): hands a selection / section / question to the chat (room.sendToClaudeSession). It must be
//   called straight from a click, with nothing awaited before it. Without a chat session it saves the
//   ask to db `state/ask` so Claude can pick it up when the reader says "이거 설명해줘".
// - setPosition(): shares where the reader is (presence + db `state/now`, at most every 5 s).
// - onOutline()/onExplanations(): the outline and per-section summaries Claude writes to db.
(function () {
  "use strict";
  const STATE_EVERY_MS = 5000;
  const nowIso = () => new Date().toISOString();
  const LABELS = {
    explain_section: "이 절 설명", explain_page: "이 쪽 설명", explain: "설명", easy: "쉽게 풀기", why: "왜 중요해?",
    ask: "질문", note: "노트 블록", preset: "요청", figure: "그림·표 해석",
  };

  async function init({ room, db, paper }) {
    let can = "off";
    let outline = null;
    let position = { page: 1 };
    let lastStateAt = 0, stateTimer = null;
    const outlineCbs = new Set(), explCbs = new Set();
    let explanations = {};

    const compact = (sec) => (sec ? { id: sec.id, num: sec.num, title: String(sec.title || "").slice(0, 200), page: sec.page } : null);
    const currentSection = () => window.PLCore.sectionForPage(outline, position.page);

    async function refreshCanSend() {
      try { can = room && room.canSendToClaudeSession ? await room.canSendToClaudeSession() : "off"; } catch { can = "off"; }
      return can;
    }
    await refreshCanSend();
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshCanSend(); });

    async function saveAsk(data) {
      if (!db) return false;
      try { await db.doc("state/ask").set({ ...data, ask: true, at: nowIso() }); return true; } catch { return false; }
    }

    function send(data, deliver) {
      const section = data.section || compact(currentSection());
      const payload = window.PLCore.toClaudePayload({
        label: "Paper Lens · " + (LABELS[data.kind] || "요청") + (section ? " · " + (section.num ? section.num + " " : "") + section.title : ""),
        paperTitle: paper.title, page: position.page, ...data, section,
      });
      const usable = room && room.sendToClaudeSession && (can === "available" || can === "available_if_opened" || (can === "available_if_summoned" && deliver === "send"));
      if (usable) {
        let p;
        try { p = room.sendToClaudeSession(payload, { deliver: deliver || "stage" }); } catch (e) { p = Promise.reject(e); }
        return p.then(() => ({ via: "chat" }), async () => { const saved = await saveAsk(payload); refreshCanSend(); return { via: saved ? "fallback" : "none" }; });
      }
      // "fallback": saved for Claude to pick up; "none": nowhere to put it (no chat and no db).
      return saveAsk(payload).then((saved) => ({ via: saved ? "fallback" : "none" }));
    }

    function writeState() {
      lastStateAt = Date.now(); stateTimer = null;
      const sec = compact(currentSection());
      db.doc("state/now").set({ page: position.page, section: sec, updatedAt: nowIso() }).catch(() => {});
    }
    function setPosition(page) {
      if (page === position.page && lastStateAt) return;
      position = { page };
      const sec = currentSection();
      if (room && room.presence) room.presence({ paper: String(paper.title || "").slice(0, 200), page, section: sec ? ((sec.num ? sec.num + " " : "") + sec.title).slice(0, 200) : null }).catch(() => {});
      if (!db) return;
      const wait = STATE_EVERY_MS - (Date.now() - lastStateAt);
      if (wait <= 0) writeState();
      else if (!stateTimer) stateTimer = setTimeout(writeState, wait);
    }

    if (db) {
      db.doc("outline/main").onSnapshot((snap) => {
        outline = snap.exists ? snap.data() : null;
        outlineCbs.forEach((cb) => cb(outline));
      }, () => {});
      db.collection("explanations").onSnapshot((snap) => {
        explanations = {};
        for (const d of snap.docs) explanations[d.id] = d.data();
        explCbs.forEach((cb) => cb(explanations));
      }, () => {});
    }

    return {
      canSend: () => can,
      refreshCanSend,
      send,
      setPosition,
      currentSection: () => currentSection(),
      outline: () => outline,
      onOutline(cb) { outlineCbs.add(cb); cb(outline); return () => outlineCbs.delete(cb); },
      onExplanations(cb) { explCbs.add(cb); cb(explanations); return () => explCbs.delete(cb); },
    };
  }

  window.PLBridge = { init };
})();
