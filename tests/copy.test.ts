import { expect, test } from 'claude-code/testing'

import { copyAsLatex, copyWatcher, DIACRITICS, shownOf, type Selected } from '../hooks/copy'
import { parseBlocks } from '../hooks/parse'

// A picture's cells on one row, as Claude Code writes them and a selection
// reads them: U+10EEEE, then the diacritic of the row and of the column.
function cells(row: number, first: number, last: number): string {
  let out = ''
  for (let column = first; column <= last; column++) out += String.fromCodePoint(0x10eeee, DIACRITICS[row] ?? 0, DIACRITICS[column] ?? 0)
  return out
}

const pad = (n: number) => ' '.repeat(n)

const REPLY = [
  'The energy $E = mc^2$ relates mass and energy, and the sum $\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}$ is a classic **result** that is long enough to wrap onto the next line.',
  '',
  '$$\\int_0^1 x^2 \\, dx = \\frac{1}{3}$$',
  '',
  '1. First item with $\\alpha$ inline.',
  '2. Second item.',
].join('\n')

const SIZES: Record<string, { columns: number; rows: number }> = {
  'E = mc^2': { columns: 10, rows: 3 },
  '\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}': { columns: 17, rows: 3 },
  '\\int_0^1 x^2 \\, dx = \\frac{1}{3}': { columns: 23, rows: 5 },
  '\\alpha': { columns: 2, rows: 1 },
}

const shown = (text: string, sizes = SIZES, isFirstOfReply = true) => shownOf(parseBlocks(text), job => sizes[job.tex], 300, isFirstOfReply)

test('the formulas of a selection are copied as their LaTeX, in place of their pictures', async () => {
  // Read off Claude Code 2.1.296: a drag from "The" to the end of the reply,
  // the inline pictures three rows tall and the display one five.
  const selected = [
    `The energy ${cells(1, 0, 9)} relates mass and energy, and the sum ${cells(1, 0, 16)} is a classic result that is long enough to wrap onto the next line.`,
    `${pad(13)}${cells(2, 0, 9)}${pad(38)}${cells(2, 0, 16)}`,
    '',
    ...[0, 1, 2, 3, 4].map(row => `${pad(143)}${cells(row, 0, 22)}`),
    '',
    `  1. First item with ${cells(0, 0, 1)} inline.`,
    '  2. Second item.',
  ].join('\n')
  expect(copyAsLatex(selected, shown(REPLY))).toBe(
    [
      'The energy $E = mc^2$ relates mass and energy, and the sum $\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}$ is a classic result that is long enough to wrap onto the next line.',
      '',
      '$$\\int_0^1 x^2 \\, dx = \\frac{1}{3}$$',
      '',
      '1. First item with $\\alpha$ inline.',
      '2. Second item.',
    ].join('\n'),
  )
})

test('a paragraph the mod wrapped is copied as one line, as Claude Code copies its own', async () => {
  const selected = [
    `⏺ The energy ${cells(1, 0, 9)} relates mass and`,
    `${pad(13)}${cells(2, 0, 9)}`,
    `${pad(22)}${cells(0, 0, 16)}`,
    `  energy, and the sum ${cells(1, 0, 16)} is a classic`,
    `${pad(22)}${cells(2, 0, 16)}`,
    '  result that is long enough to wrap onto the next line.',
  ].join('\n')
  expect(copyAsLatex(selected, shown(REPLY))).toBe(
    'The energy $E = mc^2$ relates mass and energy, and the sum $\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}$ is a classic result that is long enough to wrap onto the next line.',
  )
})

test('a formula whose text row lies outside the selection is left out, not copied', async () => {
  // The selection starts after E = mc^2 on its text row, so only the row
  // under that picture is in it.
  const selected = [
    `relates mass and energy, and the sum ${cells(1, 0, 16)} is a classic`,
    `${pad(13)}${cells(2, 0, 9)}${pad(38)}${cells(2, 0, 16)}`,
  ].join('\n')
  expect(copyAsLatex(selected, shown(REPLY))).toBe('relates mass and energy, and the sum $\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}$ is a classic')
})

