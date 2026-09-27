// Who is playing, as the key everything per-character is filed under.
//
// Not on `CharacterInfo`: half of the identity (the realm) comes off the socket, not the self
// payload. The derivation is `characterId` in runtime/character.ts, the ONE shared by storage,
// frame state and addons; this module only reads the name. The key is opaque to addons.

import { characterId } from '../character.ts';
import { readAs } from './backend-read.ts';
import type { Entity } from './game-types.ts';

/**
 * The character in play, or null before world entry and while spectating, never a placeholder
 * key that would collect every character's state.
 *
 * A spectate repoints `world.player` at the watched character, so keying off its name would file
 * per-character state under someone else. Do not remember the pre-spectate key instead: it is
 * empty when the loader starts during a spectate.
 */
function readCharacterKey(realm: string | null, world: unknown): string | null {
  if (typeof readAs<string>(world, 'spectating') === 'string') {
    return null;
  }
  return characterId(realm, readAs<Entity>(world, 'player')?.name ?? null);
}

export { readCharacterKey };
