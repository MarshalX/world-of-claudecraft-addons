// The five stores the manager window reads, and what wakes them. They load outside the component
// tree, so a reload from another tab does not need the window open.
//
// When the installed rows land, the open addon's page is re-checked against them, or an addon
// updated under an open page draws the new manifest's controls over the old manifest's stores.
//
// Its own deps interface so this module never imports index.tsx, which imports it.

import type { DevApi, MarketApi } from '../../../shared/protocol.ts';
import type { CatalogRegistry } from './catalog-actions.ts';
import { type CatalogStore, createCatalogStore } from './catalog-store.ts';
import type { ConfigService } from './config.ts';
import { createDevStore, type DevStore } from './dev-store.ts';
import { createGeometryStore, type GeometryStorage, type GeometryStore } from './geometry-store.ts';
import { type AddonSelection, createSelection } from './selection.ts';
import type { InstalledRegistry, InstalledStore } from './store.ts';
import { createInstalledStore } from './store.ts';

interface StoresDeps {
  /** Null when the bridge never connected. Each pane reports that as its own state. */
  registry: (InstalledRegistry & CatalogRegistry) | null;
  market: MarketApi | null;
  dev: DevApi | null;
  /** Null when the bridge never connected. The window then never persists its position. */
  storage: GeometryStorage | null;
  channel: string;
  /** Builds the settings and keybind stores an addon's own page edits. */
  config: ConfigService | null;
}

interface ManagerStores {
  store: InstalledStore;
  dev: DevStore;
  catalog: CatalogStore;
  geometry: GeometryStore;
  selection: AddonSelection;
}

/**
 * The stores, all repainting through one callback. `selection` is assigned after the installed
 * store is built; its callback cannot run before this returns, since nothing has loaded yet.
 */
function createStores(deps: StoresDeps, repaint: () => void): ManagerStores {
  let selection: AddonSelection | null = null;

  const store = createInstalledStore({
    registry: deps.registry,
    // New rows can carry a changed manifest for the open page; re-check it here.
    onChange: () => {
      selection?.refresh();
      repaint();
    },
  });
  const dev = createDevStore({ dev: deps.dev, market: deps.market, onChange: repaint });
  const catalog = createCatalogStore({
    market: deps.market,
    registry: deps.registry,
    onChange: repaint,
  });
  const geometry = createGeometryStore({ storage: deps.storage, channel: deps.channel });
  const openPage = createSelection({
    config: deps.config,
    find: (fqid) => store.state().rows.find((row) => row.fqid === fqid) ?? null,
    repaint,
  });
  selection = openPage;

  return { store, dev, catalog, geometry, selection: openPage };
}

/**
 * What opening the window reads: all three panes on every open, never at boot, whatever the tab.
 * The catalog fetches at most once a session (a conditional request per source); only Refresh
 * fetches unconditionally.
 */
function loadPanes(panes: Pick<ManagerStores, 'store' | 'dev' | 'catalog'>): void {
  panes.store.reload();
  panes.dev.load();
  panes.catalog.load();
}

export type { ManagerStores, StoresDeps };
export { createStores, loadPanes };
