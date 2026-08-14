// Which side a unit is on, which is not a field.
//
// `Entity.hostile` is written where the game BUILDS A MOB (`src/sim/entity.ts`)
// and nowhere else, so it is false on every player in the world for the whole of
// every session, including the five trying to kill you in a battleground. It is
// genuinely sent, it is correctly typed, and it is never true for the kind
// anybody asks about, which is why nothing 404s and nothing warns: a display
// built on it paints every duel, arena and battleground opponent friendly.
//
// The bout's own roster is the only answer, and the game's own renderer reaches
// the same conclusion the same way (`Renderer.isHostilePlayer` resolves it from
// `duelInfo.otherPid`, `bgInfo.match.players[].team` and `arenaInfo.match.enemies`).
// So this reads `world.match`, which already carries all three behind one shape.
//
// A PET has no side of its own and takes its owner's, which is the second half
// the game's `reaction.ts` spells out: an enemy player's pet must read hostile
// and your own must never read as a wild mob. One level deep, because a pet
// cannot own one.
//
// Pure, over `Entity` and `MatchInfo` alone, because two callers need it: the
// `world.reaction` lookup and `world/combat.ts`, which cannot answer 'pvp'
// without it and knows nothing about the game object.

import type { Entity } from './game-types.ts';
import type { MatchInfo } from './match.ts';

/**
 * How a unit stands toward the player.
 *
 * 'neutral' is a wild mob, which is a real third answer rather than a way of
 * saying the question could not be answered: a boar is neither on your side nor
 * fighting you until somebody makes it.
 */
type Reaction = 'hostile' | 'friendly' | 'neutral';

/**
 * Whether the bout in progress has this pid on the other side.
 *
 * A pid IS an entity id here, which is the same identity `units.ts` resolves a
 * party row through. Scanned rather than gathered into a Set: a bout is at most
 * ten rows and the set would be rebuilt per call anyway, since the roster is
 * read fresh every time to keep the answer live.
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
 * The reading, from the flag where it means something and the roster where it does not.
 *
 * An npc reads friendly with the players: the game colours both blue and a
 * quest giver is not a neutral party. A hostile NPC does not exist, and if one
 * ever does the flag arm above answers it first.
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
