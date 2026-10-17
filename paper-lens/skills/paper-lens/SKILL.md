---
name: paper-lens
description: 사용자가 논문(PDF 파일, 폴더 속 PDF, arXiv·OpenReview·PDF 링크)을 읽고 싶어 하거나 "이 논문 열어줘/읽어줘/번역해줘/요약해줘"라고 할 때 사용. 논문을 Paper Lens 리더(Artifact)로 열어, 옆에 번역·3줄 요약·그림/표 해석이 뜨고 드래그나 영역 캡처로 바로 Claude에게 물을 수 있게 한다.
---

# Paper Lens: 논문을 리더로 열기

목표: 논문 하나당 Artifact 페이지 하나. 페이지는 `paper.pdf`를 옆에 실어 바로 열리고,
요약·번역·질문은 페이지 안에서 사용자 자신의 Claude로 돈다.

## 1. 논문 찾기
- **링크**: arXiv(abs/pdf/html), OpenReview, PDF 직접 링크. DOI나 출판사 페이지면 무료 PDF(arXiv 판 등)를 찾아보고, 못 찾으면 사용자에게 PDF 파일을 달라고 한다. 페이월은 우회하지 않는다.
- **파일 경로**: 그대로 쓴다. `~`는 홈으로.
- **폴더**: `find <폴더> -maxdepth 2 -iname '*.pdf'`로 목록을 보여주고 어떤 논문을 열지 고르게 한다 (하나뿐이면 바로).
- **채팅에 첨부된 PDF**: 파일 경로가 보이면 그 경로를 쓴다. 경로가 없으면 이미 열려 있는 빈 Paper Lens 페이지에 파일을 끌어다 놓으라고 안내한다.

## 2. 준비
작업 폴더는 스크래치패드 아래 `paper-lens/<짧은-슬러그>/`.
```bash
OUT="<스크래치패드>/paper-lens/<slug>"
bash "${CLAUDE_SKILL_DIR}/scripts/fetch_paper.sh" "<경로 또는 링크>" "$OUT"
```
실패 메시지(파일 없음, PDF 아님, 15MB 초과)는 그대로 사용자에게 전한다.

제목 알아내기: `pdftotext -l 1 "$OUT/paper.pdf" - | head -40` (없으면 PDF 첫 쪽을 Read). 제목, 저자, 출처를 `paper.json`에 쓴다:
```json
{"title": "논문 제목", "authors": ["..."], "source": "원래 링크나 파일 경로"}
```

리더 페이지 복사 (`<title>`만 논문 제목으로 바꾸고, HTML 특수문자는 이스케이프):
```bash
python3 - "${CLAUDE_SKILL_DIR}/viewer/paper-lens.html" "$OUT/index.html" "논문 제목" <<'PY'
import sys, html
src, dst, title = sys.argv[1:4]
s = open(src, encoding="utf-8").read().replace("<title>Paper Lens</title>", f"<title>{html.escape(title[:90])}</title>", 1)
open(dst, "w", encoding="utf-8").write(s)
PY
```

## 3. 올리기
Artifact 도구로 publish:
- `file_path`: `$OUT/index.html`
- `files`: `{"paper.pdf": "$OUT/paper.pdf", "paper.json": "$OUT/paper.json"}`
- `capabilities`: `{"sample": {"images": true}, "downloads": true}`
- `icon`: `"book"`
- `description`: 한 문장 (예: "Paper Lens로 연 '<제목>' 읽기 페이지")

같은 논문을 다시 열 때는 `action: "list"`로 같은 제목의 Artifact가 있는지 먼저 보고, 있으면 새로 만들지 말고 그 링크를 준다.

## 4. 사용자에게
링크와 함께 짧게:
- 처음 열면 Claude 사용 허용을 한 번 물어본다 (요약·번역은 사용자의 Claude 사용량을 쓴다).
- 문장 드래그 → 번역·설명·쉽게 풀기·질문 / `C` 키 → 그림·표·수식 영역 캡처 / 오른쪽 탭: 요약·쪽별 정리·질문·용어·노트. 쪽 전체를 그대로 번역해 주지는 않고(저작권), 문장 단위 번역은 드래그로.
- 노트는 Markdown 파일로 받을 수 있다.

사용자가 채팅에서 바로 묻는 경우(예: "3번 그림 설명해줘")에는 `paper.pdf`를 Read로 직접 보고 여기서 답해도 된다.
