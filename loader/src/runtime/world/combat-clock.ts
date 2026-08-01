// When damage involving the player last landed.
//
// The last resort behind `readCombat`, and the only part of that reading which
// needs memory rather than a look at current state. It lives here rather than in
// `combat.ts` so the rule itself stays a pure function of its inputs and can be
// tested without a clock or a socket.
//
// It reads the player's id from the net state rather than from the world: the
// pid on the hello frame IS the sim entity id for the session, and the socket
// half of the runtime is up before the world half is, so this works from the
// first frame rather than from world entry.
//
// Not gated on the freeze switch. Freezing exists to stop addon repaints, and a
// clock that stopped noticing combat while frozen would report the player as
// having left it, which is a wrong answer rather than a paused one.

import { fieldNumber } from '../net/frames.ts';
import type { NetHub } from '../net/hub.ts';

export interface CombatClock {
  /** Milliseconds on the runtime's clock, or null before any damage was seen. */
  lastDamageAt: () => number | null;
  dispose: () => void;
}

export interface CombatClockDeps {
  net: NetHub;
  now: () => number;
}

export function createCombatClock(deps: CombatClockDeps): CombatClock {
  let last: number | null = null;

  const off = deps.net.onEvent('damage', (event) => {
    const { pid } = deps.net.state();
    if (pid === null) {
      return;
    }
    // Either direction counts: taking a hit and landing one are both combat, and
    // a fight where the player only takes damage is exactly the case the three
    // state branches ahead of this one are least likely to have answered.
    if (fieldNumber(event, 'sourceId') === pid || fieldNumber(event, 'targetId') === pid) {
      last = deps.now();
    }
  });

  return {
    lastDamageAt: () => last,
    dispose: off,
  };
}
