// The woc.storage surface handed to addons. Mirrors packages/types/storage.d.ts.
//
// An addon sees plain keys and never a namespace: the fqid is bound here, so one
// addon cannot read or overwrite another's data by naming its key, and an addon
// that moves between marketplaces does not carry a namespace it chose itself.
//
// Values go to GM storage, which lives in the extension's own storage area
// rather than the page's localStorage, so an addon's data is not readable by the
// game or by anything else running on the page.

import { addonNamespace } from '../../shared/storage-keys.ts';
import type { StorageHub } from '../storage/hub.ts';

interface AddonStorageApi {
  /** Resolves `fallback` when the key has never been written. */
  get: (key: string, fallback?: unknown) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
  delete: (key: string) => Promise<void>;
  /** This addon's own keys only. Loader-owned config lives in another namespace. */
  keys: () => Promise<string[]>;
}

function createStorage(hub: StorageHub, fqid: string): AddonStorageApi {
  const ns = addonNamespace(fqid);
  return {
    get: async (key, fallback) => {
      const value = await hub.get(ns, key);
      // A stored `null` is a value the addon chose and is returned as one. Only
      // an absent key falls back, which is what GM storage answers with.
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
