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

import type { CorpseLoot } from './corpse-types.ts';
import type { HeldItemInstance, PublicItemInstance } from './items.ts';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type EntityKind = 'player' | 'mob' | 'npc' | 'object';

export type ResourceType = 'rage' | 'mana' | 'energy' | 'focus';

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
  /**
   * The guild this character has publicly pledged to JOIN, '' for none.
   *
   * Always '' for a guilded player: joining any guild clears the pledge
   * server-side. Sent as `pg` on the identity record beside `guild` itself, so
   * it is world-visible on every player in range rather than only on you.
   */
  pledgeGuild: string;
  /**
   * The guild colour tier, 0 for the base look and for the unguilded.
   *
   * Derived by the game from the guild's collective lifetime XP, and taken from
   * the PLEDGED guild for a player who has pledged to one. Display only: it says
   * how a name is coloured, not what the guild has done.
   */
  guildTier: number;
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
   * The SELECTED target, and it is sent for a player or a bot ONLY.
   *
   * A mob never carries one: the server emits this as `tgt` from the selected
   * target, and a mob's is always null because a mob tracks what it is fighting
   * on `aggroTargetId` instead. So this is the `inCombat` trap for anything that
   * is not a player, present and of the right kind and permanently null, and one
   * recorded session confirmed it across every mob that was actively attacking.
   * Resolve a target's target through `aggroTargetId` when the target is a mob.
   */
  targetId: number | null;
  /**
   * What a MOB is attacking, which is the field that actually answers it.
   *
   * Null on a player, whose selection is `targetId`, and null on a mob that is
   * not fighting anyone.
   */
  aggroTargetId: number | null;
  /**
   * The unit a taunt is FORCING this mob onto, null when nothing is.
   *
   * Written only on a mob, and only by a taunt: `aggroTargetId` says who a mob is
   * hitting and this says whether that choice is being held rather than earned.
   * On a player, an npc, an object and a controlled pet it is the `targetId` trap
   * in a second place, present and correctly typed and permanently null, because
   * nothing in the game ever writes one.
   */
  forcedTargetId: number | null;
  /**
   * Seconds left on that force, 0 when none is held.
   *
   * The window is short, so a display reading this has to be exact rather than
   * polling slowly. A taunt can also raise threat and set NOTHING here: a mob
   * whose template ignores taunts, a training dummy, and a boss taunted by a pet
   * each take the threat and never turn. Those templates are bundled content, so
   * an addon cannot tell that case from an expiry and must present a held taunt
   * as a positive reading rather than presenting its absence as a failure.
   */
  forcedTargetTimer: number;
  /**
   * A living mob's own hate table, entity id to threat, capped at the top eight.
   *
   * The server's real threat model rather than anything derived here, so the
   * numbers are comparable across sources. Empty on a player, and empty on a mob
   * that is not in combat, which is what makes "does this table contain me" a
   * sound combat reading rather than a guess. The cap means that in a large group
   * it is the top of the table and not the whole of it.
   */
  threat: Map<number, number>;
  /**
   * The owning player's entity id for a controlled pet, null for anything wild.
   *
   * The one way to find a pet: it is an ordinary mob entity otherwise, so
   * nothing else distinguishes a hunter's companion from the wolf next to it.
   */
  ownerId: number | null;
  /** An ability id, an activity sentinel, or null. Sentinels are not abilities. */
  castingAbility: string | null;
  /** Seconds left on the cast, against `castTotal`. Both 0 when not casting. */
  castRemaining: number;
  castTotal: number;
  /** Who the RUNNING cast is aimed at. Null when not casting or untargeted. */
  castTargetId: number | null;
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
  /** The paperdoll eye toggle: the composed body renders without its kit helm. */
  helmHidden: boolean;

  // What a player is DOING outside combat, and what their account is. Player
  // fields like the block above: on a mob these hold their inert default.
  /** The /afk display bit. The game draws an `<AFK>` prefix on the nameplate. */
  afk: boolean;
  /**
   * Sitting, EATING or DRINKING: the wire folds all three into one bit.
   *
   * So the name is the game's own field name and is narrower than the meaning.
   * There is no way to tell the three apart for another player, because the
   * server never sends them apart.
   */
  sitting: boolean;
  /** The party emote floating over a player's head, or null. */
  overheadEmoteId: string | null;
  /** Bumped every time the same emote is played again, which is the only way to see a repeat. */
  overheadEmoteSeq: number;
  /** The operator-set mark on an AI-operated account. */
  aiAccount: boolean;
  /** The operator-applied Cheater tag. Cosmetic: nothing reads it for power. */
  cheaterMark: boolean;

  /**
   * Ranged attack power. Rides `dynamicFields`, so unlike the self-only block
   * below it is real on every entity, your own player included.
   */
  rangedPower: number;

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
  savedMana: number;
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

/**
 * A slot a piece of gear is worn in.
 *
 * The game's own set, and closed rather than a string: it is the shape of a
 * paperdoll rather than content that grows with a release.
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

/** One stack, wherever a stack is read: bags, bank, a letter, a corpse, a page. */
export interface InvSlot {
  itemId: string;
  count: number;
  /** The bag cell it was dragged into. Absent when it was never placed by hand. */
  slot?: number;
  /**
   * What is baked into this specific copy. Absent on an ordinary fungible stack.
   *
   * The PUBLIC trim, which is what the shared shape can promise: a market row, a
   * letter attachment and a guild bank row are all projected to those three
   * fields by the server before they are sent. A stack of YOUR OWN carries one
   * field more and is read as a `HeldSlot`; the rest of the payload stays
   * reachable through `world.raw` and is promised nowhere.
   */
  instance?: PublicItemInstance;
}

/**
 * One stack in your OWN bags or bank, which is where a lock can exist.
 *
 * The only difference from `InvSlot` is that the payload here was never put
 * through the server's public projection, so it still carries the owner's lock.
 * Kept a separate shape rather than widening `InvSlot`: the lock is genuinely
 * absent from every other surface the stack shape appears on, and a field that
 * reads `undefined` on a market row would be indistinguishable there from an
 * unlocked copy.
 */
export interface HeldSlot extends InvSlot {
  instance?: HeldItemInstance;
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
