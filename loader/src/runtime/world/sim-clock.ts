// Turning a deadline the server sent into seconds an addon can read.
//
// A loot roll's deadline is on the sim's clock (seconds since start), which neither `woc.now()`
// nor `Date.now()` can be compared with, so it is published as seconds remaining like every
// other timer.
//
// The clock is `NetHub.simNow`, tracked in net/state.ts. Do not read it through a net hub
// subscription: a subscriber makes the hub freeze every snapshot.

/**
 * Seconds left until a sim deadline, clamped at zero, or null before the first snapshot or when
 * the game set no deadline.
 */
export function remainingFrom(deadline: number | null, now: number | null): number | null {
  if (deadline === null || now === null) {
    return null;
  }
  return Math.max(0, deadline - now);
}