test('a selection that ends under a formula does not take in the display formula after it', async () => {
  // Read off Claude Code: the drag stopped on the row under E = mc^2, four
  // cells into it. Those cells could pass for the middle row of the display
  // formula below, but the rows above a formula's middle row hold no text.
  const text = `The energy ${cells(1, 0, 9)} relates mass and energy, and the sum ${cells(1, 0, 16)} is a classic result that is long enough to wrap onto the next line.`
  const expected = 'The energy $E = mc^2$ relates mass and energy, and the sum $\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}$ is a classic result that is long enough to wrap onto the next line.'
  expect(copyAsLatex(`${text}\n${pad(13)}${cells(2, 0, 3)}`, shown(REPLY))).toBe(expected)
  expect(copyAsLatex(`${text}\n${pad(13)}${cells(2, 0, 9)}${pad(38)}${cells(2, 0, 16)}\n`, shown(REPLY))).toBe(`${expected}\n`)
})

test("the cells over a formula are not taken for a one-row formula's", async () => {
  // The row above the second line holds the top of the 3-row fraction only,
  // and ends there; it must not stand in for the one-row picture of q.
  const reply = 'First $p$ ends here and then $q$ starts the next line with $\\frac{a}{b}$ in it.'
  const sizes = { p: { columns: 2, rows: 1 }, q: { columns: 6, rows: 1 }, '\\frac{a}{b}': { columns: 4, rows: 3 } }
  const selected = [
    `First ${cells(0, 0, 1)} ends here and then`,
    `${pad(40)}${cells(0, 0, 3)}`,
    `  ${cells(0, 0, 5)} starts the next line with ${cells(1, 0, 3)} in it.`,
    `${pad(40)}${cells(2, 0, 3)}`,
  ].join('\n')
  expect(copyAsLatex(selected, shown(reply, sizes))).toBe('First $p$ ends here and then $q$ starts the next line with $\\frac{a}{b}$ in it.')
})

test('a display formula wider than the reply, cut on both sides, is still copied', async () => {
  const sizes = { ...SIZES, '\\int_0^1 x^2 \\, dx = \\frac{1}{3}': { columns: 23, rows: 5 } }
  const selected = ['next line.', '', ...[0, 1, 2, 3, 4].map(row => `  ${cells(row, 3, 19)}`), '', '  1. First'].join('\n')
  expect(copyAsLatex(selected, shown(REPLY, sizes))).toBe(['next line.', '', '$$\\int_0^1 x^2 \\, dx = \\frac{1}{3}$$', '', '1. First'].join('\n'))
})

test("a display formula's own middle row wins over the bottom of a formula above it", async () => {
  const reply = '$\\frac{a}{b}$\n\n$$D$$'
  const sizes = { '\\frac{a}{b}': { columns: 4, rows: 3 }, D: { columns: 20, rows: 5 } }
  const selected = [
    `${cells(0, 0, 3)}`,
    `  ${cells(1, 0, 3)}`,
    `  ${cells(2, 0, 3)}`,
    '',
    ...[0, 1, 2, 3, 4].map(row => `${pad(30)}${cells(row, 0, 19)}`),
  ].join('\n')
  expect(copyAsLatex(selected, shown(reply, sizes))).toBe('$\\frac{a}{b}$\n\n$$D$$')
})

test('a display formula selected alone is copied as its LaTeX', async () => {
  const selected = [0, 1, 2, 3, 4].map(row => `${pad(4)}${cells(row, 0, 22)}`).join('\n')
  expect(copyAsLatex(selected, shown(REPLY))).toBe('$$\\int_0^1 x^2 \\, dx = \\frac{1}{3}$$')
})

test('an inline formula and the particle after it are copied together', async () => {
  const reply = '그래서 $x$는 양수이고 $y$는 음수입니다.'
  const sizes = { x: { columns: 2, rows: 1 }, y: { columns: 3, rows: 1 } }
  expect(copyAsLatex(`${cells(0, 0, 1)}는 양수이고`, shown(reply, sizes))).toBe('$x$는 양수이고')
})

test('formulas no selection can tell apart are not guessed', async () => {
  // Two formulas of one size, and nothing else selected to tell which.
  const reply = 'Both $a$ and $b$ hold.'
  const sizes = { a: { columns: 2, rows: 1 }, b: { columns: 2, rows: 1 } }
  expect(copyAsLatex(cells(0, 0, 1), shown(reply, sizes))).toBe(null)
  expect(copyAsLatex(`Both ${cells(0, 0, 1)} and`, shown(reply, sizes))).toBe('Both $a$ and')
})

