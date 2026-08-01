// The world around the entity: the group, the bags, the quest log, the ground,
// and every read `woc.world` answers.
//
// The entity and its parts live in `entity.d.ts` and are re-exported through
// `index.d.ts` alongside these, so an addon author sees one surface either way.

import type { AbilityIndex } from './abilities.js';
import type { Unsubscribe } from './addon.js';
import type { CharacterInfo, ProfessionInfo, TalentInfo } from './character.js';
import type { Aura, AuraKind, Entity, ResourceType } from './entity.js';

/** A compact aura summary for a party row. Not the full `Aura`. */
export interface PartyMemberAura {
  id: string;
  kind: AuraKind;
  /** 1 when the effect is a debuff. */
  neg?: 1;
  /** Whole seconds. Absent on an older snapshot. */
  remaining?: number;
}

/**
 * One party or raid row.
 *
 * These are the terse wire names, not the entity's: a row carries `mhp` where an
 * entity carries `maxHp`, and the flags are 0 or 1 rather than booleans. Party
 * rows come straight off the socket, which is why they read differently from
 * everything else here.
 */
export interface PartyMember {
  pid: number;
  name: string;
  /** The class id, e.g. 'hunter'. */
  cls: string;
  level: number;
  hp: number;
  mhp: number;
  res: number;
  mres: number;
  rtype: ResourceType | null;
  x: number;
  z: number;
  dead: number;
  inCombat: number;
  /** Raid subgroup. */
  group: 1 | 2;
  /** Remaining absorb total. Absent on an older snapshot. */
  absorb?: number;
  role?: 'tank' | 'healer' | 'dps';
  /** 0 only when the realm reports this member disconnected. */
  connected?: number;
  /** 1 while a living hostile is targeting this member. */
  hasAggro?: number;
  incomingHeal?: number;
  /** Absent on an older snapshot, which decodes as "no auras". */
  auras?: PartyMemberAura[];
}

export interface PartyInfo {
  /** The leader's pid. */
  leader: number;
  raid: boolean;
  members: PartyMember[];
}

/**
 * A slot a piece of gear is worn in.
 *
 * Closed rather than a string: this is the shape of a paperdoll, not content
 * that grows with a game release.
 */
export type EquipSlot =
  | 'mainhand'
  | 'offhand'
  | 'helmet'
  | 'neck'
  | 'shoulder'
  | 'chest'
  | 'waist'
  | 'legs'
  | 'gloves'
  | 'feet'
  | 'ring1'
  | 'ring2';

/** One stack in the bags. */
export interface InvSlot {
  itemId: string;
  count: number;
  /** The bag cell it was dragged into. Absent when it was never placed by hand. */
  slot?: number;
}

export interface QuestProgress {
  questId: string;
  /** One count per objective, in the quest's own order. */
  counts: number[];
  state: 'active' | 'ready' | 'done';
  /** The reward or branch the player chose, for a quest that offers one. */
  selection?: string;
}

export interface WorldQuests {
  /** Quest id to its live progress. */
  readonly log: ReadonlyMap<string, QuestProgress> | null;
  /** The ids of finished quests. */
  readonly done: ReadonlySet<string> | null;
}

/**
 * What a cast bar says, on any entity rather than only on you.
 *
 * Read this rather than listening for a cast event. `net.onEvent('castStart')`
 * fires for a PLAYER cast, a pet, gathering and fishing, and for nothing else: a
 * mob's mechanic sets its cast state directly, so a boss mod built on the event
 * receives silence and has no way to tell that from a boss that never casts.
 * `world.casts` and `world.on('casts', ...)` are the surface that closes that gap.
 */
export interface EntityCast {
  /** The ability id being cast. */
  ability: string;
  /** Seconds left, against `total`. */
  remaining: number;
  total: number;
  /** Whether it is a channel, which drains rather than completes. */
  channeling: boolean;
}

export type HazardKind = 'frostRing' | 'temporalHourglass';

/**
 * A ground effect with a position, a radius and a life.
 *
 * These two are the only ground effects whose geometry rides the snapshot, and
 * they arrive filtered to what is near you. Every other ground AoE announces
 * itself once as a `spellfxAt` event and then lives only in the renderer, so
 * tracking those means keeping your own list from the events.
 */
export interface Hazard {
  id: string;
  kind: HazardKind;
  x: number;
  z: number;
  radius: number;
  /** The inner edge of a ring's safe middle. 0 when the whole disc is hot. */
  innerRadius: number;
  duration: number;
  remaining: number;
}

/**
 * Which signal answered a combat reading.
 *
 * It travels with the answer because the branches are not equally trustworthy.
 * `party` and `threat` are the server's own opinion, `pvp` is a field the server
 * fills, and `recent` is a five second timer over damage that involved you. An
 * addon that only acts on a certain reading can check; one that does not care
 * can ignore this entirely.
 */
