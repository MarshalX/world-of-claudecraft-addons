// Thornhollow Fields: the ranked 5v5 capture-the-flag battleground.
//
// The match itself is one member of the `world.match` union; the record and the
// ladder are `world.battleground`, so a stranger's result does not fire
// `world.on('match')`.
//
// WHAT YOU CANNOT READ HERE IS ENFORCED, NOT MISSING. An enemy fighter's
// position, health, auras and casts reach your client only within the ordinary
// interest radius, and the roster carries no health. `dead` is the one
// match-wide piece of enemy state.
//
// Added in API minor 6.

/** One row of the live ladder: rated champions currently online, best first. */
export interface BgLadderRow {
  pid: number;
  name: string;
  /** The class id, such as 'hunter'. */
  cls: string;
  rating: number;
  wins: number;
  losses: number;
  /**
   * Matches that ended level.
   *
   * An older character can read 0 for draws the game never counted.
   */
  draws: number;
}

/**
 * A queue offer waiting for your answer.
 *
 * Anonymous by design: counts, never names.
 *
 * IT CANNOT BE ANSWERED FROM AN ADDON: `net` is read-only. Announce it, say
 * which kind it is, and count it down; Accept and Decline stay in the game's
 * prompt.
 */
export interface BgProposal {
  id: number;
  /**
   * A backfill is ONE SEAT in a match already under way.
   *
   * Unrated, and it inherits the scoreline. Worth saying on screen before the
   * player answers.
   *
   * An unrecognised kind reads as 'match', the ordinary offer.
   */
  kind: 'match' | 'backfill';
  /** Fighters the offer needs: both teams in full, or 1 for a backfill. */
  size: number;
  /** How many have accepted so far. */
  accepted: number;
  myResponse: 'pending' | 'accepted';
  /** Whole seconds left to answer. */
  remaining: number;
}

/**
 * Your battleground record, your queue and the live ladder.
 *
 * Present for every character, so non-null says nothing about playing. Only
 * `world.match` says a match is on.
 *
 * REFRESHED AT 1 Hz, and immediately on every transition: queueing, an offer
 * opening or gaining an acceptance, a match found, starting or ending, every
 * flag play and every kill. The `bg*` events are the moment itself.
 */
export interface BattlegroundStandings {
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  /** Career flag captures, across every match. */
  captures: number;
  queued: boolean;
  /** Champions waiting across all groups, not only yours. */
  queueSize: number;
  /** The size of your own queued group. */
  queuedParty: number;
  /** The first win of the day still has its Honor bonus unclaimed. */
  firstWinBonusReady: boolean;
  /** Whole seconds until you may queue again after letting an offer lapse. 0 when clear. */
  requeueIn: number;
  proposal: BgProposal | null;
  /** Rated champions currently ONLINE, best first, at most ten. */
  ladder: readonly BgLadderRow[];
}

/** Where one team's flag is, and who has it. */
export interface BgFlag {
  state: 'home' | 'carried' | 'dropped';
  /**
   * The carrier's entity id, or null when nobody has it.
   *
   * An entity id, so it joins `world.entities` to mark the carrier in the world.
   * It resolves only while the carrier is in interest scope, which for an enemy
   * means close enough to see.
   */
  carrierPid: number | null;
  carrierName: string | null;
  /** The carrier's team, which is the side the flag is being taken TO. */
  carrierTeam: number | null;
}

/**
 * One fighter, on either side.
 *
 * `dead` is the ONLY match-wide enemy state. There is no health, and no
 * `level`, which is why this mode does not use `MatchCombatant`.
 */
export interface BgFighter {
  pid: number;
  name: string;
  /** The class id, such as 'hunter'. */
  cls: string;
  /** 0 Crimson, 1 Azure. Compare against `BattlegroundMatch.myTeam`. */
  team: number;
  carrying: boolean;
  dead: boolean;
  kills: number;
  deaths: number;
  captures: number;
  /** Killing blows helped land without finishing. */
  assists: number;
}

/**
 * The battleground you are fighting in, as one member of `world.match`.
 *
 * The only place an enemy PLAYER is identified: a player entity never carries
 * `hostile`, which is set on mobs alone. Compare each fighter's `team` against
 * `myTeam`.
 *
 * `state` reads 'over' where the wire says 'ended', to match the other formats.
 */
export interface BattlegroundMatch {
  format: 'battleground';
  state: 'countdown' | 'active' | 'over';
  /** 0 Crimson, 1 Azure. */
  myTeam: number;
  capsToWin: number;
  /** [Crimson, Azure]. */
  scores: readonly [number, number];
  /** Indexed by the flag's HOME team, so `flags[myTeam]` is the one you defend. */
  flags: readonly [BgFlag, BgFlag];
  /** Both sides in one list. Split it on `team` against `myTeam`. */
  fighters: readonly BgFighter[];
  /** Whole seconds left in the form-up gate, or in the hold after the result. */
  countdown: number;
  /** Whole seconds until the match cap resolves on score. */
  timeLeft: number;
  /**
   * Whole seconds to each team's next respawn wave, indexed by team.
   *
   * Public to both sides.
   */
  waveIn: readonly [number, number];
  /** Your own wait, while you stand released as a ghost. 0 otherwise. */
  respawnIn: number;
  /** Set once the match is over: the winning team, or null for a draw. */
  winner: number | null;
}
