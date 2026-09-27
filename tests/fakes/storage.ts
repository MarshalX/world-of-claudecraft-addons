// An in-memory storage hub. Like the real one it echoes a local write back as a change, so a
// store cannot pass by relying on its own optimistic update.

import type { StorageChangeHandler, StorageHub } from '../../loader/src/runtime/storage/hub.ts';

interface FakeStorage extends StorageHub {
  /** Everything written, as 'ns/key' to value, for assertions. */
  dump: () => Record<string, unknown>;
  /** Simulate another tab writing, without going through set(). */
  remote: (ns: string, key: string, value: unknown) => void;
  /** Make the next call of each kind reject, to exercise the failure paths. */
  failNext: (message: string) => void;
}

function createFakeStorage(options?: { connected?: boolean }): FakeStorage {
  const values = new Map<string, unknown>();
  const listeners = new Map<string, Set<StorageChangeHandler>>();
  const connected = options?.connected !== false;
  let failure: string | null = null;

  const full = (ns: string, key: string): string => `${ns}/${key}`;

  const deliver = (ns: string, key: string, value: unknown): void => {
    for (const handler of [...(listeners.get(ns) ?? [])]) {
      handler(key, value);
    }
  };

  /** Rejects rather than throws, as a real bridge call does. */
  const guard = (): Promise<void> => {
    if (!connected) {
      return Promise.reject(
        new Error('storage is unavailable: the loader never connected to its host'),
      );
    }
    if (failure !== null) {
      const message = failure;
      failure = null;
      return Promise.reject(new Error(message));
    }
    return Promise.resolve();
  };

  return {
    connected,

    get: async (ns, key) => {
      await guard();
      return values.get(full(ns, key));
    },

    set: async (ns, key, value) => {
      await guard();
      values.set(full(ns, key), value);
      deliver(ns, key, value);
    },

    delete: async (ns, key) => {
      await guard();
      values.delete(full(ns, key));
      deliver(ns, key, undefined);
    },

    keys: async (ns) => {
      await guard();
      const prefix = `${ns}/`;
      return [...values.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length));
    },

    onChange: (ns, handler) => {
      const forNs = listeners.get(ns) ?? new Set<StorageChangeHandler>();
      forNs.add(handler);
      listeners.set(ns, forNs);
      return () => {
        forNs.delete(handler);
      };
    },

    deliver,

    dump: () => Object.fromEntries(values),

    remote: (ns, key, value) => {
      values.set(full(ns, key), value);
      deliver(ns, key, value);
    },

    failNext: (message) => {
      failure = message;
    },
  };
}

export type { FakeStorage };
export { createFakeStorage };
