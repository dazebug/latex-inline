// Run with `node --test tests/render-tex.test.mjs`. Each test runs
// bin/render.mjs on TeX that MathJax alone fails on or draws wrong, and
// compares its picture with the one drawn from the TeX it should read as.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const RENDERER = fileURLToPath(new URL('../bin/render.mjs', import.meta.url))
// The math fallback fonts bin/render.mjs looks for.
const MATH_FONTS = ['/System/Library/Fonts/Supplemental/STIXTwoMath.otf', '/usr/share/fonts/truetype/noto/NotoSansMath-Regular.ttf']
const hasMathFont = MATH_FONTS.some(file => fs.existsSync(file))
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

// Renders each [key, tex] pair as inline math and returns the results by key.
function render(pairs) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-inline-tex-'))
  const items = pairs.map(([key, tex]) => ({ key, tex, display: false }))
  const child = spawnSync(process.execPath, [RENDERER], { input: JSON.stringify({ items, outDir, ...STYLE }), encoding: 'utf8' })
  assert.equal(child.status, 0, child.stderr || child.stdout)
  return new Map(JSON.parse(child.stdout).results.map(result => [result.key, result]))
}

function pictureOf(result, tex) {
  assert.ok(result.file, `${tex}: ${result.error}`)
  return fs.readFileSync(result.file)
}

// Each [tex, as]: the picture of `tex` is the picture of `as`.
function assertDrawnAs(pairs) {
  const results = render(pairs.flatMap(([tex, as], i) => [[`tex${i}`, tex], [`as${i}`, as]]))
  pairs.forEach(([tex, as], i) => {
    assert.ok(pictureOf(results.get(`tex${i}`), tex).equals(pictureOf(results.get(`as${i}`), as)), `${tex} is not drawn as ${as}`)
  })
}

test('an unknown command is drawn as its name, as an operator', () => {
  assertDrawnAs([
    ['t = \\softplus(z)', 't = \\operatorname{softplus}(z)'],
    ['\\sigmoid(x) + \\ReLU(x)', '\\operatorname{sigmoid}(x) + \\operatorname{ReLU}(x)'],
  ])
})

test('commands Claude writes that MathJax lacks are drawn as their usual forms', () => {
  assertDrawnAs([
    ['\\argmax_x f(x)', '\\operatorname*{arg\\,max}_x f(x)'],
    ['\\argmin_x f(x)', '\\operatorname*{arg\\,min}_x f(x)'],
    ['\\E[X] \\in \\R', '\\mathbb{E}[X] \\in \\mathbb{R}'],
    ['\\norm{x} + \\abs{y}', '\\left\\lVert x \\right\\rVert + \\left\\lvert y \\right\\rvert'],
    ['\\bm{x}', '\\boldsymbol{x}'],
    ['\\mathds{1} = \\1', '\\mathbb{1} = \\mathbb{1}'],
    ['a \\coloneqq b', 'a \\mathrel{:=} b'],
  ])
})

test('a letter the MathJax font lacks is drawn from a math font, not as a missing-glyph box', { skip: !hasMathFont && 'No math fallback font is installed' }, () => {
  const nothing = String.fromCodePoint(0x10fffd)
  const results = render([['indicator', '\\mathbb{1}'], ['missing', nothing]])
  assert.ok(!pictureOf(results.get('indicator'), '\\mathbb{1}').equals(pictureOf(results.get('missing'), 'U+10FFFD')), 'the double-struck one is drawn as the missing-glyph box')
})
