// What a corpse holds, as the wire carries it.
//
// These two are CLAIMS about the game rather than loader derivations, so they
// belong with `game-types.ts` in kind. They sit in their own module because that
// file is already near the size limit and is the one most likely to grow again.
//
// The disclosure worth stating once, here, because it is the thing an author has
// to know before touching either shape: the server builds ONE loot record per
// corpse per tick and shares it with every client in interest scope, personal
// annotations included. So a slot naming somebody else is a slot you can see and
// cannot take. `world.corpseLoot()` applies the game's own rights rule and is
// what a loot display should read.

import type { InvSlot } from './game-types.ts';

/**
 * One stack on a corpse.
 *
 * An `InvSlot` plus the three personal-loot annotations, all of which ride to
 * every player in range rather than only to the player they name.
 */
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
