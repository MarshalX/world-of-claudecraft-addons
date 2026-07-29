// The woc.net surface handed to addons. Mirrors packages/types/net.d.ts.
//
// Read-only by construction: the hub exposes no way to reach the socket, so
// there is no send path to leave out. Every subscription lands in the addon's
// disposal bag, so disabling an addon releases all of them.

import type { DisposalBag } from '../disposal.ts';
import type { SubscribeOpts, Unsubscribe } from '../net/bus.ts';
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
  on: (type: string, handler: (frame: unknown) => void, opts?: SubscribeOpts) => Unsubscribe;
  onEvent: (kind: string, handler: (event: unknown) => void, opts?: SubscribeOpts) => Unsubscribe;
  onAnyEvent: (handler: (event: unknown) => void, opts?: SubscribeOpts) => Unsubscribe;
  onRaw: (handler: (frame: unknown) => void, opts?: SubscribeOpts) => Unsubscribe;
  onSend: (handler: (frame: unknown) => void, opts?: SubscribeOpts) => Unsubscribe;
  waitFor: (type: string, opts?: WaitForOpts) => Promise<unknown>;
  readonly state: NetState;
}

export function createNet(hub: NetHub, bag: DisposalBag, timers: NetTimers): NetApi {
  const waitDeps: WaitDeps = { hub, bag, timers };
  return {
    on: (type, handler, opts) => tracked(bag, hub.onFrame(type, handler, opts)),
    onEvent: (kind, handler, opts) => tracked(bag, hub.onEvent(kind, handler, opts)),
    onAnyEvent: (handler, opts) => tracked(bag, hub.onAnyEvent(handler, opts)),
    onRaw: (handler, opts) => tracked(bag, hub.onRaw(handler, opts)),
    onSend: (handler, opts) => tracked(bag, hub.onSend(handler, opts)),
    waitFor: (type, opts) => waitForFrame(waitDeps, type, opts?.timeout ?? DEFAULT_WAIT_MS),
    get state(): NetState {
      return hub.state();
    },
  };
}
