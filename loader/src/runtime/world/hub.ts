// The one world reader every addon shares.
//
// Built at boot, before the game exists: the backend is null until __game
// appears, and every read answers null until then. That is what lets an addon
// hold woc.world from its first line and await woc.world.ready separately.

import { diagError } from '../../shared/diag.ts';
import { createGameBackend, type WorldBackend } from './backend.ts';
import { createWorldWatcher, type WorldWatcher } from './watch.ts';

export interface WorldHubDeps {
  /** Resolves with the __game object. See runtime/ready.ts. */
  game: Promise<unknown>;
  schedule: (frame: () => void) => number;
  cancel: (id: number) => void;
}

export interface WorldHub {
  /** Resolves once the backend is live, or rejects if the game never arrives. */
  ready: Promise<void>;
  backend: () => WorldBackend | null;
  game: () => unknown;
  watcher: WorldWatcher;
  dispose: () => void;
}

export function createWorldHub(deps: WorldHubDeps): WorldHub {
  let backend: WorldBackend | null = null;
  let game: unknown = null;

  const watcher = createWorldWatcher({
    backend: () => backend,
    schedule: deps.schedule,
    cancel: deps.cancel,
    onError: (key, err) => diagError(`an addon handler for world.on('${key}') threw`, err),
  });

  const ready = deps.game.then((handle) => {
    game = handle;
    backend = createGameBackend(handle);
    if (backend === null) {
      throw new Error('__game has no world member, so the world API cannot be backed');
    }
  });

  return {
    ready,
    backend: () => backend,
    game: () => game,
    watcher,
    dispose: () => watcher.dispose(),
  };
}
