import { expect, test } from 'claude-code/testing'

import { bar, blank, kTokens, pill, resetIn, tone } from '../hooks/register'

test('reset countdown formats hours and days', async () => {
  const now = Date.parse('2026-11-03T10:00:00Z')
  expect(resetIn(undefined, now)).toBe('')
  expect(resetIn('2026-11-03T12:13:00Z', now)).toBe('↻2h13')
  expect(resetIn('2026-11-06T14:00:00Z', now)).toBe('↻3d4h')
  expect(resetIn('2026-11-03T09:00:00Z', now)).toBe('↻0h00')
})

test('bar and tone follow the percentage', async () => {
  expect(bar(0)).toEqual({ fill: '', edge: '', rest: ' '.repeat(10) })
  expect(bar(42)).toEqual({ fill: '████', edge: '▎', rest: ' '.repeat(5) })
  expect(bar(130)).toEqual({ fill: '█'.repeat(10), edge: '', rest: '' })
  expect([tone(0), tone(0.1), tone(69), tone(70), tone(90)]).toEqual(['suggestion', 'success', 'success', 'warning', 'error'])
})

test('pill and token formatting', async () => {
  expect(pill(1)).toContain('<rect width="8.0"') // never thinner than round ends
  expect(pill(50)).toContain('<rect width="32.0"')
  expect(pill(95)).toContain('#e5484d')
  expect([kTokens(999), kTokens(148_000), kTokens(1_000_000)]).toEqual(['1k', '148k', '1000k'])
})

test('the desktop press target spans the category', async () => {
  // "7d" + "16%" + "↻5d1h": 10 glyphs, 3 gaps, the 64px pill = 171px measured on the app.
  const px = blank(10, 3, 64).length * 3.8
  expect(px).toBeGreaterThanOrEqual(171)
  expect(px).toBeLessThan(175)
  expect(blank(0, 0)).toBe(' ')
})
