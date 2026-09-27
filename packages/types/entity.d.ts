// One thing in the world, and the parts it is made of.
//
// These describe the game, which this package cannot compile against. The loader
// checks them against a live game once per session and reports what no longer
// matches.

import type { CorpseLoot } from './world-ground.js';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type EntityKind = 'player' | 'mob' | 'npc' | 'object';

/**
 * What fills an entity's second bar.
 *
 * Closed, so a `switch` can be exhaustive. A new member is added in a minor,
 * since an addon only reads this; a member leaving would be a major.
 */
export type ResourceType = 'rage' | 'mana' | 'energy' | 'focus';

export type School = 'physical' | 'fire' | 'frost' | 'arcane' | 'shadow' | 'holy' | 'nature';

/**
 * What an aura does, e.g. 'dot', 'stun', 'buff_haste'.
 *
 * An open string: the set grows with every ability. Compare against the kinds
 * you care about.
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
   * Read it before telling a player their trinket will help.
   */
  unbreakableControl?: boolean;
  /**
   * Set on a buff a FLASK minted, and on nothing else.
   *
   * An elixir or a scroll can mint the same aura id, so read this, not the id,
   * for "am I flasked". A flask survives death (not a logout) and a second one
   * replaces the first.
   *
   * Absent means "not from a flask". It says nothing about dispels; ask
   * `world.dispellable`.
   *
   * Added in API minor 11.
   */
  flask?: boolean;
}

/**
 * One charge-limited ability's pool.
 *
 * There is no maximum: the server never sends it, so the client field is
 * permanently 0. `rechargeLength` is real and an exact denominator.
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
 * Closed: the paperdoll's shape, not content.
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
 * The SERVER's projection: an inspecting client is never sent an item's bound
 * owner, remaining charges, or Perfecting progress.
 */
export interface PublicItemInstance {
  /** The player who signed or crafted this specific copy. */
  signer?: string;
  /** The enchant id applied to it. Content, so it resolves to nothing here. */
  enchant?: string;
  /**
   * Values baked into this copy when it was made.
   *
   * `masterwork` marks a masterwork proc, whose `stats` are the baked tier delta.
   * `quality` is legacy, present only on old copies.
   */
  rolled?: { quality?: string; stats?: Record<string, number>; masterwork?: boolean };
  /**
   * The name its owner chose when this copy was promoted to legendary.
   *
   * Player-authored free text, never an id: render it as text. Absent on almost
   * everything.
   *
   * Added in API minor 11.
   */
  name?: string;
  /**
   * This copy finished its Perfecting track.
   *
   * Only ever true. The FINISHED bit, not a rank: progress is owner-only, on
   * `ItemInstance.perfecting`.
   *
   * Added in API minor 11.
   */
  perfected?: true;
  /**
   * Long-term Rift progression, for a piece earned there.
   *
   * `tier` is an open content string. `rolled.stats` is the aggregate the game
   * applies; this is the input it is rebuilt from.
   *
   * Readable on an INSPECTED player from API minor 11; before that, your own only.
   */
  rift?: {
    sourceEventId: string;
    tier: string;
    power: number;
    upgradeLevel: number;
    maxUpgradeLevel: number;
    gemSlots: number;
    gems: string[];
    /**
     * Legacy, absent on anything current, and never read by the game. Use
     * `rolled.stats`.
     */
    baseStats?: Record<string, number>;
    /** Legacy in the same way: the retired forge enchant, never read. */
    enchant?: { stat: string; value: number };
  };
}

/**
 * One copy IN YOUR OWN KEEPING: the public payload, plus what only an owner sees
 * on a stack they are HOLDING.
 *
 * Reachable through `world.inventory` and `world.bank` only. Everywhere else the
 * server has already projected a stack down to the public fields.
 *
 * Added in API minor 6, and grown once since: `partyTrade` in minor 12.
 */
