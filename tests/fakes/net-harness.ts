// A net hub wired to controllable taps, a controllable clock, and fake timers.
//
// The hub owns no global, so driving it means calling the taps the socket hook
// would have called. That is the same entry point a real frame takes.

import { createNet, type NetApi } from '../../loader/src/runtime/api/net.ts';
import { DisposalBag } from '../../loader/src/runtime/disposal.ts';
import type { SocketTaps } from '../../loader/src/runtime/net/hook.ts';
import { createNetHub, type NetHub } from '../../loader/src/runtime/net/hub.ts';
import { text } from './frames.ts';

export interface NetHarness {
  net: NetApi;
  hub: NetHub;
  bag: DisposalBag;
  taps: SocketTaps;
  /** Deliver a frame the way an inbound socket message would. */
  inbound: (frame: unknown) => void;
  outbound: (frame: unknown) => void;
  uninstalled: () => boolean;
  runTimers: () => void;
  advance: (ms: number) => void;
  addonOf: (bag: DisposalBag) => NetApi;
}

export function netHarness(): NetHarness {
  let clock = 0;
  let uninstalled = false;
  let captured: SocketTaps | null = null;
  const pending = new Map<number, () => void>();
  let nextTimer = 1;

  const hub = createNetHub({
    now: () => clock,
    install: (installed) => {
      captured = installed;
      return () => {
        uninstalled = true;
      };
    },
  });

  const timers = {
    setTimer: (handler: () => void) => {
      const id = nextTimer;
      nextTimer += 1;
      pending.set(id, handler);
      return id;
    },
    clearTimer: (id: number) => {
      pending.delete(id);
    },
  };

  const bag = new DisposalBag();
  const taps = captured as unknown as SocketTaps;

  return {
    net: createNet(hub, bag, timers),
    hub,
    bag,
    taps,
    inbound: (frame) => taps.onMessage(text(frame)),
    outbound: (frame) => taps.onSend(text(frame)),
    uninstalled: () => uninstalled,
    runTimers: () => {
      for (const handler of [...pending.values()]) {
        handler();
      }
      pending.clear();
    },
    advance: (ms) => {
      clock += ms;
    },
    addonOf: (other) => createNet(hub, other, timers),
  };
}
