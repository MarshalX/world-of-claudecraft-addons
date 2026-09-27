import type { HeldItemInstance, PublicItemInstance } from './entity.js';

/** One stack, wherever a stack is read: bags, bank, a letter, a corpse, a page. */
export interface InvSlot {
  itemId: string;
  count: number;
  /** The bag cell it was dragged into. Absent when it was never placed by hand. */
  slot?: number;
  /**
   * What is baked into this specific copy. Absent on an ordinary fungible stack.
   *
   * The PUBLIC trim: the server projects a market row, a letter attachment and a
   * guild bank row down to these fields before sending them. A stack of your OWN
   * carries more and is handed over as a `HeldSlot`.
   */
  instance?: PublicItemInstance;
}

/**
 * One stack in your OWN bags or bank, which is the only place a lock can exist.
 *
 * This payload skips the server's public projection, so it still carries the
 * owner's lock. On every other surface the lock is unreachable, which is why it
 * is not an optional field on `InvSlot`: there an absent flag could not be told
 * from an unlocked copy.
 *
 * Added in API minor 6.
 */
export interface HeldSlot extends InvSlot {
  instance?: HeldItemInstance;
  /**
   * The recipe that minted this stack. ABSENT on almost everything: the game
   * records it only where the provenance matters, and the public projection
   * drops it. It tells two `VaultInfo.special` rows of one item id apart.
   *
   * Added in API minor 10.
   */
  craftedRecipeId?: string;
}
