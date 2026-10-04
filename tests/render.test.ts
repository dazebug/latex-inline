import type { On, RenderPropsOf } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const SESSION = { cwd: '/tmp', surface: 'terminal' as const, isInteractive: true }
const REPLY = '저는 $Q \\ge 0$이 맞다고 봅니다.'

// The engine beneath the plugin: no terminal variables, default settings, and
// a message drawing that shows the text it was handed.
function engine(
  on: On,
  options: {
    observe?: (props: RenderPropsOf['AssistantMessage']) => void
    pictures?: boolean
    engineElement?: boolean
  } = {},
) {
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('env.get', async () => ({ value: undefined }))
  on('settings.read', async () => ({ value: {} }))
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('clock.every', async () => ({ value: undefined }))
  on('fs.exists', async () => ({ value: options.pictures === true }))
  on('fs.read', async () => ({ value: JSON.stringify({ key: 'fixture', file: '/tmp/x.png', columns: 4, rows: 1 }) }))
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    options.observe?.(e.props)
    if (options.engineElement) return { type: 'engine', ref: 1 } as never
    return { type: 'Text', props: {}, children: [e.props.text] }
  })
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
  const delegated: string[] = []
  engine(on, { observe: props => delegated.push(props.text) })
  await $.session.start(SESSION)
  const text = `식 $x^2$ 입니다.\n\n${TABLE}`
  await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
  expect(delegated[0]).toBe(TABLE_UNICODE)
})

const MERMAID = '```mermaid\ngraph TD\n  A --> B\n```'

const OUTER_MERMAID = {
  name: 'outer-mermaid-split',
  tier: 'prepend' as const,
  register(on: On) {
    on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
      const separator = '\n\n```mermaid\ngraph TD\n  A --> B\n```\n\n'
      const split = e.props.text.indexOf(separator)
      if (e.surface !== 'terminal' || split < 0) return next(e)
      const { Box, Text } = $.ui.resolve(e)
      const before = await next({ ...e, props: { ...e.props, text: e.props.text.slice(0, split) } })
      const after = await next({ ...e, props: { ...e.props, text: e.props.text.slice(split + separator.length), isFirstOfReply: false } })
      return Box({ flexDirection: 'column', children: [before, Text({ children: ['diagram'] }), after] })
    })
  },
}

test('in picture mode, math beside a Mermaid fence delegates the fence with its reply props', { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  const delegated: RenderPropsOf['AssistantMessage'][] = []
  engine(on, { observe: props => delegated.push(props) })
  await $.session.start(SESSION)
  const onScreen = { first: 2, last: 7, of: 9 }
  const text = `식 $x^2$ 입니다.\n\n${MERMAID}`
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true, onScreen } })
  const delegatedFence = delegated.find(props => props.text === MERMAID)
  expect(delegatedFence?.isFirstOfReply).toBe(false)
  expect(delegatedFence?.onScreen).toEqual(onScreen)
  expect((await ui.find({ type: 'Text', text: MERMAID }))?.text).toBe(MERMAID)
})

test('in picture mode, a markdown block before math keeps the reply bullet', { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  const delegated: RenderPropsOf['AssistantMessage'][] = []
  engine(on, { observe: props => delegated.push(props) })
  await $.session.start(SESSION)
  await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text: '수식 없는 문단입니다.\n\n식 $x^2$ 입니다.', isFirstOfReply: true } })
  expect(delegated[0]?.text).toBe('수식 없는 문단입니다.')
  expect(delegated[0]?.isFirstOfReply).toBe(true)
})

test('an outer Mermaid mod can keep math pictures on both sides of a diagram', { plugins: [OUTER_MERMAID], options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  engine(on, { pictures: true })
  await $.session.start(SESSION)
  const text = `식 $a+b$ 로 시작합니다.\n\n${MERMAID}\n\n그래서 $x^2$ 가 됩니다.`
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
  expect((await ui.drawn()).type).toBe('Box')
  const images = await ui.findAll({ type: 'Image' })
  expect(images).toHaveLength(2)
  expect(images.map(image => image.key)).toEqual([undefined, undefined])
  expect(images.map(image => image.props.alt)).toEqual(['a+b', 'x^2'])
})

test('a first delegated engine block gets a gutter when it does not open the reply', { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  engine(on, { engineElement: true })
  await $.session.start(SESSION)
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text: '수식 없는 문단입니다.\n\n식 $x^2$ 입니다.', isFirstOfReply: false } })
  const drawn = await ui.drawn()
  const firstRow = drawn.type === 'Box' ? drawn.children?.[0] : undefined
  expect(firstRow).toMatchObject({
    type: 'Box',
    props: { flexDirection: 'row' },
    children: [
      { type: 'Box', props: { width: 2, flexShrink: 0 } },
      {
        type: 'Box',
        props: { flexDirection: 'column', flexGrow: 1, flexShrink: 1 },
        children: [{ type: 'engine', ref: 1 }],
      },
    ],
  })
})
