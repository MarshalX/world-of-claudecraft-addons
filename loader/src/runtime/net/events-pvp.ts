// The battleground's event kinds. Every one is PERSONAL: a field-wide kind arrives once per match
// member. These are the live moments; `world.battleground` and `world.match` are the 1 Hz state,
// so announce from the event and repaint from the key.

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

/** A warning threshold crossed. `secondsLeft` is the threshold, not a live clock. */
interface BgTimeWarningEvent extends PersonalEvent {
  type: 'bgTimeWarning';
  secondsLeft: number;
}

/** The result, and the only place a rating delta or the way it ended is readable. */
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
