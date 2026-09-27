// The ground around the player: what is lethal on it, and what died on it. The loot rights rule
// here is a REIMPLEMENTATION of a game rule; the death zones are a client-side event mirror.
//
// The game's `riftBossDeathZones()` is safe to call: online it only reads, unlike
// `drainEvents()`, which empties its queue. The offline sim returns its live array by reference,
// which is why `toDeathZone` copies.

import { fieldArray, fieldNumber, fieldValue, isRecord } from '../net/frames.ts';
import type { LootSlot } from './corpse-types.ts';
import type { Entity } from './game-types.ts';

/**
 * One lethal ring on a rift boss floor, counting down to its detonation.
 *
 * Not a `Hazard`: it is mirrored on the client from a spawn event, with no id, inner radius or
 * original duration. It is also incomplete: a zone that spawned before you were in range is
 * never in this list.
 */
interface DeathZone {
  x: number;
  z: number;
  radius: number;
  /** Seconds until it detonates. Always above 0: an expired zone is not returned. */
  remaining: number;
}

/** What one corpse holds, and what YOU could take off it. */
interface CorpseView {
  /** The entity this describes. */
  entityId: number;
  /** Every slot the wire carried, including slots reserved for other players. */
  all: readonly LootSlot[];
  /** Only the slots you could take, by the game's own three-arm rule. */
  mine: readonly LootSlot[];
  /** Copper you could take. 0 without shared rights, even when the corpse holds some. */
  copper: number;
  /** Whether the tap lock lets you take the shared pool at all. */
  sharedRights: boolean;
  /** The first player to damage it, which is who owns the shared pool. Null when untapped. */
  tappedBy: number | null;
  /** The owner lock has lapsed, so anyone may take the shared pool. */
  ffa: boolean;
  /**
   * The loot window has elapsed, so NOBODY can open this corpse, whatever the rights. The corpse
   * stays in `world.entities` with its whole `loot` record, so this is the only signal. `mine`
   * is empty and `copper` 0 when set; `all` still reports what the wire carried.
   */
  decayed: boolean;
  /**
   * The player who already took the profession harvest, null when nobody has. Says nothing about
   * whether the corpse was harvestable at all.
   */
  harvestClaimedBy: number | null;
}

/**
 * Who is looking, for the rights rule. Internal: the backend threads it to the projection.
 */
interface LootViewer {
  pid: number | null;
  partyPids: readonly number[];
}

/** The game's own zone reader, as this project claims it to be. */
interface DeathZoneSource {
  riftBossDeathZones: () => unknown;
}

const NO_VIEWER: LootViewer = Object.freeze({ pid: null, partyPids: Object.freeze([]) });

/**
 * An absent `lootFfaTimer` is a lock still HELD, or an unread corpse would offer its shared
 * pool to anybody. Online the field is a flag expanded to a number, so it is read, not published.
 */
const LOCK_HELD = Number.POSITIVE_INFINITY;

/**
 * An unreadable `corpseTimer` is a corpse still INSIDE its window. This deliberately differs
 * from the client's default of 0, which reads as decayed and would blank a live corpse's loot.
 * Online the field is a 0-or-1 sentinel despite its name, so it is read, not published.
 */
const WINDOW_OPEN = 1;

function deathZoneSource(world: unknown): DeathZoneSource | null {
  if (!isRecord(world)) {
    return null;
  }
  const { riftBossDeathZones } = world;
  if (typeof riftBossDeathZones !== 'function') {
    return null;
  }
  return world as unknown as DeathZoneSource;
}

/**
 * One ring, copied field by field so no addon can mutate the offline sim's live array, or null.
 * Every field is required: defaulting a coordinate to 0 would put a ring at the world origin.
 */
function toDeathZone(entry: unknown): DeathZone | null {
  const x = fieldNumber(entry, 'x');
  const z = fieldNumber(entry, 'z');
  const radius = fieldNumber(entry, 'radius');
  const remaining = fieldNumber(entry, 'remaining');
  if (x === null || z === null || radius === null || remaining === null) {
    return null;
  }
  return { x, z, radius, remaining };
}

/** Every pid on the local player's party roster, self included as the game builds it. */
function partyPidsOf(world: unknown): readonly number[] {
  const pids: number[] = [];
  for (const member of fieldArray(fieldValue(world, 'partyInfo'), 'members')) {
    const pid = fieldNumber(member, 'pid');
    if (pid !== null) {
      pids.push(pid);
    }
  }
  return pids;
}

/**
 * The game's `hasSharedLootRights`, reimplemented. The LOCAL roster grants rights only when it
 * contains the tapper, since party membership is symmetric.
 */
