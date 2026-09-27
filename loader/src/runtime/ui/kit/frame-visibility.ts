// Whether a frame is on screen, and who gets to decide.
//
// Three parties want a say, in this order: the addon when it builds the frame, the player at
// any moment, and STORAGE, which is per character and cannot answer until world entry.
//
// So a frame that saves its visibility starts hidden and `restore` applies what was stored;
// it is hidden with the HUD until world entry anyway. A frame with nothing stored shows
// immediately.
//
// `claimed` means someone pressed something, so the stored answer must not overrule them.
// `settled` means the answer has landed; nothing is WRITTEN before it, or a save would replace
// the stored position with the default box.

/** On the frame element while it is hidden. Display, not visibility: no hit area. */
const HIDDEN_CLASS = 'woc-hidden';

interface VisibilityDeps {
  el: HTMLElement;
  /** What the addon asked for. Used only when nothing was stored. */
  wanted: boolean;
  /** Whether a stored answer is coming at all. A frame without one never waits. */
  stored: boolean;
  /** Re-clamp and raise, which only make sense on an element with a size. */
  onShown: () => void;
  /** Write the state down. Called only once the stored answer has landed. */
  save: (visible: boolean) => void;
}

interface Visibility {
  isVisible: () => boolean;
  /** The addon or the player deciding. Claims the frame and persists. */
  set: (next: boolean) => void;
  /**
   * Write down what is on screen now, unchanged: the end of a drag or a resize. Gated on `settled`.
   */
  commit: () => void;
  /** What storage said, which loses to anything already claimed. */
  restore: (next: boolean) => void;
  /** The stored answer has landed, whatever it was. */
  settled: () => void;
}

function createVisibility(deps: VisibilityDeps): Visibility {
  let visible = !deps.stored && deps.wanted;
  let claimed = false;
  let settled = false;

  const paint = (): void => {
    deps.el.classList.toggle(HIDDEN_CLASS, !visible);
  };
  paint();

  /** Returns whether anything moved, so a no-op does not repaint or re-clamp. */
  const apply = (next: boolean): boolean => {
    if (visible === next) {
      return false;
    }
    visible = next;
    paint();
    // Re-clamped on show, since a hidden element measures as zero.
    if (visible) {
      deps.onShown();
    }
    return true;
  };

  const persist = (): void => {
    if (settled) {
      deps.save(visible);
    }
  };

  return {
    isVisible: () => visible,

    set: (next) => {
      claimed = true;
      if (apply(next)) {
        persist();
      }
    },

    commit: persist,

    restore: (next) => {
      if (!claimed) {
        apply(next);
      }
    },

    settled: () => {
      settled = true;
      // A press before the answer arrived is saved now, against the restored box.
      if (claimed) {
        persist();
      }
    },
  };
}

export type { Visibility, VisibilityDeps };
export { createVisibility, HIDDEN_CLASS };
