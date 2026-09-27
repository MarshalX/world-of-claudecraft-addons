// The woc.net surface, mirroring packages/types/net.d.ts. Read-only by construction: the hub has no
// way to reach the socket. Every subscription lands in the addon's disposal bag.

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

/** An explicit unsubscribe also drops the bag entry. */
function tracked(bag: DisposalBag, off: Unsubscribe): Unsubscribe {
  const drop = bag.add(off);
  return () => {
    drop();
    off();
  };
}

/** Disable leaves it pending: a rejection would run the addon's catch after teardown. */
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
  /** Closed where `onEvent` is open: frame types are the protocol's set, kinds are content. */
  on: (type: FrameType, handler: (frame: unknown) => void, opts?: SubscribeOpts) => Unsubscribe;
  /** Typed from the kind; an uncatalogued kind still compiles and hands over `unknown`. */
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
 * Subscriptions are gated on the freeze and `waitFor` is NOT: its `once` subscription is consumed
 * by the held frame, so the await would never settle.
 */
export function createNet(hub: NetHub, bag: DisposalBag, timers: NetTimers): NetApi {
  const waitDeps: WaitDeps = { hub, bag, timers };
  return {
    on: (type, handler, opts) => tracked(bag, hub.onFrame(type, unlessFrozen(handler), opts)),
    // The typed payload is a claim over parsed JSON; dev-harness checks it against a live game.
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
