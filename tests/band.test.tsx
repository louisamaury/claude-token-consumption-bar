import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'usage-bar',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120, scroll: { offset: 0, bodyRows: 4 }, view: {} },
} as const

const LIMITS = [
  { kind: 'five_hour', percentUsed: 42, resetsAt: '2026-11-03T12:00:00Z' },
  { kind: 'seven_day', percentUsed: 13, resetsAt: '2026-11-08T12:00:00Z' },
]

// Stands for the engine: a fresh session with no reading yet, and a $.store kept in a Map.
const engine = (on: any, store = new Map<string, unknown>(), register: any = () => ({ value: { command: 'usage-bar' } })) => {
  const usage = { context: { window: 200_000 }, rateLimits: [], cost: { usd: 0 } }
  on('command.register', register)
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, ...usage } }))
  on('session.measure', (_: any, e: any) => ({ changed: e.changed }))
  on('clock.now', () => ({ value: Date.parse('2026-11-03T10:00:00Z') }))
  on('store.get', (_: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_: any, e: any) => (store.set(e.key, e.value), { value: undefined }))
  return store
}

// Every word the band draws: Text children, Button labels and SVG alts.
const words = async (ui: any) =>
  [
    ...(await ui.findAll({ type: 'Button' })).map((t: any) => t.text),
    ...(await ui.findAll({ type: 'Text' })).map((t: any) => t.text),
    // The desktop draws the details panel as one SVG: its alt carries the figures.
    ...(await ui.findAll({ type: 'Svg' })).map((t: any) => t.props.alt),
  ].join(' ')

const texts = async ($: any) => {
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const out = await words(ui)
  await ui.unmount()
  return out
}

test('a measurement without rate limits keeps the last known 5h and 7d', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure({ context: { window: 200_000, tokens: 20_000, percent: 10 }, rateLimits: LIMITS, cost: { usd: 1.5 }, changed: ['context', 'rateLimits', 'cost'] })
  await $.session.measure({ context: { window: 200_000, tokens: 30_000, percent: 15 }, rateLimits: [], changed: ['context'] })
  const out = await texts($)
  expect(out).toContain('5h')
  expect(out).toContain('7d')
  expect(out).toContain('≈$1.50')
})

test('a new session shows the 5h and 7d an earlier session stored', async ($, on) => {
  const store = new Map<string, unknown>([['rateLimits', LIMITS]])
  engine(on, store)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const out = await texts($)
  expect(out).toContain('5h')
  expect(out).toContain('42%')
})

test('a stored window that has reset shows 0%, in blue', async ($, on) => {
  const store = new Map<string, unknown>([['rateLimits', [{ kind: 'five_hour', percentUsed: 42, resetsAt: '2026-11-03T09:00:00Z' }]]])
  engine(on, store)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const out = await words(ui)
  expect(out).toContain('5h')
  expect(out).not.toContain('42%')
  const zeros = (await ui.findAll({ type: 'Text', text: /^ ?0%$/ })).map((t: any) => t.props.color)
  expect(zeros).toEqual(['suggestion', 'suggestion'])
  await ui.unmount()
})

test('the band shows even when the command cannot be registered', async ($, on) => {
  engine(on, undefined, () => { throw new Error('already registered') })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(await texts($)).toContain('Context')
})

test('pressing a category opens its detail panel, pressing again closes it', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure({ context: { window: 200_000, tokens: 20_000, percent: 10 }, rateLimits: LIMITS, cost: { usd: 1.5 }, changed: ['context', 'rateLimits', 'cost'] })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await words(ui)).not.toContain('at this pace')
    await ui.press({ key: 'open-five_hour' })
    // 2h left of 5h: 60% of the time gone for 42% used, so 70% at reset.
    const open = await words(ui)
    expect(open).toContain('at this pace')
    expect(open).toContain('70%')
    await ui.press({ key: 'open-five_hour' })
    expect(await words(ui)).not.toContain('at this pace')
    await ui.unmount()
  }
})

