import { splitMarkdownRuns, type Block, type Token } from './parse'
import { cellWidth } from './support'
import { unicodeMath } from './unicode'

// Kitty's row and column diacritics, in order. Claude Code writes each cell
// of a picture as U+10EEEE followed by the diacritic of the cell's row and
// that of its column, and a mouse selection copies those cells as they are.
export const DIACRITICS: readonly number[] = [
  0x0305, 0x030d, 0x030e, 0x0310, 0x0312, 0x033d, 0x033e, 0x033f, 0x0346, 0x034a, 0x034b, 0x034c,
  0x0350, 0x0351, 0x0352, 0x0357, 0x035b, 0x0363, 0x0364, 0x0365, 0x0366, 0x0367, 0x0368, 0x0369,
  0x036a, 0x036b, 0x036c, 0x036d, 0x036e, 0x036f, 0x0483, 0x0484, 0x0485, 0x0486, 0x0487, 0x0592,
  0x0593, 0x0594, 0x0595, 0x0597, 0x0598, 0x0599, 0x059c, 0x059d, 0x059e, 0x059f, 0x05a0, 0x05a1,
  0x05a8, 0x05a9, 0x05ab, 0x05ac, 0x05af, 0x05c4, 0x0610, 0x0611, 0x0612, 0x0613, 0x0614, 0x0615,
  0x0616, 0x0617, 0x0657, 0x0658, 0x0659, 0x065a, 0x065b, 0x065d, 0x065e, 0x06d6, 0x06d7, 0x06d8,
  0x06d9, 0x06da, 0x06db, 0x06dc, 0x06df, 0x06e0, 0x06e1, 0x06e2, 0x06e4, 0x06e7, 0x06e8, 0x06eb,
  0x06ec, 0x0730, 0x0732, 0x0733, 0x0735, 0x0736, 0x073a, 0x073d, 0x073f, 0x0740, 0x0741, 0x0743,
  0x0745, 0x0747, 0x0749, 0x074a, 0x07eb, 0x07ec, 0x07ed, 0x07ee, 0x07ef, 0x07f0, 0x07f1, 0x07f3,
  0x0816, 0x0817, 0x0818, 0x0819, 0x081b, 0x081c, 0x081d, 0x081e, 0x081f, 0x0820, 0x0821, 0x0822,
  0x0823, 0x0825, 0x0826, 0x0827, 0x0829, 0x082a, 0x082b, 0x082c, 0x082d, 0x0951, 0x0953, 0x0954,
  0x0f82, 0x0f83, 0x0f86, 0x0f87, 0x135d, 0x135e, 0x135f, 0x17dd, 0x193a, 0x1a17, 0x1a75, 0x1a76,
  0x1a77, 0x1a78, 0x1a79, 0x1a7a, 0x1a7b, 0x1a7c, 0x1b6b, 0x1b6d, 0x1b6e, 0x1b6f, 0x1b70, 0x1b71,
  0x1b72, 0x1b73, 0x1cd0, 0x1cd1, 0x1cd2, 0x1cda, 0x1cdb, 0x1ce0, 0x1dc0, 0x1dc1, 0x1dc3, 0x1dc4,
  0x1dc5, 0x1dc6, 0x1dc7, 0x1dc8, 0x1dc9, 0x1dcb, 0x1dcc, 0x1dd1, 0x1dd2, 0x1dd3, 0x1dd4, 0x1dd5,
  0x1dd6, 0x1dd7, 0x1dd8, 0x1dd9, 0x1dda, 0x1ddb, 0x1ddc, 0x1ddd, 0x1dde, 0x1ddf, 0x1de0, 0x1de1,
  0x1de2, 0x1de3, 0x1de4, 0x1de5, 0x1de6, 0x1dfe, 0x20d0, 0x20d1, 0x20d4, 0x20d5, 0x20d6, 0x20d7,
  0x20db, 0x20dc, 0x20e1, 0x20e7, 0x20e9, 0x20f0, 0x2cef, 0x2cf0, 0x2cf1, 0x2de0, 0x2de1, 0x2de2,
  0x2de3, 0x2de4, 0x2de5, 0x2de6, 0x2de7, 0x2de8, 0x2de9, 0x2dea, 0x2deb, 0x2dec, 0x2ded, 0x2dee,
  0x2def, 0x2df0, 0x2df1, 0x2df2, 0x2df3, 0x2df4, 0x2df5, 0x2df6, 0x2df7, 0x2df8, 0x2df9, 0x2dfa,
  0x2dfb, 0x2dfc, 0x2dfd, 0x2dfe, 0x2dff, 0xa66f, 0xa67c, 0xa67d, 0xa6f0, 0xa6f1, 0xa8e0, 0xa8e1,
  0xa8e2, 0xa8e3, 0xa8e4, 0xa8e5, 0xa8e6, 0xa8e7, 0xa8e8, 0xa8e9, 0xa8ea, 0xa8eb, 0xa8ec, 0xa8ed,
  0xa8ee, 0xa8ef, 0xa8f0, 0xa8f1, 0xaab0, 0xaab2, 0xaab3, 0xaab7, 0xaab8, 0xaabe, 0xaabf, 0xaac1,
  0xfe20, 0xfe21, 0xfe22, 0xfe23, 0xfe24, 0xfe25, 0xfe26, 0x10a0f, 0x10a38, 0x1d185, 0x1d186, 0x1d187,
  0x1d188, 0x1d189, 0x1d1aa, 0x1d1ab, 0x1d1ac, 0x1d1ad, 0x1d242, 0x1d243, 0x1d244,
]

