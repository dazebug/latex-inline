import { expect, test } from 'claude-code/testing'

import { splitMarkdown } from '../hooks/parse'
import { canDrawImages, inkFor } from '../hooks/support'

test('markdown longer than the element limit splits at blank lines', async () => {
  const text = ['a'.repeat(6), 'b'.repeat(6), 'c'.repeat(6)].join('\n\n')
  expect(splitMarkdown(text, 14)).toEqual(['aaaaaa\n\nbbbbbb', 'cccccc'])
  expect(splitMarkdown(text, 100)).toEqual([text])
})

test('a single block longer than the limit cannot be split', async () => {
  expect(splitMarkdown(`${'x'.repeat(20)}\n\nshort`, 10)).toBeNull()
})

test('pictures are drawn only where the terminal shows kitty graphics', async () => {
  expect(canDrawImages({ TERM_PROGRAM: 'ghostty' }, 'auto')).toBe(true)
  expect(canDrawImages({ TERM: 'xterm-kitty' }, 'auto')).toBe(true)
  expect(canDrawImages({ KITTY_WINDOW_ID: '1' }, 'auto')).toBe(true)
  expect(canDrawImages({ TERM_PROGRAM: 'ghostty', TMUX: '/tmp/tmux-501/default,1,0' }, 'auto')).toBe(false)
  expect(canDrawImages({ TERM_PROGRAM: 'iTerm.app' }, 'auto')).toBe(false)
  expect(canDrawImages({ TERM_PROGRAM: 'iTerm.app' }, 'on')).toBe(true)
  expect(canDrawImages({ TERM_PROGRAM: 'ghostty' }, 'off')).toBe(false)
})

test('ink follows the theme unless a color is set', async () => {
  expect(inkFor('dark', 'auto').math).toBe('#e8e8e8')
  expect(inkFor(undefined, 'auto').math).toBe('#e8e8e8')
  expect(inkFor('light-daltonized', 'auto').math).toBe('#24292f')
  expect(inkFor('light', '#123456').math).toBe('#123456')
})
