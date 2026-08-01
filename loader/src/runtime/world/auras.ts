// Filtering auras, on an entity and on a party row.
//
// Three filters get written by every addon that watches effects, and one of them
// is the difference between a working dot tracker and a broken one: "is MY dot
// on this target" is not the same question as "is this dot on this target",
// because two hunters in a group both apply the same debuff and only one of them
// refreshes it. `sourceId` is what separates them, and an addon that forgets it
// shows a full timer while its own dot expires.
//
// A party row's auras are a DIFFERENT and much smaller shape than an entity's:
// an id, a kind, a whole-second remaining, and a `neg` flag for a debuff. No
// source, no stacks, no duration. So the two filters cannot be one function, and
// the query a row accepts is deliberately narrower than the entity one rather
// than accepting `mine` and quietly ignoring it.

import type { Aura, PartyMemberAura } from './game-types.ts';

interface AuraQuery {
  /** The applying ability's id. */
  id?: string;
  /** What the effect does, e.g. 'dot' or 'stun'. */
  kind?: string;
  /** Only effects the player applied. Needs a player id to mean anything. */
  mine?: boolean;
}

interface PartyAuraQuery {
  id?: string;
  kind?: string;
  /** True for debuffs only, false for buffs only, absent for both. */
  debuff?: boolean;
}

const NONE: readonly Aura[] = Object.freeze([]);
const NO_ROWS: readonly PartyMemberAura[] = Object.freeze([]);

function matches(aura: Aura, query: AuraQuery, playerId: number | null): boolean {
  if (query.id !== undefined && aura.id !== query.id) {
    return false;
  }
  if (query.kind !== undefined && aura.kind !== query.kind) {
    return false;
  }
  // A null player id cannot answer "mine", and answering it anyway would mean
  // reporting every aura as the player's before world entry.
  if (query.mine === true && (playerId === null || aura.sourceId !== playerId)) {
    return false;
  }
  return true;
}

function rowMatches(aura: PartyMemberAura, query: PartyAuraQuery): boolean {
  if (query.id !== undefined && aura.id !== query.id) {
    return false;
  }
  if (query.kind !== undefined && aura.kind !== query.kind) {
    return false;
  }
  if (query.debuff !== undefined && query.debuff !== (aura.neg === 1)) {
    return false;
  }
  return true;
}

/**
 * The effects on an entity that match, in the game's own order.
 *
 * An empty query returns everything, so a caller filtering on nothing does not
 * have to special-case the call.
 */
function filterAuras(
  auras: readonly Aura[] | null,
  query: AuraQuery,
  playerId: number | null,
): readonly Aura[] {
  if (auras === null) {
    return NONE;
  }
  return auras.filter((aura) => matches(aura, query, playerId));
}

/** The same over a party row's compact strip, which carries no source at all. */
function filterPartyAuras(
  auras: readonly PartyMemberAura[] | undefined,
  query: PartyAuraQuery,
): readonly PartyMemberAura[] {
  if (auras === undefined) {
    return NO_ROWS;
  }
  return auras.filter((aura) => rowMatches(aura, query));
}

export type { AuraQuery, PartyAuraQuery };
export { filterAuras, filterPartyAuras, NO_ROWS, NONE };
