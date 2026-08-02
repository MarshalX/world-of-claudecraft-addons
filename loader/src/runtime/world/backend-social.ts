// What the player is currently IN: a bout, a bracket, a queue, a board.
//
// Its own group for the reason `coreReads` is one: a facade assembled by spread
// rather than by descriptor stops being live, so a split has to preserve the
// getters and there is a limit to how many one function body may hold. These
// four belong together because they answer one question with one lifetime, which
// is different from the question the sheet reads answer.

import { type ArenaStandings, readArena } from './arena.ts';
import { type FinderInfo, type FinderListingRow, readFinder, readFinderBoard } from './finder.ts';
import { type MatchInfo, readMatch } from './match.ts';

interface SocialReads {
  /** The competitive bout in progress. See `world/match.ts` for the ten second cadence. */
  readonly match: MatchInfo | null;
  /** Standings, queue and ladders. See `world/arena.ts`. */
  readonly arena: ArenaStandings | null;
  /** Dungeon finder state. See `world/finder.ts`. */
  readonly finder: FinderInfo | null;
  /** The realm's open premade listings, or null before the first sync. */
  readonly finderBoard: readonly FinderListingRow[] | null;
}

function socialReads(world: unknown): SocialReads {
  return {
    get match(): MatchInfo | null {
      return readMatch(world);
    },

    get arena(): ArenaStandings | null {
      return readArena(world);
    },

    get finder(): FinderInfo | null {
      return readFinder(world);
    },

    get finderBoard(): readonly FinderListingRow[] | null {
      return readFinderBoard(world);
    },
  };
}

export type { SocialReads };
export { socialReads };