export type CombatSource = 'party' | 'threat' | 'pvp' | 'recent' | 'none';

/**
 * Whether you are fighting.
 *
 * Derived, and it has to be: the server sends no combat flag for you. There IS
 * an `inCombat` on the client entity and the server never writes it, so it reads
 * false for an entire session, which is how an early version of the shipped
 * meter concluded that every fight had ended on every hit.
 */
export interface CombatState {
  active: boolean;
  source: CombatSource;
}

/**
 * A unit you can name.
 *
 * `partyN` counts the OTHER members, 1-based, so `party1` is the first person
 * who is not you and the tokens line up with how a party display is laid out.
 * `raidN` counts every member including you, in the roster's own order.
 *
 * Both resolve to an ENTITY, so both answer null for someone too far away to
 * have one, even while `world.party` still lists them. For a raid display read
 * the party rows, which are complete, and reach for an entity only when you need
 * something a row does not carry.
 */
export type UnitToken =
  | 'player'
  | 'target'
  | 'targettarget'
  | 'pet'
  | `party${number}`
  | `raid${number}`;

/** Which effects to keep. An empty query keeps all of them. */
export interface AuraQuery {
  /** The applying ability's id. */
  id?: string;
  /** What the effect does, e.g. 'dot' or 'stun'. */
  kind?: string;
  /**
   * Only effects YOU applied.
   *
   * The filter a dot tracker needs and the one most likely to be forgotten: two
   * players can carry the same debuff on one target, and without this a display
   * shows a full timer while your own dot quietly expires.
   */
  mine?: boolean;
}

/**
 * The same over a party row's strip, which is a smaller shape.
 *
 * A row's auras carry an id, a kind, whole seconds, and a debuff flag. No
 * source, so there is no `mine` here rather than one that silently does nothing.
 */
export interface PartyAuraQuery {
  id?: string;
  kind?: string;
  /** True for debuffs only, false for buffs only, absent for both. */
  debuff?: boolean;
}

/** What each read returns, and what the matching `world.on` key reports. */
export interface WorldValues {
  player: Entity | null;
  target: Entity | null;
  entities: ReadonlyMap<number, Entity>;
  party: PartyInfo | null;
  inventory: readonly InvSlot[] | null;
  equipment: Partial<Record<EquipSlot, string>> | null;
  bags: readonly (string | null)[] | null;
  copper: number | null;
  zone: string | null;
  character: CharacterInfo | null;
  talents: TalentInfo | null;
  professions: ProfessionInfo | null;
  quests: WorldQuests | null;
  cooldowns: ReadonlyMap<string, number> | null;
  auras: readonly Aura[] | null;
  casts: ReadonlyMap<number, EntityCast>;
  targetAuras: readonly Aura[] | null;
  hazards: readonly Hazard[] | null;
  markers: ReadonlyMap<number, number> | null;
  abilities: AbilityIndex;
  combat: CombatState;
}

/** The state keys `world.on` can watch. Anything else throws. */
export type WorldKey = keyof WorldValues;

export interface WorldApi {
  /**
   * Resolves once the game is readable.
   *
   * Every read below answers null until then, so an addon can hold `woc.world`
   * from its first line and await this separately. It never times out: a player
   * may sit on the login screen for as long as they like.
   */
  readonly ready: Promise<void>;

  readonly player: Entity | null;
  readonly target: Entity | null;

  /**
   * Everything in interest scope.
   *
   * A read-only view of the game's live roster: reads pass through, and set,
   * delete, and clear throw. The entities themselves are the game's own live
   * objects, so this stops a slip rather than being a boundary.
   */
  readonly entities: ReadonlyMap<number, Entity>;

  readonly party: PartyInfo | null;
  readonly inventory: readonly InvSlot[] | null;

  /**
   * Worn gear by slot, item ids only. A slot with nothing in it is absent.
   *
   * An item id does not resolve to a NAME, a quality or any stats: that content
   * ships inside the client bundle and is reachable from nothing the loader can
   * see. What you can do with an id is show its icon, through `ui.icon.item`,
   * and tell one from another.
   */
  readonly equipment: Partial<Record<EquipSlot, string>> | null;

  /** The bag sockets: an item id per equipped bag, null for an empty socket. */
  readonly bags: readonly (string | null)[] | null;

  /**
   * Total slots across the backpack and every equipped bag.
   *
   * Derived from `bags`, so watch `bags` rather than this: there is no separate
   * key for it. Used slots is `inventory.length`.
   */
  readonly bagCapacity: number | null;

  /** Money, in copper. */
  readonly copper: number | null;

