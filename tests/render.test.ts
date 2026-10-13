import type { On, RenderPropsOf } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { DIACRITICS } from '../hooks/copy'

const SESSION = { cwd: '/tmp', surface: 'terminal' as const, isInteractive: true }
const REPLY = '저는 $Q \\ge 0$이 맞다고 봅니다.'

// The engine beneath the plugin: no terminal variables, default settings, a
// picture cache that holds every formula when `pictures` is set, each picture
// `pictureRows` rows tall, and a message drawing that shows the text it was
// handed, or an engine element when `engineElement` is set; `observe` sees
// the props of each drawing.
function engine(
  on: On,
  options: {
    observe?: (props: RenderPropsOf['AssistantMessage']) => void
    pictures?: boolean
    pictureRows?: number
    engineElement?: boolean
    clock?: false
  } = {},
) {
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('env.get', async () => ({ value: undefined }))
  on('settings.read', async () => ({ value: {} }))
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  if (options.clock !== false) on('clock.every', async () => ({ value: undefined }))
  on('fs.exists', async () => ({ value: options.pictures === true }))
  on('fs.read', async () => ({ value: JSON.stringify({ key: 'fixture', file: '/tmp/x.png', columns: 4, rows: options.pictureRows ?? 1 }) }))
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
  expect((await ui.findAll({ type: 'Markdown' })).map(markdown => markdown.props.text)).toContain('```bash\necho hi\n```')
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
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
  expect(delegated).toEqual([])
  expect((await ui.findAll({ type: 'Image' })).map(image => image.props.alt)).toEqual(['\\sqrt{d}'])
  expect((await ui.findAll({ type: 'Markdown' })).map(markdown => markdown.props.text)).toEqual(['  ```bash\n  python optimizer.py\n  ```'])
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

test("a list number sits on the text row of its item's first line", { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  engine(on, { pictures: true, pictureRows: 3 })
  await $.session.start(SESSION)
  // Item 1 has a three-row picture on its first line; item 2 wraps, and its
  // first line holds only words.
  const text = [
    '1. 첫 줄에 $x$ 가 있습니다.',
    '2. 이 항목은 첫 줄을 글자로만 채우고 다음 줄로 넘어간 뒤에야 식이 나오므로 번호는 첫 줄의 글자 옆에 있어야 합니다 $y$ 끝.',
  ].join('\n')
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', viewport: { columns: 40, rows: 24 }, props: { text, isFirstOfReply: true } })
  const numbers = await ui.findAll({ type: 'Text', text: /^\n*\d+\. $/ })
  expect(numbers.map(number => number.text)).toEqual(['\n1. ', '2. '])
  const itemRows = (await ui.findAll({ type: 'Box' })).filter(box => {
    const head = box.children[0] as { type?: string; children?: unknown[] } | undefined
    return head?.type === 'Text' && /^\n*\d+\. $/.test((head.children ?? []).join(''))
  })
  expect(itemRows.map(row => row.props.alignItems)).toEqual(['flex-start', 'flex-start'])
})

test('the first-line measure leaves out the empty last column', { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  engine(on, { pictures: true, pictureRows: 3 })
  await $.session.start(SESSION)
  // At 40 columns the text gets 37: two go to the gutter and the last one
  // stays empty. Each line below is one column too wide for that, so its
  // three-row picture wraps to the next line and the first line is one row.
  const text = `${'a'.repeat(33)} $x$\n\n1. ${'b'.repeat(30)} $y$`
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', viewport: { columns: 40, rows: 24 }, props: { text, isFirstOfReply: true } })
  expect((await ui.findAll({ type: 'Text', text: /⏺/ })).map(bullet => bullet.text)).toEqual(['⏺'])
  expect((await ui.findAll({ type: 'Text', text: /^\n*\d+\. $/ })).map(number => number.text)).toEqual(['1. '])
})

test('a reply drawn before the session starts is drawn again once it has', { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  engine(on, { pictures: true })
  // As at a reload of the plugin's code: the reply on screen is drawn again
  // before session.start has set the plugin up.
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text: '식 $x^2$ 입니다.', isFirstOfReply: true } })
  expect(await ui.findAll({ type: 'Image' })).toEqual([])
  await $.session.start(SESSION)
  expect((await ui.findAll({ type: 'Image' })).map(image => image.props.alt)).toEqual(['x^2'])
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

test('the math section asks for prose without LaTeX commands, which only math is drawn from', { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  engine(on)
  on('prompt.compose', async () => ({ sections: [] }))
  await $.session.start(SESSION)
  const facts = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal' as const], tools: [], outputStyle: null, traits: [] }
  const { sections } = await $.prompt.compose(facts)
  const math = sections.find(section => section.id === 'latex-inline:math')
  expect(math?.text).toContain('\\enquote')
})

type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

// Every element of a drawn tree, depth first.
function walk(node: unknown): Drawn[] {
  if (node === null || typeof node !== 'object') return []
  const element = node as Drawn
  return [element, ...(element.children ?? []).flatMap(walk)]
}

