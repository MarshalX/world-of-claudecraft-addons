// The two stores you keep things in: the bank and the Materials Vault. Both are
// proximity-gated on a banker and read the way `world.market` is, so start from
// the status:
//
//   const bank = woc.world.bank;
//   if (bank.status !== 'near') return;   // 'away', or 'unknown' before entry
//   for (const stack of bank.info.slots) { ... }
//
// The bank is a flat slot budget over ONE list. The vault is keyed PER MATERIAL
// with one cap shared by every material, so a vault with room for more copper
// can be full of iron.
//
// `woc.world.craftVaultStock` is NOT gated on a banker: it answers what crafting
// may draw from the vault where you are standing, which is everywhere in the
// open world and nowhere inside an instance, so it is a record or null rather
// than a status.

import type { ProximityState } from './economy.js';
import type { HeldSlot } from './world-items.js';

/** One row of the bonus-slot breakdown. The id list is append-only content. */
export interface BankBonusSource {
  /** A source id such as 'email' or 'referral'. Content, so not a closed set. */
  id: string;
  /** Slots this source grants right now. 0 means it is advertised, not earned. */
  slots: number;
  maxSlots: number;
  /** Progress numerator, where the source has one. */
  count?: number;
  cap?: number;
}

/**
 * The deposit box: one pooled list, a budget split between a general pool and a
 * materials pool, and four bag sockets above the copper slot ladder that feeds
 * both. Everything below `bonusSources` was added in API minor 10.
 */
export interface BankInfo {
  /** The pooled contents. Order is the game's; there are no fixed cells. */
  slots: readonly HeldSlot[];
  /**
   * Total budget: the base allowance, purchased, bonus, and every socketed bag.
   *
   * A DISPLAY TOTAL, NEVER A FIT ANSWER. The budget is split into two pools, so
   * `capacity - slots.length` reports free space a general deposit can be refused
   * from. Use `generalCapacity - generalUsed` for what a non-material stack can
   * actually go into.
   */
  capacity: number;
  /** Copper-bought slots. */
  purchasedSlots: number;
  /** Server-granted slots, recomputed at every login. */
  bonusSlots: number;
  /** Copper price of the next expansion, null once all of them are bought. */
  nextExpansionCost: number | null;
  /** The per-source breakdown behind `bonusSlots`. Always empty offline. */
  bonusSources: readonly BankBonusSource[];

  /**
   * How many of the four bag sockets are open. Unlocking one adds NO SLOTS until
   * a bag goes into it, so `capacity` does not move. Added in API minor 10.
   */
  socketsUnlocked: number;
  /**
   * The bag in each socket as a bare item id, or null where the socket is empty.
   * ALWAYS FOUR ENTRIES, locked sockets included, so the index is the socket
   * number. The bag's slots join the pooled budget. Added in API minor 10.
   */
  socketBags: readonly (string | null)[];
  /** Copper price of the next socket, null once every socket is open. Added in API minor 10. */
  nextSocketCost: number | null;
  /**
   * The Claudium price of the next expansion rung, where there is one.
   *
   * ABSENT rather than null: the wire omits the key when the price service is
   * unreachable, and the offline sim never has it. A missing price means the gold
   * price beside it is the only one to show, not that the rung is unavailable.
   * Added in API minor 10.
   */
  nextRungClaudiumPrice?: number;

  /**
   * The general half of the split budget, for everything that is not a material.
   * `generalCapacity + materialsCapacity === capacity` always; the game's decoder
   * rejects a snapshot where it does not.
   *
   * `generalCapacity - generalUsed` is the free room a non-material stack can go
   * into, and it CAN BE NEGATIVE: unsocketing a bag shrinks a pool without
   * destroying anything, and the game refuses new deposits rather than clamping.
   * Floor it at 0 before rendering it as free slots. Added in API minor 10.
   */
  generalCapacity: number;
  /** The materials half of the split budget. Added in API minor 10. */
  materialsCapacity: number;
  /**
   * Stacks charged against the general pool. `generalUsed + materialsUsed ===
   * slots.length` always. Both counts are UNBOUNDED by their capacities, so a
   * meter drawn as `used / capacity` has to handle a fraction over 1. Added in
   * API minor 10.
   */
  generalUsed: number;
  /** Stacks charged against the materials pool. Added in API minor 10. */
  materialsUsed: number;
}

/** The deposit box, or why there is not one. Read `status` first, like `MarketState`. */
export type BankState = ProximityState<BankInfo>;

/**
 * The Materials Vault: a per-material store beside the bank, at the same bursars.
 * No slot budget and no cells; every material has its own count against ONE
 * shared cap, so "full" is a sentence about one material. Added in API minor 10.
 */
export interface VaultInfo {
  /**
   * Item id to how many are held.
   *
   * KEY ORDER MEANS NOTHING: the record round-trips through the server's
   * database, which re-orders keys, so sort before rendering or the rows shuffle
   * between sessions. A material that is not a key is held at ZERO, not unknown.
   */
  stock: Readonly<Record<string, number>>;
  /**
   * Crafted or signed material stacks, which carry an identity and so sit here
   * as rows instead of adding to `stock`. Array order is the index the game
   * selects a row by. These rows never carry the advisory bag cell.
   */
  special: readonly HeldSlot[];
  /** Rungs bought, 0 through 5. 0 means the vault is still locked. */
  upgrades: number;
  /**
   * The cap EVERY material shares, in items; a rung raises it for everything at
   * once. 0 while the vault is locked, so `count / perMaterialCap` divides by zero
   * on every vault before the first rung: check `upgrades > 0` first.
   */
  perMaterialCap: number;
  /** Copper price of the next rung, null once every rung is bought. */
  nextUpgradeCost: number | null;
}

/**
 * The Materials Vault, or why there is not one. Read `status` first.
 *
 * Banker-gated like `world.bank` but gated SEPARATELY, so read the one you are
 * about to use. A vault payload the game cannot decode is dropped to null and
 * reaches you as 'away' while the bank keeps its last good reading, so an 'away'
 * vault beside a 'near' bank is a refused decode rather than the player walking off.
 */
export type VaultState = ProximityState<VaultInfo>;
