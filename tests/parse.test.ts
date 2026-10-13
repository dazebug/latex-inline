import { expect, test } from 'claude-code/testing'

import { glueTokens, hasMath, parseBlocks, splitMarkdownRuns, tokenize, type Block } from '../hooks/parse'

test('a backtick in a fence info string does not open a fence', async () => {
  const text = '```a```\n\nplain'
  expect(splitMarkdownRuns(text)).toEqual([{ kind: 'prose', text }])
})

test('a fence example inside code does not close the outer code run', async () => {
  const code = '```python\ndef f():\n    """\n        ```python\n        f()\n        ```\n    """\n```'
  const text = `Loss $L$.\n\n${code}\n\nThen $y$.`
  expect(splitMarkdownRuns(text)).toEqual([
    { kind: 'prose', text: 'Loss $L$.' },
    { kind: 'code', text: code },
    { kind: 'prose', text: 'Then $y$.' },
  ])
})

test('tokens with no space between them wrap together', async () => {
  expect(glueTokens(tokenize('together: $e^{i\\pi}+1=0$.'))).toEqual([
    [{ kind: 'text', text: 'together: ' }],
    [
      { kind: 'math', tex: 'e^{i\\pi}+1=0' },
      { kind: 'text', text: '.' },
    ],
  ])
  expect(glueTokens(tokenize('점수 ($x^2$)는 크다'))).toEqual([
    [{ kind: 'text', text: '점수 ' }],
    [
      { kind: 'text', text: '(' },
      { kind: 'math', tex: 'x^2' },
      { kind: 'text', text: ')는 ' },
    ],
    [{ kind: 'text', text: '크다' }],
  ])
})

test('inline math follows the pandoc dollar rules', async () => {
  expect(hasMath('점수는 $s_{int}$ 이다')).toBe(true)
  expect(hasMath('괄호 표기 \\(x+1\\) 도 수식')).toBe(true)
  expect(hasMath('가격은 $20,000 과 $30,000 이다')).toBe(false)
  expect(hasMath('`echo $HOME` 와 `$PATH`')).toBe(false)
  expect(hasMath('닫히지 않은 $x 수식')).toBe(false)
  expect(hasMath('공백이 붙은 $ x $ 는 수식이 아니다')).toBe(false)
  expect(hasMath('이스케이프 \\$x\\$')).toBe(false)
})

test('a dollar amount never pairs with a later formula or a dollar inside code', async () => {
  expect(tokenize('가격 $20,000 과 `echo $HOME` 다음 $\\underbrace{x}_{b}$ 는')).toEqual([
    { kind: 'text', text: '가격 ' },
    { kind: 'text', text: '$20,000 ' },
    { kind: 'text', text: '과 ' },
    { kind: 'code', text: 'echo $HOME' },
    { kind: 'text', text: ' ' },
    { kind: 'text', text: '다음 ' },
    { kind: 'math', tex: '\\underbrace{x}_{b}' },
    { kind: 'text', text: ' ' },
    { kind: 'text', text: '는' },
  ])
  expect(hasMath('$20,000 과 $30,000 사이 $x$')).toBe(true)
  expect(tokenize('$20,000 과 $30,000 사이 $x$')).toEqual([
    { kind: 'text', text: '$20,000 ' },
    { kind: 'text', text: '과 ' },
    { kind: 'text', text: '$30,000 ' },
    { kind: 'text', text: '사이 ' },
    { kind: 'math', tex: 'x' },
  ])
})

test('words keep their trailing space and a particle stays next to the math', async () => {
  expect(tokenize('점수 $x^2$는 크다')).toEqual([
    { kind: 'text', text: '점수 ' },
    { kind: 'math', tex: 'x^2' },
    { kind: 'text', text: '는 ' },
    { kind: 'text', text: '크다' },
  ])
})

test('code spans and bold survive around math', async () => {
  expect(tokenize('**굵게** `a$b$` $y$')).toEqual([
    { kind: 'text', text: '굵게', bold: true },
    { kind: 'text', text: ' ' },
    { kind: 'code', text: 'a$b$' },
    { kind: 'text', text: ' ' },
    { kind: 'math', tex: 'y' },
  ])
})

test('an escaped dollar is a literal dollar', async () => {
  expect(tokenize('값 \\$5 와 $z$')).toEqual([
    { kind: 'text', text: '값 ' },
    { kind: 'text', text: '$5 ' },
    { kind: 'text', text: '와 ' },
    { kind: 'math', tex: 'z' },
  ])
})

test('blocks: markdown passes through, math paragraphs, display math and lists are split out', async () => {
  const text = [
    '첫 문단',
    '',
    '```sh',
    'echo $HOME',
    '',
    '```',
    '',
    '둘째 $x$ 문단',
    '',
    '$$',
    '\\sum_i x_i',
    '$$',
    '',
    '- 항목 $a$',
    '- 항목 b',
  ].join('\n')

  expect(parseBlocks(text)).toEqual([
    { kind: 'markdown', text: '첫 문단\n\n```sh\necho $HOME\n\n```' },
    {
      kind: 'para',
      tokens: [
        { kind: 'text', text: '둘째 ' },
        { kind: 'math', tex: 'x' },
        { kind: 'text', text: ' ' },
        { kind: 'text', text: '문단' },
      ],
    },
    { kind: 'display', tex: '\\sum_i x_i' },
    {
      kind: 'list',
      items: [
        { prefix: '- ', tokens: [{ kind: 'text', text: '항목 ' }, { kind: 'math', tex: 'a' }] },
        { prefix: '- ', tokens: [{ kind: 'text', text: '항목 ' }, { kind: 'text', text: 'b' }] },
      ],
    },
  ])
})

