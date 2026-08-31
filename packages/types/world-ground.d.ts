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
   * The loot window has elapsed, so NOBODY can open this corpse any more.
   *
   * New at game 0.40.1, and the one arm of the game's own rule with no rights in
   * it: it refuses before the tap lock is looked at, so this is true even on a
   * corpse you killed yourself. The entity stays in `world.entities` carrying
   * its whole `loot` record, and the game's own renderer has already dropped it
   * from the pickable view, so this is the only thing that tells it from a
   * corpse you could walk up to and open. `mine` is empty and `copper` is 0
   * whenever it is set; `all` still reports what the wire carried.
   *
   * A display that lists corpses worth walking to has to read this, or it goes
   * on offering bodies that are no longer there to be looted.
   */
  decayed: boolean;
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

/**
 * Which ground effect a `Hazard` is.
 *
 * Closed rather than open, because a hazard is drawn from the snapshot rather
 * than named by content: a kind exists here only once the loader reads the list
 * that carries it. The last three arrived with the Ignivar and Varkhul
 * encounters in game 0.41.0, in API minor 10.
 */
export type HazardKind =
  | 'frostRing'
  | 'temporalHourglass'
  /** The falling bodies Ignivar calls down, while the ground still shows a mark. */
  | 'ignivarMeteor'
  /** Varkhul's forgestorm, in the window between the warning and the wave. */
  | 'varkhulForgestorm'
  /** The meteors Varkhul's anvil strike brings down. */
  | 'varkhulAnvilMeteor';

/**
 * A ground effect with a position, a radius and a life.
 *
 * These are the only ground effects whose geometry rides the snapshot, and they
 * arrive filtered to what is near you. Every other ground AoE announces itself
 * once as a `spellfxAt` event and then lives only in the renderer, so tracking
 * those means keeping your own list from the events.
 *
 * TWO OF VARKHUL'S OWN GROUND EFFECTS ARE NOT HERE, which is worth knowing
 * before building a display of that fight. Its cinder FIRES have no remaining
 * time at all, since they burn until the encounter puts them out, and every
 * field on this shape would have to become optional to admit one. Its cinder
 * ORBS are travelling rather than placed, so a disc drawn at the position on
 * the snapshot marks where the orb has been. Both are visible in the game's own
 * render and neither is readable as a hazard.
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
