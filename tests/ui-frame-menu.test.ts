// The rail button's menu. `frameMenuItems` is pure; the roster reads each frame's
// visibility when the menu is built.

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
  it('offers the manager first, even with nothing to list', () => {
    const items = frameMenuItems([], actions());

    expect(items[0]?.label).toBe(OPEN_LABEL);
    expect(labels(items)).toContain(EMPTY_LABEL);
  });

  // Above the frames: a bare overlay drawing nothing has no pixels to grab without it.
  it('offers the unlock switch just under the manager', () => {
    const items = frameMenuItems([], actions());

    expect(items[1]?.label).toBe(UNLOCK_LABEL);
  });

  // The label says what pressing it will do, since this row carries no tick.
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

  // Flat: a heading per addon doubles the rows, since each addon owns one frame.
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

  // The addon half of the fqid only: the marketplace is almost always the same one.
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

  // Through the frame's own calls, never its element: a saved frame records its
  // visibility on change, and a class toggled from outside would leave it saying closed.
  it('shows a closed frame through the frame itself', () => {
    const roster = createFrameRoster();
    const { state, frame } = fakeFrame(false);
    rostered(roster, { fqid: 'official/longwatch', frameId: 'rares', title: 'Rares' }, frame);

    frameMenuItems(roster.entries(), actions())
      .find((item) => item.label === 'longwatch: Rares')
      ?.onSelect();

    expect(state.shown).toBe(true);
  });

  // A keybind or a restored box changes visibility without the roster hearing of it.
  it('reads visibility fresh every time', () => {
    const roster = createFrameRoster();
    const { state, frame } = fakeFrame(false);
    rostered(roster, { fqid: 'official/longwatch', frameId: 'rares', title: 'Rares' }, frame);

    state.shown = true;

    expect(roster.entries()[0]?.visible).toBe(true);
  });

  // A bag drains only on disable, so a frame the addon destroys mid-session must leave
  // the menu at destroy.
  it('drops a frame the addon destroyed', () => {
    const roster = createFrameRoster();
    const { frame } = fakeFrame();
    rostered(roster, { fqid: 'official/longwatch', frameId: 'rares', title: 'Rares' }, frame);

    frame.destroy();

    expect(roster.entries()).toEqual([]);
  });

  it('still runs the frame teardown', () => {
    const roster = createFrameRoster();
    const { state, frame } = fakeFrame();
    rostered(roster, { fqid: 'official/longwatch', frameId: 'rares', title: 'Rares' }, frame);

    frame.destroy();

    expect(state.destroyed).toBe(true);
  });
});

// A tick, never a flipping label: snapping does nothing until the next drag, so a
// "Turn on snapping" label would look like it had failed.
describe('the snap row', () => {
  it('sits directly under the arrange switch', () => {
    const items = frameMenuItems([], actions());

    expect(labels(items).slice(0, 3)).toEqual([OPEN_LABEL, UNLOCK_LABEL, SNAP_LABEL]);
  });

  it('carries the setting as a tick', () => {
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