export interface HeldItemInstance extends PublicItemInstance {
  /**
   * The owner's own safety mark on THIS copy, toggled in the game's bag window.
   *
   * A locked copy refuses salvage, use as a craft reagent, and any vendor sale.
   * It says nothing about binding or item-wide sell rules. Absent means unlocked.
   * An addon cannot set it.
   */
  locked?: boolean;
  /**
   * The bind-on-pickup trade window on a soulbound copy won from party boss loot.
   *
   * A soulbound raid drop stays tradeable for two hours, only with the players
   * who were loot-eligible when it dropped. Mail, market, vendor and guild bank
   * stay blocked throughout.
   *
   * `untilMs` IS AN EPOCH DEADLINE: compare it against `Date.now()`.
   *
   * PRESENCE IS NOT TRADABILITY. The marker is removed only on a character load
   * or save, so a lapsed window looks exactly like a live one. Read the deadline,
   * never the key:
   *
   * ```js
   * const left = slot.instance?.partyTrade
   *   ? slot.instance.partyTrade.untilMs - Date.now()
   *   : 0;
   * if (left > 0) woc.log(`${Math.round(left / 60000)} minutes to pass this on`);
   * ```
   *
   * `eligible` is the loot candidates AT THE DROP, not the party now.
   * `eligibleIds` is the same set as CHARACTER ids, never entity ids.
   *
   * Absent on a copy that never had a window, one saved since expiring, and every
   * worn piece (equipping strips it for good).
   *
   * No `world.on` fires when the deadline passes; count it down yourself.
   *
   * Added in API minor 12.
   */
  partyTrade?: { untilMs: number; eligible: string[]; eligibleIds?: number[] };
}

/**
 * Your OWN worn item's payload, which carries what the public one is trimmed of.
 *
 * Reachable only through `world.equipmentInstances`.
 * `world.player.equippedInstances` is the public projection even for you.
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
   * How far along the Perfecting track this copy has come: 1 up to one below the
   * top rank.
   *
   * Your own only. Absent is rank zero; it is deleted when the track completes,
   * so a copy has this or `perfected`, never both. "In progress" is
   * `perfecting !== undefined`.
   *
   * Added in API minor 11.
   */
  perfecting?: number;
  /**
   * The Perfecting binding, which outlives the rank.
   *
   * Tells a copy that HAS been on the track (even back at rank zero) from one that
   * never was. Only ever true. Added in API minor 11.
   */
  perfectingBound?: true;
}

