import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { RateLimit, Snapshot } from '../types'

const snapshot = atom({ plugin: 'usage-bar', key: 'snapshot' } as const, null)
const isHidden = atom({ plugin: 'usage-bar', key: 'isHidden' } as const, false)
// The category whose detail panel is open under the band, or null.
const openKey = atom({ plugin: 'usage-bar', key: 'open' } as const, null)

const LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'Spend' }
const WINDOW_MS: Record<string, number> = { five_hour: 5 * 3_600_000, seven_day: 7 * 86_400_000 }
const CELLS = 10
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']
const TRACK = 'subtle'
const HOVER = 'subtle'

// Blue at exactly 0: nothing used yet reads apart from "a little used".
export const tone = (pct: number) => (pct <= 0 ? 'suggestion' : pct >= 90 ? 'error' : pct >= 70 ? 'warning' : 'success')

// A window whose reset time has passed is back to 0 until the next reading says otherwise.
export const current = (r: RateLimit, now: number): RateLimit =>
  r.resetsAt && Date.parse(r.resetsAt) <= now ? { kind: r.kind, percentUsed: 0 } : r

// Full blocks + one eighth-block edge: a solid bar that moves in 1/8-cell steps.
export const bar = (pct: number) => {
  const eighths = Math.min(CELLS * 8, Math.max(0, Math.round((pct / 100) * CELLS * 8)))
  const full = Math.floor(eighths / 8)
  const edge = EIGHTHS[eighths % 8] ?? ''
  return { fill: '█'.repeat(full), edge, rest: ' '.repeat(CELLS - full - (edge ? 1 : 0)) }
}

export const resetIn = (resetsAt: string | undefined, now: number) => {
  if (!resetsAt) return ''
  const mins = Math.max(0, Math.round((Date.parse(resetsAt) - now) / 60000))
  if (mins >= 1440) return `↻${Math.floor(mins / 1440)}d${Math.floor((mins % 1440) / 60)}h`
  return `↻${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`
}

// Always k, so both sides of "used/window" read in the same unit.
export const kTokens = (n: number) => `${Math.round(n / 1000)}k`

// How much of the window's time has passed, and where usage lands at reset if it keeps this rate.
export const pace = (r: RateLimit, now: number) => {
  const length = WINDOW_MS[r.kind]
  if (!length || !r.resetsAt) return undefined
  const elapsed = Math.min(100, Math.max(0, Math.round(100 - ((Date.parse(r.resetsAt) - now) / length) * 100)))
  return { elapsed, projected: elapsed > 0 ? Math.round((r.percentUsed * 100) / elapsed) : r.percentUsed }
}

// A reading may lack rate limits (none reported yet) or cost: keep the last known ones instead of dropping them.
export const merge = (prev: Snapshot | null, s: Snapshot): Snapshot => {
  const cost = s.cost ?? prev?.cost
  const grew = s.cost && prev?.cost && s.cost.usd > prev.cost.usd
  return {
    context: s.context,
    rateLimits: s.rateLimits.length ? s.rateLimits : (prev?.rateLimits ?? []),
    cost,
    lastUsd: grew ? s.cost!.usd - prev!.cost!.usd : prev?.lastUsd,
  }
}

// Fills the band for the session at hand: at start, and again after /clear, /resume or /branch, which start no session.
async function init($: EngineInterface) {
  const { context, rateLimits, cost } = await $.session.usage()
  // Rate limits are the account's, not the session's: start from the last ones stored (the band shows a reset one at 0).
  const stored = await $.store.get('rateLimits')
  const ctx = { tokens: context.tokens, window: context.window, percent: context.percent }
  const s = merge({ context: ctx, rateLimits: Array.isArray(stored) ? (stored as RateLimit[]) : [] }, { context: ctx, rateLimits, cost })
  const hidden = (await $.store.get('isHidden')) === true
  await update($, snapshot, () => s)
  await update($, isHidden, () => hidden)
}