const PLACEHOLDER = String.fromCodePoint(0x10eeee)
const INDEX = new Map(DIACRITICS.map((code, index) => [code, index]))
const MARK = /\p{M}/u
const SPACE = /^\s+$/u
// The reply's bullet, which the mod draws in its gutter on the first line's
// text row; Claude Code's own gutter is left out of a selection.
const BULLET = '⏺'

// The most cells one alignment fills, a byte each: about a selection of four
// thousand characters across a reply of five thousand. A bigger one is left
// as copied.
const MAX_CELLS = 20_000_000

export type Size = { columns: number; rows: number }

// What a reply shows, in reading order: a character, one grapheme, or a
// formula drawn as a picture, with the LaTeX it is copied as and whether it is
// a display formula, alone on its rows. `flow` numbers the paragraph or item
// text it is part of, which the mod wraps into lines itself; `bare`: Claude
// Code draws its line without the mod's gutter.
export type Shown =
  | { kind: 'char'; text: string; flow?: number; bare?: true }
  | { kind: 'picture'; latex: string; display: boolean; columns: number; rows: number; flow?: number }

type Picture = Extract<Shown, { kind: 'picture' }>

function graphemes(text: string): string[] {
  const out: string[] = []
  for (const character of text) {
    if (out.length > 0 && MARK.test(character)) out[out.length - 1] += character
    else out.push(character)
  }
  return out
}

