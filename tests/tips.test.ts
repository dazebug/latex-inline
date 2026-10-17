import { expect, test } from 'claude-code/testing'

import { readTips } from '../hooks/tips'

test('a formula without tooltips goes to the renderer as written', async () => {
  expect(readTips('E = mc^2')).toEqual({ tex: 'E = mc^2', tips: [], isWhole: false })
})

test('each tooltip goes to the renderer as \\texttip with its number, its content kept apart', async () => {
  expect(readTips('E = \\texttip{m}{질량} \\texttip{c}{광속}^2')).toEqual({
    tex: 'E = \\texttip{m}{0} \\texttip{c}{1}^2',
    tips: [
      { base: 'm', text: '질량' },
      { base: 'c', text: '광속' },
    ],
    isWhole: false,
  })
})

test('a math tooltip goes as a text one, which MathJax draws without a browser', async () => {
  expect(readTips('\\mathtip{x^2}{x \\cdot x}')).toEqual({ tex: '\\texttip{x^2}{0}', tips: [{ base: 'x^2', tex: 'x \\cdot x' }], isWhole: true })
})

test('an argument without braces is one token, as TeX reads it', async () => {
  expect(readTips('\\texttip x {the input}').tips).toEqual([{ base: 'x', text: 'the input' }])
  expect(readTips('\\texttip\\sigma{spread}')).toEqual({ tex: '\\texttip{\\sigma}{0}', tips: [{ base: '\\sigma', text: 'spread' }], isWhole: true })
})

test('a tooltip inside another is numbered after it', async () => {
  expect(readTips('\\texttip{\\texttip{a}{inner} + b}{outer}')).toEqual({
    tex: '\\texttip{\\texttip{a}{1} + b}{0}',
    tips: [
      { base: '\\texttip{a}{inner} + b', text: 'outer' },
      { base: 'a', text: 'inner' },
    ],
    isWhole: true,
  })
})

test('a tooltip text has its runs of spaces as one', async () => {
  expect(readTips('\\texttip{x}{ the\n  input }').tips).toEqual([{ base: 'x', text: 'the input' }])
})

test('escaped braces do not end an argument', async () => {
  expect(readTips('\\texttip{\\{a\\}}{a set}').tips).toEqual([{ base: '\\{a\\}', text: 'a set' }])
})

test('a longer command, or a tooltip missing an argument, is left as written', async () => {
  expect(readTips('\\texttips{a}{b}')).toEqual({ tex: '\\texttips{a}{b}', tips: [], isWhole: false })
  expect(readTips('a + \\texttip{x}')).toEqual({ tex: 'a + \\texttip{x}', tips: [], isWhole: false })
  expect(readTips('\\mathtip{x}{y')).toEqual({ tex: '\\mathtip{x}{y', tips: [], isWhole: false })
})
