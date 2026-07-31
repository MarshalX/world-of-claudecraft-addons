// The decoded events the game's socket carries, and what each one holds.
//
// Written against a RECORDED session rather than against the game's own type
// declarations. The two disagree silently and have already done so in both
// directions, so a kind is described here only if it was seen on the wire, and a
// field is optional because it was ABSENT from some of the records that carried
// it rather than because a declaration called it optional.
//
// What is here is a fraction of what the game can emit, and nothing was taken
// away by narrowing: `net.onEvent` still accepts any kind, and one that is not
// described hands the handler `unknown`, which is what every kind did before
// this file existed.
//
// The combat records live in `events-combat.d.ts`. They carry two traps worth
// knowing before writing a handler: an `ability` on a damage or heal record is a
// display NAME while an `ability` on a cast is an ID, and a `heal2` record
// flagged `cueOnly` carries no healing at all.

import type {
  AuraEvent,
  CastStartEvent,
  CastStopEvent,
  DamageEvent,
  DeathEvent,
  Heal2Event,
  SpellFxAtEvent,
  SpellFxEvent,
} from './events-combat.js';

/**
 * The recipient a record was routed to, when it is personal.
 *
 * The server delivers some events to one player rather than to everyone nearby
 * and stamps those with the recipient. It is on your own progression, loot and
 * error records, and absent from world-visible ones such as a damage exchange
 * between two other entities.
 */
export interface PersonalEvent {
  pid?: number;
}

export interface XpEvent extends PersonalEvent {
  type: 'xp';
  amount: number;
  /** The rested bonus inside `amount`. Absent when none applied. */
  rested?: number;
}

export interface LearnAbilityEvent extends PersonalEvent {
  type: 'learnAbility';
  abilityId: string;
  rank: number;
}

/**
 * Something entered your bags.
 *
 * `text` is the game's own line, already composed. There is no item id on this
 * record, so it cannot tell you WHAT arrived; watch `world.inventory` for that.
 */
export interface LootEvent extends PersonalEvent {
  type: 'loot';
  text: string;
  /** The grant's caller owns the sound, so the default cue is suppressed. */
  silent?: boolean;
  /** The caller prints its own richer line, so the default text is suppressed. */
  callerLogs?: boolean;
}

export interface VendorEvent extends PersonalEvent {
  type: 'vendor';
  action: 'buy' | 'sell' | 'buyback';
  /** Absent on the bulk junk sweep, which is a plain refresh signal. */
  itemId?: string;
}

export interface DeedUnlockedEvent extends PersonalEvent {
  type: 'deedUnlocked';
  deedId: string;
  /** Set on the back-credit pass at login, so a batch can be summarised. */
  retro?: boolean;
}

export interface QuestAcceptedEvent extends PersonalEvent {
  type: 'questAccepted';
  questId: string;
}

export type ChatChannel =
  | 'say'
  | 'yell'
  | 'whisper'
  | 'general'
  | 'party'
  | 'guild'
  | 'officer'
  | 'world'
  | 'lfg'
  | 'emote'
  | 'roll';

/**
 * One chat line.
 *
 * The sender's class and title ride the record rather than being read off their
 * entity, and the reason is worth knowing: a line in a world or guild channel
 * reaches you from players far outside your interest scope, where no entity for
 * them exists locally at all.
 */
export interface ChatEvent extends PersonalEvent {
  type: 'chat';
  fromPid: number;
  from: string;
  text: string;
  channel?: ChatChannel;
  /** The speaker's entity, when they are near enough to have one. */
  entityId?: number;
  /** Set on the sender's echo of their own whisper. */
  to?: string;
  /** A deed id, never display text. Absent for an untitled speaker. */
  fromTitle?: string;
  /** The sender's class id. Absent on a mob or boss yell. */
  classId?: string;
}

export interface PlayerDeathEvent extends PersonalEvent {
  type: 'playerDeath';
}

export interface RespawnEvent extends PersonalEvent {
  type: 'respawn';
}

/** A refused action, with the game's own already-composed line. */
export interface ErrorEvent extends PersonalEvent {
  type: 'error';
  text: string;
  reason?: string;
}

/** A line for the game's own log. `color` is a CSS colour the game chose. */
export interface LogEvent extends PersonalEvent {
  type: 'log';
  text: string;
  color?: string;
  /** Anchors the line to an entity, which is what scopes it to players nearby. */
  entityId?: number;
  /** Marks an actionable mechanic cue rather than ambient flavour. */
  telegraph?: boolean;
}

export interface GatherResultEvent extends PersonalEvent {
  type: 'gatherResult';
  nodeId: string;
  nodeType: string;
  professionId: string;
  itemId: string;
  rarity: string;
  qty: number;
  /** Null rather than absent when the harvest triggered nothing special. */
  rareEvent: string | null;
}

/** Asks the client to open a window. Carries nothing else. */
export interface OpenWindowEvent extends PersonalEvent {
  type: 'bank' | 'mailbox';
}

/** Every kind this catalogue describes, mapped to the record it delivers. */
export interface EventPayloads {
  damage: DamageEvent;
  heal2: Heal2Event;
  aura: AuraEvent;
  death: DeathEvent;
  castStart: CastStartEvent;
  castStop: CastStopEvent;
  spellfx: SpellFxEvent;
  spellfxAt: SpellFxAtEvent;
  xp: XpEvent;
  learnAbility: LearnAbilityEvent;
  loot: LootEvent;
  vendor: VendorEvent;
  deedUnlocked: DeedUnlockedEvent;
  questAccepted: QuestAcceptedEvent;
  chat: ChatEvent;
  playerDeath: PlayerDeathEvent;
  respawn: RespawnEvent;
  error: ErrorEvent;
  log: LogEvent;
  gatherResult: GatherResultEvent;
  bank: OpenWindowEvent;
  mailbox: OpenWindowEvent;
}

export type KnownEventKind = keyof EventPayloads;

/**
 * Any kind at all.
 *
 * Open for the reason the cue and icon unions are open: the set is content, the
 * game emits far more kinds than are described here, and a published type must
 * never be able to reject a working addon.
 */
export type EventKind = KnownEventKind | (string & Record<never, never>);

/** The record a kind delivers, or `unknown` for a kind not described here. */
export type EventPayload<K> = K extends KnownEventKind ? EventPayloads[K] : unknown;
