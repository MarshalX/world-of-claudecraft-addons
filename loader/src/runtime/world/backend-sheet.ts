// The player's own sheet and their group, each projected by its own module.
//
// Grouped apart from the derived reads because these describe what the player
// and their group HAVE, where those describe what is happening around them.

import type { BackendDeps } from './backend-deps.ts';
import {
  type CharacterInfo,
  type ProfessionInfo,
  readCharacter,
  readProfessions,
  readTalents,
  type TalentInfo,
} from './character.ts';
import { type EncounterInfo, readEncounter } from './encounter.ts';
import { type GroupInfo, readGroup } from './group.ts';

interface SheetReads {
  /** The zone name the game is displaying. See `world/zone.ts`. */
  readonly zone: string | null;
  /** Progression, deeds and titles. See `world/character.ts`. */
  readonly character: CharacterInfo | null;
  readonly talents: TalentInfo | null;
  readonly professions: ProfessionInfo | null;
  /** Loot rolls, master loot and raid lockouts. See `world/group.ts`. */
  readonly group: GroupInfo | null;
  /** The instanced run in progress, thin by design. See `world/encounter.ts`. */
  readonly encounter: EncounterInfo | null;
}

function sheetReads(world: unknown, deps: BackendDeps): SheetReads {
  return {
    get zone(): string | null {
      return deps.zoneName();
    },

    get character(): CharacterInfo | null {
      return readCharacter(world);
    },

    get talents(): TalentInfo | null {
      return readTalents(world);
    },

    get professions(): ProfessionInfo | null {
      return readProfessions(world);
    },

    get group(): GroupInfo | null {
      return readGroup(world, deps.simNow());
    },

    get encounter(): EncounterInfo | null {
      return readEncounter(world);
    },
  };
}

export type { SheetReads };
export { sheetReads };
