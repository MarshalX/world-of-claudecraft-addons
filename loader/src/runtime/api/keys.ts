// The woc.keys surface, mirroring packages/types/keys.d.ts. An addon binds by DECLARED ID, never by
// combo: the combo is the player's, and a rebind moves the live registration underneath. An
// undeclared id throws, which lets the manager render the editor for an addon it never ran.

import { findConflicts } from '../../shared/combo.ts';
import type { DisposalBag, Teardown } from '../disposal.ts';
import type { KeyDispatcher } from '../keys/dispatcher.ts';
import type { BindingSource, GameBindings } from '../keys/game-bindings.ts';
import type { KeybindStore } from '../keys/store.ts';

interface ConflictReport {
  /** Game action ids that would also fire. */
  game: string[];
  /** Other bindings as '<fqid>:<bindId>', this addon's own included. */
  addons: string[];
  /** Where the game half came from. A clean 'stored' reading does not mean the key is free. */
  source: BindingSource;
}

interface KeysApi {
  /** Throws for an id the manifest does not declare. Returns an unbind. */
  bind: (id: string, handler: () => void) => Teardown;
  /** The combo in force: the player's override, or the manifest default. */
  combo: (id: string) => string | null;
  /** Rebind. Used by the manager; an addon may call it to offer its own UI. */
  set: (id: string, combo: string) => Promise<void>;
  conflicts: (combo: string) => ConflictReport;
  /** The next key press, or null if the prompt was closed. */
  capture: () => Promise<string | null>;
}

interface KeysDeps {
  fqid: string;
  dispatcher: KeyDispatcher;
  store: KeybindStore;
  game: GameBindings;
  bag: DisposalBag;
}

/** The dispatcher is shared by every addon, so its keys carry the fqid. */
function registrationKey(fqid: string, id: string): string {
  return `${fqid}:${id}`;
}

function createKeys(deps: KeysDeps): KeysApi {
  const { fqid, dispatcher, store, game, bag } = deps;
  const bound = new Set<string>();

  // A manager rebind moves the registration; the addon's handler is untouched.
  bag.add(
    store.onChange((id, combo) => {
      if (bound.has(id)) {
        dispatcher.rebind(registrationKey(fqid, id), combo);
      }
    }),
  );

  return {
    bind: (id, handler) => {
      const combo = store.combo(id);
      if (combo === null) {
        throw new Error(
          `${fqid}: keys.bind('${id}') needs a matching entry in the manifest's keybinds`,
        );
      }
      const key = registrationKey(fqid, id);
      const off = dispatcher.register(key, combo, handler);
      bound.add(id);

      const release = (): void => {
        bound.delete(id);
        off();
      };
      const drop = bag.add(release);
      return () => {
        drop();
        release();
      };
    },

    combo: (id) => store.combo(id),

    set: (id, combo) => store.set(id, combo),

    conflicts: (combo) => {
      const fromGame = game.conflicts(combo);
      const report = findConflicts(combo, {}, dispatcher.bindings());
      return { game: fromGame.actions, addons: report.addons, source: fromGame.source };
    },

    capture: () => {
      const capture = dispatcher.capture();
      // Bagged, or disabling mid-prompt leaves the dispatcher swallowing every key.
      const drop = bag.add(capture.cancel);
      return capture.done.finally(drop);
    },
  };
}

export type { ConflictReport, KeysApi, KeysDeps };
export { createKeys, registrationKey };
