// Thornhollow Fields: the ranked 5v5 capture-the-flag battleground.
//
// The game sends it as `bgInfo`, sharing nothing with the arena's shape.
//
// Split like the arena: the standings and ladder churn whenever anyone finishes a match, so
// folding them into `match` would fire `world.on('match')` for a stranger's game.
// `readBattleground` answers `world.battleground`; `battlegroundOf` is one member of the
// `world.match` union.
//
// The match member does not extend `BoutBase`: its combatants carry a `level` this roster never
// sends, and filling it with 0 would publish a field nothing writes.
//
// The server never sends an enemy fighter's position, health, auras or casts past the ordinary
// interest radii. `dead` is the one match-wide piece of enemy state.

import { fieldArray, fieldNumber, fieldString, fieldValue } from '../net/frames.ts';

/** Team ids, which are also the index of each side's own score, flag and wave. */
const CRIMSON = 0;
const AZURE = 1;

/** One row of the live ladder: rated champions currently online, best first. */
interface BgLadderRow {
  pid: number;
  name: string;
  cls: string;
  rating: number;
  wins: number;
  losses: number;
  /** Matches that ended level. */
  draws: number;
}

/**
 * A queue-pop offer awaiting your answer. Anonymous by design: counts, never names. An addon
 * cannot answer it, since accepting is a send.
 */
