// The Materials Vault, and the crafting draw over it. `vaultInfo` is banker-gated like the bank.
// `craftVaultStock` is not a proximity state: the draw is refused inside an instance, which no
// banker fixes. Passed through rather than projected, as in `market.ts`.

import type { HeldSlot } from './game-types.ts';
import type { ProximityState } from './proximity.ts';

interface VaultInfo {
  /**
   * Item id to how many are held. Key order means nothing, so sort before rendering. An absent
   * material is held at zero.
   */
  stock: Readonly<Record<string, number>>;
  /**
   * Identity-bearing material stacks (crafted or signed), selected by array index. No row carries
   * a bag cell.
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