test('a reply without math stays one markdown block', async () => {
  const text = '그냥 문단\n\n| a | b |\n|---|---|\n| $1 | $2 |'
  expect(parseBlocks(text)).toEqual([{ kind: 'markdown', text }])
})

test('a list item holds the blocks indented under it, and a list right under its paragraph', async () => {
  const text = [
    '1. **첫째.** $W$는 보냅니다.',
    '',
    '   $$W = U\\Sigma V^\\top$$',
    '',
    '   여기서 $U$는 행렬입니다.',
    '   - **방향.** $xU$는 투영합니다.',
    '   - **회전.** $V^\\top$이 회전합니다.',
    '',
    '   곧 고르고 돌리는 것입니다.',
    '2. **둘째.** 첫 층뿐입니다.',
  ].join('\n')
  expect(parseBlocks(text)).toEqual([
    {
      kind: 'list',
      items: [
        {
          prefix: '1. ',
          tokens: tokenize('**첫째.** $W$는 보냅니다.'),
          blocks: [
            { kind: 'display', tex: 'W = U\\Sigma V^\\top' },
            { kind: 'para', tokens: tokenize('여기서 $U$는 행렬입니다.') },
            {
              kind: 'list',
              joined: true,
              items: [
                { prefix: '- ', tokens: tokenize('**방향.** $xU$는 투영합니다.') },
                { prefix: '- ', tokens: tokenize('**회전.** $V^\\top$이 회전합니다.') },
              ],
            },
            { kind: 'markdown', text: '곧 고르고 돌리는 것입니다.' },
          ],
        },
        { prefix: '2. ', tokens: tokenize('**둘째.** 첫 층뿐입니다.') },
      ],
    },
  ])
})

test('lists start and end where Claude Code reads them', async () => {
  expect(parseBlocks('단계는 $x$ 입니다:\n- $a$ 고르기\n- 늘이기')).toEqual([
    { kind: 'para', tokens: tokenize('단계는 $x$ 입니다:') },
    {
      kind: 'list',
      joined: true,
      items: [
        { prefix: '- ', tokens: tokenize('$a$ 고르기') },
        { prefix: '- ', tokens: tokenize('늘이기') },
      ],
    },
  ])
  // Only a bullet or the number 1 starts a list inside a paragraph.
  expect(parseBlocks('값은 $x$ 이고\n2. 번은 아닙니다')).toEqual([{ kind: 'para', tokens: tokenize('값은 $x$ 이고 2. 번은 아닙니다') }])
  // A bullet indented less than the text of the item above starts a list of its own.
  expect(parseBlocks('1. $a$\n  - $b$')).toEqual([
    { kind: 'list', items: [{ prefix: '1. ', tokens: tokenize('$a$') }] },
    { kind: 'list', joined: true, items: [{ prefix: '- ', tokens: tokenize('$b$') }] },
  ])
  // Items a blank line apart stay one list; a line under an item with no indent goes on with its text.
  expect(parseBlocks('1. $a$\n\n2. $b$\n이어서')).toEqual([
    {
      kind: 'list',
      items: [
        { prefix: '1. ', tokens: tokenize('$a$') },
        { prefix: '2. ', tokens: tokenize('$b$ 이어서'), spaced: true },
      ],
    },
  ])
  // Claude Code puts a blank line under every heading.
  expect(parseBlocks('## 장점\n1. $a$')).toEqual([
    { kind: 'markdown', text: '## 장점' },
    { kind: 'list', items: [{ prefix: '1. ', tokens: tokenize('$a$') }] },
  ])
  // A line of display math that looks like a list item stays in the formula.
  expect(parseBlocks('$$\n- x + y\n$$')).toEqual([{ kind: 'display', tex: '- x + y' }])
})

function markers(blocks: Block[]): string[] {
  return blocks.flatMap(block => (block.kind === 'list' ? block.items.flatMap(item => [item.prefix, ...markers(item.blocks ?? [])]) : []))
}

test('list markers are the ones Claude Code draws', async () => {
  expect(markers(parseBlocks('* $a$\n* $b$'))).toEqual(['- ', '- '])
  expect(markers(parseBlocks('1. $a$\n1. $b$'))).toEqual(['1. ', '2. '])
  expect(markers(parseBlocks('3) $a$\n4) $b$'))).toEqual(['3. ', '4. '])
  // Numbers one level in are letters, and two levels in roman numerals.
  expect(markers(parseBlocks('1. $a$\n   1. $b$\n      1. $c$\n      2. $d$\n   2. $e$'))).toEqual(['1. ', 'a. ', 'i. ', 'ii. ', 'b. '])
})
