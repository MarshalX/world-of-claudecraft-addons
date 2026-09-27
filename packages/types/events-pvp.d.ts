// The battleground's events: the live half of everything `world.battleground`
// and the `battleground` member of `world.match` report.
//
// PAINT from the key, which is complete and survives a reload; ANNOUNCE from these
// events, which are the moment (a capture, a kill, a warning, a result). A score
// summed from events drifts the first time one is missed, and a capture read off
// the key is up to a second late.
//
// Every kind here is PERSONAL and carries `pid`. The field-wide ones (`bgKill`,
// `bgTimeWarning`) are sent once per match member, so you receive them about
// other people too.
//
// Added in API minor 6.

import type { PersonalEvent } from './events.js';

/** Your group entered the queue. `position` is its 1-based place in the line. */
export interface BgQueuedEvent extends PersonalEvent {
  type: 'bgQueued';
  position: number;
}

export interface BgUnqueuedEvent extends PersonalEvent {
  type: 'bgUnqueued';
}

/**
 * A queue offer opened for you.
 *
 * `seconds` is the whole answer window; `world.battleground.proposal.remaining`
 * carries the live countdown. You cannot accept it: `net` is read-only.
 */
export interface BgProposedEvent extends PersonalEvent {
  type: 'bgProposed';
  seconds: number;
}

/** One more fighter accepted the offer you are looking at. */
export interface BgProposalUpdateEvent extends PersonalEvent {
  type: 'bgProposalUpdate';
  accepted: number;
}

/** A match formed and you are on `team`. 0 Crimson, 1 Azure. */
export interface BgFoundEvent extends PersonalEvent {
  type: 'bgFound';
  team: number;
}

export interface BgCountdownEvent extends PersonalEvent {
  type: 'bgCountdown';
  seconds: number;
}

export interface BgStartEvent extends PersonalEvent {
  type: 'bgStart';
}

/**
 * A flag play.
 *
 * Carries the score it produced, so a feed line needs no second read.
 */
export interface BgFlagEvent extends PersonalEvent {
  type: 'bgFlag';
  action: 'taken' | 'dropped' | 'returned' | 'captured';
  /** The flag's HOME team, which is the side that just lost or recovered it. */
  team: number;
  byName: string;
  scoreCrimson: number;
  scoreAzure: number;
}

/**
 * One death, delivered to every member of the match.
 *
 * Names, not ids, because the fighter may be nowhere near you: this is the one
 * channel that reports an enemy you cannot see. Resolve against `world.match`.
 */
export interface BgKillEvent extends PersonalEvent {
  type: 'bgKill';
  /** Null on an unattributed death, where no enemy took the credit. */
  killerName: string | null;
  victimName: string;
  killerTeam: number | null;
  victimTeam: number;
}

/**
 * The match clock crossed one of the game's warning thresholds.
 *
 * `secondsLeft` is the THRESHOLD, not a live clock. Read `world.match.timeLeft`
 * for the running figure.
 */
export interface BgTimeWarningEvent extends PersonalEvent {
  type: 'bgTimeWarning';
  secondsLeft: number;
}

/**
 * The result, and the only place a rating DELTA is readable.
 *
 * `ended` says whether the match reached the capture target, timed out, or was
 * forfeited, which nothing else tells apart.
 */
export interface BgEndEvent extends PersonalEvent {
  type: 'bgEnd';
  won: boolean;
  draw: boolean;
  scoreCrimson: number;
  scoreAzure: number;
  ratingBefore: number;
  ratingAfter: number;
  ended: 'caps' | 'timer' | 'forfeit';
  /** The first-win-of-the-day Honor bonus included in THIS result, or 0. */
  firstWinBonus: number;
}
