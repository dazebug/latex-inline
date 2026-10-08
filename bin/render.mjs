// Renders TeX formulas to PNGs sized to whole terminal cells: MathJax lays
// the formula out as SVG and resvg rasterizes it. MathJax's viewBox can omit
// ink from fixed-metric fallback text and overhanging italic math glyphs.
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

const request = JSON.parse(fs.readFileSync(0, 'utf8'))

await MathJax.init({
  loader: { load: ['input/tex', 'output/svg'], paths: { mathjax: path.dirname(require.resolve('mathjax/package.json')) } },
  // An unknown command fails the formula, which the mod then shows as source.
  tex: { packages: { '[-]': ['noundefined'] }, formatError: (_jax, error) => { throw error } },
  // MathJax 4 splits inline math into one <svg> per breakable piece so a
  // page can wrap it; a picture is one piece.
  output: { font: `mathjax-${request.fontFamily}`, fontCache: 'local', linebreaks: { inline: false } },
})
const adaptor = MathJax.startup.adaptor

async function render(item) {
  const node = await MathJax.tex2svgPromise(item.tex, { display: Boolean(item.display) })
  const mathSvg = adaptor.serializeXML(adaptor.firstChild(node)).replaceAll('currentColor', request.color)
  // The viewBox is in thousandths of an em, with the baseline at y = 0.
  const [boxMinX, boxMinY, boxWidth, boxHeight] = /viewBox="([^"]+)"/.exec(mathSvg)[1].split(' ').map(Number)
  const boxMaxX = boxMinX + boxWidth
  const boxMaxY = boxMinY + boxHeight
  const hasText = mathSvg.includes('<text')
  let font = { loadSystemFonts: false }
  if (hasText) {
    const [file, family] = textFont ?? [undefined, undefined]
    font = file
      ? { loadSystemFonts: false, fontFiles: [file], defaultFontFamily: family, serifFamily: family, sansSerifFamily: family }
      : { loadSystemFonts: true }
  }

  // MathJax glyphs are paths; only fallback <text> needs a font.
  const shaped = new Resvg(mathSvg, { fitTo: { mode: 'original' }, font }).toString()
  // Resvg bounds ignore clips, so hide clipped groups in this copy. Their
  // cut ink stays inside MathJax's box. Font metrics can differ from
  // outlines by less than one unit, so those edges stay unchanged.
  const measuringSvg = shaped.replace(/<g\b(?=[^>]*\bclip-path=)/g, '<g display="none"')
  const inkBox = new Resvg(measuringSvg, { font: { loadSystemFonts: false } }).getBBox()
  const svg = hasText ? shaped : mathSvg

  const minX = inkBox && boxMinX - inkBox.x > 1 ? inkBox.x : boxMinX
  const minY = inkBox && boxMinY - inkBox.y > 1 ? inkBox.y : boxMinY
  const maxX = inkBox && inkBox.x + inkBox.width - boxMaxX > 1 ? inkBox.x + inkBox.width : boxMaxX
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
      scale = Math.min(1, (row + base) / (ascent * full), (2 * row - base) / (depth * full))
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
