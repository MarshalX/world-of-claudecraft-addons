// What a unit token is resolved against.
//
// One derivation, so `world.unit('target')` and an anchor pinned to `{ unit: 'target' }` always
// mean the same unit.

import type { Entity } from './game-types.ts';
import type { WorldHub } from './hub.ts';
import { readonlyMapView } from './readonly-map.ts';
import type { UnitContext } from './units.ts';

/** The empty entity map before world entry, shared since every anchor reads it every frame. */
const NO_ENTITIES: ReadonlyMap<number, Entity> = readonlyMapView(new Map<number, Entity>());

/** The live context, re-read per call: the backend is null until world entry. */
function contextOf(hub: WorldHub): UnitContext {
  const backend = hub.backend();
  return {
    player: backend?.player ?? null,
    target: backend?.target ?? null,
    entities: backend?.entities ?? NO_ENTITIES,
    party: backend?.party ?? null,
  };
}

export { contextOf, NO_ENTITIES };
