import type { On, RenderPropsOf } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const SESSION = { cwd: '/tmp', surface: 'terminal' as const, isInteractive: true }
const REPLY = '저는 $Q \\ge 0$이 맞다고 봅니다.'

// The engine beneath the plugin: no terminal variables, default settings, a
// picture cache that holds every formula when `pictures` is set, and a message
// drawing that shows the text it was handed, or an engine element when
// `engineElement` is set; `observe` sees the props of each drawing.
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
  engine(on)
  await $.session.start(SESSION)
  const text = `식 $x^2$ 입니다.\n\n${TABLE}`
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe(TABLE_UNICODE)
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
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text: '수식 없는 문단입니다.\n\n식 $x^2$ 입니다.', isFirstOfReply: true } })
  expect(delegated).toEqual([])
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('수식 없는 문단입니다.')
  expect((await ui.find({ type: 'Text', text: '⏺' }))?.text).toBe('⏺')
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
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text: '```python\nx = 1\n```\n\n식 $x^2$ 입니다.', isFirstOfReply: false } })
  const drawn = await ui.drawn()
  const firstRow = drawn.type === 'Box' ? drawn.children?.[0] : undefined
  expect((firstRow as { props?: { marginTop?: number } } | undefined)?.props?.marginTop ?? 0).toBe(0)
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

test('picture mode draws prose after math without sending it through the render chain', { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  const delegated: string[] = []
  engine(on, { observe: props => delegated.push(props.text) })
  await $.session.start(SESSION)
  const text = "The square is $x^2$.\n\nYou're close to the answer, but **check** the sign.\n\nDone."
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
  expect(delegated).toEqual([])
  expect((await ui.findAll({ type: 'Markdown' })).map(markdown => markdown.props.text)).toEqual(["You're close to the answer, but **check** the sign.\n\nDone."])
})

test('picture mode delegates only the Mermaid fence and draws its introduction as Markdown', { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  const delegated: string[] = []
  engine(on, { observe: props => delegated.push(props.text) })
  await $.session.start(SESSION)
  const text = `식 $x^2$ 입니다.\n\nHere is the diagram:\n\n${MERMAID}`
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
  expect(delegated.length).toBeGreaterThan(0)
  expect(new Set(delegated)).toEqual(new Set([MERMAID]))
  expect((await ui.findAll({ type: 'Markdown' })).map(markdown => markdown.props.text)).toEqual(['Here is the diagram:'])
})

test('picture mode keeps an indented code fence inside its list prose', { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  const delegated: string[] = []
  engine(on, { observe: props => delegated.push(props.text) })
  await $.session.start(SESSION)
  const text = '1. 실행:\n\n   ```bash\n   echo hi\n   ```\n\n2. 식 $x^2$ 입니다.'
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
  expect(delegated).toEqual([])
  expect((await ui.findAll({ type: 'Markdown' })).map(markdown => markdown.props.text).join('\n\n')).toContain('   ```bash\n   echo hi\n   ```')
})

test('picture mode delegates a nested backtick fence as one code block', { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  const delegated: string[] = []
  engine(on, { pictures: true, observe: props => delegated.push(props.text) })
  await $.session.start(SESSION)
  const block = '````markdown\n```python\nx = 1\n```\n````'
  const text = `식 $x^2$ 입니다.\n\n${block}`
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
  expect(delegated).toEqual([block])
  expect((await ui.findAll({ type: 'Markdown' })).map(markdown => markdown.props.text).join('\n\n')).not.toContain('x = 1')
})

test('picture mode delegates a nested tilde fence as one code block', { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  const delegated: string[] = []
  engine(on, { pictures: true, observe: props => delegated.push(props.text) })
  await $.session.start(SESSION)
  const block = '~~~~markdown\n~~~mermaid\ngraph TD\n  A --> B\n~~~\n~~~~'
  const text = `식 $x^2$ 입니다.\n\n${block}`
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
  expect(delegated).toEqual([block])
  expect((await ui.findAll({ type: 'Markdown' })).map(markdown => markdown.props.text).join('\n\n')).not.toContain('A --> B')
})

test('picture mode does not flatten a deeply indented fence into a math list', { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  const delegated: string[] = []
  engine(on, { pictures: true, observe: props => delegated.push(props.text) })
  await $.session.start(SESSION)
  const text = '- Scale by $\\sqrt{d}$.\n- Then run:\n    ```bash\n    python optimizer.py\n    ```'
  await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
  expect(delegated).toHaveLength(1)
  expect(delegated[0]).toContain('    ```bash\n    python optimizer.py\n    ```')
})

