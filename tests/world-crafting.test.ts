// The crafting identity. The client seeds all-zero counters until the first crafting delta,
// so `synced` is the only thing telling "no craft skill" from "not told yet".

import { describe, expect, it } from 'vitest';

import { type ProfessionInfo, readProfessions } from '../loader/src/runtime/world/character.ts';
import { readCraftingIdentity } from '../loader/src/runtime/world/crafting.ts';
import {
  identitySignature,
  professionsSignature,
} from '../loader/src/runtime/world/signature-sheet.ts';

/** The identity as the client seeds it, before any crafting delta has landed. */
const UNSYNCED = {
  version: 1,
  synced: false,
  activeArchetype: null,
  pairedMajor: null,
  hobbyCraft: null,
  attunedPairs: [],
  switchCount: 0,
  amendsProgress: 0,
  amendsRequired: 0,
  knownRecipes: [],
  cadenceBlockedQuests: [],
};

/** The identity as it arrives once the server has sent one. */
const SYNCED = {
  version: 1,
  synced: true,
  activeArchetype: 'forgewright',
  pairedMajor: 'blacksmithing',
  hobbyCraft: 'cooking',
  attunedPairs: ['blacksmithing+leatherworking'],
  switchCount: 2,
  amendsProgress: 40,
  amendsRequired: 100,
  knownRecipes: ['iron_buckle', 'coarse_thread'],
  cadenceBlockedQuests: ['order_hollis_1'],
};

function professionsOf(world: unknown): ProfessionInfo {
  const professions = readProfessions(world);
  if (professions === null) {
    throw new Error('expected a professions reading');
  }
  return professions;
}

describe('the flag the whole reading is for', () => {
  it('reads false for a client that has received no crafting value yet', () => {
    expect(readCraftingIdentity({ craftingIdentity: UNSYNCED }).synced).toBe(false);
  });

  it('reads true once one has landed', () => {
    expect(readCraftingIdentity({ craftingIdentity: SYNCED }).synced).toBe(true);
  });

  it('reads false for a world carrying no identity at all', () => {
    expect(readCraftingIdentity({}).synced).toBe(false);
    expect(readCraftingIdentity(null).synced).toBe(false);
  });

  it('reads false for anything that is not the boolean true', () => {
    expect(readCraftingIdentity({ craftingIdentity: { synced: 1 } }).synced).toBe(false);
  });
});

describe('the rest of the identity', () => {
  it('reads every field, under the loader name where the game differs', () => {
    const identity = readCraftingIdentity({ craftingIdentity: SYNCED });

    expect(identity.archetype).toBe('forgewright');
    expect(identity.pairedMajor).toBe('blacksmithing');
    expect(identity.hobbyCraft).toBe('cooking');
    expect(identity.attunedPairs).toEqual(['blacksmithing+leatherworking']);
    expect(identity.switchCount).toBe(2);
    expect(identity.amendsProgress).toBe(40);
    expect(identity.amendsRequired).toBe(100);
    expect(identity.knownRecipes).toEqual(['iron_buckle', 'coarse_thread']);
    expect(identity.cadenceBlockedQuests).toEqual(['order_hollis_1']);
  });

  it('reads an empty list for a server that sends no blocked work orders', () => {
    const identity = readCraftingIdentity({ craftingIdentity: { synced: true } });

    expect(identity.cadenceBlockedQuests).toEqual([]);
    expect(identity.knownRecipes).toEqual([]);
  });

  it('drops an entry that is not a recipe id', () => {
    const source = { craftingIdentity: { knownRecipes: ['iron_buckle', 7, null] } };

    expect(readCraftingIdentity(source).knownRecipes).toEqual(['iron_buckle']);
  });
});

describe('the professions reading', () => {
  it('carries the identity and the placed mobile station beside the counters', () => {
    const professions = professionsOf({
      craftSkills: { blacksmithing: 30 },
      gatheringProficiency: { mining: 12 },
      craftingIdentity: SYNCED,
      activeMobileStationCraft: 'cooking',
    });

    expect(professions.identity.archetype).toBe('forgewright');
    expect(professions.mobileStation).toBe('cooking');
  });

  it('reads no mobile station as null', () => {
    expect(professionsOf({}).mobileStation).toBeNull();
  });

  it('answers unsynced zeroes for a world that has received nothing', () => {
    const professions = professionsOf({});

    expect(professions.craftSkills).toEqual({});
    expect(professions.identity.synced).toBe(false);
  });
});

describe('what counts as a change', () => {
  it('changes when the identity syncs', () => {
    expect(identitySignature(readCraftingIdentity({ craftingIdentity: SYNCED }))).not.toBe(
      identitySignature(readCraftingIdentity({ craftingIdentity: UNSYNCED })),
    );
  });

  // A signature over an id array's LENGTH misses a same-length swap.
  it('changes when a blocked work order is swapped for another at equal length', () => {
    const before = readCraftingIdentity({
      craftingIdentity: { ...SYNCED, cadenceBlockedQuests: ['order_a'] },
    });
    const after = readCraftingIdentity({
      craftingIdentity: { ...SYNCED, cadenceBlockedQuests: ['order_b'] },
    });

    expect(identitySignature(after)).not.toBe(identitySignature(before));
  });

  it('changes when a recipe is learned in place of another at equal length', () => {
    const before = readCraftingIdentity({
      craftingIdentity: { ...SYNCED, knownRecipes: ['iron_buckle'] },
    });
    const after = readCraftingIdentity({
      craftingIdentity: { ...SYNCED, knownRecipes: ['coarse_thread'] },
    });

    expect(identitySignature(after)).not.toBe(identitySignature(before));
  });

  it('does not change when nothing moved', () => {
    const one = readCraftingIdentity({ craftingIdentity: SYNCED });
    const two = readCraftingIdentity({ craftingIdentity: { ...SYNCED } });

    expect(identitySignature(two)).toBe(identitySignature(one));
  });

  it('covers the counters, the identity and the station in the professions key', () => {
    const base = readProfessions({ craftingIdentity: SYNCED, activeMobileStationCraft: null });
    const moved = readProfessions({
      craftingIdentity: SYNCED,
      activeMobileStationCraft: 'cooking',
    });
    const skilled = readProfessions({ craftingIdentity: SYNCED, craftSkills: { cooking: 1 } });

    expect(professionsSignature(moved)).not.toBe(professionsSignature(base));
    expect(professionsSignature(skilled)).not.toBe(professionsSignature(base));
    expect(professionsSignature(readProfessions({ craftingIdentity: SYNCED }))).toBe(
      professionsSignature(base),
    );
  });
});
