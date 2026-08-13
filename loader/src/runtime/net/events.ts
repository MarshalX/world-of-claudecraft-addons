// What each decoded event kind carries, as the loader claims it.
//
// A CLAIM about the game, like `world/game-types.ts`, and deliberately written
// separately from `packages/types/events.d.ts` rather than imported from it. The
// published package describes this file's behaviour and nothing links the two,
// so importing one into the other would make `tests/types-parity.test.ts`
// trivially true and remove the only thing that catches them drifting.
//
// The prose lives in the published copy, which is what an author reads. This one
// carries the shapes and the notes a maintainer needs.
//
// The combat records are in `events-combat.ts`, the same split the published
// catalogue makes. `EventPayloads` below is the one map over both files.

import type {
  AuraEvent,
  CastStartEvent,
  CastStopEvent,
  DamageEvent,
  DeathEvent,
  Heal2Event,
  SpellFxAtEvent,
  SpellFxEvent,
} from './events-combat.ts';

/** Set when the server routed this record to one player rather than to everyone. */
interface PersonalEvent {
  pid?: number;
}

interface XpEvent extends PersonalEvent {
  type: 'xp';
  amount: number;
  rested?: number;
}

interface LearnAbilityEvent extends PersonalEvent {
  type: 'learnAbility';
  abilityId: string;
  rank: number;
}

/** The game's own composed line. No item id rides it. */
interface LootEvent extends PersonalEvent {
  type: 'loot';
  text: string;
  silent?: boolean;
  callerLogs?: boolean;
}

interface VendorEvent extends PersonalEvent {
  type: 'vendor';
  action: 'buy' | 'sell' | 'buyback';
  /** Absent on the bulk junk sweep. */
  itemId?: string;
}

interface DeedUnlockedEvent extends PersonalEvent {
  type: 'deedUnlocked';
  deedId: string;
  retro?: boolean;
}

interface QuestAcceptedEvent extends PersonalEvent {
  type: 'questAccepted';
  questId: string;
}

type ChatChannel =
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

/** Class and title ride the record: the sender may be outside interest scope. */
interface ChatEvent extends PersonalEvent {
  type: 'chat';
  fromPid: number;
  from: string;
  text: string;
  channel?: ChatChannel;
  entityId?: number;
  to?: string;
  fromTitle?: string;
  classId?: string;
}

interface PlayerDeathEvent extends PersonalEvent {
  type: 'playerDeath';
  /** Absent for an untracked source, so a recap cannot assume it has one. */
  killerId?: number;
  /** Raw English, and a CAUSE rather than only an ability: 'Falling' rides here. */
  killerAbility?: string;
}

interface RespawnEvent extends PersonalEvent {
  type: 'respawn';
}

/**
 * A refused action.
 *
 * `text` is the only field every refusal carries. The three optional ones ride a
 * SERVER-authored refusal alone (the General chat quota is the whole set today),
 * so a refusal raised by the sim carries none of them, and neither does one from
 * a server older than game 0.37.1. `reason` is the sim's own label and is a
 * different field from `code`.
 */
interface ErrorEvent extends PersonalEvent {
  type: 'error';
  text: string;
  reason?: string;
  code?: string;
  channel?: string;
  retryAfterSeconds?: number;
}

interface LogEvent extends PersonalEvent {
  type: 'log';
  text: string;
  color?: string;
  entityId?: number;
  telegraph?: boolean;
}

interface GatherResultEvent extends PersonalEvent {
  type: 'gatherResult';
  nodeId: string;
  nodeType: string;
  professionId: string;
  itemId: string;
  rarity: string;
  qty: number;
  /** Null rather than absent when nothing special happened. */
  rareEvent: string | null;
  /** Only on the harvest that spent the slotted tool effect's LAST charge. */
  effectDepleted?: true;
}

/** What a gather refusal was aimed at. A corpse is gated across every profession. */
type GatherSurface = 'node' | 'corpse' | 'fishing';

interface GatherDeniedEvent extends PersonalEvent {
  type: 'gatherDenied';
  surface: GatherSurface;
  requiredTier: number;
  /** Set for a node and for fishing, absent for a corpse, which spans them all. */
  professionId?: string;
  /** Set only when a COVERING tool is carried and the proficiency is what is short. */
  wieldProficiency?: number;
}

interface GatherToolNoNodeEvent extends PersonalEvent {
  type: 'gatherToolNoNode';
  professionId: string;
}

interface GatherDowngradeEvent extends PersonalEvent {
  type: 'gatherDowngrade';
  surface: 'node' | 'corpse';
  /** `mark` kept the units and lost the signature; `find` dropped a bonus outright. */
  lost: 'mark' | 'find';
}

interface OpenWindowEvent extends PersonalEvent {
  type: 'bank' | 'mailbox';
}

interface EventPayloads {
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
}

type KnownEventKind = keyof EventPayloads;

/** Open, so a kind the catalogue does not describe is still a legal call. */
type EventKind = KnownEventKind | (string & Record<never, never>);

type EventPayload<K> = K extends KnownEventKind ? EventPayloads[K] : unknown;

export type {
  ChatChannel,
  ChatEvent,
  DeedUnlockedEvent,
  ErrorEvent,
  EventKind,
  EventPayload,
  EventPayloads,
  GatherDeniedEvent,
  GatherDowngradeEvent,
  GatherResultEvent,
  GatherSurface,
  GatherToolNoNodeEvent,
  LearnAbilityEvent,
  LogEvent,
  LootEvent,
  OpenWindowEvent,
  PersonalEvent,
  PlayerDeathEvent,
  QuestAcceptedEvent,
  RespawnEvent,
  VendorEvent,
  XpEvent,
};
