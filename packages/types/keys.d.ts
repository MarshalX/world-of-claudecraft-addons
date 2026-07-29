import type { Unsubscribe } from './addon.js';

/**
 * Where the game half of a conflict reading came from.
 *
 * It travels with the answer because the two are not equally trustworthy. The
 * live profile is the game's own matcher and knows every default binding;
 * 'stored' means only what the player explicitly saved could be read, so no
 * conflicts does NOT mean the key is free.
 */
export type BindingSource = 'live' | 'stored' | 'none';

export interface ConflictReport {
  /** Game action ids that would also fire on this combo. */
  game: string[];
  /** Other live bindings, as '<fqid>:<bindId>', your own included. */
  addons: string[];
  source: BindingSource;
}

export interface KeysApi {
  /** `id` must be declared in your addon.json keybinds. Throws if it is not. */
  bind: (id: string, handler: () => void) => Unsubscribe;
  /**
   * The combo in force: the player's override, or your manifest default.
   *
   * Null for an id your manifest does not declare. You never need to read this
   * to make a bind work: a rebind moves the live registration for you.
   */
  combo: (id: string) => string | null;
  set: (id: string, combo: string) => Promise<void>;
  conflicts: (combo: string) => ConflictReport;
  /**
   * Swallow the next key press and report it, for a "press a key" prompt.
   *
   * Resolves null if the prompt was closed, superseded, or torn down because
   * your addon was disabled.
   */
  capture: () => Promise<string | null>;
}