test('a deeply indented code fence keeps dollar variables out of reply math detection', { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  const delegated: string[] = []
  engine(on, { observe: props => delegated.push(props.text) })
  await $.session.start(SESSION)
  const text = 'Steps:\n\n- Build\n    - Run:\n\n      ```bash\n      cd p\n\n      cp "$SRC/$FILE" out/\n      ```'
  await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
  expect(delegated).toEqual([text])
})

test('picture mode closes a code fence before trailing tab whitespace', { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  const delegated: string[] = []
  engine(on, { pictures: true, observe: props => delegated.push(props.text) })
  await $.session.start(SESSION)
  const code = '```python\nx = 1\n```\t'
  const text = `Value $x^2$.\n\n${code}\n\nThen $y$ follows.`
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
  expect(delegated).toEqual([code])
  expect((await ui.findAll({ type: 'Image' })).map(image => image.props.alt)).toContain('y')
})

test('picture mode delegates adjacent code fences as separate runs', { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  const delegated: string[] = []
  engine(on, { pictures: true, observe: props => delegated.push(props.text) })
  await $.session.start(SESSION)
  const python = '```python\nx = 1\n```'
  const mermaid = '```mermaid\ngraph TD\n  A --> B\n```'
  const text = `식 $x^2$ 입니다.\n\n${python}\n${mermaid}`
  await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
  expect(delegated).toEqual([python, mermaid])
})

test('a display formula after a code fence keeps its direct cell growing', { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  engine(on, { pictures: true })
  await $.session.start(SESSION)
  const prose = 'This prose line is deliberately longer than a terminal row. '.repeat(3)
  const code = '```python\nx = 1\n```'
  const text = `${prose}\n\n${code}\n\n$$E = mc^2$$`
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
  expect((await ui.findAll({ type: 'Image' })).map(image => image.props.alt)).toEqual(['E = mc^2'])
  expect((await ui.findAll({ type: 'Box' })).some(box => box.props.flexDirection === 'column' && box.props.gap === 1 && box.props.flexGrow === 1)).toBe(true)
})

test('a tree from a mod below is placed as it comes, with no margin added', { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  engine(on, { pictures: true })
  await $.session.start(SESSION)
  const text = `식 $x^2$ 입니다.\n\n${MERMAID}`
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
  const drawn = await ui.drawn()
  expect(drawn.type === 'Box' ? drawn.children?.[1] : undefined).toMatchObject({ type: 'Text', children: [MERMAID] })
})

test('a reply drawn here starts with the blank row Claude Code puts above a reply', { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  engine(on, { pictures: true })
  await $.session.start(SESSION)
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text: '식 $x^2$ 입니다.', isFirstOfReply: true } })
  const drawn = await ui.drawn()
  expect(drawn.type === 'Box' ? drawn.children?.[0] : undefined).toMatchObject({ type: 'Box', props: { marginTop: 1 } })
})

test('a part that does not open the reply brings its own blank row', { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  engine(on, { pictures: true })
  await $.session.start(SESSION)
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text: '식 $x^2$ 입니다.', isFirstOfReply: false } })
  const drawn = await ui.drawn()
  expect(drawn.type === 'Box' ? drawn.children?.[0] : undefined).toMatchObject({ type: 'Box', props: { marginTop: 1 } })
})

test('picture mode keeps a nested fence pair inside its outer code block', { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  const delegated: string[] = []
  engine(on, { pictures: true, observe: props => delegated.push(props.text) })
  await $.session.start(SESSION)
  const code = '```python\ndef f():\n    """\n        ```python\n        f()\n        ```\n    """\n```'
  const text = `Loss $L$.\n\n${code}\n\nThen $y$.`
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
  expect(delegated).toEqual([code])
  expect((await ui.findAll({ type: 'Image' })).map(image => image.props.alt)).toContain('y')
})

test('the math section asks for Unicode math in an answer to a side question', { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  engine(on)
  on('prompt.compose', async () => ({ sections: [] }))
  await $.session.start(SESSION)
  const facts = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal' as const], tools: [], outputStyle: null, traits: [] }
  const { sections } = await $.prompt.compose(facts)
  const math = sections.find(section => section.id === 'latex-inline:math')
  expect(math?.text).toContain('side question (/btw)')
})
