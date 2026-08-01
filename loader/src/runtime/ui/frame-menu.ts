// What the rail button opens: the manager, and every frame the loader is holding.
//
// The rail button used to open the manager directly. It opens this instead,
// because of the one thing a player could not do: a closed frame has no pixels,
// so the unlock mode cannot reach it and the addon's own keybind was the only
// way back. That is a chord the player never chose, for a window they closed by
// accident, and a live session reported it as the worst part of running several
// addons at once.
//
// The manager stays one gesture away, as the first entry, and the other two
// routes to it are unchanged: the game menu entry and the userscript menu
// command both still open it directly. That matters more than it looks. The
// manager is how a player finds out the loader is broken, so the route that
// survives a game update is deliberately not the one that now goes through a
// menu built out of addon state.
//
// Pure: it takes a roster reading and hands back menu items. Nothing here opens
// the menu, reads the DOM, or knows what a frame is beyond what the roster says.
//
// The list is FLAT. Grouping under a heading per addon was the first shape and it
// doubled the menu for nothing, because every addon in the catalogue owns exactly
// one frame: twelve addons came to twenty-five rows and ran off the bottom of the
// window. The kit now caps a menu's height as well, so this is no longer the
// difference between usable and not, but a menu you have to scroll to find one
// row in is still a worse menu.

import type { RosterEntry } from './kit/frame-roster.ts';
import type { MenuItem } from './kit/menu.ts';

/** What the first entry says. The manager's own label, so the two agree. */
const OPEN_LABEL = 'Addons';

/** Said of a frame that is on screen. A hidden one says nothing, which is the default. */
const SHOWN_SUFFIX = ' (shown)';

/** Drawn when an addon owns frames but the roster is empty of everything else. */
const EMPTY_LABEL = 'No addon windows yet';

/**
 * The arrange-your-UI switch, worded for what pressing it DOES.
 *
 * The manager's checkbox is labelled for the mode ('Unlock frames', ticked or
 * not); a menu row has no tick to carry the state, so it says the action instead
 * and flips. Two strings rather than one with a suffix, because "Unlock frames
 * (on)" reads as a question about whether unlocking is on rather than an offer to
 * lock.
 */
const UNLOCK_LABEL = 'Unlock frames';
const LOCK_LABEL = 'Lock frames';

/**
 * The addon half of an fqid, which is the only half worth a heading.
 *
 * A heading reading `official/longwatch` spends its width on the marketplace,
 * which is the same for every row a player will normally see. The marketplace
 * matters when deciding what to INSTALL, which is the manager's job, and not
 * when looking for a window.
 */
function addonOf(fqid: string): string {
  const at = fqid.lastIndexOf('/');
  if (at < 0) {
    return fqid;
  }
  return fqid.slice(at + 1);
}

/**
 * A row names the frame, and the addon too when the title does not already.
 *
 * FLAT, with no heading per addon, and that is a correction. Grouping was the
 * first shape and it doubled the length of the menu for nothing: every addon in
 * the catalogue owns exactly one frame, so each got a heading of its own with a
 * single row under it, and twelve addons came to twenty-five rows that ran off
 * the bottom of the window.
 *
 * The addon is prefixed only when the title does not already carry it, which is
 * what stops `Longwatch` reading as `longwatch: Longwatch`. Where they differ it
 * is worth the width: a player looking for the window they closed remembers it
 * as Foretell's, and the title on it said `Casts`.
 */
function rowLabel(entry: RosterEntry): string {
  const addon = addonOf(entry.fqid);
  let label = entry.title;
  if (!entry.title.toLowerCase().includes(addon.toLowerCase())) {
    label = `${addon}: ${entry.title}`;
  }
  if (entry.visible) {
    return `${label}${SHOWN_SUFFIX}`;
  }
  return label;
}

/** One frame's row: what it is, and whether it is up. */
function frameItem(entry: RosterEntry): MenuItem {
  return {
    label: rowLabel(entry),
    onSelect: () => {
      if (entry.visible) {
        entry.hide();
        return;
      }
      entry.show();
    },
  };
}

/** What the unlock row offers, which is the opposite of the state it is in. */
function unlockLabel(unlocked: boolean): string {
  if (unlocked) {
    return LOCK_LABEL;
  }
  return UNLOCK_LABEL;
}

/** What the menu can do beyond showing and hiding a frame. */
interface MenuActions {
  openManager: () => void;
  /** Read when the menu is built, so the row says what pressing it will do now. */
  unlocked: () => boolean;
  toggleUnlock: () => void;
}

/**
 * The menu the rail button opens.
 *
 * `openManager` is first and always present, including when no addon has a
 * frame at all: the button's oldest job is still its most important one, and a
 * menu whose only entry was a note about there being nothing to show would be a
 * button that stopped working for a player with no addons installed.
 *
 * Frames follow in registration order, which is stable and means something: an
 * addon's frames come up together, in the order that addon built them. Sorting by
 * label would reshuffle the menu whenever an addon renamed a frame, which is
 * exactly when a player is trying to find one.
 */
function frameMenuItems(entries: readonly RosterEntry[], deps: MenuActions): MenuItem[] {
  const items: MenuItem[] = [
    { label: OPEN_LABEL, onSelect: deps.openManager },
    // Second, and above the frames, because it is about all of them at once: it
    // is the one control that helps when a frame IS on screen and cannot be
    // found, which is the other half of the problem this menu exists for.
    { label: unlockLabel(deps.unlocked()), onSelect: deps.toggleUnlock },
  ];
  if (entries.length === 0) {
    items.push({ label: EMPTY_LABEL, disabled: true, separator: true, onSelect: () => undefined });
    return items;
  }
  for (const [at, entry] of entries.entries()) {
    // One rule under the manager, and none between the frames: a separator on
    // every row is a rule per row, which is the same noise a heading per addon was.
    items.push({ ...frameItem(entry), separator: at === 0 });
  }
  return items;
}

export type { MenuActions };
export { addonOf, EMPTY_LABEL, frameMenuItems, LOCK_LABEL, OPEN_LABEL, SHOWN_SUFFIX, UNLOCK_LABEL };
