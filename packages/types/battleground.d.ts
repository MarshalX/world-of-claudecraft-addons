// Thornhollow Fields: the ranked 5v5 capture-the-flag battleground.
//
// Split from `match.d.ts` for the reason `arena.d.ts` is: the record and the
// live ladder churn whenever any rated champion anywhere finishes a match, and
// folding them into `match` would fire `world.on('match')` because a stranger
// won a game. So the match itself is one member of the `world.match` union and
// everything else is `world.battleground`.
//
// THE MATCH MEMBER DOES NOT EXTEND `BoutBase`. That base carries `allies` and
// `enemies` as `MatchCombatant`, and a combatant carries a `level` this mode's
// roster does not send. Publishing a level here would mean publishing a field
// nothing ever writes. The roster is one `fighters` list carrying each side's
// team instead, which is what the server sends and what `flags` is indexed by.
//
// WHAT YOU CANNOT READ HERE IS ENFORCED, NOT MISSING. An enemy fighter's
// position, health, auras and casts never reach your client past the ordinary
// interest radii: the mode's raised match-wide radius covers your own team plus
// the field's props, and the roster carries no health at all. `dead` is the one
// piece of enemy state that is match-wide, and it is deliberate, because the
// respawn wave clock already tells both sides the same thing. An addon that
// appeared to offer an enemy's position or health would be wrong.
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
   * Counted only since the game began counting them, so an older character reads
   * 0 rather than a number nobody recorded.
   */
  draws: number;
}

/**
 * A queue offer waiting for your answer.
 *
 * Anonymous by design: counts, never names. The ten have not been introduced
 * yet, and a decline must not leak who was on the other side.
 *
 * IT CANNOT BE ANSWERED FROM AN ADDON. Accepting is a send and `net` is
 * read-only. What you can do is announce that an offer is open, say which kind
 * it is, and count its seconds down. The Accept and Decline stay the player's,
 * in the game's own prompt.
 */
export interface BgProposal {
  id: number;
  /**
   * A backfill is ONE SEAT in a match already under way.
   *
   * It is unrated for whoever takes it and it inherits a scoreline they had no
   * part in, which is the whole reason the game distinguishes it: the prompt is
   * the only surface that can say so before the answer is given. Say it too.
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
 * Present for every character, queued or not, so a non-null reading says nothing
 * about whether the player has ever fought one. Only `world.match` says a match
 * is on.
 *
 * REFRESHED AT 1 Hz, and forced fresh the moment anything transitions: queueing
 * and unqueueing, an offer opening or gaining an acceptance, a match being
 * found, starting or ending, and every flag play and every kill. So it is a slow
 * readout that jumps to instant on exactly the events worth acting on, which
 * makes it a far better feed than the arena's ten seconds. The `bg*` events are
 * the moment itself.
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
   * This is the join worth making: it is an entity id, so a display that also
   * reads `world.entities` can mark the carrier on the carrier, which is the
   * single most actionable mark in a capture-the-flag mode. It resolves only
   * while the carrier is in interest scope, which for an enemy means only when
   * they are close enough to see.
   */
  carrierPid: number | null;
  carrierName: string | null;
  /** The carrier's team, which is the side the flag is being taken TO. */
  carrierTeam: number | null;
}

/**
 * One fighter, on either side.
 *
 * `dead` is match-wide and is the ONLY enemy state that is. There is no health
 * here and there will not be: see this file's header.
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
 * This is where an enemy PLAYER is identified, and it is the only place: a
 * player entity never carries `hostile`, which the server sets on mobs alone, so
 * a display that reads that flag paints every opponent in the game friendly.
 * Compare each fighter's `team` against `myTeam` instead.
 *
 * `state` reads 'over' where this mode's own wire says 'ended', so one
 * vocabulary covers every format a display might switch on.
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
   * Public to both sides on purpose: a defender counting bodies learns nothing
   * from `dead` they could not derive from this clock.
   */
  waveIn: readonly [number, number];
  /** Your own wait, while you stand released as a ghost. 0 otherwise. */
  respawnIn: number;
  /** Set once the match is over: the winning team, or null for a draw. */
  winner: number | null;
}
