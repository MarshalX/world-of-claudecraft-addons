// What a corpse holds, as the wire carries it.
//
// Claims about the game, like `game-types.ts`. The server shares ONE loot record per corpse with
// every client in scope, personal annotations included, so it shows slots you cannot take; a
// loot display reads `world.corpseLoot()`.

import type { InvSlot } from './game-types.ts';

/** One stack on a corpse: an `InvSlot` plus the personal-loot annotations. */
interface LootSlot extends InvSlot {
  /** Entity ids that may EACH take one copy. Absent on an ordinary drop. */
  personalFor?: number[];
  /** A need-greed drop everybody passed on, now free to anyone. */
  openToAll?: boolean;
  /** One loot action by any listed player grants every listed player a copy. */
  sharedPersonal?: boolean;
}

/** What a lootable corpse holds, as the wire carries it: everything, for everyone. */
interface CorpseLoot {
  copper: number;
  items: LootSlot[];
}

export type { CorpseLoot, LootSlot };
