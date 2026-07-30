// Where world state is read from.
//
// Backend A reads __game.world, the same IWorld the game's own renderer and HUD
// consume, so it is already delta-merged and interest-pruned. It is the only
// backend built. Backend B, rebuilding state from snap frames, is the
// contingency if the __game hook ever goes away; addons written against this
// interface would not notice the swap, which is the point of having it.
//
// This is the one place the game's untyped objects become the typed shapes in
// `game-types.ts`. Every assertion below is a claim about a repository this one
// cannot compile against, which is why `shape.ts` checks the live player once at
// world-ready: the types are asserted here and verified there.

import { fieldValue } from '../net/frames.ts';
import { castsOf, type EntityCast, type Hazard, hazardsOf, markersOf } from './derived.ts';
import type { Aura, Entity, InvSlot, PartyInfo, QuestProgress, WorldQuests } from './game-types.ts';
import { readonlyMapView } from './readonly-map.ts';

const NO_ENTITIES: ReadonlyMap<number, Entity> = new Map<number, Entity>();

/**
 * The entity view, rebuilt only when the game swaps the map behind it.
 *
 * The watcher reads this every animation frame and an addon may read it far more
 * often, so building a fresh wrapper per access would allocate for nothing. The
 * game keeps one map for the life of a session, so the cache almost always hits.
 */
function entityMapReader(world: unknown): () => ReadonlyMap<number, Entity> {
  let source: unknown = null;
  let view: ReadonlyMap<number, Entity> = NO_ENTITIES;
  return () => {
    const entities = fieldValue(world, 'entities');
    if (!(entities instanceof Map)) {
      return NO_ENTITIES;
    }
    if (entities !== source) {
      source = entities;
      view = readonlyMapView<number, Entity>(entities);
    }
    return view;
  };
}

/** A live game object, or null when the game does not carry that member yet. */
function readAs<T>(source: unknown, field: string): T | null {
  return fieldValue(source, field) as T | null;
}

/** The entity the player has selected, resolved through the roster. */
function targetOf(world: unknown, entities: ReadonlyMap<number, Entity>): Entity | null {
  const id = fieldValue(fieldValue(world, 'player'), 'targetId');
  if (typeof id !== 'number') {
    return null;
  }
  return entities.get(id) ?? null;
}

/** The two quest collections as one reading, each null until the game has it. */
function questsOf(world: unknown): WorldQuests {
  return {
    log: readAs<Map<string, QuestProgress>>(world, 'questLog'),
    done: readAs<Set<string>>(world, 'questsDone'),
  };
}

export interface WorldBackend {
  /** Which backend answered, so the manager's diagnostics can show it. */
  readonly kind: string;
  readonly player: Entity | null;
  readonly target: Entity | null;
  readonly entities: ReadonlyMap<number, Entity>;
  readonly party: PartyInfo | null;
  readonly inventory: readonly InvSlot[] | null;
  readonly quests: WorldQuests;
  /**
   * Ability id to seconds remaining.
   *
   * Declared readonly, which is a type-level guard and not a boundary: this is
   * the game's own live Map, the same one its HUD reads, so a cast defeats it.
   * `entities` is wrapped for real because addons hold it; this is read fresh.
   */
  readonly cooldowns: ReadonlyMap<string, number> | null;
  readonly auras: readonly Aura[] | null;
  /**
   * Everything in scope that is casting, derived rather than read.
   *
   * There is no such collection on the game object: cast state lives on each
   * entity, and the event that would announce it fires for a player only. See
   * `world/derived.ts` for why that makes this the only way to see a boss cast.
   */
  readonly casts: ReadonlyMap<number, EntityCast>;
  /** The target's auras, which `capture('target')` alone cannot report moving. */
  readonly targetAuras: readonly Aura[] | null;
  readonly hazards: readonly Hazard[] | null;
  readonly markers: ReadonlyMap<number, number> | null;
  /** The real IWorld the game is running. */
  readonly raw: unknown;
}

/**
 * Read __game.world, or null when the hook does not carry one.
 *
 * Every member is a getter: the game mutates these objects in place, so reading
 * on access is what makes the facade live rather than a stale copy.
 */
export function createGameBackend(game: unknown): WorldBackend | null {
  const world = fieldValue(game, 'world');
  if (world === null) {
    return null;
  }
  const entities = entityMapReader(world);

  return {
    kind: 'game',

    get player(): Entity | null {
      return readAs<Entity>(world, 'player');
    },

    get target(): Entity | null {
      return targetOf(world, entities());
    },

    get entities(): ReadonlyMap<number, Entity> {
      return entities();
    },

    get party(): PartyInfo | null {
      return readAs<PartyInfo>(world, 'partyInfo');
    },

    get inventory(): readonly InvSlot[] | null {
      return readAs<InvSlot[]>(world, 'inventory');
    },

    get quests(): WorldQuests {
      return questsOf(world);
    },

    get cooldowns(): ReadonlyMap<string, number> | null {
      return readAs<Map<string, number>>(fieldValue(world, 'player'), 'cooldowns');
    },

    get auras(): readonly Aura[] | null {
      return readAs<Aura[]>(fieldValue(world, 'player'), 'auras');
    },

    get casts(): ReadonlyMap<number, EntityCast> {
      return castsOf(entities());
    },

    get targetAuras(): readonly Aura[] | null {
      return readAs<Aura[]>(targetOf(world, entities()), 'auras');
    },

    get hazards(): readonly Hazard[] | null {
      return hazardsOf(world);
    },

    get markers(): ReadonlyMap<number, number> | null {
      return markersOf(world);
    },

    raw: world,
  };
}
