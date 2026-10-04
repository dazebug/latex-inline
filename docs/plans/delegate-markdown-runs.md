# delegate-markdown-runs

- 절차 정본: `drive-agent-loop` 스킬과 이 계획 파일 · 현재 배정은 0라운드 초안
- 대상: `/Users/choongjaelee/mods/latex-inline-delegate-work`
- 시작 커밋: `37376ae`
- 기준 트리: `/Users/choongjaelee/mods/latex-inline-fix_delegate-markdown-runs` (`fix/delegate-markdown-runs`) · 작업 트리: `/Users/choongjaelee/mods/latex-inline-delegate-work` (`fix/delegate-markdown-runs`)
- 현재: R0 · 마지막 승격 없음 · 리뷰 중 없음 · 게이트 미실행
- 최근 검증자 판정: 미요청 · 원문 없음

## 배경 — 확인한 원천

- [Claude Code mod events](https://code.claude.com/docs/en/plugins/mods/events.md) — 같은 이벤트의 훅은 미들웨어 체인이며, `next` 없이 답하면 아래 훅이 실행되지 않는다. 직접 설치한 mod의 의존성 순서는 문서에 있지만 로컬 로드와 설치본 사이의 순서는 정해져 있지 않다는 점은 배정의 확인 사실이다.
- [Claude Code mod interface](https://code.claude.com/docs/en/plugins/mods/interface.md) — `await next(e)` 의 엔진 결과를 자기 `Box` 트리의 자식으로 넣으면 엔진 그림을 유지할 수 있다.
- [mermaid-inline `hooks/register.tsx`](https://github.com/dazebug/mermaid-inline/blob/9712b468e22d1b3993d734d455de15efd21c9a1c/hooks/register.tsx) — Markdown 구간마다 `next` 를 호출하고, 반환된 엔진 요소를 트리에 넣으며, 이후 엔진 블록의 gutter 와 간격을 보완하는 사례다.

## 목표

그림 모드의 terminal `AssistantMessage` 에서 수식이 든 문단·목록·단독 display 수식은 latex-inline 이 그린다. 연속한 나머지 Markdown 블록은 하나의 구간으로 합쳐 `unicodeMath` 변환 뒤 자르지 않고 한 번에 `next` 로 넘기며, 반환된 엔진·하위 mod 요소를 최종 트리에 포함한다. Latex Inline 이 바깥인 경로는 하니스로 고정하고, Mermaid Inline 이 바깥인 경로는 하니스로 순서를 고정할 수 있을 때만 하니스로, 아니면 드라이버의 실제 세션 대조로 확인한다. 글자 모드·꺼짐 모드·다른 surface·렌더 중이거나 실패한 수식·블록 간 bullet, gutter, 빈 줄은 기존 계약을 유지한다.

## 완료의 정의

- 반드시 재현해 막아야 끝인 실패: terminal 그림 모드 답변에 문장 속 수식과 fenced mermaid 블록이 함께 있을 때, latex-inline 이 `next` 를 부르지 않아 수식만 그림이 되고 mermaid 블록은 코드로 남으며 mermaid-inline 이 호출되지 않는다.
- acceptance oracle: `tests/render.test.ts` 의 `claude-code/testing` 하니스에서 latex-inline 이 바깥인 방향을 고정하고, 바닥 `on('ui.render')` 관찰자가 위임된 Markdown 구간 텍스트·`isFirstOfReply`·`onScreen` 을 받으며 downstream 요소가 최종 트리에 남는지 확인한다. Mermaid Inline 이 바깥인 방향은 하니스가 순서를 고정할 수 있음을 먼저 확인하고, 가능하면 하니스로 고정하며 그렇지 않으면 드라이버의 실제 세션 대조로 확인한다. 수정 전 새 회귀 테스트가 실패하고 수정 뒤 통과해야 한다. 구현 단계 게이트는 `claude plugin test`, `node --test tests/font-metrics.test.mjs`, `claude plugin validate --strict .claude-plugin/plugin.json` 이다.
- 코퍼스 범위: N/A — 사용자 데이터 코퍼스가 아닌 고정 렌더 fixture 를 쓴다.
- 원자성·부분 실패·롤백 경계: N/A — 변경은 렌더 체인 조합과 manifest 버전뿐이고 새 외부 쓰기나 되돌릴 수 없는 동작을 추가하지 않는다. 기존 그림 캐시와 렌더 대기열 동작은 변경 대상이 아니다.

## 상정 행위자 — 누가 이 실패를 일으킬 수 있는가

- AssistantMessage 작성자 (모델 또는 사용자): 같은 답변에 latex-inline 이 인식하는 수식 블록과 아래 mod 가 처리하는 Markdown 블록을 함께 둔다. latex-inline 의 바깥 `ui.render` 가 그 답변을 직접 끝내면 체인 안쪽 mod 가 그 블록에 닿지 못한다.

## 비목표 — 건드리지 않는다

- `hooks/parse.ts` 의 수식 문법·블록 분류는 건드리지 않는다 (`splitMarkdown` 이 쓰이지 않게 되어 제거하는 경우는 예외). `hooks/unicode.ts` 의 변환 규칙도 바꾸지 않는다.
- 수식 렌더러, 글꼴 측정, 그림 캐시, 색상, 프롬프트 지침 및 `/latex-inline` 명령: 이번 체인 결함과 무관하다.
- mermaid-inline 의 구현·manifest 의존성 또는 mod 로드 순서: 순서를 바꾸지 않고 어느 쪽이 바깥이어도 다음 훅을 호출하게 한다.
- 다른 surface 와 비 terminal 렌더 동작, 글자·꺼짐 모드의 표시 규칙은 건드리지 않는다.

## 불변 원칙

- 그림 모드에서 수식이 없는 답변은 전체 원문을 기존 fallback 으로 `next` 에 넘긴다. 수식 블록이 있는 답변에서는 연속한 `kind: 'markdown'` 블록을 하나의 구간으로 합쳐 `unicodeMath` 변환 후 자르지 않고 `next({ ...e, props: { ...e.props, text, isFirstOfReply } })` 를 한 번 호출한다. 이 경로는 `Markdown` 요소를 직접 만들지 않는다.
- `text` 모드는 `unicodeMath` 로 전체 답변을 변환한 뒤 `next` 에 넘기고, `off` 모드와 terminal 이 아닌 surface 는 원문 입력으로 `next` 에 넘긴다. 변환은 downstream 이 처리할 수 있는 fenced code 와 code span 을 바꾸지 않는다.
- 그림 모드에서 table·heading·block quote 같은 직접 그림 대상이 아닌 구간의 수식은 `unicodeMath` 를 적용한 텍스트를 `next` 에 넘긴다. 엔진 결과는 Markdown 원문이 아니라 `RenderElement` 이므로 변환은 위임 전에 끝내며, fenced/code span 안의 LaTeX 는 기존 변환기대로 보존한다.
- 직접 그리는 문단·목록·단독 display 수식은 그림이 아직 없거나 렌더 실패여도 원문 수식을 흐리게 표시하고 계속 그린다. 이 상태가 Markdown 구간의 위임을 막거나 답변 전체를 조기에 반환해서는 안 된다.
- `isTop` 과 `isFirst` 를 따로 추적한다. 처음 출력하는 블록이 위임 구간일 때만 원래 `isFirstOfReply` 를 그 `next` 호출에 전달하고, 앞서 직접 그린 블록이 있거나 출력 블록이 이어지면 다음 호출에는 `false` 를 전달한다. 직접 그린 행에는 2열 gutter 를 두고, 첫 답변 블록이며 `isFirstOfReply` 가 true일 때만 현재 bullet 정렬을 적용한다. 첫 시각 블록은 받은 그대로 배치한다. 뒤따르는 `{ type: 'engine' }` 결과는 빈 2열 gutter 로 감싸되 엔진이 이미 주는 위쪽 빈 줄에 margin 을 더하지 않는다. 뒤따르는 하위 mod 결과에는 한 줄 여백만 더하고 트리와 자체 gutter 를 그대로 보존한다. 직접 그린 후속 블록도 한 줄 간격과 빈 gutter 를 갖는다.
- 각 위임은 입력 envelope 전체를 spread 해 `surface`, `component`, `requestId`, `viewport` 를 유지하고 props 도 spread 해 읽기 전용 `onScreen` 을 바꾸거나 제거하지 않는다. Claude Code 타입의 근거는 clone 에 없어서 읽기 전용 fallback `/Users/choongjaelee/mods/latex-inline/.claude-plugin/types/claude-code/index.d.ts` 의 `RenderInputOf`, `RenderPropsOf.AssistantMessage`, `Next`, `{ type: 'engine' }`, `claude-code/testing` 선언이다.
- 항목 1의 첫 작업으로 `TestOptions.plugins` 에서 inline plugin 이 시험 대상 latex-inline 바깥·안쪽에 오는지, tier 등으로 순서를 실제 고정할 수 있는지 하니스에서 확인한다. Latex Inline 이 바깥인 방향은 하니스에서 고정하고 바닥 `on('ui.render')` 관찰자가 위임 텍스트를 받는지 확인한다. Mermaid Inline 이 바깥인 방향은 하니스가 순서를 고정할 수 있을 때만 하니스로, 아니면 드라이버가 실제 세션에서 대조한다.
- `tests/render.test.ts` 에 회귀 테스트를 먼저 추가해 현재 단절을 red 로 확인한 뒤 구현한다. 테스트는 `claude-code/testing` 의 `test`, `TestOptions`, `$.ui.mount`, `Mounted.drawn/find/findAll`, `FoundElement` 를 사용한다. Mermaid 바깥 방향을 `TestOptions.plugins` 로 고정할 수 있다고 타입 선언만으로 단정하지 않는다.
- `MARKDOWN_LIMIT` 은 위임 경로에서 더는 쓰이지 않으므로 제거한다. `splitMarkdown` 의 현재 사용처는 위임 경로와 `tests/support.test.ts` 의 두 분할 테스트뿐이다. 따라서 항목 1에서 호출·상수·export 및 그 두 테스트를 함께 제거하고, 다른 사용처가 발견되면 소탕 표에 근거와 이유를 남긴다.

## 배치 점검 (0라운드)

모드: ultrafast

| 점검 | 결과 |
|:--|:--|
| `git check-ignore -q .claude/worktrees/probe` → ignored (아니면 `.gitignore` 또는 `info/exclude`에 `.claude/worktrees/`) | N/A — 대안 모드 (대상 리포가 세션 리포와 달라 EnterWorktree 미사용) |
| 설정 `worktree.baseRef: "head"` — 에이전트 첫 보고의 `git log --oneline -2`가 기준 HEAD를 보이는가 | N/A — 작업 트리는 전용 clone, HEAD `37376ae` 확인 |
| 에이전트 첫 보고: 작업 트리 경로 · 브랜치 · HEAD | `/Users/choongjaelee/mods/latex-inline-delegate-work` · `fix/delegate-markdown-runs` · `37376ae`; 최근 2개: `37376ae Show the screenshot inside a Claude Code session, with a table`, `8ef379e Keep the cyrb53 link in the README, out of the hooks module` |
| 리포 오버레이 `.claude/drive-agent-loop.md` — 기준 트리의 경로(메인 것을 복사했으면 그렇게), 없으면 드라이버가 골격으로 작성. 커밋하지 않는다 — `오버레이 무시: ignored` 확인 | `/Users/choongjaelee/mods/latex-inline-fix_delegate-markdown-runs/.claude/drive-agent-loop.md` · info/exclude로 ignored |
| cmux 패널 (점검 블록 `cmux:` 신호가 켜졌을 때만, 아니면 N/A) — `cmux markdown open <작업 트리 계획 파일 절대경로>` → pane id. 계획 파일 첫 승격 전에 채운다 | pane:53 (surface:86) |
| 트리마다 의존성 동기화 (기준·작업) | 기준·작업 트리 모두 `npm ci --ignore-scripts` 완료 |
| git 밖 로컬 자산을 가리키는 env (이름=절대경로) — 에이전트가 읽기 확인 | N/A |
| 증분 리뷰 소요(분) — 첫 세 번 | 아직 리뷰 없음 |

## 작업 항목

| # | 항목 | 부류 | 확정 결함 | 파일 집합 | 의존 | 상태 | 근거 | 승격 |
|:--|:--|:--|:--|:--|:--|:--|:--|:--|
| 1 | 그림 모드에서 전체 AssistantMessage 를 직접 그려 `next` 없이 끝내는 경로를 수식 블록 그림과 나머지 Markdown 위임으로 교체하고, 쓰이지 않는 분할 경로를 제거 | `ui.render` 체인 합성 | (a) 수식 포함 답변 전체를 직접 그려 `next` 없이 끝냄 (b) 위임 구간을 여러 번 나누면 답변 중간에 빈 줄이 낌 | `hooks/register.tsx`, `hooks/parse.ts`, `tests/render.test.ts`, `tests/support.test.ts` | — | todo | | |
| 2 | mod 버전을 `0.3.1` 에서 `0.3.2` 로 올림 | 배포 metadata | — | `.claude-plugin/plugin.json` | 1의 계약과 acceptance 통과 | todo | | |
| 3 | README 의 `ui.render` 설명에 수식 없는 구간을 다음 훅에 넘겨 Mermaid Inline 등과 한 답변을 나눠 그린다는 점을 넣고 10,000자 항목을 삭제 | 문서 | (a) Hooks 줄에 다음 훅 위임 설명이 없음 (b) 10,000자 답변 전체 Unicode fallback 설명이 새 경로에서는 사실과 다름 | `README.md` | 1의 계약과 acceptance 통과 | todo | | |

## 결정 원장

| # | 유형 | 주장/위험 | 결정 | 근거 (명령·수치·경로 · SHA 또는 리뷰 번호) | 잔여 불확실성 |
|:--|:--|:--|:--|:--|:--|
| D1 | 사용자 | 범위 | "latex-inline 수정하고 버전업, /drive-agent-loop ultrafast, 끝나면 /gh-pr-drive automerge" — 이 지시를 방향 승인으로 본다 | 사용자 메시지 (2026-10-04) | 없음 |
| D2 | 드라이버 | 10,000자 분할 유지 | 기각 — 위임 구간은 엔진이 그려 `Markdown` 요소 한도가 없다 | R0-1 | 아주 긴 답변에서 엔진 렌더 비용 (실측 전) |
| D3 | 드라이버 | mermaid-inline 바깥 방향의 회귀 고정 | 하니스로 순서를 정할 수 있으면 하니스, 아니면 실제 세션 대조 | R0-3 | 하니스 순서 규칙 미확인 |

## 전수 소탕 표

| 대상 | 판정 | 코드로 알 수 없는 이유 또는 `파일:행` |
|:--|:--|:--|
| 그림 모드가 수식 블록을 직접 그리고 답변 전체를 반환하는 경로 | 구멍 (항목 1) | `hooks/register.tsx:261`, `hooks/register.tsx:367` |
| 아래로 넘기는 mode·surface fallback | 안전 · 회귀 고정 | `hooks/register.tsx:261`, `hooks/register.tsx:266`, `hooks/support.ts:26` |
| 수식·Markdown 블록 분류 | 안전 · 재사용 | `hooks/parse.ts:153`, `hooks/parse.ts:178` |
| Markdown 내 수식 유니코드 변환과 code 보존 | 안전 · 변환기 재사용 | `hooks/unicode.ts:540`, `hooks/unicode.ts:587` |
| text·off·table 렌더 특성화의 위임 관찰 | 구멍 (항목 1) | `tests/render.test.ts:19`, `tests/render.test.ts:43` |
| `splitMarkdown` · `MARKDOWN_LIMIT` | 항목 1에서 제거 · 잔여 사용처 없음 | 현재 참조: `hooks/register.tsx:13`, `hooks/register.tsx:279`, `hooks/parse.ts:205`, `tests/support.test.ts:3`, `tests/support.test.ts:8`, `tests/support.test.ts:13` |
| manifest 버전 단일 선언 | 항목 2 | `.claude-plugin/plugin.json:4` |
| README Hooks 설명과 10,000자 fallback 항목 | 항목 3 | `README.md:115`, `README.md:123` |

## 라운드 로그

### R0

#### 설계 리뷰 — R0 판정 반영 · 승격 전 · 원문 사용자 메시지 (2026-10-04)

- 반박: R0-1 위임 구간 분할(높음), R0-2 README 비목표(중간), R0-3 하니스 순서 가정(중간), R0-4 원장 D1(낮음)
- 처리: R0-1 반영(불변 원칙 정정·항목 1 확정 결함 a·b), R0-2 반영(항목 3 추가), R0-3 반영(acceptance 정정·열린 질문), R0-4 반영(D1∼D3)
- 실측: `splitMarkdown` · `MARKDOWN_LIMIT` 현재 참조는 `hooks/register.tsx` · `hooks/parse.ts` · `tests/support.test.ts`; 기준·작업 의존성 동기화 완료; cmux pane:53 (surface:86). Clone 확인 `git rev-parse --show-toplevel` → `/Users/choongjaelee/mods/latex-inline-delegate-work`; `git branch --show-current` → `fix/delegate-markdown-runs`; `git log --oneline -2` → `37376ae`, `8ef379e`; `claude --version` → `2.1.289 (Claude Code)`. 이번 수정에서 테스트·font-metrics·manifest 게이트는 실행하지 않음.
- 판정: "반박 4건 반영 조건으로 이 계획으로 시작하는 데 합의한다."

## 열린 질문

- 항목 1의 첫 작업 — `TestOptions.plugins` 에서 inline plugin 이 시험 대상 latex-inline 의 바깥 또는 안쪽에 오는지, tier 등으로 순서를 실제 고정할 수 있는지 하니스에서 확인한다. 고정 가능하면 Mermaid Inline 바깥 방향도 하니스로 테스트하고, 불가능하면 드라이버가 실제 세션에서 대조한다 (D3).
- 항목 1 — 테스트 하니스가 바닥 `on('ui.render')` 의 반환값으로 만든 `{ type: 'engine', ref: 0 }` 를 mount tree 안에서 유효한 engine 요소로 받아들이는지는 타입 선언만으로 확인되지 않았다. 구현 시 이 표현을 써 gutter 경로를 직접 고정할 수 있는지 먼저 확인한다. 위임 자체는 바닥 hook 이 받은 텍스트로 독립 검증할 수 있다.
