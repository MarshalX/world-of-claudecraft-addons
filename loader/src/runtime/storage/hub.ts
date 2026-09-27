// The runtime's one door to GM storage, routing the host's single `storage.changed` event by
// namespace. The host echoes local writes through the same event, so a subscriber sees its own
// write and another tab's in one shape.

import { diagError } from '../../shared/diag.ts';
import type { StorageApi } from '../../shared/protocol.ts';
import type { Teardown } from '../disposal.ts';

type StorageChangeHandler = (key: string, value: unknown) => void;

interface StorageHub extends StorageApi {
  /** True once the bridge handshake succeeded. False makes every call reject. */
  readonly connected: boolean;
  onChange: (ns: string, handler: StorageChangeHandler) => Teardown;
  /** Fed from the host's `storage.changed` event. */
  deliver: (ns: string, key: string, value: unknown) => void;
}

/** Rejects: `undefined` would look like an empty store and invite overwriting real data. */
function disconnected(member: string): Promise<never> {
  return Promise.reject(
    new Error(`storage.${member} is unavailable: the loader never connected to its host`),
  );
}

/** An explicit null test: `remote?.get(...) ?? ...` never reaches the coalesce on a promise. */
function viaRemote<T>(
  remote: StorageApi | null,
  member: string,
  call: (api: StorageApi) => Promise<T>,
): Promise<T> {
  if (remote === null) {
    return disconnected(member);
  }
  return call(remote);
}

function createStorageHub(remote: StorageApi | null): StorageHub {
  const listeners = new Map<string, Set<StorageChangeHandler>>();

  return {
    connected: remote !== null,

    get: (ns, key) => viaRemote(remote, 'get', (api) => api.get(ns, key)),
    set: (ns, key, value) => viaRemote(remote, 'set', (api) => api.set(ns, key, value)),
    delete: (ns, key) => viaRemote(remote, 'delete', (api) => api.delete(ns, key)),
    keys: (ns) => viaRemote(remote, 'keys', (api) => api.keys(ns)),

    onChange: (ns, handler) => {
      const forNs = listeners.get(ns) ?? new Set<StorageChangeHandler>();
      forNs.add(handler);
      listeners.set(ns, forNs);
      return () => {
        forNs.delete(handler);
        // Dropped when empty, so removed addons leave no namespace entry.
        if (forNs.size === 0) {
          listeners.delete(ns);
        }
      };
    },

    deliver: (ns, key, value) => {
      const forNs = listeners.get(ns);
      if (forNs === undefined) {
        return;
      }
      // Copied, since a handler may unsubscribe itself mid-iteration.
      for (const handler of [...forNs]) {
        try {
          handler(key, value);
        } catch (err) {
          diagError(`a storage change handler for ${ns} threw`, err);
        }
      }
    },
  };
}

export type { StorageChangeHandler, StorageHub };
export { createStorageHub };
