// Every frame the loader is holding, so a closed one can be found again.
//
// It exists because a closed frame is unreachable. `hide()` puts a class on the
// element that removes it from display, so it has no pixels, and the unlock mode
// cannot help for the same reason hover cannot: both need something to be over.
// That left the toggle keybind as the only way back, which means a player who
// closes a window has to know, or go and look up, a chord they never chose. A
// live session reported exactly that.
//
// ONE service on the root rather than an affordance per frame, which is the
// shape `stacking.ts` and `unlock.ts` already take and for the same reason: any
// frame a future addon creates participates the day it is written, and a player
// with a window they cannot find never has to work out which addon owns it.
//
// It holds the frame's own `show` and `hide` rather than touching the element,
// and that is the whole reason it is a registry rather than a DOM query. A
// `save: true` frame records its visibility per character when it changes, so a
// class toggled from outside would put the frame on screen and leave the stored
// answer saying it is closed: back again on this login, gone again on the next.

import type { Teardown } from '../../disposal.ts';

/** One frame, as the roster knows it. */
interface RosterEntry {
  /** The owning addon's fqid, which is what the entries are grouped by. */
  readonly fqid: string;
  /** The addon's own id for it, unique within that addon and stable across sessions. */
  readonly frameId: string;
  /** What to call it: the frame's title, or its id when it has none. */
  readonly title: string;
  readonly visible: boolean;
  show: () => void;
  hide: () => void;
}

/** What a frame hands the roster when it registers. */
interface RosterMember {
  readonly fqid: string;
  readonly frameId: string;
  readonly title: string;
  readonly visible: () => boolean;
  readonly show: () => void;
  readonly hide: () => void;
}

interface FrameRoster {
  /**
   * Register a frame. The teardown removes it, and a frame's own destroy calls it.
   *
   * A disabled addon's frames go with it, which is right: there is nothing to
   * show, and offering to show it would be offering to start an addon from a
   * menu that is not about starting addons.
   */
  add: (member: RosterMember) => Teardown;
  /**
   * Every frame, in registration order, with its visibility read fresh.
   *
   * Order is registration rather than alphabetical because it is stable and
   * means something: an addon's frames come up together, in the order that addon
   * built them. Sorting by title would reshuffle the list whenever an addon
   * renamed a frame, and grouping is the caller's to do.
   */
  entries: () => readonly RosterEntry[];
}

function createFrameRoster(): FrameRoster {
  // Insertion-ordered, and keyed by the member so two frames of one addon with
  // the same id (which the manifest cannot prevent across marketplaces) are still
  // two rows rather than one overwriting the other.
  const members = new Set<RosterMember>();

  return {
    add: (member) => {
      members.add(member);
      return () => {
        members.delete(member);
      };
    },

    entries: () =>
      [...members].map((member) => ({
        fqid: member.fqid,
        frameId: member.frameId,
        title: member.title,
        // Read now rather than stored: a frame's visibility changes without the
        // roster hearing about it, through the addon's own keybind or through the
        // restore of a saved box, and a cached answer would be wrong exactly when
        // a player opened this list to find out.
        visible: member.visible(),
        show: member.show,
        hide: member.hide,
      })),
  };
}

/** The two calls a rostered frame needs beyond what the roster itself takes. */
interface RosterableFrame {
  readonly visible: boolean;
  show: () => void;
  hide: () => void;
  destroy: () => void;
}

/**
 * Put a frame on the roster, and make its own destroy take it off again.
 *
 * The frame's `destroy` is REPLACED IN PLACE rather than wrapped in a copy, and
 * that is not a style preference. A frame's `visible` is an accessor over live
 * state, so `{ ...frame }` reads it once and freezes the answer: every addon's
 * draw loop then saw a frame that was permanently hidden, because the value
 * copied was the one it had before anything showed it. Spreading an object with
 * accessors takes their values, not the accessors.
 *
 * Wrapping destroy at all is the part that is easy to leave out and expensive to
 * leave out. Destroy is the ADDON's to call as well as the loader's, and several
 * addons do call it: a layout that cannot be repainted into is rebuilt by
 * throwing the frame away. A disposal bag only drains on disable, so a frame an
 * addon replaced mid-session would sit on the roster offering to show something
 * that no longer exists.
 */
function rostered(
  roster: FrameRoster,
  member: Omit<RosterMember, 'visible' | 'show' | 'hide'>,
  frame: RosterableFrame,
): Teardown {
  const forget = roster.add({
    ...member,
    visible: () => frame.visible,
    show: () => {
      frame.show();
    },
    hide: () => {
      frame.hide();
    },
  });
  const own = frame.destroy;
  frame.destroy = () => {
    forget();
    own();
  };
  return forget;
}

export type { FrameRoster, RosterableFrame, RosterEntry, RosterMember };
export { createFrameRoster, rostered };
