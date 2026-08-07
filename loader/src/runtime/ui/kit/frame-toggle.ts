// The keybind that shows and hides a frame.
//
// ONE registration per keybind id, with the frames claiming it held as a stack:
// the key toggles the newest, and the registration goes when the last claim does.
// A bind per frame would register '<fqid>:<id>' twice whenever an addon rebuilds a
// frame before destroying the old one, which the dispatcher refuses by design.

import type { Teardown } from '../../disposal.ts';

interface Claim {
  release: Teardown;
  /** Newest last, and the newest is the one the key acts on. */
  togglers: Array<() => void>;
}

interface FrameToggleDeps {
  /** Throws for an undeclared id, which becomes a warning here: a typo must not stop a frame building. */
  bind: (id: string, handler: () => void) => Teardown;
  warn: (message: string, err: unknown) => void;
}

interface FrameToggles {
  /**
   * Bind `bindId` to this frame until the teardown runs. `frameId` only names the
   * frame in a warning, and the teardown is safe even when nothing was bound.
   */
  claim: (bindId: string, frameId: string, toggle: () => void) => Teardown;
}

function createFrameToggles(deps: FrameToggleDeps): FrameToggles {
  const claims = new Map<string, Claim>();

  const drop = (bindId: string, toggle: () => void): void => {
    const claim = claims.get(bindId);
    if (claim === undefined) {
      return;
    }
    const at = claim.togglers.lastIndexOf(toggle);
    if (at !== -1) {
      claim.togglers.splice(at, 1);
    }
    if (claim.togglers.length === 0) {
      claims.delete(bindId);
      claim.release();
    }
  };

  const register = (bindId: string, frameId: string): Claim | null => {
    const togglers: Array<() => void> = [];
    try {
      const release = deps.bind(bindId, () => {
        togglers.at(-1)?.();
      });
      const claim: Claim = { release, togglers };
      claims.set(bindId, claim);
      return claim;
    } catch (err) {
      deps.warn(`frame '${frameId}': toggleKey '${bindId}' is not a declared keybind`, err);
      return null;
    }
  };

  return {
    claim: (bindId, frameId, toggle) => {
      const claim = claims.get(bindId) ?? register(bindId, frameId);
      if (claim === null) {
        return () => undefined;
      }
      claim.togglers.push(toggle);
      return () => {
        drop(bindId, toggle);
      };
    },
  };
}

export type { FrameToggleDeps, FrameToggles };
export { createFrameToggles };
