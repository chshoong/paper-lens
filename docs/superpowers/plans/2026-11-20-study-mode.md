# Paper Lens 공부 모드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 논문 페이지(Artifact)에 LaTeX 블록 노트를 붙이고, 페이지에서 고른 부분을 옆 Claude Code 채팅으로 넘기며, 채팅의 Claude가 노트·목차·설명 기록을 db로 읽고 쓰게 한다.

**Architecture:** 리더는 지금처럼 한 HTML 페이지지만, 새 기능은 같은 폴더의 JS 파일로 나눠 Artifact `files`로 함께 올린다. 순수 로직(`notes-core.js`)은 브라우저 테스트 페이지로 검증한다. 저장(`notes-store.js`)은 db capability와 localStorage 대체 경로를 같은 인터페이스로 감싼다. 편집기(`notes-ui.js`), 채팅 연결(`bridge.js`)이 그 위에 올라간다. 로컬 개발은 가짜 `window.claude`(`tests/fakes.js`)를 끼운 dev 페이지로 한다.

**Tech Stack:** 순수 JS(빌드 없음), pdf.js 3.11.174, marked 12.0.2, DOMPurify 3.1.6, MathJax 3.2.2 `es5/tex-svg-full.js`(cdnjs), Artifact capabilities(sample, db, user, assets, room, downloads), Python 3(개발 스크립트, 번들 준비), 로컬 정적 서버 `python3 -m http.server`.

**Spec:** `docs/superpowers/specs/2026-11-20-study-mode-design.md`

## Global Constraints

