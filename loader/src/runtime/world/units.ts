// Resolving a unit the way an addon thinks about one.
//
// `targettarget` must read a mob's `aggroTargetId`: its `targetId` is permanently null.
//
// The party tokens resolve to an ENTITY, so they answer null for a member out of interest scope.
// A raid display should read `world.party`, which is complete.

import type { Entity } from './game-types.ts';
import type { PartyInfo } from './party-types.ts';

/** A `partyN` or `raidN` tail. Hoisted so matching a token allocates nothing. */
const INDEX_RE = /^[1-9][0-9]*$/;

type FixedToken = 'player' | 'target' | 'targettarget' | 'pet';

/**
 * A unit an addon can name.
 *
 * `partyN` counts the OTHER members, 1-based, so `party1` is the first person
 * who is not you, matching how a party display is laid out. `raidN` counts every
 * member including you, in the roster's own order.
 */
type UnitToken = FixedToken | `party${number}` | `raid${number}`;

interface UnitContext {
  player: Entity | null;
  target: Entity | null;
  entities: ReadonlyMap<number, Entity>;
  party: PartyInfo | null;
}

/** Whichever field this kind of entity actually fills. */
function fightingId(entity: Entity): number | null {
  if (entity.kind === 'mob') {
    return entity.aggroTargetId;
  }
  return entity.targetId;
}

/** What the target is fighting, from whichever field its kind actually fills. */
function targetOfTarget(
  target: Entity | null,
  entities: ReadonlyMap<number, Entity>,
): Entity | null {
  if (target === null) {
    return null;
  }
  const id = fightingId(target);
  if (id === null) {
    return null;
  }
  return entities.get(id) ?? null;
}

/** The player's own pet: the entity that names them as its owner. */
function petOf(player: Entity | null, entities: ReadonlyMap<number, Entity>): Entity | null {
  if (player === null) {
    return null;
  }
  for (const entity of entities.values()) {
    if (entity.ownerId === player.id) {
      return entity;
    }
  }
  return null;
}

function byId(entities: ReadonlyMap<number, Entity>, id: number | null): Entity | null {
  if (id === null) {
    return null;
  }
  return entities.get(id) ?? null;
}

/** The 1-based index in a `partyN` or `raidN` token, or null for anything else. */
function indexOf(token: string, prefix: string): number | null {
  if (!token.startsWith(prefix)) {
    return null;
  }
  const rest = token.slice(prefix.length);
  if (!INDEX_RE.test(rest)) {
    return null;
  }
  return Number(rest);
}

/** The roster the token counts through: `others` drops the player, for the `party` form. */
function rosterFor(party: PartyInfo, player: Entity | null, others: boolean): PartyInfo['members'] {
  if (!others || player === null) {
    return party.members;
  }
  return party.members.filter((member) => member.pid !== player.id);
}

/** A group member's entity, or null when they are too far away to have one. */
function memberEntity(ctx: UnitContext, index: number, others: boolean): Entity | null {
  const { party, player } = ctx;
  if (party === null) {
    return null;
  }
  const rows = rosterFor(party, player, others);
  const row = rows[index - 1];
  if (row === undefined) {
    return null;
  }
  return byId(ctx.entities, row.pid);
}

function resolveFixed(token: FixedToken, ctx: UnitContext): Entity | null {
  switch (token) {
    case 'player':
      return ctx.player;
    case 'target':
      return ctx.target;
    case 'targettarget':
      return targetOfTarget(ctx.target, ctx.entities);
    default:
      return petOf(ctx.player, ctx.entities);
  }
}

const FIXED: readonly string[] = ['player', 'target', 'targettarget', 'pet'];

/** The entity a token names, or null when there is nothing there to name. */
function resolveUnit(token: string, ctx: UnitContext): Entity | null {
  if (FIXED.includes(token)) {
    return resolveFixed(token as FixedToken, ctx);
  }
  const party = indexOf(token, 'party');
  if (party !== null) {
    return memberEntity(ctx, party, true);
  }
  const raid = indexOf(token, 'raid');
  if (raid !== null) {
    return memberEntity(ctx, raid, false);
  }
  return null;
}

export type { UnitContext, UnitToken };
export { resolveUnit };
