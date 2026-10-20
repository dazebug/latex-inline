# adjacent-displays

- 절차 정본: drive-agent-loop 스킬 — 컴팩션·세션 교체 뒤에는 스킬을 다시 로드하고 이 파일을 다시 읽는다 (규칙의 정본은 요약이 아니다)
- 대상: `dazebug/latex-inline` (`hooks/`)
- 시작 커밋: `7b87c6f`
- 기준 트리: `/Users/choongjaelee/Codes/latex-inline/.claude/worktrees/adjacent-displays-review` (`worktree-adjacent-displays-review`) · 작업 트리: `/Users/choongjaelee/Codes/latex-inline-adjacent-displays-work` (`adjacent-displays-work`)
- 현재: R1 · 마지막 승격 3e16d92 · 리뷰 중 없음 · 게이트 그린(120 · 15 · tsc)
- 최근 검증자 판정: 미요청 · 원문 없음

이 파일은 **실행한 계획과 실행할 계획의 기록**이다 — 결정(사용자·드라이버), 판정(검증자), 항목의 상태와 재실행 근거(명령 + 결과 줄 + 수치), 남은 큐, 크로스 리포 사실을 보존한다. 코드 수정 과정을 자연어로 풀어 쓰지 않는다: 무엇이 바뀌었는지는 커밋이, 어떻게 동작하는지는 코드가 말한다. 결정이나 질문이 특정 동작에 걸리면 한 절과 `파일:행`으로 끝낸다. 이 템플릿에 없는 소절을 만들지 않는다 — 테스트 설계는 테스트 파일이 말한다.

## 배경 — 확인한 원천

영구 원천 없음 — 재현 입력은 완료의 정의에 인라인

## 목표

- 인접한 display 경계가 각각 독립 `display` 블록으로 파싱되고 입력 순서를 보존한다.
- 그림 모드가 각 블록을 별도 수식으로 렌더하고, 인접 블록을 빈 행 없이 붙여 그린다.
- 유니코드 모드가 각 display를 독립 변환하고 각 블록의 display 정렬을 보존한다.
- 마우스 복사가 각 블록을 별도 LaTeX display로 원래 순서와 빈 행 없는 경계로 복원한다.

## 완료의 정의

- 반드시 재현해 막아야 끝인 실패: `$$\n…\n$$\n$$\n…\n$$` 입력이 하나의 display로 읽혀 가운데 구분자 `$$` `$$` 가 MathJax에 전달되고 그림에 `$$$$` 가 찍히는 것. 같은 입력을 선택해 복사하면 하나의 LaTeX display로 돌아오는 것.
- acceptance oracle: `claude plugin test` 에서 파싱 결과 두 display와 두 그림이 순서대로 확인되고, 둘째 블록은 `joined: true` 이며, 유니코드 출력은 구분자 잔여물 없이 블록마다 따로 가운데 맞춘 줄이 되고 Markdown 분리를 위한 빈 줄 하나를 둔다. 마우스 복사는 구분자 잔여물이나 추가 빈 행 없이 display 사이에 줄바꿈 하나만 둔다. 기준선 및 변경 후 검증 결과는 각 항목 근거에 재실행 가능하게 기록한다.
- 코퍼스 범위: 실코퍼스 없음 — 재현 입력 1건과 전수 소탕 표의 변형 입력만 사용한다.
- 원자성·부분 실패·롤백 경계: N/A — 파싱은 응답 단위의 순수 변환이다. 렌더링은 기존처럼 수식별 결과와 오류를 기록하며 이번 작업은 영속 상태나 외부 트랜잭션을 추가하지 않는다.

## 상정 행위자 — 누가 이 실패를 일으킬 수 있는가

이 루프가 막는 실패를 일으킬 수 있는 행위자(사람·프로세스·시스템)와 그 능력을 열거한다. **발견을 배정하려면 어느 행위자가 그 결함에 닿는지 이름을 대야 한다** — 모델 밖 행위자가 필요한 발견은 기본이 잔여(원장 기록, 배정 없음)다. 행위자를 새로 들이는 것은 범위 변경이라 사용자 승인이 필요하다. 해당 없으면(순수 로직 루프) N/A + 근거.

