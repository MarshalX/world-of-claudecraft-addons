// What is ON the worn gear, which `equipment` cannot report moving.
//
// Its own group and its own module rather than a member of the core reads,
// because enchanting a piece already worn does not move `equipment` at all: the
// slot still holds the same item id. The two are watched by one dispatcher in
// `signature-gear.ts` for the same reason.

import { readAs } from './backend-read.ts';
import type { EquipSlot } from './game-types.ts';
import type { ItemInstance } from './items.ts';

interface GearReads {
  /** What is on the worn gear. Sparse: a plain piece has no key. */
  readonly equipmentInstances: Partial<Record<EquipSlot, ItemInstance>> | null;
}

function gearReads(world: unknown): GearReads {
  return {
    get equipmentInstances(): Partial<Record<EquipSlot, ItemInstance>> | null {
      return readAs<Partial<Record<EquipSlot, ItemInstance>>>(world, 'equipmentInstances');
    },
  };
}

export type { GearReads };
export { gearReads };
