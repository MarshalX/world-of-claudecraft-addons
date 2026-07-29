// Which character is playing, as a key that is stable across sessions.
//
// The obvious candidate is the pid from the `hello` frame, and it is wrong: it
// is the sim's entity id for this session, reissued on the next one, so keying
// per-character UI state on it would scatter a player's frame positions across
// a new set of keys every login.
//
// Realm and character name is what actually identifies a character. Names are
// unique per realm in the game's own model, it is what the game's offline
// keybind scope uses, and both are already in hand: the realm from the `hello`
// frame the loader parses, the name from the live player entity.
//
// Offline play has no realm, and a single browser profile has one offline
// character per class and name, so the literal keeps those from colliding with a
// realm called the same thing.

const OFFLINE_REALM = 'offline';

/**
 * The character key, or null before the player entity exists.
 *
 * Null rather than a placeholder: a placeholder would be one shared key that
 * every character wrote its window positions into, and the first character to
 * log in after a change would inherit the last one's layout.
 */
function characterId(realm: string | null, name: unknown): string | null {
  if (typeof name !== 'string' || name.length === 0) {
    return null;
  }
  return `${realm ?? OFFLINE_REALM}/${name}`;
}

export { characterId, OFFLINE_REALM };
