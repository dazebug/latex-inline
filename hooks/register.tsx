import type { EngineInterface, Register, RenderElement } from 'claude-code'

import { copyAsLatex, copyWatcher, shownOf, type Selected, type Shown } from './copy'
import { glueTokens, parseBlocks, splitMarkdown, splitMarkdownRuns, type Block, type Token } from './parse'
import { cellWidth, inkFor, mathStyle, padCells, wrapWords, type Ink, type MathStyle } from './support'
import { readTips, type Tipped } from './tips'
import { plainOf, unicodeMath } from './unicode'

// Part of every cache key: bump it when bin/render.mjs draws differently.
const VERSION = 10
// Pixels per terminal row in the pictures; the terminal scales each picture
// to its cells, so this only sets how sharp they are.
const ROW_PX = 64
// The most text one Markdown element draws.
const MARKDOWN_LIMIT = 10_000
// The widest a tooltip card gets, in cells.
const CARD_COLUMNS = 60

// Added to the system prompt where the mod can draw, so Claude writes math
// the way the parser reads it.
const MATH_INSTRUCTION = [
  '# Math in replies',
  'This terminal typesets TeX math in your replies (the latex-inline plugin draws it as pictures with MathJax).',
  'Write every formula and mathematical symbol in LaTeX: inline math as $...$ and display math as $$...$$ in a paragraph of its own, with blank lines before and after.',
  'Put no space right after the opening $ or right before the closing $. Do not write Unicode symbols such as α, ² or ≤ in place of LaTeX.',
  'Math inside tables, headings and block quotes is written as Unicode text instead of drawn, and math in code spans and code blocks is left as written: keep formulas in paragraphs and list items where you can, and put dollar amounts and shell variables in code spans so they are not read as math.',
  'Move long formulas and stacked fractions to display math. AMS environments such as aligned, cases and pmatrix work, and \\text{} takes any script.',
  'To say what a symbol stands for without crowding the sentence, write it as \\texttip{symbol}{a short explanation in words}, or \\mathtip{symbol}{a formula}: the explanation shows in a card while the pointer rests on the formula, in fullscreen mode only, so keep in the text what the reader needs.',
  'Only math is drawn from LaTeX: write the prose around it as Markdown, without LaTeX commands such as \\enquote{}, \\textbf{} or \\emph{}, which would show as written.',
  'Except in a side question (/btw): when a message says it is a side question from the user, your answer is shown where the plugin cannot draw, so write its math as Unicode text, such as α, x² or ≤, and no $ or LaTeX commands.',
].join('\n')

type Picture = { file: string; columns: number; rows: number }
type Entry = Picture | { error: string }
type Job = { tex: string; display: boolean }
// Where a formula is drawn: the columns of the flow or block it is in and, in
// a flow, the column it starts at; a display formula is centered.
type Place = { columns: number; x?: number }
type ListBlock = Extract<Block, { kind: 'list' }>
type RenderBlock = Exclude<Block, { kind: 'markdown' }> | { kind: 'prose'; text: string; joined?: true } | { kind: 'code'; text: string }
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
let config = { node: 'node', cacheDir: '', style: 'off' as MathStyle, teach: true, copyLatex: true, ink: inkFor(undefined, 'auto') as Ink }
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

// cyrb53 by bryc, public domain (linked in the README): a short stable key
// for the cache file names.
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

// The job a formula's picture is drawn by: its TeX with each tooltip's
// explanation taken out, which the mod shows itself (see tips.ts).
function jobOf(tex: string, display: boolean): Job {
  return { tex: readTips(tex).tex, display }
}

// Where each item of a flow starts on its line, laid out as flex wrap does:
// an item that would pass `width` starts the next line, unless it is first.
function lineStarts(boxes: { columns: number }[], width: number): number[] {
  let used = 0
  return boxes.map(box => {
    if (used > 0 && used + box.columns > width) used = 0
    const start = used
    used += box.columns
    return start
  })
}

// How many rows the first wrapped line of a flow takes, found by laying the
// tokens out the way flex wrap does; the reply's bullet and a list item's
// number go on its text row.
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

