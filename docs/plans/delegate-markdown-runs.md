# delegate-markdown-runs

- 절차 정본: `drive-agent-loop` 스킬과 이 계획 파일 · 현재 배정: R4 펜스·배치 정리
- 대상: `/Users/choongjaelee/mods/latex-inline-delegate-work`
- 시작 커밋: `37376ae`
- 기준 트리: `/Users/choongjaelee/mods/latex-inline-fix_delegate-markdown-runs` (`fix/delegate-markdown-runs`) · 작업 트리: `/Users/choongjaelee/mods/latex-inline-delegate-work` (`fix/delegate-markdown-runs`)
- 현재: R4 · 마지막 승격 f35fac4 · 리뷰 중 없음 · 게이트 그린
- 최근 검증자 판정: no · cold · 사용자 메시지

## 배경 — 확인한 원천

- [Claude Code mod events](https://code.claude.com/docs/en/plugins/mods/events.md) — 같은 이벤트의 훅은 미들웨어 체인이며, `next` 없이 답하면 아래 훅이 실행되지 않는다. 직접 설치한 mod의 의존성 순서는 문서에 있지만 로컬 로드와 설치본 사이의 순서는 정해져 있지 않다는 점은 배정의 확인 사실이다.
- [Claude Code mod interface](https://code.claude.com/docs/en/plugins/mods/interface.md) — `await next(e)` 의 엔진 결과를 자기 `Box` 트리의 자식으로 넣으면 엔진 그림을 유지할 수 있다.
- [mermaid-inline `hooks/register.tsx`](https://github.com/dazebug/mermaid-inline/blob/9712b468e22d1b3993d734d455de15efd21c9a1c/hooks/register.tsx) — Markdown 구간마다 `next` 를 호출하고, 반환된 엔진 요소를 트리에 넣으며, 이후 엔진 블록의 gutter 와 간격을 보완하는 사례다.

## 목표

그림 모드의 terminal `AssistantMessage` 에서 수식이 든 문단·목록·단독 display 수식과 산문 Markdown 은 latex-inline 이 그린다. 산문은 `unicodeMath` 변환 뒤 10,000자 이하 조각으로 그리며, 나눌 수 없는 조각이 있으면 답변 전체를 Unicode 로 바꿔 한 번 `next` 에 넘긴다. 0열에서 시작하는 펜스 코드 블록만 `next` 에 넘기고 반환된 엔진·하위 mod 요소를 최종 트리에 포함한다. 들여쓴 펜스는 내부 빈 줄까지 산문에 그대로 둔다. Latex Inline 이 바깥인 경로는 하니스로 고정하고, Mermaid Inline 이 바깥인 경로는 드라이버의 실제 세션 대조로 확인한다. 글자 모드·꺼짐 모드·다른 surface·렌더 중이거나 실패한 수식·블록 간 bullet, gutter, 빈 줄은 기존 계약을 유지한다.

## 완료의 정의

- 반드시 재현해 막아야 끝인 실패: 그림 모드 답변에서 산문 구간을 `next` 로 넘겨 엔진이 답변 첫머리 사용량 알림 판정으로 오표시하는 경로를 막고, 0열 Mermaid 펜스만 하위 훅에 도달하게 하며, latex-inline 바깥 + Mermaid Inline 안쪽에서 안내 산문이 다이어그램보다 왼쪽에 놓이는 문제를 막는다.
- acceptance oracle: `tests/render.test.ts` 의 `claude-code/testing` 하니스에서 latex-inline 이 바깥인 방향을 고정한다. 사용량 알림 문구를 포함한 산문은 다음 훅 호출 없이 latex-inline 의 `Markdown` 요소에 남고, 안내 산문과 0열 시작 Mermaid 펜스가 함께 있으면 바닥 `on('ui.render')` 관찰자가 펜스 텍스트만 받는지 확인한다. 들여쓴 펜스는 목록 산문 Markdown 안에 남고 바닥 훅에 가지 않아야 한다. 코드 위임 props 의 `isFirstOfReply`·`onScreen` 과 반환된 트리가 유지되어야 한다. Mermaid Inline 이 바깥인 방향은 드라이버의 실제 세션 대조로 확인한다. 수정 전 새 회귀 테스트가 실패하고 수정 뒤 통과해야 한다. 구현자 게이트는 `claude plugin test`, `node --test tests/font-metrics.test.mjs`; strict 검증은 드라이버가 실행한다.
- 코퍼스 범위: N/A — 사용자 데이터 코퍼스가 아닌 고정 렌더 fixture 를 쓴다.
- 원자성·부분 실패·롤백 경계: N/A — 변경은 렌더 체인 조합과 manifest 버전뿐이고 새 외부 쓰기나 되돌릴 수 없는 동작을 추가하지 않는다. 기존 그림 캐시와 렌더 대기열 동작은 변경 대상이 아니다.

## 상정 행위자 — 누가 이 실패를 일으킬 수 있는가

- AssistantMessage 작성자 (모델 또는 사용자): 같은 답변에 latex-inline 이 인식하는 수식 블록과 아래 mod 가 처리하는 Markdown 블록을 함께 둔다. latex-inline 의 바깥 `ui.render` 가 그 답변을 직접 끝내면 체인 안쪽 mod 가 그 블록에 닿지 못한다.

## 비목표 — 건드리지 않는다

- 수식 문법과 `hooks/unicode.ts` 의 변환 규칙은 바꾸지 않는다. `hooks/parse.ts` 의 펜스 추적·블록 분류·Markdown run 분리와 `hooks/register.tsx` 의 렌더 배치는 범위에 포함한다; `hooks/unicode.ts` 의 펜스 추적은 대조만 하고 수정하지 않는다.
- 수식 렌더러, 글꼴 측정, 그림 캐시, 색상, 프롬프트 지침 및 `/latex-inline` 명령: 이번 체인 결함과 무관하다.
- mermaid-inline 의 구현·manifest 의존성 또는 mod 로드 순서: 순서를 바꾸지 않고 어느 쪽이 바깥이어도 다음 훅을 호출하게 한다.
- 다른 surface 와 비 terminal 렌더 동작, 글자·꺼짐 모드의 표시 규칙은 건드리지 않는다.

## 불변 원칙

- 그림 모드에서 수식이 없는 답변은 전체 원문을 기존 fallback 으로 `next` 에 넘긴다. 수식 블록이 있는 답변에서 산문은 `unicodeMath` 변환 뒤 `splitMarkdown` 으로 10,000자 이하 조각을 만들어 `Markdown` 요소로 직접 그리고, 0열에서 시작하는 펜스 코드 블록만 `next({ ...e, props: { ...e.props, text, isFirstOfReply } })` 로 넘긴다. 들여쓴 펜스는 산문 run 안에 원문 그대로 두고 내부 빈 줄도 보존한다. 산문 묶음에 10,000자를 넘어 나눌 수 없는 블록이 하나라도 있으면 0.3.1처럼 답변 전체를 `unicodeMath` 로 바꿔 `asUnicode` 경로로 한 번 넘긴다.
- `text` 모드는 `unicodeMath` 로 전체 답변을 변환한 뒤 `next` 에 넘기고, `off` 모드와 terminal 이 아닌 surface 는 원문 입력으로 `next` 에 넘긴다. 변환은 downstream 이 처리할 수 있는 fenced code 와 code span 을 바꾸지 않는다.
- 그림 모드에서 table·heading·block quote 같은 산문은 `unicodeMath` 를 적용한 뒤 직접 `Markdown` 요소로 그린다. 위임하는 코드 구간은 0열에서 시작하는 펜스 전체라 텍스트 첫 글자는 여는 fence marker 이고 fenced/code span 안의 LaTeX 는 기존 변환기대로 보존한다.
- Markdown 은 빈 줄 경계에서 산문과 0열 시작 코드 run 으로 나눈다. 들여쓴 fence 는 산문 안에 그대로 두고 그 안의 빈 줄도 보존하며, 0열 펜스 안은 자르지 않고 연속한 같은 종류의 run 은 합친다.
- 직접 그리는 문단·목록·단독 display 수식은 그림이 아직 없거나 렌더 실패여도 원문 수식을 흐리게 표시하고 계속 그린다. 이 상태가 Markdown 구간의 위임을 막거나 답변 전체를 조기에 반환해서는 안 된다.
- `isTop` 과 `isFirst` 를 따로 추적한다. 처음 출력하는 블록이 위임 구간일 때만 원래 `isFirstOfReply` 를 그 `next` 호출에 전달하고, 앞서 직접 그린 블록이 있거나 출력 블록이 이어지면 다음 호출에는 `false` 를 전달한다. 직접 그린 행에는 2열 gutter 를 두고, 첫 답변 블록이며 `isFirstOfReply` 가 true일 때만 현재 bullet 정렬을 적용한다. 첫 시각 블록이 `{ type: 'engine' }` 이고 `isFirstOfReply` 가 false면 빈 2열 gutter 로 감싼다; `isFirstOfReply` 가 true인 답변 첫 engine 결과나 다른 첫 시각 결과는 받은 그대로 배치한다. 뒤따르는 `{ type: 'engine' }` 결과는 빈 2열 gutter 로 감싸되 엔진이 이미 주는 위쪽 빈 줄에 margin 을 더하지 않는다. 뒤따르는 하위 mod 결과에는 한 줄 여백만 더하고 트리와 자체 gutter 를 그대로 보존한다. 직접 그린 후속 블록도 한 줄 간격과 빈 gutter 를 갖는다.
- 각 위임은 입력 envelope 전체를 spread 해 `surface`, `component`, `requestId`, `viewport` 를 유지하고 props 도 spread 해 읽기 전용 `onScreen` 을 바꾸거나 제거하지 않는다. Claude Code 타입의 근거는 clone 에 없어서 읽기 전용 fallback `/Users/choongjaelee/mods/latex-inline/.claude-plugin/types/claude-code/index.d.ts` 의 `RenderInputOf`, `RenderPropsOf.AssistantMessage`, `Next`, `{ type: 'engine' }`, `claude-code/testing` 선언이다.
- latex-inline 바깥 방향은 하니스에서 고정하고 바닥 `on('ui.render')` 관찰자로 delegated text 를 검증한다. Mermaid Inline 이 바깥인 방향은 실제 세션 대조로 확인한다. 같은 답변 산문이 엔진 첫머리 특수 문구 판정을 받지 않는지와 산문이 direct `Markdown` 에 남는지도 하니스로 고정한다.
- `tests/render.test.ts` 에 회귀 테스트를 먼저 추가해 현재 단절을 red 로 확인한 뒤 구현한다. 테스트는 `claude-code/testing` 의 `test`, `TestOptions`, `$.ui.mount`, `Mounted.drawn/find/findAll`, `FoundElement` 를 사용한다. Mermaid 바깥 방향을 `TestOptions.plugins` 로 고정할 수 있다고 타입 선언만으로 단정하지 않는다.

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
| 6 | 산문은 직접 그리고 0열에서 시작하는 펜스 코드 블록만 `next` 로 넘김 | 위임 범위 | (a) 산문 구간이 엔진의 메시지 첫머리 판정을 받음 (b) latex 바깥 + mermaid 안쪽에서 다이어그램 앞 안내문이 0열·빈 줄 둘 (c) 들여쓴 펜스가 목록 산문에서 분리되어 훅에 위임됨 | `hooks/register.tsx`, `hooks/parse.ts`, `tests/render.test.ts`, `tests/support.test.ts`, `README.md` | 1·4·5 | verified | red: `claude plugin test` → 25 pass, 5 fail (표·bullet·사용량 문구·Mermaid 안내 산문·분할 함수 import); toggle: `git diff -- hooks/register.tsx hooks/parse.ts > .git/toggle-item6.patch` · `git apply -R .git/toggle-item6.patch` 뒤 `claude plugin test` → 같은 25 pass, 5 fail · 복원 `git apply .git/toggle-item6.patch`; green: `claude plugin test` → 34 pass, 0 fail (`Ran 34 tests across 4 files`) · `node --test tests/font-metrics.test.mjs` → 4 pass, 0 fail<br>재실행(드라이버): `claude plugin test` → 34 pass, 0 fail · strict 검증 통과 · 실제 세션 latex 바깥: 사용량 문구 문단이 일반 문단, 다이어그램 안내문 직접 그림, 다이어그램 그림<br>들여쓴 펜스 테스트: red `claude plugin test` → 34 pass, 1 fail (`picture mode keeps an indented code fence inside its list prose`: 바닥이 bash fence 텍스트를 두 번 받음) · green `claude plugin test` → 35 pass, 0 fail (`Ran 35 tests across 4 files`) | |
| 7 | 중첩 펜스가 조각남 → 공유 펜스 판정을 CommonMark 규칙으로 | 펜스 판정 | — | `hooks/parse.ts`, `tests/render.test.ts`, `tests/parse.test.ts`, `README.md` | 6 | claimed | red: `claude plugin test` → 35 pass, 3 fail (backtick info string incorrectly opened a fence; nested backtick and tilde fences each split into two delegated runs); toggle: `git diff -- hooks/parse.ts > .git/toggle-item7.patch` · `git apply -R .git/toggle-item7.patch` 후 `claude plugin test` → 35 pass, 3 fail (같은 세 테스트 실패) · 복원 `git apply .git/toggle-item7.patch`; green: `claude plugin test` → 38 pass, 0 fail (`Ran 38 tests across 4 files`) · `node --test tests/font-metrics.test.mjs` → 4 pass, 0 fail | |
| 8 | 들여쓴 펜스도 블록 분류에서 추적하고 0열 펜스만 위임하며, 인접 펜스 분리·전체 폭 배치·판별 타입을 고침 | 펜스·배치 정리 | (a) 0∼3칸 opener 제한이 `rawBlocks`·`classify` 에도 걸려 들여쓴 code 가 목록 글자로 납작해지거나 `$SRC/$` 가 가짜 수식이 됨 (b) 닫는 펜스 뒤 탭에서 닫히지 않음 (c) 인접 python·mermaid 펜스가 한 위임 구간으로 합쳐져 mermaid 가 python 을 첫 구간으로 돌려줌 (d) 직접 출력 칸에 `flexGrow` 가 없어 display 수식의 가운데 정렬이 깨지고, non-engine 결과 포장 Box 가 row 방향이라 전체 폭을 채우지 않음 (e) `'prose' | 'code'` 가 한 판별자 멤버로 묶여 `RenderBlock.items` 에서 TS2339 | `hooks/parse.ts`, `hooks/register.tsx`, `tests/render.test.ts`, `tests/parse.test.ts` | 6·7 | claimed | red: `claude plugin test` → 38 pass, 6 fail (새로 추가한 여섯 테스트 전부); toggle: `git apply -R .git/toggle-item8.patch` → 38 pass, 6 fail (펜스·배치 수정만 되돌리고 타입 수정은 유지); 복원 `git apply .git/toggle-item8.patch`; green: `claude plugin test` → 44 pass, 0 fail (`Ran 44 tests across 4 files`) · `node --test tests/font-metrics.test.mjs` → 4 pass, 0 fail · `bunx -p typescript@5 tsc --noEmit -p .claude-plugin/types/tsconfig.json` → exit 0 | |

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
| D8 | 드라이버 | 위임 범위 | 산문은 직접 그리고 펜스 코드 블록만 넘긴다 — 엔진이 넘겨받은 텍스트 첫머리를 사용량 알림·특수 문구로 판정하므로 산문을 넘기면 오표시된다, 다른 mod가 그리려는 것은 코드 블록이다 | cold 리뷰 3, 바이너리 `X0r` | 산문을 그리는 다른 mod가 생기면 그 산문은 받지 못한다 |
| D9 | 드라이버 | cold 3의 비차단 둘 | 기록 — (A) latex 아래에 키 있는 요소를 그리는 mod가 있으면 `next` 를 여러 번 부를 때 키가 겹친다, 수식으로 시작하는 답변 위 빈 줄 없음은 0.3.1부터의 동작 | cold 리뷰 3 | 없음 |
| D10 | 드라이버 | 나눌 수 없는 10,000자 초과 산문 | 답변 전체를 유니코드로 한 번 넘긴다(0.3.1 동작) — 산문 묶음만 넘기면 엔진의 첫머리 판정을 다시 받는다 | 구현자 충돌 보고 | 없음 |
| D11 | 드라이버 | cold 4의 비차단 (2) latex 바깥 + mermaid 안쪽에서 아직 안 그려졌거나 못 그리는 다이어그램이 gutter 없이 0열에서 시작하고 빈 줄 둘이 생김 | mermaid-inline 의 첫 구간 배치 문제라 후속 (`dazebug/mermaid-inline#1`) | cold 리뷰 4 | 없음 |

## 전수 소탕 표

| 대상 | 판정 | 코드로 알 수 없는 이유 또는 `파일:행` |
|:--|:--|:--|
| `hooks/register.tsx` · `session.start` `next(e)` | 안전 · 입력은 세션 이벤트라 assistant text 가 없고 텍스트 첫 글자 판정 대상이 아님 | `hooks/register.tsx:236` |
| `hooks/register.tsx` · `command.run` (`latex-inline`) | 정당한 직접 응답 · 이 mod 가 등록한 자체 명령이며 `next` 를 부르지 않음 | `hooks/register.tsx:239`, `hooks/register.tsx:240` |
| `hooks/register.tsx` · `prompt.compose` `next(e)` | 안전 · 입력은 prompt compose 이벤트라 assistant reply text 가 없음; 반환한 sections 에 안내만 추가 | `hooks/register.tsx:255`, `hooks/register.tsx:256` |
| `ui.render` early `next(e)` | 안전 · 비 terminal 또는 off 일 때 전체 원문 답변을 그대로 넘김; 첫 글자는 원래 전체 답변 첫 글자라 엔진의 본래 판정과 같음 | `hooks/register.tsx:261`, `hooks/register.tsx:262` |
| `ui.render` `asUnicode` 의 `next(e)` 분기 | 안전 · 변환 결과가 같으면 전체 원문 답변을 그대로 넘김; full-reply 첫 글자와 문맥이 보존됨 | `hooks/register.tsx:266`, `hooks/register.tsx:267`, `hooks/register.tsx:268` |
| `ui.render` `asUnicode` 의 변환 분기 | 안전 · `unicodeReply` 를 적용한 답변 전체를 한 번 넘김; text 모드·수식 없는 답변·나눌 수 없는 긴 산문 fallback 이며 첫머리 판정은 0.3.1 의 전체 답변 동작과 같음 | `hooks/register.tsx:266`, `hooks/register.tsx:267`, `hooks/register.tsx:268`, `hooks/register.tsx:270`, `hooks/register.tsx:272`, `hooks/register.tsx:285`, `hooks/register.tsx:286` |
| `ui.render` fenced code `next(...)` | 안전 · 0열에서 시작하는 코드 run 전체를 넘겨 첫 글자는 여는 fence marker; spread 로 `onScreen` 과 입력 envelope 를 보존하고 호출 뒤에는 `isFirst` 를 false 로 설정 | `hooks/register.tsx:280`, `hooks/register.tsx:281`, `hooks/register.tsx:282`, `hooks/register.tsx:397`, `hooks/register.tsx:400`, `hooks/register.tsx:415`; `tests/render.test.ts:88` |
| `ui.render` 전체 경로 요약 | 안전 · 그림 모드의 수식 답변에서 산문은 변환 후 직접 `Markdown` 으로 그리므로 산문 텍스트가 `next` 로 가지 않음; 오직 fenced code run 만 위임 | `hooks/register.tsx:274`, `hooks/register.tsx:280`, `hooks/register.tsx:285`, `hooks/register.tsx:419`, `hooks/register.tsx:420` |
| `ui.render` 에서 위임하는 code props | 안전 · envelope·props spread 로 읽기 전용 `onScreen` 보존; `isFirstOfReply` 가 false 인 engine 결과는 첫 코드 구간이어도 빈 gutter 에 넣고, 하위 mod 요소 트리는 유지 | `hooks/register.tsx:400`, `hooks/register.tsx:401`, `tests/render.test.ts:88`, `tests/render.test.ts:123` |
| 렌더 중·실패 수식 | 안전 · 그림이 없으면 원문을 흐리게 그린 뒤 다음 블록 처리를 계속 | `hooks/register.tsx:288` |
| 펜스의 블록 추적·Markdown run 분리 | 안전 · `rawBlocks`·`classify`·`splitMarkdownRuns`·`splitMarkdown` 이 공유 여는·닫는 판정을 사용; 분류는 들여쓰기와 무관하게 펜스를 추적하고, 위임은 0열 펜스 하나씩만 하며, 산문 run 만 합침 | `hooks/parse.ts:20`, `hooks/parse.ts:30`, `hooks/parse.ts:143`, `hooks/parse.ts:171`, `hooks/parse.ts:224`, `hooks/parse.ts:275`; `tests/render.test.ts:196`, `tests/render.test.ts:206`, `tests/render.test.ts:215`, `tests/render.test.ts:226` |
| `hooks/unicode.ts` 펜스 추적 | 변경하지 않음 · opener 는 공백 들여쓰기와 3개 이상 marker 를 받아 이번 판정과 그 두 면에서 같음; backtick 정보 문자열 검증은 없고 closer 는 `trim().startsWith(fence)` 라 공유 closer 보다 넓게 닫히지만, Unicode 변환기는 이번 부류의 수정 범위 밖 | `hooks/unicode.ts:467`, `hooks/unicode.ts:590`, `hooks/unicode.ts:598`, `hooks/unicode.ts:601` |
| 렌더된 행과 아래 hook 결과의 폭 | 안전 · 직접 출력 칸은 column·`gap=1`·`flexGrow=1`; 뒤따르는 non-engine 결과는 `column`·`marginTop=1` 로 감싸고, 엔진 결과는 빈 gutter 와 늘어나는 column 안에 둠 | `hooks/register.tsx:382`, `hooks/register.tsx:389`, `hooks/register.tsx:402`, `hooks/register.tsx:413`; `tests/render.test.ts:237`, `tests/render.test.ts:248` |
| text·off·비 terminal fallback | 안전 · 기존 표시 규칙과 `next` 경로 유지 | `hooks/register.tsx:259`, `hooks/register.tsx:266`, `hooks/support.ts:26`; `tests/render.test.ts:22`, `tests/render.test.ts:36` |
| `MARKDOWN_LIMIT` · `splitMarkdown` | 유지 · Unicode 변환된 산문을 10,000자 이하 `Markdown` 요소로 나눔; 분할 불가 단일 블록은 전체 답변 `asUnicode` fallback 을 선택 | `hooks/register.tsx:13`, `hooks/register.tsx:285`, `hooks/register.tsx:286`, `hooks/parse.ts:257`, `tests/support.test.ts:6`, `tests/support.test.ts:12` |
| `tests/render.test.ts` 의 아래쪽 엔진 hook | 테스트 보조 · 위임 props 를 기록하고 `Text` 결과 또는 지정한 `{ type: 'engine', ref: 1 }` 을 돌려 트리 계약을 확인 | `tests/render.test.ts:9`, `tests/render.test.ts:22`, `tests/render.test.ts:24`, `tests/render.test.ts:123` |
| `tests/render.test.ts` 의 prepend inline fixture | 통합 계약 고정 · Mermaid 펜스 앞뒤의 수식 구간을 latex-inline 에 넘기고 양쪽 그림이 하나의 트리에 남는지 확인 | `tests/render.test.ts:73`, `tests/render.test.ts:111` |
| `ui.render` 의 `Image.key` · `imageCount` | 안전 · `Image.key` 와 카운터 모두 없음; `$.ui.blit` 을 쓰지 않으므로 여러 호출 결과를 합친 트리에서도 그림 key 충돌이 없음 | `hooks/register.tsx:306`, `hooks/register.tsx:310`, `tests/render.test.ts:111` |
| `ui.render` 의 `pictures` · `jobs` | 안전 · 각 `ui.render` 호출 안에서 새 Map 과 작업 배열을 만들고 그 입력의 수식 결과만 보관; 외부 호출 간 공유하지 않음 | `hooks/register.tsx:291`, `hooks/register.tsx:292`, `hooks/register.tsx:293`, `hooks/register.tsx:298` |
| `ui.render` 의 `isFirst` · `isTop` | 안전 · 각 호출의 `isFirstOfReply` 와 `true` 에서 시작; 직접 출력·코드 위임 뒤 각 호출 안에서 갱신하고 다른 호출과 공유하지 않음 | `hooks/register.tsx:371`, `hooks/register.tsx:372`, `hooks/register.tsx:379`, `hooks/register.tsx:380`, `hooks/register.tsx:415` |
| `ui.render` 호출별 `width`, `asUnicode`, `blocks`, `renderBlocks` | 안전 · viewport·입력 답변으로 호출마다 계산; 다른 호출 사이에 값을 보관하지 않음 | `hooks/register.tsx:263`, `hooks/register.tsx:266`, `hooks/register.tsx:271`, `hooks/register.tsx:274`, `hooks/register.tsx:275` |
| `ui.render` 호출별 `picture`, `word`, `flow`, `boxOf`, `groupBoxes` | 안전 · 해당 호출의 `pictures` 와 텍스트 설정만 참조하는 로컬 함수; 반환 Image 는 key 없이 트리에 포함 | `hooks/register.tsx:306`, `hooks/register.tsx:319`, `hooks/register.tsx:329`, `hooks/register.tsx:343`, `hooks/register.tsx:348` |
| `ui.render` 호출별 `lineWidth`, `first`, `firstRows`, `bullet` | 안전 · 파싱된 그 호출의 첫 블록에 맞춰 계산; bullet 은 첫 답변 행에만 적용 | `hooks/register.tsx:353`, `hooks/register.tsx:354`, `hooks/register.tsx:355`, `hooks/register.tsx:365` |
| `ui.render` 호출별 `rows`, `direct`, `directIsFirst`, `directIsTop`, `block`, `drawn`, `content` | 안전 · 현재 호출의 최종 자식·직접 출력 묶음과 블록 순서만 누적; 다른 `ui.render` 호출과 공유하지 않음 | `hooks/register.tsx:367`, `hooks/register.tsx:368`, `hooks/register.tsx:369`, `hooks/register.tsx:370`, `hooks/register.tsx:397`, `hooks/register.tsx:400`, `hooks/register.tsx:424`, `hooks/register.tsx:447` |
| 모듈 `entries` | 안전 · 수식·스타일·색·display 여부로 만든 cache key 의 그림/실패 조회 캐시; 엔진 요소나 렌더 노드 식별자로 쓰지 않음 | `hooks/register.tsx:31`, `hooks/register.tsx:70`, `hooks/register.tsx:132`, `hooks/register.tsx:164` |
| 모듈 `queue` | 안전 · 미완료 수식 렌더 작업 공유; `drain` 이 가져가고 `ui.invalidate` 뒤 호출들이 cache 를 읽음 | `hooks/register.tsx:32`, `hooks/register.tsx:144`, `hooks/register.tsx:151`, `hooks/register.tsx:175` |
| 모듈 `inflight` | 안전 · 실행 중 작업 키를 호출 간 공유해 중복 enqueue 를 막고 `finally` 에서 제거; 트리 키와 분리됨 | `hooks/register.tsx:34`, `hooks/register.tsx:133`, `hooks/register.tsx:156`, `hooks/register.tsx:172` |
| 모듈 `isRendering` | 안전 · `drain` 의 동시 실행 guard; 완료·실패 모두 `finally` 에서 false 로 돌림 | `hooks/register.tsx:35`, `hooks/register.tsx:152`, `hooks/register.tsx:153`, `hooks/register.tsx:173` |
| 모듈 `style` | 공유 설정 · register 옵션과 font 측정값이 정하고 cache key·그림 렌더링에 사용; 요소 인스턴스 키는 아님 | `hooks/register.tsx:43`, `hooks/register.tsx:70`, `hooks/register.tsx:195` |
| 모듈 `config` | 공유 세션 설정 · `session.start` 가 다시 채우며 mode·cache 경로·색 등을 제공; 요소 인스턴스 키는 아님 | `hooks/register.tsx:53`, `hooks/register.tsx:213`, `hooks/register.tsx:70` |
| 모듈 `fontReport` | 공유 진단 문자열 · `/latex-inline` 명령 설명에만 쓰며 렌더 트리나 Image identity 에 관여하지 않음 | `hooks/register.tsx:55`, `hooks/register.tsx:220`, `hooks/register.tsx:247` |
| 모듈 `converted` | 안전 · Unicode 변환 결과를 width·전체 텍스트로 캐시하고 200개로 제한; 렌더 요소 키나 위임 props 상태를 저장하지 않음 | `hooks/register.tsx:180`, `hooks/register.tsx:184`, `hooks/register.tsx:185`, `hooks/register.tsx:190` |
| 모듈 `VERSION`, `ROW_PX`, `MATH_INSTRUCTION` | 안전 · 불변 상수; cache 버전, 그림 행 픽셀, 프롬프트 문구이며 호출별 렌더 상태가 아님 | `hooks/register.tsx:8`, `hooks/register.tsx:11`, `hooks/register.tsx:16` |
| `tests/support.test.ts` 의 분할 테스트 2개 | 복원 · Markdown 제한 경계에서 분할하고 단일 초과 블록은 분할 불가를 확인 | `tests/support.test.ts:6`, `tests/support.test.ts:12` |
| manifest 버전 단일 선언 | 항목 2 | `.claude-plugin/plugin.json:4` |
| README Hooks 설명과 10,000자 fallback 항목 | 산문 직접 그림·전체 Unicode fallback 설명으로 갱신 | `README.md:117`, `README.md:124` |

## 라운드 로그

### R4

#### 리뷰 5 — cold · 37376ae..f35fac4

- 차단: (a) 4칸 이상 들여쓴 펜스를 블록 분류가 펜스로 못 봐 코드가 목록 글자·가짜 수식으로 그려짐(f35fac4 회귀)
- 수정: 항목 8 (a)∼(e)
- 실측: 검증자 하니스 탐침·Yoga 모의·tsc, 드라이버 코드 확인
- 판정: 이 구현에 합의하는가: no

### R3

#### 리뷰 4 — cold · 37376ae..da5cc32

- 차단: (1) 백틱 4개 펜스 안의 3개 펜스 줄에서 바깥 펜스가 닫혀 구간이 조각남 — 재현 위 입력
- 수정: 항목 7, README 서술(넘기는 범위·10,000자 예외 문구) 정정
- 실측: 드라이버 `hooks/parse.ts` 의 `FENCE`·`closesFence` 코드 확인
- 판정: 이 구현에 합의하는가: no

### R2

#### 리뷰 3 — cold · 37376ae..0e7db0a

- 차단: (1) 위임된 산문 구간이 엔진의 사용량 알림 판정(`startsWith`)을 받아 빨간 경고로 그려짐 — 재현 `The square is $x^2$.` / `You're close to the answer, but **check** the sign.` / `Done.`
- 수정: 항목 6
- 실측: 드라이버가 2.1.289 바이너리에서 `X0r` 가 다듬지 않은 `text` 에 `startsWith` 를 쓰는 것 확인
- 판정: 이 구현에 합의하는가: no

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
