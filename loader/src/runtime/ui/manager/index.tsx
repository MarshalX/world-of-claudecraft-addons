// The Addons manager: installed list, per-addon settings, keybind editor, logs,
// and diagnostics.
//
// The window is unmounted rather than hidden when it closes. Hiding would leave
// its Escape handler live, which would swallow the game's own close key while
// nothing is on screen to explain why.
//
// The store loads outside the component tree, so opening the window paints
// whatever is already loaded and a reload triggered by another tab does not need
// the window to be open.

// biome-ignore lint/suspicious/noDeprecatedImports: preact's render is current, only its third replaceNode parameter is deprecated, and this call passes two arguments
import { render } from 'preact';
import type { DiagnosticsReading } from '../../diagnostics.ts';
import { ManagerApp } from './app.tsx';
import { createGeometryStore, type GeometryStorage, type GeometryStore } from './geometry-store.ts';
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
  paint: () => void;
  close: () => void;
  isOpen: () => boolean;
  show: () => void;
}

/**
 * The window's own state: its container, its store, and the open flag.
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

  const close = (): void => {
    open = false;
    paint();
  };

  paint = () => {
    if (!open) {
      render(null, container);
      return;
    }
    render(
      <ManagerApp
        installed={store.state()}
        onToggle={store.setEnabled}
        readDiagnostics={deps.readDiagnostics}
        onClose={close}
        box={geometry.box()}
        onGeometry={geometry.save}
      />,
      container,
    );
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

  return { container, store, geometry, paint, close, isOpen: () => open, show };
}

function mountManager(deps: ManagerDeps): Manager {
  const { container, store, geometry, close, isOpen, show } = createFrame(deps);

  // Read once at mount rather than on every open, so the first open does not
  // wait on a bridge round trip and later ones use what is already in hand.
  geometry.load().catch(() => undefined);

  return {
    open: show,
    close,

    toggle: () => {
      if (isOpen()) {
        close();
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
