import type { EngineInterface, Register } from 'claude-code'

import { glueTokens, parseBlocks, splitMarkdown, type Token } from './parse'
import { cellWidth, inkFor, mathStyle, type Ink, type MathStyle } from './support'
import { unicodeMath } from './unicode'

// Part of every cache key: bump it when bin/render.mjs draws differently.
const VERSION = 8
// Pixels per terminal row in the pictures; the terminal scales each picture
// to its cells, so this only sets how sharp they are.
const ROW_PX = 64
// The most text one Markdown element draws.
const MARKDOWN_LIMIT = 10_000

// Added to the system prompt where the mod can draw, so Claude writes math
// the way the parser reads it.
const MATH_INSTRUCTION = [
  '# Math in replies',
  'This terminal typesets TeX math in your replies (the latex-inline plugin draws it as pictures with MathJax).',
  'Write every formula and mathematical symbol in LaTeX: inline math as $...$ and display math as $$...$$ in a paragraph of its own, with blank lines before and after.',
  'Put no space right after the opening $ or right before the closing $. Do not write Unicode symbols such as α, ² or ≤ in place of LaTeX.',
  'Math inside tables, headings and block quotes is written as Unicode text instead of drawn, and math in code spans and code blocks is left as written: keep formulas in paragraphs and list items where you can, and put dollar amounts and shell variables in code spans so they are not read as math.',
  'Move long formulas and stacked fractions to display math. AMS environments such as aligned, cases and pmatrix work, and \\text{} takes any script.',
].join('\n')

type Picture = { file: string; columns: number; rows: number }
type Entry = Picture | { error: string }
type Job = { tex: string; display: boolean }
type Options = Readonly<Record<string, unknown>>

const entries = new Map<string, Entry>()
const queue = new Map<string, Job>()
// Keys the running render process holds, so a redraw meanwhile does not queue them again.
const inflight = new Set<string>()
let isRendering = false

// The picture geometry render.mjs draws to: the terminal font's cell (height
// over width, the baseline's place down the cell, the cell height in ems),
// worked out from the terminal's font at session start or taken from the
// user's settings, and the formula sizes in ems of that font. Formulas are
// never shrunk to fit one row (inlineShrinkLimit 1): one that overflows takes
// three rows, so every formula has the same size.
let style = {
  rowPx: ROW_PX,
  cellRatio: 2.125,
  baseline: 0.765,
  lineEm: 1.308,
  mathScale: 1.62,
  inlineShrinkLimit: 1,
  displayScale: 2.18,
  fontFamily: 'fira',
}
let config = { node: 'node', cacheDir: '', style: 'off' as MathStyle, teach: true, ink: inkFor(undefined, 'auto') as Ink }
// What bin/font-metrics.mjs made of the terminal's font, for /latex-inline.
let fontReport = 'not looked up'

