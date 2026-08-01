// Your character sheet: progression, deeds, talents and profession skills.
//
// Split from `world.d.ts`, which describes the world around you. These are all
// reads about YOU: they ride the self payload, so they exist for your character
// and for nobody else's. There is no way to read another player's sheet.
//
// Every field here was confirmed arriving in a recorded session before it was
// published, which is the standing rule: a field earns a place because it was
// found on the wire, never because it is readable on some object.

/** The levels a talent build has rows on. */
export type TalentRowLevel = 5 | 8 | 11 | 14 | 17 | 20;

export type TalentRole = 'tank' | 'healer' | 'dps';

/** One saved build, with the action bar that went with it. */
export interface SavedLoadout {
  name: string;
  spec: string | null;
  /** Row level to the option chosen on it. A row not yet picked is absent. */
  rows: Readonly<Partial<Record<TalentRowLevel, string>>>;
  /** Null in a slot left empty. */
  bar: readonly (string | null)[];
}

/**
 * Your build.
 */
export interface TalentInfo {
  spec: string | null;
  role: TalentRole | null;
  /** Row level to the option chosen on it. A row not yet picked is absent. */
  rows: Readonly<Partial<Record<TalentRowLevel, string>>>;
  loadouts: readonly SavedLoadout[];
  /**
   * Index into `loadouts`, or -1 when none is active.
   */
  activeLoadout: number;
}

export interface DeedStats {
  /**
   * Lifetime counters, e.g. `kills`, `deaths`, `craftsPerformed`.
   *
   * A counter at 0 genuinely means it never happened, unlike most zero-valued
   * fields on this API: the client fills the whole set from defaults and the
   * server sends every counter it keeps, so nothing here is a field that is
   * merely never written.
   */
  counters: Readonly<Record<string, number>>;
  itemsDiscovered: ReadonlySet<string>;
  visited: ReadonlySet<string>;
  /** Dungeon id to final-boss clears. A heroic clear is keyed `<id>:heroic`. */
  dungeonClears: Readonly<Record<string, number>>;
}

export interface CharacterInfo {
  xp: number;
  /** Total ever earned, which keeps rising past the level cap. */
  lifetimeXp: number;
  /** The rested pool, 0 when not rested. */
  restedXp: number;
  prestigeRank: number;
  honor: number;
  lifetimeHonor: number;
  renown: number;
  /**
   * Your displayed title as a DEED ID, never display text.
   *
   * Null when untitled. Turning it into something readable needs the game's own
   * deed table, which an addon cannot reach, so this identifies the title rather
   * than spelling it.
   */
  activeTitle: string | null;
  milestones: readonly string[];
  /** Deed id to the day it was earned, or '' where the host set no calendar. */
  deeds: ReadonlyMap<string, string>;
  deedStats: DeedStats;
}

/**
 * Profession skill, as two independent counter maps.
 *
 * Deliberately narrow. The game's professions facet also carries a state view
 * and a crafting identity block, and both are marked as stubs in its own source
 * with a trail of in-flight work behind them, so their shape is the least
 * settled thing an addon could depend on. These two are plain skill counters and
 * are safe to build on.
 */
export interface ProfessionInfo {
  /** Craft id to skill. Independent and additive: gaining one never moves another. */
  craftSkills: Readonly<Record<string, number>>;
  /** Gathering profession id to proficiency, the same kind of counter. */
  gathering: Readonly<Record<string, number>>;
}
