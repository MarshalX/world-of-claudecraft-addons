// What the Installed pane reads, loaded outside the component tree so a reload from the host is a
// plain method call.

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
  // Only the newest load may write, or a slow first load overwrites a fast reload.
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

    // No optimistic flip: the host's registry.changed reloads, and the write may be refused.
    setEnabled: (fqid, on) => {
      const { registry } = deps;
      if (registry === null) {
        return;
      }
      registry.setEnabled(fqid, on).catch((err: unknown) => {
        commit({ ...state, error: describeError(err) });
      });
    },

    // No optimistic removal either, for the same reason.
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
