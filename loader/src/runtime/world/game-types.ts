// The game's own shapes. A claim about another repository that cannot be typechecked: the
// backend asserts them at the boundary, and `shape.ts` checks them against the running game.
//
// A field is declared only if the server SENDS it (`wireEntity` or the self payload in the
// game's `server/game.ts`). The online client builds every entity with defaults, so a field the
// server never sends still exists, is correctly typed, and holds its default forever, which no
// shape check can see. Self-only fields are marked. Everything else is `world.raw`.

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
 * A string, because the game's union is content that grows every release and a copy here
 * would go stale silently. Compare against the ids you care about.
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
  /** Set only on control an encounter owns, which nothing a player does breaks. */
  unbreakableControl?: boolean;
  /**
   * An aura only its own timer takes off: dispel, cleanse, steal and any player purge all skip
   * it. Not a synonym for a penalty: a flask's buff and the warlock Fate Threads self-aura carry
   * it as well as the recovery sicknesses and the cheater mark.
   *
   * Player-driven counters only: a mob's Spellgnaw devour can still eat a flagged buff. Decoded
   * presence-only, so absent means "not one".
   */
  undispellable?: boolean;
  /**
   * Set on a buff a FLASK minted, and on nothing else. An elixir or a scroll can mint the same
   * aura id, and only the flask survives death (not a logout) and sheds a second flask.
   *
   * Decoded presence-only. Dispel protection is `undispellable`, never this.
   */
  flask?: boolean;
  /**
   * An aura with no natural expiry, which the game refuses to dispel or steal. The wire rewrites
   * its remaining and duration to a sentinel, so neither is a countdown.
   */
  permanent?: boolean;
}

