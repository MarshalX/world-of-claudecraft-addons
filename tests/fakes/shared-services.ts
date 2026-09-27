// The SharedServices bundle every addon is built against. Everything is real except what would
// reach outside the process: the socket, the game object, the audio sink and the SFX pack fetch.
// It needs a document, so a suite importing this declares happy-dom.

import type { SharedServices } from '../../loader/src/runtime/api/index.ts';
import { createBusHub } from '../../loader/src/runtime/bus/hub.ts';
import { createKeyDispatcher } from '../../loader/src/runtime/keys/dispatcher.ts';
import { createGameBindings } from '../../loader/src/runtime/keys/game-bindings.ts';
import { createLogBuffer } from '../../loader/src/runtime/log/buffer.ts';
import { createNetHub } from '../../loader/src/runtime/net/hub.ts';
import type { NetState } from '../../loader/src/runtime/net/state.ts';
import { createSoundEngine } from '../../loader/src/runtime/sound/engine.ts';
import { createAnchors } from '../../loader/src/runtime/ui/kit/anchor3d.ts';
import { createArrangeHint } from '../../loader/src/runtime/ui/kit/arrange-hint.ts';
import { createAuraArt } from '../../loader/src/runtime/ui/kit/aura-art.ts';
import { createBanner } from '../../loader/src/runtime/ui/kit/banner.ts';
import { createFrameRoster } from '../../loader/src/runtime/ui/kit/frame-roster.ts';
import { createIconUrls } from '../../loader/src/runtime/ui/kit/icons.ts';
import { createGameInjector } from '../../loader/src/runtime/ui/kit/injections.ts';
import { createItemArt } from '../../loader/src/runtime/ui/kit/item-art.ts';
import { createMenus } from '../../loader/src/runtime/ui/kit/menu.ts';
import { createSkillArt } from '../../loader/src/runtime/ui/kit/skill-art.ts';
import { createStacking } from '../../loader/src/runtime/ui/kit/stacking.ts';
import { createToaster } from '../../loader/src/runtime/ui/kit/toast.ts';
import { createTooltips } from '../../loader/src/runtime/ui/kit/tooltip.ts';
import { createUnlockMode, type UnlockMode } from '../../loader/src/runtime/ui/kit/unlock.ts';
import { HUD_BAND_CLASS, OVERLAY_BAND_CLASS } from '../../loader/src/runtime/ui/root.ts';
import { createSnapStore, type SnapStore } from '../../loader/src/runtime/ui/snap-store.ts';
import { createWorldHub } from '../../loader/src/runtime/world/hub.ts';
import { createFrameClock, type FrameClock } from './frame-loop.ts';
import { createFakeStorage, type FakeStorage } from './storage.ts';

const VIEWPORT = { w: 800, h: 600 };

/**
 * A non-empty pack in the deployed shape (a variant is a record with a url), since an empty
 * `cues()` looks like a failed load. Built from entry pairs because the cue names are the game's.
 */
const SOUND_PACK = {
  format: 'woc-sfx-runtime-pack',
  version: 1,
  clips: Object.fromEntries([
    [
      'ui_click',
      {
        variants: [{ id: 'main', url: '/audio/sfx/ui_click.mp3?v=aabbccdd', bytes: 4210 }],
        gain: 1.7579,
        playbackRate: 1,
      },
    ],
    [
      'ui_ready_check',
      {
        variants: [{ id: 'main', url: '/audio/sfx/ui_ready_check.mp3?v=11223344', bytes: 5120 }],
        gain: 1.2,
        playbackRate: 1,
      },
    ],
    // Multi-variant: a cue is not a file.
    [
      'combat_block',
      {
        variants: [
          { id: '1', url: '/audio/sfx/combat_block_1.mp3?v=1555a71f', bytes: 9447 },
          { id: '2', url: '/audio/sfx/combat_block_2.mp3?v=c09d3045', bytes: 10_074 },
        ],
        gain: 0.9,
        playbackRate: 1,
      },
    ],
  ]),
};
/** One addon's one file. A pair, because two addons may declare the same name. */
function dataCell(fqid: string, name: string): string {
  return `${fqid} ${name}`;
}

const NOW_MS = 1234;
const WALL_CLOCK_MS = 1_700_000_000_000;

