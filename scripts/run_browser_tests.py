#!/usr/bin/env python3
"""Run in-browser test pages with headless Chrome and report results.

Usage: run_browser_tests.py PAGE [PAGE ...]
PAGE is a path relative to the viewer folder, e.g. tests/core.test.html.
Each page must write JSON {passed, failed, failures} into <pre id="pl-results">.
"""
import html, json, os, re, socket, subprocess, sys, threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "paper-lens", "skills", "paper-lens", "viewer")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


def main(pages):
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    srv = ThreadingHTTPServer(("127.0.0.1", port), partial(Quiet, directory=os.path.abspath(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    total_p = total_f = 0
    try:
        for page in pages:
            url = f"http://127.0.0.1:{port}/{page}"
            out = subprocess.run(
                [CHROME, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
                 f"--user-data-dir={os.path.join(os.environ.get('TMPDIR', '/tmp'), 'pl-chrome')}",
                 "--virtual-time-budget=20000", "--dump-dom", url],
                capture_output=True, text=True, timeout=120).stdout
            m = re.search(r'<pre id="pl-results">(.*?)</pre>', out, re.S)
            if not m:
                print(f"{page}: NO RESULTS")
                total_f += 1
                continue
            r = json.loads(html.unescape(m.group(1)))
            total_p += r["passed"]
            total_f += r["failed"]
            print(f"{page}: {r['passed']} passed, {r['failed']} failed")
            for f in r["failures"]:
                print("  FAIL", f)
    finally:
        srv.shutdown()
    print(f"TOTAL: {total_p} passed, {total_f} failed")
    return 1 if total_f else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
