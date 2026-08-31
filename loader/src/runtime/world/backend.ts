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
import { type ContentReads, contentReads } from './backend-content.ts';
import type { BackendDeps } from './backend-deps.ts';
import { type EconomyReads, economyReads } from './backend-economy.ts';
import { type GearReads, gearReads } from './backend-gear.ts';
import { type GroundReads, groundReads } from './backend-ground.ts';
import { readAs } from './backend-read.ts';
import { type SheetReads, sheetReads } from './backend-sheet.ts';
import { type SocialReads, socialReads } from './backend-social.ts';
import { readCharacterKey } from './character-key.ts';
import { type CombatState, readCombat } from './combat.ts';
import { castsOf, type EntityCast } from './derived.ts';
import { mergeLive } from './facade.ts';
import type {
  Aura,
  Entity,
  EquipSlot,
  HeldSlot,
  QuestProgress,
  WorldQuests,
} from './game-types.ts';
import { type CorpseView, corpseViewOf, viewerOf } from './ground.ts';
import { readMatch } from './match.ts';
import type { PartyInfo } from './party-types.ts';
import { type Reaction, reactionOf } from './reaction.ts';
import { readonlyMapView } from './readonly-map.ts';
import { readThreat, type ThreatTable } from './threat.ts';

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
    match: readMatch(world),
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

    get inventory(): readonly HeldSlot[] | null {
      return readAs<HeldSlot[]>(world, 'inventory');
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

/**
 * The reads the loader ASSEMBLES rather than passes through.
 *
 * Split from `createGameBackend` for the reason `coreReads` was: one object
 * literal holding every getter is past the length a function body is allowed,
 * and the split has to preserve the getters or the facade stops being live.
 * These belong together because none of them is a member of the game's own
 * world object.
 */
function derivedReads(
  world: unknown,
  entities: () => ReadonlyMap<number, Entity>,
  abilities: (world: unknown) => AbilityIndex,
  deps: BackendDeps,
) {
  return {
    get casts(): ReadonlyMap<number, EntityCast> {
      return castsOf(entities());
    },

    get targetAuras(): readonly Aura[] | null {
      return readAs<Aura[]>(targetOf(world, entities()), 'auras');
    },

    get abilities(): AbilityIndex {
      return abilities(world);
    },

    get combat(): CombatState {
      return combatOf(world, entities(), deps);
    },
  };
}

/** The lookups and the escape hatch, which are not state reads. */
function tailReads(world: unknown, entities: () => ReadonlyMap<number, Entity>, deps: BackendDeps) {
  return {
    threat: (entityId: number): ThreatTable =>
      readThreat(entities().get(entityId) ?? null, readAs<Entity>(world, 'player')?.id ?? null),

    corpseLoot: (entityId: number): CorpseView | null =>
      corpseViewOf(entities().get(entityId) ?? null, entityId, viewerOf(world)),

    reaction: (entityId: number): Reaction | null => {
      const roster = entities();
      const entity = roster.get(entityId);
      if (entity === undefined) {
        return null;
      }
      return reactionOf(entity, roster, readMatch(world));
    },

    get characterKey(): string | null {
      return readCharacterKey(deps.realm(), world);
    },

    get spectating(): string | null {
      return readAs<string>(world, 'spectating') ?? null;
    },

    raw: world,
  };
}

export interface WorldBackend
  extends ContentReads,
    EconomyReads,
    GearReads,
    GroundReads,
    SheetReads,
    SocialReads {
  /** Which backend answered, so the manager's diagnostics can show it. */
  readonly kind: string;
  readonly player: Entity | null;
  readonly target: Entity | null;
  readonly entities: ReadonlyMap<number, Entity>;
  readonly party: PartyInfo | null;
  readonly inventory: readonly HeldSlot[] | null;
  /** Worn gear by slot, item ids only. A slot with nothing in it is absent. */
  readonly equipment: Partial<Record<EquipSlot, string>> | null;
  /** The four bag sockets, an item id per equipped bag and null for an empty socket. */
  readonly bags: readonly (string | null)[] | null;
  /** Total slots across the backpack and every equipped bag. */
  readonly bagCapacity: number | null;
  /** Money, in copper. */
  readonly copper: number | null;
  /**
   * Who is playing, as the key everything per-character is filed under.
   *
   * On the backend rather than only on the facade because the watcher reads
   * `backend[key]` directly, and a character SWITCH inside one page load is a
   * change an addon has to be told about.
   */
  readonly characterKey: string | null;
  /**
   * The character being spectated, or null when the session is watching itself.
   *
   * The reason `characterKey` can be null mid-session: see character-key.ts.
   */
  readonly spectating: string | null;
  /** One entity's hate table, measured against the player. */
  readonly threat: (entityId: number) => ThreatTable;
  /** One corpse's contents filtered to what the player could take, or null. */
  readonly corpseLoot: (entityId: number) => CorpseView | null;
  /** Which side one unit is on, or null for an id the roster does not hold. */
  readonly reaction: (entityId: number) => Reaction | null;
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

  // Nested `mergeLive` rather than a spread of the groups: a spread READS every
  // getter once at assembly time, which is the failure the helper's own comment
  // describes and which would freeze the facade at a world of nulls.
  return mergeLive(
    mergeLive(
      mergeLive(coreReads(world, entities), derivedReads(world, entities, abilities, deps)),
      mergeLive(sheetReads(world, deps), socialReads(world)),
    ),
    mergeLive(
      mergeLive(groundReads(world, entities), mergeLive(gearReads(world), contentReads(world))),
      mergeLive(
        economyReads(world, () => entities().size > 0),
        tailReads(world, entities, deps),
      ),
    ),
  );
}
