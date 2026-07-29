// What the Installed pane reads, loaded outside the component tree.
//
// The load lives here rather than in a component effect so it is a plain object
// a Node test can drive without rendering anything, and so a reload triggered
// from outside the tree (the host reporting that another tab wrote to the
// registry) is an ordinary method call rather than a prop that exists only to
// invalidate an effect.

import { describeError } from '../../../shared/diag.ts';
import type { InstalledAddon } from '../../../shared/protocol.ts';

type InstalledStatus = 'idle' | 'loading' | 'ready' | 'failed';

interface InstalledState {
  status: InstalledStatus;
  rows: readonly InstalledAddon[];
  /** Set by a failed load, and by a failed toggle without clearing the rows. */
  error: string | null;
}

interface InstalledRegistry {
  list: () => Promise<InstalledAddon[]>;
  setEnabled: (fqid: string, on: boolean) => Promise<void>;
  install: (fqid: string) => Promise<void>;
  uninstall: (fqid: string) => Promise<void>;
}

interface InstalledStoreDeps {
  /** Null when the bridge never connected, which is a different state from empty. */
  registry: InstalledRegistry | null;
  onChange: () => void;
}

interface InstalledStore {
  state: () => InstalledState;
  reload: () => void;
  setEnabled: (fqid: string, on: boolean) => void;
  /** Remove the addon and its cached source. Its stored data is kept. */
  uninstall: (fqid: string) => void;
}

const IDLE: InstalledState = { status: 'idle', rows: [], error: null };

function createInstalledStore(deps: InstalledStoreDeps): InstalledStore {
  let state = IDLE;
  // Every load takes a ticket, and only the newest one may write. Without it a
  // slow first load lands after a fast reload and reinstates the older list.
  let ticket = 0;

  const commit = (next: InstalledState): void => {
    state = next;
    deps.onChange();
  };

  const reload = (): void => {
    const { registry } = deps;
    if (registry === null) {
      commit({ status: 'failed', rows: [], error: null });
      return;
    }
    ticket += 1;
    const mine = ticket;
    commit({ status: 'loading', rows: state.rows, error: null });
    registry
      .list()
      .then((rows) => {
        if (mine === ticket) {
          commit({ status: 'ready', rows, error: null });
        }
      })
      .catch((err: unknown) => {
        if (mine === ticket) {
          commit({ status: 'failed', rows: [], error: describeError(err) });
        }
      });
  };

  return {
    state: () => state,
    reload,

    // No optimistic flip. The host emits registry.changed on a write that
    // actually changed something, and that is what reloads; showing the new
    // state first would show one the store may have refused.
    setEnabled: (fqid, on) => {
      const { registry } = deps;
      if (registry === null) {
        return;
      }
      registry.setEnabled(fqid, on).catch((err: unknown) => {
        commit({ ...state, error: describeError(err) });
      });
    },

    // Also no optimistic removal: the host emits registry.changed on a write
    // that landed, and that is what takes the row away. A row that vanished and
    // came back would read as the uninstall having failed silently.
    uninstall: (fqid) => {
      const { registry } = deps;
      if (registry === null) {
        return;
      }
      registry.uninstall(fqid).catch((err: unknown) => {
        commit({ ...state, error: describeError(err) });
      });
    },
  };
}

export type {
  InstalledRegistry,
  InstalledState,
  InstalledStatus,
  InstalledStore,
  InstalledStoreDeps,
};
export { createInstalledStore };
