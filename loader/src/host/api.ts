// Assembles the object the host exposes over the bridge.
//
// Build order is a dependency chain rather than a preference: the fetcher needs
// the GM request surface, the marketplace service needs the fetcher, the
// registry needs the marketplace service to know where an addon's files are, and
// the dev watcher needs both the registry and the marketplace service to know
// which bodies to poll.

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

/**
 * Every dev change re-syncs the watcher.
 *
 * Both switches decide whether it should be running, and the host is where that
 * is enforced: the runtime can turn dev mode on through the bridge and must not
 * also have to remember to restart the timer.
 */
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

/**
 * The storage members are forwarded one by one rather than spread, so onChange
 * and dispose stay on this side of the bridge.
 */
function createHostApi(deps: HostApiDeps): HostServices {
  const { storage } = deps;
  const subscribers = new Set<Subscriber>();
  const emit = (event: HostEvent): void => {
    publish(subscribers, event);
  };

  // Subscribed once here rather than once per subscriber: a second manager tab
  // would otherwise make every storage write arrive twice in the first.
  storage.onChange((ns, key, value) => {
    emit({ k: 'storage.changed', ns, key, value });
  });

  const { market, registry, watch } = buildServices(deps, emit);
  // Started from the persisted setting rather than from a call, so hot reload
  // survives a page reload the same way every other setting does.
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

      // The bridge outlives every subscriber, so the unsubscribe is deliberately
      // not surfaced: the port closing is what ends delivery.
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
