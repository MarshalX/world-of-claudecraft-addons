import type { Unsubscribe } from './addon.js';

export interface ConflictReport {
  game: string[];
  addons: string[];
}

export interface KeysApi {
  /** `id` must be declared in your addon.json keybinds. */
  bind: (id: string, handler: (event: KeyboardEvent) => void) => Unsubscribe;
  combo: (id: string) => string;
  set: (id: string, combo: string) => Promise<void>;
  conflicts: (combo: string) => ConflictReport;
  capture: () => Promise<string>;
}
