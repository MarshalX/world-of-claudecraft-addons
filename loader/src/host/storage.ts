// Namespaced GM value store, keyed `addon:<fqid>:<key>`.
//
// GM values live in the extension's storage area, so addon data is not reachable
// from the page's localStorage.

import type { StorageApi } from '../shared/protocol.ts';
import type { GmAdapter } from './gm.ts';

type ChangeHandler = (ns: string, key: string, value: unknown) => void;

interface ChangeBus {
  emit: ChangeHandler;
  onChange: (handler: ChangeHandler) => () => void;
  clear: () => void;
}

interface RemoteWatcher {
  /** Idempotent: a key is watched once however often it is touched. */
  watch: (ns: string, key: string) => void;
  dispose: () => void;
}

const SEPARATOR = ':';

function gmKey(ns: string, key: string): string {
  return `${ns}${SEPARATOR}${key}`;
}

function createChangeBus(): ChangeBus {
  const handlers = new Set<ChangeHandler>();
  return {
    emit: (ns, key, value) => {
      for (const handler of handlers) {
        handler(ns, key, value);
      }
    },
    onChange: (handler) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    clear: () => handlers.clear(),
  };
}

/**
 * Forwards writes made in other tabs.
 *
 * Local writes are emitted by the mutators instead. Without that split, a
 * manager that reports its own writes would fire twice and one that does not
 * would be silent locally.
 */
function createRemoteWatcher(gm: GmAdapter, emit: ChangeHandler): RemoteWatcher {
  const watchers = new Map<string, () => void>();
  return {
    watch: (ns, key) => {
      const full = gmKey(ns, key);
      if (watchers.has(full)) {
        return;
      }
      watchers.set(
        full,
        gm.onValueChange(full, (change) => {
          if (change.remote) {
            emit(ns, key, change.newValue);
          }
        }),
      );
    },
    dispose: () => {
      for (const stop of watchers.values()) {
        stop();
      }
      watchers.clear();
    },
  };
}

export interface HostStorage extends StorageApi {
  /** Fires for local writes and for writes made in another tab. */
  onChange: (handler: ChangeHandler) => () => void;
  dispose: () => void;
}

/**
 * Values must survive the manager's own serialization, so they are limited to
 * what JSON can carry. That is stricter than the structured clone the bridge
 * itself allows.
 */
export function createHostStorage(gm: GmAdapter): HostStorage {
  const bus = createChangeBus();
  const watcher = createRemoteWatcher(gm, bus.emit);

  return {
    get: async (ns, key) => {
      watcher.watch(ns, key);
      return await gm.getValue<unknown>(gmKey(ns, key), undefined);
    },

    set: async (ns, key, value) => {
      watcher.watch(ns, key);
      await gm.setValue(gmKey(ns, key), value);
      bus.emit(ns, key, value);
    },

    delete: async (ns, key) => {
      watcher.watch(ns, key);
      await gm.deleteValue(gmKey(ns, key));
      bus.emit(ns, key, undefined);
    },

    // A namespace is a prefix rather than a container, so listing means scanning
    // every stored key. Namespaces hold an addon's settings, not bulk data.
    keys: async (ns) => {
      const prefix = gmKey(ns, '');
      const stored = await gm.listValues();
      return stored.filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
    },

    onChange: bus.onChange,

    dispose: () => {
      watcher.dispose();
      bus.clear();
    },
  };
}
