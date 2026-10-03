import { expect, test } from 'claude-code/testing'

import { texToUnicode, unicodeMath } from '../hooks/unicode'

test('symbols, scripts and fonts become their Unicode characters', async () => {
  expect(texToUnicode('Q \\ge 0')).toBe('Q ≥ 0')
  expect(texToUnicode('\\alpha + \\beta \\le \\infty')).toBe('α + β ≤ ∞')
  expect(texToUnicode('x^2 + y_i')).toBe('x² + yᵢ')
  expect(texToUnicode('\\mathbb{R}^n')).toBe('ℝⁿ')
  expect(texToUnicode('\\sum_{i=1}^{n} x_i')).toBe('∑ᵢ₌₁ⁿ xᵢ')
  expect(texToUnicode('\\text{loss}(\\theta)')).toBe('loss(θ)')
  expect(texToUnicode('\\left( a \\cdot b \\right)')).toBe('(a · b)')
  expect(texToUnicode('\\hat{y}')).toBe('y\u0302')
})

test('a script with a character Unicode has no small form keeps a caret', async () => {
  expect(texToUnicode('e^{i\\pi} + 1 = 0')).toBe('e^(iπ) + 1 = 0')
  expect(texToUnicode('s_{dis}')).toBe('s_(dis)')
})

test('fractions and roots are written on one line', async () => {
  expect(texToUnicode('\\frac{a}{b}')).toBe('a/b')
  expect(texToUnicode('\\frac{a+b}{2}')).toBe('(a + b)/2')
  expect(texToUnicode('\\sqrt{x}')).toBe('√x')
  expect(texToUnicode('\\sqrt{x+1}')).toBe('√(x + 1)')
  expect(texToUnicode('x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}')).toBe('x = (−b ± √(b² − 4ac))/2a')
})

test('spacing follows TeX: operators and relations are spaced, a sign is not', async () => {
  expect(texToUnicode('a = -b')).toBe('a = −b')
  expect(texToUnicode('\\log(x) + \\log y')).toBe('log(x) + log y')
  expect(texToUnicode('\\int_0^1 f(x)\\,dx')).toBe('∫₀¹ f(x) dx')
  expect(texToUnicode('\\lim_{n \\to \\infty} a_n')).toBe('lim_(n→∞) aₙ')
  expect(texToUnicode('x \\text{ for all } y')).toBe('x for all y')
  expect(texToUnicode('\\frac{\\partial L}{\\partial \\theta}')).toBe('∂L/∂θ')
  expect(texToUnicode('\\frac{1}{1 + e^{-x}}')).toBe('1/(1 + e⁻ˣ)')
})

test('scripts, fonts and negations commonly seen in ML notes', async () => {
  expect(texToUnicode('\\theta^{(t+1)}')).toBe('θ⁽ᵗ⁺¹⁾')
  expect(texToUnicode('X \\approx UV^\\top')).toBe('X ≈ UVᵀ')
  expect(texToUnicode('\\mathbb{E}_{x \\sim p}[f(x)]')).toBe('𝔼_(x∼p)[f(x)]')
  expect(texToUnicode('\\nabla_\\theta L')).toBe('∇_θ L')
  expect(texToUnicode('\\mathcal{L}')).toBe('ℒ')
  expect(texToUnicode('a \\not\\in B')).toBe('a ∉ B')
  expect(texToUnicode('\\sqrt[3]{x}')).toBe('∛x')
  expect(texToUnicode('|-5| = 5')).toBe('|−5| = 5')
  expect(texToUnicode('f(x) = |x - 1|')).toBe('f(x) = |x − 1|')
  expect(texToUnicode('\\|v\\|_2')).toBe('‖v‖₂')
  expect(texToUnicode('\\frac{-b}{2a}')).toBe('−b/2a')
  expect(texToUnicode('\\foo{x}')).toBe('\\foo x')
})

test('a reply keeps its markdown with the math in Unicode', async () => {
  expect(unicodeMath('저는 $Q \\ge 0$이 맞다고 봅니다.')).toBe('저는 Q ≥ 0이 맞다고 봅니다.')
  expect(unicodeMath('- 손실 $\\mathcal{L}$을 줄인다\n- $x^2$')).toBe('- 손실 ℒ을 줄인다\n- x²')
  expect(unicodeMath('## $\\alpha$ 고르기\n\n> $\\beta$ 도')).toBe('## α 고르기\n\n> β 도')
  expect(unicodeMath('| 식 | 값 |\n| - | - |\n| $|x|$ | 1 |')).toBe('| 식 | 값 |\n| - | - |\n| \\|x\\| | 1 |')
  expect(unicodeMath('so \\(a^2\\) holds')).toBe('so a² holds')
  expect(unicodeMath('no math here')).toBe('no math here')
})

test('a formula alone in its paragraph is centered as display math', async () => {
  const pad = (n: number) => '\u00a0'.repeat(n)
  expect(unicodeMath('합은\n\n$$\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}$$\n\n이다.', 40)).toBe(`합은\n\n${pad(10)}∑ₖ₌₁ⁿ k = n(n + 1)/2\n\n이다.`)
  expect(unicodeMath('$$\nx^2\n$$', 12)).toBe(`${pad(5)}x²`)
  expect(unicodeMath('$$x^2$$')).toBe(`${pad(4)}x²`)
  expect(unicodeMath('$$a$$ and $$b$$ inline')).toBe('a and b inline')
})

test('code spans and code blocks keep their dollars', async () => {
  expect(unicodeMath('run `echo $x$` and $y$')).toBe('run `echo $x$` and y')
  expect(unicodeMath('``a ` $b$`` $d$!')).toBe('``a ` $b$`` d!')
  expect(unicodeMath('```sh\necho $a$\n```\n$b$')).toBe('```sh\necho $a$\n```\nb')
  expect(unicodeMath('- item\n\n   ~~~\n   $a$\n   ~~~')).toBe('- item\n\n   ~~~\n   $a$\n   ~~~')
})

test('amounts, escaped dollars and dollars across paragraphs stay as written', async () => {
  expect(unicodeMath('costs $20 and $30')).toBe('costs $20 and $30')
  expect(unicodeMath('costs \\$5 and $x$.')).toBe('costs \\$5 and x.')
  expect(unicodeMath('$x\n\ny$')).toBe('$x\n\ny$')
})

test('characters markdown acts on are escaped in the converted math', async () => {
  expect(unicodeMath('$s_{dis}$ and $t_{gen}$')).toBe('s\\_(dis) and t\\_(gen)')
  expect(unicodeMath('$x^*$')).toBe('x\\*')
  expect(unicodeMath('$\\foo$')).toBe('\\\\foo')
})