- 외부 스크립트는 cdnjs에서 정확한 버전으로만 불러온다. 외부 CSS·폰트 파일은 Google Fonts 외에는 금지한다(그래서 KaTeX 대신 MathJax SVG를 쓴다).
- 페이지 안 Claude(`sample`)는 짧은 일에만 쓴다: 드래그 번역, 쪽별 정리, 요약, 용어, 캡처→LaTeX 변환. 설명과 질문은 채팅으로 보낸다.
- `room.sendToClaudeSession`은 클릭 핸들러 안에서 **아무것도 await하지 않고** 동기적으로 호출한다. 데이터는 JSON 4KiB 이하다. 이미지는 미리 `assets`로 올려두고 id만 보낸다.
- db 경로: `blocks/{id}`, `state/now`, `outline/main`, `explanations/{sectionId}`, `meta/migrated`. 모든 경로의 규칙은 `write: "owner"`다.
- 블록 필드: `{type: "text"|"math"|"quote"|"image", text, order, page?, eq?, rects?, assetId?, by: "me"|"claude", createdAt, updatedAt}`. 시각은 ISO 문자열이다.
- 노트 입력 저장 디바운스는 600ms다. `state/now` 쓰기는 최대 5초에 한 번이다.
- 쪽 전체 통번역은 하지 않는다(저작권).
- UI 문구는 한국어로, 사용자 입장의 말로 쓴다.
- 커밋 메시지 끝에는 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`을 붙인다.

## Review Focus

1. **한글 입력 중 Enter**: IME 조합 중(`isComposing`)에 누른 Enter가 블록을 쪼개면 안 된다. 테스트는 Task 4가 맡는다.
2. **수식이 아닌 `$`**: "$5", `\$`, 짝이 맞지 않는 `$`는 수식으로 바뀌면 안 된다. 테스트는 Task 1이 맡는다.
3. **두 사람이 동시에 쓰기**: 사용자가 블록 A를 편집하는 중에 Claude가 블록 B를 추가해도, A의 입력 중인 글이 덮어써지면 안 된다. 테스트는 Task 3과 Task 4가 맡는다.
4. **입력 중 페이지 닫기**: 디바운스가 걸린 글은 `pagehide`나 `visibilitychange`가 일어날 때 바로 저장돼야 한다. 테스트는 Task 3이 맡는다.
5. **db를 못 쓰는 화면**: 로그아웃 상태이거나 db가 `null`이면 localStorage로 동작하고, "이 기기에만 저장돼요" 안내를 보여야 한다. 테스트는 Task 3과 Task 5가 맡는다.

## File Structure

`paper-lens/skills/paper-lens/` 아래:
- `viewer/paper-lens.html` (수정): 화면 골격, PDF, 요약, 쪽별 정리, 용어, 툴바. 새 스크립트를 `<script src>`로 불러오고 연결한다.
- `viewer/notes-core.js` (새로 만듦): 순수 함수. `window.PLCore`.
- `viewer/notes-store.js` (새로 만듦): 블록 저장, 구독, 이전. `window.PLStore`.
- `viewer/notes-ui.js` (새로 만듦): 블록 편집기와 수식 렌더링. `window.PLNotesUI`, `window.PLMath`.
- `viewer/bridge.js` (새로 만듦): room presence, 채팅으로 보내기, `state/now`, 목차, 설명 기록. `window.PLBridge`.
- `viewer/tests/harness.js`, `viewer/tests/core.test.html`, `viewer/tests/store.test.html`, `viewer/tests/fakes.js`, `viewer/tests/ui-checks.js` (새로 만듦)
- `scripts/prepare_bundle.py` (새로 만듦): 올릴 묶음을 만든다. 제목을 바꾼 index.html, js 파일들, paper.pdf, paper.json을 출력 폴더에 모은다.
- `scripts/fetch_paper.sh` (수정 없음)
- `SKILL.md` (수정): 저장 위치, 묶음 올리기, 공부 모드 절차.

저장소 루트:
- `scripts/dev_build.py` (새로 만듦): `viewer/dev.html`을 만든다(문서 골격 + fakes + ui-checks + 리더). 테스트 PDF를 `viewer/paper.pdf`로 복사한다.
- `.claude/launch.json` (새로 만듦): `viewer-dev` 설정이다. 내용은 `python3 -m http.server 8765 --directory paper-lens/skills/paper-lens/viewer`다.
- `.gitignore` (수정): `paper-lens/skills/paper-lens/viewer/dev.html`을 추가한다.

---

### Task 1: 순수 함수(`notes-core.js`)와 테스트 하네스

**Files:**
- Create: `paper-lens/skills/paper-lens/viewer/notes-core.js`
- Create: `paper-lens/skills/paper-lens/viewer/tests/harness.js`
- Create: `paper-lens/skills/paper-lens/viewer/tests/core.test.html`
- Create: `.claude/launch.json`

**Interfaces:**
- Produces (`window.PLCore`):
  - `orderBetween(a: number|null, b: number|null): number`: 둘 다 null이면 `1`, a만 null이면 `b - 1`, b만 null이면 `a + 1`, 둘 다 있으면 `(a + b) / 2`.
  - `splitMath(text: string): Array<{kind: "text"|"inline"|"display", value: string}>`
  - `blocksToMarkdown(blocks: Block[], meta: {title: string, source?: string}): string`
  - `migrateLegacyNotes(legacy: Array<{page?, quote?, rects?, answer?, label?, question?, memo?, imageUrl?}>, now: string): Block[]`
  - `parseLatexReply(value: unknown): {latex: string, eq: string|null} | null`
  - `toClaudePayload(obj: object, maxBytes = 4000): object`: 포맷 문자를 지우고, JSON이 maxBytes를 넘으면 가장 긴 문자열 필드부터 잘라 줄인다.
  - `sectionForPage(outline: {sections: Array<{id, num, title, page}>}|null, page: number): {id, num, title, page}|null`
- Produces (`window.PLTest`): `test(name, fn)`, `eq(actual, expected, msg?)`, `ok(cond, msg?)`, `run(): Promise<{passed, failed, failures: string[]}>`. 결과는 `window.__results`에 둔다.

- [ ] **Step 1: 하네스와 실패하는 테스트를 쓴다.** `core.test.html`은 `../notes-core.js`와 `harness.js`를 불러오고 다음 테스트를 담는다.
  - `orderBetween`: `(null,null)→1`, `(null,3)→2`, `(3,null)→4`, `(1,2)→1.5`
  - `splitMath("a $x^2$ b")` → `[{text,"a "},{inline,"x^2"},{text," b"}]`
  - `splitMath("$$\\frac{a}{b}$$")` → `[{display,"\\frac{a}{b}"}]`
  - `splitMath("가격은 $5 입니다")` → text 하나만 (짝 없는 `$`)
  - `splitMath("\\$5 and \\$6")` → text 하나, 값은 `"$5 and $6"`
  - `splitMath("$ x $")`: 양쪽이 공백인 `$`는 수식이 아니다 → text
  - `blocksToMarkdown`: text, math(`page:3, eq:"1"`), quote(`page:2`), image(`page:4`)를 order가 섞인 순서로 넣는다. 결과는 order 순서이고, `"# 제목"`, `"$$\n…\n$$\n*(p.3, 식 1)*"`, `"> …\n> — p.2"`, `"*(그림: p.4 캡처)*"`를 포함한다.
  - `migrateLegacyNotes`: 하이라이트(`quote`+`rects`)는 `quote` 블록이 되고 `rects`를 유지한다. 답변 노트는 `text` 블록 `"**label** (p.N)\n\n" + answer`가 된다. memo가 있으면 뒤에 `"\n\n메모: " + memo`를 붙인다. `imageUrl`만 있는 노트는 버린다. order는 1부터 차례로, `by:"me"`다.
  - `parseLatexReply({latex:"a+b", eq:"(2)"})` → `{latex:"a+b", eq:"2"}`, `parseLatexReply("```latex\n$$a+b$$\n```")` → `{latex:"a+b", eq:null}`, `parseLatexReply({})` → `null`
  - `toClaudePayload({selectedText: "가".repeat(5000), page: 3})`: `JSON.stringify` 결과가 UTF-8로 4000바이트 이하이고, `page`는 유지된다. 입력에 들어 있는 `​`, `­`는 지운다.
  - `sectionForPage({sections:[{id:"s1",page:1},{id:"s2",page:3}]}, 4).id === "s2"`, page 0이면 `null`, outline이 null이면 `null`
- [ ] **Step 2: 실패를 확인한다.** `.claude/launch.json`을 만들고 `preview_start viewer-dev` 후 `http://localhost:8765/tests/core.test.html`을 연다. `window.__results.failed > 0`이어야 한다(PLCore가 없음).
- [ ] **Step 3: `notes-core.js`에 위 함수들을 구현한다.** `splitMath`는 한 번 훑는 스캐너로 만든다. `\$`는 문자 `$`로 바꾼다. 여는 `$` 바로 뒤가 공백이거나, 닫는 `$` 바로 앞이 공백이면 수식이 아니다. `$$`가 `$`보다 우선한다.
- [ ] **Step 4: 통과를 확인한다.** 페이지를 새로고침한 뒤 `window.__results` → `{failed: 0}`.
- [ ] **Step 5: Commit** `feat(viewer): add notes core functions and browser test harness`

