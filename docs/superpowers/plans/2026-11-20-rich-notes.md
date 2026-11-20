# Paper Lens 노트 꾸미기(WYSIWYG) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 글 블록을 Quill 2 기반 WYSIWYG 편집기로 바꾼다. 굵게·밑줄·제목·크기·색·형광펜·목록·체크박스·인라인 수식을 쓰는 즉시 보이게 하고, 저장은 Markdown과 작은 HTML로 한다.

**Architecture:** 변환(`rich-convert.js`, 순수 함수: Markdown ↔ Quill Delta)과 편집기(`rich-editor.js`, Quill 설정·블롯·단축키·도구막대)를 새 파일로 둔다. `notes-ui.js`는 글 블록을 열 때 왕복 검사를 통과하면 PLRich 편집기를, 아니면 기존 textarea를 쓴다. 정적 렌더링은 기존 `renderRich`에 꾸밈 허용 목록과 공용 CSS를 더한다.

**Tech Stack:** Quill 2.0.2 `quill.js`(cdnjs), 기존 marked 12.0.2 / DOMPurify 3.1.6 / MathJax 3.2.2, 브라우저 테스트(`scripts/run_browser_tests.py`).

**Spec:** `docs/superpowers/specs/2026-11-20-rich-notes-design.md` (이전: `2026-11-20-study-mode-design.md`)

## Global Constraints
- 외부 스크립트는 cdnjs 버전 고정만 쓴다. 외부 CSS는 금지다. Quill CSS는 필요한 규칙만 페이지에 넣고, 테마는 쓰지 않는다.
- 저장 형식(정규형): `#`~`###`, `**b**`, `*i*`, `~~s~~`, `` `c` ``, `[t](url)`, `- `(2칸 들여쓰기 1단계), `1. `, `- [ ]`/`- [x]`, `> `, `$..$`, `<u>`, `<span data-c="NAME">`, `<mark data-c="NAME">`, `<span data-s="small|large">`. 문단 사이는 빈 줄 하나다. 빈 문단은 `<br>` 한 줄이다.
- 색 이름 9개: `default gray brown orange yellow green blue purple red`. 크기: `small`(0.85em) / 기본 / `large`(1.25em).
- 왕복 검사를 통과하지 못한 블록(`deltaToMd(mdToDelta(t)) !== normalize(t)`)은 기존 textarea로 열고 "이 블록은 원문으로 편집돼요"를 띄운다.
- 열었다 닫기만 하면 저장하지 않는다.
- Enter는 블록 안의 새 줄이다. ⌘Enter는 아래에 새 블록, Esc는 편집 끝이다. 빈 블록에서 Backspace를 누르면 블록을 지운다. `$$`는 수식 블록을 만든다(스펙 5.2).
- 단축키: ⌘B ⌘I ⌘U, ⌘⇧S 취소선, ⌘E 코드, ⌘⇧H 형광펜(마지막 색, 기본 yellow).
- 기존 성질을 유지한다: IME 안전, `$5–$10`은 글자, 원격 쓰기가 편집 중인 블록을 건드리지 않음, 느린 저장 중 입력 유실 없음.
- 커밋 메시지 끝에는 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`을 붙인다.

## Review Focus
1. **한글 IME**: Quill 안에서 조합 중에 누른 Enter, ⌘Enter, Esc가 줄이나 블록을 나누거나 편집을 끝내면 안 된다. 테스트는 Task 3이 맡는다.
2. **열었다 닫기만 하기**: 왕복 통과 블록이라도 열고 닫기만 하면 저장 호출이 0번이어야 한다. 테스트는 Task 3이 맡는다.
3. **특수문자 그대로 쓰기**: WYSIWYG에서 `*`, `_`, `$`, `<b>`, `#`(줄 맨 앞), `1.`(줄 맨 앞)을 글자로 쳤으면, 저장 후 다시 열어도 글자여야 한다. 테스트는 Task 1(변환), Task 3(편집기)이 맡는다.
4. **다른 곳에서 붙여넣기**: 웹이나 PDF의 서식 있는 HTML을 붙여넣으면 허용한 형식만 남아야 한다. 인라인 style 색이나 글꼴은 저장되면 안 된다. 테스트는 Task 2가 맡는다.
5. **다크 모드 색**: 글자색 9개와 형광펜 9개가 다크 모드에서도 토큰 값으로 보여야 한다. 테스트는 Task 4가 맡는다(`--c-*` 토큰이 dark 블록에 정의돼 있는지).

