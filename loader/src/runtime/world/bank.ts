// The personal bank, the second pooled item store beside the bags.
//
// Proximity-gated: the reading exists only while the player stands at a banker.
// It is deliberately NOT heavy-gated on the server, because it appears from
// walking up to a bursar rather than from a command this session sent.
//
// Capacity is a flat slot budget over ONE list: nothing pins an item to a fixed
// cell, so there is no `slot` placement to honour the way there is in the bags.
//
// Passed through rather than projected, for the reason `market.ts` gives.

import type { HeldSlot } from './game-types.ts';
import type { ProximityState } from './proximity.ts';

/** One row of the bonus-slot breakdown. The id list is append-only content. */
interface BankBonusSource {
  /** A source id such as 'email' or 'referral'. Content, so not a closed set. */
  id: string;
  /** Slots this source grants right now. 0 means it is advertised, not earned. */
  slots: number;
  maxSlots: number;
  /** Progress numerator, where the source has one. */
  count?: number;
  cap?: number;
}

interface BankInfo {
  /** The pooled contents. Order is the game's; there are no fixed cells. */
  slots: readonly HeldSlot[];
  /**
   * Total budget: the base allowance, purchased, bonus, and every socketed bag.
   *
   * A display total, never a fit answer: the budget is split into two pools, so
   * `capacity - slots.length` reports space a general deposit can be refused.
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
  /** How many of the bag sockets are open. Game 0.41.0. */
  socketsUnlocked: number;
  /** One entry per socket, always four, null where the socket is empty. */
  socketBags: readonly (string | null)[];
  /** Copper price of the next socket, null once every socket is open. */
  nextSocketCost: number | null;
  /**
   * The Claudium price of the next expansion rung. ABSENT rather than null when
   * there is not one: the wire omits the key, and the offline sim never has it.
   */
  nextRungClaudiumPrice?: number;
  /** The general half of the split budget. Sums with `materialsCapacity` to `capacity`. */
  generalCapacity: number;
  /** The materials half of the split budget. */
  materialsCapacity: number;
  /** Stacks charged against the general pool. Sums with `materialsUsed` to `slots.length`. */
  generalUsed: number;
  /** Stacks charged against the materials pool. */
  materialsUsed: number;
}

/** The deposit box, or why there is not one. */
type BankState = ProximityState<BankInfo>;

export type { BankBonusSource, BankInfo, BankState };