### Task 2: 개발용 가짜 환경과 dev 빌드

**Files:**
- Create: `paper-lens/skills/paper-lens/viewer/tests/fakes.js`
- Create: `scripts/dev_build.py`
- Modify: `.gitignore`
- Modify: `paper-lens/skills/paper-lens/viewer/paper-lens.html` (닫는 `<script>` 앞에 `notes-core.js`, `notes-store.js`, `notes-ui.js`, `bridge.js`를 `<script src>`로 추가한다. 아직 없는 파일은 Task 3 전까지 빈 파일로 둔다.)

**Interfaces:**
- Produces (`fakes.js`): `window.claude = {use(name)}`. 이름별로 다음을 돌려준다.
  - `sample`: `sample(input, opts)`와 `sample.json(input)`, `sample.limits()`(images 포함). 응답은 `window.__fake.sampleReplies` 배열에서 첫 번째로 맞는 `{match: RegExp, reply}`를 쓴다. 맞는 게 없으면 `"테스트 응답"`이다.
  - `db`: 메모리 저장소. `doc/collection/get/set/update/delete/onSnapshot/orderBy`가 db.d.ts 모양대로 동작하고, `docChanges` 대신 `docs`만 제공해도 된다. 테스트에서 직접 쓰기용으로 `window.__fake.db.write(path, data)`(Claude 쓰기 흉내)를 둔다.
  - `user`: `id() → "u1"`, `isOwner() → true`
  - `assets`: `upload(blob) → {id: "a"+n, url: URL.createObjectURL(blob), ...}`
  - `room`: `presence(p)`는 `__fake.presence`에 저장한다. `canSendToClaudeSession()`는 `__fake.canSend`(기본값 `"available"`)를 돌려준다. `sendToClaudeSession(data, opts)`는 `__fake.sent`에 push하고 `{to:"pane"}`를 돌려준다.
  - `downloads`: `save` 호출을 `__fake.saved`에 기록한다.
  - `window.__fake.disable = ["db"]`처럼 지정하면 해당 capability는 null을 돌려준다.
- Produces (`dev_build.py`): `python3 scripts/dev_build.py [--pdf PATH]`를 실행하면 `viewer/dev.html` = `<!doctype html><html><head><meta charset=utf8>…</head><body>` + `<script src="tests/fakes.js">` + `<script src="tests/ui-checks.js">` + 리더 본문 + `</body></html>`이 만들어진다. PDF는 `viewer/paper.pdf`로 복사된다(기본값은 arXiv 1706.03762를 `scripts/fetch_paper.sh`로 받기).