## File Structure
`paper-lens/skills/paper-lens/viewer/` 아래:
- `rich-convert.js` (새로 만듦): `window.PLRichConvert`. Markdown ↔ Delta 변환, 정규화, 왕복 검사.
- `rich-editor.js` (새로 만듦): `window.PLRich`. Quill 등록(포맷·블롯·키 바인딩), 편집기 붙이기·떼기, 선택 도구막대, 수식 팝오버.
- `notes-ui.js` (수정): 글 블록 편집을 PLRich로 바꾸고 textarea 대체 경로를 둔다. 정적 체크박스 토글을 넣는다.
- `paper-lens.html` (수정): Quill 스크립트, 새 js 두 개, Quill 핵심 CSS, 꾸밈 CSS와 색 토큰(라이트·다크).
- `tests/rich.test.html` (새로 만듦), `tests/ui-checks.js` (수정)
- `../scripts/prepare_bundle.py` (수정: SCRIPTS에 두 파일 추가), `../SKILL.md` (§7 꾸밈 문법)
- 저장소 `scripts/test_prepare_bundle.py`(기대 파일 목록), `README.md`, `paper-lens/README.md`

---

### Task 1: 변환기 `rich-convert.js`

**Files:** Create `viewer/rich-convert.js`, `viewer/tests/rich.test.html`; Modify `paper-lens.html`(script 태그).

**Interfaces — Produces (`window.PLRichConvert`):**
- `mdToDelta(text: string): {ops: Op[]}`: Op은 Quill Delta 형식이다.
  - 인라인 속성: `bold, italic, underline, strike, code, link(url), color(NAME), highlight(NAME), size("small"|"large")`
  - 인라인 수식: `{insert: {mathInline: "latex"}}`
  - 줄 속성(`"\n"` op): `header: 1|2|3`, `list: "bullet"|"ordered"|"checked"|"unchecked"`, `indent: 1`, `blockquote: true`
- `deltaToMd(delta: {ops}): string`: 정규형을 만든다. 일반 글자 안의 `\ * _ \` ~ [ ] $`는 백슬래시로 escape하고, `<`는 `&lt;`로, `&`는 `&amp;`로 바꾼다. 줄 맨 앞의 `#`, `>`, `-`, `+`, `숫자.`도 escape한다.
- `normalize(text: string): string`: 줄 끝 공백을 지우고, 연속 빈 줄을 하나로, 앞뒤 빈 줄을 없앤다.
- `roundTrips(text: string): boolean`

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`rich.test.html`, harness + `../rich-convert.js`). 각 문자열은 `roundTrips === true`이고, 대표 사례는 Delta 모양도 확인한다.
  - `"## 제목"` → ops `[{insert:"제목"},{insert:"\n",attributes:{header:2}}]`
  - `"**굵게** 와 *기울임* ~~취소~~ \`코드\`"`
  - `"<u>밑줄</u> <span data-c=\"red\">빨강</span> <mark data-c=\"yellow\">형광</mark> <span data-s=\"large\">크게</span>"` → 각 속성이 `underline`, `color:"red"`, `highlight:"yellow"`, `size:"large"`
  - `"- 하나\n  - 둘\n- 셋"` (indent 1)
  - `"1. 가\n2. 나"`, `"- [ ] 할 일\n- [x] 끝"`, `"> 인용"`
  - `"넓이 $\\pi r^2$ 이다"` → `{insert:{mathInline:"\\pi r^2"}}`
  - `"[링크](https://a.b/c)"`
  - `"첫 문단\n\n둘째 문단"`, `"위\n\n<br>\n\n아래"` (빈 문단)
  - 특수문자: `deltaToMd({ops:[{insert:"a*b_c $5 <b> \\\\ \n"}]})`의 결과를 `mdToDelta`에 넣으면 같은 글자 `"a*b_c $5 <b> \\\\ "`가 나온다. 줄 맨 앞의 `"# 아님"`, `"1. 아님"`인 일반 문단도 글자로 되돌아온다.
  - 실패해야 하는 것(`roundTrips === false`): `"| a | b |\n|---|---|"`, `"\`\`\`\nx\n\`\`\`"`, `"$$x$$"`, `"_x_"`, `"* 별 글머리"`, `"한 줄\n바로 다음 줄"`, `"<div>x</div>"`, `"![](a.png)"`
