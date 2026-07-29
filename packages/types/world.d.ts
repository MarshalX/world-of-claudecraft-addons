import type { Unsubscribe } from './addon.js';

/** The state keys world.on can watch. Anything else throws. */
export type WorldKey =
  | 'player'
  | 'target'
  | 'entities'
  | 'party'
  | 'inventory'
  | 'quests'
  | 'cooldowns'
  | 'auras';

export interface WorldQuests {
  /** questId to the live quest progress record. */
  readonly log: unknown;
  /** The ids of finished quests. */
  readonly done: unknown;
}

export interface WorldApi {
  /**
   * Resolves once the game is readable.
   *
   * Every read below answers null until then, so an addon can hold `woc.world`
   * from its first line and await this separately. It never times out: a player
   * may sit on the login screen for as long as they like.
   */
  readonly ready: Promise<void>;

  readonly player: unknown;
  readonly target: unknown;

  /**
   * Everything in interest scope.
   *
   * A read-only view of the game's live roster: reads pass through, and set,
   * delete, and clear throw. The entities themselves are the game's own live
   * objects, so this stops a slip rather than being a boundary.
   */
  readonly entities: ReadonlyMap<number, unknown>;

  readonly party: unknown;
  readonly inventory: unknown;
  readonly quests: WorldQuests | null;
  readonly cooldowns: unknown;
  readonly auras: unknown;

  /**
   * Watch a key for change, sampled once per animation frame.
   *
   * Fires on change rather than on every sample, and only for a change worth
   * acting on: `auras` reports one arriving or falling off, not its remaining
   * time ticking down, and `cooldowns` reports one starting or ending rather
   * than counting down.
   */
  on: (key: WorldKey, handler: (value: unknown) => void) => Unsubscribe;

  /**
   * The game's own objects. Unstable: the game makes no compatibility promise
   * about them, and the manager flags addons that reach for them.
   */
  readonly raw: unknown;
  readonly game: unknown;
}
