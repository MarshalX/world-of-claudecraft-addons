// What is ON the worn gear, which `equipment` cannot report: enchanting a worn piece leaves its
// item id unchanged.

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
