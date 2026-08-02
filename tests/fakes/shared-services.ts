// The SharedServices bundle, built once and shared by every addon.
//
// Three suites need it now (api assembly, the per-addon loader, the supervisor),
// so it lives here rather than being rebuilt in each. Everything is real except
// the four things that would reach outside the process: the socket, the game
// object, the audio sink, and the SFX pack fetch.
//
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
import { createUnlockMode } from '../../loader/src/runtime/ui/kit/unlock.ts';
import { HUD_BAND_CLASS, OVERLAY_BAND_CLASS } from '../../loader/src/runtime/ui/root.ts';
import { createWorldHub } from '../../loader/src/runtime/world/hub.ts';
import { createFrameClock, type FrameClock } from './frame-loop.ts';
import { createFakeStorage, type FakeStorage } from './storage.ts';

const VIEWPORT = { w: 800, h: 600 };

/**
 * A pack with cues in it rather than an empty one, in the DEPLOYED shape: a
 * variant is a record with a url, NOT a bare string.
 *
 * `cues()` answering empty is indistinguishable from a pack that failed to load,
 * so a suite checking that an addon can name a cue needs at least one to exist.
 * Built from entry pairs because every cue name here is the GAME's, not this
 * project's: a naming convention for our own identifiers has nothing to say
 * about `ui_ready_check`.
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
    // Multi-variant, which is what makes a cue not a file.
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
  /** Press a combo, in the manifest's own spelling, e.g. 'Alt+Shift+KeyD'. */
  press: (combo: string) => void;
  /** Deliver one inbound frame, as the socket hook would. */
  inbound: (frame: unknown) => void;
  /** Move the addon-visible clock. Reads `woc.now()`, not wall clock. */
  advance: (ms: number) => void;
  /**
   * Set what `woc.wallClock()` answers, in epoch milliseconds.
   *
   * Separate from `advance` rather than moved by it, because the whole point of
   * having two clocks is that they come apart. A page reload is exactly the case
   * an addon storing a stamp has to survive, and it is hours of WALL clock beside
   * a monotonic clock that went back to zero. A suite that could only move both
   * together could not express it.
   *
   * `vi.setSystemTime` does not reach this: the loader binds `shared.wallClock`
   * by reference when the API is assembled, so the fake has to be the thing that
   * moves.
   */
  setWallClock: (ms: number) => void;
  /**
   * Override part of what `net.state` answers.
   *
   * Here rather than in each suite because the one field addons actually reach
   * for, `latencyMs`, cannot be produced by driving this fake: it is measured by
   * pairing an OUTBOUND input frame's sequence number against the acknowledgement
   * a later snapshot carries, and only the inbound tap is wired. So a suite that
   * needs a latency reading has to state one, and stating it in one blessed place
   * beats every addon inventing its own stub.
   *
   * Replaces the accessor rather than a stored value, which is what `net.state`
   * reads through on every access, so a reading taken after this call sees it.
   */
  netState: (patch: Partial<NetState>) => void;
  /**
   * Seed one addon's data file, as the host's install-time cache holds it: raw
   * TEXT keyed by the path the manifest declared, not a parsed value.
   *
   * Nothing is seeded by default and the default reader REJECTS, so a suite that
   * means to exercise `woc.data` has to say so. An empty stub that resolved would
   * make an addon reading a file it never declared look like it worked.
   */
  addonData: (fqid: string, name: string, text: string) => void;
  dispose: () => void;
}

