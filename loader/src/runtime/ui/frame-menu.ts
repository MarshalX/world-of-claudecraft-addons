// What the rail button opens: the manager, and every frame the loader is holding.
//
// A closed frame has no pixels, so the unlock mode cannot reach it; this menu is the way back
// that does not need the addon's keybind. The game menu entry and the userscript command
// still open the manager directly, so the route that survives a game update does not go
// through addon state.
//
// Pure: it takes a roster reading and hands back menu items. The list is flat, with no
// heading per addon, since nearly every addon owns one frame and a heading would double it.

import type { RosterEntry } from './kit/frame-roster.ts';
import type { MenuItem } from './kit/menu.ts';

/** What the first entry says. The manager's own label, so the two agree. */
const OPEN_LABEL = 'Addons';

/** Said of a frame that is on screen. A hidden one says nothing, which is the default. */
const SHOWN_SUFFIX = ' (shown)';

/** Drawn when an addon owns frames but the roster is empty of everything else. */
const EMPTY_LABEL = 'No addon windows yet';

/** The arrange-mode switch, worded for what pressing it does, since the row carries no tick. */
const UNLOCK_LABEL = 'Unlock frames';
const LOCK_LABEL = 'Lock frames';

/**
 * A ticked label rather than a flipping pair: snapping does nothing until the next drag, so
 * an action label would look like it had failed. The game's own wording.
 */
const SNAP_LABEL = 'Snap to grid';

/** The addon half of an fqid; the marketplace half is the same on nearly every row. */
function addonOf(fqid: string): string {
  const at = fqid.lastIndexOf('/');
  if (at < 0) {
    return fqid;
  }
  return fqid.slice(at + 1);
}

/**
 * A row names the frame, prefixed with the addon only when the title does not already carry
 * it, so `Longwatch` does not read as `longwatch: Longwatch`.
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
  /** Read when the menu is built, for the same reason. See ui/snap-store.ts. */
  snapping: () => boolean;
  toggleSnap: () => void;
}

/**
 * The menu the rail button opens. `openManager` is first and always present, even with no
 * frames. Frames follow in registration order; sorting by label would reshuffle the menu
 * whenever an addon renamed a frame.
 */
function frameMenuItems(entries: readonly RosterEntry[], deps: MenuActions): MenuItem[] {
  const items: MenuItem[] = [
    { label: OPEN_LABEL, onSelect: deps.openManager },
    // Above the frames: it helps find a frame that is on screen but cannot be found.
    { label: unlockLabel(deps.unlocked()), onSelect: deps.toggleUnlock },
    // Directly under the switch, since it only means anything while that one is on.
    { label: SNAP_LABEL, checked: deps.snapping(), onSelect: deps.toggleSnap },
  ];
  if (entries.length === 0) {
    items.push({ label: EMPTY_LABEL, disabled: true, separator: true, onSelect: () => undefined });
    return items;
  }
  for (const [at, entry] of entries.entries()) {
    // One rule under the controls, none between the frames.
    items.push({ ...frameItem(entry), separator: at === 0 });
  }
  return items;
}

export type { MenuActions };
export {
  addonOf,
  EMPTY_LABEL,
  frameMenuItems,
  LOCK_LABEL,
  OPEN_LABEL,
  SHOWN_SUFFIX,
  SNAP_LABEL,
  UNLOCK_LABEL,
};
