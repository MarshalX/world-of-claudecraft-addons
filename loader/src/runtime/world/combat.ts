// Whether the player is in combat, and how confidently the loader knows it.
//
// The self record carries no combat flag. `inCombat` exists on the client entity
// and the server never writes it, which is the trap this project already paid
// for once: an addon read it, saw false for a whole session, and concluded every
// fight had ended on every hit.
//
// So it is answered from things the server DOES send, in falling order of
// confidence, and the answer says which one replied. That is the whole reason
// `source` is not optional: two of these branches are the server's own opinion
// and one is a timer, and an addon that wants to trust the reading has to be
// able to tell them apart. `ConflictReport` carries its source for the same
// reason, and this is the same kind of honesty about a partial answer.
//
//  party  the party row for the player. The server sets inCombat per member, so
//         when the player is grouped this is simply the answer.
//  threat a nearby mob's hate table contains the player. Server state again: the
//         table rides the wire only for a living mob in combat, and the player is
//         in it only because the server put them there.
//  pvp    a hostile PLAYER has the player selected. A player carries a real
//         targetId, unlike a mob, so this reads the field that is actually set.
//  recent damage involving the player landed inside the idle window. The only
//         branch that can be wrong, and the last one consulted.
//
// The idle window exists because the three above can all miss the same fight: a
// solo player fighting a mob whose hate table has not reached them yet, or a dot
// ticking on a mob that has run out of interest scope. It is deliberately the
// fallback rather than the mechanism.

import type { Entity, PartyInfo } from './game-types.ts';

/** How long after damage stops the fallback branch still reads as in combat. */
const IDLE_WINDOW_MS = 5000;

type CombatSource = 'party' | 'threat' | 'pvp' | 'recent' | 'none';

interface CombatState {
  active: boolean;
  source: CombatSource;
}

const OUT_OF_COMBAT: CombatState = Object.freeze({ active: false, source: 'none' });

/** The player's own row, or null when they are not in a party. */
function selfRow(party: PartyInfo | null, playerId: number): { inCombat: number } | null {
  if (party === null) {
    return null;
  }
  return party.members.find((member) => member.pid === playerId) ?? null;
}

/** A living mob whose hate table names the player. */
function threatensPlayer(entity: Entity, playerId: number): boolean {
  if (entity.dead || !(entity.threat instanceof Map)) {
    return false;
  }
  return entity.threat.has(playerId);
}

/**
 * A hostile player with the player selected.
 *
 * Restricted to `kind === 'player'` deliberately: a mob's `targetId` is never
 * written, so including mobs here would be a branch that can only ever answer no
 * while looking like it covers them.
 */
function attacksPlayer(entity: Entity, playerId: number): boolean {
  return entity.kind === 'player' && !entity.dead && entity.hostile && entity.targetId === playerId;
}

/**
 * The best entity-backed answer, or 'none'.
 *
 * `threat` wins outright wherever it appears, so the loop cannot stop at the
 * first attacker it finds: a hostile player and an angry mob can both be in
 * scope, and the mob's hate table is the better answer of the two.
 */
function fromEntities(entities: ReadonlyMap<number, Entity>, playerId: number): CombatSource {
  let pvp = false;
  for (const entity of entities.values()) {
    if (entity.id !== playerId) {
      if (threatensPlayer(entity, playerId)) {
        return 'threat';
      }
      pvp = pvp || attacksPlayer(entity, playerId);
    }
  }
  if (pvp) {
    return 'pvp';
  }
  return 'none';
}

interface CombatInputs {
  player: Entity | null;
  party: PartyInfo | null;
  entities: ReadonlyMap<number, Entity>;
  /** When damage involving the player last landed, or null if it never has. */
  lastDamageAt: number | null;
  now: number;
}

/**
 * The reading, from the most trustworthy branch that answers.
 *
 * A dead player is out of combat whatever the rest says: a corpse is not
 * fighting, and a hate table can outlive the player who was on it.
 */
function readCombat(inputs: CombatInputs): CombatState {
  const { player, party, entities, lastDamageAt, now } = inputs;
  if (player === null || player.dead) {
    return OUT_OF_COMBAT;
  }

  const row = selfRow(party, player.id);
  if (row !== null) {
    return { active: row.inCombat === 1, source: 'party' };
  }

  const found = fromEntities(entities, player.id);
  if (found !== 'none') {
    return { active: true, source: found };
  }

  if (lastDamageAt !== null && now - lastDamageAt < IDLE_WINDOW_MS) {
    return { active: true, source: 'recent' };
  }

  return OUT_OF_COMBAT;
}

export type { CombatInputs, CombatSource, CombatState };
export { IDLE_WINDOW_MS, OUT_OF_COMBAT, readCombat };
