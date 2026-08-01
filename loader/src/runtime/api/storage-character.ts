// The woc.storage.character surface: an addon's own store, for ONE character.
//
// `woc.storage` is account-wide, which is right for a preference and wrong for
// anything a player would expect to differ between the tank they raid on and the
// alt they level. The mechanism already existed for the loader's own frame state
// (see kit/frame-state.ts), and the gap this closes is that an addon reaching for
// it by hand keys on the pid, which is the sim's entity id for one session and is
// reissued on the next: keyed on that, everything scatters across a fresh set of
// keys every login and reads to the player as nothing ever having been saved.
//
// THE RULE THAT SHAPES THIS FILE, because it looks inconsistent until it is said
// out loud: a READ waits for the character and a WRITE refuses to.
//
// An addon's first line runs at document-start, on the landing page, where there
// is no character and therefore no key. Both halves have to answer for that
// moment and the honest answers differ, because a read and a write settle at
// different times in the only way that matters:
//
//  - A READ's answer is determined when it RESOLVES. Called on the landing page
//    and settled at world entry, it hands back the data of whoever actually
//    logged in, which is correct whichever character that turns out to be.
//  - A WRITE's payload was determined when it was CALLED. Making it wait would
//    take a value computed before anyone knew whose it was and land it on
//    whichever character the player then picked. That is not a delay, it is one
//    character's data written onto another's, and it is silent.
//
// So a write before world entry rejects, and the message names `world.ready` as
// the gate. Dropping it instead was rejected for being the same silence in a
// different place: an addon that got a resolved promise back has been told the
// write happened.

import type { Channel } from '../../shared/hosts.ts';
import { characterNamespace, perCharacterKey } from '../../shared/storage-keys.ts';
import type { StorageHub } from '../storage/hub.ts';

interface CharacterStore {
  /** Resolves `fallback` when this character has never written the key. */
  get: (key: string, fallback?: unknown) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
  delete: (key: string) => Promise<void>;
  /** This character's keys only, and this addon's only. */
  keys: () => Promise<string[]>;
}

interface CharacterStorageDeps {
  hub: StorageHub;
  fqid: string;
  channel: Channel;
  /** The character in play, or null before world entry. */
  character: () => string | null;
  /** Resolves the first time there IS a character. See the note at the top. */
  known: () => Promise<void>;
}

/**
 * Why a write cannot be held until there is a character.
 *
 * Names the gate rather than only the problem: an addon hitting this at
 * document-start has done nothing unreasonable, and the fix is one `await`.
 */
function noCharacter(fqid: string): Error {
  return new Error(
    `${fqid}: woc.storage.character cannot be written to before world entry, because there is ` +
      'no character to write it for yet. Await woc.world.ready first.',
  );
}

function createCharacterStorage(deps: CharacterStorageDeps): CharacterStore {
  const ns = characterNamespace(deps.fqid);

  /**
   * The key a read uses. Never resolves for a player who does not enter the
   * world, which is correct: there is no per-character data for a character that
   * does not exist, and nothing is on screen waiting for the answer.
   */
  const readKey = async (key: string): Promise<string> => {
    await deps.known();
    const who = deps.character();
    if (who === null) {
      // `known()` resolving without a character would be the world watcher
      // contradicting itself, so this is a guard rather than a path.
      throw noCharacter(deps.fqid);
    }
    return perCharacterKey(deps.channel, who, key);
  };

  /** The key a write uses, decided now or not at all. */
  const writeKey = (key: string): string => {
    const who = deps.character();
    if (who === null) {
      throw noCharacter(deps.fqid);
    }
    return perCharacterKey(deps.channel, who, key);
  };

  /** The character's prefix, for trimming it back off what `keys` answers. */
  const prefix = async (): Promise<string> => readKey('');

  return {
    get: async (key, fallback) => {
      const value = await deps.hub.get(ns, await readKey(key));
      // A stored `null` is a value the addon chose and is returned as one. Only
      // an absent key falls back, which is what GM storage answers with.
      if (value === undefined) {
        return fallback;
      }
      return value;
    },

    // Async, so the refusal is a rejection: Comlink turns a synchronous throw
    // into one anyway, and a surface that threw here and rejected over the
    // bridge would be two different APIs depending on where it was called.
    set: async (key, value) => deps.hub.set(ns, writeKey(key), value),

    delete: async (key) => deps.hub.delete(ns, writeKey(key)),

    keys: async () => {
      const own = await prefix();
      // The namespace holds every character's keys, so the derivation has to be
      // undone as well as applied: an addon asked what IT stored, not what the
      // account did, and a raw list would also leak the other characters' names.
      return (await deps.hub.keys(ns))
        .filter((key) => key.startsWith(own))
        .map((key) => key.slice(own.length));
    },
  };
}

export type { CharacterStorageDeps, CharacterStore };
export { createCharacterStorage };
