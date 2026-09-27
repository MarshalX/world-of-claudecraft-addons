// The three static content tables on `woc.world`: authored content, cached, and never a watch key.

import type { CivicService, Recipe, Station } from '../world/content.ts';
import type { WorldHub } from '../world/hub.ts';

/** Shared frozen constants, unlike `emptyCasts`: frozen, so there is no write to guard. */
const NO_RECIPES: readonly Recipe[] = Object.freeze([]);
const NO_STATIONS: readonly Station[] = Object.freeze([]);
const NO_CIVIC_SERVICES: readonly CivicService[] = Object.freeze([]);

/** Never null: empty is the honest answer before the game exists. */
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
