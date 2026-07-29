// The woc.keys surface handed to addons. Mirrors packages/types/keys.d.ts.
//
// An addon binds by DECLARED ID, never by combo: the combo belongs to the
// player, who can rebind it in the manager, and an addon that named a key
// directly would either fight that or ignore it. `keys.bind('toggle', fn)`
// therefore keeps working across a rebind with nothing for the addon to do,
// because the rebind moves the live registration underneath it.
//
// Binding an id the manifest does not declare throws. That is what lets the
// manager render the full keybind editor for an addon it has never run.

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
  /**
   * Whether the game half was read from the live profile or from storage.
   *
   * Surfaced rather than hidden because the two are not equally trustworthy:
   * storage holds only what the player explicitly saved, so a 'stored' reading
   * with no conflicts does not mean the key is free.
   */
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
  /** Which ids this addon currently has live, so a rebind knows what to move. */
  const bound = new Set<string>();

  // A rebind from the manager arrives here rather than at the addon: the
  // registration moves and the addon's handler is untouched.
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
      // Registered in the bag so disabling the addon mid-prompt releases the
      // await rather than leaving the dispatcher swallowing every key press.
      const drop = bag.add(capture.cancel);
      return capture.done.finally(drop);
    },
  };
}

export type { ConflictReport, KeysApi, KeysDeps };
export { createKeys, registrationKey };
