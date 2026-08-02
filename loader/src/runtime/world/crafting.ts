// The crafting identity, which is the settled half of the game's professions facet.
//
// `character.ts` used to publish two counter maps and say in its own header that the
// rest of the facet is a stub. That was right when it was written. The identity is
// not a stub: the server sends it as ONE value on purpose, so the client never
// evaluates a recipe against a pair from one tick and skills from another, and every
// field on it is a scalar or a sorted array of ids.
//
// `synced` is what earns the rest their place. The client seeds `craftSkills` with an
// all-zero default and replaces it only when a `cprof` delta lands, and the identity
// beside it carries `synced: false` until that moment. So an all-zero read cannot be
// told apart from a character with no craft skill at all: present, correctly typed,
// and silently meaning two different things, which is the trap this project has hit
// before. The game publishes the flag that resolves it and the loader was throwing it
// away.

import { fieldArray, fieldNumber, fieldString, fieldValue } from '../net/frames.ts';

interface CraftingIdentity {
  /** False until the first `cprof` delta lands. Every other field is a default. */
  synced: boolean;
  /** The active archetype id, or null before attunement. An id, never a title. */
  archetype: string | null;
  pairedMajor: string | null;
  hobbyCraft: string | null;
  /** Canonical pair ids, sorted by the server. */
  attunedPairs: readonly string[];
  switchCount: number;
  amendsProgress: number;
  amendsRequired: number;
  /**
   * Recipe ids this character LEARNED from a source, sorted.
   *
   * Not the set it can craft. A recipe with no acquisition list is grandfathered:
   * known to everyone and absent from here for that reason rather than because it
   * has not been learned.
   */
  knownRecipes: readonly string[];
  /** Work orders inside their cooldown window, sorted. Empty on an older server. */
  cadenceBlockedQuests: readonly string[];
}

function stringsOf(source: unknown, field: string): readonly string[] {
  return fieldArray(source, field).filter((one): one is string => typeof one === 'string');
}

function numberOf(source: unknown, field: string): number {
  return fieldNumber(source, field) ?? 0;
}

/** The identity, or an unsynced default when the game has not carried one. */
function readCraftingIdentity(world: unknown): CraftingIdentity {
  const identity = fieldValue(world, 'craftingIdentity');
  return {
    synced: fieldValue(identity, 'synced') === true,
    archetype: fieldString(identity, 'activeArchetype'),
    pairedMajor: fieldString(identity, 'pairedMajor'),
    hobbyCraft: fieldString(identity, 'hobbyCraft'),
    attunedPairs: stringsOf(identity, 'attunedPairs'),
    switchCount: numberOf(identity, 'switchCount'),
    amendsProgress: numberOf(identity, 'amendsProgress'),
    amendsRequired: numberOf(identity, 'amendsRequired'),
    knownRecipes: stringsOf(identity, 'knownRecipes'),
    cadenceBlockedQuests: stringsOf(identity, 'cadenceBlockedQuests'),
  };
}

export type { CraftingIdentity };
export { readCraftingIdentity };