- [ ] **Step 1: smoke 체크를 쓴다.** `ui-checks.js`에 `window.__uiChecks = {}`와 `check("pdf renders", …)`를 둔다. 첫 체크는 "15쪽이 로드되고, 1쪽 canvas가 있고, 콘솔 에러가 없음"이다. `window.__runUiChecks()`는 `{passed, failed, failures}`를 돌려준다.
- [ ] **Step 2: dev 빌드 후 실패를 확인한다.** fakes가 없으면 실패해야 한다.
- [ ] **Step 3: `fakes.js`, `dev_build.py`, script 태그를 추가한다.**
- [ ] **Step 4: 확인한다.** `python3 scripts/dev_build.py` 후 `http://localhost:8765/dev.html`에서 `await __runUiChecks()` → `failed: 0`.
- [ ] **Step 5: Commit** `chore(viewer): add fake claude runtime and dev build`

### Task 3: 노트 저장소(`notes-store.js`)

**Files:**
- Create: `paper-lens/skills/paper-lens/viewer/notes-store.js`
- Create: `paper-lens/skills/paper-lens/viewer/tests/store.test.html`

**Interfaces:**
- Consumes: `PLCore.orderBetween`, `PLCore.migrateLegacyNotes`, fake db(Task 2)
- Produces (`window.PLStore`):
  - `create({db: DB|null, localKey: string, legacyNotes: object[]}): Store`
  - `Store.mode: "db"|"local"`
  - `Store.subscribe(cb: (blocks: Block[]) => void): () => void`: order 순으로 정렬된 목록을 넘긴다. 처음 구독할 때 이전 작업(migration)을 한 번 한다.
  - `Store.add(partial: Partial<Block>, opts?: {after?: string, before?: string}): Promise<string>`: 위치를 안 주면 맨 뒤에 넣는다. id는 `b_` + 시간 + 난수다.
  - `Store.update(id: string, patch: Partial<Block>): void`: 600ms 디바운스, id별 마지막 값만 쓴다.
  - `Store.flush(): Promise<void>`
  - `Store.remove(id: string): Promise<void>`
  - `Store.move(id: string, opts: {after?: string, before?: string}): Promise<void>`
  - `Store.pendingIds(): Set<string>`: 아직 저장 안 된 블록 id. UI가 원격 스냅샷으로 편집 중인 글을 덮지 않게 할 때 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`store.test.html`, fake db와 PLCore 사용).
  - `add` 두 번 → `subscribe`가 받은 순서가 추가 순서와 같다. `add({}, {before: 첫째})`는 맨 앞에 들어간다.
  - `update` 세 번 연속(100ms 간격) → db 쓰기는 600ms 뒤에 1번, 값은 마지막 값.
  - `update` 직후 `window.dispatchEvent(new Event("pagehide"))` → 바로 db에 반영된다(Review Focus 4).
  - 블록 A를 `update`하는 중(디바운스 대기)에 `__fake.db.write("blocks/x", {...})`(Claude 쓰기) → `subscribe`가 받는 목록에 x가 들어가고, A의 값은 로컬 최신값으로 유지된다(Review Focus 3).
  - legacy 노트 2개 + 빈 db → 블록 2개 생성, `meta/migrated` 문서 생성. 다시 create해도 중복이 생기지 않는다.
  - `db: null` → `mode === "local"`, 같은 API로 동작하고 localStorage `localKey + ":blocks"`에 저장된다(Review Focus 5).
- [ ] **Step 2: 실패를 확인한다.** `http://localhost:8765/tests/store.test.html` → `failed > 0`.
- [ ] **Step 3: 구현한다.** db 모드에서는 `db.collection("blocks").orderBy("order").onSnapshot` 하나를 구독한다. 스냅샷을 받으면 pending 블록에는 로컬 값을 덮어씌워서 넘긴다. 쓰기는 문서별로 직렬화한다(이전 쓰기를 await한 뒤 다음 쓰기). local 모드에서는 같은 로직을 메모리 배열과 localStorage(try/catch)로 처리한다.
- [ ] **Step 4: 통과를 확인한다.** `failed: 0`.
- [ ] **Step 5: Commit** `feat(viewer): add notes store with db and local fallback`

### Task 4: 수식 렌더링과 블록 편집기(`notes-ui.js`)

**Files:**
- Create: `paper-lens/skills/paper-lens/viewer/notes-ui.js`
- Modify: `paper-lens/skills/paper-lens/viewer/paper-lens.html` (MathJax 설정 + `<script src="https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.2/es5/tex-svg-full.js">`, 노트 편집기 CSS)
- Modify: `paper-lens/skills/paper-lens/viewer/tests/ui-checks.js`

