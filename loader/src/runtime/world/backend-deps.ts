// What the backend needs from OUTSIDE the world object: the DOM, the socket, or a loader clock.

interface BackendDeps {
  /** When damage involving the player last landed. See `world/combat-clock.ts`. */
  lastDamageAt: () => number | null;
  /** The sim's own clock, which deadlines are measured against. */
  simNow: () => number | null;
  now: () => number;
  /** The zone name off the game's minimap label. See `world/zone.ts`. */
  zoneName: () => string | null;
  /**
   * The realm from the socket's hello frame. See `runtime/net/state.ts`. The backend must not
   * reach for the net hub itself.
   */
  realm: () => string | null;
}

export type { BackendDeps };
