#!/usr/bin/env python3
"""Gather one paper's reader bundle for an Artifact publish.

Usage: prepare_bundle.py PAPER_DIR OUT_DIR

PAPER_DIR holds paper.pdf and paper.json ({"title": ...}). OUT_DIR gets index.html (the reader
with its <title> set to the paper title, HTML-escaped), the reader's script files, paper.pdf and
paper.json. Prints the Artifact `files` map (published path -> absolute source path) as JSON.
OUT_DIR should be inside the scratchpad, since publishing only takes files from there or the
working directory.
"""
import html, json, os, shutil, sys

VIEWER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "viewer")
SCRIPTS = ["notes-core.js", "notes-store.js", "notes-ui.js", "bridge.js", "rich-convert.js", "rich-editor.js"]


def main(paper_dir, out_dir):
    with open(os.path.join(paper_dir, "paper.json"), encoding="utf-8") as f:
        meta = json.load(f)
    title = str(meta.get("title") or "Paper Lens").strip()[:90]
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(VIEWER, "paper-lens.html"), encoding="utf-8") as f:
        page = f.read()
    page = page.replace("<title>Paper Lens</title>", "<title>" + html.escape(title, quote=True) + "</title>", 1)
    with open(os.path.join(out_dir, "index.html"), "w", encoding="utf-8") as f:
        f.write(page)
    files = {}
    for name in SCRIPTS:
        shutil.copyfile(os.path.join(VIEWER, name), os.path.join(out_dir, name))
        files[name] = os.path.abspath(os.path.join(out_dir, name))
    for name in ("paper.pdf", "paper.json"):
        shutil.copyfile(os.path.join(paper_dir, name), os.path.join(out_dir, name))
        files[name] = os.path.abspath(os.path.join(out_dir, name))
    print(json.dumps(files, ensure_ascii=False))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
