// Remembering where the player left the manager window.
//
// Held in memory for the session and written through to GM storage so it also
// survives a reload. The write is fire and forget: a window that reopens
// centred is a small annoyance, and blocking a drag on a bridge round trip
// would be a large one.
//
// Keyed by channel rather than by character. Window position is a preference
// about the player's screen, not about which character they are on, and the
// channels are separate deployments whose windows a player may well want
// arranged differently.

import { diagError } from '../../../shared/diag.ts';
import { type FrameBox, isFrameBox } from '../frame/geometry.ts';

const NS = 'loader';

export interface GeometryStorage {
  get: (ns: string, key: string) => Promise<unknown>;
  set: (ns: string, key: string, value: unknown) => Promise<void>;
}

export interface GeometryStoreDeps {
  /** Null when the bridge never connected. The window then just never persists. */
  storage: GeometryStorage | null;
  channel: string;
}

export interface GeometryStore {
  /** Null until something has been loaded or set. */
  box: () => FrameBox | null;
  /** Read the persisted box, if there is one. */
  load: () => Promise<void>;
  save: (box: FrameBox) => void;
}

export function geometryKey(channel: string): string {
  return `manager-frame:${channel}`;
}

export function createGeometryStore(deps: GeometryStoreDeps): GeometryStore {
  const key = geometryKey(deps.channel);
  let box: FrameBox | null = null;

  return {
    box: () => box,

    load: async () => {
      if (deps.storage === null) {
        return;
      }
      try {
        const stored = await deps.storage.get(NS, key);
        // Validated rather than trusted: a NaN reaching a style property drops
        // the declaration silently, which would strand the window off screen.
        if (isFrameBox(stored)) {
          box = stored;
        }
      } catch (err) {
        diagError('could not read the saved manager window position', err);
      }
    },

    save: (next) => {
      box = next;
      const { storage } = deps;
      if (storage === null) {
        return;
      }
      storage.set(NS, key, next).catch((err: unknown) => {
        diagError('could not save the manager window position', err);
      });
    },
  };
}
