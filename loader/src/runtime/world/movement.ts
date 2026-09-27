// The server's movement-speed multiplier for the player, sent on the reconciliation self wire.
// Not in `members.ts`: it is legitimately absent on the offline sim.
//
// Null for no world, the offline sim, a spectating session and movement wire version 1, where
// the client's field sits at its default of 1 forever and would read "unimpeded" while snared.

import { fieldNumber, fieldValue } from '../net/frames.ts';

/** The version the reconciliation self wire is only sent under. */
const MOVEMENT_WIRE_V2 = 2;

/**
 * The multiplier the server applied, or null where there is no answer. 1 is a
 * real reading: the server omits `msm` at 1 and the client fills it back in.
 */
function readMoveSpeedMult(world: unknown): number | null {
  if (fieldValue(world, 'spectating') !== null) {
    return null;
  }
  if (fieldNumber(world, 'movementWireVersion') !== MOVEMENT_WIRE_V2) {
    return null;
  }
  const mult = fieldNumber(world, 'reconMoveSpeedMult');
  if (mult === null || mult < 0) {
    return null;
  }
  return mult;
}

export { readMoveSpeedMult };
