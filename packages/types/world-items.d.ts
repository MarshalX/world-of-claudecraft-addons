// One stack of items, wherever a stack is read.
//
// Its own module rather than three declarations in `world.d.ts`, which had grown past the file
// limit, and split HERE because the loader draws the same line: the shapes an item copy is read
// through live in their own module there too. Nothing is re-exported through a barrel, so the
// split is visible in the import rather than hidden behind one.

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
   * The PUBLIC trim, which is all the shared shape can promise: a market row, a
   * letter attachment and a guild bank row are each projected down to these
   * three fields by the server before they are sent to anybody. A stack of your
   * OWN carries one field more and is handed over as a `HeldSlot`; the rest of
   * the payload stays reachable through `world.raw` and is promised nowhere.
   */
  instance?: PublicItemInstance;
}

/**
 * One stack in your OWN bags or bank, which is the only place a lock can exist.
 *
 * The only difference from `InvSlot` is that this payload never went through the
 * server's public projection, so it still carries the owner's lock. It is a
 * separate shape rather than a wider `InvSlot` because the lock is genuinely
 * unreachable on every other surface the stack shape appears on, where an
 * `undefined` flag would be indistinguishable from an unlocked copy.
 *
 * Added in API minor 6.
 */
export interface HeldSlot extends InvSlot {
  instance?: HeldItemInstance;
  /**
   * The recipe that minted this stack. ABSENT on almost everything: the game
   * records it only where the provenance matters. On `HeldSlot` rather than
   * `InvSlot` because the server's public projection (a market row, a letter
   * attachment, a guild bank row) drops it. It is what tells two
   * `VaultInfo.special` rows of one item id apart. Added in API minor 10.
   */
  craftedRecipeId?: string;
}
