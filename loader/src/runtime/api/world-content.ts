// The three static content tables on `woc.world`.
//
// Split from `world-reads.ts`, whose own header says it holds the plain STATE
// reads. These are not state: they are authored content that cannot change
// during a session, they are cached on the source array rather than answered
// fresh, and no watch key covers any of them. That difference is the seam.

import type { CivicService, Recipe, Station } from '../world/content.ts';
import type { WorldHub } from '../world/hub.ts';

/**
 * The content tables before the game exists.
 *
 * Shared frozen constants rather than built per read, unlike `emptyCasts`: these
 * are already frozen by the reader behind them, so there is no write for a fresh
 * array to guard against and no reason to allocate one.
 */
const NO_RECIPES: readonly Recipe[] = Object.freeze([]);
const NO_STATIONS: readonly Station[] = Object.freeze([]);
const NO_CIVIC_SERVICES: readonly CivicService[] = Object.freeze([]);

/**
 * The three static content tables, mirroring the backend group of the same name.
 *
 * Never null even before the game exists, unlike almost everything above: an
 * empty table is the honest answer for a client that has not carried one, and a
 * read that cannot change during a session has nothing to be "not ready yet"
 * about. None is a watch key, so nothing samples any of these.
 */
export function contentReads(hub: WorldHub) {
  return {
    get recipes(): readonly Recipe[] {
      const backend = hub.backend();
      if (backend === null) {
        return NO_RECIPES;
      }
      return backend.recipes;
    },

    get stations(): readonly Station[] {
      const backend = hub.backend();
      if (backend === null) {
        return NO_STATIONS;
      }
      return backend.stations;
    },

    get civicServices(): readonly CivicService[] {
      const backend = hub.backend();
      if (backend === null) {
        return NO_CIVIC_SERVICES;
      }
      return backend.civicServices;
    },
  };
}