- [ ] **Step 2: 실패를 확인한다.** `python3 scripts/run_browser_tests.py tests/rich.test.html` → failed > 0.
- [ ] **Step 3: 구현한다.** 줄 단위 블록 파서(제목/목록/인용/문단, 빈 줄로 문단 구분)와 인라인 스캐너(위 문법만, 수식은 `PLCore.splitMath` 규칙 재사용)로 만든다. 모르는 문법을 만나도 실패시키지 않는다. 그런 경우 왕복 결과가 달라져서 `roundTrips`가 false가 된다.
- [ ] **Step 4: 통과를 확인한다.** 전체 스위트(core, store, rich, dev, dev?disable=db)를 돌린다.
- [ ] **Step 5: Commit** `feat(viewer): markdown <-> quill delta converter for rich notes`

### Task 2: Quill 편집기 `rich-editor.js`

**Files:** Create `viewer/rich-editor.js`; Modify `paper-lens.html` (Quill `<script src="https://cdnjs.cloudflare.com/ajax/libs/quill/2.0.2/quill.js">`, Quill core CSS 일부, 도구막대·팝오버 CSS); Modify `tests/ui-checks.js`.

**Interfaces:**
- Consumes: `PLRichConvert`, `PLMath.render`, `PLCore.splitMath`
- Produces (`window.PLRich`): `mount(host: Element, text: string, cb): RichEditor`
  - `cb = {onChange(text), onExit(), onNewBlockBelow(), onBackspaceEmpty(), onMathBlockBelow()}`
  - `RichEditor = {root: Element, getText(): string, focus(), destroy(), quill}`
  - `onChange`는 내용이 실제로 바뀐 사용자 입력에만 불린다.
- 등록: `color`·`highlight`는 Parchment Attributor(`data-c`, span/mark)다. `size`는 `data-s`다. `mathInline` Embed(`span.ql-math[data-latex]`, MathJax SVG). clipboard matcher는 허용 형식 밖의 속성(style 색, 글꼴 등)을 버린다.
- 키 바인딩: 제목 자동변환(`#`/`##`/`###` + space), 인용 `>` + space(목록은 Quill 기본 list autofill 사용), ⌘⇧S, ⌘E, ⌘⇧H, ⌘Enter, Esc, 빈 편집기에서 Backspace, 빈 줄에서 `$$` + space. 모든 바인딩은 `isComposing`이면 무시한다.
- 인라인 수식 변환: text-change에서 커서 앞이 `$내용$X`(X는 막 친 글자, 숫자나 `$`가 아님)이면 `$내용$`을 `mathInline`으로 바꾼다. 편집을 끝낼 때 줄 끝에 남은 `$내용$`도 바꾼다.
- 선택 도구막대: 선택 길이가 0보다 크면 선택 위에 띄운다. 버튼은 B, I, U, S, 코드, 제목▾, 크기▾, 글자색▾(9), 형광펜▾(9), 수식으로. 수식을 클릭하면 팝오버(textarea + 미리보기)를 띄우고, Enter로 반영, Esc로 취소한다.

