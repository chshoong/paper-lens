#!/usr/bin/env bash
# Usage: fetch_paper.sh <path-or-url> <out-dir>
# Puts the paper at <out-dir>/paper.pdf and prints its absolute path.
set -euo pipefail
src="$1"; out="$2"
mkdir -p "$out"
case "$src" in
  http://*|https://*)
    url="$src"
    # arXiv abstract / html pages -> pdf
    if [[ "$url" =~ arxiv\.org/(abs|html|pdf)/([^?#]+) ]]; then
      id="${BASH_REMATCH[2]%.pdf}"; url="https://arxiv.org/pdf/$id"
    fi
    # OpenReview forum -> pdf
    url="${url/openreview.net\/forum?/openreview.net/pdf?}"
    curl -fsSL -A "Mozilla/5.0 (paper-lens)" -o "$out/paper.pdf" "$url"
    ;;
  *)
    src="${src/#\~/$HOME}"
    [ -f "$src" ] || { echo "파일이 없어요: $src" >&2; exit 2; }
    cp "$src" "$out/paper.pdf"
    ;;
esac
head -c 5 "$out/paper.pdf" | grep -q '%PDF-' || { echo "PDF가 아니에요 (로그인/페이월 페이지일 수 있어요)" >&2; rm -f "$out/paper.pdf"; exit 3; }
size=$(wc -c < "$out/paper.pdf")
[ "$size" -le 15000000 ] || { echo "PDF가 15MB를 넘어요 ($size bytes)" >&2; exit 4; }
cd "$out" && pwd -P | sed 's#$#/paper.pdf#'