interface BgProposal {
  id: number;
  /**
   * A backfill is ONE unrated seat in a match already under way. An unrecognised kind reads as
   * 'match'.
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
 * Your record, your queue and the live ladder. Present for every character, queued or not.
 * Refreshed at 1 Hz, and immediately on every queue, offer, match, flag and kill transition.
 */
interface BattlegroundStandings {
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  /** Career flag captures, across every match. */
  captures: number;
  queued: boolean;
  /** Champions waiting across all groups, not just yours. */
  queueSize: number;
  /** The size of your own queued group. */
  queuedParty: number;
  /** The first win of the day still has its Honor bonus unclaimed. */
  firstWinBonusReady: boolean;
  /** Whole seconds until you may queue again after letting an offer lapse, 0 when clear. */
  requeueIn: number;
  proposal: BgProposal | null;
  /** Rated champions currently ONLINE, best first, at most ten. */
  ladder: readonly BgLadderRow[];
}

/** Where one team's flag is, and who has it. */
interface BgFlag {
  state: 'home' | 'carried' | 'dropped';
  carrierPid: number | null;
  carrierName: string | null;
  /** The carrier's team, which is the side the flag is being taken TO. */
  carrierTeam: number | null;
}

/** One fighter, on either side. No health: the server does not send enemy health. */
interface BgFighter {
  pid: number;
  name: string;
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
 * The battleground you are fighting in, as one member of the `world.match` union. `state`
 * publishes the wire's 'ended' as 'over', matching the other formats.
 */
interface BattlegroundMatch {
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
  /** Whole seconds left in the form-up gate, or in the end hold. */
  countdown: number;
  /** Whole seconds until the match cap resolves on score. */
  timeLeft: number;
  /** Whole seconds to each team's next respawn wave, indexed by team. */
  waveIn: readonly [number, number];
  /** Your own wait, while you stand released as a ghost. 0 otherwise. */
  respawnIn: number;
  /** Set once the match is over: the winning team, or null for a draw. */
  winner: number | null;
}

function numberAt(rows: readonly unknown[], at: number): number {
  const value = rows[at];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return 0;
}

/** A per-team pair, whatever the wire carried. Both sides always have an entry. */
function pairOf(source: unknown, key: string): readonly [number, number] {
  const rows = fieldArray(source, key);
  return [numberAt(rows, CRIMSON), numberAt(rows, AZURE)];
}

/**
 * An unrecognised flag state reads as 'home', the state that draws nothing; guessing 'carried'
 * would draw a carrier that is not there.
 */
function flagState(state: string | null): BgFlag['state'] {
  if (state === 'carried' || state === 'dropped') {
    return state;
  }
  return 'home';
}

function flagOf(flag: unknown): BgFlag {
  return {
    state: flagState(fieldString(flag, 'state')),
    carrierPid: fieldNumber(flag, 'carrierPid'),
    carrierName: fieldString(flag, 'carrierName'),
    carrierTeam: fieldNumber(flag, 'carrierTeam'),
  };
}

function flagsOf(match: unknown): readonly [BgFlag, BgFlag] {
  const rows = fieldArray(match, 'flags');
  return [flagOf(rows[CRIMSON]), flagOf(rows[AZURE])];
}

function fightersOf(match: unknown): readonly BgFighter[] {
  return fieldArray(match, 'players').map((row) => ({
    pid: fieldNumber(row, 'pid') ?? 0,
    name: fieldString(row, 'name') ?? '',
    cls: fieldString(row, 'cls') ?? '',
    team: fieldNumber(row, 'team') ?? CRIMSON,
    carrying: fieldValue(row, 'carrying') === true,
    dead: fieldValue(row, 'dead') === true,
    kills: fieldNumber(row, 'kills') ?? 0,
    deaths: fieldNumber(row, 'deaths') ?? 0,
    captures: fieldNumber(row, 'captures') ?? 0,
    assists: fieldNumber(row, 'assists') ?? 0,
  }));
}

function matchState(state: string | null): BattlegroundMatch['state'] {
  if (state === 'countdown') {
    return state;
  }
  if (state === 'ended') {
    return 'over';
  }
  return 'active';
}

function ladderOf(rows: readonly unknown[]): readonly BgLadderRow[] {
  return rows.map((row) => ({
    pid: fieldNumber(row, 'pid') ?? 0,
    name: fieldString(row, 'name') ?? '',
    cls: fieldString(row, 'cls') ?? '',
    rating: fieldNumber(row, 'rating') ?? 0,
    wins: fieldNumber(row, 'wins') ?? 0,
    losses: fieldNumber(row, 'losses') ?? 0,
    draws: fieldNumber(row, 'draws') ?? 0,
  }));
}

function proposalKind(kind: string | null): BgProposal['kind'] {
  if (kind === 'backfill') {
    return kind;
  }
  return 'match';
}

function proposalResponse(response: string | null): BgProposal['myResponse'] {
  if (response === 'accepted') {
    return response;
  }
  return 'pending';
}

function proposalOf(proposal: unknown): BgProposal | null {
  if (proposal === null) {
    return null;
  }
  return {
    id: fieldNumber(proposal, 'id') ?? 0,
    kind: proposalKind(fieldString(proposal, 'kind')),
    size: fieldNumber(proposal, 'size') ?? 0,
    accepted: fieldNumber(proposal, 'accepted') ?? 0,
    myResponse: proposalResponse(fieldString(proposal, 'myResponse')),
    remaining: fieldNumber(proposal, 'remaining') ?? 0,
  };
}

/**
 * The battleground in progress, or null when the player is in none. Only `match.ts` calls this.
 */
function battlegroundOf(world: unknown): BattlegroundMatch | null {
  const match = fieldValue(fieldValue(world, 'bgInfo'), 'match');
  if (match === null) {
    return null;
  }
  return {
    format: 'battleground',
    state: matchState(fieldString(match, 'state')),
    myTeam: fieldNumber(match, 'myTeam') ?? CRIMSON,
    capsToWin: fieldNumber(match, 'capsToWin') ?? 0,
    scores: pairOf(match, 'scores'),
    flags: flagsOf(match),
    fighters: fightersOf(match),
    countdown: fieldNumber(match, 'countdown') ?? 0,
    timeLeft: fieldNumber(match, 'timeLeft') ?? 0,
    waveIn: pairOf(match, 'waveIn'),
    respawnIn: fieldNumber(match, 'respawnIn') ?? 0,
    winner: fieldNumber(match, 'winner'),
  };
}

/**
 * Your record, queue and ladder, or null before the key has arrived. Only `world.match` says a
 * match is on.
 */
function readBattleground(world: unknown): BattlegroundStandings | null {
  const info = fieldValue(world, 'bgInfo');
  if (info === null) {
    return null;
  }
  return {
    rating: fieldNumber(info, 'rating') ?? 0,
    wins: fieldNumber(info, 'wins') ?? 0,
    losses: fieldNumber(info, 'losses') ?? 0,
    draws: fieldNumber(info, 'draws') ?? 0,
    captures: fieldNumber(info, 'captures') ?? 0,
    queued: fieldValue(info, 'queued') === true,
    queueSize: fieldNumber(info, 'queueSize') ?? 0,
    queuedParty: fieldNumber(info, 'queuedParty') ?? 0,
    firstWinBonusReady: fieldValue(info, 'firstWinBonusReady') === true,
    requeueIn: fieldNumber(info, 'requeueIn') ?? 0,
    proposal: proposalOf(fieldValue(info, 'proposal')),
    ladder: ladderOf(fieldArray(info, 'ladder')),
  };
}

export type {
  BattlegroundMatch,
  BattlegroundStandings,
  BgFighter,
  BgFlag,
  BgLadderRow,
  BgProposal,
};
export { battlegroundOf, readBattleground };
