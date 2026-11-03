export type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }

export type Snapshot = {
  context: { tokens?: number; window: number; percent?: number }
  rateLimits: RateLimit[]
  cost?: { usd: number }
}

declare module 'claude-code' {
  interface PluginState {
    'usage-bar': { snapshot: Snapshot | null; isHidden: boolean }
  }
}
