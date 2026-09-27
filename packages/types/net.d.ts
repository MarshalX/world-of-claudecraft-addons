import type { Unsubscribe } from './addon.js';
import type { EventKind, EventPayload } from './events.js';

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
  | 'commandOutcome'
  | 'gbanklog';

export interface SubscribeOpts {
  /**
   * At most one call per N ms, leading edge: the first frame in each window is
   * delivered and the rest are dropped, not deferred.
   *
   * Worth setting on 'snap', which fires 20 times a second.
   */
  throttle?: number;
  once?: boolean;
}

export interface NetState {
  /** The server accepted the session. An open socket alone is not enough. */
  readonly connected: boolean;
  readonly tick: number;
  /** The server's measured rate, or the sim's fixed 20 until one is reported. */
  readonly tickHz: number;
  readonly pid: number | null;
  readonly realm: string | null;
  readonly seed: number | null;
  /**
   * Round trip in milliseconds, or null before the first measurement.
   *
   * Measured by watching an outbound input frame's sequence number against the
   * acknowledgement a later snapshot carries. Nothing is sent to obtain it.
   */
  readonly latencyMs: number | null;
  readonly reconnects: number;
}

/**
 * Read-only: there is no send API. Addons observe frames and never originate
 * them, because the game's terms prohibit automating play.
 *
 * Every frame handed to a handler is frozen, so one addon cannot change what
 * another sees. Every subscription is released when the addon is disabled.
 */
export interface NetApi {
  on: (type: FrameType, handler: (frame: unknown) => void, opts?: SubscribeOpts) => Unsubscribe;
  /**
   * One decoded event kind out of the 'events' frames.
   *
   * The handler's argument is typed from the kind for every kind `EventPayloads`
   * describes, so `onEvent('damage', ...)` receives a `DamageEvent`. Any other
   * kind is still accepted and hands over `unknown`.
   *
   * `castStart` NEVER covers a mob. It fires for a player cast, a pet's cast and
   * the game's timed activities; a mob's cast state reaches you only on the
   * snapshot, so a boss mod on this event hears silence it cannot tell from a
   * boss that never casts. Read `world.casts`, or `world.on('casts', ...)`, for
   * anything but your own casting.
   */
  onEvent: <K extends EventKind>(
    kind: K,
    handler: (event: EventPayload<K>) => void,
    opts?: SubscribeOpts,
  ) => Unsubscribe;
  onAnyEvent: (handler: (event: unknown) => void, opts?: SubscribeOpts) => Unsubscribe;
  /** Every inbound frame, whatever its type. */
  onRaw: (handler: (frame: unknown) => void, opts?: SubscribeOpts) => Unsubscribe;
  /**
   * Outbound frames, observed only.
   *
   * Session credentials are blanked first: the client's first frame on every
   * socket carries the account bearer token, and no addon is given it.
   */
  onSend: (handler: (frame: unknown) => void, opts?: SubscribeOpts) => Unsubscribe;
  waitFor: (type: FrameType, opts?: { timeout?: number }) => Promise<unknown>;
  readonly state: NetState;
}
