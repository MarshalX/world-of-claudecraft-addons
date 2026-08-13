// The ground around you: what is on it, what is lethal on it, and what died
// on it.
//
// Split from `world.d.ts` by subject, the way `ui.d.ts` split. Nothing is
// re-exported through a per-domain barrel, so the split shows in the import.
//
// The one thing to know before touching `LootSlot`: a corpse's whole contents
// reach EVERY player in range, personal annotations included. The server builds
// one loot record per corpse per tick and shares it, and the game's own loot
// window filters on read. So a slot naming somebody else is a slot you can see
// and cannot take, and `world.corpseLoot()` is the filter rather than the raw
// list.

import type { InvSlot } from './world-items.js';

/**
 * One stack on a corpse.
 *
 * An `InvSlot` plus the three personal-loot annotations, all of which ride to
 * every player in range rather than only to the player they name.
 */
export interface LootSlot extends InvSlot {
  /** Entity ids that may EACH take one copy. Absent on an ordinary drop. */
  personalFor?: number[];
  /** A need-greed drop everybody passed on, now free to anyone. */
  openToAll?: boolean;
  /** One loot action by any listed player grants every listed player a copy. */
  sharedPersonal?: boolean;
}

/** What a lootable corpse holds, as the wire carries it: everything, for everyone. */
export interface CorpseLoot {
  copper: number;
  items: LootSlot[];
}

/** What one corpse holds, and what YOU could take off it. */
export interface CorpseView {
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
 * One lethal ring on a rift boss floor, counting down to its detonation.
 *
 * Deliberately NOT a `Hazard`. A hazard's geometry rides the snapshot and the
 * server keeps it; a death zone is mirrored on your client from a spawn event
 * and counted down on your own clock, and the mirror carries no id, no inner
 * radius and no original duration. It is also INCOMPLETE in a way a hazard is
 * not: your client only ever learns about a zone from an event it was in range
 * for, so a zone placed before you entered range is missing and stays missing.
 * The game's own rings have the same hole.
 */
export interface DeathZone {
  x: number;
  z: number;
  radius: number;
  /** Seconds until it detonates. Always above 0: an expired zone is not returned. */
  remaining: number;
}

export type HazardKind = 'frostRing' | 'temporalHourglass';

/**
 * A ground effect with a position, a radius and a life.
 *
 * These two are the only ground effects whose geometry rides the snapshot, and
 * they arrive filtered to what is near you. Every other ground AoE announces
 * itself once as a `spellfxAt` event and then lives only in the renderer, so
 * tracking those means keeping your own list from the events.
 *
 * A rift boss death zone is the one exception the loader closes for you, and it
 * is a `DeathZone` on `world.deathZones` rather than a third `HazardKind`. It
 * carries no id, no inner radius and no original duration, so folding it in here
 * would mean three fields that are a lie on every entry; and its list is a
 * client-side event mirror rather than snapshot state, which is a difference an
 * addon has to be able to see rather than one buried in a discriminant. Draw
 * both by reading both lists.
 */
export interface Hazard {
  id: string;
  kind: HazardKind;
  x: number;
  z: number;
  radius: number;
  /** The inner edge of a ring's safe middle. 0 when the whole disc is hot. */
  innerRadius: number;
  duration: number;
  remaining: number;
}
