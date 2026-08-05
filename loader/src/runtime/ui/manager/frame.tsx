// The manager's window: its container, one render of it, and everything an open one holds.
//
// Split from index.tsx, which is now the manager's own surface (what it IS, and how the rest
// of the loader reaches it) with none of how the window is assembled. The seam is where that
// file crossed the length limit and it is a real one rather than an arbitrary cut: nothing
// here is reachable from outside, and `createFrame` is what `mountManager` was already wiring
// together rather than doing itself.

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
  /**
   * Alongside the stores rather than in them: the freeze is runtime state that
   * never reaches the host, so it has nothing to load, nothing to persist, and
   * no reason to repaint anything outside the checkbox that sets it.
   */
  freeze: FreezeControl;
  onClose: () => void;
}

/**
 * The manager's own window, by a stable hook rather than by its classes.
 *
 * `.woc-window` matches every addon frame too, so there has to be something that
 * says which one is the manager's. An attribute rather than another class,
 * matching how a frame is found by `data-woc-frame`. It is the WINDOW that is
 * raised rather than the container it renders into: the container is an
 * unpositioned div, so a z-index on it would style an element the browser has no
 * reason to consult, and the click listener in kit/stacking.ts already resolves
 * to this element through `closest('.woc-window')`.
 */
const MANAGER_SELECTOR = '[data-woc-manager]';

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
 * Repaint when the arrange-your-UI mode is flipped from somewhere else.
 *
 * The manager draws a checkbox for it and the loader's keybind flips the same
 * mode, so without this the checkbox would show the opposite of what the screen
 * is doing for as long as the window stayed open.
 */
function followUnlock(deps: ManagerDeps, paint: () => void): () => void {
  return deps.unlock.onChange(paint);
}

/**
 * Bring the manager's window to the front, once a paint has rendered it.
 *
 * Found rather than held, because the window is unmounted when it closes: the
 * element the last open rendered is not the one the next open produces. The
 * top-level preact render is synchronous, so the paint ahead of this call has
 * already put the element in the container.
 */
function raiseWindow(deps: ManagerDeps, container: HTMLElement): void {
  const el = container.querySelector(MANAGER_SELECTOR);
  if (el instanceof HTMLElement) {
    deps.raise?.(el);
  }
}

/**
 * The element the window is rendered into, appended to the addon root.
 *
 * Unpositioned and unstyled: it is a mount point rather than a surface, which is
 * why the z-index that decides window order goes on the window inside it.
 */
function createContainer(deps: ManagerDeps): HTMLElement {
  const container = deps.doc.createElement('div');
  container.className = 'woc-manager';
  deps.root.appendChild(container);
  return container;
}

/**
 * The window's own state: its container, its stores, and the open flag.
 *
 * Split out so mountManager stays a wiring function. The mutual reference
 * between paint and close is why the two are built together rather than passed
 * to each other.
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

  // The loads commit synchronously and so paint already; the explicit paint
  // covers a future one that does not.
  //
  // Raised on every show, including one that found the window already open: a
  // route asking for the manager while it sits behind an addon frame is asking
  // to see it, and there is no click inside the root for the listener to read.
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
