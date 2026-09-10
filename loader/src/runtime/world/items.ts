// What is baked into one specific copy of an item.
//
// Its own module rather than three lines in `game-types.ts`, which sits against
// the file limit and is the file two lanes are most likely to grow next. Both
// shapes are CLAIMS about the game in the same sense everything in that file is.
//
// The set matters more than any one of them. The server trims an instance to the
// PUBLIC fields before it crosses to another player, and applies the same
// trim to every market row and every mail attachment, so `PublicItemInstance` is
// what an addon sees almost everywhere. `ItemInstance` is the untrimmed payload
// and is reachable through `world.equipmentInstances` alone. `HeldItemInstance`
// is the third position: the public fields plus what only an owner sees on a
// stack they are HOLDING, which is the lock they set and the bind-on-pickup
// trade window a soulbound raid drop arrives carrying.

/**
 * The public part of one worn item's instance payload.
 *
 * This is the SERVER's projection, not a narrowing done here: `publicInstanceView`
 * (`src/sim/item_instance_transfer.ts`) copies exactly these SIX out of the full
 * payload and drops the rest, so an inspecting client is never sent an item's
 * bound owner, its remaining charges, or its mid-track Perfecting rank.
 * Declaring them explicitly rather than reusing the self-record type is what
 * keeps that true when the game adds a payload field: the allowlist excludes it
 * by construction, and a structural copy of the full type would not.
 *
 * It was THREE until game 0.42.0, which added `name` and `perfected` (a
 * promotion is meant to be seen by whoever inspects you) and moved `rift` up
 * from the owner-only record. Re-read the function rather than this list: it is
 * the only thing that says what an inspecting client actually receives.
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
  /** The player-chosen legendary name stamped on an orange promotion. Free text. */
  name?: string;
  /** The copy finished its Perfecting track. Absent is an ordinary copy. */
  perfected?: true;
  /**
   * Long-term Rift progression, for a piece earned there.
   *
   * `tier` is content and is left a string for the same reason `AuraKind` is: a
   * copy of the union here would go stale while looking authoritative.
   * `rolled.stats` is the aggregate the game actually applies; this record is
   * the bounded input it is rebuilt from.
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
 * One copy IN YOUR OWN KEEPING: the public payload, plus what only its owner sees.
 *
 * `world.inventory` and `world.bank` hand these over and nothing else does,
 * which mirrors where the game itself paints the padlock (its bag grid and both
 * bank grids). Everywhere else the same stack shape appears, the server has
 * already projected the payload down to the public fields, so neither of these
 * is structurally reachable there rather than merely left out of this reading.
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
  /**
   * The bind-on-pickup trade window on a soulbound copy won from party boss loot.
   *
   * `untilMs` is a REAL EPOCH DEADLINE on a live server, so compare it against
   * `Date.now()`: the game's own online client is `Math.max(0, untilMs -
   * Date.now())` (`src/net/online.ts:3819`). The offline sim compares against a
   * tick-derived clock instead, which is why the game routes this through a
   * world method at all, and is not a case any addon meets.
   *
   * PRESENCE IS NOT TRADABILITY. The marker is retired only at a persistence
   * boundary, on load and on save (`src/sim/loot/bop_trade_persistence.ts`), and
   * deliberately never by a tick sweep, so a window that lapsed this session is
   * still sitting on the copy exactly as it was. Read the deadline, never the key.
   *
   * `eligible` is the loot-candidate snapshot taken AT THE MOMENT THE ITEM
   * DROPPED, not the party as it stands now, so a member who has since left is
   * still on it and one who has since joined is not. `eligibleIds` is the same
   * set as stable CHARACTER ids, which a live server always knows; they are not
   * entity ids and must never be compared against one.
   *
   * Trading is the only channel this opens: mail, market, vendor and guild bank
   * stay blocked by the item's own `soulbound` flag. Equipping the copy strips
   * the field for good, which is why `ItemInstance` cannot carry it.
   */
  partyTrade?: { untilMs: number; eligible: string[]; eligibleIds?: number[] };
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
   * Progress along the Perfecting track, 1 to one below the top rank.
   *
   * Owner-only: `publicInstanceView` copies `perfected` and not this, so an
   * inspecting client sees that a copy FINISHED and never how far an unfinished
   * one has come. Absent is rank zero, and it is DELETED when `perfected` stamps
   * rather than holding the top rank, so the two are never both present.
   */
  perfecting?: number;
  /** The Perfecting binding, kept even where a collection swap left rank zero. */
  perfectingBound?: true;
}

export type { HeldItemInstance, ItemInstance, PublicItemInstance };
