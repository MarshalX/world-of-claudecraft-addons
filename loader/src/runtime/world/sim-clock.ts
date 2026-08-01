// Turning a deadline the server sent into seconds an addon can read.
//
// Some of what the game sends is a DEADLINE rather than a duration, and a deadline
// is meaningless without the clock it was measured against. A loot roll expires at
// `ctx.time + 30`, where `ctx.time` is the sim's seconds-since-start.
//
// An addon has `woc.now()`, which is monotonic milliseconds since the loader
// started, and `Date.now()`, which is wall clock. Neither can be compared with a sim
// deadline, so publishing one raw would hand out a number whose only correct use is
// a subtraction the addon cannot perform. Everything else on this API reports time
// as SECONDS REMAINING (auras, cooldowns, casts, charges), and this is what lets a
// deadline be published the same way.
//
// THE CLOCK ITSELF IS NOT HERE, and used to be. It was a subscriber on the net hub,
// reading `time` off each snapshot, which made it indistinguishable from an addon
// asking for snapshots: the hub freezes a frame when something is subscribed to it,
// so the loader's own reading kept every snapshot of every session on the freezing
// path whether or not any addon had ever asked for one. It reads off the snapshot
// HEAD, which makes it net state rather than world state, so it is tracked in
// net/state.ts beside `tick` and the ack, and reached through `NetHub.simNow`.

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
