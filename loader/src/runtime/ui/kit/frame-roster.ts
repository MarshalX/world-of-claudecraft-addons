// Every frame the loader is holding, so a closed one can be found again.
//
// A hidden frame has no pixels, so neither the unlock mode nor hover can reach it. ONE
// service on the root, like `stacking.ts` and `unlock.ts`.
//
// It holds each frame's own `show` and `hide` rather than toggling the element's class,
// since a `save: true` frame persists its visibility only through those.

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
  /** Register a frame. The teardown removes it, and a frame's own destroy calls it. */
  add: (member: RosterMember) => Teardown;
  /** Every frame, in registration order, with its visibility read fresh. */
  entries: () => readonly RosterEntry[];
}

function createFrameRoster(): FrameRoster {
  // Keyed by the member, so two frames sharing an id stay two rows.
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
        // Read now: visibility changes without the roster hearing (keybind, restore).
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
 * `destroy` is REPLACED IN PLACE, never wrapped in a `{ ...frame }` copy: `visible` is an
 * accessor, and spreading freezes it at its current value. Destroy must be wrapped at all
 * because an addon may destroy a frame mid-session, long before its disposal bag drains.
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
