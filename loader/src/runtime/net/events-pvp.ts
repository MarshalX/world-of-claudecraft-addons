// The battleground's own event kinds, as the loader claims them.
//
// Split from `events.ts` the way the combat records are, and for the same
// reason the published catalogue splits: one subject per file. Every kind here
// is PERSONAL, so each carries the `pid` `PersonalEvent` declares, and the
// server delivers one copy per match member for the kinds that describe the
// whole field rather than the reader.
//
// THESE ARE THE LIVE HALF of `world.battleground` and of the `battleground`
// member of `world.match`. That key rides at 1 Hz and is forced fresh by most
// of these; these are the moment itself. A display that wants to announce a
// capture reads the event and repaints from the key.

import type { PersonalEvent } from './events.ts';

/** Your group entered the queue. `position` is its 1-based place in the line. */
interface BgQueuedEvent extends PersonalEvent {
  type: 'bgQueued';
  position: number;
}

interface BgUnqueuedEvent extends PersonalEvent {
  type: 'bgUnqueued';
}

/** An offer opened for you. `seconds` is the whole answer window, not what is left of it. */
interface BgProposedEvent extends PersonalEvent {
  type: 'bgProposed';
  seconds: number;
}

/** One more fighter accepted the offer you are looking at. */
interface BgProposalUpdateEvent extends PersonalEvent {
  type: 'bgProposalUpdate';
  accepted: number;
}

/** A match formed and you are on `team`. 0 Crimson, 1 Azure. */
interface BgFoundEvent extends PersonalEvent {
  type: 'bgFound';
  team: number;
}

interface BgCountdownEvent extends PersonalEvent {
  type: 'bgCountdown';
  seconds: number;
}

interface BgStartEvent extends PersonalEvent {
  type: 'bgStart';
}

/** A flag play, carrying the score it produced so a feed line needs no second read. */
interface BgFlagEvent extends PersonalEvent {
  type: 'bgFlag';
  action: 'taken' | 'dropped' | 'returned' | 'captured';
  /** The flag's HOME team, which is the side that just lost or recovered it. */
  team: number;
  byName: string;
  scoreCrimson: number;
  scoreAzure: number;
}

/** One per match member per death: the kill feed both sides read. */
interface BgKillEvent extends PersonalEvent {
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
 * `secondsLeft` is the THRESHOLD rather than a live clock, so an event delivered
 * late never announces a number that has already gone stale.
 */
interface BgTimeWarningEvent extends PersonalEvent {
  type: 'bgTimeWarning';
  secondsLeft: number;
}

/**
 * The result, and the only place a rating DELTA is readable.
 *
 * `world.battleground.rating` is the new figure; the pair here is what it moved
 * from and to. `ended` says whether the match was played out, timed out, or
 * given up, which nothing else can tell apart.
 */
interface BgEndEvent extends PersonalEvent {
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

export type {
  BgCountdownEvent,
  BgEndEvent,
  BgFlagEvent,
  BgFoundEvent,
  BgKillEvent,
  BgProposalUpdateEvent,
  BgProposedEvent,
  BgQueuedEvent,
  BgStartEvent,
  BgTimeWarningEvent,
  BgUnqueuedEvent,
};