/**
 * One charge-limited ability's pool.
 *
 * `maxCharges` is deliberately absent: the server never sends it and the client zero-fills it,
 * so it would read a permanent 0.
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
   * The guild this character has publicly pledged to JOIN, '' for none. Always '' for a guilded
   * player, and world-visible on every player in range.
   */
  pledgeGuild: string;
  /**
   * The guild colour tier, 0 for the base look and for the unguilded. Taken from the PLEDGED
   * guild for a player who has pledged to one. Display only.
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
   * The sim's in-combat bit, sent for the PLAYER'S OWN ENTITY ONLY; on every other entity it is
   * a permanent client-default false.
   *
   * Not published: `world.combat` reads it as its `source: 'self'` branch, positive-only, since
   * a false cannot be told from a server that never sent it.
   */
  inCombat?: boolean;
  /**
   * True once a dead player has RELEASED and can no longer be resurrected in place. `dead` stays
   * true through both states. Always false for the living and for non-players.
   */
  ghost: boolean;

  hostile: boolean;
  /**
   * The SELECTED target, sent for a player or a bot ONLY. On a mob it is permanently null even
   * mid-fight; resolve a mob's target through `aggroTargetId`.
   */
  targetId: number | null;
  /**
   * What a MOB is attacking. Null on a player (read `targetId`) and on a mob fighting nobody.
   */
  aggroTargetId: number | null;
  /**
   * The unit a taunt is FORCING this mob onto, null when nothing is. Written only on a mob, so
   * on a player, npc, object or controlled pet it is permanently null.
   */
  forcedTargetId: number | null;
  /**
   * Seconds left on that force, 0 when none is held.
   *
   * A taunt can raise threat and set nothing here (a taunt-immune template, a training dummy, a
   * boss taunted by a pet), which is indistinguishable from an expiry. Treat a held taunt as a
   * positive reading and its absence as no information.
   */
  forcedTargetTimer: number;
  /**
   * A living mob's own hate table, entity id to threat, capped at the top eight. Empty on a
   * player and on a mob out of combat, so "does this table contain me" is a sound combat reading.
   */
  threat: Map<number, number>;
  /**
   * The owning player's entity id for a controlled pet, null for anything wild. The only field
   * that tells a pet from an ordinary mob.
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
   * Whether the interact prompt offers something here, which is NOT "is a corpse": it is true on
   * ground pickups, dungeon exits and rift portals. Read `loot` for a corpse's contents.
   */
  lootable: boolean;
  /**
   * A mob corpse's whole contents, or null. Sent to EVERY player in range, so it holds slots you
   * cannot take; a loot display reads `world.corpseLoot()`, which applies the rights rule.
   */
  loot: CorpseLoot | null;
  /** The first player to damage this mob, who owns its shared loot. Null on everything else. */
  tappedById: number | null;
  /** The player who took this corpse's profession harvest. Null when unclaimed. */
  harvestClaimedBy: number | null;

  // Worn gear and cosmetics, sent for a PLAYER (and therefore a bot) only. On every mob, npc
  // and object they hold an inert default: check `kind === 'player'` before reading one.
  /** The full worn set: slot to item id, empty for anything that is not a player. */
  equippedItems: Partial<Record<EquipSlot, string>>;
  /**
   * Per-slot instance payloads for the worn set, trimmed to the public projection even on your
   * own record (read `world.equipmentInstances` for yours). Sparse: a slot is a key only while
   * its piece carries a signer, an enchant or a roll.
   */
  equippedInstances: Partial<Record<EquipSlot, PublicItemInstance>>;
  /**
   * The held mainhand, which is NOT `equippedItems.mainhand`: it is null when the worn mainhand
   * is not a weapon.
   */
  mainhandItemId: string | null;
  /** The held offhand: a weapon, a held offhand item, or a shield. */
  offhandItemId: string | null;
  /**
   * The active weapon-skin cosmetic, or null. A skin id, which `ui.icon.item` does not resolve.
   */
  weaponSkinId: string | null;
  /**
   * The mount being ridden, or empty when on foot. A mount key, not an item id, so it resolves
   * to no art. The sim reads it for speed, so it reliably answers "is that player mounted".
   */
  mountKey: string;
  /**
   * The worn mount skin drawn over `mountKey`, or null. Render-only: it can be set on foot.
   */
  mountSkinId: string | null;
  /** The paperdoll eye toggle: the composed body renders without its kit helm. */
  helmHidden: boolean;

  // Player-only like the block above: on a mob these hold their inert default.
  /** The /afk display bit. The game draws an `<AFK>` prefix on the nameplate. */
  afk: boolean;
  /**
   * Sitting, EATING or DRINKING: the wire folds all three into one bit, so they cannot be told
   * apart.
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

  /** Ranged attack power. Unlike the self-only block below, real on every entity. */
  rangedPower: number;

  /**
   * Whether this entity is swinging. Real on every entity, and false is an answer.
   *
   * No swing period is sent and `weapon.speed` is not one, since the reset is scaled by an
   * unsent haste; measure the period off the reset edge.
   */
  autoAttack: boolean;
  /** Seconds until the next auto-attack swing lands. 0 when not swinging. */
  swingTimer: number;

  // Self record only: on any other entity these hold an inert default.
  /** Ability id to seconds remaining. An entry at 0 is not on cooldown. */
  cooldowns: Map<string, number>;
  gcdRemaining: number;
  attackPower: number;
  spellPower: number;
  /** Spell power plus the flat Healing Power affix, which heals read and damage does not. */
  healPower: number;
  spellHaste: number;
  critChance: number;
  dodgeChance: number;
  blockChance: number;
  /**
   * Seconds until the offhand swing lands. It runs down to 0 even with auto-attack off, so read
   * it only while `autoAttack` is true.
   */
  offhandSwingTimer: number;
  comboPoints: number;
  savedMana: number;
  stats: CoreStats;
  weapon: WeaponInfo;
  /**
   * The offhand weapon, or null when nothing is dual-wielded. Null is a real value (an
   * unequipped offhand), so it must never fall back to the previous reading.
   */
  offhandWeapon: WeaponInfo | null;
  /**
   * Ability id to its charge pool, for the few abilities that have one. Absent until the first
   * snapshot that carried any.
   */
  abilityCharges?: Record<string, AbilityCharge>;
}

/**
 * A slot a piece of gear is worn in. Closed, unlike content unions: it is the paperdoll shape.
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
   * The PUBLIC trim the server projects market rows, letters and guild bank rows to (see
   * `PublicItemInstance`). A stack of your own carries more and is a `HeldSlot`.
   */
  instance?: PublicItemInstance;
}

/**
 * One stack in your OWN bags or bank, which is where a lock and a bind-on-pickup
 * trade window can exist.
 *
 * The payload skipped the server's public projection, so it carries owner-only fields. A
 * separate shape because on a market row an absent owner-only field would read as an unlocked,
 * untradeable copy.
 */
export interface HeldSlot extends InvSlot {
  instance?: HeldItemInstance;
  /** The recipe that minted this stack. The public projection does not carry it. */
  craftedRecipeId?: string;
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
