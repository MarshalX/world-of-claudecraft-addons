// Reads that exist only while the player is standing somewhere.
//
// Three of the economy reads are gated by the server on PROXIMITY rather than on
// state: the market answers nothing unless the player is at the Merchant, the
// mailbox unless they are at a raven pillar, the bank unless they are at a
// bursar. Proximity is the WHOLE condition, so this says "in range", never "the
// player has the window open".
//
// Published as a status rather than as `T | null`, and that is this module's
// entire reason to exist. On `T | null` the reading an author writes is
// `world.market?.listings ?? []`, which answers the empty array both when the
// filter matched nothing and when the player is nowhere near a Merchant. Those
// are opposite facts, and the addon tells a player standing in a town that the
// market is empty. There is no member to reach for on the closed arms, so the
// wrong reading cannot be written rather than being caught later.

/** The open arm: the player is at the counter and the reading is real. */
interface Near<T> {
  readonly status: 'near';
  readonly info: T;
}

/** Both closed arms. They carry no payload and differ only in why. */
interface Absent {
  readonly status: 'away' | 'unknown';
  readonly info: null;
}

/**
 * Where a proximity-gated read stands.
 *
 * Never null, unlike most world reads: `unknown` already means "the loader has no
 * world yet", so a null beside it would be a second encoding of one fact.
 */
type ProximityState<T> = Near<T> | Absent;

const AWAY: Absent = Object.freeze({ status: 'away', info: null });
const UNKNOWN: Absent = Object.freeze({ status: 'unknown', info: null });

/**
 * A reader that rebuilds its wrapper only when the game swaps the object behind it.
 *
 * Cached against the source the way the entity map view is in `backend.ts`. The
 * client reassigns its mirror only when the serialized form differed, so the
 * source identity is stable between real changes and a fresh wrapper per read
 * would allocate forty times a second while a player browses.
 *
 * `known` is the caller's answer to "has a snapshot decoded yet", which the value
 * cannot give: the server answers null both for a player out of range and for a
 * session that has no player at all.
 */
function proximityReader<T>(): (raw: unknown, known: boolean) => ProximityState<T> {
  let source: unknown = null;
  let view: ProximityState<T> = UNKNOWN;
  return (raw, known) => {
    if (!known) {
      return UNKNOWN;
    }
    if (raw === null) {
      return AWAY;
    }
    if (raw !== source) {
      source = raw;
      view = { status: 'near', info: raw as T };
    }
    return view;
  };
}

export type { Absent, Near, ProximityState };
export { AWAY, proximityReader, UNKNOWN };