- Claude Code assistant 응답 생성기: 하나의 assistant 메시지에 빈 줄 없는 인접 display 블록을 출력할 수 있고, `ui.render` 가 그 원문 전체를 mod 에 전달한다.

## 비목표 — 건드리지 않는다

- 블록 수식 바로 뒤에 빈 줄 없이 오는 글: 지금처럼 단락으로 읽는다 — 구분자가 MathJax 에 가지 않고, `README.md:36` 은 블록 수식 앞뒤에 빈 줄을 두라고 한다.
- `bin/render.mjs` 와 MathJax 자체: 현재 그림의 `$$$$` 는 잘못 합쳐진 TeX 입력에서 나온다. 수식 분할 전의 렌더러를 수정하지 않는다.
- 일반 inline math, Markdown 문법, fenced code 의 표시 방식: display 경계 수정과 독립된 동작은 바꾸지 않는다.
- README 의 LaTeX 작성 권고: 이 수정은 인접 블록을 처리하는 회귀 수정이며 작성 규칙을 바꾸지 않는다.

## 불변 원칙

0라운드 이후 이 절과 「완료의 정의」에 항목을 **더하는 것은 범위 변경이다** — 결정 원장의 `사용자` 행 없이 추가하지 않는다(드라이버·검증자 발의는 비용 추정과 함께 사용자 승인 후). 재개하는 에이전트가 이 절만 읽고도 경계를 알 수 있어야 한다.

