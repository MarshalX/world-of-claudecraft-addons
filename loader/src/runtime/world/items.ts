// What is baked into one specific copy of an item.
//
// Its own module rather than three lines in `game-types.ts`, which sits against
// the file limit and is the file two lanes are most likely to grow next. Both
// shapes are CLAIMS about the game in the same sense everything in that file is.
//
// The pair matters more than either half. The server trims an instance to the
// three PUBLIC fields before it crosses to another player, and applies the same
// trim to every market row and every mail attachment, so `PublicItemInstance` is
// what an addon sees almost everywhere. `ItemInstance` is the untrimmed payload
// and is reachable through `world.equipmentInstances` alone.

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

export type { ItemInstance, PublicItemInstance };