type Col = { key: string; label: string; value: string; sub?: string; tone?: string }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await init($)
    // The band must not depend on the command: a failed registration only loses /usage-bar.
    await $.command.register({ name: 'usage-bar', description: 'Show or hide the usage band above the prompt' }).catch(() => {})
    return next(e)
  })

  // These go on under a new session id with empty state and no session.start: without this the band stayed blank until the first reply.
  on('command.run', { command: ['clear', 'resume', 'branch'] }, async ($, e, next) => {
    const result = await next(e)
    await init($).catch(() => {})
    return result
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'usage-bar' }, async $ => {
    const hidden = !(await read($, isHidden))
    await $.store.set('isHidden', hidden)
    await update($, isHidden, () => hidden)
    return { text: hidden ? 'Usage band hidden. Run /usage-bar to show it again.' : 'Usage band shown.' }
  })

  on('session.measure', async ($, e, next) => {
    const s: Snapshot = { context: e.context, rateLimits: e.rateLimits, cost: e.cost }
    await update($, snapshot, prev => merge(prev, s))
    if (e.rateLimits.length) await $.store.set('rateLimits', e.rateLimits)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snapshot)
    if (e.props.hasSurvey || s === null || (await read($, isHidden))) return next(e)
    // Other mods share this slot: draw theirs below ours instead of replacing it.
    // next(e) rejects only when nothing answers beneath (the test harness): the band still draws.
    const below = await next(e).catch(() => undefined)

    const now = await $.clock.now()
    const open = await read($, openKey)
    const { Box, Text, Button } = $.ui.resolve(e)
    const toggle = (key: string) => () => update($, openKey, o => (o === key ? null : key))

    // A whole category is one Button, so a click anywhere on it opens its details; the keyed Box lights it under the pointer.
    // A Button holds only Text: the bar is block characters in the monospaced face, on every surface.
    const category = (key: string, label: string, children: unknown) => (
      <Box key={key} hover={{ backgroundColor: HOVER }} backgroundColor={open === key ? HOVER : undefined} flexShrink={0}>
        <Button key={`open-${key}`} plain label={label} onPress={toggle(key)}>
          {children}
        </Button>
      </Box>
    )

    // Label dim, bar + value carry the color: the eye lands on state, not on chrome.
    const meter = (key: string, label: string, pct: number, detail: string) => {
      const b = bar(pct)
      return category(key, label, [
        <Text dimColor>{label} </Text>,
        <Text mono color={tone(pct)} backgroundColor={TRACK}>{b.fill}{b.edge}</Text>,
        <Text mono backgroundColor={TRACK}>{b.rest}</Text>,
        <Text weight="medium" tabular color={tone(pct)}> {pct}%</Text>,
        detail ? <Text dimColor tabular> {detail}</Text> : null,
      ])
    }

    const ctx = s.context
    const parts = [
      ...s.rateLimits.map((r: RateLimit) => current(r, now)).map(r => meter(r.kind, LABELS[r.kind] ?? r.kind, r.percentUsed, resetIn(r.resetsAt, now))),
      meter('ctx', 'Context', ctx.percent ?? 0, `${kTokens(ctx.tokens ?? 0)}/${kTokens(ctx.window)}`),
      ...(s.cost ? [category('cost', `≈$${s.cost.usd.toFixed(2)}`, [<Text dimColor tabular>≈${s.cost.usd.toFixed(2)}</Text>])] : []),
    ]

    // Blocks spread over the full width; when it runs out a whole block wraps, never a piece of one.
    const row = (
      <Box flexWrap="wrap" justifyContent="space-between" alignItems="center" columnGap={2} rowGap={0}>
        {parts}
      </Box>
    )

    const cols = open === null ? [] : await details($, s, open, now)
    const width = e.surface === 'terminal' ? e.props.bodyColumns : undefined
    const panel = cols.length ? (
      <Box flexDirection="column">
        <Text dimColor wrap="truncate-end">{'─'.repeat(e.props.bodyColumns)}</Text>
        <Box flexDirection="row" gap={2}>
          {cols.map(c => (
            // Off the terminal the columns share the row; a width in cells would leave most of it empty and cut the text.
            <Box key={c.key} flexDirection="column" {...(width === undefined ? { flexGrow: 1 } : { width: Math.max(12, Math.floor(width / cols.length) - 2) })}>
              <Text dimColor>{c.label}</Text>
              <Text bold tabular color={c.tone}>{c.value}</Text>
              {c.sub ? <Text dimColor wrap="truncate-end">{c.sub}</Text> : null}
            </Box>
          ))}
        </Box>
      </Box>
    ) : null

    return (
      <Box flexDirection="column">
        {row}
        {panel}
        {below}
      </Box>
    )
  })
}

// The detail panel of one category: a few labelled figures, as ponytail's band lays them out.
async function details($: EngineInterface, s: Snapshot, key: string, now: number): Promise<Col[]> {
  const found = s.rateLimits.find(x => x.kind === key)
  if (found) {
    const r = current(found, now)
    const p = pace(r, now)
    const cols: Col[] = [{ key: 'used', label: 'used', value: `${r.percentUsed}%`, tone: tone(r.percentUsed) }]
    if (r.resetsAt) cols.push({ key: 'reset', label: 'resets in', value: resetIn(r.resetsAt, now).slice(1) })
    if (p) {
      cols.push({ key: 'elapsed', label: 'time elapsed', value: `${p.elapsed}%`, sub: 'of the window' })
      cols.push({ key: 'pace', label: 'at this pace', value: `${p.projected}%`, sub: p.projected > 100 ? 'limit hit before reset' : 'at reset', tone: tone(p.projected) })
    }
    return cols
  }
  if (key === 'ctx') {
    const { tokens = 0, window, percent = 0 } = s.context
    const cols: Col[] = [
      { key: 'used', label: 'used', value: kTokens(tokens), sub: `of ${kTokens(window)}`, tone: tone(percent) },
      { key: 'free', label: 'free', value: kTokens(Math.max(0, window - tokens)) },
    ]
    // Local estimate (no API call), the categories /context lists, largest first.
    const breakdown = (await $.session.usage({ breakdown: 'summary' }).catch(() => undefined))?.context.breakdown
    const top = (breakdown?.categories ?? []).filter(c => c.kind === 'used' && c.tokens > 0).sort((a, b) => b.tokens - a.tokens).slice(0, 3)
    for (const c of top) cols.push({ key: `cat-${c.name}`, label: c.name.toLowerCase(), value: kTokens(c.tokens) })
    if (breakdown?.autoCompactThreshold) cols.push({ key: 'compact', label: 'auto-compact at', value: kTokens(breakdown.autoCompactThreshold) })
    return cols
  }
  if (key === 'cost' && s.cost) {
    const cols: Col[] = [{ key: 'total', label: 'session', value: `$${s.cost.usd.toFixed(2)}`, sub: 'API-equivalent' }]
    if (s.lastUsd !== undefined) cols.push({ key: 'last', label: 'last reply', value: `$${s.lastUsd.toFixed(2)}` })
    return cols
  }
  return []
}
