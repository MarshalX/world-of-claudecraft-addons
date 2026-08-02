// One addon, mounted in a real browser over a scripted fake world.
//
// This is `tests/fakes/addon.ts` with a screen in front of it. The addon goes
// through the REAL `loadAddon`, over the REAL shared services, and draws with the
// REAL kit and stylesheet: nothing here reimplements a frame or a bar, because a
// picture of a reimplementation is a picture of the wrong thing.
//
// It exists because a Vitest suite cannot see what an addon looks like. Every
// `.css` import resolves to `''` under Vitest and happy-dom lays nothing out, so
// the agreement between a class in `ui/kit/` and its rule in `ui/styles/` has only
// ever been checkable by running the loader against a live game. That is also why
// 25 of the 27 addons here ship with no `preview.png`: the states worth a picture
// (a taunt holding a mob, a loot roll, one debuff school ticking) cannot be
// summoned on demand by playing.
//
// The fakes are shared with the suites rather than rewritten, and that is the
// point rather than thrift. A scenario and its addon's suite describe the same
// world in the same words, so a scenario is usually the suite's `start()` with
// the assertions taken out, and neither can drift into describing a game the
// other would not recognise.

import type { FrameBox } from '../../loader/src/runtime/ui/frame/geometry.ts';
import { perCharacterKey, uiNamespace } from '../../loader/src/shared/storage-keys.ts';
import { mountAddon } from '../../tests/fakes/addon.ts';
import { liveEntity } from '../../tests/fakes/entity.ts';
import { PLAYER_ENTITY } from '../../tests/fakes/frames.ts';
import type { SharedHarness } from '../../tests/fakes/shared-services.ts';
import { createFakeStorage } from '../../tests/fakes/storage.ts';

/**
 * Who the stage is logged in as.
 *
 * The pair the shared fake answers `character()` with, repeated here because a
 * seeded frame box is keyed on it and the two have to agree: a box stored against
 * anyone else is one the loader looks for and does not find, which reads as the
 * seeding silently doing nothing.
 */
const CHANNEL = 'pbe';
const CHARACTER = 'Claudemoon/Marshal';

/** One frame's saved state, in the shape `kit/frame-state.ts` stores. */
interface FrameState {
  box: FrameBox;
  visible: boolean;
}

/**
 * A game object as a scenario writes one: fields by name, no declared shape.
 *
 * Deliberately untyped, for the reason `world/game-types.ts` gives: the shapes
 * belong to a repository this one cannot compile against, so a type here would be
 * a claim rather than a check. The suites use the same alias.
 */
type Fake = Record<string, unknown>;

/**
 * Let a pending frame restore land.
 *
 * Three microtask turns, which is what the suites wait and what a frame's stored
 * box and visibility take to come back out of storage. Written out rather than
 * looped, because `noAwaitInLoops` is right in general and this is not a loop
 * over work: it is one fixed number of turns with nothing to parallelise.
 */
