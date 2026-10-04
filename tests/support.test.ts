import { expect, test } from 'claude-code/testing'

import { splitMarkdown } from '../hooks/parse'
import { cellWidth, inkFor, mathStyle } from '../hooks/support'

test('markdown longer than the element limit splits at blank lines', async () => {
  const text = ['a'.repeat(6), 'b'.repeat(6), 'c'.repeat(6)].join('\n\n')
  expect(splitMarkdown(text, 14)).toEqual(['aaaaaa\n\nbbbbbb', 'cccccc'])
  expect(splitMarkdown(text, 100)).toEqual([text])
})

test('a single block longer than the limit cannot be split', async () => {
  expect(splitMarkdown(`${'x'.repeat(20)}\n\nshort`, 10)).toBeNull()
})

test('pictures where the terminal shows kitty graphics, Unicode text elsewhere', async () => {
  expect(mathStyle({ TERM_PROGRAM: 'ghostty' }, 'auto')).toBe('pictures')
  expect(mathStyle({ TERM: 'xterm-kitty' }, 'auto')).toBe('pictures')
  expect(mathStyle({ KITTY_WINDOW_ID: '1' }, 'auto')).toBe('pictures')
  expect(mathStyle({ TERM_PROGRAM: 'ghostty', TMUX: '/tmp/tmux-501/default,1,0' }, 'auto')).toBe('text')
  expect(mathStyle({ TERM_PROGRAM: 'iTerm.app' }, 'auto')).toBe('text')
  expect(mathStyle({}, 'auto')).toBe('text')
  expect(mathStyle({ TERM_PROGRAM: 'iTerm.app' }, 'on')).toBe('pictures')
  expect(mathStyle({ TERM_PROGRAM: 'ghostty' }, 'text')).toBe('text')
  expect(mathStyle({ TERM_PROGRAM: 'ghostty' }, 'off')).toBe('off')
})

test('terminal cells: wide scripts take two, combining marks none', async () => {
  expect(cellWidth('abc')).toBe(3)
  expect(cellWidth('합은')).toBe(4)
  expect(cellWidth('y\u0302')).toBe(1)
  expect(cellWidth('A\u0305B\u0305')).toBe(2)
})

test('ink follows the theme unless a color is set', async () => {
  expect(inkFor('dark', 'auto').math).toBe('#e8e8e8')
  expect(inkFor(undefined, 'auto').math).toBe('#e8e8e8')
  expect(inkFor('light-daltonized', 'auto').math).toBe('#24292f')
  expect(inkFor('light', '#123456').math).toBe('#123456')
})
