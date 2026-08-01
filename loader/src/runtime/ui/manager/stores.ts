// The five stores the manager window reads, and what wakes them.
//
// They load outside the component tree, so opening the window paints whatever is
// already loaded and a reload driven from another tab does not need the window to
// be open. That is also why they are built here rather than in index.tsx: the
// wiring between them is a thing with rules of its own, and one of those rules is
// load-bearing enough to have shipped as a bug.
//
// The rule: when the installed rows land, the open addon's page is re-checked
// against them. A page renders from its ROW read fresh while its settings and
// keybind stores were built when the page was opened, so an addon updated under an
// open page drew the new manifest's controls over the old manifest's stores, and
// picking a value answered "no setting declared with id '<the new one>'".
//
// Its own deps interface rather than the manager's, so nothing here imports
// index.tsx: that module imports this one. The shapes are compatible because
// ManagerDeps carries these fields, which is all a structural check asks.

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
 * The stores, all repainting through one callback.
 *
 * The selection is assigned after the installed store is built and is only read
 * from that store's callback, which cannot run before this function returns: rows
 * landing is the answer to a request nothing has made yet.
 */
function createStores(deps: StoresDeps, repaint: () => void): ManagerStores {
  let selection: AddonSelection | null = null;

  const store = createInstalledStore({
    registry: deps.registry,
    // New rows are the moment an addon's manifest can have changed under an open
    // page. Re-checking here is what keeps the page and its stores on the same
    // manifest; the selection skips the repaint when nothing about it moved, so a
    // change to some other addon costs one comparison.
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
 * What opening the window reads.
 *
 * Loaded on open rather than at boot: a player who never opens the manager should
 * not pay for a bridge round trip. All three are loaded whatever tab is being
 * opened, since deferring to the tab would make every tab's first paint its
 * loading state. The dev reading is three storage reads, and the catalog answers
 * from the indexes as they were last read, having first read any source this
 * session has not read at all. So the FIRST open of a session costs a conditional
 * request per source and every open after it costs none; Refresh is what fetches
 * unconditionally.
 */
function loadPanes(panes: Pick<ManagerStores, 'store' | 'dev' | 'catalog'>): void {
  panes.store.reload();
  panes.dev.load();
  panes.catalog.load();
}

export type { ManagerStores, StoresDeps };
export { createStores, loadPanes };
