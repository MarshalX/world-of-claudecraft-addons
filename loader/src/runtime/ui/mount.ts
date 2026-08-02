// Composes the loader's own UI: the root, both injection points, the manager,
// and the shared kit that addons build their UI out of.
//
// The three ways into the manager are deliberately independent. The game menu
// entry and the rail button both live in game DOM and can be taken away by a
// game update; the userscript popup command is host-side and cannot. Wiring all
// three to one manager here means a route that stops working costs a route
// rather than the manager.
//
// The root, the kit, and the manager come up as soon as the document is parsed,
// so the manager is reachable from the start screen. Everything that goes INSIDE
// the game's HUD waits for it, since none of it exists until world entry: see
// ui/hud-mount.ts, and ui/kit/injections.ts for the one watcher they share.
//
// Whether either in-game route found its anchor is not reported from here.
// Diagnostics resolves the anchor table live, which answers the same question
// without a boolean that was true once at mount and has been stale since.

import { diagError } from '../../shared/diag.ts';
import type { DevApi, MarketApi } from '../../shared/protocol.ts';
import type { DiagnosticsReading } from '../diagnostics.ts';
import type { FrameLoop } from '../frame-loop.ts';
import type { KeyDispatcher } from '../keys/dispatcher.ts';
import type { GameBindings } from '../keys/game-bindings.ts';
import type { LogBuffer } from '../log/buffer.ts';
import type { StorageHub } from '../storage/hub.ts';
import type { AddonStatus } from '../supervisor.ts';
import type { UnitPointResolver } from '../world/anchor-point.ts';
import type { Projector } from '../world/project.ts';
import { ANCHORS, ANCHORS_REQUIRED_IN_GAME } from './anchors.ts';
import { type Anchors, createAnchors } from './kit/anchor3d.ts';
import { type Banner, createBanner } from './kit/banner.ts';
import { createFrameRoster, type FrameRoster } from './kit/frame-roster.ts';
import { createIconUrls, type IconUrls } from './kit/icons.ts';
import { createGameInjector, type GameInjector } from './kit/injections.ts';
import { createItemArt } from './kit/item-art.ts';
import { createMenus, type Menus } from './kit/menu.ts';
import { createSkillArt } from './kit/skill-art.ts';
import { createStacking, type Stacking } from './kit/stacking.ts';
import { createToaster, type Toaster } from './kit/toast.ts';
import { createTooltips, type Tooltips } from './kit/tooltip.ts';
import { createUnlockMode, type UnlockMode } from './kit/unlock.ts';
import { type ConfigService, createConfigService } from './manager/config.ts';
import type { GeometryStorage } from './manager/geometry-store.ts';
import { type Manager, type ManagerRegistry, mountManager } from './manager/index.tsx';
import { mountRoot, NO_HUD_CLASS } from './root.ts';
import { addLoaderRoutes } from './routes.ts';

/**
 * Report any anchor that should be there and is not.
 *
 * Without this a game update that renames a selector costs the player a button
 * and says nothing: the injection declines quietly by design, so the only trace
 * is a Diagnostics pane nobody has a reason to open. Written once per attach,
 * not per attempt.
 */
function reportMissingAnchors(doc: Document): void {
  const missing = ANCHORS_REQUIRED_IN_GAME.filter(
    (key) => doc.querySelector(ANCHORS[key]) === null,
  );
  if (missing.length === 0) {
    return;
  }
  diagError(
    'the game HUD is up but these anchors did not resolve, so the loader has lost a way in',
    missing.map((key) => `${key} (${ANCHORS[key]})`),
  );
}

interface ManagerPair {
  manager: Manager;
  config: ConfigService;
}

/**
 * What both halves of the UI are composed over, built before either of them.
 *
 * One object rather than three parameters threaded through two builders: the
 * stacking service was the third, and it is shared for the reason the other two
 * are, since window order is one answer for the manager and every addon frame
 * together rather than one per surface.
 */
interface UiParts {
  /** The #woc-addons root. See runtime/ui/root.ts. */
  root: HTMLElement;
  unlock: UnlockMode;
  stacking: Stacking;
}

