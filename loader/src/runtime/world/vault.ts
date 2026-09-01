// The Materials Vault, and the crafting draw over it. Game 0.41.0.
//
// The two reads are gated differently, which is why they are not one type.
// `vaultInfo` rides banker proximity like `bankInfo` and is a `ProximityState`.
// `craftVaultStock` answers what crafting may draw from the vault HERE, which is
// everywhere in the open world and nowhere inside an instance; a proximity state
// would say "walk to a banker" about a state a banker cannot fix.
//
// Passed through rather than projected, for the reason `market.ts` gives.

import type { HeldSlot } from './game-types.ts';
import type { ProximityState } from './proximity.ts';

interface VaultInfo {
  /**
   * Item id to how many are held. Key order means nothing: the record round-trips
   * through Postgres jsonb online, so sort before rendering. An absent material
   * is held at zero rather than unavailable.
   */
  stock: Readonly<Record<string, number>>;
  /**
   * Identity-bearing material stacks (crafted or signed), which cannot collapse
   * into a count. The game selects a row by array index. No row carries the
   * advisory bag cell: the emitter drops it.
   */
  special: readonly HeldSlot[];
  /** Rungs bought, 0 through 5. 0 means the vault is still locked. */
  upgrades: number;
  /** The cap EVERY material shares. 0 while locked; there is no per-material upgrade. */
  perMaterialCap: number;
  /** Copper price of the next rung, null once every rung is bought. */
  nextUpgradeCost: number | null;
}

/** The Materials Vault, or why there is not one. Banker-gated, like the bank. */
type VaultState = ProximityState<VaultInfo>;

export type { VaultInfo, VaultState };
