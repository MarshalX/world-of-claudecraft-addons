// The Addons manager: installed list, per-addon settings, keybind editor, logs,
// and diagnostics.
//
// The window is unmounted rather than hidden when it closes. Hiding would leave
// its Escape handler live, which would swallow the game's own close key while
// nothing is on screen to explain why.
//
// The stores load outside the component tree, so opening the window paints
// whatever is already loaded and a reload triggered by another tab does not need
// the window to be open. Which addon's own page is showing lives outside it for
// the same reason, in selection.ts.

// biome-ignore lint/suspicious/noDeprecatedImports: preact's render is current, only its third replaceNode parameter is deprecated, and this call passes two arguments
import { render } from 'preact';
import type { DevApi, MarketApi } from '../../../shared/protocol.ts';
import type { DiagnosticsReading } from '../../diagnostics.ts';
import { createFreezeControl, type FreezeControl } from '../../freeze.ts';
import type { LogBuffer } from '../../log/buffer.ts';
import type { AddonStatus } from '../../supervisor.ts';
import type { UnlockMode } from '../kit/unlock.ts';
import { ManagerApp } from './app.tsx';
import type { CatalogRegistry } from './catalog-actions.ts';
import { type CatalogStore, createCatalogStore } from './catalog-store.ts';
import type { ConfigService, ConflictReading } from './config.ts';
import { createDevStore, type DevStore } from './dev-store.ts';
import { createGeometryStore, type GeometryStorage, type GeometryStore } from './geometry-store.ts';
import { type AddonSelection, createSelection } from './selection.ts';
import type { InstalledRegistry, InstalledStore } from './store.ts';
import { createInstalledStore } from './store.ts';

/**
 * Every registry member the manager's panes reach for.
 *
 * An intersection rather than one widened interface, so each store keeps saying
 * what it actually calls: the Installed pane's list is InstalledRegistry, the
 * catalog panes' is CatalogRegistry, and a suite that fakes one does not have to
 * satisfy the other.
 */
type ManagerRegistry = InstalledRegistry & CatalogRegistry;

interface ManagerDeps {
  doc: Document;
  /** The #woc-addons root. See runtime/ui/root.ts. */
  root: HTMLElement;
  /** Null when the bridge never connected. The pane reports that as its own state. */
  registry: ManagerRegistry | null;
  market: MarketApi | null;
  dev: DevApi | null;
  /** Null when the bridge never connected. The window then never persists its position. */
  storage: GeometryStorage | null;
  channel: string;
  readDiagnostics: () => DiagnosticsReading;
  /** Which addons are actually running, from the supervisor. */
  statuses: () => readonly AddonStatus[];
  reload: (fqid: string) => Promise<void>;
  reloadAll: () => Promise<void>;
  /** Builds the settings and keybind stores an addon's own page edits. */
  config: ConfigService | null;
  /** Swallow the next key press, for the keybind editor. */
  capture: () => Promise<string | null>;
  /**
   * The arrange-your-UI mode, shared with the loader's own keybind.
   *
   * Passed in rather than created here, unlike the freeze: the freeze is the
   * manager's alone, while this one is also flipped from outside, so the manager
   * has to be looking at the same object rather than at a copy of the state.
   */
  unlock: UnlockMode;
  logs: LogBuffer;
  /** Renders a wall-clock reading. Injected so the pure panes stay locale-free. */
  formatTime: (at: number) => string;
}

interface Manager {
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
  /** Reload what the panes read. Called when the host reports the registry changed. */
  invalidate: () => void;
  /**
   * Redraw without re-reading anything.
   *
   * What the supervisor reports changes far more often than the registry does,
   * and re-reading the registry on every status change would put a bridge round
   * trip behind each one.
   */
  repaint: () => void;
  dispose: () => void;
}

interface Frame {
  container: HTMLElement;
  /** Stop following the unlock mode. See createFrame. */
  stopWatchingUnlock: () => void;
  store: InstalledStore;
  dev: DevStore;
  catalog: CatalogStore;
  geometry: GeometryStore;
  close: () => void;
  isOpen: () => boolean;
  paint: () => void;
  show: () => void;
  closeAddon: () => void;
}

/** Everything one render of the window's contents reads. */
interface FrameView {
  store: InstalledStore;
  dev: DevStore;
  catalog: CatalogStore;
  geometry: GeometryStore;
  selection: AddonSelection;
  /**
   * Alongside the stores rather than in them: the freeze is runtime state that
   * never reaches the host, so it has nothing to load, nothing to persist, and
   * no reason to repaint anything outside the checkbox that sets it.
   */
  freeze: FreezeControl;
  onClose: () => void;
}

const NO_CONFLICTS: ConflictReading = { actions: [], addons: [], source: 'none' };

/**
 * Conflicts, or an empty reading when the bridge never connected.
 *
 * Empty rather than absent, and labelled `none`: the editor renders the source
 * alongside the answer, so a player sees that nothing was read rather than that
 * nothing was found.
 */
function readConflicts(deps: ManagerDeps, combo: string): ConflictReading {
  if (deps.config === null) {
    return NO_CONFLICTS;
  }
  return deps.config.conflicts(combo);
}

