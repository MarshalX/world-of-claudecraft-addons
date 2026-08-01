// The server's own clock, tracked off the snapshot head.
//
// It exists because some of what the game sends is a DEADLINE rather than a
// duration, and a deadline is meaningless without the clock it was measured
// against. A loot roll expires at `ctx.time + 30`, where `ctx.time` is the sim's
// seconds-since-start, and nothing on the client keeps that number: the client
// reads `time` off each snapshot, uses it while decoding, and drops it.
//
// An addon has `woc.now()`, which is monotonic milliseconds since the loader
// started, and `Date.now()`, which is wall clock. Neither can be compared with a
// sim deadline, so publishing one raw would hand out a number whose only correct
// use is a subtraction the addon cannot perform. Everything else on this API
// reports time as SECONDS REMAINING (auras, cooldowns, casts, charges), and this
// is what lets a deadline be published the same way.

import { fieldNumber } from '../net/frames.ts';
import type { NetHub } from '../net/hub.ts';

export interface SimClock {
  /** The sim's clock in seconds, or null before the first snapshot. */
  now: () => number | null;
  dispose: () => void;
}

export interface SimClockDeps {
  net: NetHub;
}

export function createSimClock(deps: SimClockDeps): SimClock {
  let time: number | null = null;

  const off = deps.net.onFrame('snap', (frame) => {
    const value = fieldNumber(frame, 'time');
    if (value !== null) {
      time = value;
    }
  });

  return {
    now: () => time,
    dispose: off,
  };
}

/**
 * Seconds left until a sim deadline, or null when it cannot be known.
 *
 * Null rather than a guess in two cases that look the same from outside and are
 * not: before the first snapshot there is no clock to measure against, and a
 * deadline the game never set is not a deadline of zero. Clamped at zero once it
 * passes, because a negative countdown is not something a display can draw.
 */
export function remainingFrom(deadline: number | null, now: number | null): number | null {
  if (deadline === null || now === null) {
    return null;
  }
  return Math.max(0, deadline - now);
}
