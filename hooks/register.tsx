import type { EngineInterface, Register } from 'claude-code'

import { parseBlocks, splitMarkdown, type Token } from './parse'
import { canDrawImages, inkFor, type Ink } from './support'

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
  'Math inside tables, headings, block quotes, code spans and code blocks is not drawn: keep formulas in paragraphs and list items, and put dollar amounts and shell variables in code spans so they are not read as math.',
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

// The picture geometry render.mjs draws to, from the user's settings: the
// terminal font's cell (height over width, the baseline's place down the
// cell, the cell height in ems) and the formula sizes in ems of that font.
// Formulas are never shrunk to fit one row (inlineShrinkLimit 1): one that
// overflows takes three rows, so every formula has the same size.
let style = {
  rowPx: ROW_PX,
  cellRatio: 2.2,
  baseline: 0.773,
  lineEm: 1.32,
  mathScale: 1.62,
  inlineShrinkLimit: 1,
  displayScale: 2.18,
  fontFamily: 'fira',
}
let config = { node: 'node', cacheDir: '', canDraw: false, teach: true, ink: inkFor(undefined, 'auto') as Ink }

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

function isPicture(entry: Entry | undefined): entry is Picture {
  return entry !== undefined && 'file' in entry
}

// Terminal cells a string takes: Hangul, CJK and emoji take two.
function cellWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    const isWide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe4f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x1f300 && c <= 0x1faff)
    width += isWide ? 2 : 1
  }
  return width
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
      canDraw: canDrawImages(env, stringOption(options, 'mode', 'auto')),
      teach: options.teach_claude !== false,
      ink: inkFor(typeof settings.theme === 'string' ? settings.theme : undefined, stringOption(options, 'color', 'auto')),
    }
    if (config.canDraw) {
      $.clock.every(200, () => {
        void drain($)
      })
    }
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!config.canDraw || !config.teach || !e.surfaces.includes('terminal')) return composed
    return { sections: [...composed.sections, { id: 'latex-inline:math', text: MATH_INSTRUCTION, scope: 'session' as const }] }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !config.canDraw) return next(e)
    const blocks = parseBlocks(e.props.text)
    if (!blocks.some(block => block.kind !== 'markdown')) return next(e)

    // A markdown block too long for one Markdown element is drawn in pieces;
    // one that cannot be cut leaves the whole reply to the engine.
    const markdownPieces = new Map<number, string[]>()
    for (const [index, block] of blocks.entries()) {
      if (block.kind !== 'markdown') continue
      const pieces = splitMarkdown(block.text, MARKDOWN_LIMIT)
      if (pieces === null) return next(e)
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
    const flow = (tokens: Token[]) => (
      <Box flexDirection="row" flexWrap="wrap" alignItems="center" flexShrink={1}>
        {tokens.map(word)}
      </Box>
    )

    const boxOf = (token: Token) => {
      if (token.kind !== 'math') return { columns: cellWidth(token.text), rows: 1 }
      const entry = pictures.get(keyOf({ tex: token.tex, display: false }))
      return isPicture(entry) ? entry : { columns: cellWidth(`$${token.tex}$`), rows: 1 }
    }
    const width = (e.viewport?.columns ?? 80) - 2
    const first = blocks[0]
    let firstRows = 1
    if (first?.kind === 'para') firstRows = firstLineRows(first.tokens.map(boxOf), width)
    if (first?.kind === 'list' && first.items[0]) {
      const item = first.items[0]
      firstRows = firstLineRows(item.tokens.map(boxOf), width - cellWidth(item.prefix))
    }
    if (first?.kind === 'display') {
      const entry = pictures.get(keyOf({ tex: first.tex, display: true }))
      firstRows = isPicture(entry) ? entry.rows : 1
    }
    const bullet = `${'\n'.repeat(Math.floor((firstRows - 1) / 2))}⏺`

    // Replacing the drawing drops the engine's gutter, so draw the reply's
    // bullet (first block only) and its two-column indent here.
    return (
      <Box flexDirection="row">
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
