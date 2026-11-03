import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { RateLimit, Snapshot } from '../types'

const snapshot = atom({ plugin: 'usage-bar', key: 'snapshot' } as const, null)
const isHidden = atom({ plugin: 'usage-bar', key: 'isHidden' } as const, false)

const LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'Spend' }
const CELLS = 10
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']
const TRACK = 'subtle'

export const tone = (pct: number) => (pct >= 90 ? 'error' : pct >= 70 ? 'warning' : 'success')

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

// The SVG is drawn as an image, so it takes raw colors, not theme keys.
const HEX = { success: '#4eba65', warning: '#e5a50a', error: '#e5484d' } as const
const PILL_W = 64
const PILL_H = 8

export const pill = (pct: number) => {
  const r = PILL_H / 2
  const w = pct <= 0 ? 0 : Math.min(PILL_W, Math.max(PILL_H, (pct / 100) * PILL_W))
  const fill = w ? `<rect width="${w.toFixed(1)}" height="${PILL_H}" rx="${r}" fill="${HEX[tone(pct)]}"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PILL_W}" height="${PILL_H}" viewBox="0 0 ${PILL_W} ${PILL_H}"><rect width="${PILL_W}" height="${PILL_H}" rx="${r}" fill="#808080" fill-opacity="0.28"/>${fill}</svg>`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'usage-bar', description: 'Show or hide the usage band above the prompt' })
    const { context, rateLimits, cost } = await $.session.usage()
    const s: Snapshot = { context: { tokens: context.tokens, window: context.window, percent: context.percent }, rateLimits, cost }
    const hidden = (await $.store.get('isHidden')) === true
    await update($, snapshot, () => s)
    await update($, isHidden, () => hidden)
    return next(e)
  })

  on('command.run', { command: 'usage-bar' }, async $ => {
    const hidden = !(await read($, isHidden))
    await $.store.set('isHidden', hidden)
    await update($, isHidden, () => hidden)
    return { text: hidden ? 'Usage band hidden. Run /usage-bar to show it again.' : 'Usage band shown.' }
  })

  on('session.measure', async ($, e, next) => {
    const s: Snapshot = { context: e.context, rateLimits: e.rateLimits, cost: e.cost }
    await update($, snapshot, () => s)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snapshot)
    if (e.props.hasSurvey || s === null || (await read($, isHidden))) return next(e)

    const now = await $.clock.now()
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const Svg = 'Svg' in els ? els.Svg : null
    const color = (pct: number) => (Svg ? HEX[tone(pct)] : tone(pct))

    // Label dim, bar + value carry the color: the eye lands on state, not on chrome.
    const meter = (key: string, label: string, pct: number, detail: string) => {
      const b = bar(pct)
      return (
        <Box key={key} gap={1} alignItems="center" flexShrink={0}>
          <Text dimColor>{label}</Text>
          {Svg ? (
            <Svg source={pill(pct)} alt={`${label} ${pct}%`} width={PILL_W} height={PILL_H} />
          ) : (
            <Box>
              <Text color={tone(pct)} backgroundColor={TRACK}>{b.fill}{b.edge}</Text>
              <Text backgroundColor={TRACK}>{b.rest}</Text>
            </Box>
          )}
          <Text weight="medium" tabular color={color(pct)}>{pct}%</Text>
          {detail ? <Text dimColor tabular>{detail}</Text> : null}
        </Box>
      )
    }

    const ctx = s.context
    const parts = [
      ...s.rateLimits.map((r: RateLimit) => meter(r.kind, LABELS[r.kind] ?? r.kind, r.percentUsed, resetIn(r.resetsAt, now))),
      meter('ctx', 'Context', ctx.percent ?? 0, `${kTokens(ctx.tokens ?? 0)}/${kTokens(ctx.window)}`),
      ...(s.cost ? [<Box key="cost" flexShrink={0}><Text dimColor tabular>≈${s.cost.usd.toFixed(2)}</Text></Box>] : []),
    ]

    // Blocks spread over the full width; when it runs out a whole block wraps, never a piece of one.
    return (
      <Box flexWrap="wrap" justifyContent="space-between" alignItems="center" columnGap={3} rowGap={0}>
        {parts}
      </Box>
    )
  })
}
