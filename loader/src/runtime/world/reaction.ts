// Which side a unit is on, which is not a field.
//
// `Entity.hostile` is set only where the game builds a mob, so it is false on every player,
// battleground opponents included. The bout's roster is the only answer for players, as in the
// game's `Renderer.isHostilePlayer`, so this reads `world.match`.
//
// A PET takes its owner's side, one level deep. Pure over `Entity` and `MatchInfo`, since
// `world/combat.ts` needs it too.

import type { Entity } from './game-types.ts';
import type { MatchInfo } from './match.ts';

/**
 * How a unit stands toward the player. 'neutral' is a wild mob, a real answer rather than
 * "unknown".
 */
type Reaction = 'hostile' | 'friendly' | 'neutral';

/**
 * Whether the bout in progress has this pid on the other side. A pid is an entity id here.
 */
function fightsPlayer(match: MatchInfo | null, pid: number): boolean {
  if (match === null) {
    return false;
  }
  if (match.format === 'duel') {
    return match.otherPid === pid;
  }
  if (match.format === 'battleground') {
    const fighter = match.fighters.find((one) => one.pid === pid);
    return fighter !== undefined && fighter.team !== match.myTeam;
  }
  return match.enemies.some((one) => one.pid === pid);
}

/** A pet is asked ABOUT ITS OWNER. An owner out of scope falls back to the pet itself. */
function sideSource(entity: Entity, entities: ReadonlyMap<number, Entity>): Entity {
  if (entity.ownerId === null) {
    return entity;
  }
  return entities.get(entity.ownerId) ?? entity;
}

/**
 * The reading, from the flag for mobs and the roster for players. An npc reads friendly, as the
 * game colours it.
 */
function reactionOf(
  entity: Entity,
  entities: ReadonlyMap<number, Entity>,
  match: MatchInfo | null,
): Reaction {
  const source = sideSource(entity, entities);
  if (source.hostile || fightsPlayer(match, source.id)) {
    return 'hostile';
  }
  if (source.kind === 'player' || source.kind === 'npc') {
    return 'friendly';
  }
  return 'neutral';
}

export type { Reaction };
export { fightsPlayer, reactionOf };