interface SharedHarness {
  shared: SharedServices;
  hub: FakeStorage;
  root: HTMLElement;
  /** The one frame loop, driven by hand: `frames.tick()` runs one frame. */
  frames: FrameClock;
  /** What the key dispatcher listens on, so a suite can press a key at it. */
  keyTarget: EventTarget;
  /**
   * The arrange mode, which gates a bare frame's drag and resize. Exposed because its keybind is
   * registered in boot.ts, which no suite or stage scenario runs.
   */
  unlock: UnlockMode;
  /** Press a combo, in the manifest's own spelling, e.g. 'Alt+Shift+KeyD'. */
  press: (combo: string) => void;
  /** Deliver one inbound frame, as the socket hook would. */
  inbound: (frame: unknown) => void;
  /** Move the addon-visible clock. Reads `woc.now()`, not wall clock. */
  advance: (ms: number) => void;
  /**
   * Set what `woc.wallClock()` answers, in epoch milliseconds. Independent of `advance` so a suite
   * can express a reload (wall clock moved, monotonic clock reset). `vi.setSystemTime` does not
   * reach it, because the API binds `shared.wallClock` by reference at assembly.
   */
  setWallClock: (ms: number) => void;
  /**
   * Override part of what `net.state` answers. `latencyMs` needs an outbound input frame paired
   * with a later ack and only the inbound tap is wired, so a suite that needs it states it here.
   */
  netState: (patch: Partial<NetState>) => void;
  /**
   * Seed one addon's data file as raw text, as the host's install cache holds it. An unseeded read
   * rejects, so an addon reading a file it never declared cannot look like it worked.
   */
  addonData: (fqid: string, name: string, text: string) => void;
  dispose: () => void;
}

interface SharedOptions {
  /** The __game handle. Never resolves by default, since an addon must work before world entry. */
  game?: Promise<unknown>;
  /**
   * What the loader measures the screen as. Suites keep the fixed default; `stage/` passes the real
   * one. Set it here: `api/bind.ts` and `kit/frame.ts` capture it, so a later patch is never read.
   */
  viewport?: () => { w: number; h: number };
  /**
   * Where a world point lands on screen, and where a unit is. The default is blind: one constant
   * point and no unit. Patching `kit.project`/`kit.unitPoint` moves `ui.project`, but
   * `createAnchors` captures both at build, so placing anchors needs these options.
   */
  project?: SharedServices['kit']['project'];
  unitPoint?: SharedServices['kit']['unitPoint'];
  /**
   * How the art manifests are read. The default never settles, so `icon.ability` and `icon.item`
   * stay optimistic and `icon.itemArtName` answers null; `stage/` passes a real fetch.
   */
  fetchJson?: (url: string) => Promise<unknown>;
  /**
   * The game's minimap label, which is all `world.zone` is. Defaults to null.
   * A function because the label changes as the player moves.
   */
  zoneName?: () => string | null;
}

/**
 * The arrange mode and its grid. Snapping starts off, so no drag is quantized
 * unless a suite opts in.
 */
function arrangeParts(root: HTMLElement): { unlock: UnlockMode; snap: SnapStore } {
  const snap = createSnapStore({ storage: null, channel: 'pbe' });
  return { snap, unlock: createUnlockMode(root, () => snap.enabled) };
}

/**
 * @param hub the storage hub, so a suite can seed it or assert on it.
 */
