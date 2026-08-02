// The two static content tables, read off the client's world object.
//
// Its own group rather than two more getters in `coreReads`, because these are
// unlike every other read on the backend in the one way that matters: they
// cannot change during a session. Nothing watches them, no signature covers
// them, and the reader behind each caches on the source array rather than
// answering fresh. Grouping them says so.

import { type Recipe, readRecipes, readStations, type Station } from './content.ts';

interface ContentReads {
  /** The game's own recipe table, copied and frozen. Static: nothing to watch. */
  readonly recipes: readonly Recipe[];
  /** The authored crafting stations, copied and frozen. Static, like `recipes`. */
  readonly stations: readonly Station[];
}

function contentReads(world: unknown): ContentReads {
  return {
    get recipes(): readonly Recipe[] {
      return readRecipes(world);
    },

    get stations(): readonly Station[] {
      return readStations(world);
    },
  };
}

export type { ContentReads };
export { contentReads };
