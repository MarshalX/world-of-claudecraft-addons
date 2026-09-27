// The decoded events the game's socket carries, and what each one holds.
//
// Described from RECORDED sessions: a kind is here only if it was seen on the
// wire, and a field is optional because some records lacked it. This is a
// fraction of what the game emits; `net.onEvent` accepts any kind and hands an
// undescribed one over as `unknown`.
//
// Combat records are in `events-combat.d.ts` (an `ability` on a damage or heal
// record is a display NAME, on a cast an ID) and battleground records in
// `events-pvp.d.ts`.

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
import type {
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
} from './events-pvp.js';

/**
 * The recipient a record was routed to, when it is personal.
 *
 * Present on records delivered to one player (your progression, loot and error
 * records) and absent from world-visible ones such as a damage exchange between
 * two other entities.
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
  /**
   * Everyone in the sender's battleground, BOTH teams.
   *
   */
  | 'battleground'
  /**
   * A party or raid LEADER's alert, broadcast to every member.
   *
   * The `/pull` countdown rides this channel: see `ChatEvent.textKey`.
   *
   * Added in API minor 12.
   */
  | 'raidWarning'
  | 'guild'
  | 'officer'
  | 'world'
  | 'lfg'
  | 'emote'
  | 'roll';

/**
 * One chat line.
 *
 * The sender's class and title ride the record because a world or guild line can
 * come from a player with no local entity.
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
  /**
   * A stable id for a GENERATED line, where `text` is the English of it.
   *
   * Unlike `text`, it does not change with locale or rewording. A line a PLAYER
   * typed never carries one, so presence means the game said it.
   *
   * A translation key, so treat the set as open. The `/pull` countdown is
   * `'hudChrome.pullTimer.start'` with `{ seconds }`, then
   * `'hudChrome.pullTimer.countdown'` with `{ seconds }` at 5, 4, 3, 2 and 1,
   * then `'hudChrome.pullTimer.pull'`, or `'hudChrome.pullTimer.cancel'` if the
   * leader called it off. All four arrive on the `'raidWarning'` channel.
   *
   * Added in API minor 12.
   */
  textKey?: string;
  /**
   * What the game would interpolate into `textKey`'s template, when it has any.
   *
   * Read these rather than the rendered `text`: `{ seconds: 5 }` is a number in
   * any language.
   *
   * Added in API minor 12.
   */
  textValues?: Record<string, string | number>;
}

/**
 * You died, carrying the recap the game builds its death screen from.
 *
 * The two fields are independent: fall damage has `killerAbility` and no
 * `killerId`, and an unresolved cause leaves both absent.
 */
export interface PlayerDeathEvent extends PersonalEvent {
  type: 'playerDeath';
  /**
   * The entity that landed the kill, BY ID rather than by name.
   *
   * Resolve it through `world.entities`; it can name an entity that has already
   * left your interest scope. Absent for an untracked source.
   */
  killerId?: number;
  /**
   * What killed you, as raw English, and a CAUSE rather than only an ability:
   * environmental damage arrives here as 'Falling'.
   *
   * A display label, not an id: `world.abilities.byName` maps it back for an
   * ability you know.
   */
  killerAbility?: string;
}

export interface RespawnEvent extends PersonalEvent {
  type: 'respawn';
}

/**
 * A refused action, with the game's own already-composed line.
 *
 * `text` is the only field every refusal carries, and the one to display.
 * `code`, `channel` and `retryAfterSeconds` ride only a SERVER-authored refusal
 * (currently the General chat quota), so expect them absent: a sim refusal (out
 * of range, target dead, bags full) carries none.
 */
export interface ErrorEvent extends PersonalEvent {
  type: 'error';
  text: string;
  /**
   * The sim's own coarse label, currently only `'target_dead'`. Unrelated to
   * `code`.
   */
  reason?: string;
  /**
   * A stable identity for a server-authored refusal, safe to branch on where
   * `text` is not.
   *
   * Added in API minor 6.
   */
  code?: string;
  /** Which chat channel the refusal is about, on a chat refusal. Added in API minor 6. */
  channel?: string;
  /**
   * Seconds until the same action is worth trying again, on a refusal that is a
   * rate limit rather than a rejection. Added in API minor 6.
   */
  retryAfterSeconds?: number;
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
  /**
   * This harvest spent the LAST charge of the slotted tool effect.
   *
   * Present, and only ever true, on that one harvest; absent on every other.
   */
  effectDepleted?: true;
}

/**
 * What a gather attempt was aimed at.
 *
 * A corpse is gated on your best tool tier across every gathering profession,
 * so `professionId` is absent on a corpse refusal.
 */
export type GatherSurface = 'node' | 'corpse' | 'fishing';

/**
 * The server refused a gather, and why.
 *
 * The server's own answer, so it corrects a wrong local model. Ids and numbers
 * only: the line the player reads is yours to compose.
 */
export interface GatherDeniedEvent extends PersonalEvent {
  type: 'gatherDenied';
  surface: GatherSurface;
  /** The tool tier the target needs. */
  requiredTier: number;
  /** Set for a node and for fishing. Absent for a corpse, which spans them all. */
  professionId?: string;
  /**
   * The proficiency at which a tool you ALREADY CARRY would work this target.
   *
   * Present exactly when a tool covering `requiredTier` is in your bags and only
   * proficiency is short ("more practice"). Absent means the tool is what is
   * missing ("a better pick").
   */
  wieldProficiency?: number;
}

/**
 * A gathering tool was used with nothing in range to use it on.
 *
 * The one refusal a node panel could have prevented.
 */
export interface GatherToolNoNodeEvent extends PersonalEvent {
  type: 'gatherToolNoNode';
  professionId: string;
}

/**
 * A yield arrived in a lesser form than it was rolled in, because the bags were full.
 *
 * `mark` means the units landed without your signature. `find` means a bonus was
 * dropped outright. The game reports neither anywhere else.
 *
 * At most one per harvest command, even when several yields downgrade.
 */
export interface GatherDowngradeEvent extends PersonalEvent {
  type: 'gatherDowngrade';
  surface: 'node' | 'corpse';
  lost: 'mark' | 'find';
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
  gatherDenied: GatherDeniedEvent;
  gatherToolNoNode: GatherToolNoNodeEvent;
  gatherDowngrade: GatherDowngradeEvent;
  bank: OpenWindowEvent;
  mailbox: OpenWindowEvent;
  bgQueued: BgQueuedEvent;
  bgUnqueued: BgUnqueuedEvent;
  bgProposed: BgProposedEvent;
  bgProposalUpdate: BgProposalUpdateEvent;
  bgFound: BgFoundEvent;
  bgCountdown: BgCountdownEvent;
  bgStart: BgStartEvent;
  bgFlag: BgFlagEvent;
  bgKill: BgKillEvent;
  bgTimeWarning: BgTimeWarningEvent;
  bgEnd: BgEndEvent;
}

export type KnownEventKind = keyof EventPayloads;

/**
 * Any kind at all.
 *
 * Open because the game emits far more kinds than are described here.
 */
export type EventKind = KnownEventKind | (string & Record<never, never>);

/** The record a kind delivers, or `unknown` for a kind not described here. */
export type EventPayload<K> = K extends KnownEventKind ? EventPayloads[K] : unknown;