test('a selection that does not read as the reply is not rewritten', async () => {
  const selected = `Some other words entirely ${cells(0, 0, 1)} here.`
  expect(copyAsLatex(selected, shown(REPLY))).toBe(null)
})

test('a formula still drawn as its source is copied as it shows', async () => {
  const reply = 'Here $z$ waits and $\\alpha$ is drawn.'
  expect(copyAsLatex(`Here $z$ waits and ${cells(0, 0, 1)} is drawn.`, shown(reply, { '\\alpha': { columns: 2, rows: 1 } }))).toBe(
    'Here $z$ waits and $\\alpha$ is drawn.',
  )
})

test('the items of a list stay on their own lines and keep their indent', async () => {
  const reply = ['- Outer $a$ text', '  - Inner $b$ text', '- Last'].join('\n')
  const sizes = { a: { columns: 2, rows: 1 }, b: { columns: 3, rows: 1 } }
  const selected = [`- Outer ${cells(0, 0, 1)} text`, `    - Inner ${cells(0, 0, 2)} text`, '  - Last'].join('\n')
  expect(copyAsLatex(selected, shown(reply, sizes))).toBe(['- Outer $a$ text', '  - Inner $b$ text', '- Last'].join('\n'))
})

// The watcher, driven by hand: what is selected, what the clipboard holds,
// the clock, and what it wrote.
function harness(rewrite: (selected: Selected) => string | null = () => 'LATEX') {
  const state = { selected: undefined as Selected | undefined, clipboard: 'before', now: 0, reads: 0, written: [] as string[] }
  const tick = copyWatcher({
    selection: async () => state.selected,
    readClipboard: async () => {
      state.reads++
      return state.clipboard
    },
    write: async text => {
      state.written.push(text)
      state.clipboard = text
      return true
    },
    rewrite,
    now: () => state.now,
  })
  const step = async (ms = 200) => {
    state.now += ms
    await tick()
  }
  return { state, step }
}

const PICTURED = `x ${cells(0, 0, 1)} y`

test('the copy Claude Code makes of a selection with pictures is replaced with its LaTeX', async () => {
  const { state, step } = harness()
  state.selected = { text: PICTURED, requestId: 'r' }
  await step()
  await step()
  expect(state.written).toEqual([])
  state.clipboard = PICTURED
  await step()
  expect(state.written).toEqual(['LATEX'])
  await step()
  expect(state.written).toEqual(['LATEX'])
})

test('the clipboard is not read while the selection is still changing', async () => {
  const { state, step } = harness()
  state.selected = { text: PICTURED, requestId: 'r' }
  await step()
  state.selected = { text: `${PICTURED} z`, requestId: 'r' }
  await step()
  expect(state.reads).toBe(0)
  await step()
  expect(state.reads).toBe(1)
})

test('what another program put on the clipboard is left alone', async () => {
  const { state, step } = harness()
  state.selected = { text: PICTURED, requestId: 'r' }
  state.clipboard = 'copied elsewhere'
  for (let k = 0; k < 20; k++) await step()
  expect(state.written).toEqual([])
})

test('a copy Claude Code makes again later is replaced again', async () => {
  const { state, step } = harness()
  state.selected = { text: PICTURED, requestId: 'r' }
  await step()
  state.clipboard = PICTURED
  await step()
  state.clipboard = PICTURED
  await step(5_000)
  expect(state.written).toEqual(['LATEX', 'LATEX'])
})

test('the clipboard is read less often once a selection has stood a while, and no more after a minute', async () => {
  const { state, step } = harness()
  state.selected = { text: PICTURED, requestId: 'r' }
  await step()
  for (let k = 0; k < 20; k++) await step()
  const early = state.reads
  for (let k = 0; k < 20; k++) await step()
  expect(state.reads - early).toBeLessThan(10)
  await step(60_000)
  const late = state.reads
  await step(1_000)
  expect(state.reads).toBe(late)
})

test('a selection without pictures, or one the reply cannot explain, is left as copied', async () => {
  const plain = harness()
  plain.state.selected = { text: 'just words', requestId: 'r' }
  plain.state.clipboard = 'just words'
  for (let k = 0; k < 5; k++) await plain.step()
  expect(plain.state.reads).toBe(0)

  const unknown = harness(() => null)
  unknown.state.selected = { text: PICTURED, requestId: 'r' }
  unknown.state.clipboard = PICTURED
  for (let k = 0; k < 5; k++) await unknown.step()
  expect(unknown.state.written).toEqual([])
})
