// When damage involving the player last landed.
//
// The `recent` fallback behind `readCombat`, kept apart so `combat.ts` stays pure. It reads the
// pid from net state (the hello pid is the entity id), which is up before the world is.
//
// Not gated on the freeze switch: a clock that stopped while frozen would report the player as
// out of combat.

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
    // Either direction counts: taking a hit and landing one are both combat.
    if (fieldNumber(event, 'sourceId') === pid || fieldNumber(event, 'targetId') === pid) {
      last = deps.now();
    }
  });

  return {
    lastDamageAt: () => last,
    dispose: off,
  };
}
