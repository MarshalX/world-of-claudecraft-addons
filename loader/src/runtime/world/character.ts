// The character sheet: progression, deeds, talents and profession skills.
//
// Every field here rides the self payload and was confirmed present in a
// recorded session, which is what earns it a place: the standing rule is that a
// field is published because it was found on the WIRE, never because it is
// readable on the client object.
//
// One member of the game's own professions facet is deliberately left out.
// `professionsState` is marked as a stub in the game's source and carries a
// trail of in-flight issue numbers, so its shape is the least settled thing in
// reach. `craftingIdentity` was left out for the same reason and no longer is:
// the server sends it as one atomic value and every field on it is a scalar or a
// sorted id array, and it carries the `synced` flag that says whether the craft
// skill counters beside it are real zeroes or a client-side default nothing has
// filled in yet. See `crafting.ts`.

import { fieldArray, fieldNumber, fieldString, fieldValue } from '../net/frames.ts';
import { type CraftingIdentity, readCraftingIdentity } from './crafting.ts';

/** The rows a talent build fills in, which are levels rather than indexes. */
type TalentRowLevel = 5 | 8 | 11 | 14 | 17 | 20;

type TalentRole = 'tank' | 'healer' | 'dps';

interface SavedLoadout {
  name: string;
  spec: string | null;
  rows: Readonly<Partial<Record<TalentRowLevel, string>>>;
  /** The action bar saved with the build. Null in a slot left empty. */
  bar: readonly (string | null)[];
}

interface TalentInfo {
  spec: string | null;
  role: TalentRole | null;
  /** Row level to the option chosen on it. A row not yet picked is absent. */
  rows: Readonly<Partial<Record<TalentRowLevel, string>>>;
  loadouts: readonly SavedLoadout[];
  /** Index into `loadouts`, or -1 when none is active. */
  activeLoadout: number;
}

interface DeedStats {
  /** Lifetime counters, e.g. `kills`. A counter at 0 genuinely means none. */
  counters: Readonly<Record<string, number>>;
  itemsDiscovered: ReadonlySet<string>;
  visited: ReadonlySet<string>;
  /** Dungeon id to final-boss clears. A heroic clear is keyed `<id>:heroic`. */
  dungeonClears: Readonly<Record<string, number>>;
}

interface CharacterInfo {
  xp: number;
  /** Total ever earned, which keeps rising past the level cap. */
  lifetimeXp: number;
  /** The rested pool, 0 when not rested. */
  restedXp: number;
  prestigeRank: number;
  honor: number;
  lifetimeHonor: number;
  renown: number;
  /** A deed id, never display text. Null when untitled. */
  activeTitle: string | null;
  milestones: readonly string[];
  /** Deed id to the day it was earned, or '' where the host set no calendar. */
  deeds: ReadonlyMap<string, string>;
  deedStats: DeedStats;
}

interface ProfessionInfo {
  /**
   * Craft id to skill. Independent, additive counters.
   *
   * All-zero until `identity.synced`, which is why the flag is published: the
   * client fills this from a default and the server's first `cprof` replaces it.
   */
  craftSkills: Readonly<Record<string, number>>;
  /** Gathering profession id to proficiency, the same kind of counter. */
  gathering: Readonly<Record<string, number>>;
  /** Archetype, pairs, and what has been learned. Read `identity.synced` first. */
  identity: CraftingIdentity;
  /** The active mobile station's craft id, or null when none is placed. */
  mobileStation: string | null;
}

const NO_STATS: DeedStats = Object.freeze({
  counters: Object.freeze({}),
  itemsDiscovered: new Set<string>(),
  visited: new Set<string>(),
  dungeonClears: Object.freeze({}),
});

function numberAt(source: unknown, field: string): number {
  return fieldNumber(source, field) ?? 0;
}

