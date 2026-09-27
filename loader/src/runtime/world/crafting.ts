// The crafting identity, sent by the server as one atomic value.
//
// `synced` is false until the first `cprof` delta lands. Until then `craftSkills` is a client
// default of all zeroes, which cannot otherwise be told from a character with no craft skill.

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
   * Recipe ids this character LEARNED from a source, sorted. Not the set it can craft: a recipe
   * with no acquisition list is known to everyone and never listed here.
   */
  knownRecipes: readonly string[];
  /** Work orders inside their cooldown window, sorted. */
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