/**
 * One thing in the world: a player, a mob, an npc, or a world object.
 *
 * Every field here is one the server actually sends. The client builds every
 * entity with defaults, so a field it never receives still reads, holding its
 * default forever.
 *
 * The block marked at the end is sent on YOUR record only; read it off
 * `world.player`.
 *
 * Anything else is reachable through `world.raw`, at your own risk and with the
 * same "readable but never written" trap.
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
   * Always '' for a guilded player. Visible on every player in range.
   */
  pledgeGuild: string;
  /**
   * The guild colour tier, 0 for the base look and for the unguilded.
   *
   * Taken from the PLEDGED guild for a player who has pledged. Display only.
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
   * An unreleased dead player can be resurrected in place; a ghost cannot.
   * `dead` stays true through both. Always false for the living and for every
   * non-player entity.
   */
  ghost: boolean;

  hostile: boolean;
  /**
   * The SELECTED target, sent for a PLAYER or a bot only.
   *
   * On a mob this is present, correctly typed and PERMANENTLY NULL: read
   * `aggroTargetId`. `world.unit('targettarget')` handles both.
   */
  targetId: number | null;
  /**
   * What a MOB is attacking. Null on a player, whose selection is `targetId`.
   */
  aggroTargetId: number | null;
  /**
   * The unit a taunt is FORCING this mob onto, null when nothing is.
   *
   * Written only on a mob, only by a taunt; permanently null on anything else,
   * a controlled pet included.
   */
  forcedTargetId: number | null;
  /**
   * Seconds left on that force, 0 when none is held.
   *
   * A taunt can raise threat and set NOTHING here (a taunt-immune template, a
   * training dummy, a boss taunted by a pet), which cannot be told from an
   * expiry. Report a held taunt; never report its absence as a failure.
   */
  forcedTargetTimer: number;
  /**
   * A living mob's hate table: entity id to threat, capped at the top eight.
   *
   * The server's own threat numbers. Empty on a player and on a mob that is not
   * fighting. The cap means it cannot place the twentieth raider.
   */
  threat: Map<number, number>;
  /**
   * The owning player's entity id for a controlled pet, null for anything wild.
   *
   * The only way to tell a pet from a wild mob. `world.unit('pet')` does the
   * lookup.
   */
  ownerId: number | null;
  /**
   * The ability ID being cast, an ACTIVITY SENTINEL, or null when not casting.
   *
   * `CastStartEvent.ability` lists the sentinels. `world.casts` is this reading
   * with the cast fields shaped.
   */
  castingAbility: string | null;
  /** Seconds left on the cast, against `castTotal`. Both 0 when not casting. */
  castRemaining: number;
  castTotal: number;
  /**
   * Who the cast currently RUNNING is aimed at, or null.
   *
   * The target the cast was started against, which holds even if the caster
   * retargets. Null means "not casting, or casting something untargeted".
   */
  castTargetId: number | null;
  channeling: boolean;
  auras: Aura[];

  /**
   * Whether the interact prompt offers something here, which is NOT "is a corpse".
   *
   * True on ground pickups, dungeon exits and rift portals too. Read `loot` for a
   * corpse's contents; a lootable entity with a null `loot` is not a corpse.
   */
  lootable: boolean;
  /**
   * A mob corpse's whole contents, or null.
   *
   * Mob only, and sent to EVERY player in range, so it holds slots you cannot
   * take. A loot display reads `world.corpseLoot()`.
   */
  loot: CorpseLoot | null;
  /** The first player to damage this mob, who owns its shared loot. Null on everything else. */
  tappedById: number | null;
  /** The player who took this corpse's profession harvest. Null when unclaimed. */
  harvestClaimedBy: number | null;

  // Worn gear and cosmetics, sent for a PLAYER only. Elsewhere these hold an inert
  // default: check `kind === 'player'` first.
  /**
   * The full worn set: slot to item id, empty for anything that is not a player.
   *
   * An id resolves to an icon through `ui.icon.item` and to nothing else.
   */
  equippedItems: Partial<Record<EquipSlot, string>>;
  /**
   * Per-slot instance payloads for the worn set, trimmed by the server.
   *
   * Sparse: a plain piece has no key. For YOUR OWN gear read
   * `world.equipmentInstances`; this is the public projection even on you.
   */
  equippedInstances: Partial<Record<EquipSlot, PublicItemInstance>>;
  /**
   * The held mainhand, which is NOT `equippedItems.mainhand`.
   *
   * Null when the mainhand slot holds a non-weapon. This is what is held; that is
   * what is worn.
   */
  mainhandItemId: string | null;
  /** The held offhand: a weapon, a held offhand item, or a shield. */
  offhandItemId: string | null;
  /**
   * The active weapon-skin cosmetic, or null.
   *
   * A skin id, not an item id: `ui.icon.item` does not resolve one.
   */
  weaponSkinId: string | null;
  /**
   * The mount being ridden, or empty when on foot.
   *
   * A mount key, not an item id, with no art. The reliable answer to "is that
   * player mounted".
   */
  mountKey: string;
  /**
   * The worn mount SKIN drawn over whatever `mountKey` names, or null.
   *
   * Purely a look, and can be set while on foot: ask `mountKey` whether the
   * player is mounted. A skin id, not an item id.
   *
   * Added in API minor 11.
   */
  mountSkinId: string | null;
  /**
   * The player turned their helm off in the paperdoll, so the composed body
   * renders without it.
   *
   * Cosmetic only: the helm is still equipped. False on every non-player.
   */
  helmHidden: boolean;

  // What a player is doing outside combat, and what kind of account. Player-only
  // like the block above. Added in API minor 6.
  /**
   * The player has flagged themselves away.
   *
   * Set by the player's own /afk, never inferred from idleness.
   */
  afk: boolean;
  /**
   * Sitting, EATING or DRINKING.
   *
   * One bit for all three; the wire never tells them apart.
   */
  sitting: boolean;
  /**
   * The party emote floating over a player's head, or null for none.
   *
   * An emote id. Living players only.
   */
  overheadEmoteId: string | null;
  /**
   * Bumped each time the SAME emote is played again.
   *
   * Tells a repeat from a held emote. Compare it against the last value seen; it
   * is not a count.
   */
  overheadEmoteSeq: number;
  /**
   * The account is marked as AI-operated by the game's operators.
   *
   * Set by the operators, never guessed. False on every ordinary account.
   */
  aiAccount: boolean;
  /**
   * The account is wearing the operators' Cheater tag.
   *
   * Says a mark is on, not how long is left. Power-neutral in the game: display
   * it, never treat the player as weaker.
   *
   * False on every ordinary account and every mob. Added in API minor 7, unlike
   * the rest of this block.
   */
  cheaterMark: boolean;

  /**
   * Ranged attack power, the hunter stat. 0 on anything that has none.
   *
   * On every entity's record, not only yours.
   */
  rangedPower: number;

  /**
   * Whether this entity is swinging its weapon at something.
   *
   * On every entity's record, so it is real on your target. False means "not
   * swinging".
   */
  autoAttack: boolean;
  /**
   * Seconds until this entity's next auto-attack swing lands. 0 when it is not
   * auto-attacking. On every entity, like `autoAttack`.
   *
   * THE PERIOD IS NOT `weapon.speed`: it includes melee haste, which is not on
   * the wire. Learn it from the RESET EDGE (the height of the upward jump), as the
   * game's own swing bar does.
   */
  swingTimer: number;

  // Yours alone: sent on the SELF record only. Elsewhere they hold an inert
  // default.
  /** Ability id to seconds remaining. An entry at 0 is not on cooldown. */
  cooldowns: Map<string, number>;
  gcdRemaining: number;
  attackPower: number;
  spellPower: number;
  /**
   * What your healing scales with: spell power plus the flat Healing Power
   * affix from gear and set bonuses.
   *
   * A healing readout wants this; a damage readout wants `spellPower`, since
   * Healing Power never feeds damage.
   *
   * Added in API minor 10.
   */
  healPower: number;
  spellHaste: number;
  critChance: number;
  dodgeChance: number;
  blockChance: number;
  /**
   * Seconds until your OFFHAND swing lands, while dual-wielding. Self-only: on
   * any other entity it is 0.
   *
   * READ IT ONLY WHILE `autoAttack` IS TRUE: otherwise it sits at 0, reading as a
   * swing about to land. Learn the period from the reset edge, as with
   * `swingTimer`. Test for an offhand swing with `offhandWeapon !== null`.
   *
   * Added in API minor 10.
   */
  offhandSwingTimer: number;
  comboPoints: number;
  /**
   * A druid's real mana pool, parked while a form runs the live bar on rage or
   * energy. Zero whenever there is nothing set aside.
   *
   * Floored. No form and a form with an empty parked pool both read 0. While a
   * form is up, `resource` and `maxResource` describe the form's bar.
   */
  savedMana: number;
  stats: CoreStats;
  weapon: WeaponInfo;
  /**
   * The offhand weapon you are dual-wielding, or null when there is none.
   *
   * `offhandWeapon !== null` is the dual-wielding test. `offhandItemId` is not:
   * it is also set for a shield or a held-only item. `speed` is UNHASTED; see
   * `offhandSwingTimer`.
   *
   * Added in API minor 10.
   */
  offhandWeapon: WeaponInfo | null;
  /**
   * Ability id to its charge pool, for the few abilities that have one.
   *
   * Absent until the first snapshot that carried any, so guard the read. An
   * ability with no charge model is not a key.
   */
  abilityCharges?: Record<string, AbilityCharge>;
}
