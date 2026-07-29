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
import type { DiagnosticsReading } from '../../diagnostics.ts';
import type { LogBuffer } from '../../log/buffer.ts';
import { ManagerApp } from './app.tsx';
import type { ConfigService, ConflictReading } from './config.ts';
import { createGeometryStore, type GeometryStorage, type GeometryStore } from './geometry-store.ts';
import { type AddonSelection, createSelection } from './selection.ts';
import type { InstalledRegistry, InstalledStore } from './store.ts';
import { createInstalledStore } from './store.ts';

interface ManagerDeps {
  doc: Document;
  /** The #woc-addons root. See runtime/ui/root.ts. */
  root: HTMLElement;
  /** Null when the bridge never connected. The pane reports that as its own state. */
  registry: InstalledRegistry | null;
  /** Null when the bridge never connected. The window then never persists its position. */
  storage: GeometryStorage | null;
  channel: string;
  readDiagnostics: () => DiagnosticsReading;
  /** Builds the settings and keybind stores an addon's own page edits. */
  config: ConfigService | null;
  /** Swallow the next key press, for the keybind editor. */
  capture: () => Promise<string | null>;
  logs: LogBuffer;
}

interface Manager {
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
  /** Reload what the panes read. Called when the host reports the registry changed. */
  invalidate: () => void;
  dispose: () => void;
}

interface Frame {
  container: HTMLElement;
  store: InstalledStore;
  geometry: GeometryStore;
  close: () => void;
  isOpen: () => boolean;
  show: () => void;
  closeAddon: () => void;
}

/** Everything one render of the window's contents reads. */
interface FrameView {
  store: InstalledStore;
  geometry: GeometryStore;
  selection: AddonSelection;
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
      onToggle={view.store.setEnabled}
      readDiagnostics={deps.readDiagnostics}
      onClose={view.onClose}
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
function createFrame(deps: ManagerDeps): Frame {
  const container = deps.doc.createElement('div');
  container.className = 'woc-manager';
  deps.root.appendChild(container);

  let open = false;
  let paint = (): void => undefined;

  const store = createInstalledStore({
    registry: deps.registry,
    onChange: () => {
      paint();
    },
  });
  const geometry = createGeometryStore({ storage: deps.storage, channel: deps.channel });
  const selection = createSelection({
    config: deps.config,
    find: (fqid) => store.state().rows.find((row) => row.fqid === fqid) ?? null,
    repaint: () => {
      paint();
    },
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
    renderApp(deps, { store, geometry, selection, onClose: close }, container);
  };

  // Loaded on open rather than at boot: a player who never opens the manager
  // should not pay for a bridge round trip. reload() commits synchronously and
  // so paints already; the explicit paint covers a future reload that does not.
  const show = (): void => {
    if (open) {
      return;
    }
    open = true;
    store.reload();
    paint();
  };

  return {
    container,
    store,
    geometry,
    close,
    isOpen: () => open,
    show,
    closeAddon: selection.close,
  };
}

function mountManager(deps: ManagerDeps): Manager {
  const { container, store, geometry, close, isOpen, show, closeAddon } = createFrame(deps);

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
    },

    dispose: () => {
      render(null, container);
      container.remove();
    },
  };
}

export type { InstalledRegistry } from './store.ts';
export type { Manager, ManagerDeps };
export { mountManager };
