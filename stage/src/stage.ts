// One addon, mounted in a real browser over a scripted fake world, for what a Vitest
// suite cannot see: how it LOOKS.
//
// The addon goes through the REAL `loadAddon`, shared services, kit and stylesheet;
// nothing here reimplements a frame or a bar. The fakes are the suites' own, so a
// scenario and its addon's suite describe the same world in the same words.

import type { NetState } from '../../loader/src/runtime/net/state.ts';
import type { FrameBox } from '../../loader/src/runtime/ui/frame/geometry.ts';
import { perCharacterKey, uiNamespace } from '../../loader/src/shared/storage-keys.ts';
import { mountAddon } from '../../tests/fakes/addon.ts';
import { PLAYER_ENTITY } from '../../tests/fakes/frames.ts';
import { type SharedHarness, WALL_CLOCK_MS } from '../../tests/fakes/shared-services.ts';
import { createFakeStorage } from '../../tests/fakes/storage.ts';
import { createStageCamera } from './camera.ts';
import {
  createDraft,
  createPlayer,
  createWorld,
  createZoneLabel,
  type Fake,
  type WorldDraft,
} from './draft.ts';

/**
 * Who the stage is logged in as. Must match what the shared fake answers `character()`
 * with, or a seeded frame box is silently never found.
 */
const CHANNEL = 'pbe';
const CHARACTER = 'Claudemoon/Marshal';

/** One frame's saved state, in the shape `kit/frame-state.ts` stores. */
interface FrameState {
  box: FrameBox;
  visible: boolean;
}

/**
 * Let a pending frame restore land: three microtask turns, as the suites wait. Written out
 * because `noAwaitInLoops` forbids the loop.
 */
