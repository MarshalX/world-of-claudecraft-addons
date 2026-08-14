// The world before the addon has seen it, and the controls that shape it.
//
// Split from `stage.ts`, which mounts an addon over one of these and then hands a scenario the
// controls for driving it. The two halves answer different questions and only this one is
// meaningful with no addon in the document at all, which is exactly the state a scenario's
// `world` step runs in.
//
// Nothing here knows what a scenario is or how one is loaded. What it knows is what a session
// looks like at the moment a body is evaluated: a player, whatever else is in scope, the game's
// own minimap label, and how tall the renderer is drawing each of them.

import { liveEntity } from '../../tests/fakes/entity.ts';
import type { ModelSpec, StageCamera } from './camera.ts';

/**
 * A game object as a scenario writes one: fields by name, no declared shape.
 *
 * Deliberately untyped, for the reason `world/game-types.ts` gives: the shapes belong to a
 * repository this one cannot compile against, so a type here would be a claim rather than a
 * check. The suites use the same alias.
 */
type Fake = Record<string, unknown>;

/**
 * The world before the addon has seen it.
 *
 * Separate from `Stage` because the ORDER is load-bearing and getting it wrong is silent. An
 * addon's body runs the moment it is loaded and reads the world on its first line, so anything
 * a scenario writes afterwards is a change the addon reacts to rather than the state it started
 * from, and the two are not the same picture.
 *
 * The worked example, which is why this exists at all: `cooldown-bars` builds one bar per
 * running cooldown and asks for the ability's icon while building it, and a skill icon is filed
 * under the player's CLASS. A scenario that set `templateId` after mounting got a row for every
 * cooldown the fixture already carried drawn with no icon and never redrawn, beside later rows
 * that had one. It reads as a loader bug in `icon.ability` and it is a fixture written in the
 * wrong order.
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
   * The game's own minimap label, which is the whole of what `world.zone` is.
   *
   * Its own control rather than a field on `world`, because that is where it comes from in the
   * game: nothing on the hook publishes a zone, and the loader reads the text the minimap
   * painter writes into the HUD. There is no HUD here, so without this the label is null for
   * every scenario and an addon that draws it is photographed with the line blank.
   *
   * Null is a real answer and means the game has nothing to say, which is what it answers
   * before world entry.
   */
  zone: (name: string | null) => void;
  /**
   * How tall the game is drawing one unit, which is the whole of what an overhead anchor is
   * placed by. Two yards unless a scenario says otherwise.
   *
   * On the renderer rather than on the entity, because that is where it is in the real game:
   * nothing on the wire carries a model height, which is why `over: 'head'` exists at all. See
   * stage/src/camera.ts.
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
 * What a mob carries that a player does not, so a scenario need not repeat it.
 *
 * The three null ids this used to spell out are gone: `liveEntity` now answers
 * null for every NULLABLE field rather than its kind's zero, so a mob no longer
 * arrives owned by entity 0, tapped by entity 0 and casting at entity 0. Stating
 * them here would have covered the three somebody thought of.
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
 * The player a scenario starts from: a complete live entity, emptied of the suites' fixture
 * values.
 *
 * `liveEntity()` carries `cooldowns: new Map([['aimed_shot', 4]])`, which is a convenience for a
 * suite and a lie in a photograph. Every addon that reads cooldowns would draw a row for an
 * ability its scenario never mentioned, and an addon whose subject is something else entirely
 * would have one in the corner of its Browse thumbnail. Emptied here rather than changed in the
 * shared fixture, because a suite asserting on that Map is asserting on something real.
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
 * The fake `__game.world`, built before the addon so the loader can be handed it.
 *
 * `known` starts empty because that is the state every session genuinely starts in: the
 * spellbook is not populated before world entry, so an addon reading it on its first line has to
 * cope with nothing being there. A scenario that wants one fills it in its `world` step, which
 * still runs before the addon body.
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