function textOf(node: unknown): string {
  if (typeof node === 'string') return node
  return ((node as Drawn | null)?.children ?? []).map(textOf).join('')
}

// The row of the list item drawn with this number or bullet.
function itemRow(tree: unknown, mark: string): Drawn | undefined {
  return walk(tree).find(box => {
    const head = box.children?.[0] as Drawn | undefined
    return box.type === 'Box' && box.props?.flexDirection === 'row' && head?.type === 'Text' && textOf(head).replace(/^\n+/, '') === mark
  })
}

const NESTED_ITEM = [
  '1. **첫째.** $W$는 보냅니다.',
  '',
  '   $$W = U\\Sigma V^\\top$$',
  '',
  '   여기서 $U$는 행렬입니다.',
  '   - **방향.** $xU$는 투영합니다.',
  '   - **회전.** $V^\\top$이 회전합니다.',
  '',
  '   곧 고르고 돌리는 것입니다.',
  '2. **둘째.** 첫 층뿐입니다.',
].join('\n')

test('the blocks under a list item are drawn indented to its text, with the blank rows the reply has', { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  engine(on, { pictures: true })
  await $.session.start(SESSION)
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text: NESTED_ITEM, isFirstOfReply: true } })
  const tree = await ui.drawn()
  const first = itemRow(tree, '1. ')
  const rows = (walk(tree).find(box => box.children?.includes(first))?.children ?? []) as Drawn[]
  // Each row's indent, the blank rows above it, and its marker or what it draws.
  const shown = (row: Drawn) => {
    const head = row.children?.[0] as Drawn | undefined
    if (head?.type === 'Text') return textOf(head).trim()
    const drawn = walk(row).filter(element => element.type === 'Image' || element.type === 'Markdown')
    return drawn.map(element => element.props?.alt ?? element.props?.text).join(' ')
  }
  expect(rows.map(row => [row.props?.marginLeft ?? 0, row.props?.marginTop ?? 0, shown(row)])).toEqual([
    [0, 0, '1.'],
    [3, 1, 'W = U\\Sigma V^\\top'],
    [3, 1, 'U'],
    [3, 0, '-'],
    [3, 0, '-'],
    [3, 1, '곧 고르고 돌리는 것입니다.'],
    [0, 0, '2.'],
  ])
})

test('a list right under a paragraph is drawn with no blank row between them', { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  engine(on, { pictures: true })
  await $.session.start(SESSION)
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text: '단계는 $x$ 입니다:\n- $a$ 고르기\n- 늘이기', isFirstOfReply: true } })
  const tree = await ui.drawn()
  expect(walk(tree).filter(box => itemRow(box, '- ') === box)).toHaveLength(2)
  const parts = (await ui.findAll({ type: 'Box' })).find(box => box.props.gap === 1)
  expect(parts?.children).toHaveLength(1)
})

test('list items a blank line apart are drawn a blank row apart', { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  engine(on, { pictures: true })
  await $.session.start(SESSION)
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text: '1. $a$\n2. $b$\n\n3. $c$', isFirstOfReply: true } })
  const tree = await ui.drawn()
  expect(['1. ', '2. ', '3. '].map(mark => itemRow(tree, mark)?.props?.marginTop ?? 0)).toEqual([0, 0, 1])
})

test("a nested item's bullet measures its first line in the item's column", { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  engine(on, { pictures: true, pictureRows: 3 })
  await $.session.start(SESSION)
  // At 40 columns the text gets 37; the number above takes 3 and the bullet
  // 2, which leaves 32, too few for the words and the picture: the picture
  // wraps, and the first line is one row.
  const text = `1. $x$ 위\n   - ${'b'.repeat(28)} $y$`
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', viewport: { columns: 40, rows: 24 }, props: { text, isFirstOfReply: true } })
  expect((await ui.findAll({ type: 'Text', text: /^\n*(\d+\.|-) $/ })).map(mark => mark.text)).toEqual(['\n1. ', '- '])
})

test('a list nested many levels deep is still drawn', { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  engine(on, { pictures: true })
  await $.session.start(SESSION)
  // Claude Code refuses a drawing nested deeper than 32 elements.
  const levels = Array.from({ length: 12 }, (_, depth) => depth)
  const text = levels.map(depth => `${'  '.repeat(depth)}- 단계 $x_${depth}$`).join('\n')
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
  expect((await ui.findAll({ type: 'Image' })).map(image => image.props.alt)).toEqual(levels.map(depth => `x_${depth}`))
})

test('an item that starts with a list has its number on a row of its own, as Claude Code draws it', { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  engine(on, { pictures: true, pictureRows: 3 })
  await $.session.start(SESSION)
  const ui = await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', props: { text: '1. - $x$\n2. 둘째', isFirstOfReply: true } })
  const tree = await ui.drawn()
  expect(walk(itemRow(tree, '1. ')).some(element => element.type === 'Image')).toBe(false)
  expect(itemRow(tree, '- ')?.props?.marginLeft).toBe(3)
  expect((await ui.findAll({ type: 'Text', text: /^\n*(\d+\.|-) $|⏺/ })).map(mark => mark.text)).toEqual(['⏺', '1. ', '\n- ', '2. '])
})

