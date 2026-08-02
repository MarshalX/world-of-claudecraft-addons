// What a unit token is resolved against.
//
// One derivation, because `world.unit('target')` and an anchor pinned to
// `{ unit: 'target' }` have to mean the same unit. Two readings of one token that
// could disagree would be an addon drawing a nameplate over somebody its own
// readout is not describing, and the disagreement would only appear in the frame
// between a target changing and a repaint.

import type { Entity } from './game-types.ts';
import type { WorldHub } from './hub.ts';
import { readonlyMapView } from './readonly-map.ts';
import type { UnitContext } from './units.ts';

/**
 * Before world entry there is no entity map, and every token resolves to nothing.
 *
 * A shared frozen view rather than a fresh Map per call: this is read on every
 * frame by every anchor, and the answer before world entry is always the same.
 */
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
