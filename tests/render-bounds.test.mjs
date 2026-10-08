// Run with `node --test tests/`. Each test runs bin/render.mjs and compares a
// picture's ink, as its alpha sum, with pictures nothing can cut: the same
// formula held clear of MathJax's box edges, or its parts drawn separately.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { Resvg } = require('@resvg/resvg-js')
const RENDERER = fileURLToPath(new URL('../bin/render.mjs', import.meta.url))
// The fallback fonts bin/render.mjs looks for.
const CJK_FONTS = [
  '/System/Library/Fonts/AppleSDGothicNeo.ttc',
  '/System/Library/Fonts/Hiragino Sans GB.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc',
]
const hasCjkFont = CJK_FONTS.some(file => fs.existsSync(file))
const STYLE = {
  rowPx: 64,
  cellRatio: 2.125,
  baseline: 0.75,
  lineEm: 1.25,
  mathScale: 1,
  inlineShrinkLimit: 1,
  displayScale: 2,
  fontFamily: 'fira',
  color: '#ffffff',
}

// Space and an invisible rule move the formula off its box edges without
// adding ink.
function heldAwayFromBoxEdges(tex) {
  return `\\hspace{1em}\\rule[-1em]{0pt}{3em}{${tex}}\\hspace{1em}`
}

function render(items, outDir, style = STYLE) {
  const child = spawnSync(process.execPath, [RENDERER], {
    input: JSON.stringify({ items, outDir, ...style }),
    encoding: 'utf8',
  })
  assert.equal(child.error, undefined, child.error?.message)
  assert.equal(child.status, 0, child.stderr || child.stdout)

  const { results } = JSON.parse(child.stdout)
  assert.equal(results.length, items.length)
  assert.ok(results.every(result => !result.error), JSON.stringify(results))
  return new Map(results.map(result => [result.key, result]))
}

