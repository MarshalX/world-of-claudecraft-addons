// Everything on `woc.world` that takes an ARGUMENT.
//
// None of it can be a getter, so none of it is a world key and none of it can be
// subscribed to: watch the key an answer comes from and ask again in the handler.

import {
  type AuraQuery,
  filterAuras,
  filterPartyAuras,
  isDispellable,
  isHarmful,
  NO_ROWS,
  NONE,
  type PartyAuraQuery,
} from '../world/auras.ts';
import type { Aura, Entity } from '../world/game-types.ts';
import type { CorpseView } from '../world/ground.ts';
import type { WorldHub } from '../world/hub.ts';
import type { PartyMemberAura } from '../world/party-types.ts';
import type { Reaction } from '../world/reaction.ts';
import { NO_THREAT, type ThreatTable } from '../world/threat.ts';
import { resolveUnit, type UnitContext } from '../world/units.ts';
import { emptyEntities, fromBackend } from './world-reads.ts';

/** A point on the ground. `y` is deliberately not an axis: see `distanceTo`. */
interface FlatPoint {
  x: number;
  z: number;
}

const HALF_TURN_DEGREES = 180;
const FULL_TURN_DEGREES = 360;

/**
 * `facing` grows as the player turns LEFT and `atan2(dx, dz)` reads the same way, so
 * their difference is counter-clockwise and a published bearing is it negated.
 * `fmt.compass` negates back before indexing its table; keep the two in step.
 */
const BEARING_SIGN = -1;

/**
 * Into -180 <= turn < 180, so straight behind is always -180.
 *
 * A reading already in range is returned UNTOUCHED: the modulo round trip is not
 * the identity on those and can move the last bit onto a sector tie, which steps
 * `fmt.compass` a sector.
 */
function halfTurns(degrees: number): number {
  // Straight ahead arrives as -0, which `Object.is` and a test will not match.
  if (degrees === 0) {
    return 0;
  }
  if (degrees >= HALF_TURN_DEGREES || degrees < -HALF_TURN_DEGREES) {
    const turned =
      (((degrees + HALF_TURN_DEGREES) % FULL_TURN_DEGREES) + FULL_TURN_DEGREES) % FULL_TURN_DEGREES;
    return turned - HALF_TURN_DEGREES;
  }
  return degrees;
}

/** Null before world entry, which is the one case `mine` cannot be answered in. */
function playerIdOf(ctx: UnitContext): number | null {
  if (ctx.player === null) {
    return null;
  }
  return ctx.player.id;
}

/** Resolving a unit, and filtering what is on it. */
export function lookups(hub: WorldHub) {
  const context = (): UnitContext => {
    const backend = hub.backend();
    return {
      player: backend?.player ?? null,
      target: backend?.target ?? null,
      entities: backend?.entities ?? emptyEntities(),
      party: backend?.party ?? null,
    };
  };

  return {
    unit: (token: string): Entity | null => resolveUnit(token, context()),

    aurasOn: (token: string, query: AuraQuery = {}): readonly Aura[] => {
      const ctx = context();
      const unit = resolveUnit(token, ctx);
      if (unit === null) {
        return NONE;
      }
      return filterAuras(unit.auras, query, playerIdOf(ctx));
    },

    threat: (entityId: number): ThreatTable => {
      const backend = hub.backend();
      if (backend === null) {
        return NO_THREAT;
      }
      return backend.threat(entityId);
    },

    corpseLoot: (entityId: number): CorpseView | null => {
      const backend = hub.backend();
      if (backend === null) {
        return null;
      }
      return backend.corpseLoot(entityId);
    },

    reaction: (entityId: number): Reaction | null => {
      const backend = hub.backend();
      if (backend === null) {
        return null;
      }
      return backend.reaction(entityId);
    },

    partyAuras: (pid: number, query: PartyAuraQuery = {}): readonly PartyMemberAura[] => {
      const party = hub.backend()?.party;
      if (party === undefined || party === null) {
        return NO_ROWS;
      }
      const row = party.members.find((member) => member.pid === pid);
      return filterPartyAuras(row?.auras, query);
    },

    harmful: (aura: Aura | PartyMemberAura): boolean => isHarmful(aura),

    dispellable: (aura: Aura, offensive = false): boolean => isDispellable(aura, offensive),
  };
}

/**
 * How far a point is and which way to turn to it.
 *
 * Flat, because it is the distance you would WALK and the one the game's own gates
 * measure. Null with no player, which is where an addon's first line runs.
 */
export function geometryReads(hub: WorldHub) {
  const player = (): Entity | null => fromBackend(hub, (backend) => backend.player);

  return {
    distanceTo: (at: FlatPoint): number | null => {
      const me = player();
      if (me === null) {
        return null;
      }
      return Math.hypot(me.pos.x - at.x, me.pos.z - at.z);
    },

    bearingTo: (at: FlatPoint): number | null => {
      const me = player();
      // An unplaced entity carries a non-finite facing, so this is a real state.
      if (me === null || !Number.isFinite(me.facing)) {
        return null;
      }
      const toward = Math.atan2(at.x - me.pos.x, at.z - me.pos.z);
      const relative = ((toward - me.facing) * HALF_TURN_DEGREES) / Math.PI;
      return halfTurns(BEARING_SIGN * relative);
    },
  };
}