/**
 * The manager and the config service its pages edit through.
 *
 * Built as a pair because each needs the other: the service repaints the manager
 * when a setting changes under it, and the manager hands the service the addon
 * whose stores to open. One indirection breaks the cycle, and it is only ever
 * called in response to a storage change, which cannot happen before both exist.
 */
function mountManagerPair(deps: UiDeps, parts: UiParts): ManagerPair {
  let repaintManager = (): void => undefined;

  const config = createConfigService({
    hub: deps.storageHub,
    game: deps.gameBindings,
    addonBindings: deps.dispatcher.bindings,
    onChange: () => {
      repaintManager();
    },
  });

  const manager = mountManager({
    doc: deps.doc,
    root: parts.root,
    unlock: parts.unlock,
    raise: parts.stacking.raise,
    registry: deps.registry,
    market: deps.market,
    dev: deps.dev,
    storage: deps.storage,
    channel: deps.channel,
    readDiagnostics: deps.readDiagnostics,
    statuses: deps.statuses,
    reload: deps.reload,
    reloadAll: deps.reloadAll,
    formatTime: deps.formatTime,
    config,
    capture: () => {
      const capture = deps.dispatcher.capture();
      return capture.done;
    },
    logs: deps.logs,
  });

  // A change from another tab repaints only what is on screen. `invalidate`
  // reloads the registry too, which is more than a settings write needs, but the
  // manager is open at most once and the reload is one bridge call.
  repaintManager = () => {
    if (manager.isOpen()) {
      manager.invalidate();
    }
  };

  return { manager, config };
}

/**
 * The shared surfaces, plus the loader's own two in-game routes into the manager.
 *
 * The routes go on here rather than at the call site so they are registered
 * before any addon's, which is what keeps the loader's own entry at the top of
 * the rail and of the game menu.
 */
function buildKit(deps: UiDeps, parts: UiParts, manager: Manager): UiKit {
  const { root, unlock, stacking } = parts;
  const injector = createGameInjector({
    doc: deps.doc,
    onHud: () => {
      reportMissingAnchors(deps.doc);
    },
    onPresence: (present) => {
      root.classList.toggle(NO_HUD_CLASS, !present);
    },
  });

  const onOpen = (): void => {
    manager.toggle();
  };

  const timers = { setTimer: deps.setTimer, clearTimer: deps.clearTimer };
  const toaster = createToaster({ doc: deps.doc, root, ...timers });
  const banner = createBanner({ doc: deps.doc, root, ...timers });
  const tooltips = createTooltips({ doc: deps.doc, root, viewport: deps.viewport });
  const menus = createMenus({ doc: deps.doc, root, viewport: deps.viewport });
  const anchors = createAnchors({
    doc: deps.doc,
    root,
    project: deps.project,
    unitPoint: deps.unitPoint,
    viewport: deps.viewport,
    frames: deps.frames,
  });
  const roster = createFrameRoster();

  addLoaderRoutes({ doc: deps.doc, injector, menus, roster, unlock, onOpen });
  const icons = createIconUrls(
    createSkillArt({ fetchJson: deps.fetchJson }),
    createItemArt({ fetchJson: deps.fetchJson }),
  );

  return {
    root,
    toaster,
    banner,
    tooltips,
    menus,
    anchors,
    injector,
    stacking,
    roster,
    icons,
    unlock,
    project: deps.project,
    unitPoint: deps.unitPoint,
  };
}

