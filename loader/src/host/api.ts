// Assembles the object the host exposes over the bridge.
//
// Members whose service does not exist yet reject rather than answering with an
// empty result, so a caller cannot mistake "not built" for "nothing installed".

import { diagError } from '../shared/diag.ts';
import type { HostApi, HostEvent, MarketApi } from '../shared/protocol.ts';
import { createRegistry } from './registry.ts';
import type { HostStorage } from './storage.ts';

type Subscriber = (event: HostEvent) => void;

/** Rejects rather than throwing, for the reason spelled out in host/registry.ts. */
function pending(member: string): Promise<never> {
  return Promise.reject(new Error(`not implemented: ${member}`));
}

const market: MarketApi = {
  list: () => pending('market.list'),
  add: () => pending('market.add'),
  remove: () => pending('market.remove'),
  refresh: () => pending('market.refresh'),
};

/**
 * A subscriber is a Comlink proxy back into the page realm, so a delivery can
 * fail for reasons that have nothing to do with the event: a closed port, or a
 * handler that threw. One failing subscriber must not stop the rest.
 */
function publish(subscribers: ReadonlySet<Subscriber>, event: HostEvent): void {
  for (const subscriber of subscribers) {
    try {
      subscriber(event);
    } catch (err) {
      diagError(`could not deliver a ${event.k} event to a subscriber`, err);
    }
  }
}

export interface HostServices {
  api: HostApi;
  /** Publish a host-originated event, such as the userscript menu command. */
  emit: (event: HostEvent) => void;
}

/**
 * The storage members are forwarded one by one rather than spread, so onChange
 * and dispose stay on this side of the bridge.
 */
export function createHostApi(storage: HostStorage): HostServices {
  const subscribers = new Set<Subscriber>();
  const emit = (event: HostEvent): void => {
    publish(subscribers, event);
  };

  // Subscribed once here rather than once per subscriber: a second manager tab
  // would otherwise make every storage write arrive twice in the first.
  storage.onChange((ns, key, value) => {
    emit({ k: 'storage.changed', ns, key, value });
  });

  const registry = createRegistry({
    storage,
    onChanged: () => {
      emit({ k: 'registry.changed' });
    },
  });

  return {
    emit,

    api: {
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
        subscribers.add(onEvent);
        return Promise.resolve();
      },
    },
  };
}
