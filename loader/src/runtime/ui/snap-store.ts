// Whether an arranged frame lands on the alignment grid, persisted per channel in the
// loader's own namespace. The boolean is the loader's: the game's `frameSnapToGrid` sits
// in `localStorage['woc_settings']`, a private blob nothing here may read, and its
// `#interface-grid-overlay` only answers while the game's own mode is on.

import { diagError } from '../../shared/diag.ts';
import type { GeometryStorage } from './manager/geometry-store.ts';

/** The loader's own namespace in GM storage, shared with the manager's geometry. */
const NS = 'loader';

interface SnapStoreDeps {
  /** Null when the bridge never connected. The answer then lasts the session. */
  storage: GeometryStorage | null;
  channel: string;
}

interface SnapStore {
  readonly enabled: boolean;
  set: (next: boolean) => void;
  toggle: () => void;
  /** Read the persisted answer. Nothing snaps differently until it resolves. */
  load: () => Promise<void>;
}

function snapKey(channel: string): string {
  return `frame-snap:${channel}`;
}

function createSnapStore(deps: SnapStoreDeps): SnapStore {
  const key = snapKey(deps.channel);
  let enabled = false;

  const write = (next: boolean): void => {
    enabled = next;
    const { storage } = deps;
    if (storage === null) {
      return;
    }
    storage.set(NS, key, next).catch((err: unknown) => {
      diagError('could not save whether frames snap to the grid', err);
    });
  };

  return {
    get enabled(): boolean {
      return enabled;
    },

    set: write,

    toggle: () => {
      write(!enabled);
    },

    load: async () => {
      if (deps.storage === null) {
        return;
      }
      try {
        const stored = await deps.storage.get(NS, key);
        // Anything but a boolean is a hand-edited store or an older loader's shape.
        if (typeof stored === 'boolean') {
          enabled = stored;
        }
      } catch (err) {
        diagError('could not read whether frames snap to the grid', err);
      }
    },
  };
}

export type { SnapStore, SnapStoreDeps };
export { createSnapStore, snapKey };
