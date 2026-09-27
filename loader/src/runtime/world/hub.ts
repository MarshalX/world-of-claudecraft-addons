// The one world reader every addon shares.
//
// Built at boot, before the game exists: the backend is null until __game
// appears, and every read answers null until then. That is what lets an addon
// hold woc.world from its first line and await woc.world.ready separately.

import { diagError } from '../../shared/diag.ts';
import { createGameBackend, type WorldBackend } from './backend.ts';
import type { BackendDeps } from './backend-deps.ts';
import { checkWorldMembers } from './members.ts';
import { checkEntityShape } from './shape.ts';
import { createWorldWatcher, type WorldWatcher } from './watch.ts';

/**
 * Report a live player, or a world object, that does not look like what addons are typed
 * against. Once per session. Reported, never thrown: the world is still readable when one field
 * moved.
 */
function reportShapeDrift(backend: WorldBackend): void {
  const problems = checkEntityShape(backend.player);
  if (problems.length > 0) {
    diagError('the game entity no longer matches the world types addons are written against', {
      problems,
    });
  }
  // A separate report: a renamed member reads as permanently empty rather than wrong.
  const missing = checkWorldMembers(backend.raw);
  if (missing.length > 0) {
    diagError('the game no longer carries every world member the loader reads', {
      problems: missing,
    });
  }
}

export interface WorldHubDeps extends BackendDeps {
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
    now: deps.now,
    onError: (key, err) => diagError(`an addon handler for world.on('${key}') threw`, err),
  });

  const ready = deps.game.then((handle) => {
    game = handle;
    backend = createGameBackend(handle, {
      lastDamageAt: deps.lastDamageAt,
      now: deps.now,
      zoneName: deps.zoneName,
      simNow: deps.simNow,
      realm: deps.realm,
    });
    if (backend === null) {
      throw new Error('__game has no world member, so the world API cannot be backed');
    }
    reportShapeDrift(backend);
  });

  return {
    ready,
    backend: () => backend,
    game: () => game,
    watcher,
    dispose: () => watcher.dispose(),
  };
}