function recordAt(source: unknown, field: string): Readonly<Record<string, number>> {
  const value = fieldValue(source, field);
  if (value === null || typeof value !== 'object') {
    return {};
  }
  return value as Record<string, number>;
}

function stringsAt(source: unknown, field: string): readonly string[] {
  return fieldArray(source, field).filter((one): one is string => typeof one === 'string');
}

function setAt(source: unknown, field: string): ReadonlySet<string> {
  const value = fieldValue(source, field);
  if (value instanceof Set) {
    return value as Set<string>;
  }
  return new Set<string>();
}

function deedStatsOf(world: unknown): DeedStats {
  const stats = fieldValue(world, 'deedStats');
  if (stats === null) {
    return NO_STATS;
  }
  return {
    counters: recordAt(stats, 'counters'),
    itemsDiscovered: setAt(stats, 'itemsDiscovered'),
    visited: setAt(stats, 'visited'),
    dungeonClears: recordAt(stats, 'dungeonClears'),
  };
}

function deedsOf(world: unknown): ReadonlyMap<string, string> {
  const earned = fieldValue(world, 'deedsEarned');
  if (earned instanceof Map) {
    return earned as Map<string, string>;
  }
  return new Map<string, string>();
}

/** The whole character sheet, or null before the game carries one. */
function readCharacter(world: unknown): CharacterInfo | null {
  if (world === null) {
    return null;
  }
  return {
    xp: numberAt(world, 'xp'),
    lifetimeXp: numberAt(world, 'lifetimeXp'),
    restedXp: numberAt(world, 'restedXp'),
    prestigeRank: numberAt(world, 'prestigeRank'),
    honor: numberAt(world, 'honor'),
    lifetimeHonor: numberAt(world, 'lifetimeHonor'),
    renown: numberAt(world, 'renown'),
    activeTitle: fieldString(world, 'activeTitle'),
    milestones: stringsAt(world, 'unlockedMilestones'),
    deeds: deedsOf(world),
    deedStats: deedStatsOf(world),
  };
}

function rowsOf(alloc: unknown): Readonly<Partial<Record<TalentRowLevel, string>>> {
  const rows = fieldValue(alloc, 'rows');
  if (rows === null || typeof rows !== 'object') {
    return {};
  }
  return rows as Partial<Record<TalentRowLevel, string>>;
}

/** A saved bar slot holds an ability id or nothing at all. */
function barSlot(slot: unknown): string | null {
  if (typeof slot === 'string') {
    return slot;
  }
  return null;
}

function loadoutsOf(world: unknown): readonly SavedLoadout[] {
  return fieldArray(world, 'loadouts').map((saved) => ({
    name: fieldString(saved, 'name') ?? '',
    spec: fieldString(fieldValue(saved, 'alloc'), 'spec'),
    rows: rowsOf(fieldValue(saved, 'alloc')),
    bar: fieldArray(saved, 'bar').map(barSlot),
  }));
}

function readTalents(world: unknown): TalentInfo | null {
  if (world === null) {
    return null;
  }
  return {
    spec: fieldString(world, 'talentSpec'),
    role: fieldString(world, 'talentRole') as TalentRole | null,
    rows: rowsOf(fieldValue(world, 'talents')),
    loadouts: loadoutsOf(world),
    activeLoadout: fieldNumber(world, 'activeLoadout') ?? -1,
  };
}

function readProfessions(world: unknown): ProfessionInfo | null {
  if (world === null) {
    return null;
  }
  return {
    craftSkills: recordAt(world, 'craftSkills'),
    gathering: recordAt(world, 'gatheringProficiency'),
    identity: readCraftingIdentity(world),
    mobileStation: fieldString(world, 'activeMobileStationCraft'),
  };
}

export type {
  CharacterInfo,
  DeedStats,
  ProfessionInfo,
  SavedLoadout,
  TalentInfo,
  TalentRole,
  TalentRowLevel,
};
export { readCharacter, readProfessions, readTalents };