async function settleFrames(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * The world before the addon has seen it.
 *
 * Separate from `Stage` because the ORDER is load-bearing and getting it wrong is
 * silent. An addon's body runs the moment it is loaded and reads the world on its
 * first line, so anything a scenario writes afterwards is a change the addon
 * reacts to rather than the state it started from, and the two are not the same
 * picture.
 *
 * The worked example, which is why this exists at all: `cooldown-bars` builds one
 * bar per running cooldown and asks for the ability's icon while building it, and
 * a skill icon is filed under the player's CLASS. A scenario that set `templateId`
 * after mounting got a row for every cooldown the fixture already carried drawn
 * with no icon and never redrawn, beside later rows that had one. It reads as a
 * loader bug in `icon.ability` and it is a fixture written in the wrong order.
 */
interface WorldDraft {
  /** The `__game.world` object itself, for a field no helper below covers. */
  world: Fake;
  /** The local player, already carrying every field the world types promise. */
  player: Fake;
  entities: Map<number, Fake>;
  /** Add a hostile entity. Defaults match what a mob carries on the wire. */
  mob: (id: number, over?: Fake) => Fake;
  /** Write one field. A plain assignment, named so scenarios read alike. */
  set: (target: Fake, field: string, value: unknown) => void;
}

/** The controls a scenario drives its world with, once the addon is up. */
interface Stage extends WorldDraft {
  /** Run the world watcher once, which is what publishes a change to addons. */
  poll: () => void;
  /** Advance the loader's own frame loop, which is what `woc.onFrame` rides. */
  frame: (count?: number) => void;
  /** Move the addon-visible clock, which is what `woc.now()` reads. */
  advance: (ms: number) => void;
  /** Deliver one inbound socket frame, as the socket hook would. */
  inbound: (frame: unknown) => void;
  /** Press a combo in the manifest's own spelling, e.g. 'Alt+Shift+KeyD'. */
  press: (combo: string) => void;
  /** Let a pending frame restore land before the next step reads the DOM. */
  settle: () => Promise<void>;
}

/**
 * One picture worth taking of one addon.
 *
 * Two steps rather than one, and which one a line belongs in is a real decision.
 * `world` runs BEFORE the addon body, so it describes the session the addon woke
 * up in: the class, the spellbook, the bags, anything already true at login.
 * `run` runs after, so it describes what then happened: a cooldown starting, a
 * mob pulling, a number moving.
 *
 * When in doubt put it in `world`. A fact stated late still reaches the addon
 * through a poll, so the shot usually looks right, and the cases where it does
 * not are the ones nobody checks. See WorldDraft for the one that got away.
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
   * Frame boxes and visibility, seeded as the loader's own per-character state.
   *
   * For the case cropping cannot fix: an addon whose default box is the wrong
   * SHAPE for a picture. `combat-meter` opens at a fixed 320px height whatever it
   * is holding, so a shot of four rows is nearly half empty, and no crop can
   * recover the space because the panel really is that tall. Keyed by the
   * addon's own frame id, which is its persistence key.
   *
   * Seeded rather than set afterwards because a frame restores its box once, on
   * the way up. Same namespace and key derivation the loader uses, so a scenario
   * cannot describe a box the loader would not restore.
   */
  frames?: Record<string, FrameState>;
  /**
   * This scenario is part of what `pnpm shots` photographs for this addon.
   *
   * At least one must carry it, and the tool fails on none rather than choosing.
   * Position would otherwise decide, which is invisible: reordering the array to
   * read better would silently change what ships, and `idle` is first in more
   * than one file.
   *
   * SEVERAL may carry it, and then the preview is a sheet of them side by side in
   * array order. That is for an addon whose LAYOUT is a setting, where a picture
   * of one configuration is a picture of half the addon: `cooldown-bars` draws
   * either a column of bars or a strip of swept icons, and which one it shows on
   * its Browse row should not be a coin toss. Each panel is its own iframe, so
   * two panels of one addon are two separate loader instances rather than one
   * addon mounted twice. Every panel of a multi-panel sheet needs a `caption`.
   */
  preview?: true;
  /**
   * The title drawn under this panel in a sheet.
   *
   * Separate from `label`, which is what the picker's dropdown says, because the
   * two are read in different places: a dropdown wants "Five draining bars" and a
   * picture wants "Bars". Left out on a single-panel preview, which has nothing
   * to distinguish itself from and so nothing to title.
   */
  caption?: string;
  /**
   * What the picture shows, for someone who cannot see it.
   *
   * Required on the preview scenario, because `pnpm shots` writes it into
   * `addon.json` and a preview with no description is one the manager and the
   * site both render as an unlabelled image. It lives HERE rather than only in
   * the manifest so the sentence and the fixture that produces it are edited
   * together: an alt text describing rows a scenario no longer draws is the
   * failure this placement is trying to avoid.
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

/** What a mob carries that a player does not, so a scenario need not repeat it. */
function mobDefaults(id: number): Fake {
  return {
    id,
    name: `Mob${String(id)}`,
    kind: 'mob',
    hostile: true,
    aggroTargetId: null,
    forcedTargetId: null,
    forcedTargetTimer: 0,
    threat: new Map<number, number>(),
  };
}

/**
 * The player a scenario starts from: a complete live entity, emptied of the
 * suites' fixture values.
 *
 * `liveEntity()` carries `cooldowns: new Map([['aimed_shot', 4]])`, which is a
 * convenience for a suite and a lie in a photograph. Every addon that reads
 * cooldowns would draw a row for an ability its scenario never mentioned, and an
 * addon whose subject is something else entirely would have one in the corner of
 * its Browse thumbnail. Emptied here rather than changed in the shared fixture,
 * because a suite asserting on that Map is asserting on something real.
 */
function createPlayer(): Fake {
  return liveEntity({ set: { cooldowns: new Map<string, number>(), auras: [] } });
}

/**
 * The fake `__game.world`, built before the addon so the loader can be handed it.
 *
 * `known` starts empty because that is the state every session genuinely starts
 * in: the spellbook is not populated before world entry, so an addon reading it
 * on its first line has to cope with nothing being there. A scenario that wants
 * one fills it in its `world` step, which still runs before the addon body.
 */
function createWorld(player: Fake, entities: Map<number, Fake>): Fake {
  return { entities, player, partyInfo: null, known: [] };
}

/** The half of the surface that works with no addon mounted. */
function createDraft(world: Fake, player: Fake, entities: Map<number, Fake>): WorldDraft {
  return {
    world,
    player,
    entities,
    mob: (id, over = {}) => {
      const entity = liveEntity({ set: { ...mobDefaults(id), ...over } });
      entities.set(id, entity);
      return entity;
    },
    set: (target, field, value) => {
      target[field] = value;
    },
  };
}

interface ControlDeps {
  draft: WorldDraft;
  harness: SharedHarness;
}

/** The controls, bound to a harness that is already up. */
function createControls(deps: ControlDeps): Stage {
  const { harness } = deps;
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
    inbound: harness.inbound,
    press: harness.press,
    settle: settleFrames,
  };
}

/** The screen actually on show, rather than the suites' fixed 800x600. */
function screenViewport(): { w: number; h: number } {
  return { w: globalThis.innerWidth, h: globalThis.innerHeight };
}

/**
 * Mount one addon, run its scenario, and hand back both halves.
 *
 * The scenario's own failure is left to the caller rather than swallowed: a
 * scenario that throws half way leaves a partly drawn addon on screen, and a
 * picture of that is worse than an error message, so `main.ts` reports it.
 */
/**
 * Put a scenario's frame boxes where the loader will look for them.
 *
 * Before the addon runs, because a frame reads its stored box once as it comes
 * up. `mountAddon` takes a storage hub, so this seeds the same one it is handed
 * rather than reaching into it afterwards.
 */
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

async function mountScenario(input: MountInput): Promise<MountedStage> {
  const player = createPlayer();
  const entities = new Map<number, Fake>([[PLAYER_ENTITY.id, player]]);
  const draft = createDraft(createWorld(player, entities), player, entities);
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
    game: Promise.resolve({ world: draft.world }),
    settings: scenario.settings ?? {},
    data: scenario.data ?? {},
    viewport: screenViewport,
  });

  const stage = createControls({ draft, harness });
  await scenario.run(stage);
  return { stage, harness, dispose: harness.dispose };
}

export type { Fake, FrameState, MountedStage, Scenario, ScenarioRegistry, Stage, WorldDraft };
export { mountScenario };
