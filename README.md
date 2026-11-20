# Paper Lens

논문 PDF를 Claude 앱 안의 리더로 열어 주는 Claude Code 플러그인. Moonlight처럼 PDF 옆에 요약·쪽별 정리·그림 해석이 뜨고, 어떤 부분이든 드래그하거나 캡처해서 바로 Claude에게 물을 수 있다.

## 설치

Claude Code에서:
```
/plugin marketplace add chshoong/paper-lens
/plugin install paper-lens@paper-lens-marketplace
```
Claude 데스크톱 앱(Code 탭)에서는 + 버튼 → Plugins에서 같은 저장소를 마켓플레이스로 추가해도 된다.

플러그인 없이 스킬만 쓰려면 `paper-lens/skills/paper-lens` 폴더를 `~/.claude/skills/` 아래에 복사한다.

## 사용

그냥 말하면 된다.
- "이 논문 열어줘 https://arxiv.org/abs/1706.03762"
- "다운로드 폴더에 있는 transformer 논문 읽어줘"
- "~/Papers 폴더에서 논문 하나 골라서 열어줘"
- "이 논문 같이 읽자" (한 절씩 설명, 노트 연동)
- "방금 설명한 거 노트에 넣어줘"

플러그인으로 설치했다면 `/paper <경로 또는 링크>`도 쓸 수 있다.

## 리더 기능

| 기능 | 방법 |
|---|---|
| **노트 (노션식 편집)** | 오른쪽 노트 탭(기본). 쓰는 즉시 꾸며진다: ⌘B 굵게, ⌘I 기울임, ⌘U 밑줄, ⌘⇧S 취소선, ⌘E 코드, ⌘⇧H 형광펜, 줄 앞 `## `·`- `·`1. `·`[] `·`> ` 자동 변환, `$x^2$` 즉시 수식(눌러서 고치기), 글자를 고르면 제목·크기·글자색·형광펜 도구막대. ⌘Enter 새 블록, Esc 편집 끝 |
| 수식 블록 | 빈 줄에 `$$` + 띄어쓰기 → 따로 둔 수식(LaTeX, 실시간 미리보기) |
| 논문 수식 → 노트 | `C`로 수식 영역 캡처 → "LaTeX로 노트에" |
| 인용·그림 → 노트 | 문장 드래그 → "노트에 인용"(PDF에 형광펜이 남음), 캡처 → "그림을 노트에" |
| Claude와 공부 | 채팅에 "이 논문 같이 읽자" → 한 절씩 설명. 페이지 위 "▸ 이 절 설명 듣기", 드래그 → "설명/쉽게 풀기/Claude에게 묻기"는 채팅으로 간다 |
| Claude가 노트에 쓰기 | 채팅에서 "노트에 넣어줘" |
| 쪽별 정리 | 지금 쪽을 문단 카드로 정리, 문단 단위 원문·번역 비교 |
| 번역 | 문장 드래그 → "번역"(팝오버, 노트에 넣기 가능) |
| 요약·용어 | 요약 탭(3줄 요약, 읽기 가이드), 용어 탭 |
| 내보내기 | 노트 탭 "Markdown 받기"(수식은 `$`, `$$` 그대로) |
| 확대/축소 | 상단 버튼, 핀치, Ctrl/⌘ + 휠 |

참고
- 노트는 Markdown으로 저장되고, 밑줄·글자색·형광펜·크기는 작은 HTML 태그로 들어간다. Markdown으로 내보내면 Obsidian에서는 대부분 보이고, 노션으로 가져가면 굵게·제목·목록 정도만 남는다.
- 노트, 목차, 설명 기록은 논문 페이지에 저장된다. 끌어다 놓은 PDF의 노트는 그 기기에만 저장된다.
- 번역·요약은 페이지를 연 사람의 Claude 사용량을 쓴다. 처음 열 때 허용을 묻는다.
- 쪽 전체를 원문 그대로 통번역하는 요청은 저작권 때문에 Claude가 거절할 수 있어서, 쪽별 정리 + 문단 번역으로 제공한다.
- 논문 PDF 원본은 `~/Papers/paper-lens/<slug>/`에 보관된다.

## 구조
```
.claude-plugin/marketplace.json           마켓플레이스 정보
paper-lens/.claude-plugin/plugin.json      플러그인 정보
paper-lens/commands/paper.md               /paper 명령
paper-lens/skills/paper-lens/SKILL.md      논문 열기, 공부 모드(한 절씩 설명), 노트 읽기·쓰기 절차
paper-lens/skills/paper-lens/scripts/      PDF 가져오기, 올릴 묶음 준비
paper-lens/skills/paper-lens/viewer/       리더 페이지(pdf.js, MathJax) + notes-core/store/ui, bridge 스크립트, tests/
scripts/                                   개발용: dev_build.py, run_browser_tests.py, test_prepare_bundle.py
```
