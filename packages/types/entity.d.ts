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

import type { CorpseLoot } from './world-ground.js';

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

/**
 * The public part of one worn item's instance payload.
 *
 * This is the SERVER's projection rather than a narrowing done by the loader:
 * the send site copies exactly these three out of the full payload and drops the
 * rest, so an inspecting client is never sent an item's bound owner, its
 * remaining charges, or its rift forge record.
 */
export interface PublicItemInstance {
  /** The player who signed or crafted this specific copy. */
  signer?: string;
  /** The enchant id applied to it. Content, so it resolves to nothing here. */
  enchant?: string;
  /**
   * Values baked into this copy when it was made.
   *
   * `masterwork` marks a masterwork proc, whose `stats` are the baked tier delta
   * rather than an enchant. `quality` is legacy: new crafts never write it, and a
   * payload that carries it is an old copy still loading as before.
   */
  rolled?: { quality?: string; stats?: Record<string, number>; masterwork?: boolean };
}

/**
 * Your OWN worn item's payload, which carries what the public one is trimmed of.
 *
 * Reachable only through `world.equipmentInstances`, off your self record. The
 * same slot read off `world.player.equippedInstances` is the public projection
 * above, because your own entity record goes through the same allowlist every
 * other player's does.
 */
export interface ItemInstance extends PublicItemInstance {
  /** The recipe that minted this copy, while it is worn. */
  craftedRecipeId?: string;
  /** The entity id this copy is bound to. */
  boundTo?: number;
  /** Set while the copy still binds on its first trade. */
  bindOnTrade?: boolean;
  /** Remaining uses per effect id, for a charge-limited piece. */
  charges?: Record<string, number>;
  /**
   * Long-term Rift progression, for a piece earned there.
   *
   * `tier` is content and is left a string for the same reason `AuraKind` is: a
   * copy of the union here would go stale while looking authoritative.
   * `rolled.stats` is the aggregate the game actually applies; this record
   * explains how it was earned.
   */
  rift?: {
    sourceEventId: string;
    tier: string;
    power: number;
    upgradeLevel: number;
    maxUpgradeLevel: number;
    baseStats: Record<string, number>;
    enchant?: { stat: string; value: number };
    gemSlots: number;
    gems: string[];
  };
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
  /**
   * True once a player has RELEASED, which `dead` alone cannot tell you.
   *
   * A dead player who has not released is lying where they fell and can be
   * resurrected in place; a ghost has given that up and is running back. `dead`
   * stays true through both, so this is the field a healer's display keys on.
   * Always false for the living and for every non-player entity.
   */
  ghost: boolean;

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
   * The unit a taunt is FORCING this mob onto, null when nothing is.
   *
   * `aggroTargetId` says who a mob is hitting; this says whether that choice is
   * being held rather than earned. Written only on a mob, and only by a taunt: on
   * a player, an npc, an object and a controlled pet it is the `targetId` trap in
   * a second place, present and correctly typed and permanently null.
   */
  forcedTargetId: number | null;
  /**
   * Seconds left on that force, 0 when none is held.
   *
   * The window is short, so read it rather than polling slowly. A taunt can also
   * raise threat and set NOTHING here: a mob whose template ignores taunts, a
   * training dummy, and a boss taunted by a pet each take the threat and never
   * turn. Those templates are bundled content, so you cannot tell that case from
   * an expiry. Present a held taunt as a positive reading rather than presenting
   * its absence as a failure.
   */
  forcedTargetTimer: number;
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
  /**
   * The owning player's entity id for a controlled pet, null for anything wild.
   *
   * The only way to find a pet. A companion is an ordinary mob entity in every
   * other respect, so nothing else tells it apart from the wolf standing next
   * to it. `world.unit('pet')` is this lookup done for you.
   */
  ownerId: number | null;
  /** The ability id being cast, or null. */
  castingAbility: string | null;
  /** Seconds left on the cast, against `castTotal`. Both 0 when not casting. */
  castRemaining: number;
  castTotal: number;
  channeling: boolean;
  auras: Aura[];

  /**
   * Whether the interact prompt offers something here, which is NOT "is a corpse".
   *
   * True on every ground pickup, every dungeon exit and every rift portal,
   * because the game sets it on the object rather than on the loot. Read `loot`
   * for a corpse's contents; a lootable entity with a null `loot` is scenery.
   */
  lootable: boolean;
  /**
   * A mob corpse's whole contents, or null.
   *
   * Sent for a mob only, and sent to EVERY player in range rather than to the
   * looter: the server builds one record per corpse and shares it. So this holds
   * slots you can see and cannot take. `world.corpseLoot()` applies the game's
   * own rights rule and is what a loot display should read.
   */
  loot: CorpseLoot | null;
  /** The first player to damage this mob, who owns its shared loot. Null on everything else. */
  tappedById: number | null;
  /** The player who took this corpse's profession harvest. Null when unclaimed. */
  harvestClaimedBy: number | null;

  // Worn gear and cosmetics, sent for a PLAYER (and therefore a bot) only. On
  // every mob, npc and object these exist and hold an inert default, which is
  // the `targetId` trap: check `kind === 'player'` before reading one.
  /**
   * The full worn set: slot to item id, empty for anything that is not a player.
   *
   * The server gates this on the entity being a player at the send site, so a mob
   * is structurally incapable of carrying one however its own fields are set. An
   * id resolves to an icon through `ui.icon.item` and to nothing else, the same
   * limit `world.equipment` carries.
   */
  equippedItems: Partial<Record<EquipSlot, string>>;
  /**
   * Per-slot instance payloads for the worn set, trimmed by the server.
   *
   * Sparse: a slot is a key only while its piece carries a signer, an enchant or
   * a roll, so a plain worn set is empty rather than a map of empty objects. For
   * YOUR OWN gear read `world.equipmentInstances`, which is the untrimmed
   * payload; this member is the public projection even on your own record.
   */
  equippedInstances: Partial<Record<EquipSlot, PublicItemInstance>>;
  /**
   * The held mainhand, which is NOT `equippedItems.mainhand`.
   *
   * The server fills this only when the equipped mainhand is a weapon, so a
   * non-weapon in the hand slot leaves `equippedItems.mainhand` set and this
   * null. Read this for what is being held, that for what is worn.
   */
  mainhandItemId: string | null;
  /** The held offhand: a weapon, a held offhand item, or a shield. */
  offhandItemId: string | null;
  /**
   * The active weapon-skin cosmetic, or null.
   *
   * A skin id, not an item id: `ui.icon.item` does not resolve one, and the kit
   * hides an icon slot whose image fails, so asking costs an icon.
   */
  weaponSkinId: string | null;
  /**
   * The mount being ridden, or empty when on foot.
   *
   * A mount key rather than an item id, so it names the mount and resolves to no
   * art. It is also the one cosmetic here the game's own sim reads, for movement
   * speed, so it is a reliable answer to "is that player mounted".
   */
  mountKey: string;

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
