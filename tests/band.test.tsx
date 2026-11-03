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

// Every word the band draws: Text children and Button labels.
const words = async (ui: any) => [...(await ui.findAll({ type: 'Button' })), ...(await ui.findAll({ type: 'Text' }))].map((t: any) => t.text).join(' ')

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
