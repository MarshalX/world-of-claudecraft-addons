// Everything Browse, Marketplaces, and Updates can do, over the bridge.
//
// Split from catalog-store.ts, which owns the reading, because the two halves
// have nothing to say to each other beyond `act`: an action runs, and then the
// store re-reads. Nothing here inspects state or decides what it should become.
//
// Every action is a no-op without a bridge. Doing nothing rather than throwing:
// the pane already reports the unreachable state, and a rejection out of a click
// handler would be a second report of the same fact with nowhere to go.

import type { InstalledAddon, MarketApi, UpdateRow } from '../../../shared/protocol.ts';
import { inSeries } from '../../../shared/sequence.ts';

/** The registry members the three catalog panes call. */
interface CatalogRegistry {
  /**
   * The whole installed row, though only the fqid is read.
   *
   * Declared as what the registry actually answers rather than as the narrow
   * shape used here, because this interface is intersected with the Installed
   * pane's in ManagerRegistry: two `list` members disagreeing about their return
   * type would intersect into something nothing can satisfy.
   */
  list: () => Promise<InstalledAddon[]>;
  install: (fqid: string) => Promise<void>;
  update: (fqid: string) => Promise<void>;
  setPin: (fqid: string, version: string | null) => Promise<void>;
  updates: () => Promise<UpdateRow[]>;
}

interface CatalogServices {
  /** Both are null together when the bridge never connected. */
  market: MarketApi | null;
  registry: CatalogRegistry | null;
}

interface CatalogActions {
  /** Re-read one source's index, or every source's. Goes to the network. */
  refresh: (id?: string) => void;
  install: (fqid: string) => void;
  update: (fqid: string) => void;
  /** Update each of these in turn. The pane decides which rows qualify. */
  updateAll: (fqids: readonly string[]) => void;
  setPin: (fqid: string, version: string | null) => void;
  addMarket: (url: string, ref: string) => void;
  removeMarket: (id: string) => void;
  setMarketRef: (id: string, ref: string) => void;
}

/** Mark something busy, run one call, and let the store re-read afterwards. */
type Act = (busy: string | null, run: () => Promise<void>) => void;

/** The source-list writes, which are what the Marketplaces pane drives. */
function marketActions(
  services: CatalogServices,
  act: Act,
): Pick<CatalogActions, 'refresh' | 'addMarket' | 'removeMarket' | 'setMarketRef'> {
  const withMarket = (busy: string | null, run: (market: MarketApi) => Promise<void>): void => {
    const { market } = services;
    if (market !== null) {
      act(busy, () => run(market));
    }
  };

  return {
    refresh: (id) => {
      withMarket(id ?? null, (market) => market.refresh(id));
    },
    addMarket: (url, ref) => {
      withMarket(null, (market) => market.add(url, ref));
    },
    removeMarket: (id) => {
      withMarket(id, (market) => market.remove(id));
    },
    setMarketRef: (id, ref) => {
      withMarket(id, (market) => market.setRef(id, ref));
    },
  };
}

/** The installed-set writes, which are what Browse and Updates drive. */
function registryActions(
  services: CatalogServices,
  act: Act,
): Pick<CatalogActions, 'install' | 'update' | 'updateAll' | 'setPin'> {
  const withRegistry = (
    busy: string | null,
    run: (registry: CatalogRegistry) => Promise<void>,
  ): void => {
    const { registry } = services;
    if (registry !== null) {
      act(busy, () => run(registry));
    }
  };

  return {
    install: (fqid) => {
      withRegistry(fqid, (registry) => registry.install(fqid));
    },
    update: (fqid) => {
      withRegistry(fqid, (registry) => registry.update(fqid));
    },
    setPin: (fqid, version) => {
      withRegistry(fqid, (registry) => registry.setPin(fqid, version));
    },

    // One at a time, and a failure stops the run rather than pressing on. Each
    // update re-fetches a body from a marketplace, so a burst is the request
    // pattern a rate limit answers worst, and if the source has started refusing
    // then every addon after this one would fail the same way.
    updateAll: (fqids) => {
      withRegistry(null, (found) => inSeries(fqids, (fqid) => found.update(fqid)));
    },
  };
}

function createCatalogActions(services: CatalogServices, act: Act): CatalogActions {
  return { ...marketActions(services, act), ...registryActions(services, act) };
}

export type { Act, CatalogActions, CatalogRegistry, CatalogServices };
export { createCatalogActions };
