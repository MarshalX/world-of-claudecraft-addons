// One thing in the world, and the parts it is made of.
//
// Split from `world.d.ts`, which describes the world AROUND these: the party,
// the bags, the quest log, the ground effects, and the reads that return them.
// The seam is the entity itself, because that is the shape every other read
// eventually hands you one of.
//
// Everything here describes ANOTHER repository, which nothing in this package
// can compile against. The loader checks it against a live game once per session
// and reports what no longer matches.

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
  /**
   * The SELECTED target, sent for a PLAYER or a bot only.
   *
   * A mob never carries one. The server fills this from a selection, and a mob
   * does not select: it tracks what it is fighting on `aggroTargetId`. So on a
   * mob this is present, of the right type, and permanently null, and one
   * recorded session confirmed it across every mob that was actively attacking.
   * A target-of-target display built on this alone is blank on exactly the units
   * it gets pointed at; read `aggroTargetId` when the target is a mob.
   */
  targetId: number | null;
  /**
   * What a MOB is attacking. Null on a player, whose selection is `targetId`.
   */
  aggroTargetId: number | null;
  /**
   * A living mob's hate table: entity id to threat, capped at the top eight.
   *
   * The server's own threat model, not anything derived on the client, so the
   * numbers are comparable between sources and mean the same thing the game
   * means by them. Empty on a player, and empty on a mob that is not fighting.
   *
   * The cap is worth remembering in a raid: this is the top of the table rather
   * than all of it, so an addon can say who is about to pull and cannot say
   * where the twentieth person stands.
   */
  threat: Map<number, number>;
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