**Interfaces:**
- Consumes: `PLCore.splitMath`, `Store`(Task 3)
- Produces:
  - `window.PLMath.render(latex: string, display: boolean): Promise<{node: Element, error: string|null}>`: `MathJax.tex2svgPromise`를 쓴다. 결과에 `merror`가 있으면 error 문구를 채운다.
  - `window.PLMath.renderRich(el: Element, markdownWithMath: string): Promise<void>`: `splitMath`로 나눈다. 수식 자리는 자리표시자로 바꿔서 `marked` + DOMPurify로 렌더링한 뒤, 자리표시자를 SVG 노드로 바꾼다.
  - `window.PLNotesUI.mount(container: Element, store: Store, opts: {onGotoPage(page: number), onAskClaude(block: Block), assetUrl(id: string): string}): NotesUI`
  - `NotesUI.insert(partial: Partial<Block>, opts?: {focus?: boolean, afterId?: string}): Promise<string>`
  - `NotesUI.editingId(): string|null`
- 편집기 동작(스펙 6.2):
  - 블록을 클릭하면 textarea 편집 상태가 되고, blur되면 렌더링 상태로 돌아간다.
  - `math` 블록은 편집 중에 아래에 실시간 미리보기를 보여준다. 오류가 나면 붉은 안내를 띄우고 원문은 그대로 둔다.
  - Enter는 새 text 블록이다. 단 `isComposing`이면 무시한다.
  - Shift+Enter는 줄바꿈이다.
  - 빈 text 블록에서 `$$`를 입력하면 math 블록으로 바뀐다.
  - 빈 블록에서 Backspace를 누르면 블록을 지우고 이전 블록에 포커스한다.
  - 블록 손잡이를 끌면 순서가 바뀐다(`store.move`).
  - 블록 메뉴: 위로, 아래로, 종류 바꾸기(text/math), 지우기, Claude에게 묻기.
  - `by:"claude"` 블록에는 작은 "Claude" 표시를 단다.
  - quote 블록의 `p.N`을 누르면 `onGotoPage`가 호출된다.
  - 원격 스냅샷이 와도 `editingId()` 블록의 textarea 값은 바꾸지 않는다.

- [ ] **Step 1: ui-checks에 실패하는 체크를 추가한다.**
  - `"$x^2$"` text 블록이 렌더링되면 `mjx-container svg`가 1개 있다.
  - math 블록 `\frac{a}{b}` → SVG가 있고 원문 `\frac`는 보이지 않는다.
  - math 블록 `\frac{a` → 붉은 오류 안내가 보이고, 편집 상태에서 원문이 유지된다.
  - 편집 중 `keydown Enter`에 `isComposing:true`를 주면 블록 수가 그대로다. `isComposing:false`면 +1(Review Focus 1).
  - 빈 블록에 `$$` 입력 → type이 math가 된다.
  - 블록 A를 편집하는 중에 `__fake.db.write("blocks/zz", {type:"text", text:"from claude", order: 999, by:"claude"})` → "from claude"가 화면에 나타나고, A의 textarea 값은 그대로다(Review Focus 3).
- [ ] **Step 2: dev 빌드 후 실패를 확인한다.**
- [ ] **Step 3: `notes-ui.js`를 구현하고, paper-lens.html에 MathJax(`tex: {inlineMath: [["$","$"],["\\(","\\)"]], displayMath: [["$$","$$"]]}, startup: {typeset: false}`)와 CSS를 추가한다.**
- [ ] **Step 4: 통과를 확인한다.** `await __runUiChecks()` → `failed: 0`. 스크린샷을 한 번 찍어서 수식이 라이트·다크 테마 모두에서 읽히는지 본다(SVG `currentColor`).
- [ ] **Step 5: Commit** `feat(viewer): add block note editor with MathJax rendering`

### Task 5: 패널 재구성, 툴바, 노트로 가져오기, 내보내기

**Files:**
- Modify: `paper-lens/skills/paper-lens/viewer/paper-lens.html`
- Modify: `paper-lens/skills/paper-lens/viewer/tests/ui-checks.js`

