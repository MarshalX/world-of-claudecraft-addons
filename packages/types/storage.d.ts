/**
 * Your own store for the character in play, rather than for the account.
 *
 * The four calls are the same. What differs is that a key written here belongs to
 * one character, so the tank you raid on and the alt you level keep their own
 * copies. Use it for anything a player would be surprised to find shared: a
 * layout, a per-character threshold, a list of what this character has seen. Use
 * `woc.storage` for a preference that is really about the player.
 *
 * ONE RULE, and it looks inconsistent until you see what it is protecting:
 *
 *   **A read waits for the character. A write refuses to.**
 *
 * Your addon's first line runs at document-start, on the landing page, where
 * nobody has logged in yet and there is no character to key anything on.
 *
 * A read called there simply settles later, at world entry, with the data of
 * whoever actually logged in. That is the answer you wanted no matter which
 * character it turns out to be, so there is nothing to guard against and nothing
 * for you to do. (It never settles at all for a player who closes the page
 * without entering the world, which is correct: there is no per-character data
 * for a character that does not exist.)
 *
 * A write cannot do that, because its VALUE was decided when you called it. Held
 * until world entry, it would take something computed before anyone knew whose it
 * was and store it against whichever character the player then picked, silently.
 * So it rejects instead, and the error says so. Gate on `world.ready`:
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
  /** Rejects before world entry. See the note above for why it cannot wait. */
  set: (key: string, value: unknown) => Promise<void>;
  /** Rejects before world entry, for the same reason `set` does. */
  delete: (key: string) => Promise<void>;
  /** This character's keys only, and yours only. Never another character's. */
  keys: () => Promise<string[]>;
}

/**
 * A note on the character these keys belong to.
 *
 * `woc.world.characterKey` is that identity, published as an opaque string. It
 * is the SAME derivation this store files under, so an addon keeping a ledger
 * across characters can hold one record in `woc.storage` keyed by it and be
 * certain the two agree about whose data a row is. Do not parse it: the format
 * is not part of the contract.
 */

export interface StorageApi {
  /**
   * Read one of your own keys.
   *
   * Deliberately `unknown` rather than generic: nothing validates what comes
   * back, and a generic here would be an unchecked cast dressed up as a type.
   * The value is whatever was stored, which a previous version of your addon
   * may have written differently. Check it before you use it.
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
   * Its own store, not a view over this one: a key set here and a key of the same
   * name set above are two different values, and `keys()` on either answers only
   * about itself.
   */
  character: CharacterStore;
}
