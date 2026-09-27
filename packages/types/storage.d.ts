/**
 * Your own store for the character in play, rather than for the account.
 *
 * The same four calls as `woc.storage`, but a key written here belongs to one
 * character, so each character keeps its own copy. Use it for anything a player
 * would be surprised to find shared (a layout, a per-character threshold) and
 * `woc.storage` for a preference about the player.
 *
 *   **A read waits for the character. A write refuses to.**
 *
 * Your addon's first line runs on the landing page, before any character exists.
 * A read called there settles at world entry with the data of whoever logged in
 * (and never settles if the player leaves without entering the world). A write's
 * value was decided when you called it, so holding it could store it against the
 * wrong character; it rejects instead. Gate on `world.ready`:
 *
 * ```js
 * await woc.world.ready;
 * await woc.storage.character.set('layout', { x: 20, y: 40 });
 * ```
 */
export interface CharacterStore {
  /**
   * Read one of this character's keys. Waits for world entry if it has to.
   *
   * `fallback` is returned only for a key this character never wrote; a stored
   * null is a value you chose and is returned as one.
   */
  get: (key: string, fallback?: unknown) => Promise<unknown>;
  /** Rejects before world entry. */
  set: (key: string, value: unknown) => Promise<void>;
  /** Rejects before world entry, for the same reason `set` does. */
  delete: (key: string) => Promise<void>;
  /** This character's keys only, and yours only. Never another character's. */
  keys: () => Promise<string[]>;
}

export interface StorageApi {
  /**
   * Read one of your own keys.
   *
   * `unknown` because nothing validates what comes back: the value is whatever
   * was stored, possibly by an earlier version of your addon. Check it before
   * you use it.
   *
   * `fallback` is returned only for a key that was never written; a stored null
   * is a value you chose and is returned as one.
   */
  get: (key: string, fallback?: unknown) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
  delete: (key: string) => Promise<void>;
  /** Your own keys only. Your settings and keybinds live elsewhere. */
  keys: () => Promise<string[]>;
  /**
   * The same four calls, scoped to the character in play.
   *
   * A separate store: a key of the same name here and above holds two different
   * values, and `keys()` on either answers only about itself.
   * `woc.world.characterKey` is the opaque identity it files under, for keying a
   * cross-character record in `woc.storage`; do not parse it.
   */
  character: CharacterStore;
}
