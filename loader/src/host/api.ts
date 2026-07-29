// Assembles the object the host exposes over the bridge.
//
// Members whose service does not exist yet reject rather than answering with an
// empty result, so a caller cannot mistake "not built" for "nothing installed".

import type { HostApi, MarketApi, RegistryApi } from '../shared/protocol.ts';
import type { HostStorage } from './storage.ts';

function pending(member: string): never {
  throw new Error(`not implemented: ${member}`);
}

const registry: RegistryApi = {
  list: () => pending('registry.list'),
  setEnabled: () => pending('registry.setEnabled'),
  install: () => pending('registry.install'),
  uninstall: () => pending('registry.uninstall'),
  update: () => pending('registry.update'),
  source: () => pending('registry.source'),
};

const market: MarketApi = {
  list: () => pending('market.list'),
  add: () => pending('market.add'),
  remove: () => pending('market.remove'),
  refresh: () => pending('market.refresh'),
};

/**
 * The storage members are forwarded one by one rather than spread, so onChange
 * and dispose stay on this side of the bridge.
 */
export function createHostApi(storage: HostStorage): HostApi {
  return {
    registry,
    market,

    storage: {
      get: (ns, key) => storage.get(ns, key),
      set: (ns, key, value) => storage.set(ns, key, value),
      delete: (ns, key) => storage.delete(ns, key),
      keys: (ns) => storage.keys(ns),
    },

    // The bridge outlives every subscriber, so the unsubscribe is deliberately
    // not surfaced: the port closing is what ends delivery.
    subscribe: (onEvent) => {
      storage.onChange((ns, key, value) => {
        onEvent({ k: 'storage.changed', ns, key, value });
      });
      return Promise.resolve();
    },
  };
}
