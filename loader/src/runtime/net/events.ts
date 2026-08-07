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

import type { School } from '../world/game-types.ts';

/** Set when the server routed this record to one player rather than to everyone. */
interface PersonalEvent {
  pid?: number;
}

/** `evade` is a leashing wild mob refusing the hit, and always lands at amount 0. */
type DamageKind = 'hit' | 'miss' | 'dodge' | 'parry' | 'block' | 'resist' | 'evade';

interface DamageEvent extends PersonalEvent {
  type: 'damage';
  sourceId: number;
  targetId: number;
  amount: number;
  crit: boolean;
  school: School;
  /** A display NAME, or null for an auto-attack. Never an ability id. */
  ability: string | null;
  /** A PLAYER ability's id, on the primary direct hit. Null on a mob, tick or echo. */
  abilityId?: string | null;
  kind: DamageKind;
  /** Not present on any of 205 records in the session this was written from. */
  absorbed?: number;
  attackAnimationStarted?: boolean;
}

interface Heal2Event extends PersonalEvent {
  type: 'heal2';
  sourceId: number;
  targetId: number;
  amount: number;
  crit: boolean;
  /** A display NAME. `abilityId` is the id. */
  ability: string;
  /** What a heal-absorb shield ate. Direct heals only, and absent rather than 0. */
  absorbed?: number;
  hot?: boolean;
  abilityId?: string;
  /** Carries no healing. Consumers skip on this flag, never on the amount. */
  cueOnly?: boolean;
  /**
   * Healing lost to the missing-hp clamp, absent rather than 0, and computed
   * after absorb so it never double-counts with `absorbed`.
   *
   * PARTIAL ONLY: every emit site still gates on `healed > 0`, so a tick that
   * fully overheals emits no record at all and cannot be reported here.
   */
  overheal?: number;
}

/**
 * An effect arriving or leaving. The four attribution fields ride the
 * `Sim.applyAura` path only, so every one of them is optional at the consumer.
 */
interface AuraEvent extends PersonalEvent {
  type: 'aura';
  targetId: number;
  name: string;
  gained: boolean;
  auraKind?: string;
  /** The caster's entity id. */
  sourceId?: number;
  /** The aura's own id, and the only route to a MOB ability's id at event time. */
  abilityId?: string;
  stacks?: number;
  /** A same-id same-name re-application, which emits no fade of its own. */
  refresh?: boolean;
}

interface DeathEvent extends PersonalEvent {
  type: 'death';
  entityId: number;
  killerId: number;
}

/** A player or pet cast, or an ACTIVITY sentinel. A mob never emits one. */
interface CastStartEvent extends PersonalEvent {
  type: 'castStart';
  entityId: number;
  /** An ID here, unlike the display name on a damage record, or a sentinel. */
  ability: string;
  time: number;
  gatherNodeType?: string;
}

interface CastStopEvent extends PersonalEvent {
  type: 'castStop';
  entityId: number;
  success: boolean;
}

interface SpellFxEvent extends PersonalEvent {
  type: 'spellfx';
  sourceId: number;
  targetId: number;
  school: School;
  fx: string;
  /** An ID, on the effects whose visual varies per ability. */
  ability?: string;
  duration?: number;
  range?: number;
  angle?: number;
  level?: number;
  attackAnimation?: 'ranged-shot';
  wand?: true;
}

interface SpellFxAtEvent extends PersonalEvent {
  type: 'spellfxAt';
  x: number;
  z: number;
  school: School;
  fx: string;
  /** An ID, on the ground casts that have authored art of their own. */
  ability?: string;
  radius?: number;
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

interface ErrorEvent extends PersonalEvent {
  type: 'error';
  text: string;
  reason?: string;
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
  bank: OpenWindowEvent;
  mailbox: OpenWindowEvent;
}

type KnownEventKind = keyof EventPayloads;

/** Open, so a kind the catalogue does not describe is still a legal call. */
type EventKind = KnownEventKind | (string & Record<never, never>);

type EventPayload<K> = K extends KnownEventKind ? EventPayloads[K] : unknown;

export type {
  AuraEvent,
  CastStartEvent,
  CastStopEvent,
  ChatChannel,
  ChatEvent,
  DamageEvent,
  DamageKind,
  DeathEvent,
  DeedUnlockedEvent,
  ErrorEvent,
  EventKind,
  EventPayload,
  EventPayloads,
  GatherResultEvent,
  Heal2Event,
  LearnAbilityEvent,
  LogEvent,
  LootEvent,
  OpenWindowEvent,
  PersonalEvent,
  PlayerDeathEvent,
  QuestAcceptedEvent,
  RespawnEvent,
  SpellFxAtEvent,
  SpellFxEvent,
  VendorEvent,
  XpEvent,
};
