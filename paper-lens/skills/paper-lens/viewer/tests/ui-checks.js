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

  test("pdf renders", async () => {
    await waitFor(() => document.querySelectorAll(".page").length === 15, 30000, "15 pages");
    await waitFor(() => $('.page[data-p="1"] canvas'), 30000, "page 1 canvas");
    eq((window.__fake && window.__fake.errors) || [], [], "no page errors");
  });

  test("fake claude runtime is connected", async () => {
    ok(window.__fake, "fakes loaded");
    await waitFor(() => !$("#capBtn").disabled, 15000, "capture enabled (sample with images)");
    ok($("#aiWarn").hidden, "no 'Claude unavailable' warning");
    ok(await window.claude.use("db"), "db available");
  });
})();
