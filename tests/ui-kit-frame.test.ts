// @vitest-environment happy-dom

// The frame addons build their UI in.
//
// `ui.frame` and `ui.window` are one object with different chrome, so most of
// what is asserted here is the difference between them and the persistence,
// which is the part a player notices across a login.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLOSE_PATH } from '../loader/src/runtime/ui/kit/close-glyph.ts';
import { createAddonFrame, HIDDEN_CLASS } from '../loader/src/runtime/ui/kit/frame.ts';
import { buildChrome, type FrameOpts } from '../loader/src/runtime/ui/kit/frame-chrome.ts';
import { createFrameStateStore } from '../loader/src/runtime/ui/kit/frame-state.ts';
import { frameKey, uiNamespace } from '../loader/src/shared/storage-keys.ts';
import { createFakeStorage, type FakeStorage } from './fakes/storage.ts';

const FQID = 'official/combat-meter';
const CHARACTER = 'Claudemoon/Marshal';
const VIEW = { w: 1280, h: 800 };

function root(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'woc-addons';
  document.body.appendChild(el);
  return el;
}

/** No hub means no persistence, which is how the unstored cases are expressed. */
function stateStore(hub: FakeStorage | null) {
  if (hub === null) {
    return null;
  }
  return createFrameStateStore({ fqid: FQID, hub, channel: 'pbe', character: () => CHARACTER });
}

/** dataset is an index-signature type, so its reads have to be computed. */
function data(el: HTMLElement, key: string): string | undefined {
  return el.dataset[key];
}

