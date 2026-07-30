import type { Unsubscribe } from './addon.js';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type EntityKind = 'player' | 'mob' | 'npc' | 'object';

export type ResourceType = 'rage' | 'mana' | 'energy';

export type School = 'physical' | 'fire' | 'frost' | 'arcane' | 'shadow' | 'holy' | 'nature';

/**
 * What an aura does, e.g. 'dot', 'stun', 'buff_haste'.
 *
 * A string rather than a union of every kind the game ships. That set is
 * content: it grows with every ability, and a copy of it here would go stale
 * while looking authoritative. Compare against the kinds you care about.
 */
export type AuraKind = string;

/** One effect on an entity. `remaining` and `duration` are seconds. */
export interface Aura {
  /** The ability id that applied it. */
  id: string;
  name: string;
  kind: AuraKind;
  remaining: number;
  duration: number;
  /** Per tick for a dot or hot, a multiplier for a slow or haste, else an amount. */
  value: number;
  /** The entity that applied it, or 0 when the game did not say. */
  sourceId: number;
  school: School;
  /** Applications, for an aura that stacks. Absent when it does not. */
  stacks?: number;
  /** Remaining charges, for an aura that is consumed. Absent when unlimited. */
  charges?: number;
  /** Seconds between ticks, for a dot or hot. */
  tickInterval?: number;
  /** A second magnitude, e.g. the top of an imbue's damage range. */
  value2?: number;
  value3?: number;
  /** Which abilities a next-cast empowerment applies to. Absent when unscoped. */
  empowerAbilities?: string[];
  /**
   * Set only on control an encounter owns, which nothing a player does breaks.
   *
   * This is what separates a scripted mechanic's stun from an ordinary one, so it
   * is the field to read before telling a player their trinket will help.
   */
  unbreakableControl?: boolean;
}

/**
 * One charge-limited ability's pool.
 *
 * There is no maximum here, and that is not an omission: the server keeps the
 * maximum to itself, so the field your client holds for it is permanently 0.
 * The game's own bar derives it from a bundled ability table an addon has no
 * equivalent of. What you can rely on is `rechargeLength`, which is real, and is
 * the one timer on the whole surface that gives you an exact denominator.
 */
export interface AbilityCharge {
  /** Uses in the pool right now. */
  charges: number;
  /** Seconds until the next charge returns, or 0 when none is regenerating. */
  recharge: number;
  /** What `recharge` counts down from. */
  rechargeLength: number;
}

/** The six authored attributes plus the two PvP fractions derived from ratings. */
export interface CoreStats {
  str: number;
  agi: number;
  sta: number;
  int: number;
  spi: number;
  armor: number;
  pvpOffense: number;
  pvpDefense: number;
}

/** The equipped mainhand's damage range and swing time. */
export interface WeaponInfo {
  min: number;
  max: number;
  /** Seconds per swing. */
  speed: number;
  /** Set when the weapon is a dagger, which some abilities require. */
  dagger?: boolean;
}

/**
 * One thing in the world: a player, a mob, an npc, or a world object.
 *
 * Every field here is one the server actually sends. That is a narrower list
 * than the game's own entity, which carries hundreds of mostly server-internal
 * fields: your client builds each entity with defaults and fills in what the
 * snapshot carried, so a field the server never sends would still be readable
 * and would hold its default forever, which is worse than not having it.
 *
 * The block marked at the end is sent on YOUR record only. On any other entity
 * those hold an inert default, so read them off `world.player`.
 *
 * Anything not here is reachable through `world.raw`, at your own risk: the game
 * promises nothing about it, and the same "readable but never written" trap
 * applies there with nothing to warn you.
 */
export interface Entity {
  id: number;
  kind: EntityKind;
  /** Mob or npc template id, or the class for a player. */
  templateId: string;
  name: string;
  level: number;
  guild: string;
  /** A Book of Deeds deed id, never display text. Absent for the untitled. */
  title?: string | null;

  pos: Vec3;
  /** The position before this tick, which the game interpolates from. */
  prevPos: Vec3;
  /** Radians, 0 = +Z. */
  facing: number;
  prevFacing: number;

  hp: number;
  maxHp: number;
  /** Sent only for an entity that HAS a resource. Zero on one that does not. */
  resource: number;
  maxResource: number;
  resourceType: ResourceType | null;
  dead: boolean;

  hostile: boolean;
  targetId: number | null;
  /** The ability id being cast, or null. */
  castingAbility: string | null;
  /** Seconds left on the cast, against `castTotal`. Both 0 when not casting. */
  castRemaining: number;
  castTotal: number;
  channeling: boolean;
  auras: Aura[];

  // Yours alone: the server sends these on the SELF record and nowhere else, so
  // on any other entity they hold an inert default rather than a real value.
  /** Ability id to seconds remaining. An entry at 0 is not on cooldown. */
  cooldowns: Map<string, number>;
  gcdRemaining: number;
  autoAttack: boolean;
  attackPower: number;
  spellPower: number;
  spellHaste: number;
  critChance: number;
  dodgeChance: number;
  blockChance: number;
  /** Seconds until your next auto-attack swing lands. */
  swingTimer: number;
  comboPoints: number;
  stats: CoreStats;
  weapon: WeaponInfo;
  /**
   * Ability id to its charge pool, for the few abilities that have one.
   *
   * Absent until the first snapshot that carried any, so guard the read. An
   * ability with no charge model is simply not a key here, and a charge bar drawn
   * off `rechargeLength` is exact where a cooldown bar cannot be.
   */
  abilityCharges?: Record<string, AbilityCharge>;
}

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

/** What each read returns, and what the matching `world.on` key reports. */
export interface WorldValues {
  player: Entity | null;
  target: Entity | null;
  entities: ReadonlyMap<number, Entity>;
  party: PartyInfo | null;
  inventory: readonly InvSlot[] | null;
  quests: WorldQuests | null;
  cooldowns: ReadonlyMap<string, number> | null;
  auras: readonly Aura[] | null;
  casts: ReadonlyMap<number, EntityCast>;
  targetAuras: readonly Aura[] | null;
  hazards: readonly Hazard[] | null;
  markers: ReadonlyMap<number, number> | null;
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
