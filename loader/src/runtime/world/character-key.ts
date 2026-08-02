// Who is playing, as the key everything per-character is filed under.
//
// A world read rather than a member of `CharacterInfo`: every field on that
// record rides the self payload, and half of a character's identity comes off
// the SOCKET instead. Putting it there would make that module's own rule false
// for one field, silently.
//
// The point of publishing it at all is that there must be exactly ONE
// derivation. `woc.storage.character`, the loader's own frame state and two
// addons keeping their own per-character records cannot be allowed to disagree
// about whose data they are holding. The string is OPAQUE: an addon that parses
// it is depending on something the loader has not promised.
//
// The derivation itself is `characterId` in runtime/character.ts and stays
// there, because it is also what the loader's own frame state keys on. What this
// module adds is the READ: pulling the name off the live player entity, which is
// a claim about the game's world object and therefore belongs beside the other
// backend reads rather than beside the string arithmetic.

import { characterId } from '../character.ts';
import { readAs } from './backend-read.ts';
import type { Entity } from './game-types.ts';

/**
 * The character in play, or null before world entry.
 *
 * Null rather than a placeholder for the reason `characterId` returns null: one
 * shared key would collect every character's state and hand the next player in
 * whatever the last one left.
 */
function readCharacterKey(realm: string | null, world: unknown): string | null {
  return characterId(realm, readAs<Entity>(world, 'player')?.name ?? null);
}

export { readCharacterKey };
