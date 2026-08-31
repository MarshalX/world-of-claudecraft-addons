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
 * The character in play, or null before world entry and while spectating.
 *
 * Null rather than a placeholder for the reason `characterId` returns null: one
 * shared key would collect every character's state and hand the next player in
 * whatever the last one left.
 *
 * SPECTATING IS THE SECOND NULL AND IT IS NOT AN EDGE CASE, because it is the
 * only moment the game hands over a `player` who is not the person at the
 * keyboard. A moderator spectate repoints the client's own playerId at the
 * watched character, so `world.player` answers for the ANCHOR for as long as it
 * runs; the game's own note on the field says anything keyed to the identity
 * that owns a session has to consult it or it files itself under someone else's
 * name. Keyed off the name alone, this addon's per-character storage, the
 * loader's frame state and every `characterKey` watcher would move to that
 * character's file mid-session and move back when the spectate ended, silently
 * and in both directions.
 *
 * Refusing is the answer rather than remembering the pre-spectate key: the
 * remembered version is empty in exactly the case it would be reached for, a
 * loader started or an addon enabled DURING a spectate, where it would fall
 * back to the watched character and reintroduce the bug it was added to
 * prevent. Null is a state every consumer already handles, since it is what
 * the whole landing page answers.
 */
function readCharacterKey(realm: string | null, world: unknown): string | null {
  if (typeof readAs<string>(world, 'spectating') === 'string') {
    return null;
  }
  return characterId(realm, readAs<Entity>(world, 'player')?.name ?? null);
}

export { readCharacterKey };