function alphaSum(result) {
  const png = fs.readFileSync(result.file)
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image href="data:image/png;base64,${png.toString('base64')}" width="${width}" height="${height}"/></svg>`
  const pixels = new Resvg(svg, { fitTo: { mode: 'original' }, font: { loadSystemFonts: false } }).render().pixels
  let sum = 0
  for (let i = 3; i < pixels.length; i += 4) sum += pixels[i]
  return sum
}

function assertAlphaMatches(results, formulaKey, shiftedKey) {
  const formula = alphaSum(results.get(formulaKey))
  const shifted = alphaSum(results.get(shiftedKey))
  const relativeDifference = Math.abs(formula - shifted) / shifted
  assert.ok(relativeDifference <= 0.005, `${formulaKey}: alpha sums ${formula} and ${shifted} differ by ${(relativeDifference * 100).toFixed(2)}%`)
}

function assertAlphaMatchesParts(results, wholeKey, partKeys) {
  const whole = alphaSum(results.get(wholeKey))
  const parts = partKeys.reduce((sum, key) => sum + alphaSum(results.get(key)), 0)
  const relativeDifference = Math.abs(whole - parts) / parts
  assert.ok(relativeDifference <= 0.005, `${wholeKey}: alpha sum ${whole} differs from parts ${parts} by ${(relativeDifference * 100).toFixed(2)}%`)
}

test('italic j ink is retained in inline and display math', t => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-inline-bounds-'))
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }))

  const items = [
    { key: 'j-display', tex: 'j', display: true },
    { key: 'j-display-shifted', tex: heldAwayFromBoxEdges('j'), display: true },
    { key: 'j-inline', tex: 'j', display: false },
    { key: 'j-inline-shifted', tex: heldAwayFromBoxEdges('j'), display: false },
  ]
  const results = render(items, outDir)
  assertAlphaMatches(results, 'j-display', 'j-display-shifted')
  assertAlphaMatches(results, 'j-inline', 'j-inline-shifted')
})

test('Hangul fraction ink is retained in display math', { skip: !hasCjkFont && 'No renderer CJK fallback font is installed' }, t => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-inline-bounds-'))
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }))

  const tex = String.raw`\frac{\text{맞게 붙인 쌍}}{\text{정답 쌍 전체}}`
  const results = render([
    { key: 'hangul-display', tex, display: true },
    { key: 'hangul-display-shifted', tex: heldAwayFromBoxEdges(tex), display: true },
  ], outDir)
  assertAlphaMatches(results, 'hangul-display', 'hangul-display-shifted')
})

test('a clipped overline does not add terminal columns', t => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-inline-bounds-'))
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }))

  const results = render([
    { key: 'plain', tex: 'abcdefghijklmnop', display: true },
    { key: 'overline', tex: String.raw`\overline{abcdefghijklmnop}`, display: true },
  ], outDir)
  assert.equal(results.get('overline').columns, results.get('plain').columns)
})

test('inline math retains ink with nonpositive ascent or depth', t => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-inline-bounds-'))
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }))

  const cases = [
    { key: 'negative-depth', tex: String.raw`\overset{\frac{a}{b}}{=}` },
    { key: 'negative-ascent', tex: String.raw`\underset{\frac{\frac{a}{b}}{c}}{\_}` },
  ]
  const items = cases.flatMap(({ key, tex }) => [
    { key, tex, display: false },
    { key: `${key}-shifted`, tex: heldAwayFromBoxEdges(tex), display: false },
  ])
  // Higher resolution reduces subpixel alpha-sum noise.
  const results = render(items, outDir, { ...STYLE, rowPx: 128 })
  const failures = []
  for (const { key } of cases) {
    assert.equal(results.get(key).rows, 3)
    try {
      assertAlphaMatches(results, key, `${key}-shifted`)
    } catch (error) {
      failures.push(error.message)
    }
  }
  assert.deepEqual(failures, [])
})

test('full-width roots retain tagged and forced-break formula ink', t => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-inline-bounds-'))
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }))

  const items = [
    { key: 'tagged', tex: String.raw`E = mc^2 \tag{1}`, display: true },
    { key: 'tagged-formula', tex: 'E = mc^2', display: true },
    { key: 'tagged-label', tex: String.raw`\text{(1)}`, display: true },
    { key: 'line-break', tex: String.raw`a \\ b`, display: false },
    { key: 'line-a', tex: 'a', display: false },
    { key: 'line-b', tex: 'b', display: false },
    { key: 'underline-tag', tex: String.raw`\underline{\hspace{3em}} \tag{1}`, display: true },
    { key: 'underline-tag-rule', tex: String.raw`\underline{\hspace{3em}}`, display: true },
    { key: 'underline-tag-label', tex: String.raw`\text{(1)}`, display: true },
  ]
  // Higher output resolution reduces subpixel alpha-sum noise.
  const results = render(items, outDir, { ...STYLE, rowPx: 128 })
  const failures = []
  for (const [wholeKey, partKeys] of [
    ['tagged', ['tagged-formula', 'tagged-label']],
    ['line-break', ['line-a', 'line-b']],
    ['underline-tag', ['underline-tag-rule', 'underline-tag-label']],
  ]) {
    try {
      assertAlphaMatchesParts(results, wholeKey, partKeys)
    } catch (error) {
      failures.push(error.message)
    }
  }

  const inlineUnderline = render([
    { key: 'line-break-underline', tex: String.raw`x \\ \underline{\hspace{3em}}`, display: false },
    { key: 'line-break-x', tex: 'x', display: false },
    { key: 'line-break-underline-only', tex: String.raw`\underline{\hspace{3em}}`, display: false },
  ], outDir, { ...STYLE, rowPx: 128, lineEm: 1.5 })
  try {
    assertAlphaMatchesParts(inlineUnderline, 'line-break-underline', ['line-break-x', 'line-break-underline-only'])
    assert.equal(inlineUnderline.get('line-break-underline').rows, 3)
    assert.ok(inlineUnderline.get('line-break-underline').columns <= 5)
    assert.equal(results.get('tagged').rows, 3)
    assert.ok(results.get('tagged').columns > results.get('tagged-formula').columns)
    assert.equal(results.get('line-break').rows, 3)
    // A natural-width two-line formula stays within a few terminal cells.
    assert.ok(results.get('line-break').columns <= 3)
  } catch (error) {
    failures.push(error.message)
  }
  assert.deepEqual(failures, [])
})

test('MathJax ids from TeX text do not break SVG serialization', t => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-inline-bounds-'))
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }))

  const results = render([
    { key: 'css-id', tex: String.raw`\cssId{a<b}{x}`, display: true },
    { key: 'plain-x', tex: 'x', display: true },
    { key: 'tagged', tex: String.raw`x \tag{A\&B}`, display: true },
    { key: 'tagged-formula', tex: 'x', display: true },
    { key: 'tagged-label', tex: String.raw`\text{(A\&B)}`, display: true },
  ], outDir, { ...STYLE, rowPx: 128 })

  assertAlphaMatchesParts(results, 'css-id', ['plain-x'])
  assertAlphaMatchesParts(results, 'tagged', ['tagged-formula', 'tagged-label'])
})
