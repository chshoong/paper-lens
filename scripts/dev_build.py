#!/usr/bin/env python3
"""Build viewer/dev.html: the reader wrapped in a document skeleton, with the fake
Claude runtime and the UI checks loaded first. Also puts a test PDF at viewer/paper.pdf.

Usage: dev_build.py [--pdf PATH]
"""
import argparse, json, os, shutil, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
VIEWER = os.path.join(HERE, "..", "paper-lens", "skills", "paper-lens", "viewer")
FETCH = os.path.join(HERE, "..", "paper-lens", "skills", "paper-lens", "scripts", "fetch_paper.sh")
DEFAULT_PAPER = "https://arxiv.org/abs/1706.03762"

HEAD = ('<!doctype html><html><head><meta charset=utf8>'
        '<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<style>[hidden]{display:none!important}</style></head><body>'
        '<script src="tests/harness.js"></script>'
        '<script src="tests/fakes.js"></script>'
        '<script src="tests/ui-checks.js"></script>')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf")
    a = ap.parse_args()
    pdf = os.path.join(VIEWER, "paper.pdf")
    if a.pdf:
        shutil.copyfile(a.pdf, pdf)
    elif not os.path.exists(pdf):
        tmp = os.path.join(VIEWER, ".dev-paper")
        subprocess.run(["bash", FETCH, DEFAULT_PAPER, tmp], check=True, stdout=subprocess.DEVNULL)
        shutil.move(os.path.join(tmp, "paper.pdf"), pdf)
        shutil.rmtree(tmp, ignore_errors=True)
    with open(os.path.join(VIEWER, "paper.json"), "w", encoding="utf-8") as f:
        json.dump({"title": "Attention Is All You Need"}, f)
    with open(os.path.join(VIEWER, "paper-lens.html"), encoding="utf-8") as f:
        body = f.read()
    with open(os.path.join(VIEWER, "dev.html"), "w", encoding="utf-8") as f:
        f.write(HEAD + body + "</body></html>")
    print(os.path.abspath(os.path.join(VIEWER, "dev.html")))


if __name__ == "__main__":
    main()
