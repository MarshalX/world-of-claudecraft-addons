import type { Unsubscribe } from './addon.js';

export interface WorldApi {
  readonly ready: Promise<void>;
  readonly player: unknown;
  readonly target: unknown;
  readonly entities: ReadonlyMap<number, unknown>;
  readonly party: unknown;
  readonly inventory: unknown;
  readonly quests: unknown;
  readonly cooldowns: unknown;
  on: (key: string, handler: (value: unknown) => void) => Unsubscribe;

  /**
   * The game's own objects. Unstable: the game makes no compatibility promise
   * about them, and the manager flags addons that reach for them.
   */
  readonly raw: unknown;
  readonly game: unknown;
}