function open(
  opts: FrameOpts,
  chrome: 'frame' | 'window' = 'frame',
  hub: FakeStorage | null = null,
) {
  const store = stateStore(hub);
  return createAddonFrame({
    doc: document,
    root: root(),
    fqid: FQID,
    chrome,
    opts,
    store,
    viewport: () => VIEW,
    window: globalThis,
  });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('chrome', () => {
  it('gives a window a close button and a frame none', () => {
    const frame = open({ id: 'a', title: 'DPS' }, 'frame');
    const win = open({ id: 'b', title: 'Config' }, 'window');

    expect(frame.el.querySelector('.woc-close')).toBeNull();
    expect(win.el.querySelector('.woc-close')).not.toBeNull();
  });

  it('carries the game panel class so it inherits the game look', () => {
    expect(open({ id: 'a' }).el.classList.contains('panel')).toBe(true);
  });

  // Two addons may both call a frame 'main', and the game's document is one id
  // space shared with the game, so identity is on data attributes rather than id.
  it('identifies the frame by addon and frame id without taking an element id', () => {
    const frame = open({ id: 'main' });

    expect(data(frame.el, 'wocAddon')).toBe(FQID);
    expect(data(frame.el, 'wocFrame')).toBe('main');
    expect(frame.el.id).toBe('');
  });

  it('adds a class the addon asked for', () => {
    expect(open({ id: 'a', className: 'my-meter' }).el.classList.contains('my-meter')).toBe(true);
  });

  it('names the frame for assistive technology, falling back to its id', () => {
    expect(open({ id: 'a', title: 'DPS' }).el.getAttribute('aria-label')).toBe('DPS');
    expect(open({ id: 'meter' }).el.getAttribute('aria-label')).toBe('meter');
  });

  it('gives a window a dialog role and a frame a group role', () => {
    expect(open({ id: 'a' }, 'window').el.getAttribute('role')).toBe('dialog');
    expect(open({ id: 'b' }, 'frame').el.getAttribute('role')).toBe('group');
  });

  it('retitles both the visible title and the accessible name', () => {
    const frame = open({ id: 'a', title: 'DPS' });

    frame.setTitle('Healing');

    expect(frame.el.querySelector('.woc-title')?.textContent).toBe('Healing');
    expect(frame.el.getAttribute('aria-label')).toBe('Healing');
  });
});

describe('the bare density', () => {
  it('draws no title bar at all, rather than one hidden by a rule', () => {
    const bare = open({ id: 'overlay', title: 'Cooldowns', density: 'bare' });

    expect(bare.el.querySelector('.woc-titlebar')).toBeNull();
    expect(bare.el.classList.contains('woc-density-bare')).toBe(true);
  });

  // A hidden bar would still be a row in the accessibility tree; no bar means the
  // frame's only name is its label, so the label has to be there.
  it('still names itself for assistive technology', () => {
    const bare = open({ id: 'overlay', title: 'Cooldowns', density: 'bare' });

    expect(bare.el.getAttribute('aria-label')).toBe('Cooldowns');
    bare.setTitle('Timers');
    expect(bare.el.getAttribute('aria-label')).toBe('Timers');
  });

  // The residue this was found leaving: with the game's panel class on, an empty
  // bare frame still drew that class's border, so it read as a stray dot on the
  // HUD rather than as nothing at all.
  it('does not wear the game panel class, which is what draws the border', () => {
    const bare = open({ id: 'overlay', density: 'bare' });
    const normal = open({ id: 'panel' });

    expect(bare.el.classList.contains('panel')).toBe(false);
    expect(normal.el.classList.contains('panel')).toBe(true);
  });

  it('keeps the body, which is the whole point of it', () => {
    const bare = open({ id: 'overlay', density: 'bare' });

    expect(bare.body.classList.contains('woc-frame-body')).toBe(true);
    expect(bare.el.contains(bare.body)).toBe(true);
  });

  // The refusal. A window's close button lives in the title bar bare removes, so
  // honouring it would hand back a panel the player cannot dismiss.
  it('is refused on a window, which would otherwise lose its close button', () => {
    const win = open({ id: 'panel', density: 'bare' }, 'window');

    expect(win.el.classList.contains('woc-density-bare')).toBe(false);
    expect(win.el.classList.contains('woc-density-comfortable')).toBe(true);
    expect(win.el.querySelector('.woc-close')).not.toBeNull();
  });

  // Load-bearing: the frame is handed to the gesture layer as its own drag
  // handle, and without it a bare frame has nothing to grab and cannot be moved
  // at all. The title bar is the handle for every other density.
  it('is its own drag handle, since there is no title bar to grab', () => {
    const bare = buildChrome({
      doc: document,
      fqid: FQID,
      chrome: 'frame',
      opts: { id: 'overlay', density: 'bare' },
    });
    const normal = buildChrome({
      doc: document,
      fqid: FQID,
      chrome: 'frame',
      opts: { id: 'panel' },
    });

    expect(bare.handle).toBe(bare.el);
    expect(normal.handle).not.toBe(normal.el);
    expect(normal.handle.classList.contains('woc-titlebar')).toBe(true);
  });

  it('falls back to comfortable for a density nobody offers', () => {
    const odd = open({ id: 'overlay', density: 'roomy' as 'bare' });

    expect(odd.el.classList.contains('woc-density-comfortable')).toBe(true);
  });
});

describe('sizing', () => {
  // A frame is content-sized. Writing a height would leave it padded out or
  // clipped as its text changes.
  it('does not write a size onto a non-resizable frame', () => {
    const frame = open({ id: 'a' }, 'frame');

    expect(frame.el.style.width).toBe('');
    expect(frame.el.style.height).toBe('');
    expect(frame.el.style.left).not.toBe('');
  });

  it('writes a size onto a window', () => {
    const win = open({ id: 'a' }, 'window');

    expect(win.el.style.width).not.toBe('');
    expect(win.el.style.height).not.toBe('');
  });

  it('honours an explicit resizable flag over the chrome default', () => {
    expect(open({ id: 'a', resizable: true }, 'frame').el.style.width).not.toBe('');
    expect(open({ id: 'b', resizable: false }, 'window').el.style.width).toBe('');
  });

  it('opens a window at the width the addon asked for', () => {
    expect(open({ id: 'a', width: 300, height: 200 }, 'window').el.style.width).toBe('300px');
  });
});

// Telling an addon where its frame ended up.
//
// The loader owns the box: it writes the position, the size of a resizable frame,
// and re-clamps both on a restore and on a viewport change. An addon laying its own
// content out against that box (a strip of icons sized by its frame's height) can
// otherwise only measure the element, which forces a synchronous layout on every
// frame of a display that already writes styles every frame.
describe('onMove', () => {
  it('reports the box a saved state restored', async () => {
    const hub = createFakeStorage();
    await hub.set(uiNamespace(FQID), frameKey('pbe', CHARACTER, 'meter'), {
      box: { x: 40, y: 60, w: 240, h: 120 },
      visible: true,
    });
    const seen: number[] = [];

    open(
      { id: 'meter', save: true, resizable: true, onMove: (box) => seen.push(box.h) },
      'frame',
      hub,
    );

    await vi.waitFor(() => expect(seen).toContain(120));
  });

  // The viewport shrinking re-clamps every frame, which can change the box without
  // the player touching anything.
  it('reports a refit driven by the window resizing', () => {
    const seen: number[] = [];
    open({
      id: 'meter',
      resizable: true,
      width: 300,
      height: 200,
      onMove: (box) => seen.push(box.w),
    });

    globalThis.dispatchEvent(new Event('resize'));

    expect(seen).toHaveLength(1);
  });

  // The size an addon asked for is the size it already holds, so reporting it back
  // during construction would fire the handler before the addon has the frame.
  it('says nothing about the initial placement', () => {
    const seen: number[] = [];

    open({ id: 'meter', resizable: true, onMove: (box) => seen.push(box.w) });

    expect(seen).toEqual([]);
  });
});

describe('visibility', () => {
  it('is visible by default and hidden by a class rather than an attribute', () => {
    const frame = open({ id: 'a' });

    expect(frame.visible).toBe(true);
    frame.hide();

    expect(frame.visible).toBe(false);
    expect(frame.el.classList.contains(HIDDEN_CLASS)).toBe(true);
  });

  it('honours an addon that opens it hidden', () => {
    expect(open({ id: 'a', visible: false }).visible).toBe(false);
  });

  it('toggles', () => {
    const frame = open({ id: 'a' });

    frame.toggle();
    expect(frame.visible).toBe(false);
    frame.toggle();
    expect(frame.visible).toBe(true);
  });

  it('closes on the window close button', () => {
    const win = open({ id: 'a' }, 'window');

    win.el.querySelector<HTMLButtonElement>('.woc-close')?.click();

    expect(win.visible).toBe(false);
  });
});

describe('persistence', () => {
  it('saves nothing when the addon did not ask for it', () => {
    const hub = createFakeStorage();
    const frame = open({ id: 'a' }, 'frame', null);

    frame.hide();

    expect(hub.dump()).toEqual({});
  });

  it('saves position and visibility together, per character', async () => {
    const hub = createFakeStorage();
    const frame = open({ id: 'meter', save: true }, 'frame', hub);

    frame.hide();
    await vi.waitFor(() => expect(Object.keys(hub.dump())).toHaveLength(1));

    const key = `${uiNamespace(FQID)}/${frameKey('pbe', CHARACTER, 'meter')}`;
    expect(hub.dump()[key]).toMatchObject({ visible: false });
  });

  it('restores a saved position and visibility', async () => {
    const hub = createFakeStorage();
    await hub.set(uiNamespace(FQID), frameKey('pbe', CHARACTER, 'meter'), {
      box: { x: 40, y: 60, w: 240, h: 120 },
      visible: false,
    });

    const frame = open({ id: 'meter', save: true }, 'frame', hub);
    await vi.waitFor(() => expect(frame.visible).toBe(false));

    expect(frame.el.style.left).toBe('40px');
  });

  // A NaN reaching a style property drops the declaration silently, which would
  // strand the frame off screen with nothing to say why.
  it('ignores a stored state that is not one', async () => {
    const hub = createFakeStorage();
    await hub.set(uiNamespace(FQID), frameKey('pbe', CHARACTER, 'meter'), {
      box: { x: Number.NaN, y: 0, w: 1, h: 1 },
      visible: true,
    });

    const frame = open({ id: 'meter', save: true }, 'frame', hub);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(frame.el.style.left).not.toBe('NaNpx');
  });

  it('does not persist for a character that does not exist yet', async () => {
    const hub = createFakeStorage();
    const store = createFrameStateStore({
      fqid: FQID,
      hub,
      channel: 'pbe',
      character: () => null,
    });

    store.save('meter', { box: { x: 1, y: 2, w: 3, h: 4 }, visible: true });
    expect(await store.load('meter')).toBeNull();

    expect(hub.dump()).toEqual({});
  });

  it('does not persist when storage never connected', async () => {
    const hub = createFakeStorage({ connected: false });
    const store = createFrameStateStore({
      fqid: FQID,
      hub,
      channel: 'pbe',
      character: () => CHARACTER,
    });

    store.save('meter', { box: { x: 1, y: 2, w: 3, h: 4 }, visible: true });

    expect(await store.load('meter')).toBeNull();
  });
});

describe('destroy', () => {
  it('takes the element away', () => {
    const frame = open({ id: 'a' });

    frame.destroy();

    expect(document.querySelector('[data-woc-frame="a"]')).toBeNull();
  });

  it('is idempotent', () => {
    const frame = open({ id: 'a' });

    frame.destroy();

    expect(() => {
      frame.destroy();
    }).not.toThrow();
  });

  // The saved state lands whenever storage answers, which may be after the addon
  // has already been disabled.
  it('does not resurrect a destroyed frame when its saved state arrives', async () => {
    const hub = createFakeStorage();
    await hub.set(uiNamespace(FQID), frameKey('pbe', CHARACTER, 'meter'), {
      box: { x: 40, y: 60, w: 240, h: 120 },
      visible: true,
    });

    const frame = open({ id: 'meter', save: true, visible: false }, 'frame', hub);
    frame.destroy();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(frame.visible).toBe(false);
    expect(document.querySelector('[data-woc-frame="meter"]')).toBeNull();
  });
});

// The density variant, which is the one thing about a frame's chrome an addon
// chooses rather than inherits.
//
// An enum rather than a `compact: true` flag: the axis has more than two useful
// positions and a boolean cannot grow one. What the test pins is that the choice
// reaches the element as a class, since everything the variant does is CSS, and
// that an unrecognised value falls back to the ACCESSIBLE default rather than to
// the compact one. Getting that backwards would let a typo silently take the
// tap-target floor away.
describe('density', () => {
  it('defaults to comfortable, which is the accessible sizing', () => {
    const frame = open({ id: 'meter' });

    expect(frame.el.classList.contains('woc-density-comfortable')).toBe(true);
    expect(frame.el.classList.contains('woc-density-compact')).toBe(false);
  });

  it('marks a compact frame so the stylesheet can find it', () => {
    const frame = open({ id: 'meter', density: 'compact' });

    expect(frame.el.classList.contains('woc-density-compact')).toBe(true);
  });

  // A value from a manifest-driven addon is untrusted input like anything else,
  // and the failure mode to avoid is silently dropping the tap-target floor.
  it('falls back to comfortable for a value it does not know', () => {
    const frame = open({ id: 'meter', density: 'tiny' as 'compact' });

    expect(frame.el.classList.contains('woc-density-comfortable')).toBe(true);
  });
});

// The close button's mark.
//
// It was the `×` character, which inherits the title bar's serif font and so
// renders at whatever weight and optical size that font gives it: thin,
// off-centre, and visibly not the mark the game's own close buttons use. A
// stroked path is the same shape at every size.
describe('the close button', () => {
  // Named against the shared constant, not against a copy of the path: the
  // manager renders the same mark from the same place, and the failure this
  // guards is one of the two renderers quietly going its own way.
  it('draws the shared glyph rather than a text character', () => {
    const frame = open({ id: 'meter' }, 'window');
    const close = frame.el.querySelector('.woc-close');

    expect(close?.querySelector('path')?.getAttribute('d')).toBe(CLOSE_PATH);
    expect(close?.textContent).toBe('');
  });

  // currentColor is what makes it take the gold on hover from the same rule the
  // text version did. A hard-coded fill would go dead against the theme.
  it('strokes with currentColor so the hover state still reaches it', () => {
    const frame = open({ id: 'meter' }, 'window');
    const path = frame.el.querySelector('.woc-close path');

    expect(path?.getAttribute('stroke')).toBe('currentColor');
  });

  it('is still named for a screen reader, which the glyph cannot be', () => {
    const frame = open({ id: 'meter' }, 'window');
    const close = frame.el.querySelector('.woc-close');

    expect(close?.getAttribute('aria-label')).toBe('Close');
    expect(close?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  // A frame is HUD furniture with no close button at all: one there would offer
  // to close something the player can only get back through the manager.
  it('is absent on a frame', () => {
    const frame = open({ id: 'meter' }, 'frame');

    expect(frame.el.querySelector('.woc-close')).toBeNull();
  });
});

// A new window opens in front.
//
// A click raises a window, but a window nobody has clicked yet holds no z-index
// at all, so without this a brand-new frame would open UNDER every window that
// had been clicked since the session began. Showing a hidden one is the same
// case: it has been out of the stack and has to come back to the top of it.
describe('stacking', () => {
  function raising() {
    const raised: HTMLElement[] = [];
    const store = stateStore(null);
    const make = (opts: FrameOpts, chrome: 'frame' | 'window' = 'window') =>
      createAddonFrame({
        doc: document,
        root: root(),
        fqid: FQID,
        chrome,
        opts,
        store,
        viewport: () => VIEW,
        window: globalThis,
        raise: (el) => raised.push(el),
      });
    return { raised, make };
  }

  it('raises a frame the moment it is built', () => {
    const { raised, make } = raising();
    const frame = make({ id: 'meter' });

    expect(raised).toEqual([frame.el]);
  });

  it('raises it again when a hidden one is shown', () => {
    const { raised, make } = raising();
    const frame = make({ id: 'meter', visible: false });
    raised.length = 0;

    frame.show();

    expect(raised).toEqual([frame.el]);
  });

  // Hiding is not a stacking event: nothing about the order of what is left
  // changes, and raising on the way out would put a window players just dismissed
  // at the top of the order for the next time it opens.
  it('does not raise on hide', () => {
    const { raised, make } = raising();
    const frame = make({ id: 'meter' });
    raised.length = 0;

    frame.hide();

    expect(raised).toEqual([]);
  });

  // Optional, because the frame kit is also driven by suites that have no
  // stacking service and by any future caller that does not want one.
  it('works with no raise at all', () => {
    expect(() => open({ id: 'meter' }, 'window')).not.toThrow();
  });
});
