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
// The desktop press target's label: no-break spaces (HTML would collapse ordinary ones), as many as span the category's
// text, gaps and pill, so the chip hugs them with the Button's own margin, as around Review; its Box never shrinks, so
// a label a little too wide only widens the chip, never cuts it.
// shortcut: widths measured on the desktop app's band (a glyph ≈8.2px, a gap ≈8px, a no-break space ≈3.8px); re-measure if its font changes.
export const blank = (chars: number, gaps: number, px = 0) =>
  ' '.repeat(Math.max(1, Math.ceil((chars * 8.2 + gaps * 8 + px) / 3.8)))

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

// The desktop's bar is an SVG pill, drawn as an image, so it takes raw colors, not theme keys.
const HEX: Record<string, string> = { suggestion: '#5769f7', success: '#4eba65', warning: '#e5a50a', error: '#e5484d' }
// The tones darkened to stay readable on the open category's white chip.
const INK: Record<string, string> = { suggestion: '#3949ab', success: '#2e7d32', warning: '#a86400', error: '#c62828', text: '#191919' }

// The details row as one SVG, after ponytail's band (MIT, DietrichGebert/ponytail): a 1px rule on top, 1px dividers
// between columns, gray labels, white values, in the light or dark theme; a value with a tone takes the bar's color.
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
const PANEL_STYLE = `.l,.s{fill:#87867f;font:12px ${FONT}}.v{fill:#1f1e1d;font:600 16px ${FONT}}.d{stroke:#1f1e1d;stroke-opacity:.12}.suggestion{fill:${INK.suggestion}}.success{fill:${INK.success}}.warning{fill:${INK.warning}}.error{fill:${INK.error}}@media (prefers-color-scheme:dark){.v{fill:#ecebe6}.d{stroke:#fff;stroke-opacity:.14}.suggestion{fill:${HEX.suggestion}}.success{fill:${HEX.success}}.warning{fill:${HEX.warning}}.error{fill:${HEX.error}}}`
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const panelSvg = (cols: Col[], width = 720) => {
  const height = 64
  const colW = width / Math.max(1, cols.length)
  let body = `<line class="d" x1="0" y1="0.5" x2="${width}" y2="0.5"/>`
  cols.forEach((c, i) => {
    const x = i * colW + (i === 0 ? 0 : 12)
    const alert = c.tone ? ` ${c.tone}` : ''
    if (i > 0) body += `<line class="d" x1="${i * colW}" y1="14" x2="${i * colW}" y2="${height - 2}"/>`
    body += `<text class="l" x="${x}" y="24">${esc(c.label)}</text><text class="v${alert}" x="${x}" y="44">${esc(c.value)}</text>`
    if (c.sub) body += `<text class="s" x="${x}" y="61">${esc(c.sub)}</text>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>${PANEL_STYLE}</style>${body}</svg>`
}
const PILL_W = 64
const PILL_H = 8

export const pill = (pct: number, onWhite = false) => {
  const r = PILL_H / 2
  const w = pct <= 0 ? 0 : Math.min(PILL_W, Math.max(PILL_H, (pct / 100) * PILL_W))
  const fill = w ? `<rect width="${w.toFixed(1)}" height="${PILL_H}" rx="${r}" fill="${(onWhite ? INK : HEX)[tone(pct)]}"/>` : ''
  // At 0 the track itself turns blue, so the "nothing used" color shows with no fill.
  const track = pct <= 0 ? `fill="${HEX.suggestion}" fill-opacity="0.45"` : 'fill="#808080" fill-opacity="0.28"'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PILL_W}" height="${PILL_H}" viewBox="0 0 ${PILL_W} ${PILL_H}"><rect width="${PILL_W}" height="${PILL_H}" rx="${r}" ${track}/>${fill}</svg>`
}

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
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : null
    const toggle = (key: string) => () => update($, openKey, o => (o === key ? null : key))

    // Every press in a category opens its details.
    // The terminal draws a Button's Text children, so one Button holds the whole category, and the keyed Box lights it.
    // The desktop draws a Button's label alone, as plain text: there the colored figures are drawn as they are, and a
    // Button with a blank label as wide as them is centered over the category at its natural size, so a press anywhere
    // on it, the pill included, lands, and its own rounded hover, the one Review shows, is the only one there. The open
    // category's white is a primary Button of that same label laid under the figures: one shape for hover and selection.
    // As ponytail's row of Buttons: a thin vertical padding, the row about a Button tall.
    const PAD = { paddingX: 1, paddingY: 'xs' } as const
    const category = (key: string, label: string, children: unknown) => (
      <Box
        key={key}
        {...(Svg ? PAD : { hover: { backgroundColor: HOVER }, backgroundColor: open === key ? HOVER : undefined })}
        gap={1}
        alignItems="center"
        flexShrink={0}
      >
        {children ??
          (Svg && open === key ? (
            <Button key={`open-${key}`} variant="primary" label={label} onPress={toggle(key)} />
          ) : (
            <Button key={`open-${key}`} plain label={label} onPress={toggle(key)} />
          ))}
      </Box>
    )

    // A Button centered over the category at its natural size; its Box never shrinks, since a squeezed Button cuts its
    // label with an ellipsis. The Box's vertical padding makes the row as tall as the Button, so its chip stays inside.
    const target = (slot: string, button: unknown) => (
      <Box key={slot} position="absolute" top={0} left={0} right={0} bottom={0} alignItems="center" justifyContent="center">
        <Box flexShrink={0}>{button}</Box>
      </Box>
    )

    // Label dim, bar + value carry the color: the eye lands on state, not on chrome.
    const meter = (key: string, label: string, pct: number, detail: string) => {
      if (Svg) {
        // The figures in the flow give the category its size. Open, the white Button covers them (the desktop paints
        // positioned Boxes over the flow), so a copy in the white's tones is laid over it, with the same padding from
        // the same edges: it lands exactly on them. Its pill is announced twice while open, the price of a sure width.
        const isOpen = open === key
        const width = blank(label.length + `${pct}%`.length + detail.length, detail ? 3 : 2, PILL_W)
        const figures = (onWhite: boolean) => [
          <Text key="name" color={onWhite ? INK.text : undefined} dimColor={!onWhite}>{label}</Text>,
          <Svg key="pill" source={pill(pct, onWhite)} alt={`${label} ${pct}%`} width={PILL_W} height={PILL_H} />,
          <Text key="pct" tabular color={(onWhite ? INK : HEX)[tone(pct)]}>{`${pct}%`}</Text>,
          detail ? <Text key="detail" tabular color={onWhite ? INK.text : undefined} dimColor={!onWhite}>{detail}</Text> : null,
        ]
        return category(key, label, [
          ...figures(false),
          isOpen ? target('chip', <Button key={`chip-${key}`} variant="primary" label={width} onPress={toggle(key)} />) : null,
          isOpen ? (
            <Box key="figures" position="absolute" top={0} left={0} right={0} bottom={0} {...PAD} gap={1} alignItems="center">
              {figures(true)}
            </Box>
          ) : null,
          target('hit', <Button key={`open-${key}`} plain label={width} onPress={toggle(key)} />),
        ])
      }
      const b = bar(pct)
      return category(key, label, (
        <Button key={`open-${key}`} plain label={label} onPress={toggle(key)}>
          <Text dimColor>{label} </Text>
          <Text color={tone(pct)} backgroundColor={TRACK}>{b.fill}{b.edge}</Text>
          <Text backgroundColor={TRACK}>{b.rest}</Text>
          <Text tabular color={tone(pct)}>{` ${pct}%`}</Text>
          {detail ? <Text dimColor tabular>{` ${detail}`}</Text> : null}
        </Button>
      ))
    }

    const ctx = s.context
    const parts = [
      ...s.rateLimits.map((r: RateLimit) => current(r, now)).map(r => meter(r.kind, LABELS[r.kind] ?? r.kind, r.percentUsed, resetIn(r.resetsAt, now))),
      meter('ctx', 'Context', ctx.percent ?? 0, ''),
      ...(s.cost ? [category('cost', `≈$${s.cost.usd.toFixed(2)}`, null)] : []),
    ]

    // Blocks spread over the full width; when it runs out a whole block wraps, never a piece of one.
    const row = (
      <Box flexWrap="wrap" justifyContent="space-between" alignItems="center" columnGap={2} rowGap={0}>
        {parts}
      </Box>
    )

    const cols = open === null ? [] : await details($, s, open, now)
    const width = e.surface === 'terminal' ? e.props.bodyColumns : undefined
    const panel = !cols.length ? null : Svg ? (
      <Svg source={panelSvg(cols)} alt={cols.map(c => `${c.label} ${c.value}`).join(', ')} />
    ) : (
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
    )

    return (
      <Box flexDirection="column" gap={Svg && panel ? 1 : 0}>
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
