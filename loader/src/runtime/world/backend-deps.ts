// What the backend needs that the game's world object does not carry.
//
// Its own module because several of the backend's read groups take it and they
// live in several files now. Everything here has a source OUTSIDE the world
// object: the DOM, the socket, or a clock the loader keeps itself.

interface BackendDeps {
  /** When damage involving the player last landed. See `world/combat-clock.ts`. */
  lastDamageAt: () => number | null;
  /** The sim's own clock, which deadlines are measured against. */
  simNow: () => number | null;
  now: () => number;
  /**
   * The zone name off the game's own minimap label.
   *
   * A dep rather than a read off the world object because its source is the DOM:
   * the zone table is content the loader cannot reach. See `world/zone.ts`.
   */
  zoneName: () => string | null;
  /**
   * The realm from the socket's hello frame. See `runtime/net/state.ts`.
   *
   * A dep for the same reason `zoneName` is one: half of a character's identity
   * comes off the SOCKET rather than off the world object, and the backend must
   * not reach for the net hub itself.
   */
  realm: () => string | null;
}

export type { BackendDeps };