  /**
   * The zone name the game is displaying, or null before the HUD exists.
   *
   * Localized DISPLAY TEXT, never an id, and that limit is not an oversight: the
   * zone table is content inside the client bundle behind a pure function of
   * your position, and nothing the loader can reach exposes either the table or
   * the id. This is read off the game's own minimap label, so it is what the game
   * says you are looking at, which underground is the delve rather than a zone.
   *
   * Show it, or watch it change. Comparing it against a hardcoded string works
   * only for players running your language.
   *
   * There is no subzone here. The game announces a landmark once as a banner
   * when you walk into one and never clears it when you leave, so a reading
   * taken from it would name somewhere you left an hour ago.
   */
  readonly zone: string | null;

  /**
   * Your progression, deeds and title. Null before world entry.
   *
   * All of it rides your own self payload, so there is no equivalent for another
   * player: nothing here can be read about anyone else.
   */
  readonly character: CharacterInfo | null;

  /** Your build, your saved loadouts, and how many points you have spent. */
  readonly talents: TalentInfo | null;

  /** Your profession skill counters. See `ProfessionInfo` for what is left out. */
  readonly professions: ProfessionInfo | null;

  readonly quests: WorldQuests | null;
  /** Your ability cooldowns: ability id to seconds remaining. */
  readonly cooldowns: ReadonlyMap<string, number> | null;
  /** The effects on you. For anyone else, read `entity.auras`. */
  readonly auras: readonly Aura[] | null;

  /**
   * Entity id to what it is casting, for everything near you.
   *
   * Built on each read from live entity state, so it is never stale and there is
   * nothing to hold on to: read it again rather than keeping the map.
   */
  readonly casts: ReadonlyMap<number, EntityCast>;

  /**
   * The effects on your current target, or null when nothing is targeted.
   *
   * `world.on('target', ...)` reports which entity is selected and nothing else,
   * so watching a debuff you applied to a boss means watching this key.
   */
  readonly targetAuras: readonly Aura[] | null;

  readonly hazards: readonly Hazard[] | null;

  /**
   * Your spellbook, and the one way to turn an ability id into its display name
   * or a display name back into an id.
   *
   * Never null, unlike most reads here: it is a lookup, so an empty one answers
   * the same questions a populated one does and you need no guard before asking.
   * Covers your OWN kit only. See `AbilityIndex`.
   */
  readonly abilities: AbilityIndex;

  /**
   * Whether you are fighting, and which signal said so.
   *
   * Never null: it is derived rather than handed over, so before world entry it
   * is simply inactive. Watch it with `world.on('combat', ...)`, which reports a
   * fight starting and ending, and also reports the SOURCE changing while a
   * fight continues, so an addon that acts only on a certain reading hears the
   * moment it becomes one.
   */
  readonly combat: CombatState;

  /**
   * The entity a token names, or null when there is nothing there.
   *
   * Worth using rather than open-coding, because one of these is a trap:
   * `targettarget` reads whichever field the target's kind actually fills. A
   * mob never carries `targetId`, so the obvious lookup gives you a
   * target-of-target that works on players and is blank on every mob.
   *
   * ```js
   * const boss = woc.world.unit('target');
   * const tank = woc.world.unit('targettarget');
   * ```
   */
  unit: (token: UnitToken) => Entity | null;

  /**
   * The effects on a unit that match, in the game's own order.
   *
   * Empty rather than null when the unit resolves to nothing, so a display can
   * render the answer without a guard first.
   *
   * ```js
   * const mine = woc.world.aurasOn('target', { mine: true, kind: 'dot' });
   * ```
   */
  aurasOn: (token: UnitToken, query?: AuraQuery) => readonly Aura[];

  /**
   * The same over one party row's compact strip.
   *
   * Separate because a row's auras are a different, smaller shape than an
   * entity's, and because a row exists for a member who is nowhere near you.
   */
  partyAuras: (pid: number, query?: PartyAuraQuery) => readonly PartyMemberAura[];

  /**
   * Entity id to raid target marker, 0 through 7.
   *
   * Empty when you are not in a party, because the game sends markers only to a
   * grouped player. That is indistinguishable from a group that has marked
   * nothing, so read `world.party` if the difference matters. There is no way to
   * SET one: placing a marker is a command, and the loader never sends.
   */
  readonly markers: ReadonlyMap<number, number> | null;

  /**
   * Watch a key for change, sampled once per animation frame.
   *
   * Fires on change rather than on every sample, and only for a change worth
   * acting on: `auras` reports one arriving or falling off, not its remaining
   * time ticking down, `cooldowns` reports one starting or ending rather than
   * counting down, and `casts` reports a cast starting, ending or being replaced
   * rather than its bar moving. Count down yourself if you need to draw it.
   *
   * The handler's argument is typed from the key, so `world.on('party', ...)`
   * receives a `PartyInfo` without narrowing.
   */
  on: <K extends WorldKey>(key: K, handler: (value: WorldValues[K]) => void) => Unsubscribe;

  /**
   * The game's own objects. Unstable: the game makes no compatibility promise
   * about them, and the manager flags addons that reach for them.
   */
  readonly raw: unknown;
  readonly game: unknown;
}
