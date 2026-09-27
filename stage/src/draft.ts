// The world before the addon has seen it, and the controls that shape it. Unlike
// `stage.ts`, this half works with no addon mounted, which is the state a scenario's
// `world` step runs in.

import { liveEntity } from '../../tests/fakes/entity.ts';
import type { ModelSpec, StageCamera } from './camera.ts';

/**
 * A game object as a scenario writes one: fields by name, deliberately untyped, since the
 * shapes belong to a repository this one cannot compile against.
 */
type Fake = Record<string, unknown>;

/**
 * The world before the addon has seen it. Anything a session has at login goes here.
 *
 * Separate from `Stage` because the ORDER is load-bearing and silent: an addon reads the world
 * on its first line, so a fact written after mounting is one it reacts to. For example, a
 * `templateId` set late leaves rows already built with no class to file skill art under, which
 * looks like a bug in `icon.ability`.
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
  /**
   * The game's minimap label, which is all `world.zone` reads. The loader takes it from the
   * HUD, which the stage has none of, so without this every scenario's zone is null. Null
   * is a real answer: the game says nothing before world entry.
   */
  zone: (name: string | null) => void;
  /**
   * How tall the game is drawing one unit, which places an overhead anchor. Two yards unless
   * stated. It lives on the renderer, as in the game: no wire field carries a model height.
   */
  model: (id: number, spec: ModelSpec) => void;
}

/** What the game's minimap is saying right now, read per call. See WorldDraft.zone. */
interface ZoneLabel {
  read: () => string | null;
  write: (name: string | null) => void;
}

/** What a draft is built over: the world it writes into and the fakes behind it. */
interface DraftDeps {
  world: Fake;
  player: Fake;
  entities: Map<number, Fake>;
  camera: StageCamera;
  label: ZoneLabel;
}

/**
 * What a mob carries that a player does not. Nullable ids are left to `liveEntity`,
 * which answers null for every nullable field.
 */
function mobDefaults(id: number): Fake {
  return {
    id,
    name: `Mob${String(id)}`,
    kind: 'mob',
    hostile: true,
    forcedTargetTimer: 0,
    threat: new Map<number, number>(),
  };
}

/**
 * The player a scenario starts from, emptied of the suites' fixture values: `liveEntity()`
 * carries a running cooldown that would appear in every preview. Emptied here, not in the
 * shared fixture, because suites assert on it.
 */
function createPlayer(): Fake {
  return liveEntity({
    set: {
      cooldowns: new Map<string, number>(),
      auras: [],
      kind: 'player',
    },
  });
}

/**
 * The fake `__game.world`. `known` starts empty, as the spellbook does before world entry;
 * a scenario fills it in its `world` step.
 */
function createWorld(player: Fake, entities: Map<number, Fake>): Fake {
  return { entities, player, partyInfo: null, known: [] };
}

function createZoneLabel(): ZoneLabel {
  let said: string | null = null;
  return {
    read: () => said,
    write: (name) => {
      said = name;
    },
  };
}

/** The half of the surface that works with no addon mounted. */
function createDraft(deps: DraftDeps): WorldDraft {
  const { world, player, entities, camera, label } = deps;
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
    zone: label.write,
    model: camera.model,
  };
}

export type { DraftDeps, Fake, WorldDraft, ZoneLabel };
export { createDraft, createPlayer, createWorld, createZoneLabel };
