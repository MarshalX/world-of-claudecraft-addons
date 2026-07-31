// What each world key reports, and what the matching read returns.
//
// One declaration for both so a key can never mean two things: the read and the
// subscription are the same value by construction, which is what lets
// `world.on('casts', ...)` hand over a typed map without the addon narrowing it.
//
// It has a module of its own because it is the one place the game's own shapes
// and the loader's derived ones meet. The keys themselves stay authoritative in
// `signature.ts`, which holds the array `world.on` validates against and the
// capture behind each one; `tests/world-shape.test.ts` asserts the two agree.

import type { AbilityIndex } from './abilities.ts';
import type { CombatState } from './combat.ts';
import type { EntityCast, Hazard } from './derived.ts';
import type { Aura, Entity, InvSlot, PartyInfo, WorldQuests } from './game-types.ts';

export interface WorldValues {
  player: Entity | null;
  target: Entity | null;
  entities: ReadonlyMap<number, Entity>;
  party: PartyInfo | null;
  inventory: readonly InvSlot[] | null;
  quests: WorldQuests | null;
  cooldowns: ReadonlyMap<string, number> | null;
  auras: readonly Aura[] | null;
  /** Entity id to what it is casting, for everything in interest scope. */
  casts: ReadonlyMap<number, EntityCast>;
  /** The current target's effects. Null when nothing is targeted. */
  targetAuras: readonly Aura[] | null;
  hazards: readonly Hazard[] | null;
  /** Entity id to raid target marker, 0 through 7. */
  markers: ReadonlyMap<number, number> | null;
  /**
   * The player's own spellbook, with lookups by id and by display name.
   *
   * Never null, like `entities` and `casts` and unlike the rest: it is a lookup
   * surface, and making every call site guard the namespace before asking it a
   * question would be a null check per event in a combat handler. Empty until
   * the world is up.
   */
  abilities: AbilityIndex;
  /**
   * Whether the player is fighting, with the signal that answered.
   *
   * Never null, like `abilities` and `casts`: it is a derived reading rather
   * than a value the game hands over, so before the world exists it is simply
   * inactive rather than unknown.
   */
  combat: CombatState;
}
