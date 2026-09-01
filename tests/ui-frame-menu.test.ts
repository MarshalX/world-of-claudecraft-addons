// The rail button's menu: what it lists, and what selecting a row does.
//
// Two subjects, split the way the modules are. `frameMenuItems` is pure and takes
// a roster reading, so most of this needs no DOM at all; the roster itself owns
// the one thing that is not pure, which is that a frame's visibility is read at
// the moment the menu is built rather than when the frame registered.

import { describe, expect, it } from 'vitest';
import {
  EMPTY_LABEL,
  frameMenuItems,
  LOCK_LABEL,
  type MenuActions,
  OPEN_LABEL,
  SHOWN_SUFFIX,
  SNAP_LABEL,
  UNLOCK_LABEL,
} from '../loader/src/runtime/ui/frame-menu.ts';
import { createFrameRoster, rostered } from '../loader/src/runtime/ui/kit/frame-roster.ts';

/** A frame stand-in whose `visible` is an accessor, exactly as the real one is. */
function fakeFrame(shown = false) {
  const state = { shown, destroyed: false };
  return {
    state,
    frame: {
      get visible() {
        return state.shown;
      },
      show: () => {
        state.shown = true;
      },
      hide: () => {
        state.shown = false;
      },
      destroy: () => {
        state.destroyed = true;
      },
    },
  };
}

function labels(items: readonly { label: string }[]): string[] {
  return items.map((item) => item.label);
}

/** The menu's non-frame actions, with the unlock mode locked unless a case says otherwise. */
function actions(over: Partial<MenuActions> = {}): MenuActions {
  return {
    openManager: () => undefined,
    unlocked: () => false,
    toggleUnlock: () => undefined,
    snapping: () => false,
    toggleSnap: () => undefined,
    ...over,
  };
}

describe('the menu the rail button opens', () => {
  // The button's oldest job is still its most important one. A player with no
  // addons installed must not press it and get a note about there being nothing.
  it('offers the manager first, even with nothing to list', () => {
    const items = frameMenuItems([], actions());

    expect(items[0]?.label).toBe(OPEN_LABEL);
    expect(labels(items)).toContain(EMPTY_LABEL);
  });

  // Second, above the frames, because it is the one control that helps when a
  // frame IS on screen and cannot be found: a bare overlay drawing nothing has no
  // pixels to grab, which is the other half of the problem this menu is for.
  it('offers the unlock switch just under the manager', () => {
    const items = frameMenuItems([], actions());

    expect(items[1]?.label).toBe(UNLOCK_LABEL);
  });

  // The row says what pressing it will DO, since a menu row has no tick to carry
  // the state the manager's checkbox carries.
  it('offers to lock again once frames are unlocked', () => {
    const items = frameMenuItems([], actions({ unlocked: () => true }));

    expect(items[1]?.label).toBe(LOCK_LABEL);
  });

  it('flips the mode when chosen', () => {
    let toggled = 0;
    const items = frameMenuItems(
      [],
      actions({
        toggleUnlock: () => {
          toggled += 1;
        },
      }),
    );

    items[1]?.onSelect();

    expect(toggled).toBe(1);
  });

  it('opens the manager when that entry is chosen', () => {
    let opened = 0;
    const items = frameMenuItems(
      [],
      actions({
        openManager: () => {
          opened += 1;
        },
      }),
    );

    items[0]?.onSelect();

    expect(opened).toBe(1);
  });

  // Flat, one row per frame. Grouping under a heading per addon was the first
  // shape and doubled the menu for nothing: every addon owns exactly one frame,
  // so twelve addons came to twenty-five rows and ran off the screen.
  it('lists one row per frame with no heading', () => {
    const entry = (fqid: string, title: string) => ({
      fqid,
      frameId: title,
      title,
      visible: false,
      show: () => undefined,
      hide: () => undefined,
    });
    const items = frameMenuItems(
      [
        entry('official/longwatch', 'Rares'),
        entry('official/satchel', 'Bags'),
        entry('official/longwatch', 'Pins'),
      ],
      actions(),
    );

    expect(labels(items)).toEqual([
      OPEN_LABEL,
      UNLOCK_LABEL,
      SNAP_LABEL,
      'longwatch: Rares',
      'satchel: Bags',
      'longwatch: Pins',
    ]);
  });

  // The addon half of the fqid, not the marketplace: every row a player normally
  // sees comes from the same source, so naming it spends width on nothing.
  it('names the addon when the title does not already', () => {
    const items = frameMenuItems(
      [
        {
          fqid: 'official/foretell',
          frameId: 'casts',
          title: 'Casts',
          visible: false,
          show: () => undefined,
          hide: () => undefined,
        },
      ],
      actions(),
    );

    expect(labels(items)).toContain('foretell: Casts');
  });

  // And does not, when it would read as `longwatch: Longwatch`.
  it('leaves a title that already carries the addon name alone', () => {
    const items = frameMenuItems(
      [
        {
          fqid: 'official/longwatch',
          frameId: 'rares',
          title: 'Longwatch',
          visible: false,
          show: () => undefined,
          hide: () => undefined,
        },
      ],
      actions(),
    );

    expect(labels(items)).toContain('Longwatch');
  });

  it('says which frames are on screen', () => {
    const items = frameMenuItems(
      [
        {
          fqid: 'official/longwatch',
          frameId: 'rares',
          title: 'Rares',
          visible: true,
          show: () => undefined,
          hide: () => undefined,
        },
      ],
      actions(),
    );

    expect(labels(items)).toContain(`longwatch: Rares${SHOWN_SUFFIX}`);
  });

  // One rule, between the two loader actions and the frames, and none between the
  // frames themselves: a separator on every row is a rule per row, which is the
  // noise a heading per addon was.
  it('rules the loader actions off from the frames and nothing else', () => {
    const entry = (title: string) => ({
      fqid: 'official/longwatch',
      frameId: title,
      title,
      visible: false,
      show: () => undefined,
      hide: () => undefined,
    });
    const items = frameMenuItems([entry('Rares'), entry('Pins')], actions());

    expect(items.map((item) => item.separator === true)).toEqual([
      false,
      false,
      false,
      true,
      false,
    ]);
  });
});

