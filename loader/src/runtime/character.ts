// Which character is playing, stable across sessions: realm plus name, unique per realm. NOT the
// hello pid, which is reissued every session and would scatter state across new keys each login.

const OFFLINE_REALM = 'offline';

/** Null before the player exists, never a placeholder every character would share. */
function characterId(realm: string | null, name: unknown): string | null {
  if (typeof name !== 'string' || name.length === 0) {
    return null;
  }
  return `${realm ?? OFFLINE_REALM}/${name}`;
}

export { characterId, OFFLINE_REALM };
