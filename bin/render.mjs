// Renders TeX formulas to PNGs sized to whole terminal cells: MathJax lays
// the formula out as SVG and resvg rasterizes it. A picture covers the ink
// resvg measures as well as MathJax's box, because the box leaves some ink
// out: MathJax gives text it has no glyph for a fixed 0.75em height (Hangul
// reaches about 0.85em), and italic glyphs such as j overhang their boxes.
//
// Reads one JSON request on stdin and writes one JSON answer on stdout. Each
// picture is padded to an exact number of cells: the terminal stretches a
// picture to fill its box, so a box that matches the picture's own aspect
// keeps glyphs undistorted. An inline formula's baseline sits on the cell's
// text baseline, and a formula too tall for one row gets three rows with the
// baseline in the middle one, so the mod can center every item of a line and
// keep the baselines level.
//
// The packages are the plugin's own node_modules, which Claude Code installs
// from package-lock.json when the plugin is installed.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const MathJax = require('mathjax')
const { Resvg } = require('@resvg/resvg-js')

// Fonts for text MathJax has no glyph for, such as Hangul or kana inside
// \text{}: the first one this machine has, else every system font.
const TEXT_FONTS = [
  ['/System/Library/Fonts/AppleSDGothicNeo.ttc', 'Apple SD Gothic Neo'],
  ['/System/Library/Fonts/Hiragino Sans GB.ttc', 'Hiragino Sans GB'],
  ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 'Noto Sans CJK KR'],
  ['/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc', 'Noto Sans CJK KR'],
  ['/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc', 'Noto Sans CJK KR'],
]
const textFont = TEXT_FONTS.find(([file]) => fs.existsSync(file))
// A font for math letters the MathJax font has no glyph for, such as the 𝟙
// of \mathbb{1}, which would otherwise come out as a missing-glyph box: the
// first one this machine has, used where the text font lacks a glyph.
const MATH_FONTS = ['/System/Library/Fonts/Supplemental/STIXTwoMath.otf', '/usr/share/fonts/truetype/noto/NotoSansMath-Regular.ttf']
const mathFont = MATH_FONTS.find(file => fs.existsSync(file))

// Commands Claude writes that MathJax lacks, and that would read wrong as
// the operator names unknown commands are drawn as.
const MACROS = {
  argmax: '\\operatorname*{arg\\,max}',
  argmin: '\\operatorname*{arg\\,min}',
  E: '\\mathbb{E}',
  R: '\\mathbb{R}',
  N: '\\mathbb{N}',
  Z: '\\mathbb{Z}',
  Q: '\\mathbb{Q}',
  C: '\\mathbb{C}',
  1: '\\mathbb{1}',
  bm: ['\\boldsymbol{#1}', 1],
  mathds: ['\\mathbb{#1}', 1],
  norm: ['\\left\\lVert #1 \\right\\rVert', 1],
  abs: ['\\left\\lvert #1 \\right\\rvert', 1],
  coloneqq: '\\mathrel{:=}',
  eqqcolon: '\\mathrel{=:}',
}

const request = JSON.parse(fs.readFileSync(0, 'utf8'))

function svgAttribute(tag, name) {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]
}

// Drops ids nothing refers to before resvg reads the formula. resvg's
// toString writes attribute values back unescaped, so an id from TeX with <
// or &, as from \tag{A\&B} or \cssId, breaks the shaped copy when it is
// parsed again. The glyph definitions MathJax refers to keep theirs.
function removeUnreferencedIds(svg) {
  const references = new Set()
  const hrefs = svg.matchAll(/(?:^|\s)(?:xlink:)?href="#([^"]+)"/g)
  for (const [, id] of hrefs) references.add(id)
  const urls = svg.matchAll(/url\(#([^)]+)\)/g)
  for (const [, id] of urls) references.add(id)
  return svg.replace(/\sid="([^"]*)"/g, (attribute, id) =>
    references.has(id) ? attribute : '')
}

// MathJax gives an equation with a \tag, and inline math with a forced line
// break, a root as wide as its container: width="100%", the box only in
// data-mjx-viewBox, and the content drawn in pixels under scale(s,-s). Put
// that content in a viewport of the box's own width and map it back to
// MathJax's units, so it draws like any other formula.
function normalizeFullWidthRoot(svg, viewBox) {
  if (!viewBox) return svg

  const root = /^<svg\b[^>]*>/.exec(svg)[0]
  const [vx, vy, vw, vh] = viewBox.split(' ').map(Number)
  const end = svg.lastIndexOf('</svg>')
  const children = svg.slice(root.length, end)
  const [, scaleValue] = /<g\b[^>]*\btransform="scale\(([^,]+),-[^)]+\) translate\(/.exec(children) ?? []
  const scale = Number(scaleValue)
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error('Could not read MathJax full-width scale')
  }

  const opening = root
    .replace(/\s(?:width|height|viewBox|data-mjx-viewBox)="[^"]*"/g, '')
    .replace(/>$/, ` viewBox="${viewBox}">`)
  return `${opening}<g transform="translate(${vx},${vy}) scale(${1 / scale})"><svg width="${vw * scale}" height="${vh * scale}" overflow="visible">${children}</svg></g></svg>`
}