function numberOption(options: Options, key: string, fallback: number): number {
  const value = options[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringOption(options: Options, key: string, fallback: string): string {
  const value = options[key]
  return typeof value === 'string' && value !== '' ? value : fallback
}

// cyrb53: a short stable key for the cache file names.
function keyOf(job: Job): string {
  const s = `${VERSION}|${JSON.stringify(style)}|${config.ink.math}|${job.display ? 'd' : 'i'}|${job.tex}`
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
}

type FontAnswer =
  | { ok: true; family: string; file?: string; size: number; cell_aspect: number; baseline: number; line_height: number }
  | { ok: false; reason: string }

// Reads the cell geometry off the terminal's configured font and puts it in
// `style`; on any failure the settings' numbers stay.
async function detectFont($: EngineInterface, terminal: string): Promise<void> {
  try {
    const { exitCode, stdout, stderr } = await $.process.run([config.node, `${$.plugin.root}/bin/font-metrics.mjs`], {
      stdin: JSON.stringify({ terminal }),
      timeoutMs: 10_000,
    })
    if (exitCode !== 0) {
      fontReport = `lookup failed: ${stderr.trim().split('\n').pop() ?? `exit ${exitCode}`}`
      return
    }
    const answer = JSON.parse(stdout) as FontAnswer
    if (!answer.ok) {
      fontReport = `not found (${answer.reason}); using the settings`
      return
    }
    style = { ...style, cellRatio: answer.cell_aspect, baseline: answer.baseline, lineEm: answer.line_height }
    fontReport = `${answer.family} ${answer.size}pt${answer.file ? ` (${answer.file})` : ''}`
  } catch (error) {
    fontReport = `lookup failed: ${String(error)}`
  }
}

function isPicture(entry: Entry | undefined): entry is Picture {
  return entry !== undefined && 'file' in entry
}

// How many rows the first wrapped line of a flow takes, found by laying the
// tokens out the way flex wrap does; the reply's bullet goes on its text row.
function firstLineRows(boxes: { columns: number; rows: number }[], width: number): number {
  let used = 0
  let rows = 1
  for (const box of boxes) {
    if (used > 0 && used + box.columns > width) break
    used += box.columns
    rows = Math.max(rows, box.rows)
  }
  return rows
}

// Finds a formula's picture in memory or in the on-disk cache, and queues it
// for rendering when neither has it.
async function lookup($: EngineInterface, job: Job): Promise<Entry | undefined> {
  const key = keyOf(job)
  const known = entries.get(key)
  if (known !== undefined || queue.has(key) || inflight.has(key)) return known
  const sidecar = `${config.cacheDir}/${key}.json`
  try {
    if (await $.fs.exists(sidecar)) {
      const entry = JSON.parse(await $.fs.read(sidecar)) as Entry
      entries.set(key, entry)
      return entry
    }
  } catch {
    // An unreadable cache entry is rendered again.
  }
  queue.set(key, job)
  return undefined
}

// Renders every queued formula in one process, then redraws so the pictures
// replace the source text drawn meanwhile. A failed process is kept in memory
// only, so the next session tries again.
async function drain($: EngineInterface): Promise<void> {
  if (isRendering || queue.size === 0) return
  isRendering = true
  const items = [...queue].map(([key, job]) => ({ key, ...job }))
  queue.clear()
  for (const item of items) inflight.add(item.key)
  try {
    const { exitCode, stdout, stderr } = await $.process.run([config.node, `${$.plugin.root}/bin/render.mjs`], {
      stdin: JSON.stringify({ items, outDir: config.cacheDir, color: config.ink.math, ...style }),
      timeoutMs: 60_000,
    })
    if (exitCode === 0) {
      const { results } = JSON.parse(stdout) as { results: ({ key: string } & Entry)[] }
      for (const result of results) entries.set(result.key, result)
    } else {
      const reason = stderr.trim().split('\n').pop() ?? `exit ${exitCode}`
      for (const item of items) entries.set(item.key, { error: reason })
    }
  } catch (error) {
    for (const item of items) entries.set(item.key, { error: String(error) })
  } finally {
    for (const item of items) inflight.delete(item.key)
    isRendering = false
  }
  $.ui.invalidate('ui.render')
}

// Replies converted for the text style, by width and text: every redraw
// draws a reply again.
const converted = new Map<string, string>()

function unicodeReply(text: string, width: number | undefined): string {
  if (!text.includes('$') && !text.includes('\\(') && !text.includes('\\[')) return text
  const key = `${width ?? ''}|${text}`
  const known = converted.get(key)
  if (known !== undefined) return known
  const result = unicodeMath(text, width)
  const oldest = converted.keys().next().value
  if (converted.size >= 200 && oldest !== undefined) converted.delete(oldest)
  converted.set(key, result)
  return result
}

export const register: Register = (on, options) => {
  style = {
    ...style,
    cellRatio: numberOption(options, 'cell_aspect', style.cellRatio),
    baseline: numberOption(options, 'baseline', style.baseline),
    lineEm: numberOption(options, 'line_height', style.lineEm),
    mathScale: numberOption(options, 'math_scale', style.mathScale),
    displayScale: numberOption(options, 'display_scale', style.displayScale),
  }

  on('session.start', async ($, e, next) => {
    const env = {
      TERM_PROGRAM: await $.env.get('TERM_PROGRAM'),
      TERM: await $.env.get('TERM'),
      KITTY_WINDOW_ID: await $.env.get('KITTY_WINDOW_ID'),
      TMUX: await $.env.get('TMUX'),
    }
    const settings = (await $.settings.read()) as { theme?: unknown }
    const cacheHome = (await $.env.get('XDG_CACHE_HOME')) ?? `${(await $.env.get('HOME')) ?? ''}/.cache`
    config = {
      node: stringOption(options, 'node_path', 'node'),
      cacheDir: `${cacheHome}/latex-inline/v${VERSION}`,
      style: mathStyle(env, stringOption(options, 'mode', 'auto')),
      teach: options.teach_claude !== false,
      ink: inkFor(typeof settings.theme === 'string' ? settings.theme : undefined, stringOption(options, 'color', 'auto')),
    }
    fontReport = 'set by hand (font_metrics is manual)'
    if (config.style === 'pictures' && stringOption(options, 'font_metrics', 'auto') === 'auto') {
      const isGhostty = env.TERM_PROGRAM === 'ghostty' || env.TERM === 'xterm-ghostty'
      const isKitty = Boolean(env.TERM?.includes('kitty')) || Boolean(env.KITTY_WINDOW_ID)
      if (isGhostty || isKitty) await detectFont($, isGhostty ? 'ghostty' : 'kitty')
      else fontReport = 'no font rules for this terminal; using the settings'
    }
    if (config.style === 'pictures') {
      $.clock.every(200, () => {
        void drain($)
      })
    }
    await $.command.register({
      name: 'latex-inline',
      description: 'Show whether latex-inline draws math here, and the font geometry it uses',
    })
    return next(e)
  })

  on('command.run', { command: 'latex-inline' }, async () => {
    if (config.style === 'off') return { text: 'Math: left as LaTeX (mode is off)' }
    if (config.style === 'text') {
      const why = stringOption(options, 'mode', 'auto') === 'text' ? 'mode is text' : 'this terminal shows no kitty-graphics pictures'
      return { text: `Math: written as Unicode text (${why})` }
    }
    const lines = [
      'Math: drawn as pictures',
      `Terminal font: ${fontReport}`,
      `Cell: height/width ${style.cellRatio.toFixed(3)}, baseline at ${style.baseline.toFixed(3)} of the height, ${style.lineEm.toFixed(3)} em tall`,
      `Sizes: inline ${style.mathScale} em, display ${style.displayScale} em`,
      `Pictures: ${config.cacheDir}`,
    ]
    return { text: lines.join('\n') }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (config.style !== 'pictures' || !config.teach || !e.surfaces.includes('terminal')) return composed
    return { sections: [...composed.sections, { id: 'latex-inline:math', text: MATH_INSTRUCTION, scope: 'session' as const }] }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || config.style === 'off') return next(e)
    const width = e.viewport === undefined ? undefined : e.viewport.columns - 2
    // Math no picture reaches is written as Unicode text: all of it in the
    // text style, and in tables, headings and block quotes in the picture one.
    const asUnicode = () => {
      const text = unicodeReply(e.props.text, width)
      return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text } })
    }
    if (config.style === 'text') return asUnicode()
    const blocks = parseBlocks(e.props.text)
    if (!blocks.some(block => block.kind !== 'markdown')) return asUnicode()

    // A markdown block too long for one Markdown element is drawn in pieces;
    // one that cannot be cut leaves the whole reply to the engine, in Unicode.
    const markdownPieces = new Map<number, string[]>()
    for (const [index, block] of blocks.entries()) {
      if (block.kind !== 'markdown') continue
      const pieces = splitMarkdown(unicodeMath(block.text, width), MARKDOWN_LIMIT)
      if (pieces === null) return asUnicode()
      markdownPieces.set(index, pieces)
    }

    const pictures = new Map<string, Entry | undefined>()
    const jobs: Job[] = []
    for (const block of blocks) {
      if (block.kind === 'display') jobs.push({ tex: block.tex, display: true })
      const tokens = block.kind === 'para' ? block.tokens : block.kind === 'list' ? block.items.flatMap(item => item.tokens) : []
      for (const token of tokens) if (token.kind === 'math') jobs.push({ tex: token.tex, display: false })
    }
    for (const job of jobs) {
      const key = keyOf(job)
      if (!pictures.has(key)) pictures.set(key, await lookup($, job))
    }

    const { Box, Image, Markdown, Text } = $.ui.resolve(e)
    let imageCount = 0

    // A formula without a picture, still rendering or failed, shows its source dimmed.
    const picture = (job: Job, fallback: string) => {
      const entry = pictures.get(keyOf(job))
      if (!isPicture(entry)) return <Text dimColor>{fallback}</Text>
      imageCount += 1
      return (
        <Image
          key={`m${imageCount}`}
          source={{ file: entry.file, format: 'png' }}
          columns={entry.columns}
          rows={entry.rows}
          alt={job.tex}
        />
      )
    }

    const word = (token: Token) => {
      if (token.kind === 'math') return picture({ tex: token.tex, display: false }, `$${token.tex}$`)
      if (token.kind === 'code') return <Text color={config.ink.code}>{token.text}</Text>
      return <Text bold={token.bold === true}>{token.text}</Text>
    }

    // One flex line per wrapped row; centering keeps the baselines level
    // because every picture is an odd number of rows with its baseline in the middle row.
    // Tokens with no space between them wrap as one item, so a period or
    // particle stays on the formula's line.
    const flow = (tokens: Token[]) => (
      <Box flexDirection="row" flexWrap="wrap" alignItems="center" flexShrink={1}>
        {glueTokens(tokens).map(group =>
          group.length === 1 && group[0] ? (
            word(group[0])
          ) : (
            <Box flexDirection="row" alignItems="center" flexShrink={0}>
              {group.map(word)}
            </Box>
          ),
        )}
      </Box>
    )

    const boxOf = (token: Token) => {
      if (token.kind !== 'math') return { columns: cellWidth(token.text), rows: 1 }
      const entry = pictures.get(keyOf({ tex: token.tex, display: false }))
      return isPicture(entry) ? entry : { columns: cellWidth(`$${token.tex}$`), rows: 1 }
    }
    const groupBoxes = (tokens: Token[]) =>
      glueTokens(tokens).map(group => {
        const boxes = group.map(boxOf)
        return { columns: boxes.reduce((sum, box) => sum + box.columns, 0), rows: Math.max(1, ...boxes.map(box => box.rows)) }
      })
    const lineWidth = width ?? 78
    const first = blocks[0]
    let firstRows = 1
    if (first?.kind === 'para') firstRows = firstLineRows(groupBoxes(first.tokens), lineWidth)
    if (first?.kind === 'list' && first.items[0]) {
      const item = first.items[0]
      firstRows = firstLineRows(groupBoxes(item.tokens), lineWidth - cellWidth(item.prefix))
    }
    if (first?.kind === 'display') {
      const entry = pictures.get(keyOf({ tex: first.tex, display: true }))
      firstRows = isPicture(entry) ? entry.rows : 1
    }
    const bullet = `${'\n'.repeat(Math.floor((firstRows - 1) / 2))}⏺`

    // Replacing the drawing drops the engine's gutter, so draw the reply's
    // bullet (first block only) and its two-column indent here. The last
    // column stays empty: a line that fills it spills its final character
    // onto the next row.
    return (
      <Box flexDirection="row" paddingRight={1}>
        <Box width={2} flexShrink={0}>
          <Text>{e.props.isFirstOfReply ? bullet : ' '}</Text>
        </Box>
        <Box flexDirection="column" gap={1} flexShrink={1}>
          {blocks.flatMap((block, index) => {
            if (block.kind === 'markdown') return (markdownPieces.get(index) ?? []).map(text => <Markdown text={text} />)
            if (block.kind === 'para') return [flow(block.tokens)]
            if (block.kind === 'display') {
              return [
                <Box flexDirection="row" justifyContent="center">
                  {picture({ tex: block.tex, display: true }, `$$${block.tex}$$`)}
                </Box>,
              ]
            }
            return [
              <Box flexDirection="column">
                {block.items.map(item => (
                  <Box flexDirection="row" alignItems="center">
                    <Text>{item.prefix}</Text>
                    {flow(item.tokens)}
                  </Box>
                ))}
              </Box>,
            ]
          })}
        </Box>
      </Box>
    )
  })
}
