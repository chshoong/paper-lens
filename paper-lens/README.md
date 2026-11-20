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
| **LaTeX 노트** | 오른쪽 노트 탭(기본). 블록 단위로 쓰고, `$x^2$`, `$$...$$` 수식이 바로 렌더링된다. 쓰는 중에도 미리보기가 뜬다. |
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
- 노트, 목차, 설명 기록은 논문 페이지에 저장된다. 끌어다 놓은 PDF의 노트는 그 기기에만 저장된다.
- 번역·요약은 페이지를 연 사람의 Claude 사용량을 쓴다. 처음 열 때 허용을 묻는다.
- 쪽 전체를 원문 그대로 통번역하는 요청은 저작권 때문에 Claude가 거절할 수 있어서, 쪽별 정리 + 문단 번역으로 제공한다.
- 논문 PDF 원본은 `~/Papers/paper-lens/<slug>/`에 보관된다.

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