function hasSharedRights(viewer: LootViewer, tappedById: number | null, ffa: boolean): boolean {
  if (ffa || tappedById === null) {
    return true;
  }
  if (viewer.pid === null) {
    return false;
  }
  if (tappedById === viewer.pid) {
    return true;
  }
  return viewer.partyPids.includes(tappedById) && viewer.partyPids.includes(viewer.pid);
}

/**
 * The three arms of the game's loot loop, in its order: personal, open-to-all, shared pool. An
 * EMPTY `personalFor` still takes the first arm and yields nothing, as in the game.
 */
function isTakeable(slot: unknown, pid: number | null, sharedRights: boolean): boolean {
  const personalFor = fieldValue(slot, 'personalFor');
  if (Array.isArray(personalFor)) {
    return pid !== null && (personalFor as readonly unknown[]).includes(pid);
  }
  const count = fieldNumber(slot, 'count') ?? 0;
  if (fieldValue(slot, 'openToAll') === true) {
    return count > 0;
  }
  return sharedRights && count > 0;
}

/**
 * The game's `corpseHasDecayed`. Both halves are required: the timer is also 0 on a living mob.
 */
function hasDecayed(entity: unknown): boolean {
  if (fieldValue(entity, 'dead') !== true) {
    return false;
  }
  return (fieldNumber(entity, 'corpseTimer') ?? WINDOW_OPEN) <= 0;
}

/**
 * Copper is part of the shared pool, so no rights means none of it is yours, and
 * a decayed corpse means none of it is anyone's.
 */
function takeableCopper(loot: unknown, sharedRights: boolean, decayed: boolean): number {
  if (decayed || !sharedRights) {
    return 0;
  }
  return fieldNumber(loot, 'copper') ?? 0;
}

/** The slots this viewer could take, which is none of them once the window has elapsed. */
function takeableSlots(
  all: readonly LootSlot[],
  viewer: LootViewer,
  sharedRights: boolean,
  decayed: boolean,
): readonly LootSlot[] {
  if (decayed) {
    return [];
  }
  return all.filter((slot) => isTakeable(slot, viewer.pid, sharedRights));
}

/** Who is looking, resolved off the world object. */
function viewerOf(world: unknown): LootViewer {
  const pid = fieldNumber(fieldValue(world, 'player'), 'id');
  if (pid === null) {
    return NO_VIEWER;
  }
  return { pid, partyPids: partyPidsOf(world) };
}

/**
 * Every lethal ring down on this floor. Empty means nothing is down (including outside a rift);
 * null means the game member is gone or threw, which is drift.
 */
function deathZonesOf(world: unknown): readonly DeathZone[] | null {
  const source = deathZoneSource(world);
  if (source === null) {
    return null;
  }
  let answer: unknown;
  try {
    answer = source.riftBossDeathZones();
  } catch {
    // A game member can stay callable and throw; that must cost a reading, not a frame.
    return null;
  }
  if (!Array.isArray(answer)) {
    return null;
  }
  const zones: DeathZone[] = [];
  for (const entry of answer as readonly unknown[]) {
    const zone = toDeathZone(entry);
    if (zone !== null) {
      zones.push(zone);
    }
  }
  return zones;
}

/**
 * One corpse's contents filtered to what the viewer could take, or null for anything with no
 * `loot` record. That record is the corpse test: `lootable` is also set on pickups and doors.
 */
function corpseViewOf(
  entity: Entity | null,
  entityId: number,
  viewer: LootViewer,
): CorpseView | null {
  const loot = fieldValue(entity, 'loot');
  if (!isRecord(loot)) {
    return null;
  }
  const tappedBy = fieldNumber(entity, 'tappedById');
  const ffa = (fieldNumber(entity, 'lootFfaTimer') ?? LOCK_HELD) <= 0;
  const sharedRights = hasSharedRights(viewer, tappedBy, ffa);
  const decayed = hasDecayed(entity);
  const all = fieldArray(loot, 'items') as readonly LootSlot[];
  return {
    entityId,
    all,
    mine: takeableSlots(all, viewer, sharedRights, decayed),
    copper: takeableCopper(loot, sharedRights, decayed),
    sharedRights,
    tappedBy,
    ffa,
    decayed,
    harvestClaimedBy: fieldNumber(entity, 'harvestClaimedBy'),
  };
}

/**
 * Every lootable corpse in scope, keyed by entity id. Built fresh per call: a shared map would
 * let one addon's write land in what every other addon reads.
 */
function corpsesOf(
  entities: ReadonlyMap<number, Entity>,
  viewer: LootViewer,
): ReadonlyMap<number, CorpseView> {
  const corpses = new Map<number, CorpseView>();
  for (const [id, entity] of entities) {
    const view = corpseViewOf(entity, id, viewer);
    if (view !== null) {
      corpses.set(id, view);
    }
  }
  return corpses;
}

export type { CorpseView, DeathZone, LootViewer };
export { corpsesOf, corpseViewOf, deathZonesOf, viewerOf };
