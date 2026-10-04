import { expect, test } from 'claude-code/testing'

import { cellWidth, inkFor, mathStyle } from '../hooks/support'

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
