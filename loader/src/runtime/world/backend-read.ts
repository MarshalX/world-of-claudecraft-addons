// The one assertion every backend group makes; `shape.ts` checks it against the live game.

import { fieldValue } from '../net/frames.ts';

/** A live game object, or null when the game does not carry that member yet. */
function readAs<T>(source: unknown, field: string): T | null {
  return fieldValue(source, field) as T | null;
}

export { readAs };
