// The Addons manager: installed list, per-addon settings, keybind editor, logs, and diagnostics.
//
// The window is unmounted when it closes, never hidden: a hidden one keeps its Escape handler live
// and swallows the game's own close key. The stores (and selection.ts) live outside the component
// tree so a reload from another tab does not need the window open.

// biome-ignore lint/suspicious/noDeprecatedImports: preact's render is current, only its third replaceNode parameter is deprecated, and this call passes two arguments
import { render } from 'preact';
import type { DevApi, MarketApi } from '../../../shared/protocol.ts';
import type { DiagnosticsReading } from '../../diagnostics.ts';
import type { LogBuffer } from '../../log/buffer.ts';
import type { AddonStatus } from '../../supervisor.ts';
import type { OpenMenu } from '../kit/picker.ts';
import type { UnlockMode } from '../kit/unlock.ts';
import type { CatalogRegistry } from './catalog-actions.ts';
import type { ConfigService } from './config.ts';
import { createFrame } from './frame.tsx';
import type { GeometryStorage } from './geometry-store.ts';
import { setPickerMenu } from './picker-menu.ts';
import type { InstalledRegistry } from './store.ts';

/**
 * Every registry member the manager's panes reach for. An intersection so each store names what it
 * calls, and a suite faking one does not have to satisfy the other.
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
  /** The loader's one menu, which every dropdown in here opens. See manager/picker-menu.ts. */
  openMenu: OpenMenu;
  /** The arrange mode, passed in because the loader's keybind flips the same object. */
  unlock: UnlockMode;
  /**
   * Bring the manager's window to the front. See ui/kit/stacking.ts. Called from `show`, never
   * around a route: every way into the manager is outside the root, so the stacking listener sees
   * none of them, and wrapping one caller leaves the others opening it buried.
   */
  raise?: (el: HTMLElement) => void;
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
  /** Redraw without re-reading, for supervisor status changes, which are far more frequent. */
  repaint: () => void;
  dispose: () => void;
}

function mountManager(deps: ManagerDeps): Manager {
  setPickerMenu(deps.openMenu);
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

  // Read once at mount, so no open waits on a bridge round trip.
  geometry.load().catch(() => undefined);

  // The manager always reopens on the list, never on the addon page it closed on.
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
