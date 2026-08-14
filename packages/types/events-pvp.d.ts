// The battleground's events: the live half of everything `world.battleground`
// and the `battleground` member of `world.match` report.
//
// Split from `events.d.ts` the way the combat records are, because a catalogue
// is one subject per file.
//
// THE DIVISION OF LABOUR IS WORTH GETTING RIGHT. The key is the state: the
// score, the flags, the roster, the clocks, and it is what a display should
// PAINT from, because it is complete and it survives a reload. These events are
// the MOMENT: a capture, a kill, a warning, a result. Announce from the event
// and repaint from the key. An addon that tries to keep its own score by adding
// up events will drift the first time one is missed; one that polls the key for
// a capture will announce it up to a second late.
//
// Every kind here is PERSONAL, so each carries `pid`. The ones that describe the
// whole field rather than you (`bgKill`, `bgTimeWarning`) are sent as one copy
// per match member, so you receive them about other people too.
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
 * `seconds` is the whole answer window rather than what is left of it, so a
 * countdown starts from here and continues on `world.battleground.proposal`,
 * which carries the live `remaining`. You cannot accept it: that is a send, and
 * `net` is read-only.
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
 * It carries the score it produced, so a feed line needs no second read and
 * cannot print a score from before the capture it is announcing.
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
 * Names rather than ids, because the fighter may be nowhere near you: this is
 * the one channel that reports an enemy you cannot see. `world.match` carries
 * the roster to resolve them against.
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
 * `secondsLeft` is the THRESHOLD rather than a live clock, so an event that
 * arrives late never announces a number that has already gone stale. Read
 * `world.match.timeLeft` for the running figure.
 */
export interface BgTimeWarningEvent extends PersonalEvent {
  type: 'bgTimeWarning';
  secondsLeft: number;
}

/**
 * The result, and the only place a rating DELTA is readable.
 *
 * `world.battleground.rating` is the new figure and this is what it moved from
 * and to. `ended` says whether the match was played out to the capture target,
 * timed out on the clock, or given up, which nothing else can tell apart.
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
