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

플러그인으로 설치했다면 `/paper <경로 또는 링크>`도 쓸 수 있다.

## 리더 기능

| 기능 | 방법 |
|---|---|
| 3줄 요약·읽기 가이드·한계·선행 개념 | 열면 자동 (요약 탭) |
| 쪽별 정리 | 지금 쪽을 문단 카드로 정리. 카드를 누르면 PDF의 그 문단으로 이동, "이 문단 번역"으로 원문과 번역을 나란히 비교 |
| 선택 → 번역·설명·쉽게 풀기·질문 | 문장 드래그 |
| 그림·표·수식 해석 | `C` 누르고 영역 드래그 |
| 논문 전체 질문 | 아래 입력창 |
| 비판적 리뷰, 랩미팅 개요, 예상 질문, 의사코드, 후속 연구 | 요약 탭의 버튼 |
| 용어 사전 | 용어 탭 |
| 하이라이트·답변 저장, Markdown 내보내기 | 노트 탭 |
| 확대/축소 | 상단 버튼, 핀치, Ctrl/⌘ + 휠 |

참고
- 요약·번역·질문은 리더 페이지를 연 사람의 Claude 사용량을 쓴다. 처음 열 때 허용을 한 번 묻는다.
- 쪽 전체를 원문 그대로 통번역하는 요청은 저작권 때문에 Claude가 거절할 수 있어서, 쪽별 정리 + 문단 단위 번역으로 제공한다.
- 논문별 리더 페이지는 비공개로 만들어진다. 공유하면 PDF도 함께 공유되니 저작권에 유의.

## 구조
```
.claude-plugin/marketplace.json           마켓플레이스 정보
paper-lens/.claude-plugin/plugin.json      플러그인 정보
paper-lens/commands/paper.md               /paper 명령
paper-lens/skills/paper-lens/SKILL.md      논문 찾기 → 준비 → 리더로 올리기 절차
paper-lens/skills/paper-lens/scripts/      PDF 가져오기 (arXiv/OpenReview 링크 변환)
paper-lens/skills/paper-lens/viewer/       리더 페이지 (pdf.js + Claude)
```
