// The woc.storage.character surface: an addon's own store for ONE character, keyed on realm and
// name, never the per-session pid.
//
// A READ waits for the character and a WRITE refuses to. A read's answer is fixed when it
// resolves, so waiting returns whoever logged in; a write's payload is fixed when called, so
// holding it would land one character's data on another. A write before world entry rejects
// rather than dropping, since a resolved promise says the write happened.

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
  /** Resolves the first time there is a character. */
  known: () => Promise<void>;
}

/** Names the gate, since the fix is one `await`. */
function noCharacter(fqid: string): Error {
  return new Error(
    `${fqid}: woc.storage.character cannot be written to before world entry, because there is ` +
      'no character to write it for yet. Await woc.world.ready first.',
  );
}

function createCharacterStorage(deps: CharacterStorageDeps): CharacterStore {
  const ns = characterNamespace(deps.fqid);

  /** Never resolves for a player who does not enter the world, which is correct. */
  const readKey = async (key: string): Promise<string> => {
    await deps.known();
    const who = deps.character();
    if (who === null) {
      // A guard, not a path: `known()` resolves only once there is a character.
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
      // A stored `null` is a value; only an absent key falls back.
      if (value === undefined) {
        return fallback;
      }
      return value;
    },

    // Async, so the refusal is a rejection, as it would be over Comlink.
    set: async (key, value) => deps.hub.set(ns, writeKey(key), value),

    delete: async (key) => deps.hub.delete(ns, writeKey(key)),

    keys: async () => {
      const own = await prefix();
      // The namespace holds every character's keys; answer only this one's, prefix removed.
      return (await deps.hub.keys(ns))
        .filter((key) => key.startsWith(own))
        .map((key) => key.slice(own.length));
    },
  };
}

export type { CharacterStorageDeps, CharacterStore };
export { createCharacterStorage };
