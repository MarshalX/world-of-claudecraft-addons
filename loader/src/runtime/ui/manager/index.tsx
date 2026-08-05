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
  /** The loader's one menu, which every dropdown in here opens. See manager/picker-menu.ts. */
  openMenu: OpenMenu;
  /**
   * The arrange-your-UI mode, shared with the loader's own keybind.
   *
   * Passed in rather than created here, unlike the freeze: the freeze is the
   * manager's alone, while this one is also flipped from outside, so the manager
   * has to be looking at the same object rather than at a copy of the state.
   */
  unlock: UnlockMode;
  /**
   * Bring the manager's window to the front. See ui/kit/stacking.ts.
   *
   * Here rather than around the routes that open it, which is where it was: the
   * stacking listener sees a click INSIDE the root, and every way into the
   * manager is outside it (two buttons in the game's own DOM, a userscript menu
   * command, the host reporting an install). Wrapping one caller left the others
   * opening the window behind whatever was already up, and a live session found
   * exactly that. Showing is the event, so showing is what raises.
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
