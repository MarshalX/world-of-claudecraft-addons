// The ground around the player: what is on it, who marked it, what died on it.
//
// `hazards` and `markers` moved here from the derived group when the ground keys
// landed, because the seam is the SUBJECT rather than how the reading was
// obtained: everything here answers a question about a place. `nodeCooldowns`
// and `corpse` ride the player's own payload and are here for the same reason.

import { fieldValue } from '../net/frames.ts';
import { readAs } from './backend-read.ts';
import { type Hazard, hazardsOf, markersOf } from './derived.ts';
import type { Entity, Vec3 } from './game-types.ts';
import { type CorpseView, corpsesOf, type DeathZone, deathZonesOf, viewerOf } from './ground.ts';

interface GroundReads {
  readonly hazards: readonly Hazard[] | null;
  readonly markers: ReadonlyMap<number, number> | null;
  /** Lethal rings on a rift boss floor. See `world/ground.ts` for why not a Hazard. */
  readonly deathZones: readonly DeathZone[] | null;
  /** Entity id to one corpse's contents and the player's rights over them. */
  readonly corpses: ReadonlyMap<number, CorpseView>;
  /** Gathering node id to seconds until the player can harvest it. */
  readonly nodeCooldowns: ReadonlyMap<string, number> | null;
  /** Where the player's own body lies while their spirit is a ghost. */
  readonly corpse: Vec3 | null;
}

function groundReads(world: unknown, entities: () => ReadonlyMap<number, Entity>): GroundReads {
  return {
    get hazards(): readonly Hazard[] | null {
      return hazardsOf(world);
    },

    get markers(): ReadonlyMap<number, number> | null {
      return markersOf(world);
    },

    get deathZones(): readonly DeathZone[] | null {
      return deathZonesOf(world);
    },

    get corpses(): ReadonlyMap<number, CorpseView> {
      return corpsesOf(entities(), viewerOf(world));
    },

    get nodeCooldowns(): ReadonlyMap<string, number> | null {
      return readAs<Map<string, number>>(world, 'nodeCooldowns');
    },

    get corpse(): Vec3 | null {
      return readAs<Vec3>(fieldValue(world, 'player'), 'corpsePos');
    },
  };
}

export type { GroundReads };
export { groundReads };
