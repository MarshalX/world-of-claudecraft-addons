// What is baked into one specific copy of an item, in three positions. `PublicItemInstance` is
// what the server sends to other players and on every market row and letter. `HeldItemInstance`
// adds what an owner sees on a stack they HOLD. `ItemInstance` is the untrimmed worn payload,
// reachable through `world.equipmentInstances` alone.

/**
 * The public part of one item's instance payload: exactly the fields the game's
 * `publicInstanceView` (`src/sim/item_instance_transfer.ts`) copies. Declared explicitly so a
 * new payload field stays excluded; check that function, not this list, for what is sent.
 */
interface PublicItemInstance {
  /** The player who signed or crafted this specific copy. */
  signer?: string;
  /** The enchant id applied to it. Content, so it resolves to nothing here. */
  enchant?: string;
  /**
   * Values baked into this copy when it was made. `masterwork` marks a masterwork proc, whose
   * `stats` are the baked tier delta. `quality` is legacy and only on old copies.
   */
  rolled?: { quality?: string; stats?: Record<string, number>; masterwork?: boolean };
  /** The player-chosen legendary name stamped on an orange promotion. Free text. */
  name?: string;
  /** The copy finished its Perfecting track. Absent is an ordinary copy. */
  perfected?: true;
  /**
   * Long-term Rift progression, for a piece earned there. `tier` is content, so a string.
   * `rolled.stats` is what the game applies; this is the input it is rebuilt from.
   */
  rift?: {
    sourceEventId: string;
    tier: string;
    power: number;
    upgradeLevel: number;
    maxUpgradeLevel: number;
    gemSlots: number;
    gems: string[];
    /** Legacy: pre-ladder payloads only, and the game's own load drops it. */
    baseStats?: Record<string, number>;
    /** Legacy: the retired forge enchant, on pre-ladder payloads only. */
    enchant?: { stat: string; value: number };
  };
}

/**
 * One copy IN YOUR OWN KEEPING: the public payload, plus what only its owner sees. Only
 * `world.inventory` and `world.bank` carry it; everywhere else the server has already trimmed.
 */
interface HeldItemInstance extends PublicItemInstance {
  /**
   * The owner's own safety mark on THIS copy: it refuses salvage, use as a reagent and vendor
   * sale. Unrelated to binding. Absent means unlocked.
   */
  locked?: boolean;
  /**
   * The bind-on-pickup trade window on a soulbound copy won from party boss loot.
   *
   * `untilMs` is a real epoch deadline: compare it against `Date.now()`. Presence is not
   * tradability, since a lapsed window stays on the copy until the next load or save.
   *
   * `eligible` is the party as it stood when the item DROPPED. `eligibleIds` is the same set as
   * CHARACTER ids, never comparable to entity ids.
   *
   * It opens trading only; mail, market, vendor and guild bank stay blocked. Equipping the copy
   * strips it for good.
   */
  partyTrade?: { untilMs: number; eligible: string[]; eligibleIds?: number[] };
}

/**
 * Your OWN worn item's untrimmed payload, reachable only through `world.equipmentInstances`.
 * `world.player.equippedInstances` is the public projection even for you.
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
   * Progress along the Perfecting track, 1 to one below the top rank. Owner-only. Absent is rank
   * zero, and it is deleted when `perfected` stamps, so the two are never both present.
   */
  perfecting?: number;
  /** The Perfecting binding, kept even where a collection swap left rank zero. */
  perfectingBound?: true;
}

export type { HeldItemInstance, ItemInstance, PublicItemInstance };