- [ ] **Step 1: ui-checks에 실패하는 체크를 추가한다** (분리된 host div에 `PLRich.mount`, 키 이벤트는 `quill.root`에 dispatch, 글자 입력은 `quill.insertText(…, "user")`).
  - ⌘B 후 입력 → `root.querySelector("strong")`이 있고, `getText()`에 `**`가 들어 있다.
  - 빈 줄에 `##` 입력 + 띄어쓰기 → `root.querySelector("h2")`
  - `- ` → 목록 li, `[] ` → 체크박스 li(`data-list="unchecked"`)
  - `$x^2$` 다음에 띄어쓰기 → `root.querySelector(".ql-math svg")`. `$5–$10`은 글자로 남는다.
  - 도구막대에서 글자색 red → `getText()`에 `<span data-c="red">`
  - `quill.clipboard.dangerouslyPasteHTML('<span style="color:#f00;font-family:Comic Sans">x</span><b>y</b>')` → `getText()`에 `style`과 `font`가 없고 `**y**`는 있다(Review Focus 4).
  - ⌘Enter, Esc, 빈 편집기 Backspace, 빈 줄 `$$ ` → 각각 해당 콜백이 불린다.
- [ ] **Step 2: 실패를 확인한다.**
- [ ] **Step 3: 구현한다.**
- [ ] **Step 4: 통과를 확인하고 스위트를 돌린다.**
- [ ] **Step 5: Commit** `feat(viewer): quill rich editor with math, shortcuts and toolbar`

### Task 3: 노트 편집기 통합

**Files:** Modify `viewer/notes-ui.js`, `tests/ui-checks.js`.

**Interfaces:**
- Consumes: `PLRich.mount`, `PLRichConvert.roundTrips`
- `startEdit(id)`, text 블록일 때:
  - `roundTrips(text)`면 `PLRich.mount(body, text, cb)`를 쓴다. `onChange`는 `store.update(id, {text})`를 부른다. `onNewBlockBelow`는 `api.insert({type:"text"}, {focus:true, afterId:id})`, `onExit`는 `stopEdit`, `onBackspaceEmpty`는 블록 삭제 후 이전 블록 편집, `onMathBlockBelow`는 `api.insert({type:"math"}, {focus:true, afterId:id})`다.
  - 아니면 기존 textarea를 쓰고, 위에 `.nb-raw-note`("이 블록은 원문으로 편집돼요")를 띄운다.
  - 빈 블록에서 `$$`를 치면 math로 바뀐다(유지).
- `editingId()`, 원격 스냅샷이 와도 편집 중인 블록은 건드리지 않는다(유지). 바깥 mousedown으로 편집을 끝낸다(유지, 도구막대와 팝오버 클릭은 제외).
- 정적 렌더링의 체크박스: 클릭하면 n번째 `- [ ]`/`- [x]`를 토글하고 `store.update`한다.
- 기존 textarea 전제 체크를 고쳐 쓴다(같은 성질 유지): Enter 조합(IME), 느린 저장 중 새 블록(⌘Enter), Claude 원격 쓰기(같은 `.ql-editor` 요소 유지), 미리보기 칸(WYSIWYG 안의 `.ql-math svg`).

