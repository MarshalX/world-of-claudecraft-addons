// What is baked into one specific copy of an item.
//
// Its own module rather than three lines in `game-types.ts`, which sits against
// the file limit and is the file two lanes are most likely to grow next. Both
// shapes are CLAIMS about the game in the same sense everything in that file is.
//
// The set matters more than any one of them. The server trims an instance to the
// three PUBLIC fields before it crosses to another player, and applies the same
// trim to every market row and every mail attachment, so `PublicItemInstance` is
// what an addon sees almost everywhere. `ItemInstance` is the untrimmed payload
// and is reachable through `world.equipmentInstances` alone. `HeldItemInstance`
// is the third position and the narrowest promise: the public fields plus the
// owner's lock, on the two surfaces the game lets an owner set one.

/**
 * The public part of one worn item's instance payload.
 *
 * This is the SERVER's projection, not a narrowing done here: the send site
 * copies exactly these three out of the full payload and drops the rest, so an
 * inspecting client is never sent an item's bound owner, its remaining charges,
 * or its rift forge record. Declaring the three explicitly rather than reusing
 * the self-record type is what keeps that true when the game adds a payload
 * field: the allowlist excludes it by construction, and a structural copy of the
 * full type would not.
 */
interface PublicItemInstance {
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
 * One copy IN YOUR OWN KEEPING: the public payload, plus the one mark its owner
 * sets by hand.
 *
 * `world.inventory` and `world.bank` hand these over and nothing else does,
 * which mirrors where the game itself paints the padlock (its bag grid and both
 * bank grids). Everywhere else the same stack shape appears, the server has
 * already projected the payload down to the three public fields, so a lock is
 * structurally unreachable there rather than merely left out of this reading.
 */
interface HeldItemInstance extends PublicItemInstance {
  /**
   * The owner's own safety mark on THIS copy, toggled in the game's bag window.
   *
   * A locked copy refuses salvage, consumption as a craft reagent, and a vendor
   * sale, single or bulk, until it is unlocked again. It says nothing about
   * binding, which is a content rule nobody chooses, and nothing about the
   * def-level flags that make an item unsellable for everyone. Absent means
   * unlocked, so read the value rather than the key.
   */
  locked?: boolean;
}

/**
 * Your OWN worn item's payload, which carries what the public one is trimmed of.
 *
 * Reachable only through `world.equipmentInstances`, off your self record. The
 * same slot read off `world.player.equippedInstances` is the public projection
 * above, because your own entity record goes through the same allowlist every
 * other player's does.
 */
interface ItemInstance extends PublicItemInstance {
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

export type { HeldItemInstance, ItemInstance, PublicItemInstance };