async function settleFrames(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/** The controls a scenario drives its world with, once the addon is up. */
interface Stage extends WorldDraft {
  /** Run the world watcher once, publishing a change to addons. */
  poll: () => void;
  /**
   * Advance the loader's own frame loop, which `woc.onFrame` and `woc.paint` ride. An addon
   * that paints through `woc.paint` draws nothing until a scenario calls this.
   */
  frame: (count?: number) => void;
  /** Move the monotonic clock `woc.now()` reads. */
  advance: (ms: number) => void;
  /**
   * Let this much WALL clock pass, the clock `woc.wallClock()` reads and a stored stamp is
   * compared against. Separate from `advance` because `woc.now()` restarts on every page
   * load. Forward only, as a delta, so a scenario never needs the fake's epoch.
   */
  elapse: (ms: number) => void;
  /** Deliver one inbound socket frame, as the socket hook would. */
  inbound: (frame: unknown) => void;
  /**
   * Override part of what `net.state` answers. `latencyMs` needs an outbound input frame
   * paired with a later ack, and only the inbound tap is wired, so a scenario states it.
   */
  netState: (patch: Partial<NetState>) => void;
  /** Press a combo in the manifest's own spelling, e.g. 'Alt+Shift+KeyD'. */
  press: (combo: string) => void;
  /** Let a pending frame restore land before the next step reads the DOM. */
  settle: () => Promise<void>;
  /**
   * Emit on the bus AS another addon (`from` is its fqid), standing in for a companion that
   * is not mounted on the stage.
   */
  publish: (from: string, topic: string, payload: unknown) => void;
  /**
   * Turn the loader's arrange mode on, the only way a BARE frame can be dragged or resized.
   * Its keybind lives in runtime/boot.ts, which the stage does not run.
   */
  arrange: (on: boolean) => void;
}

/**
 * One picture worth taking of one addon.
 *
 * `world` runs BEFORE the addon body: the class, the spellbook, the bags, anything true at
 * login. `run` runs after: a cooldown starting, a mob pulling. When in doubt use `world`;
 * a fact stated late usually still looks right, and the exceptions go unnoticed.
 */
interface Scenario {
  /** Unique within the addon, and the value of the `scenario` URL parameter. */
  id: string;
  /** What the picker calls it. */
  label: string;
  /** Seeded BEFORE the body is evaluated, since an addon reads them on line one. */
  settings?: Record<string, unknown>;
  /** Data files as the host caches them: raw TEXT keyed by the declared path. */
  data?: Record<string, string>;
  /**
   * Frame boxes and visibility, keyed by frame id and seeded as the loader's per-character
   * state before mount (a frame restores once, on the way up). For a default box whose SHAPE
   * cropping cannot fix. A box shorter than the frame's declared height is clamped back up.
   */
  frames?: Record<string, FrameState>;
  /**
   * Part of what `pnpm shots` photographs. At least one scenario must carry it; the tool
   * never picks by position.
   *
   * SEVERAL may carry it, for an addon whose LAYOUT is a setting: the preview is then a sheet
   * of them side by side in array order, each needing a `caption`.
   */
  preview?: true;
  /** The title under this panel in a multi-panel sheet; `label` is the picker's. */
  caption?: string;
  /**
   * What the picture shows, for someone who cannot see it. Required on a preview scenario;
   * `pnpm shots` copies it into `addon.json`. Kept beside the fixture so the two are edited
   * together.
   */
  alt?: string;
  /** Shape the world the addon starts in. Runs before the body is evaluated. */
  world?: (draft: WorldDraft) => void;
  /** Drive it. Runs after the addon has mounted and drawn. */
  run: (stage: Stage) => void | Promise<void>;
}

/** Every scenario file's one export, by addon id. */
type ScenarioRegistry = ReadonlyMap<string, readonly Scenario[]>;

interface MountInput {
  /** The addon id, which is half of the fqid a seeded frame box is stored under. */
  id: string;
  manifest: string;
  source: string;
  scenario: Scenario;
}

interface MountedStage {
  stage: Stage;
  harness: SharedHarness;
  dispose: () => void;
}

interface ControlDeps {
  draft: WorldDraft;
  harness: SharedHarness;
}

/** The controls, bound to a harness that is already up. */
function createControls(deps: ControlDeps): Stage {
  const { harness } = deps;
  // The harness takes a stamp, so the running total lives here.
  let wall = WALL_CLOCK_MS;
  return {
    ...deps.draft,
    poll: () => {
      harness.shared.world.watcher.poll();
    },
    frame: (count = 1) => {
      for (let i = 0; i < count; i += 1) {
        harness.frames.tick();
      }
    },
    advance: harness.advance,
    elapse: (ms) => {
      wall += ms;
      harness.setWallClock(wall);
    },
    inbound: harness.inbound,
    netState: harness.netState,
    press: harness.press,
    settle: settleFrames,
    publish: harness.shared.bus.emit,
    arrange: harness.unlock.set,
  };
}

/** The real screen, instead of the suites' fixed 800x600. */
function screenViewport(): { w: number; h: number } {
  return { w: globalThis.innerWidth, h: globalThis.innerHeight };
}

/**
 * Read an art manifest for real, over the proxy `tools/stage-core.ts` runs. The suites'
 * never-settling default would leave `ui.icon.itemArtName` null and photograph raw ids.
 */
async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} answered ${String(response.status)}`);
  }
  return await response.json();
}

/** Seed frame boxes into the storage `mountAddon` is handed, before the addon runs. */
async function seedFrames(
  storage: ReturnType<typeof createFakeStorage>,
  fqid: string,
  frames: Record<string, FrameState>,
): Promise<void> {
  await Promise.all(
    Object.entries(frames).map(([frameId, state]) =>
      storage.set(uiNamespace(fqid), perCharacterKey(CHANNEL, CHARACTER, frameId), state),
    ),
  );
}

/**
 * Mount one addon and run its scenario. A scenario's failure propagates, so `main.ts` reports
 * it instead of photographing a half-drawn addon.
 */
async function mountScenario(input: MountInput): Promise<MountedStage> {
  const player = createPlayer();
  const entities = new Map<number, Fake>([[PLAYER_ENTITY.id, player]]);
  const camera = createStageCamera({ entities, player, viewport: screenViewport });
  const label = createZoneLabel();
  const draft = createDraft({
    world: createWorld(player, entities),
    player,
    entities,
    camera,
    label,
  });
  const { scenario } = input;
  scenario.world?.(draft);

  const storage = createFakeStorage();
  if (scenario.frames !== undefined) {
    await seedFrames(storage, `official/${input.id}`, scenario.frames);
  }

  const harness = await mountAddon({
    manifest: input.manifest,
    source: input.source,
    storage,
    // One object carries the world and the renderer, as in the game.
    game: Promise.resolve({ world: draft.world, renderer: camera.renderer }),
    settings: scenario.settings ?? {},
    data: scenario.data ?? {},
    viewport: screenViewport,
    project: camera.project,
    unitPoint: camera.unitPoint,
    fetchJson,
    zoneName: label.read,
  });

  const stage = createControls({ draft, harness });
  await scenario.run(stage);
  return { stage, harness, dispose: harness.dispose };
}

// Re-exported so an addon's `stage.ts` imports every scenario shape from one module.
export type { Fake, WorldDraft } from './draft.ts';
export type { FrameState, MountedStage, Scenario, ScenarioRegistry, Stage };
export { mountScenario };