- [ ] **Step 1: 체크를 고치거나 추가한다(RED).**
  - IME: 조합 중 Enter(`isComposing:true`) → 줄 수와 블록 수가 그대로다. 조합 중 Esc → 편집이 이어진다. 조합 중 ⌘Enter → 블록 수가 그대로다(Review Focus 1).
  - 느린 db(400ms) + ⌘Enter → 60ms 안에 `editingId()`가 새 블록이다.
  - Claude가 블록을 쓰는 동안 편집 중인 블록의 `.ql-editor` 요소와 내용이 유지된다.
  - 열었다 닫기만 하면 → `__fake.writesIssued` 증가 0(Review Focus 2).
  - 특수문자: 편집기에서 `a*b $5 <b>`를 입력하고 닫은 뒤 다시 열면 `getText()`를 렌더링한 화면 글자가 `a*b $5 <b>`다(Review Focus 3).
  - 표가 있는 블록(`"| a | b |\n|---|---|"`) → textarea와 `.nb-raw-note`가 뜬다.
  - 정적 체크박스 클릭 → text의 `- [ ]`가 `- [x]`로 바뀐다.
- [ ] **Step 2: 실패를 확인한다.**
- [ ] **Step 3: 구현한다.**
- [ ] **Step 4: 통과를 확인하고 전체 스위트를 돌린다.**
- [ ] **Step 5: Commit** `feat(viewer): notes use the rich editor, raw fallback for unsupported markdown`

### Task 4: 같은 모습 CSS와 색 토큰

**Files:** Modify `paper-lens.html` (CSS), `tests/ui-checks.js`.
- 토큰: `--c-gray|brown|orange|yellow|green|blue|purple|red`(글자색), `--h-…`(형광펜 배경)를 라이트 `:root`와 두 다크 블록에 정의한다. `[data-c=NAME]`은 `color: var(--c-NAME)`, `mark[data-c=NAME]`은 `background: var(--h-NAME)`, `[data-s=small|large]`는 font-size다.
- 정적(`.nb-text`, marked 출력)과 편집(`.ql-editor`, Quill 출력)의 제목, 목록(Quill 2의 `ol > li[data-list]`), 체크박스, 인용, 코드 모양을 같은 규칙으로 맞춘다. DOMPurify 허용 목록에 `data-c`, `data-s`, `u`, `mark`를 추가한다.

- [ ] **Step 1: 실패하는 체크를 쓴다.**
  - 같은 text를 정적으로 렌더링한 `h2`와 편집기 `h2`의 computed `font-size`가 같다. 목록 들여쓰기도 같다.
  - `document.documentElement.dataset.theme="dark"`일 때 `mark[data-c=yellow]`의 배경이 `--h-yellow`의 dark 값이다.
- [ ] **Step 2–4:** RED → 구현 → GREEN, 1400px 스크린샷 한 장(라이트·다크).
- [ ] **Step 5: Commit** `style(viewer): shared rich note styles and color tokens`

### Task 5: 스킬, 묶음, 문서, 배포

**Files:** Modify `scripts/prepare_bundle.py`(SCRIPTS + `rich-convert.js`, `rich-editor.js`), `scripts/test_prepare_bundle.py`(기대 키 8개), `SKILL.md` §7(정규형과 꾸밈 문법, 줄 단위 수식은 math 블록), `README.md`·`paper-lens/README.md`(꾸밈 기능, 내보내기 시 HTML 꾸밈 주의).

- [ ] **Step 1:** `test_prepare_bundle.py`의 기대 목록을 8개로 바꾸고 실패를 확인한다.
- [ ] **Step 2:** `prepare_bundle.py`를 고치고 통과를 확인한다. SKILL과 README를 고친다.
- [ ] **Step 3: Commit** `feat(skill): bundle rich editor files; document note formatting for Claude`
- [ ] **Step 4:** 설치본을 갱신한다(`cp -R` 후 tests, dev 파일 삭제). 세 페이지(BERT, Attention, 빈 리더)는 새 js 두 개를 포함해 같은 주소로 다시 올린다(capabilities는 이어받기). 빈 리더는 묶음 폴더에 js를 복사한다.
- [ ] **Step 5:** 전체 스위트를 돌린 뒤 최종 리뷰를 받는다(executing-plans).
