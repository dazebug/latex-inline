import { expect, test } from 'claude-code/testing'

import { glueTokens, hasMath, parseBlocks, tokenize } from '../hooks/parse'

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
