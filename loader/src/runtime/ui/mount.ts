// Composes the loader's own UI: the root, both injection points, the manager, and the shared
// kit that addons build their UI out of.
//
// The three ways into the manager are independent: the game menu entry and the rail button
// live in game DOM and can break on a game update, the userscript command cannot. The root,
// kit and manager come up as soon as the document is parsed; everything inside the game's HUD
// waits for world entry (ui/hud-mount.ts, ui/kit/injections.ts).

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
import { followGameUnlock } from './game-unlock.ts';
import { type ArrangeHint, createArrangeHint } from './kit/arrange-hint.ts';
import { createAuraArt } from './kit/aura-art.ts';
import { createFrameRoster, type FrameRoster } from './kit/frame-roster.ts';
import { createIconUrls, type IconUrls } from './kit/icons.ts';
import { createGameInjector, type GameInjector } from './kit/injections.ts';
import { createItemArt } from './kit/item-art.ts';
import { createSkillArt } from './kit/skill-art.ts';
import { createStacking, type Stacking } from './kit/stacking.ts';
import { createUnlockMode, type UnlockMode } from './kit/unlock.ts';
import { type ConfigService, createConfigService } from './manager/config.ts';
import type { GeometryStorage } from './manager/geometry-store.ts';
import { type Manager, type ManagerRegistry, mountManager } from './manager/index.tsx';
import { type AddonRoot, mountRoot, NO_HUD_CLASS } from './root.ts';
import { addLoaderRoutes } from './routes.ts';
import { createSnapStore, type SnapStore } from './snap-store.ts';
import { buildSurfaces, type Surfaces } from './surfaces.ts';

/**
 * Report any anchor that should be there and is not, once per attach. The injections decline
 * quietly by design, so without this a renamed selector costs a button and says nothing.
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

/** What both halves of the UI are composed over, built before either of them. */
interface UiParts {
  /** The root and its two stacking bands. See runtime/ui/root.ts. */
  root: AddonRoot;
  unlock: UnlockMode;
  /** Whether an arranged frame lands on the grid. See ui/snap-store.ts. */
  snap: SnapStore;
  stacking: Stacking;
  /** The shared surfaces, built BEFORE the manager, whose dropdowns use the same menu service. */
  surfaces: Surfaces;
}

/**
 * The manager and the config service its pages edit through. Each needs the other; the
 * `repaintManager` indirection breaks the cycle, and only a storage change calls it.
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
    root: parts.root.overlay,
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
    openMenu: parts.surfaces.menus.open,
    capture: () => {
      const capture = deps.dispatcher.capture();
      return capture.done;
    },
    logs: deps.logs,
  });

  // `invalidate` also reloads the registry, which costs one bridge call.
  repaintManager = () => {
    if (manager.isOpen()) {
      manager.invalidate();
    }
  };

  return { manager, config };
}

/**
 * The shared surfaces, plus the loader's own two in-game routes into the manager. The routes
 * are registered here, before any addon's, so the loader's entry comes first.
 */
function buildKit(deps: UiDeps, parts: UiParts, manager: Manager): UiKit {
  const { unlock, stacking } = parts;
  const { el: root, hud, overlay } = parts.root;
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

  const { surfaces } = parts;
  const roster = createFrameRoster();

  addLoaderRoutes({
    doc: deps.doc,
    injector,
    menus: surfaces.menus,
    roster,
    unlock,
    snap: parts.snap,
    onOpen,
  });
  const icons = createIconUrls(
    createSkillArt({ fetchJson: deps.fetchJson }),
    createItemArt({ fetchJson: deps.fetchJson }),
    createAuraArt({ fetchJson: deps.fetchJson }),
  );

  return {
    root,
    hud,
    overlay,
    ...surfaces,
    injector,
    stacking,
    roster,
    icons,
    unlock,
    snap: parts.snap,
    arrangeHint: createArrangeHint({ toaster: surfaces.toaster }),
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
   * The loader's one animation-frame loop, shared by world anchors and `woc.onFrame`; the
   * order between the two phases is why it is one object. See runtime/frame-loop.ts.
   */
  frames: FrameLoop;
  viewport: () => { w: number; h: number };
  /**
   * A world point to a point on screen, or null. Passed in so the kit makes no claim about the
   * game.
   */
  project: Projector;
  /**
   * A unit token or an entity id to a world point, for `{ unit: 'target' }`. Passed in like
   * `project`.
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
 * The shared surfaces an addon's `woc.ui` is built over, one of each for the whole loader.
 * Per-addon state is the disposal bag wrapped around these (api/ui.ts).
 */
export interface UiKit extends Surfaces {
  /**
   * The #woc-addons element, which contains both bands and is not a layer itself. What goes on
   * screen picks a band instead (see ui/root.ts).
   */
  root: HTMLElement;
  /** Addon frames and world anchors go here. Below the game's own HUD. */
  hud: HTMLElement;
  /** The manager, menus, toasts, modals, the banner and the tooltip. Above it all. */
  overlay: HTMLElement;
  injector: GameInjector;
  /** Which loader window is in front. Shared with the manager. */
  stacking: Stacking;
  /** Every frame the loader is holding, so a closed one can be found again. */
  roster: FrameRoster;
  /**
   * Where the game's art lives, over one shared reading of which abilities have a
   * file. Shared rather than per addon so two addons cost one manifest fetch.
   */
  icons: IconUrls;
  /** The arrange-mode switch, one for every frame. Kept off the addon API. */
  unlock: UnlockMode;
  /** Whether an arranged frame lands on the game's alignment grid. Kept off the addon API. */
  snap: SnapStore;
  /** What a player is told when a bare frame refuses a gesture outside the arrange mode. */
  arrangeHint: ArrangeHint;
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
  // The manager and the keybind must share one mode. Snap comes first because the mode reads it.
  const snap = createSnapStore({ storage: deps.storage, channel: deps.channel });
  // Fire and forget: until it answers, nothing snaps, which is the default.
  snap.load().catch(() => undefined);
  const unlock = createUnlockMode(root.el, () => snap.enabled);
  // One way only: ui/game-unlock.ts says why.
  const followGame = followGameUnlock({ doc: deps.doc, unlock });
  const parts: UiParts = {
    root,
    unlock,
    snap,
    stacking: createStacking({ root: root.el }),
    surfaces: buildSurfaces(deps, root),
  };
  const { manager, config } = mountManagerPair(deps, parts);
  const kit = buildKit(deps, parts, manager);

  return {
    manager,
    config,
    kit,
    dispose: () => {
      followGame();
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