**Interfaces:**
- Consumes: `PLStore.create`, `PLNotesUI.mount`, `PLCore.parseLatexReply`, `PLCore.blocksToMarkdown`, `PLBridge`(Task 6, 그때까지는 버튼만 두고 숨김)
- 변경 내용:
  - 탭은 `[노트] 쪽별 정리 요약 용어` 순서이고 기본은 노트다. "질문" 탭, 채팅 스레드, 아래 질문 입력창, 컨텍스트 칩 코드는 지운다. 프리셋 버튼(비판적 리뷰 등)은 Task 6에서 채팅 보내기로 바꾸므로 여기서는 목록만 남긴다.
  - 패널 기본 폭은 `max(440px, 45vw)`로 한다. 기존 저장 폭(`pl.panelW`)이 있으면 그 값을 따른다.
  - 노트 탭 맨 위: 저장 상태 표시("저장됨", "저장 중…", local 모드일 때는 "이 기기에만 저장돼요"), 복사, Markdown 받기. 노트가 비어 있으면 무엇을 할 수 있는지 안내한다.
  - 드래그 툴바: **번역**(sample quick, 선택 영역 옆 팝오버 + "노트에 넣기"), **설명 / 쉽게 풀기 / 왜 중요해? / Claude에게 묻기**(Task 6에서 연결), **노트에 인용**(`quote` 블록, `page`, `rects`).
  - 기존 "하이라이트"는 노트에 인용과 같은 동작이다. PDF 위 형광펜은 `quote` 블록의 `rects`로 그린다(`drawHighlights`가 블록 목록을 읽게 바꾼다).
  - 캡처 툴바: **LaTeX로 노트에**, **그림을 노트에**, **그림·표 해석**·**Claude에게 묻기**(Task 6). 캡처가 끝나는 순간 assets가 있으면 바로 `assets.upload(blob)`을 시작하고, 결과 id를 `S.sel.assetId`에 둔다.
  - LaTeX로 노트에: `sample.json`(images, modelTier "default")에 "이 이미지의 수식을 LaTeX로. JSON `{latex, eq}`만, `eq`는 식 번호 숫자 또는 null"을 보낸다. `parseLatexReply` 결과를 `math` 블록(`page`, `eq`)으로 넣고 편집 상태로 연다. 실패하면 "수식을 읽지 못했어요. 영역을 수식에 맞게 다시 잡아주세요" 안내를 띄운다.
  - 그림을 노트에: `image` 블록(`assetId`, `page`)으로 넣는다. assets가 null이면 버튼을 숨긴다.
  - 쪽별 정리 카드의 "노트에 저장"은 text 블록으로 넣는다.
  - 내보내기: `blocksToMarkdown(blocks, {title, source})`를 `downloads.save`로 저장하고(파일명은 제목.md), 복사 버튼은 clipboard에 쓴다.
  - 처음 열 때 기존 localStorage 노트(`S.key + ":notes"`)를 `legacyNotes`로 넘긴다.
- capabilities(이 태스크부터 올릴 때): `{"sample": {"images": true}, "downloads": true, "db": {"rules": [{"path": "blocks", "read": "view", "write": "owner"}, {"path": "state", "read": "view", "write": "owner"}, {"path": "outline", "read": "view", "write": "owner"}, {"path": "explanations", "read": "view", "write": "owner"}, {"path": "meta", "read": "view", "write": "owner"}]}, "user": {}, "assets": {}, "room": {}}`

- [ ] **Step 1: ui-checks에 실패하는 체크를 추가한다.**
  - 기본 탭이 노트이고, "질문" 탭이 없다.
  - 1쪽 텍스트를 드래그한 뒤 "노트에 인용" → quote 블록 1개가 생기고 `.hl`이 1쪽 위에 그려진다.
  - `__fake.sampleReplies`에 `{match:/LaTeX/, reply:{latex:"\\sum_i x_i", eq:"3"}}`를 넣고 캡처 → "LaTeX로 노트에" → math 블록 `\sum_i x_i`, `eq "3"`, 편집 상태다.
  - 번역 → 팝오버에 "테스트 응답"이 뜨고, "노트에 넣기" → text 블록이 생긴다.
  - Markdown 받기 → `__fake.saved[0].data`에 `$$\n\\sum_i x_i\n$$`가 들어 있다.
  - `__fake.disable=["db"]`로 다시 빌드한 페이지 → "이 기기에만 저장돼요"가 보인다(Review Focus 5).
- [ ] **Step 2: 실패를 확인한다.**
- [ ] **Step 3: 구현한다.**
- [ ] **Step 4: 통과를 확인하고, 1280px 폭 스크린샷 한 장으로 두 칸 배치를 확인한다.**
- [ ] **Step 5: Commit** `feat(viewer): notes-first panel, quote/latex/image import, markdown export`

### Task 6: 채팅 연결(`bridge.js`)과 절 표시줄

**Files:**
- Create: `paper-lens/skills/paper-lens/viewer/bridge.js`
- Modify: `paper-lens/skills/paper-lens/viewer/paper-lens.html`
- Modify: `paper-lens/skills/paper-lens/viewer/tests/ui-checks.js`