/** One render of the window's contents into its container. */
function renderApp(deps: ManagerDeps, view: FrameView, container: HTMLElement): void {
  render(
    <ManagerApp
      installed={view.store.state()}
      statuses={deps.statuses()}
      onToggle={view.store.setEnabled}
      onUninstall={view.store.uninstall}
      onReload={(fqid) => {
        // The supervisor records its own failures as addon status, so there is
        // nothing here to await or to catch.
        deps.reload(fqid).catch(() => undefined);
      }}
      onReloadAll={() => {
        deps.reloadAll().catch(() => undefined);
      }}
      dev={view.dev.state()}
      devStore={view.dev}
      freeze={view.freeze}
      catalogStore={view.catalog}
      formatTime={deps.formatTime}
      readDiagnostics={deps.readDiagnostics}
      onClose={view.onClose}
      unlocked={deps.unlock.unlocked}
      onUnlock={deps.unlock.set}
      box={view.geometry.box()}
      onGeometry={view.geometry.save}
      openAddon={view.selection.addon()}
      openConfig={view.selection.config()}
      onOpenAddon={view.selection.open}
      onCloseAddon={view.selection.close}
      conflicts={(combo) => readConflicts(deps, combo)}
      capture={deps.capture}
      logs={deps.logs.tail}
    />,
    container,
  );
}

/**
 * The window's own state: its container, its stores, and the open flag.
 *
 * Split out so mountManager stays a wiring function. The mutual reference
 * between paint and close is why the two are built together rather than passed
 * to each other.
 */
/**
 * The stores the window reads, all repainting through one callback.
 *
 * They load outside the component tree, so opening the window paints whatever is
 * already loaded and a reload driven from another tab does not need the window
 * to be open.
 */
function createStores(deps: ManagerDeps, repaint: () => void) {
  const store = createInstalledStore({ registry: deps.registry, onChange: repaint });
  const dev = createDevStore({ dev: deps.dev, market: deps.market, onChange: repaint });
  const catalog = createCatalogStore({
    market: deps.market,
    registry: deps.registry,
    onChange: repaint,
  });
  const geometry = createGeometryStore({ storage: deps.storage, channel: deps.channel });
  const selection = createSelection({
    config: deps.config,
    find: (fqid) => store.state().rows.find((row) => row.fqid === fqid) ?? null,
    repaint,
  });
  return { store, dev, catalog, geometry, selection };
}

/**
 * What opening the window reads, none of which goes to the network.
 *
 * Loaded on open rather than at boot: a player who never opens the manager should
 * not pay for a bridge round trip. All three are loaded whatever tab is being
 * opened, since deferring to the tab would make every tab's first paint its
 * loading state. The dev reading is three storage reads and the catalog answers
 * from the indexes as they were last read. Refresh is what fetches.
 */
function loadPanes(panes: Pick<FrameView, 'store' | 'dev' | 'catalog'>): void {
  panes.store.reload();
  panes.dev.load();
  panes.catalog.load();
}

/**
 * Repaint when the arrange-your-UI mode is flipped from somewhere else.
 *
 * The manager draws a checkbox for it and the loader's keybind flips the same
 * mode, so without this the checkbox would show the opposite of what the screen
 * is doing for as long as the window stayed open.
 */
function followUnlock(deps: ManagerDeps, paint: () => void): () => void {
  return deps.unlock.onChange(paint);
}

function createFrame(deps: ManagerDeps): Frame {
  const container = deps.doc.createElement('div');
  container.className = 'woc-manager';
  deps.root.appendChild(container);

  let open = false;
  let paint = (): void => undefined;

  const { store, dev, catalog, geometry, selection } = createStores(deps, () => {
    paint();
  });
  const freeze = createFreezeControl(deps.doc);
  const stopWatchingUnlock = followUnlock(deps, () => {
    paint();
  });

  const close = (): void => {
    open = false;
    paint();
  };

  paint = () => {
    if (!open) {
      render(null, container);
      return;
    }
    renderApp(
      deps,
      { store, dev, catalog, geometry, selection, freeze, onClose: close },
      container,
    );
  };

  // The loads commit synchronously and so paint already; the explicit paint
  // covers a future one that does not.
  const show = (): void => {
    if (open) {
      return;
    }
    open = true;
    loadPanes({ store, dev, catalog });
    paint();
  };

  return {
    container,
    stopWatchingUnlock,
    store,
    dev,
    catalog,
    geometry,
    close,
    isOpen: () => open,
    paint: () => {
      paint();
    },
    show,
    closeAddon: selection.close,
  };
}

function mountManager(deps: ManagerDeps): Manager {
  const {
    container,
    store,
    dev,
    catalog,
    geometry,
    close,
    isOpen,
    paint,
    show,
    closeAddon,
    stopWatchingUnlock,
  } = createFrame(deps);

  // Read once at mount rather than on every open, so the first open does not
  // wait on a bridge round trip and later ones use what is already in hand.
  geometry.load().catch(() => undefined);

  // The list is where the manager reopens. A player who closed the window on one
  // addon's page and came back for a different one would otherwise have to find
  // their way out of a page they did not choose.
  const closeAll = (): void => {
    closeAddon();
    close();
  };

  return {
    open: show,
    close: closeAll,

    toggle: () => {
      if (isOpen()) {
        closeAll();
        return;
      }
      show();
    },

    isOpen,

    invalidate: () => {
      store.reload();
      dev.load();
      catalog.load();
    },

    repaint: paint,

    dispose: () => {
      stopWatchingUnlock();
      render(null, container);
      container.remove();
    },
  };
}

export type { InstalledRegistry } from './store.ts';
export type { Manager, ManagerDeps, ManagerRegistry };
export { mountManager };
