// The woc.net surface handed to addons. Mirrors packages/types/net.d.ts.
//
// Read-only by construction: the hub exposes no way to reach the socket, so
// there is no send path to leave out. Every subscription lands in the addon's
// disposal bag, so disabling an addon releases all of them.

import type { DisposalBag } from '../disposal.ts';
import { unlessFrozen } from '../freeze.ts';
import type { SubscribeOpts, Unsubscribe } from '../net/bus.ts';
import type { EventKind, EventPayload } from '../net/events.ts';
import type { FrameType } from '../net/frames.ts';
import type { NetHub } from '../net/hub.ts';
import type { NetState } from '../net/state.ts';

const DEFAULT_WAIT_MS = 30_000;

const NO_OP: Unsubscribe = () => undefined;

interface WaitDeps {
  hub: NetHub;
  bag: DisposalBag;
  timers: NetTimers;
}

/**
 * Both the bag and the addon hold an unsubscribe and either may run first, so an
 * explicit call also unregisters from the bag rather than leaving it holding an
 * entry that does nothing.
 */
function tracked(bag: DisposalBag, off: Unsubscribe): Unsubscribe {
  const drop = bag.add(off);
  return () => {
    drop();
    off();
  };
}

/**
 * Resolve on the next frame of a type, or reject on timeout.
 *
 * Disabling the addon leaves the promise pending rather than rejecting it: a
 * rejection would run the addon's catch after its teardown, which is exactly
 * when it can no longer safely create anything.
 */
function waitForFrame(deps: WaitDeps, type: string, timeout: number): Promise<unknown> {
  const { hub, bag, timers } = deps;
  return new Promise((resolve, reject) => {
    let settled = false;
    let off: Unsubscribe = NO_OP;
    let releaseTimer: Unsubscribe = NO_OP;

    const timer = timers.setTimer(() => {
      if (settled) {
        return;
      }
      settled = true;
      releaseTimer();
      off();
      reject(new Error(`timed out after ${timeout}ms waiting for a ${type} frame`));
    }, timeout);

    releaseTimer = bag.add(() => timers.clearTimer(timer));
    off = tracked(
      bag,
      hub.onFrame(
        type,
        (frame) => {
          settled = true;
          timers.clearTimer(timer);
          releaseTimer();
          off();
          resolve(frame);
        },
        { once: true },
      ),
    );
  });
}

export interface NetTimers {
  setTimer: (handler: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
}

export interface WaitForOpts {
  timeout?: number;
}

export interface NetApi {
  /**
   * A frame type, not any string.
   *
   * Closed where `onEvent` is open, and the difference is the subject: event
   * kinds are content that a game release adds to, while the frame types are the
   * protocol's own small set. The published types have always said `FrameType`
   * here; this said `string` until the parity check for `net` was written and
   * found them disagreeing.
   */
  on: (type: FrameType, handler: (frame: unknown) => void, opts?: SubscribeOpts) => Unsubscribe;
  /**
   * The handler is typed from the kind, and any kind is still accepted.
   *
   * `EventKind` is open, so a kind the catalogue does not describe compiles and
   * hands over `unknown`, exactly as every kind did before the catalogue existed.
   * Narrowing took nothing away.
   */
  onEvent: <K extends EventKind>(
    kind: K,
    handler: (event: EventPayload<K>) => void,
    opts?: SubscribeOpts,
  ) => Unsubscribe;
  onAnyEvent: (handler: (event: unknown) => void, opts?: SubscribeOpts) => Unsubscribe;
  onRaw: (handler: (frame: unknown) => void, opts?: SubscribeOpts) => Unsubscribe;
  onSend: (handler: (frame: unknown) => void, opts?: SubscribeOpts) => Unsubscribe;
  waitFor: (type: FrameType, opts?: WaitForOpts) => Promise<unknown>;
  readonly state: NetState;
}

/**
 * The subscriptions are gated on the freeze switch and `waitFor` is NOT.
 *
 * A frozen `waitFor` would be a promise that never settles: the subscription is
 * `once`, so the bus drops it on the frame the handler was held for, and the
 * addon's await would then hang past the resume with nothing left to wake it.
 * The gate is for repaints, and a pending promise is not one.
 *
 * Traffic that arrives while frozen is dropped rather than queued, so a meter
 * under-counts across a freeze. See runtime/freeze.ts for why that beats
 * replaying a backlog of 20 Hz frames into the resume.
 */
export function createNet(hub: NetHub, bag: DisposalBag, timers: NetTimers): NetApi {
  const waitDeps: WaitDeps = { hub, bag, timers };
  return {
    on: (type, handler, opts) => tracked(bag, hub.onFrame(type, unlessFrozen(handler), opts)),
    // The bus carries parsed JSON, so what arrives is `unknown` and the typed
    // payload is a CLAIM, the same shape of claim `world.on` makes about its
    // keys. It is checked the same way too: the dev-harness addon subscribes
    // against a live game and reports a record that does not look like the type.
    onEvent: (kind, handler, opts) =>
      tracked(bag, hub.onEvent(kind, unlessFrozen(handler as (event: unknown) => void), opts)),
    onAnyEvent: (handler, opts) => tracked(bag, hub.onAnyEvent(unlessFrozen(handler), opts)),
    onRaw: (handler, opts) => tracked(bag, hub.onRaw(unlessFrozen(handler), opts)),
    onSend: (handler, opts) => tracked(bag, hub.onSend(unlessFrozen(handler), opts)),
    waitFor: (type, opts) => waitForFrame(waitDeps, type, opts?.timeout ?? DEFAULT_WAIT_MS),
    get state(): NetState {
      return hub.state();
    },
  };
}