// Only text with content needs a font: MathJax adds an empty <text> to align
// tags.
function hasTextContent(svg) {
  return [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
    .some(([, text]) => text.replace(/<[^>]*>/g, '').length > 0)
}

// resvg's getBBox ignores clipping, and MathJax draws a stretched line or
// arrow (\overline, \underline, \overrightarrow) by clipping a stretched
// glyph to the line's box, so measuring it as drawn counts the cut-away
// glyph. In the copy to measure, draw each clip shape in place of the group
// it clips: the clipped ink lies inside that shape. A group whose clip path
// this does not handle stays visible, which can only measure too large.
function measuringSvgWithClipShapes(svg) {
  const clipShapes = new Map()
  for (const [, attributes, body] of svg.matchAll(/<clipPath\b([^>]*)>([\s\S]*?)<\/clipPath>/g)) {
    const opening = `<clipPath${attributes}>`
    const names = [...opening.matchAll(/\s([\w:.-]+)="[^"]*"/g)].map(([, name]) => name)
    const id = svgAttribute(opening, 'id')
    const units = svgAttribute(opening, 'clipPathUnits')
    const shapes = [...body.matchAll(/<([A-Za-z][\w:-]*)\b/g)].map(([, name]) => name)
    if (!id || names.some(name => !['id', 'clipPathUnits'].includes(name))) continue
    if (units && units !== 'userSpaceOnUse') continue
    if (!shapes.length || shapes.some(name => name !== 'path')) continue
    clipShapes.set(id, body)
  }

  return svg.replace(/<g\b[^>]*>/g, tag => {
    const reference = svgAttribute(tag, 'clip-path')
    const [, id] = /^url\(#([^)]+)\)$/.exec(reference ?? '') ?? []
    const shape = clipShapes.get(id)
    if (!shape || tag.endsWith('/>')) return tag

    const transform = svgAttribute(tag, 'transform')
    const drawnShape = transform
      ? `<g transform="${transform}">${shape}</g>`
      : `<g>${shape}</g>`
    const hidden = /\sdisplay="[^"]*"/.test(tag)
      ? tag.replace(/\sdisplay="[^"]*"/, ' display="none"')
      : tag.replace(/>$/, ' display="none">')
    return `${drawnShape}${hidden}`
  })
}

// A TeX package whose fallback for a command TeX reads but no package
// defines writes it as an operator name: \softplus(z) reads as softplus(z),
// where failing would show the whole formula as source. Being the parser's
// fallback, it leaves a command in \verb alone and finds one right after the
// row break \\. A command named by a symbol, as \@, still fails.
function defineOperatorNames() {
  const { Configuration } = globalThis.MathJax._.input.tex.Configuration
  const TexParser = globalThis.MathJax._.input.tex.TexParser.default
  const TexError = globalThis.MathJax._.input.tex.TexError.default
  Configuration.create('operatornames', {
    fallback: {
      macro: (parser, name) => {
        if (!/^[A-Za-z]+$/.test(name)) throw new TexError('UndefinedControlSequence', 'Undefined control sequence %1', `\\${name}`)
        parser.Push(new TexParser(`\\operatorname{${name}}`, parser.stack.env, parser.configuration).mml())
      },
    },
  })
}

await MathJax.init({
  loader: { load: ['input/tex', 'output/svg'], paths: { mathjax: path.dirname(require.resolve('mathjax/package.json')) } },
  startup: {
    ready() {
      defineOperatorNames()
      globalThis.MathJax.startup.defaultReady()
    },
  },
  // An error fails the formula, which the mod then shows as source.
  tex: { packages: { '[-]': ['noundefined'], '[+]': ['operatornames'] }, macros: MACROS, formatError: (_jax, error) => { throw error } },
  // MathJax 4 splits inline math into one <svg> per breakable piece so a
  // page can wrap it; a picture is one piece.
  output: { font: `mathjax-${request.fontFamily}`, fontCache: 'local', linebreaks: { inline: false } },
})
const adaptor = MathJax.startup.adaptor

async function render(item) {
  const node = await MathJax.tex2svgPromise(item.tex, { display: Boolean(item.display) })
  const sourceSvg = removeUnreferencedIds(
    adaptor.serializeXML(adaptor.firstChild(node)).replaceAll('currentColor', request.color),
  )
  const sourceRoot = /^<svg\b[^>]*>/.exec(sourceSvg)[0]
  const dataViewBox = svgAttribute(sourceRoot, 'data-mjx-viewBox')
  const sourceViewBox = dataViewBox ?? svgAttribute(sourceRoot, 'viewBox')
  const mathSvg = normalizeFullWidthRoot(sourceSvg, dataViewBox)
  // The viewBox is in thousandths of an em, with the baseline at y = 0.
  const [boxMinX, boxMinY, boxWidth, boxHeight] = sourceViewBox.split(' ').map(Number)
  const boxMaxX = boxMinX + boxWidth
  const boxMaxY = boxMinY + boxHeight
  const hasText = hasTextContent(mathSvg)
  let font = { loadSystemFonts: false }
  if (hasText) {
    const [file, family] = textFont ?? [undefined, undefined]
    font = file
      ? { loadSystemFonts: false, fontFiles: [file, mathFont].filter(Boolean), defaultFontFamily: family, serifFamily: family, sansSerifFamily: family }
      : { loadSystemFonts: true }
  }

  // MathJax glyphs are paths; only fallback <text> needs a font. Shape it
  // once here: the shaped copy, with text as paths, is what gets measured
  // and, for text, drawn.
  const shaped = new Resvg(mathSvg, { fitTo: { mode: 'original' }, font }).toString()
  const measuringSvg = measuringSvgWithClipShapes(shaped)
  const inkBox = new Resvg(measuringSvg, { font: { loadSystemFonts: false } }).getBBox()
  const svg = hasText ? shaped : mathSvg

  // Widen a side only for ink more than a thousandth of an em outside
  // MathJax's box. The box comes from the font's glyph data and misses the
  // outlines' extremes by fractions of a unit; widening for those would
  // redraw, a hair off, pictures whose ink already fits. A full-width layout
  // spreads over its container, so its width comes from the ink alone.
  let minX = boxMinX
  let maxX = boxMaxX
  if (dataViewBox && inkBox) {
    minX = inkBox.x
    maxX = inkBox.x + inkBox.width
  } else if (inkBox) {
    if (boxMinX - inkBox.x > 1) minX = inkBox.x
    if (inkBox.x + inkBox.width - boxMaxX > 1) maxX = inkBox.x + inkBox.width
  }
  const minY = inkBox && boxMinY - inkBox.y > 1 ? inkBox.y : boxMinY
  const maxY = inkBox && inkBox.y + inkBox.height - boxMaxY > 1 ? inkBox.y + inkBox.height : boxMaxY
  const ascent = -minY / 1000
  const depth = maxY / 1000
  const widthEm = (maxX - minX) / 1000

  const row = request.rowPx
  const cellWidth = row / request.cellRatio
  const base = request.baseline * row
  const textEm = row / request.lineEm

  let rows
  let em
  let baselineY
  if (item.display) {
    em = textEm * request.displayScale
    rows = Math.max(1, Math.ceil(((ascent + depth) * em + 0.4 * row) / row))
    baselineY = (rows * row - (ascent + depth) * em) / 2 + ascent * em
  } else {
    // One row may use its whole height: the baseline moves off the text's
    // baseline only as far as the formula needs to fit. A formula that would
    // shrink below inlineShrinkLimit to fit takes three rows instead.
    const full = textEm * request.mathScale
    const oneRow = Math.min(1, row / ((ascent + depth) * full))
    let scale
    if (oneRow >= request.inlineShrinkLimit) {
      rows = 1
      scale = oneRow
    } else {
      rows = 3
      // A side that does not cross the baseline puts no limit on the scale:
      // dividing by a negative extent, as for \stackrel{?}{=}, made the
      // scale negative and the picture empty.
      const ascentScale = ascent > 0 ? (row + base) / (ascent * full) : Infinity
      const depthScale = depth > 0 ? (2 * row - base) / (depth * full) : Infinity
      scale = Math.min(1, ascentScale, depthScale)
    }
    em = full * scale
    const middle = Math.floor(rows / 2) * row
    baselineY = Math.min(Math.max(middle + base, ascent * em), rows * row - depth * em)
  }

  const formulaWidth = widthEm * em
  const columns = Math.max(1, Math.ceil((formulaWidth + 0.3 * cellWidth) / cellWidth))
  const width = Math.round(columns * cellWidth)
  const height = rows * row
  const x = (width - formulaWidth) / 2
  const y = baselineY - ascent * em

  const inner = svg
    .replace(/^<svg[^>]*>/, `<svg x="${x}" y="${y}" width="${formulaWidth}" height="${(ascent + depth) * em}" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}">`)
  const page = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${inner}</svg>`
  // Fallback text was shaped above into paths, so rasterize the final page
  // without loading fonts.
  const png = new Resvg(page, { fitTo: { mode: 'original' }, font: { loadSystemFonts: false } }).render().asPng()

  const file = path.join(request.outDir, `${item.key}.png`)
  fs.writeFileSync(file, png)
  return { key: item.key, file, columns, rows }
}

fs.mkdirSync(request.outDir, { recursive: true })
const results = []
for (const item of request.items) {
  let result
  try {
    result = await render(item)
  } catch (error) {
    result = { key: item.key, error: String(error?.message ?? error).split('\n')[0].slice(0, 200) }
  }
  fs.writeFileSync(path.join(request.outDir, `${item.key}.json`), JSON.stringify(result))
  results.push(result)
}
process.stdout.write(JSON.stringify({ results }))