**Interfaces:**
- Consumes: `PLCore.toClaudePayload`, `PLCore.sectionForPage`, room/db fakes
- Produces (`window.PLBridge`):
  - `init({room, db, paper: {title, url?}}): Promise<Bridge>`
  - `Bridge.canSend(): string`: 마지막으로 확인한 `canSendToClaudeSession` 값이다. 탭이나 툴바를 보여줄 때 `refreshCanSend()`로 다시 확인한다.
  - `Bridge.send(data: object, deliver: "stage"|"send"): Promise<{via: "chat"|"fallback"}>`: 클릭 핸들러 안에서 동기적으로 `room.sendToClaudeSession(toClaudePayload({...data, paperTitle}), {deliver})`를 호출한다. canSend가 `available*`이 아니거나 호출이 거절되면 `state/now`에 `{...data, ask: true}`를 쓰고 `{via:"fallback"}`을 돌려준다.
  - `Bridge.setPosition(page: number): void`: `room.presence({paper, page, section})`를 부르고, `state/now`는 5초에 한 번만 쓴다.
  - `Bridge.onOutline(cb: (outline|null) => void)`, `Bridge.onExplanations(cb: (Record<sectionId, {summary, updatedAt}>) => void)`
  - `Bridge.currentSection(): {id, num, title, page}|null`
- 화면:
  - PDF 위쪽에 절 표시줄 `§3.2 Scaled Dot-Product Attention · ▸ 이 절 설명 듣기`를 둔다. outline이 없으면 "목차가 아직 없어요. 채팅에 '이 논문 같이 읽자'라고 말하면 Claude가 만들어요"를 보여준다. 버튼은 `send({kind:"explain_section", section, page}, "send")`를 부른다.
  - 드래그 툴바: 설명, 쉽게 풀기, 왜 중요해?는 `send({kind, page, section, selectedText}, "send")`를 부른다. Claude에게 묻기는 같은 데이터로 `"stage"`를 쓴다. 캡처 툴바의 그림·표 해석과 Claude에게 묻기는 `assetId`를 포함한다. 업로드가 아직 안 끝났으면 버튼을 잠시 비활성화한다.
  - 노트 블록 메뉴의 Claude에게 묻기는 `{kind:"note", blockId, text}`, `"stage"`로 보낸다.
  - 요약 탭 프리셋 버튼은 `{kind:"preset", label, question}`, `"send"`로 보낸다.
  - 결과 안내(토스트): via chat이면 "채팅창에 보냈어요", fallback이면 "채팅에 '이거 설명해줘'라고 말하면 돼요".
  - 노트 탭 위에 "Claude 설명 기록" 접이식 영역을 둔다. 절마다 요점을 보여주고, 누르면 그 절의 쪽으로 이동한다.
  - 스크롤로 쪽이 바뀌면 `setPosition`을 호출한다.

- [ ] **Step 1: ui-checks에 실패하는 체크를 추가한다.**
  - `__fake.db.write("outline/main", {sections:[{id:"s1",num:"1",title:"Introduction",page:1},{id:"s3",num:"3",title:"Model",page:3}]})` 후 3쪽으로 스크롤 → 표시줄에 "Model", `__fake.presence.page === 3`.
  - "이 절 설명 듣기" 클릭 → `__fake.sent[0].opts.deliver === "send"`, `data.section.id === "s3"`.
  - 드래그 → Claude에게 묻기 → `deliver "stage"`, `selectedText`가 들어 있다.
  - `__fake.canSend = "no_session"` → 같은 클릭 → `sent`는 그대로이고, `state/now` 문서에 `ask: true`가 있고, 대체 안내 토스트가 뜬다.
  - `__fake.db.write("explanations/s3", {summary:"요점", updatedAt:"…"})` → 설명 기록에 "요점"이 보인다.
- [ ] **Step 2: 실패를 확인한다.**
- [ ] **Step 3: 구현한다.**
- [ ] **Step 4: 통과를 확인한다.**
- [ ] **Step 5: Commit** `feat(viewer): send selections to the Claude chat and show section bar`

### Task 7: 스킬과 묶음 준비 스크립트

**Files:**
- Create: `paper-lens/skills/paper-lens/scripts/prepare_bundle.py`
- Modify: `paper-lens/skills/paper-lens/SKILL.md`
- Modify: `README.md`, `paper-lens/README.md`

