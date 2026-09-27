// Where an addon frame was left, per character.
//
// Per character, unlike the manager's own window (manager/geometry-store.ts): HUD furniture
// sits differently for each character. Visibility is saved alongside the box.
//
// Writes are fire and forget, so a drag never stalls on a bridge round trip. READS wait for
// world entry: an addon builds its frames at document-start, when there is no character key.

import { diagError } from '../../../shared/diag.ts';
import type { Channel } from '../../../shared/hosts.ts';
import { perCharacterKey, uiNamespace } from '../../../shared/storage-keys.ts';
import type { StorageHub } from '../../storage/hub.ts';
import { type FrameBox, isFrameBox } from '../frame/geometry.ts';

interface FrameState {
  box: FrameBox;
  visible: boolean;
}

interface FrameStateDeps {
  fqid: string;
  hub: StorageHub;
  channel: Channel;
  /** The character in play, or null before world entry. Resolved per call, never captured. */
  character: () => string | null;
  /**
   * Resolves once `character()` will answer. A read waits for it; a write before world entry
   * is dropped, since hidden frames cannot have produced a gesture. A function, so a frame that
   * does not persist never pays for the world subscription.
   */
  known: () => Promise<void>;
}

interface FrameStateStore {
  load: (frameId: string) => Promise<FrameState | null>;
  save: (frameId: string, state: FrameState) => void;
}

function isFrameState(value: unknown): value is FrameState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  // Destructured, not dotted: noPropertyAccessFromIndexSignature.
  const { box, visible } = value as Record<string, unknown>;
  return typeof visible === 'boolean' && isFrameBox(box);
}

function createFrameStateStore(deps: FrameStateDeps): FrameStateStore {
  const ns = uiNamespace(deps.fqid);

  const keyFor = (frameId: string): string | null => {
    const character = deps.character();
    if (character === null) {
      return null;
    }
    return perCharacterKey(deps.channel, character, frameId);
  };

  return {
    load: async (frameId) => {
      if (!deps.hub.connected) {
        return null;
      }
      // Never resolves without world entry, which is correct: there is nothing to restore.
      await deps.known();
      const key = keyFor(frameId);
      if (key === null) {
        return null;
      }
      try {
        const stored = await deps.hub.get(ns, key);
        // Validated: a NaN style drops silently and could strand the frame off screen.
        if (!isFrameState(stored)) {
          return null;
        }
        return stored;
      } catch (err) {
        diagError(`${deps.fqid}: could not read the saved position of frame '${frameId}'`, err);
        return null;
      }
    },

    save: (frameId, state) => {
      const key = keyFor(frameId);
      if (key === null || !deps.hub.connected) {
        return;
      }
      deps.hub.set(ns, key, state).catch((err: unknown) => {
        diagError(`${deps.fqid}: could not save the position of frame '${frameId}'`, err);
      });
    },
  };
}

export type { FrameState, FrameStateDeps, FrameStateStore };
export { createFrameStateStore, isFrameState };
