// The woc.storage surface, mirroring packages/types/storage.d.ts. The fqid is bound here, so an
// addon sees plain keys and cannot name another's. Values live in GM storage, not localStorage.

import { addonNamespace } from '../../shared/storage-keys.ts';
import type { CharacterStorageDeps, CharacterStore } from './storage-character.ts';
import { createCharacterStorage } from './storage-character.ts';

interface AddonStorageApi {
  /** Resolves `fallback` when the key has never been written. */
  get: (key: string, fallback?: unknown) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
  delete: (key: string) => Promise<void>;
  /** This addon's own keys only. Loader-owned config lives in another namespace. */
  keys: () => Promise<string[]>;
  /** The same calls per character, in a separate namespace so each `keys()` answers for itself. */
  character: CharacterStore;
}

function createStorage(deps: CharacterStorageDeps): AddonStorageApi {
  const { hub, fqid } = deps;
  const ns = addonNamespace(fqid);
  return {
    character: createCharacterStorage(deps),

    get: async (key, fallback) => {
      const value = await hub.get(ns, key);
      // A stored `null` is a value; only an absent key falls back.
      if (value === undefined) {
        return fallback;
      }
      return value;
    },
    set: (key, value) => hub.set(ns, key, value),
    delete: (key) => hub.delete(ns, key),
    keys: () => hub.keys(ns),
  };
}

export type { AddonStorageApi };
export { createStorage };
