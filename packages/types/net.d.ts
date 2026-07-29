import type { Unsubscribe } from './addon.js';

export type FrameType =
  | 'hello'
  | 'snap'
  | 'events'
  | 'social'
  | 'socialpos'
  | 'censor'
  | 'error'
  | 'challenge'
  | 'spectate'
  | 'commandOutcome';

export interface SubscribeOpts {
  /** Coalesce to at most one call per N ms. 'snap' fires at 20 Hz. */
  throttle?: number;
  once?: boolean;
}

export interface NetState {
  readonly connected: boolean;
  readonly tick: number;
  readonly tickHz: number;
  readonly pid: number | null;
  readonly realm: string | null;
  readonly seed: number | null;
  readonly latencyMs: number | null;
  readonly reconnects: number;
}

/**
 * Read-only: there is no send API. Addons observe frames and never originate
 * them, because the game's terms prohibit automating play.
 */
export interface NetApi {
  on: (type: FrameType, handler: (frame: unknown) => void, opts?: SubscribeOpts) => Unsubscribe;
  onEvent: (kind: string, handler: (event: unknown) => void, opts?: SubscribeOpts) => Unsubscribe;
  onAnyEvent: (handler: (event: unknown) => void, opts?: SubscribeOpts) => Unsubscribe;
  onRaw: (handler: (frame: unknown) => void, opts?: SubscribeOpts) => Unsubscribe;
  onSend: (handler: (frame: unknown) => void, opts?: SubscribeOpts) => Unsubscribe;
  waitFor: (type: FrameType, opts?: { timeout?: number }) => Promise<unknown>;
  readonly state: NetState;
}
