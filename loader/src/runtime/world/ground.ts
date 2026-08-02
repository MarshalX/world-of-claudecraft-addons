// The ground around the player: what is lethal on it, and what died on it.
//
// Split from `derived.ts`, which holds the three readings that existed at
// v1.1.0. These mix two subjects with those: the loot rights rule is a
// REIMPLEMENTATION of a game rule rather than a reading of a game field, and the
// death zone list is a client-side event mirror rather than snapshot state.
//
// Two claims this module rests on.
//
// The game's own `riftBossDeathZones()` is SAFE to call: on the online client it
// is a read over its own array pushing into a fresh local, with no splice, no
// delete and no assignment to the field, and the game's renderer calls it on the
// same frames. That is categorically unlike `drainEvents()`, which returns the
// queue and empties it. The OFFLINE sim's implementation returns its live array
// BY REFERENCE, which is why `toDeathZone` copies rather than narrows.
//
// What publishing the zones buys is smaller than it looks, and the honest
// version is worth stating because the overstated one is easy to repeat. The
// client does NOT hold a zone it never saw spawn: its mirror starts empty and is
// only ever appended to from the spawn event, and the game's own comment accepts
// that late joiners miss an in-flight zone. So this read does not let a player
// who arrives mid-fuse see the ring. It lets an addon enabled or restarted
// mid-fight inherit every zone the CLIENT has collected this session, which is a
// real gain over an addon keeping its own list from the events and nothing more.

import { fieldArray, fieldNumber, fieldValue, isRecord } from '../net/frames.ts';
import type { LootSlot } from './corpse-types.ts';
import type { Entity } from './game-types.ts';

/**
 * One lethal ring on a rift boss floor, counting down to its detonation.
 *
 * Deliberately NOT a `Hazard`. A hazard's geometry rides the snapshot and the
 * server keeps it; a death zone is mirrored on the client from a spawn event and
 * counted down on the client's own clock, and the mirror carries no id, no inner
 * radius and no original duration. It is also INCOMPLETE in a way a hazard is
 * not: the client only ever learns about a zone from an event it was in range
 * for, so a zone placed before you entered range is not in this list and never
 * will be. The game accepts that for its own ring rendering; a display built on
 * this has to accept it too.
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
   * The player who already took the profession harvest, null when nobody has.
   *
   * Whether the corpse is harvestable AT ALL is bundled content with no served
   * manifest, so this says who claimed it and never whether there was anything
   * to claim.
   */
  harvestClaimedBy: number | null;
}

/**
 * Who is looking, for the rights rule.
 *
 * Not published: it is an argument the backend threads from the world object to
 * the projection. The party roster is the LOCAL player's, used only when it
 * contains the tapper, on the game's own grounds that party membership is
 * symmetric.
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
 * An absent countdown is a lock still HELD, which is the game's own default.
 *
 * `lootFfaTimer` is not published, because online it only ever holds 0 or this:
 * the server owns the real countdown and sends a flag, and the client expands it
 * back out. So it is read here rather than exposed, and its absence has to read
 * as "locked" or an unread corpse would offer its shared pool to anybody.
 */
const LOCK_HELD = Number.POSITIVE_INFINITY;

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
 * One ring, copied field by field, or null for an entry that is not one.
 *
 * The COPY is the point rather than the validation: the offline sim hands back
 * its own live array, so passing an entry through would hand an addon the sim's
 * internal state to mutate. All four fields are required because a zone's
 * position is its only identity, and defaulting a missing coordinate to 0 would
 * put a ring at the world origin rather than admitting the entry is unreadable.
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
 * The game's own `hasSharedLootRights`, reimplemented rather than imported.
 *
 * The roster is the LOCAL player's and is consulted only when it CONTAINS the
 * tapper, which is the game's own shortcut and its own justification: party
 * membership is symmetric, so a roster holding the tapper is the tapper's roster
 * too. A roster the tapper is not in grants nothing, which is what stops one
 * party's kill from opening to a bystander who happens to be grouped.
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
 * The three arms of the game's own loot loop, in the game's own order.
 *
 * A personal slot answers for itself and ignores the tap lock entirely, an
 * open-to-all slot is free to anyone, and everything else is the shared pool the
 * lock governs. An EMPTY `personalFor` takes the first arm and yields nothing,
 * which is the game's behaviour too: an array is truthy there whatever is in it.
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

/** Copper is part of the shared pool, so no rights means none of it is yours. */
function takeableCopper(loot: unknown, sharedRights: boolean): number {
  if (!sharedRights) {
    return 0;
  }
  return fieldNumber(loot, 'copper') ?? 0;
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
 * Every lethal ring down on this floor, or null when the game cannot be asked.
 *
 * Null and an empty array are different answers, and neither is "not in a rift":
 * the reader answers an empty list outside one, so empty means nothing is down
 * and null means the member the loader reads has gone, which is the drift a
 * diagnostics pane should show rather than a display quietly staying blank.
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
    // A future update can leave something callable in place that throws when
    // called. The cost of that has to be a missing reading, not a dead frame.
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
 * One corpse's contents filtered to what the viewer could take, or null.
 *
 * Null for anything carrying no `loot` record, which is the whole test for "is
 * this a corpse": the wire ships a loot list for a lootable MOB only, while
 * `lootable` itself is set on every ground pickup, dungeon exit and rift portal,
 * so filtering on that flag would report every door in the instance.
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
  const all = fieldArray(loot, 'items') as readonly LootSlot[];
  return {
    entityId,
    all,
    mine: all.filter((slot) => isTakeable(slot, viewer.pid, sharedRights)),
    copper: takeableCopper(loot, sharedRights),
    sharedRights,
    tappedBy,
    ffa,
    harvestClaimedBy: fieldNumber(entity, 'harvestClaimedBy'),
  };
}

/**
 * Every lootable corpse in scope, keyed by entity id.
 *
 * Built fresh per call rather than sharing one map, for the reason `emptyCasts`
 * gives: a shared map is a write from one addon landing in what every other
 * addon reads. The per-entity cost of the walk is one null check, which is what
 * `castsOf` already pays; only an entity that passes it has its slots filtered.
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