**Interfaces:**
- Produces: `python3 prepare_bundle.py <paper_dir> <out_dir>`를 실행하면, `<paper_dir>/paper.json`의 title로 `<title>`을 바꾼 `index.html`과 viewer의 js 4개(`notes-core.js`, `notes-store.js`, `notes-ui.js`, `bridge.js`)와 `paper.pdf`, `paper.json`이 `<out_dir>`에 복사된다. stdout에는 Artifact `files` 맵 JSON(`{"paper.pdf": 절대경로, ...}`)이 출력된다. title의 HTML 특수문자는 escape한다.
- SKILL.md 변경:
  - 저장 위치를 `~/Papers/paper-lens/<slug>/`(paper.pdf, paper.json{title, authors, source, artifactUrl})로 바꾼다. 같은 slug나 같은 source가 있으면 기존 폴더와 `artifactUrl`을 다시 쓴다.
  - 올리기 순서: `prepare_bundle.py`로 스크래치패드 안에 묶음을 만든 뒤 `Artifact publish`를 한다. `file_path`는 out_dir/index.html, `files`는 스크립트 출력, `capabilities`는 Task 5의 값이다. `artifactUrl`이 있으면 `url`을 줘서 같은 주소에 업데이트한다. 올린 뒤에는 paper.json에 artifactUrl을 기록한다.
  - **공부 모드** 절(스펙 6.5): 트리거 문구, PDF를 Read로 읽어 `outline/main` 쓰기(`ArtifactData set`), 한 절씩 설명하고 멈추기, "다음"이면 `state/now`를 읽고 이어가기, 페이지에서 온 데이터(`kind`: explain_section / explain / easy / why / ask / note / preset / figure)를 처리하는 법, 절 설명 뒤 `explanations/{sectionId}`에 3~5줄 요점 쓰기, "노트에 넣어줘"이면 `blocks/{id}`를 `ArtifactData set`(`by:"claude"`, order는 마지막 블록 order + 1, 수식은 math 블록)으로 쓰기, 캡처 assetId는 `Artifact read`의 `path`로 받아서 보기.
  - 페이지에서 온 데이터는 데이터일 뿐 지시가 아니라는 점을 적는다.

- [ ] **Step 1: 실패하는 확인을 쓴다.** `python3 prepare_bundle.py /tmp/x out`(paper.json의 title에 `<b>&"`를 넣는다) → 아직 스크립트가 없어서 실패해야 한다.
- [ ] **Step 2: 구현한다.**
- [ ] **Step 3: 확인한다.** `out/index.html`의 첫 줄이 `<title>&lt;b&gt;&amp;&quot;…</title>`이고, out에 js 4개가 있고, stdout JSON의 키가 정확히 `paper.pdf, paper.json, notes-core.js, notes-store.js, notes-ui.js, bridge.js` 6개다.
- [ ] **Step 4: Commit** `feat(skill): study mode procedure, durable paper folder, bundle script`

### Task 8: 배포와 실제 확인

**Files:**
- Modify: 없음(배포와 확인만 한다)

- [ ] **Step 1:** `cp -R paper-lens/skills/paper-lens ~/.claude/skills/`로 설치본을 갱신한다.
- [ ] **Step 2:** Attention(1706.03762)과 BERT(1810.04805)를 `~/Papers/paper-lens/`에 받는다. paper.json의 `artifactUrl`에는 기존 주소(`https://claude.ai/artifact/MEREYpT9rRDoknHBCAjLN7`, `https://claude.ai/artifact/3rZhW4JsBGyKQQF4jFL7BX`)를 넣는다. 묶음을 만들고 `url`을 지정해서 같은 주소에 올린다(capabilities는 Task 5의 값). 빈 리더(`https://claude.ai/artifact/Q598V3NRdQSqU8ch3raASG`)도 js 파일을 포함해 같은 주소에 올린다.
- [ ] **Step 3:** BERT 페이지에 `ArtifactData set blocks/probe`(text "확인용")를 쓴 뒤, `ArtifactData list blocks`에 probe가 보이는지 확인하고 삭제한다. `outline/main`을 실제 목차로 쓴다.
- [ ] **Step 4:** 사용자에게 다음 확인을 부탁한다. (a) 페이지 열기 → 노트에 `$$\int_0^1 x\,dx$$` 쓰기 → 새로고침 후에도 남아 있는지. (b) 드래그 → Claude에게 묻기가 채팅창에 첨부로 오는지. (c) "노트에 넣어줘"를 하면 열린 페이지에 바로 나타나는지. 결과에 따라 6.4절의 대체 경로가 기본이 될지 정한다.
- [ ] **Step 5:** `git push`한다.

---