interface SharedOptions {
  /**
   * The __game handle, so a suite can bring the world up.
   *
   * Defaults to a promise that never resolves, because an addon has to be usable
   * before world entry and a suite that waited for this would hang, not fail.
   */
  game?: Promise<unknown>;
  /**
   * What the loader measures the screen as, for placing frames and popovers.
   *
   * An option rather than a constant because the two consumers want opposite
   * things. A suite wants a viewport that cannot move under it, which is what the
   * fixed default gives. `stage/` wants the one actually on screen: the addon
   * root is `position: fixed; inset: 0`, so a frame centred in an 800px viewport
   * that is really 1600px wide sits visibly off to the left.
   *
   * It has to be settable HERE rather than patched afterwards. `api/bind.ts`
   * copies `shared.viewport` by reference when the addon's surface is assembled,
   * and `kit/frame.ts` takes it from its deps the same way, so a function
   * replaced after `loadAddon` is one nothing reads.
   */
  viewport?: () => { w: number; h: number };
  /**
   * Where a world point lands on screen, and where a unit is in the world.
   *
   * The default pair is blind on purpose: one constant screen point for every
   * world point, and no unit resolving at all. A suite about a decision an addon
   * makes wants a camera it cannot accidentally depend on, and one that needs
   * real positions says so by replacing `kit.project` and `kit.unitPoint`, which
   * `ui.project` reads per call.
   *
   * These two options are for the case that patching cannot reach: `stage/`
   * needs anchors to be PLACED, and `createAnchors` captures its projector and
   * its unit resolver when it is built, so a function assigned to `kit`
   * afterwards moves what `ui.project` answers and not where anything is drawn.
   * See `stage/src/camera.ts`, which supplies the loader's own two modules over
   * a fake renderer rather than a stand-in for their answers.
   */
  project?: SharedServices['kit']['project'];
  unitPoint?: SharedServices['kit']['unitPoint'];
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
  // The two stacking bands, built as the loader builds them rather than aliased to
  // the root. Aliasing would make every band a suite could get wrong the same
  // element, so a frame mounted into the overlay would pass. See ui/root.ts.
  const hud = doc.createElement('div');
  hud.className = HUD_BAND_CLASS;
  const overlay = doc.createElement('div');
  overlay.className = OVERLAY_BAND_CLASS;
  root.append(hud, overlay);

  // One reader behind every surface that measures the screen. Two of them
  // disagreeing would put a tooltip off the edge of the viewport its own frame
  // was placed inside.
  const viewport = options.viewport ?? ((): { w: number; h: number } => VIEWPORT);

  // One clock behind both the net hub and woc.now(), so a suite that advances
  // time moves what an addon measures with and what the bus timestamps by.
  let clock = NOW_MS;
  let wall = WALL_CLOCK_MS;
  const now = (): number => clock;
  let deliver: ((data: unknown) => void) | null = null;

  const injector = createGameInjector({ doc });
  const noTimers = { setTimer: () => 0, clearTimer: () => undefined };
  const toaster = createToaster({ doc, root: overlay, ...noTimers });
  const banner = createBanner({ doc, root: overlay, ...noTimers });
  // Neither settles, so `icon.ability` and `icon.item` stay optimistic: the same
  // state a row drawn before the art manifests land is in.
  const pendingManifest = (): Promise<unknown> => new Promise(() => undefined);
  const icons = createIconUrls(
    createSkillArt({ fetchJson: pendingManifest }),
    createItemArt({ fetchJson: pendingManifest }),
  );
  const tooltips = createTooltips({ doc, root, layer: overlay, viewport });
  const menus = createMenus({ doc, root: overlay, viewport });
  // The projector answers, so an addon's anchor lands somewhere; the frame clock
  // does not, so nothing here runs a loop a suite would have to stop.
  // The real loop over a clock the suite steps. Nothing runs until `frames.tick`,
  // so a suite that is not about frames still starts nothing.
  const frames = createFrameClock();
  const project =
    options.project ??
    ((): { x: number; y: number; depth: number; behind: boolean } => ({
      x: 100,
      y: 200,
      depth: 10,
      behind: false,
    }));
  // No unit has a place here: a suite that wants one fakes the world it needs.
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
  const logs = createLogBuffer();
  const stacking = createStacking({ root });
  // Keyed on the pair, because two addons may legitimately declare the same
  // file name and reading one another's would be the bug worth catching.
  const dataFiles = new Map<string, string>();

  const shared: SharedServices = {
    doc,
    window: globalThis as unknown as SharedServices['window'],
    net: createNetHub({
      now,
      install: (taps) => {
        deliver = taps.onMessage;
        return () => {
          deliver = null;
        };
      },
    }),
    world: createWorldHub({
      game: options.game ?? new Promise(() => undefined),
      schedule: () => 0,
      cancel: () => undefined,
      // No damage clock in a fake: the combat reading falls through to its state
      // branches, which is what a test driving world state wants to exercise.
      lastDamageAt: () => null,
      now: () => 0,
      zoneName: () => null,
      simNow: () => null,
      realm: () => null,
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
      unlock: createUnlockMode(root),
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
    press: (combo) => {
      const parts = combo.split('+');
      // The last segment is the physical key; everything before it is a
      // modifier, which is the order the combo strings are written in.
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
      // The realm has its own accessor, because the world backend reads it per
      // sample and `state()` allocates. A patch that moved one and not the other
      // would make `net.state().realm` and `world.characterKey` disagree in a
      // suite, which is precisely the bug the one derivation exists to prevent.
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
