# delegate-markdown-runs

- 절차 정본: `drive-agent-loop` 스킬과 이 계획 파일 · 현재 배정: R1 체인 안쪽 합성
- 대상: `/Users/choongjaelee/mods/latex-inline-delegate-work`
- 시작 커밋: `37376ae`
- 기준 트리: `/Users/choongjaelee/mods/latex-inline-fix_delegate-markdown-runs` (`fix/delegate-markdown-runs`) · 작업 트리: `/Users/choongjaelee/mods/latex-inline-delegate-work` (`fix/delegate-markdown-runs`)
- 현재: R2 · 마지막 승격 fe8931b · 리뷰 중 없음 · 게이트 그린
- 최근 검증자 판정: no · cold · 사용자 메시지

## 배경 — 확인한 원천

- [Claude Code mod events](https://code.claude.com/docs/en/plugins/mods/events.md) — 같은 이벤트의 훅은 미들웨어 체인이며, `next` 없이 답하면 아래 훅이 실행되지 않는다. 직접 설치한 mod의 의존성 순서는 문서에 있지만 로컬 로드와 설치본 사이의 순서는 정해져 있지 않다는 점은 배정의 확인 사실이다.
- [Claude Code mod interface](https://code.claude.com/docs/en/plugins/mods/interface.md) — `await next(e)` 의 엔진 결과를 자기 `Box` 트리의 자식으로 넣으면 엔진 그림을 유지할 수 있다.
- [mermaid-inline `hooks/register.tsx`](https://github.com/dazebug/mermaid-inline/blob/9712b468e22d1b3993d734d455de15efd21c9a1c/hooks/register.tsx) — Markdown 구간마다 `next` 를 호출하고, 반환된 엔진 요소를 트리에 넣으며, 이후 엔진 블록의 gutter 와 간격을 보완하는 사례다.

## 목표

그림 모드의 terminal `AssistantMessage` 에서 수식이 든 문단·목록·단독 display 수식은 latex-inline 이 그린다. 연속한 나머지 Markdown 블록은 하나의 구간으로 합쳐 `unicodeMath` 변환 뒤 자르지 않고 한 번에 `next` 로 넘기며, 반환된 엔진·하위 mod 요소를 최종 트리에 포함한다. Latex Inline 이 바깥인 경로는 하니스로 고정하고, Mermaid Inline 이 바깥인 경로는 드라이버의 실제 세션 대조로 확인한다. 글자 모드·꺼짐 모드·다른 surface·렌더 중이거나 실패한 수식·블록 간 bullet, gutter, 빈 줄은 기존 계약을 유지한다.

## 완료의 정의

- 반드시 재현해 막아야 끝인 실패: terminal 그림 모드 답변에 문장 속 수식과 fenced mermaid 블록이 함께 있을 때, latex-inline 이 `next` 를 부르지 않아 수식만 그림이 되고 mermaid 블록은 코드로 남으며 mermaid-inline 이 호출되지 않는다.
- acceptance oracle: `tests/render.test.ts` 의 `claude-code/testing` 하니스에서 latex-inline 이 바깥인 방향을 고정하고, 바닥 `on('ui.render')` 관찰자가 위임된 Markdown 구간 텍스트·`isFirstOfReply`·`onScreen` 을 받으며 downstream 요소가 최종 트리에 남는지 확인한다. Mermaid Inline 이 바깥인 방향은 드라이버의 실제 세션 대조로 확인한다. 수정 전 새 회귀 테스트가 실패하고 수정 뒤 통과해야 한다. 구현 단계 게이트는 `claude plugin test`, `node --test tests/font-metrics.test.mjs`, `claude plugin validate --strict .claude-plugin/plugin.json` 이다.
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
- `isTop` 과 `isFirst` 를 따로 추적한다. 처음 출력하는 블록이 위임 구간일 때만 원래 `isFirstOfReply` 를 그 `next` 호출에 전달하고, 앞서 직접 그린 블록이 있거나 출력 블록이 이어지면 다음 호출에는 `false` 를 전달한다. 직접 그린 행에는 2열 gutter 를 두고, 첫 답변 블록이며 `isFirstOfReply` 가 true일 때만 현재 bullet 정렬을 적용한다. 첫 시각 블록이 `{ type: 'engine' }` 이고 `isFirstOfReply` 가 false면 빈 2열 gutter 로 감싼다; `isFirstOfReply` 가 true인 답변 첫 engine 결과나 다른 첫 시각 결과는 받은 그대로 배치한다. 뒤따르는 `{ type: 'engine' }` 결과는 빈 2열 gutter 로 감싸되 엔진이 이미 주는 위쪽 빈 줄에 margin 을 더하지 않는다. 뒤따르는 하위 mod 결과에는 한 줄 여백만 더하고 트리와 자체 gutter 를 그대로 보존한다. 직접 그린 후속 블록도 한 줄 간격과 빈 gutter 를 갖는다.
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
| 1 | 그림 모드에서 전체 AssistantMessage 를 직접 그려 `next` 없이 끝내는 경로를 수식 블록 그림과 나머지 Markdown 위임으로 교체하고, 쓰이지 않는 분할 경로를 제거 | `ui.render` 체인 합성 | (a) 수식 포함 답변 전체를 직접 그려 `next` 없이 끝냄 (b) 위임 구간을 여러 번 나누면 답변 중간에 빈 줄이 낌 | `hooks/register.tsx`, `hooks/parse.ts`, `tests/render.test.ts`, `tests/support.test.ts` | — | cleared | red: `claude plugin test` → 28 pass, 3 fail (`table beside drawn math`: `Received: []`; `math beside a Mermaid fence`: `Received: []`; `markdown block before math`: `Received: undefined`); toggle: `git apply -R .git/toggle.patch` + `claude plugin test` → 26 pass, 3 fail; restored: `git apply .git/toggle.patch` + `claude plugin test` → 29 pass, 0 fail; `node --test tests/font-metrics.test.mjs` → 4 pass, 0 fail; `claude plugin validate --strict .claude-plugin/plugin.json` → `Validation passed`<br>재실행(드라이버): `claude plugin test` → 29 pass, 0 fail(바깥 Mermaid 테스트 삭제 뒤 28) · `node --test tests/font-metrics.test.mjs` → 4 pass · `claude plugin validate --strict .claude-plugin/plugin.json` → Validation passed<br>실제 세션(드라이버, Haiku): latex 바깥(`CLAUDE_CODE_PLUGIN_DIRS=<clone>:<mermaid-inline clone>`) — 한 답변의 수식·다이어그램이 그림, 'latex-inline answered ui.render without next()' 0건 · mermaid 바깥(역순) — 수식·다이어그램이 그림 | |
| 2 | mod 버전을 `0.3.1` 에서 `0.3.2` 로 올림 | 배포 metadata | — | `.claude-plugin/plugin.json` | 1의 계약과 acceptance 통과 | verified | 재실행(드라이버): `claude plugin validate --strict .claude-plugin/plugin.json` → Validation passed · `claude plugin test` → 28 pass, 0 fail (구현자 샌드박스는 strict 검증의 api.anthropic.com 접속이 막힌다) | |
| 3 | README 의 `ui.render` 설명에 수식 없는 구간을 다음 훅에 넘겨 Mermaid Inline 등과 한 답변을 나눠 그린다는 점을 넣고 10,000자 항목을 삭제 | 문서 | (a) Hooks 줄에 다음 훅 위임 설명이 없음 (b) 10,000자 답변 전체 Unicode fallback 설명이 새 경로에서는 사실과 다름 | `README.md` | 1의 계약과 acceptance 통과 | verified | 재실행(드라이버): `claude plugin validate --strict .claude-plugin/plugin.json` → Validation passed · `claude plugin test` → 28 pass, 0 fail (구현자 샌드박스는 strict 검증의 api.anthropic.com 접속이 막힌다) | |
| 4 | 바깥 mod가 구간마다 latex-inline을 부르면 그림 키 `m1` 이 겹쳐 엔진이 트리 전체를 거부함 → `Image` 의 `key` 를 뺀다(latex-inline은 `$.ui.blit` 을 쓰지 않는다) | 체인 안쪽 합성 | — | `hooks/register.tsx`, `tests/render.test.ts` | 1 | verified | red: `claude plugin test` → 28 pass, 2 fail (`Image "m1" is drawn twice`); toggle: `git diff -- hooks/register.tsx > .git/toggle-item45.patch` · `git apply -R .git/toggle-item45.patch` 후 `claude plugin test` → 같은 2 실패 · 복원 `git apply .git/toggle-item45.patch`; green: `claude plugin test` → 30 pass, 0 fail · `node --test tests/font-metrics.test.mjs` → 4 pass, 0 fail<br>재실행(드라이버): `claude plugin test` → 30 pass, 0 fail · strict 검증 통과 · 실제 세션 mermaid 바깥, 검증자 입력(앞 `$a+b$` 문단·수식 없는 문단·mermaid·뒤 문단·`$x^2$` 문단): 트리 거부 없음, 다이어그램 앞뒤 수식과 다이어그램이 모두 그림, 다이어그램 뒤 문단이 2열 들여쓰기 | |
| 5 | 첫 구간이 위임 구간인데 답변의 첫 블록이 아니면(`isFirstOfReply` false) 엔진 그림을 gutter 없이 넣어 0열에 그려짐 → 첫 구간이어도 `isFirstOfReply` 가 false면 다른 엔진 구간처럼 빈 2열 gutter로 감싼다 | 체인 안쪽 합성 | — | `hooks/register.tsx`, `tests/render.test.ts` | 1 | verified | red: `claude plugin test` → 28 pass, 2 fail (gutter 기대 Box, 실제 `{ type: 'engine', ref: 1 }`); toggle: `git apply -R .git/toggle-item45.patch` 후 `claude plugin test` → 같은 2 실패 · 복원 `git apply .git/toggle-item45.patch`; green: `claude plugin test` → 30 pass, 0 fail · `node --test tests/font-metrics.test.mjs` → 4 pass, 0 fail<br>재실행(드라이버): `claude plugin test` → 30 pass, 0 fail · strict 검증 통과 · 실제 세션 mermaid 바깥, 검증자 입력(앞 `$a+b$` 문단·수식 없는 문단·mermaid·뒤 문단·`$x^2$` 문단): 트리 거부 없음, 다이어그램 앞뒤 수식과 다이어그램이 모두 그림, 다이어그램 뒤 문단이 2열 들여쓰기 | |

## 결정 원장

| # | 유형 | 주장/위험 | 결정 | 근거 (명령·수치·경로 · SHA 또는 리뷰 번호) | 잔여 불확실성 |
|:--|:--|:--|:--|:--|:--|
| D1 | 사용자 | 범위 | "latex-inline 수정하고 버전업, /drive-agent-loop ultrafast, 끝나면 /gh-pr-drive automerge" — 이 지시를 방향 승인으로 본다 | 사용자 메시지 (2026-10-04) | 없음 |
| D2 | 드라이버 | 10,000자 분할 유지 | 기각 — 위임 구간은 엔진이 그려 `Markdown` 요소 한도가 없다 | R0-1 | 아주 긴 답변에서 엔진 렌더 비용 (실측 전) |
| D3 | 드라이버 | mermaid-inline 바깥 방향의 회귀 고정 | 하니스로 순서를 정할 수 있으면 하니스, 아니면 실제 세션 대조 | `claude plugin test .git/scratch/inline-order-probe` → 기본·append 는 변환 후 텍스트, prepend 는 원문 관찰; tier 로 순서 고정 가능 | 없음 — `prepend` 와 `append` 로 앞뒤 방향 고정 가능 |
| D4 | 드라이버 | 바깥 Mermaid 방향의 회귀 고정 | 하니스 테스트를 커밋하지 않고 실제 세션 대조로 받는다 — 하니스에서 `tier: 'prepend'` 인 inline 플러그인이 바깥에 온다는 것은 실측했지만, 그 테스트는 수정 전 코드에서도 통과하고 latex-inline이 아니라 시험용 mod를 검사한다 | 실제 세션 두 방향 (위 근거 칸) | 엔진이 돌려준 `{ type: 'engine' }` 요소의 레이아웃은 하니스로 고정하지 않았다(실제 세션 화면으로만 확인) |
| D5 | 드라이버 | cold (2) 중 빈 줄 둘 | 이번 루프에서 고치지 않는다 — 안쪽 mod 트리의 위 여백을 두 mod가 서로 다르게 가정해서 생기며 mermaid-inline 쪽 변경이 필요하다(비목표) | cold 리뷰 2 | 사용자에게 mermaid-inline까지 포함한 여백 규약 정리를 묻는다 |
| D6 | 드라이버 | cold (3) ctrl+o 빈 줄 | 한계로 기록 — 엔진이 그 화면에서 위 여백을 주지 않는데 mod는 그 상태를 알 수 없다 | cold 리뷰 2 | `showMessageTimestamps` 켜진 일반 화면도 같은지 미실측 |
| D7 | 사용자 | 안쪽 mod 트리의 위 여백(빈 줄 둘)과 ctrl+o 빈 줄 | 이번 PR은 그대로 끝내고, 두 mod가 같은 여백 규약을 따르도록 latex-inline·mermaid-inline을 각각 후속 PR로 정리한다 | 사용자 답 (2026-10-05) | 후속 이슈로 승계 |

## 전수 소탕 표

| 대상 | 판정 | 코드로 알 수 없는 이유 또는 `파일:행` |
|:--|:--|:--|
| `hooks/register.tsx` · `session.start` | 안전 · 세션 설정 후 `next(e)` 호출 | `hooks/register.tsx:201` |
| `hooks/register.tsx` · `command.run` (`latex-inline`) | 정당한 직접 응답 · 이 mod가 등록한 자체 명령 | `hooks/register.tsx:236` |
| `hooks/register.tsx` · `prompt.compose` | 안전 · `next(e)` 결과에 그림 모드 안내를 추가 | `hooks/register.tsx:252` |
| `hooks/register.tsx` · `ui.render` (`AssistantMessage`) | 안전 · surface·off·text·수식 없는 경로는 위임; 그림 경로는 수식 블록만 직접 그리고 연속 Markdown 을 변환 후 위임 | `hooks/register.tsx:258`, `hooks/register.tsx:268`, `hooks/register.tsx:362` |
| `ui.render` 에서 위임하는 Markdown props | 안전 · envelope·props spread 로 `onScreen` 보존; `isFirstOfReply` 가 false인 engine 결과는 첫 구간이어도 빈 gutter 에 넣고, 하위 mod 요소 트리는 유지 | `hooks/register.tsx:363`, `tests/render.test.ts:89`, `tests/render.test.ts:123` |
| 렌더 중·실패 수식 | 안전 · 그림이 없으면 원문을 흐리게 그린 뒤 다음 블록 처리를 계속 | `hooks/register.tsx:288` |
| 수식·Markdown 블록 분류와 구간 내 Unicode 변환 | 안전 · 분류기와 변환 규칙 유지, 위임 전 Markdown 구간에 `unicodeMath` 적용 | `hooks/parse.ts:153`, `hooks/parse.ts:178`, `hooks/unicode.ts:587`, `hooks/register.tsx:363` |
| text·off·비 terminal fallback | 안전 · 기존 표시 규칙과 `next` 경로 유지 | `hooks/register.tsx:259`, `hooks/register.tsx:266`, `hooks/support.ts:26`; `tests/render.test.ts:22`, `tests/render.test.ts:36` |
| `MARKDOWN_LIMIT` · `splitMarkdown` | 제거 · `hooks/` 와 `tests/` 에 잔여 참조 없음 | `rg -n "MARKDOWN_LIMIT|splitMarkdown" hooks tests` → 결과 없음 (exit 1) |
| `tests/render.test.ts` 의 아래쪽 엔진 hook | 테스트 보조 · 위임 props 를 기록하고 `Text` 결과 또는 지정한 `{ type: 'engine', ref: 1 }` 을 돌려 트리 계약을 확인 | `tests/render.test.ts:9`, `tests/render.test.ts:22`, `tests/render.test.ts:24`, `tests/render.test.ts:123` |
| `tests/render.test.ts` 의 prepend inline fixture | 통합 계약 고정 · Mermaid 펜스 앞뒤의 수식 구간을 latex-inline 에 넘기고 양쪽 그림이 하나의 트리에 남는지 확인 | `tests/render.test.ts:73`, `tests/render.test.ts:111` |
| `ui.render` 의 그림 `Image` key · `imageCount` | 안전 · 둘 다 제거; `$.ui.blit` 호출이 없으므로 같은 트리에 합쳐지는 서로 다른 그림에 인스턴스 키가 필요하지 않음 | `hooks/register.tsx:286`, `tests/render.test.ts:111` |
| `ui.render` 의 `pictures` | 안전 · 호출마다 새 Map 을 만들고 해당 구간의 수식 조회 결과만 보관; 여러 호출은 이미지 노드의 key 를 공유하지 않음 | `hooks/register.tsx:271`, `hooks/register.tsx:287` |
| `ui.render` 의 `isFirst` | 안전 · 호출마다 입력 `isFirstOfReply` 로 시작하고 각 위임 뒤 false 로 전환; false일 때 engine 결과는 비어 있는 gutter 안에 배치 | `hooks/register.tsx:348`, `hooks/register.tsx:363`, `hooks/register.tsx:364` |
| `ui.render` 의 `isTop` | 안전 · 호출마다 true 로 시작해 이 mod 트리에서 처음 출력한 행만 추적; false인 입력의 첫 engine 결과도 gutter 배치 규칙을 따름 | `hooks/register.tsx:349`, `hooks/register.tsx:364` |
| `ui.render` 호출별 `width`, `asUnicode`, `blocks`, `jobs` | 안전 · viewport·입력 텍스트에서 호출마다 계산; 다른 호출 사이에 값을 보관하지 않음 | `hooks/register.tsx:260`, `hooks/register.tsx:263`, `hooks/register.tsx:268`, `hooks/register.tsx:272` |
| `ui.render` 호출별 `picture`, `word`, `flow`, `boxOf`, `groupBoxes` | 안전 · 해당 호출의 `pictures` 와 텍스트 설정만 참조하는 로컬 함수; 반환 Image 는 key 없이 각 트리에 포함 | `hooks/register.tsx:286`, `hooks/register.tsx:299`, `hooks/register.tsx:309`, `hooks/register.tsx:323`, `hooks/register.tsx:328` |
| `ui.render` 호출별 `lineWidth`, `first`, `firstRows`, `bullet` | 안전 · 파싱된 그 호출의 첫 블록에 맞춰 계산; bullet 은 첫 답변 행에만 적용 | `hooks/register.tsx:333`, `hooks/register.tsx:334`, `hooks/register.tsx:335`, `hooks/register.tsx:345` |
| `ui.render` 호출별 `rows`, `index`, `block`, `markdown`, `nextIndex`, `drawn`, `content` | 안전 · 현재 호출의 최종 자식과 블록 순서만 누적; 다른 `ui.render` 호출과 공유하지 않음 | `hooks/register.tsx:347`, `hooks/register.tsx:350`, `hooks/register.tsx:351`, `hooks/register.tsx:354`, `hooks/register.tsx:355`, `hooks/register.tsx:363`, `hooks/register.tsx:384` |
| 모듈 `entries` | 안전 · 수식·스타일·색·display 여부로 만든 cache key 의 그림/실패 조회 캐시; 엔진 요소나 렌더 노드 식별자로 쓰지 않음 | `hooks/register.tsx:28`, `hooks/register.tsx:66`, `hooks/register.tsx:128` |
| 모듈 `queue` | 안전 · 미완료 수식 렌더 작업 공유; `drain` 이 가져가고 `ui.invalidate` 뒤 호출들이 cache 를 읽음 | `hooks/register.tsx:29`, `hooks/register.tsx:149`, `hooks/register.tsx:172` |
| 모듈 `inflight` | 안전 · 실행 중 작업 키를 호출 간 공유해 중복 enqueue 를 막고 `finally` 에서 제거; 트리 키와 분리됨 | `hooks/register.tsx:31`, `hooks/register.tsx:130`, `hooks/register.tsx:153`, `hooks/register.tsx:169` |
| 모듈 `isRendering` | 안전 · `drain` 의 동시 실행 guard; 완료·실패 모두 `finally` 에서 false 로 돌림 | `hooks/register.tsx:32`, `hooks/register.tsx:149`, `hooks/register.tsx:170` |
| 모듈 `style` | 공유 설정 · register 옵션과 font 측정값이 정하고 cache key·그림 렌더링에 사용; 요소 인스턴스 키는 아님 | `hooks/register.tsx:40`, `hooks/register.tsx:66`, `hooks/register.tsx:207` |
| 모듈 `config` | 공유 세션 설정 · `session.start` 가 다시 채우며 mode·cache 경로·색 등을 제공; 요소 인스턴스 키는 아님 | `hooks/register.tsx:50`, `hooks/register.tsx:204`, `hooks/register.tsx:66` |
| 모듈 `fontReport` | 공유 진단 문자열 · `/latex-inline` 명령 설명에만 쓰며 렌더 트리나 Image identity 에 관여하지 않음 | `hooks/register.tsx:52`, `hooks/register.tsx:244` |
| 모듈 `converted` | 안전 · Unicode 변환 결과를 width·전체 텍스트로 캐시하고 200개로 제한; 렌더 요소 키나 위임 props 상태를 저장하지 않음 | `hooks/register.tsx:177`, `hooks/register.tsx:179`, `hooks/register.tsx:184` |
| 모듈 `VERSION`, `ROW_PX`, `MATH_INSTRUCTION` | 안전 · 불변 상수; cache 버전, 그림 행 픽셀, 프롬프트 문구이며 호출별 렌더 상태가 아님 | `hooks/register.tsx:8`, `hooks/register.tsx:11`, `hooks/register.tsx:14` |
| `tests/support.test.ts` 의 분할 테스트 2개 | 삭제 · 삭제 대상 외 지원 함수 테스트 유지 | `git diff -- tests/support.test.ts` |
| manifest 버전 단일 선언 | 항목 2 | `.claude-plugin/plugin.json:4` |
| README Hooks 설명과 10,000자 fallback 항목 | 항목 3 | `README.md:115`, `README.md:123` |

## 라운드 로그

### R1

#### 리뷰 2 — cold · 37376ae..fe8931b

- 차단: (1) mermaid 바깥 + 다이어그램 앞뒤 수식 → `Image "m1" is drawn twice` 로 트리 거부 (2) mermaid 바깥에서 안쪽 latex의 첫 위임 구간이 0열·빈 줄 둘 (3) ctrl+o 화면에서 수식 블록 다음 위임 구간의 빈 줄이 사라짐
- 수정: 항목 4·5
- 실측: 검증자 실제 세션·하니스 재현, 드라이버는 `hooks/register.tsx:284`·`:290`·`:367` 코드 확인
- 판정: 이 구현에 합의하는가: no

#### 리뷰 1 — 증분 · a1c959a

- 차단: 없음
- 수정: 없음
- 실측: 드라이버 게이트 재실행 28 pass · 실제 세션 두 방향
- 판정: "항목 1의 (a)(b) 막힘 확인. 수식 없는 구간은 모두 next로 가고, next 없이 답하는 경로는 수식 블록만 있는 답변뿐이다(의도). 새 표면의 우회 없음." → 항목 1 `cleared`.

### R0

#### 설계 리뷰 — R0 판정 반영 · 승격 전 · 원문 사용자 메시지 (2026-10-04)

- 반박: R0-1 위임 구간 분할(높음), R0-2 README 비목표(중간), R0-3 하니스 순서 가정(중간), R0-4 원장 D1(낮음)
- 처리: R0-1 반영(불변 원칙 정정·항목 1 확정 결함 a·b), R0-2 반영(항목 3 추가), R0-3 반영(acceptance 정정·열린 질문), R0-4 반영(D1∼D3)
- 실측: `splitMarkdown` · `MARKDOWN_LIMIT` 현재 참조는 `hooks/register.tsx` · `hooks/parse.ts` · `tests/support.test.ts`; 기준·작업 의존성 동기화 완료; cmux pane:53 (surface:86). Clone 확인 `git rev-parse --show-toplevel` → `/Users/choongjaelee/mods/latex-inline-delegate-work`; `git branch --show-current` → `fix/delegate-markdown-runs`; `git log --oneline -2` → `37376ae`, `8ef379e`; `claude --version` → `2.1.289 (Claude Code)`. 이번 수정에서 테스트·font-metrics·manifest 게이트는 실행하지 않음.
- 판정: "반박 4건 반영 조건으로 이 계획으로 시작하는 데 합의한다."

## 열린 질문
