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

import { DEBUFF_AURA_KINDS, UNDISPELLABLE_AURA_IDS } from '../../shared/aura-kinds.generated.ts';
import type { Aura } from './game-types.ts';
import type { PartyMemberAura } from './party-types.ts';

interface AuraQuery {
  /** The applying ability's id. */
  id?: string;
  /** What the effect does, e.g. 'dot' or 'stun'. */
  kind?: string;
  /** Only effects the player applied. Needs a player id to mean anything. */
  mine?: boolean;
  /** True for harmful effects only, false for beneficial only, absent for both. */
  harmful?: boolean;
}

interface PartyAuraQuery {
  id?: string;
  kind?: string;
  /**
   * True for debuffs only, false for buffs only, absent for both.
   *
   * Runs the game's own classification rather than reading the row's `neg` flag,
   * which is a SIGN test on a magnitude and not a polarity: a dot carries a
   * positive per-tick figure and a root carries 0, so neither ever sets it.
   */
  debuff?: boolean;
}

/** The prefix the game reuses for a stat aura, whichever direction it points. */
const BUFF_PREFIX = 'buff_';
/** The one school no dispel reaches, in either direction. */
const PHYSICAL = 'physical';

const NONE: readonly Aura[] = Object.freeze([]);
const NO_ROWS: readonly PartyMemberAura[] = Object.freeze([]);

/**
 * Whether an effect works AGAINST the unit carrying it.
 *
 * A PREDICATE rather than a field on the aura, and that is forced rather than
 * chosen: the loader hands addons the game's OWN aura objects (`readAs` is a
 * cast, `world.entities` is a view), so a `harmful` field could only be written
 * by mutating game state the HUD reads from the same array, or by copying every
 * aura on every read, which allocates per aura per frame and destroys the
 * identity an addon uses to track one effect across frames.
 *
 * The game's own rule, in two clauses. A kind in the harmful set is harmful
 * whatever its magnitude, and a `buff_*` kind whose magnitude went negative is a
 * drain reusing the buff kind. The second clause is NOT redundant with the
 * first: `debuff_ap` is the authored drain and is in the set, while a mob sapping
 * attack power with an ordinary `buff_ap` of negative value is not, so a set-only
 * implementation answers correctly for every authored debuff and wrongly for
 * every drain, which is the failure mode that looks fine in testing.
 *
 * It takes either shape. A full aura carries a signed `value`; a party row
 * carries no value at all and carries `neg`, which the server sets from that
 * same sign and nothing else, so the answer for a row is the same function
 * rather than an approximation of it.
 *
 * `value` is used RAW, because the second clause is a sign test. Anything that
 * rounds, clamps or takes a magnitude on the way here reclassifies every drain
 * in the game as a benefit, silently and only for drains.
 */
function isHarmful(aura: Pick<Aura, 'kind'> & { value?: number; neg?: 1 }): boolean {
  if (DEBUFF_AURA_KINDS.has(aura.kind)) {
    return true;
  }
  if (!aura.kind.startsWith(BUFF_PREFIX)) {
    return false;
  }
  return aura.neg === 1 || (aura.value ?? 0) < 0;
}

/**
 * Whether an effect can be removed, and in which direction.
 *
 * Six clauses, all the game's (`isDispellableAura` and `isPlayerRemovableAura`
 * in src/sim/aura_classify.ts): not one of the ids the game refuses outright,
 * not permanent, not unbreakable control, not an undispellable penalty, not the
 * physical school, and the polarity the direction asks for. `offensive` strips a
 * BENEFIT off an enemy; the other direction strips a harmful effect off an ally.
 * `UNDISPELLABLE_AURA_IDS` is generated from that file by `pnpm aura-kinds`, never
 * transcribed by hand.
 *
 * THE ONE CLAUSE THIS CANNOT IMPLEMENT is `encounterOwned`, added at game
 * 0.41.0 and checked by the game ahead of all of these. It is a Varkhul and
 * Ignivar raid mechanic and `wireAura` never sends it (server/
 * snapshot_timer_wire.ts:508 emits `perm`, `ub`, `und` and `bt` and nothing
 * else), so no client can tell one from an ordinary effect. This therefore
 * answers TRUE for an encounter-owned mechanic the game will refuse. Reading
 * the flag off the aura would be reading a field that is never present; the
 * only fix is the game sending it. On a game release, diff the game's FUNCTION
 * against this one rather than checking that the fields it reads still exist: a
 * predicate that is too generous costs a global cooldown and never fails a test.
 *
 * Deliberately takes the FULL aura only. A party row carries neither a school
 * nor these flags, and those are the clauses whose absence costs a player a
 * global cooldown, so a row is refused rather than answered optimistically.
 */
function isDispellable(aura: Aura, offensive: boolean): boolean {
  if (UNDISPELLABLE_AURA_IDS.has(aura.id)) {
    return false;
  }
  if (aura.permanent === true || aura.undispellable === true) {
    return false;
  }
  if (aura.unbreakableControl === true || aura.school === PHYSICAL) {
    return false;
  }
  const harmful = isHarmful(aura);
  if (offensive) {
    return !harmful;
  }
  return harmful;
}

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
  if (query.harmful !== undefined && query.harmful !== isHarmful(aura)) {
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
  if (query.debuff !== undefined && query.debuff !== isHarmful(aura)) {
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
export { filterAuras, filterPartyAuras, isDispellable, isHarmful, NO_ROWS, NONE };
