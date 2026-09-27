// The group's shared state, the run you are inside, and a mob's hate table.
//
// Two kinds of time: a loot roll's deadline is published as seconds remaining,
// like every other timer here, and a raid lockout as an absolute epoch
// millisecond stamp, comparable with `Date.now()`.

/** What you are being asked to roll on. */
export interface LootRoll {
  rollId: number;
  itemId: string;
  /**
   * The readable name. One of the few places the game sends a name beside an
   * item id, which nothing on this API resolves.
   */
  itemName: string;
  quality: string;
  /**
   * Seconds left to answer, or null before the loader has the sim's clock.
   *
   * Null only until the first snapshot arrives. Never "no deadline".
   */
  remaining: number | null;
}

/** One candidate's live answer on an open roll. Never their number. */
export interface LootRollVote {
  pid: number;
  /** 'Unknown' for a candidate the game no longer holds. */
  name: string;
  /**
   * Null is UNDECIDED, never a pass.
   */
  choice: 'need' | 'greed' | 'pass' | null;
}

/**
 * One open roll as the whole group sees it.
 *
 * Includes rolls you are not a candidate for, unlike `rolls`.
 *
 * `votes` covers the CANDIDATES, not the party, so a member with no row was never
 * eligible. The roll NUMBER is not readable anywhere: it stays server-side until
 * resolution, when it arrives as chat text.
 */
export interface LootRollGroupStatus {
  rollId: number;
  itemId: string;
  itemName: string;
  quality: string;
  /** Seconds left, or null before the loader has the sim's clock. */
  remaining: number | null;
  votes: readonly LootRollVote[];
}

/** Who assigns threshold drops, and from which quality upward. */
export interface MasterLoot {
  enabled: boolean;
  /** The looter's pid, or 0 meaning whoever currently leads. */
  looter: number;
  threshold: string;
}

export interface GroupInfo {
  /** Rolls YOU have been asked to answer, which is not every roll in the group. */
  rolls: readonly LootRoll[];
  /**
   * Every open roll in your party with each candidate's answer. Overlaps
   * `rolls` without containing it. Empty when ungrouped.
   */
  rollStatus: readonly LootRollGroupStatus[];
  /** Null when the group is not using master loot. */
  masterLoot: MasterLoot | null;
  /**
   * Dungeon id to when its lockout expires, in epoch milliseconds.
   *
   * Absolute, not a countdown: compare against `Date.now()`. Only lockouts still
   * in force are listed.
   */
  lockouts: ReadonlyMap<string, number>;
}

/**
 * The instanced run you are inside.
 *
 * Deliberately narrow: which run, how far through, and whether it is over. The
 * rest of the game's run record (modules, objectives, affixes) changes too often
 * to promise, and is reachable through `world.raw` at your own risk.
 */
export interface RunInfo {
  delveId: string;
  tierId: string;
  /** How many modules deep, against `moduleCount`. */
  moduleIndex: number;
  moduleCount: number;
  completed: boolean;
  /** The way out is open, which is a run's real end for a player. */
  exitPortalOpen: boolean;
  /** This run rolled the richer reward, which changes what finishing is worth. */
  bountiful: boolean;
}

export interface EncounterInfo {
  /** The run in progress, or null out in the world. */
  run: RunInfo | null;
  /** Delve id to how many times you have finished it. */
  clears: ReadonlyMap<string, number>;
}

export interface ThreatRow {
  entityId: number;
  threat: number;
}

/**
 * One mob's hate table, sorted and measured against you.
 *
 * The SERVER's own threat numbers, so they agree with who the mob will hit.
 *
 * Capped at the top eight rows, so it cannot place the twentieth raider. It
 * exists only for a MOB in combat, so an empty reading means "not fighting" or
 * "not a mob", never "everyone is at zero".
 */
export interface ThreatTable {
  /** Highest first. At most eight rows, whatever the group's size. */
  rows: readonly ThreatRow[];
  /** Your own threat, or null when you are not on the table. */
  mine: number | null;
  /** The top row's threat, or null when the table is empty. */
  top: number | null;
  /**
   * Your threat as a fraction of the top, or null when either is absent.
   *
   * 1 means you ARE the top row.
   */
  share: number | null;
}