export interface UiDeps {
  doc: Document;
  /** The loader stylesheet, bundled as text. */
  css: string;
  /** All three are null together when the bridge never connected. */
  registry: ManagerRegistry | null;
  market: MarketApi | null;
  dev: DevApi | null;
  /** Null when the bridge never connected. Only the window position uses it. */
  storage: GeometryStorage | null;
  channel: string;
  readDiagnostics: () => DiagnosticsReading;
  /** The supervisor's view, for the run-status badges and the Reload controls. */
  statuses: () => readonly AddonStatus[];
  reload: (fqid: string) => Promise<void>;
  reloadAll: () => Promise<void>;
  formatTime: (at: number) => string;
  setTimer: (handler: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
  /**
   * The loader's one animation-frame loop, which world anchors paint on.
   *
   * Not a clock any more: `woc.onFrame` puts addon handlers on the same loop, and
   * the ORDER between the two phases is the reason it is one object rather than a
   * schedule function. See runtime/frame-loop.ts.
   */
  frames: FrameLoop;
  viewport: () => { w: number; h: number };
  /**
   * A world point to a point on screen, or null when the game cannot be asked.
   *
   * Passed in rather than read here, so the kit keeps no claim about the game:
   * the assertion lives in runtime/world/project.ts with every other one.
   */
  project: Projector;
  /**
   * A unit token or an entity id to a world point, for `{ unit: 'target' }`.
   *
   * Passed in for the same reason `project` is: resolving a head point is a read
   * of the renderer's own view of that unit, and it lives in
   * runtime/world/anchor-point.ts beside every other claim about the game.
   */
  unitPoint: UnitPointResolver;
  /** Same-origin JSON, for the game's served art manifests. */
  fetchJson: (url: string) => Promise<unknown>;
  /** The storage hub and the game's bindings, for the per-addon settings pages. */
  storageHub: StorageHub;
  gameBindings: GameBindings;
  dispatcher: KeyDispatcher;
  logs: LogBuffer;
}

/**
 * The shared surfaces an addon's `woc.ui` is built over.
 *
 * One toaster, one tooltip element, and one HUD watcher for the whole loader.
 * Per-addon state is the disposal bag wrapped around these, not a second copy of
 * them: see api/ui.ts.
 */
export interface UiKit {
  root: HTMLElement;
  toaster: Toaster;
  /** The one centre-screen warning slot. Shared for the reason toasts are. */
  banner: Banner;
  tooltips: Tooltips;
  /** The one open context menu. Shared for the reason the banner slot is. */
  menus: Menus;
  /**
   * Elements kept over world points. Shared because they share one frame loop:
   * ten anchors are one callback, not ten.
   */
  anchors: Anchors;
  injector: GameInjector;
  /** Which loader window is in front. Shared with the manager. */
  stacking: Stacking;
  /**
   * Every frame the loader is holding, so a closed one can be found again.
   *
   * Shared for the reason stacking and the unlock mode are: a player looking for
   * a window they closed should not have to know which addon owns it, and any
   * frame a future addon builds is in the list the day it is written.
   */
  roster: FrameRoster;
  /**
   * Where the game's art lives, over one shared reading of which abilities have a
   * file. Shared rather than per addon so two addons cost one manifest fetch.
   */
  icons: IconUrls;
  /**
   * The arrange-your-UI switch. Shared, because it is one mode for every frame.
   *
   * Not on the addon API: an addon has no business turning it on, and one that
   * did would be rearranging a player's screen for them.
   */
  unlock: UnlockMode;
  /**
   * A world point to a point on screen. The same read `ui.anchor3d` places by,
   * published as `ui.project` with no element attached to it.
   */
  project: Projector;
  /** The same unit resolution `ui.anchor3d` uses, so the two cannot disagree. */
  unitPoint: UnitPointResolver;
}

export interface MountedUi {
  manager: Manager;
  kit: UiKit;
  config: ConfigService;
  dispose: () => void;
}

export function mountUi(deps: UiDeps): MountedUi {
  const root = mountRoot({ doc: deps.doc, css: deps.css });
  // Built here rather than inside either half, because BOTH need the same one:
  // the manager draws the switch, the loader's keybind flips it, and two
  // instances would mean a checkbox that disagrees with the screen.
  const unlock = createUnlockMode(root.el);
  // Ahead of both halves, because both raise through it: the manager when it is
  // shown, and every addon frame when it is built or shown. It needs only the
  // root, so nothing about the order costs anything.
  const parts: UiParts = { root: root.el, unlock, stacking: createStacking({ root: root.el }) };
  const { manager, config } = mountManagerPair(deps, parts);
  const kit = buildKit(deps, parts, manager);

  return {
    manager,
    config,
    kit,
    dispose: () => {
      kit.injector.dispose();
      kit.tooltips.dispose();
      kit.menus.dispose();
      kit.anchors.dispose();
      kit.toaster.dispose();
      kit.banner.dispose();
      kit.stacking.dispose();
      config.dispose();
      manager.dispose();
      root.dispose();
    },
  };
}