describe('the roster behind it', () => {
  it('lists a frame once it is registered', () => {
    const roster = createFrameRoster();
    const { frame } = fakeFrame();

    rostered(roster, { fqid: 'official/longwatch', frameId: 'rares', title: 'Rares' }, frame);

    expect(roster.entries().map((one) => one.title)).toEqual(['Rares']);
  });

  // The whole reason the roster holds the frame's own calls rather than its
  // element: a saved frame records its visibility when it changes, so a class
  // toggled from outside would show it and leave the stored answer saying closed.
  it('shows a closed frame through the frame itself', () => {
    const roster = createFrameRoster();
    const { state, frame } = fakeFrame(false);
    rostered(roster, { fqid: 'official/longwatch', frameId: 'rares', title: 'Rares' }, frame);

    frameMenuItems(roster.entries(), actions())
      .find((item) => item.label === 'longwatch: Rares')
      ?.onSelect();

    expect(state.shown).toBe(true);
  });

  // Read when the menu is built, never cached: a frame's visibility changes
  // without the roster hearing about it, through the addon's own keybind or the
  // restore of a saved box, and a stale answer would be wrong exactly when a
  // player opened the list to find out.
  it('reads visibility fresh rather than remembering it', () => {
    const roster = createFrameRoster();
    const { state, frame } = fakeFrame(false);
    rostered(roster, { fqid: 'official/longwatch', frameId: 'rares', title: 'Rares' }, frame);

    state.shown = true;

    expect(roster.entries()[0]?.visible).toBe(true);
  });

  // Destroy is the addon's to call as well as the loader's, and a bag only drains
  // on disable, so a frame replaced mid-session would otherwise sit in the menu
  // offering to show something that no longer exists.
  it('drops a frame the addon destroyed', () => {
    const roster = createFrameRoster();
    const { frame } = fakeFrame();
    rostered(roster, { fqid: 'official/longwatch', frameId: 'rares', title: 'Rares' }, frame);

    frame.destroy();

    expect(roster.entries()).toEqual([]);
  });

  it('still runs the frame own teardown when it does', () => {
    const roster = createFrameRoster();
    const { state, frame } = fakeFrame();
    rostered(roster, { fqid: 'official/longwatch', frameId: 'rares', title: 'Rares' }, frame);

    frame.destroy();

    expect(state.destroyed).toBe(true);
  });
});

// A tick rather than the flipping label the unlock row carries: snapping does
// nothing until the next drag, so "Turn on snapping" would look like it had failed.
describe('the snap row', () => {
  it('sits directly under the arrange switch, which is the only time it matters', () => {
    const items = frameMenuItems([], actions());

    expect(labels(items).slice(0, 3)).toEqual([OPEN_LABEL, UNLOCK_LABEL, SNAP_LABEL]);
  });

  it('carries the setting as a tick rather than in its wording', () => {
    const off = frameMenuItems([], actions({ snapping: () => false }));
    const on = frameMenuItems([], actions({ snapping: () => true }));

    expect(off[2]?.checked).toBe(false);
    expect(on[2]?.checked).toBe(true);
    expect(on[2]?.label).toBe(SNAP_LABEL);
  });

  it('flips the setting when it is chosen', () => {
    let flipped = 0;
    const items = frameMenuItems(
      [],
      actions({
        toggleSnap: () => {
          flipped += 1;
        },
      }),
    );

    items[2]?.onSelect();

    expect(flipped).toBe(1);
  });
});
