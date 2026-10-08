// Compare alpha sums with the same formula held clear of MathJax's box edges.
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

test('italic j ink is retained in inline and display math', t => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-inline-bounds-'))
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }))

  // Keep the perturbation ink-free while moving the formula away from the box edges.
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