function createSharedServices(
  doc: Document,
  hub: FakeStorage = createFakeStorage(),
  options: SharedOptions = {},
): SharedHarness {
  const root = doc.createElement('div');
  root.id = 'woc-addons';
  doc.body.appendChild(root);
  // Real bands, not aliases of the root, so a frame mounted in the wrong band fails.
  const hud = doc.createElement('div');
  hud.className = HUD_BAND_CLASS;
  const overlay = doc.createElement('div');
  overlay.className = OVERLAY_BAND_CLASS;
  root.append(hud, overlay);

  // One reader for every surface, so a tooltip and its frame agree on the screen.
  const viewport = options.viewport ?? ((): { w: number; h: number } => VIEWPORT);

  // One clock behind both the net hub and woc.now().
  let clock = NOW_MS;
  let wall = WALL_CLOCK_MS;
  const now = (): number => clock;
  let deliver: ((data: unknown) => void) | null = null;

  const injector = createGameInjector({ doc });
  const noTimers = { setTimer: () => 0, clearTimer: () => undefined };
  const toaster = createToaster({ doc, root: overlay, ...noTimers });
  const banner = createBanner({ doc, root: overlay, ...noTimers });
  const pendingManifest = (): Promise<unknown> => new Promise(() => undefined);
  const fetchJson = options.fetchJson ?? pendingManifest;
  const icons = createIconUrls(
    createSkillArt({ fetchJson }),
    createItemArt({ fetchJson }),
    createAuraArt({ fetchJson }),
  );
  const tooltips = createTooltips({ doc, root, layer: overlay, viewport });
  const menus = createMenus({ doc, root: overlay, viewport });
  // The real loop over a clock the suite steps: nothing runs until `frames.tick`.
  const frames = createFrameClock();
  const project =
    options.project ??
    ((): { x: number; y: number; depth: number; behind: boolean } => ({
      x: 100,
      y: 200,
      depth: 10,
      behind: false,
    }));
  const unitPoint = options.unitPoint ?? ((): null => null);
  const anchors = createAnchors({
    doc,
    root: hud,
    project,
    unitPoint,
    viewport,
    frames: frames.loop,
  });
  const keyTarget = new EventTarget();
  const dispatcher = createKeyDispatcher({ target: keyTarget, doc });
  const { unlock, snap } = arrangeParts(root);
  const logs = createLogBuffer();
  const stacking = createStacking({ root });
  const dataFiles = new Map<string, string>();

  const net = createNetHub({
    now,
    install: (taps) => {
      deliver = taps.onMessage;
      return () => {
        deliver = null;
      };
    },
  });

  const shared: SharedServices = {
    doc,
    window: globalThis as unknown as SharedServices['window'],
    net,
    world: createWorldHub({
      game: options.game ?? new Promise(() => undefined),
      schedule: () => 0,
      cancel: () => undefined,
      // No damage clock, so the combat reading falls through to its state branches.
      lastDamageAt: () => null,
      now: () => 0,
      zoneName: options.zoneName ?? ((): string | null => null),
      simNow: () => null,
      // Off the hello frame, as `runtime/surfaces.ts` wires it.
      realm: net.realm,
    }),
    storage: hub,
    bus: createBusHub(),
    sound: createSoundEngine({
      sink: {
        running: () => true,
        resume: async () => undefined,
        decode: async () => ({}),
        start: () => undefined,
        close: () => undefined,
      },
      fetchJson: () => Promise.resolve(SOUND_PACK),
      fetchBytes: async () => new ArrayBuffer(8),
      volume: () => 1,
      now: () => 0,
      pick: () => 0,
    }),
    dispatcher,
    gameBindings: createGameBindings({ game: () => null, storage: () => null }),
    logs,
    frames: frames.loop,
    kit: {
      root,
      hud,
      overlay,
      injector,
      toaster,
      banner,
      tooltips,
      menus,
      anchors,
      stacking,
      roster: createFrameRoster(),
      icons,
      unlock,
      snap,
      arrangeHint: createArrangeHint({ toaster }),
      project,
      unitPoint,
    },
    channel: 'pbe',
    host: 'https://pbe.worldofclaudecraft.com',
    gameVersion: () => ({ version: '0.31.0', build: '202607290011' }),
    character: () => 'Claudemoon/Marshal',
    // Always in the world here, so every per-character read is answerable at once.
    characterKnown: () => Promise.resolve(),
    addonData: (fqid, name) => {
      const text = dataFiles.get(dataCell(fqid, name));
      if (text === undefined) {
        return Promise.reject(new Error(`no data file "${name}" seeded for ${fqid}`));
      }
      return Promise.resolve(text);
    },
    now,
    wallClock: () => wall,
    viewport,
    pick: () => 0,
  };

  return {
    shared,
    hub,
    root,
    frames,
    keyTarget,
    unlock,
    press: (combo) => {
      const parts = combo.split('+');
      // The last segment is the physical key; the rest are modifiers.
      const code = parts.at(-1) ?? '';
      keyTarget.dispatchEvent(
        new KeyboardEvent('keydown', {
          code,
          altKey: parts.includes('Alt'),
          ctrlKey: parts.includes('Ctrl'),
          shiftKey: parts.includes('Shift'),
        }),
      );
    },
    inbound: (frame) => {
      deliver?.(JSON.stringify(frame));
    },
    netState: (patch) => {
      const base = shared.net.state();
      shared.net.state = () => ({ ...base, ...patch });
      // The realm has its own accessor; move both so `world.characterKey` agrees.
      if (patch.realm !== undefined) {
        shared.net.realm = () => patch.realm ?? null;
      }
    },

    addonData: (fqid, name, text) => {
      dataFiles.set(dataCell(fqid, name), text);
    },

    advance: (ms) => {
      clock += ms;
    },
    setWallClock: (ms) => {
      wall = ms;
    },
    dispose: () => {
      frames.loop.dispose();
      injector.dispose();
      tooltips.dispose();
      menus.dispose();
      anchors.dispose();
      toaster.dispose();
      banner.dispose();
      dispatcher.dispose();
      logs.dispose();
      stacking.dispose();
      root.remove();
    },
  };
}

export type { SharedHarness, SharedOptions };
export { createSharedServices, NOW_MS, VIEWPORT, WALL_CLOCK_MS };
