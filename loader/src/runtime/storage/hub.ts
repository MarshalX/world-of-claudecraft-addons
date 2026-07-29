// The runtime's one door to GM storage.
//
// Every addon's KV and every addon's settings go through here rather than
// holding the bridge remote themselves, for one reason: the host reports a
// change once, as a single `storage.changed` event carrying a namespace, and
// something has to turn that into "this addon's settings moved". Routing it in
// one place is also what keeps a second manager tab from being a special case.
//
// The host echoes local writes back through the same event, so a write made
// here arrives as a change here too. That is deliberate: one path in means a
// subscriber cannot see its own write and a remote write take different shapes.

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

/**
 * Rejects rather than throws, and says which half is missing.
 *
 * An addon that reaches storage without a bridge has no working persistence at
 * all, so answering `undefined` would look like an empty store and let it
 * quietly overwrite the player's real data on the next successful session.
 */
function disconnected(member: string): Promise<never> {
  return Promise.reject(
    new Error(`storage.${member} is unavailable: the loader never connected to its host`),
  );
}

/**
 * One call against the remote, or a rejection naming the member.
 *
 * Written as an explicit null test rather than `remote?.get(...) ?? ...`: the
 * optional call returns a promise either way, so the coalesce would be reached
 * only for a remote that resolved undefined, which is a different thing entirely
 * from having no remote at all.
 */
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
        // Dropped when empty so a session that installs and removes many addons
        // does not accumulate a namespace entry per addon it no longer has.
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
      // Copied before iterating: a handler is allowed to unsubscribe itself, and
      // mutating the live set mid-iteration would skip the next handler.
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