- `hooks/parse.ts` 가 판정 함수를 내보내고 `hooks/unicode.ts` 가 가져다 쓴다 (`parse.ts` 는 `unicode.ts` 를 가져오지 않아 순환이 없다). 블록 수식 단락은 그 안의 수식을 위치(같은 줄이든 다음 줄이든)와 상관없이 앞에서부터 하나씩 닫아 읽는다. 수식들 사이와 앞뒤에 공백 말고 다른 것이 있으면 블록 수식 단락이 아니고, 지금처럼 단락으로 읽는다.
- 블록 수식이 하나뿐인 단락은 지금과 같은 tex 를 낸다. `$$\text{$$}$$` → `\text{$$}` 에서 `\text{$}` 안의 단일 `$` 와 중괄호 안의 `$$`·`\]` 는 닫는 구분자가 아니고, `$$5\$$$` → `5\$` 에서 `\` 로 이스케이프된 `$` 는 닫는 구분자가 아니다.
- 각 닫는 `$$` 또는 `\]` 는 현재 블록만 닫고, 다음 `$$` 또는 `\[` 는 다음 블록을 연다.
- 첫 블록 뒤의 블록은 `joined: true` 로 두어 그림에서 출처 순서대로 쌓고 빈 행을 추가하지 않는다.
- 유니코드 변환과 복사에서도 블록 경계·순서·TeX 본문을 보존한다. 복사 결과는 인접 display 사이에 줄바꿈 하나만 둔다.
- `hooks/register.tsx` 의 기존 `draw`·`joined` 그룹·`firstRows` 계약과 `hooks/copy.ts` 의 순차 정렬은 소탕 실측에서 안전했다. 해당 경로의 테스트가 이를 고정하며 결함이 새로 드러나지 않는 한 코드 범위를 넓히지 않는다.
- inline 수식, 코드 span·fence 의 달러 문자, 응답 외부 Markdown 은 기존 동작을 유지한다.

## 배치 점검 (0라운드)

모드: ultrafast

(`default` 또는 `ultrafast`. 이 줄이 적힌 뒤로는 스킬 인자가 아니라 이 값이 모드를 정한다 — 스킬의 점검 블록이 이 줄을 읽는다.)

이 표의 실측 주체는 드라이버다 — 구현자가 채우는 행은 「에이전트 첫 보고」뿐이고, 자기 샌드박스의 실패로 드라이버 실측 값을 덮어쓰지 않는다.

| 점검 | 결과 |
|:--|:--|
| `git check-ignore -q .claude/worktrees/probe` → ignored | `ignored` (점검 블록) |
| 설정 `worktree.baseRef: "head"` — 첫 보고의 `git log --oneline -2`가 기준 HEAD를 보이는가 | N/A — 작업 트리는 전용 clone |
| 에이전트 첫 보고: 작업 트리 경로 · 브랜치 · HEAD | `/Users/choongjaelee/Codes/latex-inline-adjacent-displays-work` · `adjacent-displays-work` · `7b87c6f` |
| 리포 오버레이 `.claude/drive-agent-loop.md` — 기준 트리 경로 또는 드라이버 작성 여부 | 기준 트리에 드라이버가 작성(커밋하지 않음, `ignored` 확인) |
| cmux 패널 | `pane:196` (surface `surface:287`) |
| 트리마다 의존성 동기화 | 두 트리 모두 `npm ci --ignore-scripts` 와 `tsconfig.json`·`.claude-plugin/types/` 복사 |
| git 밖 로컬 자산을 가리키는 env — 이름=절대경로 | N/A |
| 증분 리뷰 소요(분) — 첫 세 번 | |

## 작업 항목

| # | 항목 | 부류 | 확정 결함 | 파일 집합 | 의존 | 상태 | 근거 | 승격 |
|:--|:--|:--|:--|:--|:--|:--|:--|:--|
| 1 | 인접 display 경계를 분리하고 렌더·복사 회귀를 고정한다 | 파서 경계 | (a) 재현 입력의 여러 줄 블록 둘 (b) 줄마다 하나 (`lines`) (c) 한 줄에 둘 (`oneLine`) (d) 사이에 글 → 단락 (`textBetween`) (e) `\[…\]` 만 (`brackets`)·`$$` 와 섞임 (`mixed`) (f) 목록 항목 안 | `hooks/parse.ts` · `tests/parse.test.ts` · `tests/render.test.ts` · `tests/copy.test.ts` | — | verified | 공유 API: `displayFormulas(text: string)` → `string[]` 또는 `null` — 비수식 글이 섞이면 `null`, display 본문 목록이면 각 TeX를 순서대로 반환한다.<br>`claude plugin test` → 120 pass, 0 fail, 6 files. 신규 5개: `adjacent display formulas split into blocks, while text between them stays a paragraph`; `adjacent display formulas under a list item stay as separate blocks`; `a display formula does not close on delimiters inside braces or escaped dollars`; `adjacent display formulas draw as two images in one group without a blank row`; `a mouse copy of adjacent display formulas uses one newline between them`.<br>`node --test tests/font-metrics.test.mjs tests/render-bounds.test.mjs tests/render-tex.test.mjs` → 15 pass, 0 fail.<br>`npx -y -p typescript@5 tsc --noEmit` → exit 0 (`Unknown env config "http-proxy"` 경고).<br>토글: `git diff -- hooks/parse.ts > .git/toggle.patch` · `git apply -R .git/toggle.patch` 뒤 `claude plugin test` → 116 pass, 4 fail, 6 files; red: `(fail) adjacent display formulas split into blocks, while text between them stays a paragraph`, `(fail) adjacent display formulas under a list item stay as separate blocks`, `(fail) adjacent display formulas draw as two images in one group without a blank row`, `(fail) a mouse copy of adjacent display formulas uses one newline between them`. `git apply .git/toggle.patch` 복원 뒤 작업 파일만 남음을 `git status --porcelain` 로 확인했다.<br>재실행(드라이버): parseBlocks 프로브 15개 입력 기대대로 | | |
| 2 | 유니코드 출력이 각 display 를 독립 변환하게 한다 | 유니코드 변환 | (a) 같은 입력들의 유니코드 출력에서 구분자가 남지 않고 블록마다 따로 가운데 맞춘 줄이 된다 — Markdown 이 한 문단의 줄을 이어 붙이므로 블록 사이에 빈 줄을 둔다(그림 모드와 달리 빈 행 하나는 허용) (b) 버전 0.5.1 | `hooks/unicode.ts` · `tests/unicode.test.ts` · `.claude-plugin/plugin.json` | 1 | todo | | |

- 항목 하나는 승격 하나에 들어갈 크기다. 같은 부류는 한 승격에 묶이고, 파일 집합이 겹치지 않는 부류만 따로 승격할 수 있다. 승격 칸에는 커밋 해시를 적는다.
- `의존`: 다른 항목의 계약(시그니처·불변식·생성물·호출 순서)을 전제하면 그 번호를 적는다. 그 항목에 정정이 오면 이 항목의 근거를 다시 낸 뒤에야 최종 리뷰에 들어간다.
- `확정 결함`: 설계 리뷰·판정에서 이 항목으로 확정된 결함이 여럿이면 처방 산문과 분리해 열거한다. 배정 전에는 `—` 를 둔다.
- 판정이 항목을 다시 열면 행을 고치지 말고 개정 항목으로 잇는다 — 식별자는 재사용하지 않는다. 선행 행의 상태는 그 승격에 대한 마지막 판정이고 부류 종결은 체인 끝 항목의 상태가 나타낸다.
- 상태 사다리: `todo` → `wip` → `claimed` → `verified` → `cleared` → `agreed`. 이탈은 `dropped`.
- `claimed` 까지가 구현 에이전트가 스스로 올리는 상한이다. 그 이후 상태 판정은 드라이버가 지정한다.
- 근거 칸에는 재실행 가능한 명령과 결과 줄, 테스트 이름과 수, 수치를 낸 스크립트 경로만 적는다.

## 결정 원장

append-only — 첫 승격 이후부터다. 결정의 이유, 기각한 반박과 근거, 잔여 불확실성을 적고 코드 서술은 넣지 않는다. 행을 적는 손은 구현자여도 행의 발행은 드라이버다 — 두 유형 모두 드라이버가 문구를 지정한 것만 적고, 구현자 발의는 「열린 질문」에 둔다. 사용자 결정은 새 `사용자` 행으로만 뒤집힌다.

| # | 유형 | 주장/위험 | 결정 | 근거 (명령·수치·경로 · SHA 또는 리뷰 번호) | 잔여 불확실성 |
|:--|:--|:--|:--|:--|:--|
| D1 | 드라이버 | 초안 비목표 `한 물리 줄의 $$A$$ $$B$$` | 기각 — 같은 결함이다 | 드라이버 실측 `parseBlocks('$$A$$ $$B$$')` → display `A$$ $$B` (7b87c6f) | — |
| D2 | 드라이버 | 블록 수식 하나뿐인 단락의 tex 가 바뀔 위험 | 불변 원칙 추가 — 중괄호 안과 이스케이프 뒤의 구분자는 닫지 않는다 | 실측 `$$\text{$$}$$` → `\text{$$}`, `$$5\$$$` → `5\$` (7b87c6f) | — |
| D3 | 드라이버 | 블록 수식 뒤에 빈 줄 없이 오는 글 | 비목표 — 구분자가 MathJax 에 가지 않는다 | 실측 `parseBlocks('$$A$$\nwhere x')` → para `"[A] where x"` (7b87c6f) | 글 사이 블록 수식 표기는 별도 개선 후보 |
| D4 | 드라이버 | 목록 항목 머리에 붙은 블록 수식 | 번호를 한 줄에 두고 수식은 블록으로 그린다 — 블록으로 시작하는 항목과 같다. 블록 수식 하나뿐인 머리는 지금처럼 번호 옆 인라인(비목표) | `tests/parse.test.ts` 의 "adjacent display formulas under a list item stay as separate blocks" | — |

## 전수 소탕 표

같은 부류가 숨어 있을 수 있는 지점 전체를 점검한다. 미검사 항목을 비워 두지 않는다. 셋째 열에는 코드로 알 수 없는 이유나 `파일:행`만 둔다. 판정이 안전이고 별도 이유가 없으면 한 행에 나열해 합친다.

| 대상 | 판정 | 코드로 알 수 없는 이유 또는 `파일:행` |
|:--|:--|:--|
| `displayTex` 대체 `displayFormulas`·`readChunk`·`DISPLAY_OPENING`: multiline·lines·oneLine·`\[…\]`·혼합 | 안전 | `hooks/parse.ts:24` · `hooks/parse.ts:234` · `hooks/parse.ts:255` · `hooks/parse.ts:347` · `tests/parse.test.ts:140` |
| `breaksParagraph`의 textBetween 단락 fallback과 `tokenize`의 `$$` inline 경로 | 안전 — A·and·B를 각각 inline token으로 유지 | `hooks/parse.ts:101` · `hooks/parse.ts:143` · `hooks/parse.ts:275` · `hooks/parse.ts:364` · `tests/parse.test.ts:153` |
| display 닫는 줄 뒤 빈 줄 없이 이어지는 `where ...` | 비목표 | `hooks/parse.ts:275` · `hooks/parse.ts:364` · `tests/parse.test.ts:163` · 구분자가 MathJax 에 가지 않고 README 는 블록 수식 앞뒤에 빈 줄을 두라고 한다 |
| `listOf` 머리 수식의 `opens` 판정과 `hasBlockMath` 재귀 | 안전 — 목록 항목의 display 두 개를 blocks로 둔다 | `hooks/parse.ts:426` · `hooks/parse.ts:433` · `hooks/parse.ts:441` · `tests/parse.test.ts:178` |
| 중괄호 안의 `$$`·`\\]` 와 이스케이프된 `$` 닫기 | 안전 — 이 불변식이 지킨다 | `hooks/parse.ts:234` · `tests/parse.test.ts:196` |
| 유니코드 변환의 인접 display | 구멍 — 항목 2 | `hooks/unicode.ts:582` · `hooks/unicode.ts:597` |
| `shownOf`의 display 순서와 마우스 복사 정렬 | 안전 — 선택 결과에 display 두 줄과 구분자 경계 유지 | `hooks/copy.ts:81` · `hooks/copy.ts:314` · `tests/copy.test.ts:153` |
| `register.tsx`의 `firstRows`·`joined` 직접 그룹 그림 배치 | 안전 — Image 두 개가 같은 그룹이며 사이 간격 없음 | `hooks/register.tsx:686` · `hooks/register.tsx:713` · `hooks/register.tsx:728` · `tests/render.test.ts:47` |
| 인접 display 문법이 들어간 block quote·table | 비목표 | `README.md:37` — 그림 대신 유니코드 텍스트로 처리하는 Markdown 구역 |
| fenced code 안의 display 구분자 | 안전 | `hooks/parse.ts:45` · `hooks/parse.ts:302` |

## 라운드 로그

라운드는 검증자의 전체 판정 사이의 구간이다. 리뷰마다 어느 커밋에 대한 것인지와 계측을 적고, 리뷰 하나는 차단·수정·실측·판정 네 줄이다. 보고서 원문은 스크래치패드 경로로 가리킨다. R0은 설계 리뷰다 — 반박과 처리는 드라이버가 지정한다.

### R0

#### 설계 리뷰 — 계획 커밋 · 드라이버 직접(ultrafast)

- 반박: R0-1 한 물리 줄의 인접 display 도 같은 결함이다.
- 반박: R0-2 단일 display 의 tex 보존 불변식을 추가한다.
- 반박: R0-3 파서·유니코드 항목의 확정 결함과 파일 집합을 구체화한다.
- 반박: R0-4 display 뒤 빈 줄 없이 오는 글은 비목표다.
- 반박: R0-5 공유 판정 함수는 `hooks/parse.ts` 에 두고 `hooks/unicode.ts` 에서 가져온다.
- 처리: R0-1·R0-3·R0-5 반영, R0-2 반영(D2), R0-4 비목표(D3), 초안 비목표 기각(D1)
- 실측: `multiline` → display `A\n$$\n$$\nB`; `lines` → display `A$$\n$$B`; `oneLine` → display `A$$ $$B`; `textBetween` → display `A$$ and $$B`; `where` → para `[A] where x`; `textInBraces` → display `\text{$$}`; `escapedClose` → display `5\$`; `brackets` → display `A\]\n\[B`; `mixed` → para `[A] \[B\]` (기준 `7b87c6f`)
- 판정: 반박을 반영한 이 계획으로 시작하는 데 합의한다

### R1

- 아직 시작하지 않음.

## 열린 질문

- 현재 없음.

원 요구 충족 후 발견된 마이너·에지케이스 방어 후보는 여기에 적립하고 즉시 배정하지 않는다 — 사용자 대화로 처분이 정해지면 결정 원장에 남긴 뒤 지운다.
