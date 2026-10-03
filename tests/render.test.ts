import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const SESSION = { cwd: '/tmp', surface: 'terminal' as const, isInteractive: true }
const REPLY = '저는 $Q \\ge 0$이 맞다고 봅니다.'

// The engine beneath the plugin: no terminal variables, default settings, and
// a message drawing that shows the text it was handed.
function engine(on: On) {
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('env.get', async () => ({ value: undefined }))
  on('settings.read', async () => ({ value: {} }))
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('clock.every', async () => ({ value: undefined }))
  on('fs.exists', async () => ({ value: false }))
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => ({ type: 'Text', props: {}, children: [e.props.text] }))
}

test('in text mode a reply shows its math as Unicode', { options: { mode: 'text' } }, async ($, on) => {
  engine(on)
  await $.session.start(SESSION)
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text: REPLY, isFirstOfReply: true } })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('저는 Q ≥ 0이 맞다고 봅니다.')
})

test('in a terminal without pictures, auto mode shows Unicode', { options: { mode: 'auto' } }, async ($, on) => {
  engine(on)
  await $.session.start(SESSION)
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text: REPLY, isFirstOfReply: true } })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('저는 Q ≥ 0이 맞다고 봅니다.')
})

test('with mode off a reply is drawn as written', { options: { mode: 'off' } }, async ($, on) => {
  engine(on)
  await $.session.start(SESSION)
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text: REPLY, isFirstOfReply: true } })
  expect((await ui.find({ type: 'Text' }))?.text).toBe(REPLY)
})

const TABLE = '| 식 | 값 |\n| - | - |\n| $y_i$ | 1 |'
const TABLE_UNICODE = '| 식 | 값 |\n| - | - |\n| yᵢ | 1 |'

test('in picture mode, math in a table is written as Unicode', { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  engine(on)
  await $.session.start(SESSION)
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text: TABLE, isFirstOfReply: true } })
  expect((await ui.find({ type: 'Text' }))?.text).toBe(TABLE_UNICODE)
})

test('in picture mode, a table beside drawn math is written as Unicode', { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  engine(on)
  await $.session.start(SESSION)
  const text = `식 $x^2$ 입니다.\n\n${TABLE}`
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe(TABLE_UNICODE)
})
