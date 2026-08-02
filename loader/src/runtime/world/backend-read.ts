// The one assertion every backend group makes.
//
// Reading a member off the game's world object is a CLAIM about a repository
// this one cannot compile against, and every group makes the same one, so it
// lives here rather than being written once per module. `shape.ts` is what keeps
// the claim honest, against the live player, once per session.

import { fieldValue } from '../net/frames.ts';

/** A live game object, or null when the game does not carry that member yet. */
function readAs<T>(source: unknown, field: string): T | null {
  return fieldValue(source, field) as T | null;
}

export { readAs };
