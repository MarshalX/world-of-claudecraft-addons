// The loader's own keybinds, as opposed to an addon's.
//
// The first of them, and the mechanism matters more than the one bind it
// currently carries: until now every registration belonged to an addon, keyed
// '<fqid>:<bindId>' and stored under that addon's config namespace. A loader
// bind needs the same rebinding, the same persistence, and the same appearance
// in a conflict report, and none of that is worth a second implementation.
//
// So it reuses the addon keybind store with a reserved owner. `LOADER_OWNER` is
// 'loader' with no slash in it, and every addon fqid is '<marketplace>/<id>', so
// the two namespaces cannot collide however a marketplace is named.
//
// The bind is registered whether or not any addon is installed, because what it
// switches on is the loader's own arrange-your-UI mode, and a player with no
// addons has nothing to arrange but also nothing to be confused by.

import type { KeybindDecl } from '../../shared/schema.ts';
import type { Teardown } from '../disposal.ts';
import type { StorageHub } from '../storage/hub.ts';
import type { KeyDispatcher } from './dispatcher.ts';
import { createKeybindStore, type KeybindStore } from './store.ts';

/** The reserved owner, which cannot collide with an addon's fqid. */
const LOADER_OWNER = 'loader';

const UNLOCK_BIND = 'unlock';

/**
 * Alt is deliberate: the game binds bare keys and Ctrl combinations, and Alt is
 * the modifier least likely to be taken. A player who disagrees can rebind it,
 * which is the whole reason this goes through the same store an addon uses.
 */
const DECLS: readonly KeybindDecl[] = [
  { id: UNLOCK_BIND, label: 'Unlock addon frames for arranging', default: 'Alt+KeyU' },
];

interface LoaderBindsDeps {
  hub: StorageHub;
  dispatcher: KeyDispatcher;
  /** What the unlock bind does. */
  onUnlock: () => void;
}

interface LoaderBinds {
  store: KeybindStore;
  dispose: () => void;
}

/**
 * Register the loader's binds and keep them following the player's overrides.
 *
 * Hydration is deliberately not awaited by the caller: the bind works at its
 * declared default from the moment the loader starts, and moves to the player's
 * combo when storage answers. Waiting would mean the key does nothing during the
 * first few hundred milliseconds, which reads as the loader being broken.
 */
function createLoaderBinds(deps: LoaderBindsDeps): LoaderBinds {
  const store = createKeybindStore({ fqid: LOADER_OWNER, decls: DECLS, hub: deps.hub });
  const key = `${LOADER_OWNER}:${UNLOCK_BIND}`;
  const teardowns: Teardown[] = [];

  const combo = store.combo(UNLOCK_BIND);
  if (combo !== null) {
    teardowns.push(deps.dispatcher.register(key, combo, deps.onUnlock));
  }

  teardowns.push(
    store.onChange((id, next) => {
      if (id === UNLOCK_BIND) {
        deps.dispatcher.rebind(key, next);
      }
    }),
  );

  // Not awaited, and a failure is not fatal: the bind works at its declared
  // default either way, and the store already reports a bad read.
  store.hydrate().catch(() => undefined);

  return {
    store,
    dispose: () => {
      for (const teardown of teardowns) {
        teardown();
      }
      store.dispose();
    },
  };
}

export type { LoaderBinds, LoaderBindsDeps };
export { createLoaderBinds, DECLS as LOADER_BIND_DECLS, LOADER_OWNER, UNLOCK_BIND };
