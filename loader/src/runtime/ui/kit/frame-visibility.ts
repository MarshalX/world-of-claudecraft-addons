// Whether a frame is on screen, and who gets to decide.
//
// Three parties want a say and they arrive in this order: the addon, which asked
// for something when it built the frame; the player, who may press its toggle key
// or its close button at any moment; and STORAGE, which knows what the player left
// it as last session and cannot answer until world entry.
//
// That last part is the whole reason this is a state machine rather than a
// boolean. Per-character state is keyed on realm plus character name, so there is
// no key to read under until the player is in the world, while an addon builds its
// frames at document-start. Every addon window therefore opened at its default
// visibility on every reload, including the ones the player had closed, and by the
// time the answer could have been read nothing was asking any more.
//
// So a frame that saves its visibility does not guess it. It starts hidden, and
// `restore` applies what was stored. Nothing is lost by waiting: a frame is hidden
// with the game's HUD until world entry anyway, which is the same moment the
// answer becomes readable. A frame with nothing stored is unaffected and shows
// immediately, because there is no answer to wait for.
//
// The two flags are what make the three parties agree. `claimed` means someone
// pressed something, so the stored answer is stale and must not overrule them;
// `settled` means the answer has landed, before which nothing is WRITTEN, because
// until then the frame is sitting at its default box rather than the one storage
// is holding for it and a write would replace a saved position with the middle of
// the screen.

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
   * Write down what is on screen now, unchanged: the end of a drag or a resize.
   *
   * Here rather than beside the gestures because the gate is here. A write before
   * the stored answer has landed would replace a saved position with the default
   * one, and that rule has to hold for the box as much as for the visibility.
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
    // Re-clamped on show: the viewport may have changed while it was hidden, and
    // a hidden element measures as zero, so the clamp could not run then.
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
      // A press made before the answer arrived changed nothing to write at the
      // time, since a saved frame starts hidden already. It is recorded here
      // instead, against the box the restore has just put underneath it.
      if (claimed) {
        persist();
      }
    },
  };
}

export type { Visibility, VisibilityDeps };
export { createVisibility, HIDDEN_CLASS };