// The mouse and the clipboard beneath the plugin: what is selected, what the
// clipboard holds (as `pbpaste` prints it), and every copy the plugin makes.
function desk(on: On) {
  const state = { selected: undefined as { text: string; requestId?: string } | undefined, clipboard: '', reads: 0, copied: [] as string[] }
  on('ui.selection', async () => ({ value: state.selected }))
  on('process.run', async ($, e) => {
    if (e.argv[0] !== 'pbpaste') return { deny: 'not on this machine' }
    state.reads++
    return { value: { exitCode: 0, stdout: state.clipboard, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.copy', async ($, e) => {
    if (e.surface !== 'terminal') return { deny: 'the selection was made on the terminal' }
    state.copied.push(e.text)
    state.clipboard = e.text
    return { value: { isCopied: true as const } }
  })
  return state
}

// One row of a picture's cells, as a selection reads them.
const cells = (row: number, columns: number) =>
  Array.from({ length: columns }, (_, column) => String.fromCodePoint(0x10eeee, DIACRITICS[row] ?? 0, DIACRITICS[column] ?? 0)).join('')

test('a mouse copy of a reply with pictures gets its formulas as LaTeX', { options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  engine(on, { pictures: true, clock: false })
  const clock = mock.clock(on)
  const state = desk(on)
  await $.session.start(SESSION)
  await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', requestId: 'reply-1', props: { text: '넓이 $A$는 크다.', isFirstOfReply: true } })
  const selected = `넓이 ${cells(0, 4)}는 크다.`
  state.selected = { text: selected, requestId: 'reply-1' }
  state.clipboard = selected
  for (let k = 0; k < 3; k++) await clock.advance(200)
  expect(state.copied).toEqual(['넓이 $A$는 크다.'])
})

test('with copy_latex off the clipboard is never read', { options: { mode: 'on', font_metrics: 'manual', copy_latex: false } }, async ($, on) => {
  engine(on, { pictures: true, clock: false })
  const clock = mock.clock(on)
  const state = desk(on)
  await $.session.start(SESSION)
  await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', requestId: 'reply-1', props: { text: '넓이 $A$는 크다.', isFirstOfReply: true } })
  state.selected = { text: `넓이 ${cells(0, 4)}는 크다.`, requestId: 'reply-1' }
  state.clipboard = state.selected.text
  for (let k = 0; k < 3; k++) await clock.advance(200)
  expect(state.reads).toBe(0)
  expect(state.copied).toEqual([])
})

test('a mouse copy gets its LaTeX on either side of a diagram an outer mod splits the reply around', { plugins: [OUTER_MERMAID], options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  engine(on, { pictures: true, clock: false })
  const clock = mock.clock(on)
  const state = desk(on)
  await $.session.start(SESSION)
  const text = `Before $a$ here.\n\n${MERMAID}\n\nAfter $b$ there.`
  await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', requestId: 'reply-1', props: { text, isFirstOfReply: true } })
  for (const { selected, latex } of [
    { selected: `Before ${cells(0, 4)} here.`, latex: 'Before $a$ here.' },
    { selected: `After ${cells(0, 4)} there.`, latex: 'After $b$ there.' },
  ]) {
    state.selected = { text: selected, requestId: 'reply-1' }
    state.clipboard = selected
    for (let k = 0; k < 3; k++) await clock.advance(200)
    expect(state.clipboard).toBe(latex)
  }
})

test('two portions of a split reply are both kept when the second starts with the whole first', { plugins: [OUTER_MERMAID], options: { mode: 'on', font_metrics: 'manual' } }, async ($, on) => {
  engine(on, { pictures: true, clock: false })
  const clock = mock.clock(on)
  const state = desk(on)
  await $.session.start(SESSION)
  // Read alone, the second portion looks like the first grown as the reply
  // streams in.
  const before = 'The formula $a$ is useful here and has enough prose to locate this sentence precisely.'
  const after = `${before} Another formula $b$ follows afterward.`
  await $.ui.mount({ plugin: 'latex-inline', surface: 'terminal', component: 'AssistantMessage', requestId: 'reply-1', props: { text: `${before}\n\n${MERMAID}\n\n${after}`, isFirstOfReply: true } })
  const line = `The formula ${cells(0, 4)} is useful here and has enough prose to locate this sentence precisely.`
  const selected = [line, '', '  diagram', '', `  ${line} Another formula ${cells(0, 4)} follows afterward.`].join('\n')
  state.selected = { text: selected, requestId: 'reply-1' }
  state.clipboard = selected
  for (let k = 0; k < 3; k++) await clock.advance(200)
  expect(state.clipboard).toBe([before, '', 'diagram', '', after].join('\n'))
})
