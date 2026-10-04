export type Token =
  | { kind: 'text'; text: string; bold?: true }
  | { kind: 'code'; text: string }
  | { kind: 'math'; tex: string }

export type ListItem = { prefix: string; tokens: Token[] }

export type Block =
  | { kind: 'markdown'; text: string }
  | { kind: 'para'; tokens: Token[] }
  | { kind: 'list'; items: ListItem[] }
  | { kind: 'display'; tex: string }

const FENCE = /^\s*(```|~~~)/
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+/
const WHITESPACE = /\s/
const DIGIT = /[0-9]/

function closesFence(line: string, fence: string): boolean {
  return line.trim().startsWith(fence)
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
  let fence: string | null = null
  for (const line of lines) {
    if (fence !== null) {
      current.push(line)
      if (closesFence(line, fence)) fence = null
      continue
    }
    const opening = FENCE.exec(line)
    if (opening) {
      fence = opening[1] ?? '```'
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

// A block the mod draws itself, or null to leave it to the engine's Markdown.
function classify(lines: string[]): Block | null {
  if (lines.some(line => FENCE.test(line))) return null
  const joined = lines.join('\n').trim()
  const display = /^\$\$([\s\S]+)\$\$$/.exec(joined) ?? /^\\\[([\s\S]+)\\\]$/.exec(joined)
  if (display) return { kind: 'display', tex: (display[1] ?? '').trim() }

  const first = lines[0] ?? ''
  if (/^\s*(#|>|\|)/.test(first)) return null

  if (LIST_ITEM.test(first)) {
    const raw: { prefix: string; text: string }[] = []
    for (const line of lines) {
      const marker = LIST_ITEM.exec(line)
      const last = raw[raw.length - 1]
      if (marker) raw.push({ prefix: `${marker[1] ?? ''}${marker[2] ?? ''} `, text: line.slice(marker[0].length) })
      else if (last) last.text += ` ${line.trim()}`
    }
    const items = raw.map(item => ({ prefix: item.prefix, tokens: tokenize(item.text) }))
    return items.some(item => hasMathToken(item.tokens)) ? { kind: 'list', items } : null
  }

  const tokens = tokenize(lines.map(line => line.trim()).join(' '))
  return hasMathToken(tokens) ? { kind: 'para', tokens } : null
}

export function parseBlocks(text: string): Block[] {
  const out: Block[] = []
  let markdown: string[] = []
  const flushMarkdown = () => {
    if (markdown.length > 0) out.push({ kind: 'markdown', text: markdown.join('\n\n') })
    markdown = []
  }
  for (const lines of rawBlocks(text.split('\n'))) {
    const block = classify(lines)
    if (block) {
      flushMarkdown()
      out.push(block)
    } else {
      markdown.push(lines.join('\n'))
    }
  }
  flushMarkdown()
  return out
}

export function hasMath(text: string): boolean {
  return parseBlocks(text).some(block => block.kind !== 'markdown')
}

export type MarkdownRun = { kind: 'prose' | 'code'; text: string }

// Separates prose and fenced code, leaving each fence whole and merging
// consecutive blocks of the same kind for rendering as one run.
export function splitMarkdownRuns(text: string): MarkdownRun[] {
  const runs: MarkdownRun[] = []
  let kind: MarkdownRun['kind'] = 'prose'
  let current: string[] = []
  let fence: string | null = null
  const flush = () => {
    if (current.length === 0) return
    const text = current.join('\n')
    const previous = runs[runs.length - 1]
    if (previous?.kind === kind) previous.text += `\n\n${text}`
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

    const opening = FENCE.exec(line)
    if (opening) {
      const isColumnZero = line.startsWith('```') || line.startsWith('~~~')
      if (isColumnZero) {
        flush()
        kind = 'code'
      }
      current.push(line)
      fence = opening[1] ?? '```'
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
