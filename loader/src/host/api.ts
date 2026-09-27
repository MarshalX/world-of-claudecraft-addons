// Assembles the object the host exposes over the bridge.

import { diagError } from '../shared/diag.ts';
import type { DevApi, HostApi, HostEvent } from '../shared/protocol.ts';
import { createDevWatch, type DevWatch } from './dev-watch.ts';
import { createFetcher } from './fetcher.ts';
import type { GmAdapter } from './gm.ts';
import { createMarketService, type MarketService } from './marketplace.ts';
import { createRegistry } from './registry.ts';
import type { HostStorage } from './storage.ts';

type Subscriber = (event: HostEvent) => void;

/**
 * A subscriber is a Comlink proxy into the page realm and can fail on a closed port or a
 * throwing handler; one failure must not stop the rest.
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

interface HostServices {
  api: HostApi;
  /** Publish a host-originated event, such as the userscript menu command. */
  emit: (event: HostEvent) => void;
  watch: DevWatch;
  dispose: () => void;
}

interface HostApiDeps {
  storage: HostStorage;
  gm: GmAdapter;
  setTimer: (handler: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
  now: () => number;
}

/** The dependency chain, built in the one order it can be built in. */
function buildServices(deps: HostApiDeps, emit: (event: HostEvent) => void) {
  const { storage, gm } = deps;
  const fetcher = createFetcher({ request: gm.request, cache: gm });
  const market = createMarketService({ storage, fetcher, emit, now: deps.now });
  const registry = createRegistry({
    storage,
    market,
    fetcher,
    onChanged: () => {
      emit({ k: 'registry.changed' });
    },
  });
  const watch = createDevWatch({
    registry,
    market,
    fetcher,
    emit,
    setTimer: deps.setTimer,
    clearTimer: deps.clearTimer,
  });
  return { market, registry, watch };
}

/** Every dev switch re-syncs the watcher here, so the runtime never has to restart it. */
function wrapDev(market: MarketService, watch: DevWatch): DevApi {
  return {
    state: market.dev.state,
    setEnabled: async (on) => {
      await market.dev.setEnabled(on);
      watch.sync();
    },
    setHotReload: async (on) => {
      await market.dev.setHotReload(on);
      watch.sync();
    },
  };
}

/** Storage members are forwarded one by one, not spread, so onChange and dispose stay here. */
function createHostApi(deps: HostApiDeps): HostServices {
  const { storage } = deps;
  const subscribers = new Set<Subscriber>();
  const emit = (event: HostEvent): void => {
    publish(subscribers, event);
  };

  // Once here, not per subscriber, or a second subscriber would double every storage event.
  storage.onChange((ns, key, value) => {
    emit({ k: 'storage.changed', ns, key, value });
  });

  const { market, registry, watch } = buildServices(deps, emit);
  // From the persisted setting, so hot reload survives a page reload.
  watch.sync();

  return {
    emit,
    watch,

    api: {
      registry,
      market: market.api,
      dev: wrapDev(market, watch),

      storage: {
        get: (ns, key) => storage.get(ns, key),
        set: (ns, key, value) => storage.set(ns, key, value),
        delete: (ns, key) => storage.delete(ns, key),
        keys: (ns) => storage.keys(ns),
      },

      // No unsubscribe: the port closing is what ends delivery.
      subscribe: (onEvent) => {
        subscribers.add(onEvent);
        return Promise.resolve();
      },
    },

    dispose: () => {
      watch.dispose();
      subscribers.clear();
    },
  };
}

export type { HostApiDeps, HostServices };
export { createHostApi };