// A fenced code block as Claude Code draws it, without its fences.
function codeOf(text: string): string {
  const lines = text.split('\n').slice(1)
  if (/^[ \t]*(?:`{3,}|~{3,})[ \t]*$/.test(lines[lines.length - 1] ?? '')) lines.pop()
  return lines.join('\n')
}

// What a reply drawn as `blocks` shows, in the order the mod draws it.
// `sizeOf` gives the picture a formula has; one without is drawn as its
// LaTeX. `width` is the reply's, as Markdown in it was converted for.
export function shownOf(
  blocks: Block[],
  sizeOf: (job: { tex: string; display: boolean }) => Size | undefined,
  width: number | undefined,
  isFirstOfReply: boolean,
): Shown[] {
  const out: Shown[] = []
  let flows = 0
  let opens = isFirstOfReply
  const text = (s: string, flow?: number, bare?: boolean) => {
    for (const grapheme of graphemes(s)) {
      if (SPACE.test(grapheme)) continue
      out.push({ kind: 'char', text: grapheme, ...(flow === undefined ? {} : { flow }), ...(bare ? { bare: true as const } : {}) })
    }
  }
  const math = (tex: string, display: boolean, flow?: number) => {
    const latex = display ? `$$${tex}$$` : `$${tex}$`
    const size = sizeOf({ tex, display })
    if (size === undefined) text(latex, flow)
    else out.push({ kind: 'picture', latex, display, columns: size.columns, rows: size.rows, ...(flow === undefined ? {} : { flow }) })
  }
  const tokens = (list: Token[], flow: number) => {
    for (const token of list) {
      if (token.kind === 'math') math(token.tex, false, flow)
      else text(token.text, flow)
    }
  }
  const walk = (block: Block, columns: number | undefined, nested: boolean) => {
    if (block.kind === 'markdown' && nested) text(unicodeMath(block.text, columns))
    else if (block.kind === 'markdown') {
      for (const run of splitMarkdownRuns(block.text)) {
        // Mark a code block that opens the reply bare: the mod hands it on
        // whole, and Claude Code draws it with its own gutter, which a
        // selection leaves out.
        if (run.kind === 'code') text(codeOf(run.text), undefined, opens)
        else text(unicodeMath(run.text, columns))
        opens = false
      }
    } else if (block.kind === 'para') tokens(block.tokens, flows++)
    else if (block.kind === 'display') math(block.tex, true)
    else {
      for (const item of block.items) {
        const flow = flows++
        text(item.prefix, flow)
        tokens(item.tokens, flow)
        const inner = columns === undefined ? undefined : columns - cellWidth(item.prefix)
        for (const child of item.blocks ?? []) walk(child, inner, true)
      }
    }
    opens = false
  }
  for (const block of blocks) walk(block, width, false)
  return out
}

// A picture's cells on one row: the row, its first and last column in the
// picture, and the cell it starts at on its selected line.
type Run = { row: number; first: number; last: number; column: number }

type Piece = { kind: 'space'; text: string } | { kind: 'char'; text: string } | ({ kind: 'run' } & Run)

// A selected line in pieces: a picture's cells on one row as one run, other
// characters one grapheme each, and the spaces between them.
function piecesOf(line: string): Piece[] {
  const pieces: Piece[] = []
  let column = 0
  for (const grapheme of graphemes(line)) {
    const last = pieces[pieces.length - 1]
    if (grapheme.startsWith(PLACEHOLDER)) {
      const [row, cell] = [...grapheme].slice(1).map(mark => INDEX.get(mark.codePointAt(0) ?? 0))
      if (row !== undefined && cell !== undefined) {
        if (last?.kind === 'run' && last.row === row && last.last + 1 === cell) last.last = cell
        else pieces.push({ kind: 'run', row, first: cell, last: cell, column })
        column += 1
        continue
      }
    }
    if (!SPACE.test(grapheme)) pieces.push({ kind: 'char', text: grapheme })
    else if (last?.kind === 'space') last.text += grapheme
    else pieces.push({ kind: 'space', text: grapheme })
    column += cellWidth(grapheme)
  }
  // Count the bullet as the gutter's blank, not as text: on the middle row
  // of a display formula that opens the reply, it would keep that row from
  // reading as the formula's.
  const lead = pieces.find(piece => piece.kind !== 'space')
  if (lead?.kind === 'char' && lead.text === BULLET) pieces[pieces.indexOf(lead)] = { kind: 'space', text: BULLET }
  return pieces
}

// A piece the alignment places. A run that `opens` the selection may start
// inside its picture, one that `closes` it may end inside it, and one `alone`
// on its line is all that line holds.
type Unit = { line: number; piece: number } & (
  | { kind: 'char'; text: string }
  | ({ kind: 'run'; opens: boolean; closes: boolean; alone: boolean } & Run)
)

// What the alignment reads off the selected lines: which hold text, the runs
// on each, and the last line's index. The first line runs from where the
// selection starts to the row's end, the last from the row's start to where
// it ends, and every line between them is selected whole. Cells count from
// the row's start on every line but the first.
type Layout = { hasText: readonly boolean[]; runs: readonly (readonly Run[])[]; last: number }

// A run is a picture's text row, where its LaTeX goes, when it is the
// picture's middle row and as wide as the picture where the selection does not
// cut it, and when the picture's other rows fall where the selection shows
// them. Every picture has its baseline in its middle row.
//
// Check the other rows as a group, not the middle row alone: the rows under
// one formula would pass for the middle row of a taller formula further on.
// Text sits only on the middle row of the pictures beside it, so the other
// rows' lines hold none; a line between the first and last shows the row
// whole, under the middle row. A display formula has its rows to itself,
// and one wider than the reply shows the middle part its centering leaves.
function fits(run: Extract<Unit, { kind: 'run' }>, picture: Picture, layout: Layout): boolean {
  const middle = Math.floor((picture.rows - 1) / 2)
  if (run.row !== middle || run.last >= picture.columns) return false
  const isWhole = (part: Run) =>
    (part.first === 0 && part.last === picture.columns - 1) ||
    (picture.display && part.first > 0 && part.last < picture.columns - 1 && Math.abs(part.first - (picture.columns - 1 - part.last)) <= 1)
  if (picture.display) {
    if (!run.alone || layout.hasText[run.line] === true || !(isWhole(run) || run.opens || run.closes)) return false
  } else if ((run.first !== 0 && !run.opens) || (run.last !== picture.columns - 1 && !run.closes)) return false
  const left = isWhole(run) ? run.first : 0
  const right = isWhole(run) ? run.last : picture.columns - 1
  const edge = run.column - run.first
  for (let row = 0; row < picture.rows; row++) {
    const line = run.line - middle + row
    if (row === middle || line < 0 || line > layout.last) continue
    if (layout.hasText[line] === true) return false
    const parts = layout.runs[line] ?? []
    if (line > 0 && line < layout.last) {
      const part = parts.find(part => part.row === row && part.first === left && part.last === right && (run.line === 0 || part.column - part.first === edge))
      if (part === undefined || (picture.display && parts.length !== 1)) return false
    } else if (picture.display) {
      // On the first line the row is cut only on its left, on the last only
      // on its right, and it is all the line holds.
      const part = parts[0]
      if (parts.length > 1 || (part !== undefined && (part.row !== row || (line === 0 ? part.last !== right : part.first !== left)))) return false
    }
  }
  return true
}

const MATCH = 2
// A run that shows its picture whole beats a part of one, as the middle row
// of a display formula beats the rows of a smaller formula above it.
const PICTURE = 4
const WHOLE_PICTURE = 5
const SKIP_CHAR = -1
const SKIP_SHOWN = -1
const SKIP_PICTURE = -2
const NONE = -1_000_000_000

// Aligns the selected pieces with what the reply shows, the whole selection
// against a stretch of the reply, and answers each unit's place in `shown`
// (-1 for none) along every best alignment. A run left out costs nothing: it
// is a picture's row other than its text row.
function align(units: Unit[], shown: Shown[], layout: Layout): Int32Array[] | null {
  const m = units.length
  const n = shown.length
  const stride = n + 1
  if (m === 0 || n === 0 || (m + 1) * stride > MAX_CELLS) return null
  // 1: paired, 2: unit left out, 3: shown left out.
  const moves = new Uint8Array((m + 1) * stride)
  let above = new Int32Array(stride)
  let row = new Int32Array(stride)
  for (let i = 1; i <= m; i++) {
    const unit = units[i - 1] as Unit
    const skip = unit.kind === 'run' ? 0 : SKIP_CHAR
    row[0] = (above[0] ?? 0) + skip
    moves[i * stride] = 2
    for (let j = 1; j <= n; j++) {
      const item = shown[j - 1] as Shown
      let best = (above[j] ?? 0) + skip
      let move = 2
      const pair =
        unit.kind === 'char'
          ? item.kind === 'char' && item.text === unit.text
            ? MATCH
            : NONE
          : item.kind === 'picture' && fits(unit, item, layout)
            ? unit.first === 0 && unit.last === item.columns - 1
              ? WHOLE_PICTURE
              : PICTURE
            : NONE
      if (pair !== NONE && (above[j - 1] ?? 0) + pair >= best) {
        best = (above[j - 1] ?? 0) + pair
        move = 1
      }
      const left = (row[j - 1] ?? 0) + (item.kind === 'picture' ? SKIP_PICTURE : SKIP_SHOWN)
      if (left > best) {
        best = left
        move = 3
      }
      row[j] = best
      moves[i * stride + j] = move
    }
    ;[above, row] = [row, above]
  }
  let top = NONE
  const ends: number[] = []
  for (let j = 1; j <= n; j++) {
    const score = above[j] ?? NONE
    if (score > top) {
      top = score
      ends.length = 0
    }
    if (score === top) ends.push(j)
  }
  if (ends.length === 0 || ends.length > 32) return null
  return ends.map(end => {
    const placed = new Int32Array(m).fill(-1)
    let i = m
    let j = end
    while (i > 0) {
      const move = moves[i * stride + j]
      if (move === 1) placed[i - 1] = j - 1
      if (move === 1 || move === 2) i--
      if (move === 1 || move === 3) j--
    }
    return placed
  })
}

// The text a mouse selection of a reply copies, with each formula drawn as a
// picture back as its LaTeX: in place of the picture's text row, its other
// rows left out, as Claude Code copies a reply it draws itself (the gutter
// left out, a paragraph's wrapped lines joined). Null when the selection does
// not read as the reply, reads as it in more than one way, or would lose a
// formula that sits beside text.
export function copyAsLatex(selected: string, shown: Shown[]): string | null {
  const lines = selected.split('\n').map(piecesOf)
  const units: Unit[] = []
  const unitOf = lines.map(pieces => pieces.map(() => -1))
  lines.forEach((pieces, line) => {
    const alone = pieces.filter(piece => piece.kind !== 'space').length === 1
    pieces.forEach((piece, index) => {
      if (piece.kind === 'space') return
      ;(unitOf[line] as number[])[index] = units.length
      units.push(piece.kind === 'char' ? { line, piece: index, ...piece } : { line, piece: index, ...piece, opens: false, closes: false, alone })
    })
  })
  const first = units[0]
  if (first?.kind === 'run') first.opens = true
  const last = units[units.length - 1]
  if (last?.kind === 'run') last.closes = true

  const hasText = lines.map(pieces => pieces.some(piece => piece.kind === 'char'))
  const runs = lines.map(pieces => pieces.flatMap(piece => (piece.kind === 'run' ? [piece] : [])))
  const alignments = align(units, shown, { hasText, runs, last: lines.length - 1 })
  const placed = alignments?.[0]
  if (!alignments || !placed) return null
  const latexAt = (along: Int32Array) =>
    units.map((unit, k) => (unit.kind === 'run' && (along[k] ?? -1) >= 0 ? (shown[along[k] ?? 0] as Picture).latex : '')).join('\n')
  const latex = latexAt(placed)
  if (alignments.some(along => latexAt(along) !== latex)) return null
  const chars = units.filter(unit => unit.kind === 'char').length
  const paired = units.filter((unit, k) => unit.kind === 'char' && (placed[k] ?? -1) >= 0).length
  if (paired < chars * 0.8) return null
  // A run on a line that holds text is the middle row of its picture: one
  // left unplaced would drop a formula from the copy without a sign.
  if (units.some((unit, k) => unit.kind === 'run' && hasText[unit.line] === true && (placed[k] ?? -1) < 0)) return null

  type Line = { text: string; line: number; first?: number; last?: number; display: boolean }
  const kept: Line[] = []
  lines.forEach((pieces, line) => {
    let text = ''
    let hasRun = false
    let displays = 0
    let others = 0
    let firstShown: number | undefined
    let lastShown: number | undefined
    const place = (at: number) => {
      firstShown ??= at
      lastShown = at
    }
    pieces.forEach((piece, index) => {
      if (piece.kind === 'space') {
        text += piece.text
        return
      }
      const at = placed[(unitOf[line] as number[])[index] ?? -1] ?? -1
      if (piece.kind === 'char') {
        text += piece.text
        if (at >= 0) place(at)
        others++
        return
      }
      hasRun = true
      if (at < 0) return
      const picture = shown[at] as Picture
      text += picture.latex
      place(at)
      if (picture.display) displays++
      else others++
    })
    if (hasRun && text.trim() === '') return
    kept.push({ text, line, first: firstShown, last: lastShown, display: displays === 1 && others === 0 })
  })

  const flowAt = (at: number | undefined) => (at === undefined ? undefined : shown[at]?.flow)
  const out: string[] = []
  let previous: Line | undefined
  for (const line of kept) {
    const start = line.first === undefined ? undefined : shown[line.first]
    let text = line.text
    if (line.line === 0) text = text.trimStart().replace(new RegExp(`^${BULLET}\\s*`), '')
    else if (!(start?.kind === 'char' && start.bare)) text = text.replace(new RegExp(`^(?:${BULLET} |  )`), '')
    text = line.display ? text.trim() : text.trimEnd()
    const flow = flowAt(previous?.last)
    if (flow !== undefined && flow === flowAt(line.first) && out.length > 0) out[out.length - 1] = `${(out[out.length - 1] ?? '').trimEnd()} ${text.trimStart()}`
    else out.push(text)
    previous = line
  }
  const result = out.join('\n')
  return result.trim() === '' ? null : result
}

export type Selected = { text: string; requestId?: string }

// A selection is watched for a minute after it last changed; the clipboard is
// read every 200 ms for its first three seconds, then every second.
const WATCH_MS = 60_000
const FAST_MS = 3_000
const FAST_EVERY = 200
const SLOW_EVERY = 1_000

// One look, each clock tick, at what the person has selected with the mouse:
// once a selection with pictures has stopped changing, and while the clipboard
// holds exactly that selection's text, as Claude Code copies it, the clipboard
// gets the text with the formulas as LaTeX instead. What another program
// copied is never the selection's text, so it is left alone, and a copy
// Claude Code makes again later is caught again.
export function copyWatcher(deps: {
  selection: () => Promise<Selected | undefined>
  readClipboard: () => Promise<string | undefined>
  write: (text: string) => Promise<boolean>
  rewrite: (selected: Selected) => string | null
  now: () => number | Promise<number>
}): () => Promise<void> {
  let watched: (Selected & { since: number; checkedAt: number; latex?: string | null }) | undefined
  let isBusy = false
  return async () => {
    if (isBusy) return
    isBusy = true
    try {
      const selected = await deps.selection()
      if (selected === undefined || !selected.text.includes(PLACEHOLDER)) {
        watched = undefined
        return
      }
      const now = await deps.now()
      if (watched === undefined || watched.text !== selected.text || watched.requestId !== selected.requestId) {
        watched = { ...selected, since: now, checkedAt: now }
        return
      }
      const age = now - watched.since
      if (age > WATCH_MS || now - watched.checkedAt < (age <= FAST_MS ? FAST_EVERY : SLOW_EVERY)) return
      watched.checkedAt = now
      watched.latex ??= deps.rewrite(selected)
      if (watched.latex === null) return
      if ((await deps.readClipboard()) !== selected.text) return
      // The person may have selected again while the clipboard was read, and
      // Claude Code copied that: write only for the selection still standing.
      const standing = await deps.selection()
      if (standing?.text !== selected.text || standing.requestId !== selected.requestId) return
      await deps.write(watched.latex)
    } finally {
      isBusy = false
    }
  }
}