test('the cost panel shows what the last reply cost', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure({ context: { window: 200_000 }, rateLimits: [], cost: { usd: 1.5 }, changed: ['cost'] })
  await $.session.measure({ context: { window: 200_000 }, rateLimits: [], cost: { usd: 1.75 }, changed: ['cost'] })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'open-cost' })
  expect(await words(ui)).toContain('$0.25')
  await ui.unmount()
})

test('after /clear the band is filled again without waiting for a reply', async ($, on) => {
  engine(on)
  on('command.run', (_: any, e: any) => ({ text: '' }))
  await $.command.run({ command: 'clear', args: '' })
  expect(await texts($)).toContain('Context')
})

test('on the desktop the pill and colored figures stay, and a press anywhere on the category opens the details', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.session.measure({ context: { window: 200_000, tokens: 0, percent: 0 }, rateLimits: LIMITS, changed: ['context', 'rateLimits'] })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  // Closed, each category draws its figures once, in the flow: they set its size.
  const pills = await ui.findAll({ type: 'Svg' })
  expect(pills.map((p: any) => p.props.alt)).toEqual(['5h 42%', '7d 13%', 'Context 0%'])
  // 0% draws a blue track.
  expect(String(pills[2].props.source)).toContain('#5769f7')
  // The percentages keep their color; the context's token ratio is in the details only.
  const pcts = (await ui.findAll({ type: 'Text', text: /^\d+%$/ })).map((t: any) => [t.text, t.props.color])
  expect(pcts).toEqual([['42%', '#4eba65'], ['13%', '#4eba65'], ['0%', '#5769f7']])
  expect(await words(ui)).not.toContain('/200k')
  // The press target covers the category: a blank-labelled Button in an absolute Box filling it.
  expect((await ui.find({ type: 'Button', key: 'open-five_hour' }))?.props.label).toMatch(/^ +$/)
  await ui.press({ key: 'open-five_hour' })
  expect(await words(ui)).toContain('at this pace')
  await ui.unmount()
})

test('on the desktop the open category turns white and the details have column dividers', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.session.measure({ context: { window: 200_000, tokens: 0, percent: 0 }, rateLimits: LIMITS, cost: { usd: 1.5 }, changed: ['context', 'rateLimits', 'cost'] })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'open-five_hour' })
  // Open, a white primary Button with the hover's own label lies under the figures: one shape for hover and selection.
  const chip = await ui.find({ type: 'Button', key: 'chip-five_hour' })
  const hit = await ui.find({ type: 'Button', key: 'open-five_hour' })
  expect(chip?.props.variant).toBe('primary')
  expect(chip?.props.label).toBe(hit?.props.label)
  expect(await ui.find({ type: 'Button', key: 'chip-seven_day' })).toBeUndefined()
  // Pill and percentage stay, laid over the white in tones readable on it, a copy of the figures in the flow.
  expect((await ui.findAll({ type: 'Svg' })).filter((p: any) => p.props.alt === '5h 42%')).toHaveLength(2)
  expect((await ui.findAll({ type: 'Text', text: '42%' })).map((x: any) => x.props.color)).toContain('#2e7d32')
  const panel = (await ui.findAll({ type: 'Svg' })).find((p: any) => String(p.props.alt).startsWith('used'))
  const source = String(panel?.props.source)
  // A rule on top and a divider between each of the four columns.
  expect(source.match(/class="rule"/g)?.length).toBe(4)
  // The used percentage carries the bar's color in the details too.
  expect(source).toContain('class="fig success" x="0" y="44">42%')
  await ui.press({ key: 'open-cost' })
  expect(await ui.find({ type: 'Button', key: 'chip-five_hour' })).toBeUndefined()
  // The price is a real Button carrying its figure, sized by its text alone: open, the white primary one.
  const cost = await ui.find({ type: 'Button', key: 'open-cost' })
  expect([cost?.props.label, cost?.props.variant]).toEqual(['≈$1.50', 'primary'])
  expect(await ui.find({ type: 'Button', key: 'chip-cost' })).toBeUndefined()
  await ui.unmount()
})
