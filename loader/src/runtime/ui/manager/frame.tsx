// The manager's window: its container, one render of it, and everything an open one holds.
// Nothing here is reachable from outside; index.tsx is the manager's surface.

// biome-ignore lint/suspicious/noDeprecatedImports: preact's render is current, only its third replaceNode parameter is deprecated, and this call passes two arguments
import { render } from 'preact';
import { createFreezeControl, type FreezeControl } from '../../freeze.ts';
import { ManagerApp } from './app.tsx';
import type { CatalogStore } from './catalog-store.ts';
import type { ConflictReading } from './config.ts';
import type { DevStore } from './dev-store.ts';
import type { GeometryStore } from './geometry-store.ts';
import type { ManagerDeps } from './index.tsx';
import type { AddonSelection } from './selection.ts';
import type { InstalledStore } from './store.ts';
import { createStores, loadPanes } from './stores.ts';

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
  /** Runtime-only state that never reaches the host, so it is not a store. */
  freeze: FreezeControl;
  onClose: () => void;
}

/**
 * The manager's own window. `.woc-window` matches every addon frame too, so this is what says
 * which one is the manager's. Raise the window, never the container: the container is
 * unpositioned, so a z-index on it does nothing.
 */
const MANAGER_SELECTOR = '[data-woc-manager]';

const NO_CONFLICTS: ConflictReading = { actions: [], addons: [], source: 'none' };

/**
 * Conflicts, or an empty reading labelled `none` when the bridge never connected, so the editor
 * says nothing was read rather than that nothing was found.
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
        // The supervisor records its own failures as addon status.
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

/** Repaint when the arrange mode is flipped by its keybind, so the checkbox stays true. */
function followUnlock(deps: ManagerDeps, paint: () => void): () => void {
  return deps.unlock.onChange(paint);
}

/**
 * Bring the manager's window to the front, once a paint has rendered it. Found rather than held,
 * because each open renders a new element; the top-level preact render is synchronous.
 */
function raiseWindow(deps: ManagerDeps, container: HTMLElement): void {
  const el = container.querySelector(MANAGER_SELECTOR);
  if (el instanceof HTMLElement) {
    deps.raise?.(el);
  }
}

/** The unpositioned mount point the window renders into, appended to the addon root. */
function createContainer(deps: ManagerDeps): HTMLElement {
  const container = deps.doc.createElement('div');
  container.className = 'woc-manager';
  deps.root.appendChild(container);
  return container;
}

/**
 * The window's own state: its container, its stores, and the open flag. Paint and close refer to
 * each other, so they are built together.
 */
function createFrame(deps: ManagerDeps): Frame {
  const container = createContainer(deps);

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

  // Raised on every show, even when already open: a route asking for the manager while it sits
  // behind an addon frame is asking to see it, and no click reached the stacking listener.
  const show = (): void => {
    if (!open) {
      open = true;
      loadPanes({ store, dev, catalog });
      paint();
    }
    raiseWindow(deps, container);
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

export type { Frame, FrameView };
export { createFrame, MANAGER_SELECTOR };
