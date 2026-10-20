import { literalEnd } from './parse'

// MathJax's tooltips (its action extension): \texttip{part}{words} and
// \mathtip{part}{formula} put an explanation on part of a formula. MathJax
// shows it with a browser's pointer events, which a picture lacks, so the mod
// draws the explanation in a card of its own.

// One tooltip: the TeX of the part it explains, and the explanation, words
// (`text`) or a formula (`tex`).
export type Tip = { base: string; text: string } | { base: string; tex: string }

// A formula's tooltips in the order they start, and the formula as the
// renderer gets it: each tooltip as \texttip{part}{its number}. Do not hand
// the part on as {part}: braces make an operator ordinary, so a tooltip on +
// or = would lose its spacing, where \texttip draws the part spaced as it is.
// \mathtip, which MathJax fails on without a browser, never reaches it.
// `isWhole`: the first tooltip explains the whole formula.
export type Tipped = { tex: string; tips: Tip[]; isWhole: boolean }

const NAME = /^[A-Za-z]+/
const SPACES = /\s/

// Where the argument at `from` ends, past the spaces before it, as TeX reads
// it: a {...} group, a command or one character. Null when there is none.
function argumentAt(s: string, from: number): { start: number; end: number; inner: string } | null {
  let i = from
  while (SPACES.test(s[i] ?? '')) i++
  const ch = s[i]
  if (ch === undefined || ch === '}' || ch === '%') return null
  if (ch === '\\') {
    const name = NAME.exec(s.slice(i + 1))?.[0]
    const end = i + 1 + (name?.length ?? (s[i + 1] === undefined ? 0 : 1))
    return { start: i, end, inner: s.slice(i, end) }
  }
  if (ch !== '{') {
    const end = i + String.fromCodePoint(s.codePointAt(i) ?? 0).length
    return { start: i, end, inner: s.slice(i, end) }
  }
  let depth = 0
  for (let j = i; j < s.length; j++) {
    const literal = literalEnd(s, j)
    if (literal > j) j = literal - 1
    else if (s[j] === '\\') j++
    else if (s[j] === '{') depth++
    else if (s[j] === '}' && --depth === 0) return { start: i, end: j + 1, inner: s.slice(i + 1, j) }
  }
  return null
}

export function readTips(tex: string): Tipped {
  const tips: Tip[] = []
  let whole: { start: number; end: number } | undefined
  const rewrite = (s: string, isTop: boolean): string => {
    let out = ''
    let i = 0
    while (i < s.length) {
      // Copy a comment or \verb as written: a tooltip spelled there is not
      // run, and reading one in a comment would take in the newline and run
      // the next line into it.
      const literal = literalEnd(s, i)
      if (literal > i) {
        out += s.slice(i, literal)
        i = literal
        continue
      }
      const name = s[i] === '\\' ? NAME.exec(s.slice(i + 1))?.[0] : undefined
      if (name !== 'texttip' && name !== 'mathtip') {
        // Copy a command whole, so a longer one or an escaped brace is kept.
        const step = s[i] === '\\' ? 1 + (name?.length ?? 1) : 1
        out += s.slice(i, i + step)
        i += step
        continue
      }
      const base = argumentAt(s, i + 1 + name.length)
      const explanation = base && argumentAt(s, base.end)
      if (!base || !explanation) {
        out += s.slice(i)
        break
      }
      const number = tips.length
      const content = explanation.inner.trim()
      tips.push(name === 'mathtip' ? { base: base.inner, tex: content } : { base: base.inner, text: content.replace(/\s+/g, ' ') })
      if (isTop && whole === undefined) whole = { start: i, end: explanation.end }
      out += `\\texttip{${rewrite(base.inner, false)}}{${number}}`
      i = explanation.end
    }
    return out
  }
  const out = rewrite(tex, true)
  const isWhole = tips.length > 0 && whole !== undefined && tex.slice(0, whole.start).trim() === '' && tex.slice(whole.end).trim() === ''
  return { tex: out, tips, isWhole }
}
