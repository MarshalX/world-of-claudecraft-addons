// The crafting identity, and what counts as a change to it.
//
// The whole reason this reading exists is one bit. The client seeds its craft skill
// counters with an all-zero default and replaces them only when the server's first
// crafting delta lands, so an addon reading zeroes cannot tell a character with no
// craft skill from a session that has not been told yet. That is the same shape of
// trap as a field the server never sends: present, correctly typed, and silently
// meaning two different things. The game publishes the flag that resolves it, and
// the loader used to throw the flag away.
//
// So the first suite is about `synced` surviving, and the second is about the
// signature noticing the transitions a crafting panel exists to show.

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

/** The reading, or a failure: every case below is about what is ON one. */
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

  // The default has to be the cautious one. A world carrying no identity at all is
  // the same situation as an unsynced one from an addon's point of view.
  it('reads false, not true, for a world carrying no identity at all', () => {
    expect(readCraftingIdentity({}).synced).toBe(false);
    expect(readCraftingIdentity(null).synced).toBe(false);
  });

  // A truthy-but-not-true value is a shape the loader does not recognise, and
  // claiming synced on one would be the exact failure this flag exists to prevent.
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

  // Absent on an older server, which must read as none blocked rather than as a
  // missing field an addon has to guard.
  it('reads an empty list for a server that sends no blocked work orders', () => {
    const identity = readCraftingIdentity({ craftingIdentity: { synced: true } });

    expect(identity.cadenceBlockedQuests).toEqual([]);
    expect(identity.knownRecipes).toEqual([]);
  });

  it('drops an entry that is not a recipe id rather than publishing it', () => {
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

  it('reads no mobile station as null rather than as an empty craft id', () => {
    expect(professionsOf({}).mobileStation).toBeNull();
  });

  // The pairing that makes the flag usable: zeroes plus `synced: false` is "not told
  // yet", and the same zeroes plus `synced: true` is a character with no craft skill.
  it('answers unsynced zeroes for a world that has received nothing', () => {
    const professions = professionsOf({});

    expect(professions.craftSkills).toEqual({});
    expect(professions.identity.synced).toBe(false);
  });
});

describe('what counts as a change', () => {
  it('changes when the identity syncs, which is the repaint that matters most', () => {
    expect(identitySignature(readCraftingIdentity({ craftingIdentity: SYNCED }))).not.toBe(
      identitySignature(readCraftingIdentity({ craftingIdentity: UNSYNCED })),
    );
  });

  // The regression this pins: replacing an id array with its LENGTH. A work order
  // coming off cooldown as another goes on is a same-length swap, and it is exactly
  // the transition a crafting panel is drawn to show.
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
