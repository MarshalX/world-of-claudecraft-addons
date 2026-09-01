// The server's own movement-speed multiplier for the player, sent on the
// reconciliation self wire as `msm` and held on `ClientWorld extends
// ReconWireState`.
//
// DELIBERATELY NOT in `members.ts`: the field is legitimately absent on the
// offline sim, and that list reports a missing member as drift.
//
// Null for no world, the offline sim, a spectating session (the server skips the
// reconciliation block) and a session on movement wire version 1. The v1 case is
// why the read tests the wire version: there the client's field sits at its
// constructed default of 1 forever, which would publish as "unimpeded" for a
// player who is snared.

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
