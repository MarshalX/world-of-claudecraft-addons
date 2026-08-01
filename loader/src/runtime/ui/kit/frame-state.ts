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
//
// READS wait for the character, and that is the whole of a bug this shipped with.
// An addon builds its frames on its first line, which is document-start: there is
// no character then, so there is no key, so the one read of a saved position
// happened on the landing page, found nothing, and was never tried again. Every
// addon frame opened at its default spot on every reload, stacked on top of each
// other, and a frame the player had closed came back. The key exists at world
// entry, so the read waits for it.

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
  /**
   * The character in play, or null before world entry.
   *
   * Resolved per call rather than captured: an addon may build its frames before
   * the player has entered the world, and a null captured then would mean the
   * frame never persisted for the whole session.
   */
  character: () => string | null;
  /**
   * Resolves once `character()` will answer. See the note at the top.
   *
   * A read waits for it; a WRITE does not. A write before world entry has nowhere
   * to go and nothing to say: frames are hidden while the game's HUD is absent, so
   * there is no gesture that could have produced one.
   *
   * Called rather than awaited directly, because asking costs a world subscription
   * and a frame that does not persist must not pay for one.
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
    return perCharacterKey(deps.channel, character, frameId);
  };

  return {
    load: async (frameId) => {
      if (!deps.hub.connected) {
        return null;
      }
      // Never resolves for a player who does not enter the world, which is
      // correct: there is no per-character state to restore for a character that
      // does not exist, and their frames are hidden with the HUD anyway.
      await deps.known();
      const key = keyFor(frameId);
      if (key === null) {
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
