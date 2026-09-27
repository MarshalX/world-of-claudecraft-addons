// The ground around you: what is on it, what is lethal on it, and what died
// on it.
//
// A corpse's whole contents reach EVERY player in range, personal annotations
// included, so a slot naming somebody else is one you can see and cannot take.
// `world.corpseLoot()` applies the game's filter.

import type { InvSlot } from './world-items.js';

/**
 * One stack on a corpse.
 *
 * An `InvSlot` plus the personal-loot annotations, which reach every player in
 * range.
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
   * True regardless of rights, even on your own kill. The entity stays in
   * `world.entities` with its whole `loot` record while the game no longer draws
   * it, so this is the only thing that tells it from an openable corpse. `mine` is
   * empty and `copper` 0 whenever it is set; `all` still reports the wire.
   */
  decayed: boolean;
  /**
   * The player who already took the profession harvest, null when nobody has.
   *
   * Says who claimed it, never whether the corpse was harvestable at all.
   */
  harvestClaimedBy: number | null;
}

/**
 * One lethal ring on a rift boss floor, counting down to its detonation.
 *
 * Not a `Hazard`: it is mirrored from a spawn event and counted down locally,
 * with no id, no inner radius and no original duration. A zone placed before you
 * came into range is missing and stays missing, as it is in the game's own view.
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
 * Closed: a kind exists only once the loader reads the snapshot list carrying
 * it. The Ignivar and Varkhul kinds arrived in API minor 10 and the Nythraxis
 * kinds in API minor 12; declare the minor rather than feature-detecting.
 */
export type HazardKind =
  | 'frostRing'
  | 'temporalHourglass'
  /** The falling bodies Ignivar calls down, while the ground still shows a mark. */
  | 'ignivarMeteor'
  /** Varkhul's forgestorm, in the window between the warning and the wave. */
  | 'varkhulForgestorm'
  /** The meteors Varkhul's anvil strike brings down. */
  | 'varkhulAnvilMeteor'
  /**
   * A Grave Eruption warning circle, in the window before the ground bursts.
   *
   * `remaining` counts down to the burst and `duration` is the whole telegraph.
   * A circle can be in this list a moment before the game draws it.
   */
  | 'nythraxisGraveEruption'
  /**
   * Burning ground left where a Grave Eruption landed.
   *
   * The wire also has a retired Soulfire pool variant; if the game revives it,
   * it arrives under this kind too.
   */
  | 'nythraxisGraveFlame'
  /**
   * A Binding Sigil, live for as long as the raid has to drag the boss onto it.
   *
   * It lands on one of the two platforms flanking the throne, alternating every
   * cast, so consecutive sigils sit at mirrored `x`. Which side is NOT on the
   * wire: compare `x` against the previous sigil's.
   */
  | 'nythraxisBindingSigil';

/**
 * A ground effect with a position, a radius and a life.
 *
 * The only ground effects whose geometry rides the snapshot, filtered to what is
 * near you. Every other ground AoE announces itself once as a `spellfxAt` event,
 * so tracking it means keeping your own list.
 *
 * NOT HERE: Varkhul's cinder FIRES (no remaining time) and cinder ORBS (moving,
 * so the snapshot position is where the orb has been), and Nythraxis's Gravefire
 * (a travelling line, not a disc, and retired from play). A rift boss death zone
 * is a `DeathZone` on `world.deathZones`; read both lists.
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
