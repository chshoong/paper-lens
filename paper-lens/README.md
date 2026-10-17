# Paper Lens

논문 읽기를 돕는 Claude 플러그인. Moonlight처럼 PDF 옆에 쪽별 정리·요약·그림 해석이 뜨고, 어떤 부분이든 드래그하거나 캡처해서 바로 Claude에게 물을 수 있다.

## 쓰는 법
```
/paper https://arxiv.org/abs/1706.03762
/paper ~/Downloads/paper.pdf
/paper ~/Papers            # 폴더 안 PDF 중에서 고르기
```
또는 그냥 "이 논문 열어줘 <링크>"라고 해도 된다.

## 리더 기능
| 기능 | 방법 |
|---|---|
| 3줄 요약·읽기 가이드·한계·선행 개념 | 열면 자동 (요약 탭) |
| 쪽별 정리 | 스크롤하면 지금 쪽을 문단별 카드로 정리. 카드를 누르면 PDF의 그 문단이 반짝이고, '이 문단 번역'으로 원문과 번역을 나란히 비교 (쪽 전체 통번역은 저작권 때문에 Claude가 거절) |
| 선택 → 번역/설명/쉽게 풀기/왜 중요해?/질문 | 문장 드래그 |
| 그림·표·수식 해석 | `C` 누르고 영역 드래그 |
| 논문 전체 질문 | 아래 입력창 (이전 대화 기억) |
| 비판적 리뷰, 랩미팅 개요, 예상 질문, 의사코드, 후속 연구 | 요약 탭의 버튼 |
| 용어 사전 | 용어 탭 |
| 하이라이트·답변 저장, Markdown 내보내기 | 노트 탭 |
| 답변 언어 | 한국어 / English / 日本語 / 中文 |

## 구조
```
skills/paper-lens/SKILL.md              논문 찾기 → 준비 → Artifact로 올리기 절차
skills/paper-lens/scripts/fetch_paper.sh 경로·링크에서 PDF 가져오기 (arXiv/OpenReview 링크 변환)
skills/paper-lens/viewer/paper-lens.html 리더 (pdf.js + Claude sample 기능)
commands/paper.md                       /paper 명령 (플러그인으로 설치할 때만)
.claude-plugin/plugin.json              플러그인 정보
```

## 설치 (개인 스킬)
skills/paper-lens 폴더를 통째로 ~/.claude/skills/ 아래에 복사하면 된다.
```
cp -R skills/paper-lens ~/.claude/skills/
```
고친 뒤에는 같은 명령으로 다시 복사한다. 그다음 "이 논문 열어줘 <링크>"처럼 말하면 된다.
