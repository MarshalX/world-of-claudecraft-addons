// Where an addon frame was left, per character.
//
// Per character rather than per channel, which is the opposite of the manager's
// own window (see manager/geometry-store.ts), and the difference is real. The
// manager is one window a player arranges once on their screen. An addon frame
// is HUD furniture: a raid healer and a solo hunter want the same addon in
// different places, and they are the same person on the same monitor.
//
// Visibility is saved alongside the box, so a frame the player closed stays
// closed on the next login. Without that, `save: true` would restore a window
// to exactly where it was and then show it anyway.
//
// Writes are fire and forget. A frame that reopens in its default spot is a
// small annoyance; a drag that stalls on a bridge round trip is a large one.

import { diagError } from '../../../shared/diag.ts';
import type { Channel } from '../../../shared/hosts.ts';
import { frameKey, uiNamespace } from '../../../shared/storage-keys.ts';
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
  /**
   * The character in play, or null before world entry.
   *
   * Resolved per call rather than captured: an addon may build its frames before
   * the player has entered the world, and a null captured then would mean the
   * frame never persisted for the whole session.
   */
  character: () => string | null;
}

interface FrameStateStore {
  load: (frameId: string) => Promise<FrameState | null>;
  save: (frameId: string, state: FrameState) => void;
}

function isFrameState(value: unknown): value is FrameState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  // Destructured rather than indexed: dot access on an index signature is a type
  // error under noPropertyAccessFromIndexSignature.
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
    return frameKey(deps.channel, character, frameId);
  };

  return {
    load: async (frameId) => {
      const key = keyFor(frameId);
      if (key === null || !deps.hub.connected) {
        return null;
      }
      try {
        const stored = await deps.hub.get(ns, key);
        // Validated rather than trusted: a NaN reaching a style property drops
        // the declaration silently, which would strand the frame off screen.
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
