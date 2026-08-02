// The group's shared state, the run you are inside, and a mob's hate table.
//
// Three readings that are about the situation rather than about you, split from
// `world.d.ts` because they carry enough explanation to crowd it.
//
// They also carry this API's two kinds of time between them, and the difference
// is worth reading once. A loot roll's deadline is on the SIM clock, seconds
// since the world started, which nothing hands an addon, so it is published as
// seconds remaining like every other timer here. A raid lockout is an absolute
// epoch millisecond stamp, and is published exactly as sent, because that is the
// one form that survives a reconnect and is directly comparable with `Date.now()`.

/** What you are being asked to roll on. */
export interface LootRoll {
  rollId: number;
  itemId: string;
  /**
   * The readable name.
   *
   * Worth noticing: an item id resolves to nothing on this API, and a loot roll
   * is one of the few places the game sends a name beside one.
   */
  itemName: string;
  quality: string;
  /**
   * Seconds left to answer, or null before the loader has the sim's clock.
   *
   * Null only in the window between an addon starting and the first snapshot
   * arriving. It is not "no deadline": every roll has one.
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
   *
   * The distinction is the whole reason to draw a vote strip: a member who has
   * not answered is what a group is waiting on, and one who passed is done.
   */
  choice: 'need' | 'greed' | 'pass' | null;
}

/**
 * One open roll as the whole group sees it.
 *
 * The complement of `rolls`, which carries only what YOU were asked to answer.
 * This carries every open roll your party is voting on, including ones you are
 * not a candidate for, with each candidate's answer as it lands.
 *
 * `votes` covers the CANDIDATES rather than the party, so a member with no row
 * was never eligible for the item. The roll NUMBER is not here and is not
 * anywhere: it stays server-side until resolution, when it arrives as composed
 * chat text.
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
   * Every open roll in your party with each candidate's answer.
   *
   * `rolls` is what you were asked; this is what the group is doing about it,
   * and the two overlap rather than nest. Empty when ungrouped.
   */
  rollStatus: readonly LootRollGroupStatus[];
  /** Null when the group is not using master loot, rather than a disabled record. */
  masterLoot: MasterLoot | null;
  /**
   * Dungeon id to when its lockout expires, in epoch milliseconds.
   *
   * Absolute rather than a countdown, which is how the server sends it and is
   * the point of it: compare against `Date.now()`. Only lockouts still in force
   * are listed.
   */
  lockouts: ReadonlyMap<string, number>;
}

/**
 * The instanced run you are inside.
 *
 * Deliberately narrow. The game's own run record also carries its module list,
 * objective state, affixes, rite state and spawn origin, and all of that is
 * content that moves faster than anything else this API reads: an addon written
 * against the wide shape would break on a game update to a corner of it nobody
 * was using. What is here answers which run this is, how far through it you are,
 * and whether it is over. The rest is reachable through `world.raw`, at your own
 * risk, which is what that escape hatch is for.
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
 * These are the SERVER's own threat numbers rather than anything derived on the
 * client, which is what makes them worth having: they mean what the game means
 * by them, so a display built on them agrees with the decision the mob is about
 * to make about who to hit.
 *
 * Two limits. The table is capped at its top eight rows, so it can tell you who
 * is about to pull and cannot tell you where the twentieth person in a raid
 * stands. And it exists only for a MOB in combat, so an empty reading means "not
 * fighting" or "not a mob", never "everyone is at zero".
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
   * 1 means you ARE the top row. It is the reading rather than arithmetic at
   * your call site because the interesting question is never the raw number: it
   * is how close you are to pulling.
   */
  share: number | null;
}
