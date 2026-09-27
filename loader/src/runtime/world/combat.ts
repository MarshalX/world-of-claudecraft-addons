// Whether the player is in combat, answered in falling order of confidence. `source` says which
// branch replied, since four are server state and one is a timer.
//
//  self   the sim's flag on the player's own entity. POSITIVE-ONLY: a server that never sends
//         it leaves the client default false, so false means "nobody said".
//  party  the player's party row, which the server derives from the hate tables.
//  threat a nearby living mob's hate table contains the player. The server prunes an entry when
//         the player leaves the fight, so one vanishing does not mean threat was lost.
//  pvp    a PLAYER the bout puts on the other side has the player selected.
//  recent damage involving the player landed inside the idle window. The only branch that can
//         be wrong, and the fallback for a mob whose table has not reached the player yet or a
//         dot ticking out of interest scope.

import type { Entity } from './game-types.ts';
import type { MatchInfo } from './match.ts';
import type { PartyInfo } from './party-types.ts';
import { fightsPlayer } from './reaction.ts';

/** How long after damage stops the fallback branch still reads as in combat. */
const IDLE_WINDOW_MS = 5000;

type CombatSource = 'self' | 'party' | 'threat' | 'pvp' | 'recent' | 'none';

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
 * A hostile player with the player selected. Players only, since a mob's `targetId` is never
 * written. Hostility comes from the BOUT, never `entity.hostile`, which is never true on a
 * player: see `world/reaction.ts`.
 */
function attacksPlayer(entity: Entity, playerId: number, match: MatchInfo | null): boolean {
  return (
    entity.kind === 'player' &&
    !entity.dead &&
    entity.targetId === playerId &&
    fightsPlayer(match, entity.id)
  );
}

/**
 * The best entity-backed answer, or 'none'. `threat` outranks `pvp`, so the loop cannot stop at
 * the first hostile player.
 */
function fromEntities(
  entities: ReadonlyMap<number, Entity>,
  playerId: number,
  match: MatchInfo | null,
): CombatSource {
  let pvp = false;
  for (const entity of entities.values()) {
    if (entity.id !== playerId) {
      if (threatensPlayer(entity, playerId)) {
        return 'threat';
      }
      pvp = pvp || attacksPlayer(entity, playerId, match);
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
  /** The bout in progress, which is the only thing that says who is fighting you. */
  match: MatchInfo | null;
  /** When damage involving the player last landed, or null if it never has. */
  lastDamageAt: number | null;
  now: number;
}

/**
 * The reading, from the most trustworthy branch that answers. A dead player is out of combat
 * whatever the rest says, since a hate table can outlive the player on it.
 */
function readCombat(inputs: CombatInputs): CombatState {
  const { player, party, entities, match, lastDamageAt, now } = inputs;
  if (player === null || player.dead) {
    return OUT_OF_COMBAT;
  }

  // Positive-only: a false falls through, since it cannot be told from a server that never sent it.
  if (player.inCombat === true) {
    return { active: true, source: 'self' };
  }

  const row = selfRow(party, player.id);
  if (row !== null) {
    return { active: row.inCombat === 1, source: 'party' };
  }

  const found = fromEntities(entities, player.id, match);
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
