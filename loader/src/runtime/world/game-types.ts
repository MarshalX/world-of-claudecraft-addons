// The game's own shapes, declared once so addons read a typed world.
//
// These are a CLAIM ABOUT ANOTHER REPOSITORY. Nothing here can be typechecked:
// the game is not a dependency, must never become one, and the loader reads its
// live objects through an untyped hook. So the declarations are asserted at the
// backend boundary rather than derived, and `shape.ts` is what makes the claim
// honest: the dev-harness addon checks these fields against the running game and
// reports what does not match.
//
// What is declared is deliberately narrower than what the game carries, and the
// test is the WIRE, not the game's own type. Online, the client builds every
// entity with defaults and fills in whatever the snapshot carried, so a field
// the server never sends still EXISTS and holds its default forever. A shape
// check cannot see that: `inCombat` is a real boolean on every entity and is
// permanently false, which is how it got published and how the first example
// addon built a feature on it. So a field earns a place here only if it was
// found in `wireEntity` or in the self payload, and the self-only ones are
// marked. Everything else is reachable through `world.raw`, which stays
// `unknown` because the game promises nothing about it.

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
 * Left as a string rather than the game's union. That union is content, it grows
 * with every ability the game ships, and a copy of it here would go stale
 * silently while looking authoritative. Compare against the ids you care about.
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
   * This is what separates a scripted mechanic's stun from an ordinary one, and
   * it is on the wire as `ub` for exactly that reason.
   */
  unbreakableControl?: boolean;
}

/**
 * One charge-limited ability's pool.
 *
 * `maxCharges` is deliberately NOT here. The server keeps the maximum to itself
 * and the client zero-fills the field, so it is readable, of the right kind, and
 * permanently 0: the `inCombat` trap exactly. The game's own bar derives the max
 * from its bundled ability table, which an addon has no equivalent of.
 */
export interface AbilityCharge {
  /** Uses in the pool right now. */
  charges: number;
  /** Seconds until the next charge returns, or 0 when none is regenerating. */
  recharge: number;
  /** What `recharge` counts down from. Real, unlike a cooldown's total. */
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
 * One thing in the world.
 *
 * Every field here was found on the wire. The block at the end rides the SELF
 * record only, so on any other entity it holds an inert default.
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
  /** Seconds until the next auto-attack swing lands. */
  swingTimer: number;
  comboPoints: number;
  stats: CoreStats;
  weapon: WeaponInfo;
  /**
   * Ability id to its charge pool, for the few abilities that have one.
   *
   * Absent entirely until the first snapshot that carried any, which is why it is
   * optional: the client creates the record on decode rather than blank-filling
   * it. An ability with no charge model is simply not a key.
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
