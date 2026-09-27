// Reads that exist only while the player is standing somewhere.
//
// The market, mailbox, bank and vault answer only while the player is in range of the NPC. That
// is the whole condition: "near" never means the window is open.
//
// A status rather than `T | null`, so `world.market?.listings ?? []` cannot conflate "nothing
// matched" with "not at the Merchant": the closed arms have no member to reach for.

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

/** Where a proximity-gated read stands. Never null: `unknown` means "no world yet". */
type ProximityState<T> = Near<T> | Absent;

const AWAY: Absent = Object.freeze({ status: 'away', info: null });
const UNKNOWN: Absent = Object.freeze({ status: 'unknown', info: null });

/**
 * A reader that rebuilds its wrapper only when the game swaps the object behind it, which the
 * client does only on a real change.
 *
 * `known` says whether a snapshot has decoded, which the value cannot: it is null both out of
 * range and with no player at all.
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
