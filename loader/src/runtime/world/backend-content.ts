// The three static content tables. They cannot change during a session, so nothing watches them
// and each reader caches on its source array.

import {
  type CivicService,
  type Recipe,
  readCivicServices,
  readRecipes,
  readStations,
  type Station,
} from './content.ts';

interface ContentReads {
  /** The game's own recipe table, copied and frozen. Static: nothing to watch. */
  readonly recipes: readonly Recipe[];
  /** The authored crafting stations, copied and frozen. Static, like `recipes`. */
  readonly stations: readonly Station[];
  /** The authored mailboxes and noticeboards, copied and frozen. Static too. */
  readonly civicServices: readonly CivicService[];
}

function contentReads(world: unknown): ContentReads {
  return {
    get recipes(): readonly Recipe[] {
      return readRecipes(world);
    },

    get stations(): readonly Station[] {
      return readStations(world);
    },

    get civicServices(): readonly CivicService[] {
      return readCivicServices(world);
    },
  };
}

export type { ContentReads };
export { contentReads };
