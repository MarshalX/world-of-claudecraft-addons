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
import { type AbilityIndex, createAbilityReader } from './abilities.ts';
import { type CombatState, readCombat } from './combat.ts';
import { castsOf, type EntityCast, type Hazard, hazardsOf, markersOf } from './derived.ts';
import { mergeLive } from './facade.ts';
import type {
  Aura,
  Entity,
  EquipSlot,
  InvSlot,
  PartyInfo,
  QuestProgress,
  WorldQuests,
} from './game-types.ts';
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

/**
 * The combat reading, gathered from the three live collections it consults.
 *
 * Its own function rather than an inline getter because it is the one read here
 * that takes several parts of the world at once; the rule it feeds lives in
 * `combat.ts` and knows nothing about the game object.
 */
function combatOf(
  world: unknown,
  entities: ReadonlyMap<number, Entity>,
  deps: BackendDeps,
): CombatState {
  return readCombat({
    player: readAs<Entity>(world, 'player'),
    party: readAs<PartyInfo>(world, 'partyInfo'),
    entities,
    lastDamageAt: deps.lastDamageAt(),
    now: deps.now(),
  });
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

/** The reads that pass straight through to a member of the game's own world. */
function coreReads(world: unknown, entities: () => ReadonlyMap<number, Entity>) {
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

    get equipment(): Partial<Record<EquipSlot, string>> | null {
      return readAs<Partial<Record<EquipSlot, string>>>(world, 'equipment');
    },

    get bags(): readonly (string | null)[] | null {
      return readAs<(string | null)[]>(world, 'bags');
    },

    get bagCapacity(): number | null {
      return readAs<number>(world, 'bagCapacity');
    },

    get copper(): number | null {
      return readAs<number>(world, 'copper');
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
  /** Worn gear by slot, item ids only. A slot with nothing in it is absent. */
  readonly equipment: Partial<Record<EquipSlot, string>> | null;
  /** The four bag sockets, an item id per equipped bag and null for an empty socket. */
  readonly bags: readonly (string | null)[] | null;
  /** Total slots across the backpack and every equipped bag. */
  readonly bagCapacity: number | null;
  /** Money, in copper. */
  readonly copper: number | null;
  /** The zone name the game is displaying. See `world/zone.ts`. */
  readonly zone: string | null;
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
  /**
   * The player's own spellbook, projected and memoized.
   *
   * Never null, because it is a lookup rather than a reading: an empty index
   * answers the same questions as a populated one. It is also the only member
   * here backed by a STATEFUL reader, since the game rebuilds its resolved list
   * on every snapshot and re-projecting twenty abilities at that rate would
   * allocate for nothing.
   */
  readonly abilities: AbilityIndex;
  /**
   * Whether the player is fighting, and which signal said so.
   *
   * Derived rather than read: the game sends no combat flag for the self record.
   * See `world/combat.ts` for the order the signals are consulted in and why the
   * answer carries its own source.
   */
  readonly combat: CombatState;
  /** The real IWorld the game is running. */
  readonly raw: unknown;
}

/** What the combat reading needs that the game object does not carry. */
export interface BackendDeps {
  /** When damage involving the player last landed. See `world/combat-clock.ts`. */
  lastDamageAt: () => number | null;
  now: () => number;
  /**
   * The zone name off the game's own minimap label.
   *
   * A dep rather than a read off the world object because it is the one member
   * here whose source is the DOM: the zone table is content the loader cannot
   * reach. See `world/zone.ts`.
   */
  zoneName: () => string | null;
}

/**
 * Read __game.world, or null when the hook does not carry one.
 *
 * Every member is a getter: the game mutates these objects in place, so reading
 * on access is what makes the facade live rather than a stale copy.
 */
export function createGameBackend(game: unknown, deps: BackendDeps): WorldBackend | null {
  const world = fieldValue(game, 'world');
  if (world === null) {
    return null;
  }
  const entities = entityMapReader(world);
  const abilities = createAbilityReader();

  return mergeLive(coreReads(world, entities), {
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

    get abilities(): AbilityIndex {
      return abilities(world);
    },

    get combat(): CombatState {
      return combatOf(world, entities(), deps);
    },

    get zone(): string | null {
      return deps.zoneName();
    },

    raw: world,
  });
}
