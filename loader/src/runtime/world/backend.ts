// Where world state is read from: `__game.world`, the same delta-merged, interest-pruned IWorld
// the game's HUD reads. The interface would also fit a backend rebuilt from snap frames, if the
// hook ever went away.
//
// The one place the game's untyped objects become the shapes in `game-types.ts`; the types are
// asserted here and verified against the live player by `shape.ts`.

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
import { readMoveSpeedMult } from './movement.ts';
import type { PartyInfo } from './party-types.ts';
import { type Reaction, reactionOf } from './reaction.ts';
import { readonlyMapView } from './readonly-map.ts';
import { readThreat, type ThreatTable } from './threat.ts';

const NO_ENTITIES: ReadonlyMap<number, Entity> = new Map<number, Entity>();

/**
 * The entity view, rebuilt only when the game swaps the map behind it, which it rarely does.
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

/** The combat reading, gathered for `combat.ts`, which knows nothing about the game object. */
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
 * The reads the loader ASSEMBLES rather than passes through. Every group must stay getters, or
 * the facade stops being live.
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

    get moveSpeedMult(): number | null {
      return readMoveSpeedMult(world);
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
   * Who is playing, as the key everything per-character is filed under. On the backend so the
   * watcher can report a character switch within one page load.
   */
  readonly characterKey: string | null;
  /**
   * The character being spectated, or null when the session is watching itself. Why
   * `characterKey` can be null mid-session: see character-key.ts.
   */
  readonly spectating: string | null;
  /** The server's own movement-speed multiplier for the player, or null. See `movement.ts`. */
  readonly moveSpeedMult: number | null;
  /** One entity's hate table, measured against the player. */
  readonly threat: (entityId: number) => ThreatTable;
  /** One corpse's contents filtered to what the player could take, or null. */
  readonly corpseLoot: (entityId: number) => CorpseView | null;
  /** Which side one unit is on, or null for an id the roster does not hold. */
  readonly reaction: (entityId: number) => Reaction | null;
  readonly quests: WorldQuests;
  /**
   * Ability id to seconds remaining. The game's own live Map, so `readonly` is a type-level guard
   * only; `entities` is wrapped for real because addons hold it.
   */
  readonly cooldowns: ReadonlyMap<string, number> | null;
  readonly auras: readonly Aura[] | null;
  /**
   * Everything in scope that is casting, derived from each entity's cast fields. The only way to
   * see a mob's cast: see `world/derived.ts`.
   */
  readonly casts: ReadonlyMap<number, EntityCast>;
  /** The target's auras, which `capture('target')` alone cannot report moving. */
  readonly targetAuras: readonly Aura[] | null;
  /**
   * The player's own spellbook, projected and memoized. Never null: an empty index answers the
   * same questions.
   */
  readonly abilities: AbilityIndex;
  /**
   * Whether the player is fighting, and which signal said so. Derived: see `world/combat.ts`.
   */
  readonly combat: CombatState;
  /** The real IWorld the game is running. */
  readonly raw: unknown;
}

/**
 * Read __game.world, or null when the hook does not carry one. Every member is a getter, since
 * the game mutates these objects in place.
 */
export function createGameBackend(game: unknown, deps: BackendDeps): WorldBackend | null {
  const world = fieldValue(game, 'world');
  if (world === null) {
    return null;
  }
  const entities = entityMapReader(world);
  const abilities = createAbilityReader();

  // `mergeLive`, never a spread: a spread reads every getter once and freezes a world of nulls.
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
