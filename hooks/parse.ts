export type Token =
  | { kind: 'text'; text: string; bold?: true }
  | { kind: 'code'; text: string }
  | { kind: 'math'; tex: string }

// An item's first paragraph goes in `tokens`, beside its marker; what is
// indented under it goes in `blocks`. `spaced`: a blank line above the item.
export type ListItem = { prefix: string; tokens: Token[]; blocks?: Block[]; spaced?: true }

// `joined`: the block sits right under the one before it, with no blank line
// between them.
export type Block = (
  | { kind: 'markdown'; text: string }
  | { kind: 'para'; tokens: Token[] }
  | { kind: 'list'; items: ListItem[] }
  | { kind: 'display'; tex: string }
) & { joined?: true }

const LIST_MARKER = /^( {0,3})([-*+]|\d{1,9}[.)])(?=[ \t]|$)/
const RULE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})$/
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/
const QUOTE = /^ {0,3}>/
const TABLE = /^ {0,3}\|/
const DISPLAY_OPENING = /^[ \t]*(?:\$\$|\\\[)/
const WHITESPACE = /\s/
const DIGIT = /[0-9]/
const ROMAN: [number, string][] = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'],
  [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
]

type Fence = { character: '`' | '~'; length: number; indent: number; columnZero: boolean }

function indentColumns(indent: string): number {
  let columns = 0
  for (const character of indent) columns += character === '\t' ? 4 : 1
  return columns
}

// Do not limit an opening fence to three spaces of indent: the Markdown
// splitting below does not track list items, so the limit would miss a fence
// nested in a list; and a fence indented further, which Claude Code's
// Markdown shows as indented code, would be read as text with its dollars as
// math.
function opensFence(line: string): Fence | null {
  const content = line.endsWith('\r') ? line.slice(0, -1) : line
  const match = /^([ \t]*)(`{3,}|~{3,})(.*)$/.exec(content)
  const indent = match?.[1]
  const marker = match?.[2]
  if (!marker) return null
  const character = marker[0] as Fence['character']
  if (character === '`' && (match[3] ?? '').includes('`')) return null
  return { character, length: marker.length, indent: indentColumns(indent ?? ''), columnZero: indent === '' }
}

// Do not close a fence at a line indented more than three columns past its
// opening: a fence example indented inside code, as in a docstring, would end
// the outer block. Claude Code's markdown reader allows the same three.
function closesFence(line: string, fence: Fence): boolean {
  const content = line.endsWith('\r') ? line.slice(0, -1) : line
  const match = /^([ \t]*)(`+|~+)\s*$/.exec(content)
  const indent = match?.[1]
  const marker = match?.[2]
  return marker !== undefined && marker[0] === fence.character && marker.length >= fence.length && indentColumns(indent ?? '') <= fence.indent + 3
}

function isEscaped(s: string, i: number): boolean {
  let slashes = 0
  for (let k = i - 1; k >= 0 && s[k] === '\\'; k--) slashes++
  return slashes % 2 === 1
}

// Pandoc's rule: the opening $ has a non-space right after it, the closing $
// a non-space right before it and no digit right after it, so "$20 and $30"
// stays text. Stricter than pandoc, the next unescaped $ must be the closing
// one and a backtick ends the search, so an amount never pairs with a later
// formula or with a $ inside code.
function closingDollar(s: string, open: number): number {
  const first = s[open + 1]
  if (first === undefined || WHITESPACE.test(first) || first === '$') return -1
  for (let j = open + 2; j < s.length; j++) {
    if (s[j] === '`') return -1
    if (s[j] !== '$' || isEscaped(s, j)) continue
    const after = s[j + 1]
    const isClosing = !WHITESPACE.test(s[j - 1] ?? ' ') && !(after !== undefined && DIGIT.test(after))
    return isClosing ? j : -1
  }
  return -1
}

function pushWords(out: Token[], s: string, bold: boolean): void {
  const parts = s.split(/(\s+)/)
  for (let k = 0; k < parts.length; k += 2) {
    const text = (parts[k] ?? '') + (parts[k + 1] ? ' ' : '')
    if (text) out.push(bold ? { kind: 'text', text, bold: true } : { kind: 'text', text })
  }
}

// Splits one paragraph into word, code and math tokens. Each word keeps its
// trailing space, so a particle written right after a formula stays next to it.
export function tokenize(paragraph: string): Token[] {
  const s = paragraph
  const out: Token[] = []
  let buffer = ''
  let bold = false
  const flush = () => {
    if (buffer) pushWords(out, buffer, bold)
    buffer = ''
  }

  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === '\\' && s[i + 1] === '$') {
      buffer += '$'
      i += 2
      continue
    }
    if (c === '\\' && s[i + 1] === '(') {
      const end = s.indexOf('\\)', i + 2)
      if (end > i + 2) {
        flush()
        out.push({ kind: 'math', tex: s.slice(i + 2, end).trim() })
        i = end + 2
        continue
      }
    }
    if (c === '`') {
      const end = s.indexOf('`', i + 1)
      if (end > i + 1) {
        flush()
        out.push({ kind: 'code', text: s.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    if (c === '*' && s[i + 1] === '*' && (bold || s.indexOf('**', i + 2) > i + 2)) {
      flush()
      bold = !bold
      i += 2
      continue
    }
    if (c === '$' && s[i + 1] === '$') {
      const end = s.indexOf('$$', i + 2)
      if (end > i + 2) {
        flush()
        out.push({ kind: 'math', tex: s.slice(i + 2, end).trim() })
        i = end + 2
        continue
      }
    }
    if (c === '$' && !isEscaped(s, i)) {
      const end = closingDollar(s, i)
      if (end > 0) {
        flush()
        out.push({ kind: 'math', tex: s.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    buffer += c
    i++
  }
  flush()
  return out
}

function hasMathToken(tokens: Token[]): boolean {
  return tokens.some(t => t.kind === 'math')
}

// Blank lines end a block, except inside a code fence.
function rawBlocks(lines: string[]): string[][] {
  const blocks: string[][] = []
  let current: string[] = []
  let fence: Fence | null = null
  for (const line of lines) {
    if (fence !== null) {
      current.push(line)
      if (closesFence(line, fence)) fence = null
      continue
    }
    const opening = opensFence(line)
    if (opening) {
      fence = opening
      current.push(line)
      continue
    }
    if (line.trim() === '') {
      if (current.length > 0) blocks.push(current)
      current = []
      continue
    }
    current.push(line)
  }
  if (current.length > 0) blocks.push(current)
  return blocks
}

// A run of a container's lines, from `start` up to `end`; `joined`: no blank
// line comes before it.
type Chunk = { start: number; end: number; joined: boolean } & (
  | { kind: 'text' }
  | { kind: 'display'; tex: string }
  | { kind: 'other' }
  | { kind: 'list'; ordered: boolean; first: number; items: { lines: string[]; spaced: boolean }[] }
)
type ListChunk = Extract<Chunk, { kind: 'list' }>

function isBlank(line: string): boolean {
  return line.trim() === ''
}

function leading(line: string): number {
  return indentColumns(/^[ \t]*/.exec(line)?.[0] ?? '')
}

// The line with its indent's tabs turned into spaces, so columns can be cut off it.
function untab(line: string): string {
  const indent = /^[ \t]*/.exec(line)?.[0] ?? ''
  return indent.includes('\t') ? ' '.repeat(indentColumns(indent)) + line.slice(indent.length) : line
}

function listMarker(line: string): RegExpExecArray | null {
  return RULE.test(line) ? null : LIST_MARKER.exec(line)
}

// Whether two markers start items of one list: the same bullet, or numbers
// closed the same way.
function sameList(a: string, b: string): boolean {
  return DIGIT.test(a) ? DIGIT.test(b) && a.slice(-1) === b.slice(-1) : a === b
}

function displayClose(text: string, start: number, opening: '$$' | '\\['): number {
  const bodyStart = start + opening.length
  let braces = 0
  for (let i = bodyStart; i < text.length;) {
    if (opening === '\\[' && braces === 0 && text.startsWith('\\]', i)) return i > bodyStart ? i : -1
    if (opening === '$$' && braces === 0 && text.startsWith('$$', i)) return i > bodyStart ? i : -1
    if (text[i] === '\\') {
      i += Math.min(2, text.length - i)
      continue
    }
    if (text[i] === '{') braces++
    else if (text[i] === '}' && braces > 0) braces--
    i++
  }
  return -1
}

// Only a paragraph made of display formulas and whitespace is read as display formulas, one block each; prose between them leaves it a paragraph, whose $$…$$ tokenize reads as inline math.
// Skipping escaped characters and ignoring delimiters inside braces keeps TeX
// content from changing where a formula ends.
export function displayFormulas(text: string): string[] | null {
  const formulas: string[] = []
  let i = 0
  while (i < text.length) {
    while (i < text.length && WHITESPACE.test(text[i] ?? '')) i++
    if (i === text.length) break

    const opening = text.startsWith('$$', i) ? '$$' : text.startsWith('\\[', i) ? '\\[' : null
    if (opening === null) return null
    const end = displayClose(text, i, opening)
    if (end < 0) return null
    formulas.push(text.slice(i + opening.length, end).trim())
    i = end + 2
  }
  return formulas.length > 0 ? formulas : null
}

// A line that ends the paragraph above it, as in Claude Code's Markdown: a
// fence, a heading, a quote, or an item with text that is a bullet or the
// number 1.
function breaksParagraph(line: string): boolean {
  if (opensFence(line) !== null || HEADING.test(line) || QUOTE.test(line)) return true
  const marker = listMarker(untab(line))
  return marker !== null && /^(?:[-*+]|1[.)])$/.test(marker[2] ?? '') && !isBlank(line.slice(marker[0].length))
}

// A line that ends a list item whose text starts at column `indent`, as in
// Claude Code's Markdown: a fence, heading, HTML block, list item or rule
// left of that column.
function endsItem(line: string, indent: number): boolean {
  if (isBlank(line) || leading(line) > Math.min(3, indent - 1)) return false
  const body = line.trimStart()
  return /^(?:```|~~~|#|<(?:[a-z].*>|!--))/i.test(body) || /^(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/.test(body) || RULE.test(line)
}

// Reads the list starting at `start` the way Claude Code's Markdown does: an
// item goes on over blank lines while its lines are indented to its text, a
// line with less indent goes on with its paragraph until a blank line, and
// the list goes on while items with the same kind of marker follow.
function readList(lines: string[], start: number, joined: boolean): ListChunk {
  const marker = listMarker(untab(lines[start] ?? ''))?.[2] ?? '-'
  const items: ListChunk['items'] = []
  let end = start
  let spaced = false
  let i = start
  while (i < lines.length) {
    const line = untab(lines[i] ?? '')
    const match = listMarker(line)
    if (!match || !sameList(match[2] ?? '', marker)) break
    const rest = line.slice(match[0].length)
    const spaces = rest.search(/\S/)
    const pad = spaces < 0 || spaces > 4 ? 1 : spaces
    const indent = match[0].length + pad
    const content = [isBlank(rest) ? '' : rest.slice(pad)]
    let blank = isBlank(rest)
    let k = i + 1
    // An item starts with at most one blank line.
    const empty = blank && k < lines.length && isBlank(lines[k] ?? '')
    for (; !empty && k < lines.length; k++) {
      const next = untab(lines[k] ?? '')
      if (endsItem(next, indent)) break
      const previous = content[content.length - 1] ?? ''
      if (isBlank(next) || leading(next) >= indent) content.push(next.slice(indent))
      else if (blank || leading(previous) >= 4 || opensFence(previous) !== null || HEADING.test(previous) || RULE.test(previous)) break
      else content.push(next)
      if (isBlank(next)) blank = true
    }
    // Blank lines at the end go between this item and the next.
    let last = content.length
    while (last > 1 && isBlank(content[last - 1] ?? '')) last--
    items.push({ lines: content.slice(0, last), spaced })
    spaced = last < content.length
    end = k - (content.length - last)
    i = k
  }
  const ordered = DIGIT.test(marker)
  return { kind: 'list', start, end, joined, ordered, first: ordered ? Number.parseInt(marker, 10) : 1, items }
}

function readChunk(lines: string[], start: number, joined: boolean): Chunk[] {
  const line = lines[start] ?? ''
  const fence = opensFence(line)
  if (fence) {
    let end = start + 1
    while (end < lines.length && !closesFence(lines[end] ?? '', fence)) end++
    return [{ kind: 'other', start, end: Math.min(end + 1, lines.length), joined }]
  }
  const toBlank = () => {
    let end = start + 1
    while (end < lines.length && !isBlank(lines[end] ?? '') && opensFence(lines[end] ?? '') === null) end++
    return end
  }
  if (DISPLAY_OPENING.test(line)) {
    const end = toBlank()
    const formulas = displayFormulas(lines.slice(start, end).join('\n'))
    if (formulas !== null) {
      return formulas.map((tex, index) => ({
        kind: 'display',
        tex,
        start,
        end,
        joined: index === 0 ? joined : true,
      }))
    }
  }
  if (listMarker(untab(line))) return [readList(lines, start, joined)]
  if (HEADING.test(line) || RULE.test(line)) return [{ kind: 'other', start, end: start + 1, joined }]
  if (QUOTE.test(line) || TABLE.test(line)) return [{ kind: 'other', start, end: toBlank(), joined }]
  let end = start + 1
  while (end < lines.length && !isBlank(lines[end] ?? '') && !breaksParagraph(lines[end] ?? '')) end++
  return [{ kind: 'text', start, end, joined }]
}

// Splits a container's lines into chunks: the reply's, or a list item's
// with its indent taken off. Claude Code puts a blank line under every
// heading, so nothing is joined to one.
function scan(lines: string[]): Chunk[] {
  const chunks: Chunk[] = []
  let blank = false
  let i = 0
  while (i < lines.length) {
    if (isBlank(lines[i] ?? '')) {
      blank = true
      i++
      continue
    }
    const previous = chunks[chunks.length - 1]
    const underHeading = previous?.kind === 'other' && HEADING.test(lines[previous.start] ?? '')
    const read = readChunk(lines, i, previous !== undefined && !blank && !underHeading)
    chunks.push(...read)
    blank = false
    i = read[0]?.end ?? i + 1
  }
  return chunks
}

function tokensOf(lines: string[]): Token[] {
  return tokenize(lines.map(line => line.trim()).join(' '))
}

function letters(n: number): string {
  let out = ''
  let rest = n
  while (rest > 0) {
    rest--
    out = String.fromCharCode(97 + (rest % 26)) + out
    rest = Math.floor(rest / 26)
  }
  return out
}

function roman(n: number): string {
  let out = ''
  let rest = n
  for (const [value, digits] of ROMAN) {
    for (; rest >= value; rest -= value) out += digits
  }
  return out
}

// The marker Claude Code draws: a dash for every bullet, and the list's
// start counted on for a number, in letters one list in and in roman
// numerals two lists in.
function markerOf(list: ListChunk, index: number, depth: number): string {
  if (!list.ordered) return '-'
  const number = list.first + index
  if (depth === 1 && list.first >= 1) return `${letters(number)}.`
  if (depth === 2 && list.first >= 1 && list.first + list.items.length - 1 <= 3999) return `${roman(number)}.`
  return `${number}.`
}

function hasBlockMath(block: Block): boolean {
  if (block.kind === 'display') return true
  if (block.kind === 'para') return hasMathToken(block.tokens)
  if (block.kind === 'list') return block.items.some(item => hasMathToken(item.tokens) || (item.blocks ?? []).some(hasBlockMath))
  return false
}

function listOf(list: ListChunk, depth: number): Block {
  const items = list.items.map((item, index): ListItem => {
    const chunks = scan(item.lines)
    const head = chunks[0]
    const adjacentDisplayHead = head?.kind === 'display'
      && chunks[1]?.kind === 'display'
      && chunks[1].start === head.start
      && chunks[1].end === head.end
    const opens = head !== undefined && (head.kind === 'text' || (head.kind === 'display' && !adjacentDisplayHead))
    const tokens = opens ? tokensOf(item.lines.slice(head.start, head.end)) : []
    const blocks = blocksOf(item.lines, opens ? chunks.slice(1) : chunks, depth + 1)
    return {
      prefix: `${markerOf(list, index, depth)} `,
      tokens,
      ...(blocks.length > 0 ? { blocks } : {}),
      ...(item.spaced ? { spaced: true as const } : {}),
    }
  })
  return { kind: 'list', items }
}

// The block the mod draws for a chunk `depth` lists in, or null to leave it
// to the engine's Markdown. A list in a list is always drawn here, so it
// keeps its place in the item.
function drawnBlock(lines: string[], chunk: Chunk, depth: number): Block | null {
  if (chunk.kind === 'display') return { kind: 'display', tex: chunk.tex }
  if (chunk.kind === 'text') {
    const tokens = tokensOf(lines.slice(chunk.start, chunk.end))
    return hasMathToken(tokens) ? { kind: 'para', tokens } : null
  }
  if (chunk.kind !== 'list') return null
  const list = listOf(chunk, depth)
  return depth > 0 || hasBlockMath(list) ? list : null
}

// Chunks next to each other that the mod leaves to Markdown go as one block
// with their lines as written.
function blocksOf(lines: string[], chunks: Chunk[], depth: number): Block[] {
  const out: Block[] = []
  let markdown: { start: number; end: number; joined: boolean } | undefined
  const join = (block: Block, joined: boolean): Block => (joined ? { ...block, joined: true } : block)
  for (const chunk of chunks) {
    const block = drawnBlock(lines, chunk, depth)
    if (block === null) {
      if (markdown) markdown.end = chunk.end
      else markdown = { start: chunk.start, end: chunk.end, joined: chunk.joined }
      continue
    }
    if (markdown) out.push(join({ kind: 'markdown', text: lines.slice(markdown.start, markdown.end).join('\n') }, markdown.joined))
    markdown = undefined
    out.push(join(block, chunk.joined))
  }
  if (markdown) out.push(join({ kind: 'markdown', text: lines.slice(markdown.start, markdown.end).join('\n') }, markdown.joined))
  return out
}

export function parseBlocks(text: string): Block[] {
  const lines = text.split('\n')
  return blocksOf(lines, scan(lines), 0)
}

export function hasMath(text: string): boolean {
  return parseBlocks(text).some(block => block.kind !== 'markdown')
}

export type MarkdownRun = { kind: 'prose' | 'code'; text: string }

// Splits markdown into prose and the fenced code blocks that start a line,
// each code block whole in a run of its own. An indented fence, as in a list
// item, stays inside its prose; consecutive prose blocks merge into one run.
export function splitMarkdownRuns(text: string): MarkdownRun[] {
  const runs: MarkdownRun[] = []
  let kind: MarkdownRun['kind'] = 'prose'
  let current: string[] = []
  let fence: Fence | null = null
  const flush = () => {
    if (current.length === 0) return
    const text = current.join('\n')
    const previous = runs[runs.length - 1]
    if (kind === 'prose' && previous?.kind === 'prose') previous.text += `\n\n${text}`
    else runs.push({ kind, text })
    current = []
  }

  for (const line of text.split('\n')) {
    if (fence !== null) {
      current.push(line)
      if (closesFence(line, fence)) {
        if (kind === 'code') {
          flush()
          kind = 'prose'
        }
        fence = null
      }
      continue
    }

    const opening = opensFence(line)
    if (opening) {
      if (opening.columnZero) {
        flush()
        kind = 'code'
      }
      current.push(line)
      fence = opening
      continue
    }

    if (line.trim() === '') {
      flush()
      continue
    }
    current.push(line)
  }
  flush()
  return runs
}

// Packs markdown into pieces of at most `limit` characters, the most one
// Markdown element draws, cutting only between blocks so a code fence stays
// whole; null when one block alone is longer.
export function splitMarkdown(text: string, limit: number): string[] | null {
  const pieces: string[] = []
  let current = ''
  for (const lines of rawBlocks(text.split('\n'))) {
    const block = lines.join('\n')
    if (block.length > limit) return null
    const joined = current === '' ? block : `${current}\n\n${block}`
    if (joined.length <= limit) {
      current = joined
    } else {
      pieces.push(current)
      current = block
    }
  }
  if (current !== '') pieces.push(current)
  return pieces
}

function spaceAfter(token: Token): boolean {
  return token.kind !== 'math' && /\s$/.test(token.text)
}

function spaceBefore(token: Token): boolean {
  return token.kind !== 'math' && /^\s/.test(token.text)
}

// Groups tokens that touch, with no space between them, so a line wraps only
// at spaces: a period or particle stays with the formula it follows.
export function glueTokens(tokens: Token[]): Token[][] {
  const groups: Token[][] = []
  for (const token of tokens) {
    const last = groups[groups.length - 1]
    const previous = last?.[last.length - 1]
    if (last && previous && !spaceAfter(previous) && !spaceBefore(token)) last.push(token)
    else groups.push([token])
  }
  return groups
}
