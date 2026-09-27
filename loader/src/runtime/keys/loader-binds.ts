// The loader's own keybinds, reusing the addon keybind store for rebinding, persistence and
// conflict reports. Owned by `LOADER_OWNER`, 'loader', which has no slash and so cannot collide
// with an addon fqid, '<marketplace>/<id>'.

import type { KeybindDecl } from '../../shared/schema.ts';
import type { Teardown } from '../disposal.ts';
import type { StorageHub } from '../storage/hub.ts';
import type { KeyDispatcher } from './dispatcher.ts';
import { createKeybindStore, type KeybindStore } from './store.ts';

const LOADER_OWNER = 'loader';

const UNLOCK_BIND = 'unlock';

/** Alt, since the game binds bare keys and Ctrl combinations. */
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

/** Works at its default from the start and moves to the player's combo when storage answers. */
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

  // Not awaited; the store reports a bad read itself.
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
