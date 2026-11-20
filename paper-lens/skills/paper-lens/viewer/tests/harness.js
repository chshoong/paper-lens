// Tiny in-browser test runner. Results go to window.__results and <pre id="pl-results">.
(function () {
  const tests = [];
  const fmt = (v) => { try { return JSON.stringify(v); } catch { return String(v); } };
  const PLTest = {
    test(name, fn) { tests.push({ name, fn }); },
    eq(actual, expected, msg) {
      const a = fmt(actual), e = fmt(expected);
      if (a !== e) throw new Error((msg ? msg + ": " : "") + "expected " + e + " got " + a);
    },
    ok(cond, msg) { if (!cond) throw new Error(msg || "expected truthy"); },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    async run() {
      const out = { passed: 0, failed: 0, failures: [] };
      for (const t of tests) {
        try { await t.fn(); out.passed++; }
        catch (e) { out.failed++; out.failures.push(t.name + " :: " + (e && e.message || e)); }
      }
      window.__results = out;
      let pre = document.getElementById("pl-results");
      if (!pre) { pre = document.createElement("pre"); pre.id = "pl-results"; document.body.append(pre); }
      pre.textContent = JSON.stringify(out);
      return out;
    },
  };
  window.PLTest = PLTest;
  // ?norun on the page URL: load the page without running the checks (manual debugging).
  if (!/[?&]norun\b/.test(location.search)) window.addEventListener("load", () => setTimeout(() => PLTest.run(), 0));
})();