// Moves a mark drawn at the top of a line `rows` tall down to its text row,
// the middle one, where a picture keeps its baseline.
function onTextRow(mark: string, rows: number): string {
  return `${'\n'.repeat(Math.floor((rows - 1) / 2))}${mark}`
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

// The commands that print the clipboard, tried in turn: macOS's, then
// Wayland's and X11's. The first that runs is kept; when none of them can
// start, the clipboard is not read again this session.
const CLIPBOARD_READERS: readonly (readonly string[])[] = [
  ['pbpaste'],
  ['wl-paste', '--no-newline'],
  ['xclip', '-selection', 'clipboard', '-o'],
  ['xsel', '--clipboard', '--output'],
]
let clipboardReader: readonly string[] | null | undefined

async function readClipboard($: EngineInterface): Promise<string | undefined> {
  if (clipboardReader === null) return undefined
  let hasStarted = false
  for (const argv of clipboardReader ? [clipboardReader] : CLIPBOARD_READERS) {
    try {
      const { exitCode, stdout } = await $.process.run(argv, { timeoutMs: 2_000 })
      hasStarted = true
      if (exitCode !== 0) continue
      clipboardReader = argv
      return stdout
    } catch {
      // Not on this machine: try the next.
    }
  }
  if (!hasStarted) clipboardReader = null
  return undefined
}

type Portion = { text: string; width: number | undefined; isFirstOfReply: boolean }

// The replies drawn here with pictures, by the id a selection names its row
// by, so a copy of one can be read back as the reply: the latest 100, each as
// its latest 16 draws in the order drawn, one object kept per distinct draw.
//
// Keep the draws, not one text per reply: a mod above may split a reply
// around a diagram and hand each side on under the reply's id, and nothing in
// a render tells a portion from the one before it drawn again, when the two
// are equal, or grown as the reply streams in, when one starts with the other.
const drawnReplies = new Map<string, Portion[]>()

function keepDrawn(requestId: string, portion: Portion): void {
  const draws = drawnReplies.get(requestId) ?? []
  const same = draws.find(old => old.text === portion.text && old.width === portion.width && old.isFirstOfReply === portion.isFirstOfReply)
  draws.push(same ?? portion)
  if (draws.length > 16) draws.shift()
  drawnReplies.delete(requestId)
  drawnReplies.set(requestId, draws)
  const oldest = drawnReplies.keys().next().value
  if (drawnReplies.size > 100 && oldest !== undefined) drawnReplies.delete(oldest)
}

// The selection read as the reply's portions, in the order drawn. The flows
// of each portion are numbered past the last portion's, so the lines of two
// portions are never joined as one paragraph.
function readAs(text: string, portions: Portion[]): string | null {
  const sizeOf = (job: Job) => {
    const entry = entries.get(keyOf(jobOf(job.tex, job.display)))
    return isPicture(entry) ? entry : undefined
  }
  const shown: Shown[] = []
  let flows = 0
  for (const portion of portions) {
    const part = shownOf(parseBlocks(portion.text), sizeOf, portion.width, portion.isFirstOfReply)
    const base = flows
    for (const item of part) {
      if (item.flow === undefined) shown.push(item)
      else {
        shown.push({ ...item, flow: base + item.flow })
        flows = Math.max(flows, base + item.flow + 1)
      }
    }
  }
  return copyAsLatex(text, shown)
}

// The selection's text with its pictures back as LaTeX, or null when it is
// not one reply drawn here or does not read as it. It is read first as the
// distinct texts drawn that no other one starts with, each where it was last
// drawn: the reply as it stands once streamed in. When that fails, as every
// draw kept, so a portion drawn twice, or one starting with another, counts.
function latexOf(selected: Selected): string | null {
  const draws = selected.requestId === undefined ? undefined : drawnReplies.get(selected.requestId)
  if (draws === undefined) return null
  const latest = draws.filter(
    (draw, at) =>
      draws.every((other, later) => later <= at || other.text !== draw.text) &&
      !draws.some(other => other.text !== draw.text && other.text.startsWith(draw.text)),
  )
  return readAs(selected.text, latest) ?? (latest.length < draws.length ? readAs(selected.text, draws) : null)
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
      copyLatex: options.copy_latex !== false,
      ink: inkFor(typeof settings.theme === 'string' ? settings.theme : undefined, stringOption(options, 'color', 'auto')),
    }
    fontReport = 'set by hand (font_metrics is manual)'
    if (config.style === 'pictures' && stringOption(options, 'font_metrics', 'auto') !== 'manual') {
      const isGhostty = env.TERM_PROGRAM === 'ghostty' || env.TERM === 'xterm-ghostty'
      const isKitty = Boolean(env.TERM?.includes('kitty')) || Boolean(env.KITTY_WINDOW_ID)
      if (isGhostty || isKitty) await detectFont($, isGhostty ? 'ghostty' : 'kitty')
      else fontReport = 'no font rules for this terminal; using the settings'
    }
    if (config.style === 'pictures') {
      const watchCopy = config.copyLatex
        ? copyWatcher({
            selection: () => $.ui.selection(),
            readClipboard: () => readClipboard($),
            write: async text => {
              const { isCopied } = await $.ui.copy({ text, surface: 'terminal' })
              if (isCopied) $.ui.toast('Copied with the formulas as LaTeX')
              return isCopied
            },
            rewrite: latexOf,
            now: () => $.clock.now(),
          })
        : undefined
      $.clock.every(200, () => {
        void drain($)
        // A selection or clipboard that cannot be read leaves the copy as
        // Claude Code made it.
        if (watchCopy) void watchCopy().catch(() => undefined)
      })
    }
    await $.command.register({
      name: 'latex-inline',
      description: 'Show whether latex-inline draws math here, and the font geometry it uses',
    })
    // Draw the replies again now that the plugin is set up: one drawn before
    // this ran, as at a reload of the plugin's code, went on with its LaTeX
    // as written.
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('command.run', { command: 'latex-inline' }, async ($, e) => {
    if (config.style === 'off') return { text: 'Math: left as LaTeX (mode is off)' }
    if (config.style === 'text') {
      const why = stringOption(options, 'mode', 'auto') === 'text' ? 'mode is text' : 'this terminal shows no kitty-graphics pictures'
      return { text: `Math: written as Unicode text (${why})` }
    }
    const copying = !config.copyLatex
      ? 'as picture placeholders (copy_latex is off)'
      : clipboardReader === null
        ? 'as picture placeholders (no pbpaste, wl-paste, xclip or xsel to read the clipboard with)'
        : 'with the formulas as LaTeX, for a selection in fullscreen mode'
    const tooltips = e.presentation.isFullscreen ? 'in a card while the pointer rests on the formula' : 'not shown outside fullscreen mode'
    const lines = [
      'Math: drawn as pictures',
      `Copying: ${copying}`,
      `Tooltips: ${tooltips}`,
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

    // Do not pass prose on to the next hook: Claude Code's message drawing
    // reads text that starts with a usage-notice phrase ("You've used",
    // "You're close to") as a notice, so a paragraph passed on by itself
    // could turn into one. Only fenced code blocks that start a line go on,
    // one at a time, so a mod below such as Mermaid Inline can draw them. A
    // prose block too long for one Markdown element is drawn in pieces; one
    // that cannot be cut leaves the whole reply to the engine, in Unicode.
    const renderBlocks: RenderBlock[] = []
    for (const block of blocks) {
      if (block.kind !== 'markdown') {
        renderBlocks.push(block)
        continue
      }
      let joined = block.joined === true
      for (const run of splitMarkdownRuns(block.text)) {
        if (run.kind === 'code') {
          renderBlocks.push({ kind: 'code', text: run.text })
          joined = false
          continue
        }
        const pieces = splitMarkdown(unicodeMath(run.text, width), MARKDOWN_LIMIT)
        if (pieces === null) return asUnicode()
        for (const text of pieces) {
          renderBlocks.push(joined ? { kind: 'prose', text, joined } : { kind: 'prose', text })
          joined = false
        }
      }
    }

    // The columns a flow gets: the reply's width less the last column, which
    // the rows below leave empty (paddingRight).
    const lineWidth = (width ?? 78) - 1
    // Markdown inside a list item, Unicode for its column and in pieces, as
    // the reply's own Markdown is; one that cannot be cut leaves the reply to
    // the engine.
    const nested = new Map<Block, string[]>()
    const cut = (block: Block, columns: number | undefined): boolean => {
      if (block.kind === 'markdown') {
        const pieces = splitMarkdown(unicodeMath(block.text, columns), MARKDOWN_LIMIT)
        if (pieces !== null) nested.set(block, pieces)
        return pieces !== null
      }
      if (block.kind !== 'list') return true
      return block.items.every(item => (item.blocks ?? []).every(child => cut(child, columns === undefined ? undefined : columns - cellWidth(item.prefix))))
    }
    if (!blocks.every(block => block.kind === 'markdown' || cut(block, width))) return asUnicode()
    keepDrawn(e.requestId, { text: e.props.text, width, isFirstOfReply: e.props.isFirstOfReply })

    // Tooltip cards only where the pointer is followed: on the main screen
    // no hover ever shows one.
    const hasCards = e.viewport?.isFullscreen === true
    const pictures = new Map<string, Entry | undefined>()
    const jobs: Job[] = []
    const formula = (tex: string, display: boolean) => {
      jobs.push(jobOf(tex, display))
      if (!hasCards) return
      for (const tip of readTips(tex).tips) if ('tex' in tip && tip.tex !== '') jobs.push(jobOf(tip.tex, false))
    }
    const collect = (block: Block) => {
      if (block.kind === 'display') formula(block.tex, true)
      const tokens = block.kind === 'para' ? block.tokens : block.kind === 'list' ? block.items.flatMap(item => item.tokens) : []
      for (const token of tokens) if (token.kind === 'math') formula(token.tex, false)
      if (block.kind === 'list') for (const item of block.items) for (const child of item.blocks ?? []) collect(child)
    }
    for (const block of blocks) collect(block)
    for (const job of jobs) {
      const key = keyOf(job)
      if (!pictures.has(key)) pictures.set(key, await lookup($, job))
    }

    const { Box, Image, Markdown, Text } = $.ui.resolve(e)

    // The card a formula's tooltips show in while the pointer rests on its
    // picture: each explanation beside the part it explains, with no part for
    // one that explains the whole formula, words wrapped to the room the
    // formula has and a formula drawn as a picture. It goes above the picture,
    // out of the flow, moved left as far as it must to end within the room.
    // Every cell it covers is a character it draws: padding would leave the
    // text beneath it showing through. None when no tooltip has anything to say.
    const card = (tipped: Tipped, size: Picture, place: Place) => {
      type Item = { label: string; text: string } | { label: string; tex: string; entry: Picture }
      const items = tipped.tips.flatMap((tip, k): Item[] => {
        const label = k === 0 && tipped.isWhole ? '' : (plainOf(tip.base) ?? tip.base)
        if ('text' in tip) return tip.text === '' ? [] : [{ label, text: tip.text }]
        if (tip.tex === '') return []
        const entry = pictures.get(keyOf(jobOf(tip.tex, false)))
        return [isPicture(entry) ? { label, tex: tip.tex, entry } : { label, text: plainOf(tip.tex) ?? tip.tex }]
      })
      if (items.length === 0) return undefined
      const labelWidth = Math.max(0, ...items.map(item => cellWidth(item.label)))
      const gap = labelWidth > 0 ? 2 : 0
      const room = Math.max(1, Math.min(CARD_COLUMNS, place.columns) - 4 - labelWidth - gap)
      const bodies = items.map(item => ('entry' in item ? item : { label: item.label, lines: wrapWords(item.text, room) }))
      const bodyWidth = Math.max(0, ...bodies.map(body => ('entry' in body ? body.entry.columns : Math.max(0, ...body.lines.map(cellWidth)))))
      const head = (label: string) => ` ${padCells(label, labelWidth)}${' '.repeat(gap)}`
      let rows = 0
      const lines = bodies.flatMap(body => {
        if (!('entry' in body)) {
          rows += body.lines.length
          return body.lines.map((line, n) => <Text>{`${head(n === 0 ? body.label : '')}${padCells(line, bodyWidth)} `}</Text>)
        }
        const { entry } = body
        rows += entry.rows
        const middle = Math.floor((entry.rows - 1) / 2)
        const column = (text: (row: number) => string) => Array.from({ length: entry.rows }, (_, row) => text(row)).join('\n')
        return [
          <Box flexDirection="row">
            <Text>{column(row => head(row === middle ? body.label : ''))}</Text>
            <Image source={{ file: entry.file, format: 'png' }} columns={entry.columns} rows={entry.rows} alt={body.tex} />
            <Text>{column(() => ' '.repeat(bodyWidth - entry.columns + 1))}</Text>
          </Box>,
        ]
      })
      const width = labelWidth + gap + bodyWidth + 4
      const x = place.x ?? Math.max(0, Math.floor((place.columns - size.columns) / 2))
      return (
        <Box
          position="absolute"
          top={-(rows + 2)}
          left={Math.max(-x, Math.min(0, place.columns - x - width))}
          width={width}
          display="none"
          hover={{ display: 'flex' }}
          flexDirection="column"
          borderStyle="round"
          borderDimColor
        >
          {lines}
        </Box>
      )
    }

    // A formula without a picture, still rendering or failed, shows its
    // source dimmed. One with tooltips gets their card where the pointer is
    // followed, in a keyed Box around the picture: the hover's scope.
    let scopes = 0
    const picture = (tex: string, display: boolean, place: Place) => {
      const tipped = readTips(tex)
      const entry = pictures.get(keyOf({ tex: tipped.tex, display }))
      if (!isPicture(entry)) return <Text dimColor>{display ? `$$${tex}$$` : `$${tex}$`}</Text>
      // Give pictures no key: keys must be unique among the Images of one
      // tree, and an outer mod may put several of these drawings in one tree,
      // where a repeated key gets the whole tree rejected.
      const image = <Image source={{ file: entry.file, format: 'png' }} columns={entry.columns} rows={entry.rows} alt={tex} />
      const tips = hasCards && tipped.tips.length > 0 ? card(tipped, entry, place) : undefined
      if (tips === undefined) return image
      return (
        <Box key={`tip-${scopes++}`} flexShrink={0}>
          {image}
          {tips}
        </Box>
      )
    }

    const word = (token: Token, place: Place) => {
      if (token.kind === 'math') return picture(token.tex, false, place)
      if (token.kind === 'code') return <Text color={config.ink.code}>{token.text}</Text>
      return <Text bold={token.bold === true}>{token.text}</Text>
    }

    const boxOf = (token: Token) => {
      if (token.kind !== 'math') return { columns: cellWidth(token.text), rows: 1 }
      const entry = pictures.get(keyOf(jobOf(token.tex, false)))
      return isPicture(entry) ? entry : { columns: cellWidth(`$${token.tex}$`), rows: 1 }
    }
    const groupBox = (group: Token[]) => {
      const boxes = group.map(boxOf)
      return { columns: boxes.reduce((sum, box) => sum + box.columns, 0), rows: Math.max(1, ...boxes.map(box => box.rows)) }
    }
    const groupBoxes = (tokens: Token[]) => glueTokens(tokens).map(groupBox)

    // One flex line per wrapped row in `columns`; centering keeps the
    // baselines level because every picture is an odd number of rows with its
    // baseline in the middle row. Tokens with no space between them wrap as
    // one item, so a period or particle stays on the formula's line.
    const flow = (tokens: Token[], columns: number) => {
      const groups = glueTokens(tokens)
      const starts = lineStarts(groups.map(groupBox), columns)
      return (
        <Box flexDirection="row" flexWrap="wrap" alignItems="center" flexShrink={1}>
          {groups.map((group, g) => {
            let x = starts[g] ?? 0
            const words = group.map(token => {
              const drawn = word(token, { columns, x })
              x += boxOf(token).columns
              return drawn
            })
            return words.length === 1 && words[0] ? (
              words[0]
            ) : (
              <Box flexDirection="row" alignItems="center" flexShrink={0}>
                {words}
              </Box>
            )
          })}
        </Box>
      )
    }

    // A block of the reply, or one under a list item, drawn in the
    // `columns` it is placed in.
    const draw = (block: Block, columns: number): RenderElement => {
      if (block.kind === 'para') return flow(block.tokens, columns)
      if (block.kind === 'display') {
        return (
          <Box flexDirection="row" justifyContent="center">
            {picture(block.tex, true, { columns })}
          </Box>
        )
      }
      if (block.kind === 'list') return <Box flexDirection="column">{listRows(block, 0, 0)}</Box>
      const pieces = (nested.get(block) ?? []).map(text => <Markdown text={text} />)
      return pieces.length === 1 && pieces[0] ? pieces[0] : <Box flexDirection="column" gap={1}>{pieces}</Box>
    }

    // Keep a list's rows in one column however deep it goes, each indented to
    // its place, not a box per item: Claude Code refuses a drawing nested
    // deeper than 32 levels, and a box per item adds levels with every list in
    // a list. An item that starts with a block other than a paragraph has its
    // marker on a row of its own, as Claude Code draws it. The number is drawn
    // at the top of its row and moved down to the first line's text row:
    // centered against the whole item, it would drift into the middle of an
    // item that wraps onto several lines.
    const listRows = (block: ListBlock, indent: number, marginTop: number): RenderElement[] =>
      block.items.flatMap((item, index) => {
        const inner = indent + cellWidth(item.prefix)
        const rows = [
          <Box flexDirection="row" alignItems="flex-start" marginLeft={indent} marginTop={index === 0 ? marginTop : item.spaced ? 1 : 0}>
            <Text>{onTextRow(item.prefix, firstLineRows(groupBoxes(item.tokens), lineWidth - inner))}</Text>
            {flow(item.tokens, lineWidth - inner)}
          </Box>,
        ]
        for (const [place, child] of (item.blocks ?? []).entries()) {
          const top = child.joined || (place === 0 && item.tokens.length === 0) ? 0 : 1
          if (child.kind === 'list') rows.push(...listRows(child, inner, top))
          else rows.push(
            <Box flexDirection="column" marginLeft={inner} marginTop={top}>
              {draw(child, lineWidth - inner)}
            </Box>,
          )
        }
        return rows
      })

    const first = renderBlocks[0]
    let firstRows = 1
    if (first?.kind === 'para') firstRows = firstLineRows(groupBoxes(first.tokens), lineWidth)
    if (first?.kind === 'list' && first.items[0]) {
      const item = first.items[0]
      firstRows = firstLineRows(groupBoxes(item.tokens), lineWidth - cellWidth(item.prefix))
    }
    if (first?.kind === 'display') {
      const entry = pictures.get(keyOf(jobOf(first.tex, true)))
      firstRows = isPicture(entry) ? entry.rows : 1
    }
    const bullet = onTextRow('⏺', firstRows)

    // Replacing the drawing drops the engine's gutter, so the rows drawn here
    // carry the reply's bullet (first block only) and its two-column indent.
    // The last column stays empty: a line that fills it spills its final
    // character onto the next row.
    // Each part brings the blank row above it, as Claude Code's drawing of a
    // block does in the normal view, so whoever places it adds none. Where
    // Claude Code puts a message header above a reply instead, as in the ctrl+o
    // view, it leaves that row out, and a mod cannot tell those views apart.
    // Blocks with no blank line between them in the reply go in one column,
    // so the gap between parts puts no blank row between them.
    const rows: RenderElement[] = []
    let direct: RenderElement[][] = []
    let directIsFirst = false
    let isFirst = e.props.isFirstOfReply
    const addDirect = (element: RenderElement, joined: boolean) => {
      if (direct.length === 0) directIsFirst = isFirst
      const last = direct[direct.length - 1]
      if (joined && last) last.push(element)
      else direct.push([element])
      isFirst = false
    }
    const flushDirect = () => {
      if (direct.length === 0) return
      rows.push(
        <Box flexDirection="row" marginTop={1} paddingRight={1}>
          <Box width={2} flexShrink={0}>
            <Text>{directIsFirst ? bullet : ' '}</Text>
          </Box>
          <Box flexDirection="column" gap={1} flexGrow={1} flexShrink={1}>
            {direct.map(group => (group.length === 1 && group[0] ? group[0] : <Box flexDirection="column">{group}</Box>))}
          </Box>
        </Box>,
      )
      direct = []
    }

    for (const block of renderBlocks) {
      if (block.kind === 'code') {
        flushDirect()
        const drawn = await next({ ...e, props: { ...e.props, text: block.text, isFirstOfReply: isFirst } })
        // Claude Code draws the bullet column only for a block that opens the
        // reply, so a later block it draws gets an empty two-column gutter
        // here. A tree from a mod below brings its own gutter and blank row.
        if (drawn.type === 'engine' && !isFirst) {
          rows.push(
            <Box flexDirection="row">
              <Box width={2} flexShrink={0} />
              <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                {drawn}
              </Box>
            </Box>,
          )
        } else {
          rows.push(drawn)
        }
        isFirst = false
        continue
      }
      if (block.kind === 'prose') {
        addDirect(<Markdown text={block.text} />, block.joined === true)
        continue
      }
      addDirect(draw(block, lineWidth), block.joined === true)
    }
    flushDirect()
    return <Box flexDirection="column">{rows}</Box>
  })
}
