#!/usr/bin/env python3
"""Check paper-lens/skills/paper-lens/scripts/prepare_bundle.py."""
import json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "paper-lens", "skills", "paper-lens", "scripts", "prepare_bundle.py")
JS = ["notes-core.js", "notes-store.js", "notes-ui.js", "bridge.js", "rich-convert.js", "rich-editor.js"]


def main():
    with tempfile.TemporaryDirectory() as tmp:
        paper = os.path.join(tmp, "paper"); out = os.path.join(tmp, "out")
        os.makedirs(paper)
        with open(os.path.join(paper, "paper.pdf"), "wb") as f:
            f.write(b"%PDF-1.5\n%test\n")
        with open(os.path.join(paper, "paper.json"), "w", encoding="utf-8") as f:
            json.dump({"title": 'A <b>&"bold" paper', "source": "x"}, f)
        r = subprocess.run([sys.executable, SCRIPT, paper, out], capture_output=True, text=True)
        assert r.returncode == 0, "exit %s: %s" % (r.returncode, r.stderr)
        files = json.loads(r.stdout)
        assert sorted(files) == sorted(["paper.pdf", "paper.json"] + JS), sorted(files)
        for k, v in files.items():
            assert os.path.isabs(v) and os.path.exists(v), (k, v)
        with open(os.path.join(out, "index.html"), encoding="utf-8") as f:
            first = f.readline()
        assert first.startswith("<title>A &lt;b&gt;&amp;&quot;bold&quot; paper</title>"), first
        for j in JS:
            assert os.path.exists(os.path.join(out, j)), j
        assert not os.path.exists(os.path.join(out, "tests")), "tests must not ship"
    print("prepare_bundle: all checks passed")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print("FAIL", e); sys.exit(1)
