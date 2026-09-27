// @vitest-environment happy-dom

// `ui.frame` and `ui.window` are one object with different chrome; this pins the
// difference between them and the persistence.

import interact from 'interactjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LABEL_BELOW_CLASS } from '../loader/src/runtime/ui/frame/geometry.ts';
import { NO_SNAP, SNAP_GRID } from '../loader/src/runtime/ui/frame/snap.ts';
import { CLOSE_PATH } from '../loader/src/runtime/ui/kit/close-glyph.ts';
import { createAddonFrame, gestureDeps } from '../loader/src/runtime/ui/kit/frame.ts';
import {
  buildChrome,
  type FrameOpts,
  LABEL_ATTR,
} from '../loader/src/runtime/ui/kit/frame-chrome.ts';
import type { FrameArrange } from '../loader/src/runtime/ui/kit/frame-gestures.ts';
import { createFrameStateStore } from '../loader/src/runtime/ui/kit/frame-state.ts';
import { HIDDEN_CLASS } from '../loader/src/runtime/ui/kit/frame-visibility.ts';
import { createUnlockMode, type UnlockMode } from '../loader/src/runtime/ui/kit/unlock.ts';
import { perCharacterKey, uiNamespace } from '../loader/src/shared/storage-keys.ts';
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
  return createFrameStateStore({
    fqid: FQID,
    hub,
    channel: 'pbe',
    character: () => CHARACTER,
    known: () => Promise.resolve(),
  });
}

/**
 * A completed drag on a frame's handle. interactjs moves no box under happy-dom, so
 * this drives the gesture ending, which is the half that writes.
 */
function drag(handle: HTMLElement): void {
  const at = (clientX: number, clientY: number) => ({
    clientX,
    clientY,
    pointerId: 1,
    bubbles: true,
  });
  handle.dispatchEvent(new PointerEvent('pointerdown', at(150, 120)));
  document.dispatchEvent(new PointerEvent('pointermove', at(200, 160)));
  document.dispatchEvent(new PointerEvent('pointerup', at(200, 160)));
}

/** dataset is an index-signature type, so its reads have to be computed. */
function data(el: HTMLElement, key: string): string | undefined {
  return el.dataset[key];
}

/** The optional dependency, present or absent rather than present and undefined. */
function arrangeDep(arrange?: FrameArrange): { arrange?: FrameArrange } {
  if (arrange === undefined) {
    return {};
  }
  return { arrange };
}

function open(
  opts: FrameOpts,
  chrome: 'frame' | 'window' = 'frame',
  hub: FakeStorage | null = null,
  arrange?: FrameArrange,
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
    // exactOptionalPropertyTypes refuses a spread undefined.
    ...arrangeDep(arrange),
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

  // Two addons may both call a frame 'main' in a document shared with the game.
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
  it('draws no title bar', () => {
    const bare = open({ id: 'overlay', title: 'Cooldowns', density: 'bare' });

    expect(bare.el.querySelector('.woc-titlebar')).toBeNull();
    expect(bare.el.classList.contains('woc-density-bare')).toBe(true);
  });

  // With no title bar the label is the frame's only name.
  it('still names itself for assistive technology', () => {
    const bare = open({ id: 'overlay', title: 'Cooldowns', density: 'bare' });

    expect(bare.el.getAttribute('aria-label')).toBe('Cooldowns');
    bare.setTitle('Timers');
    expect(bare.el.getAttribute('aria-label')).toBe('Timers');
  });

  // The panel class draws a border, so an empty bare frame would show as a stray dot.
  it('does not wear the game panel class', () => {
    const bare = open({ id: 'overlay', density: 'bare' });
    const normal = open({ id: 'panel' });

    expect(bare.el.classList.contains('panel')).toBe(false);
    expect(normal.el.classList.contains('panel')).toBe(true);
  });

  it('keeps the body', () => {
    const bare = open({ id: 'overlay', density: 'bare' });

    expect(bare.body.classList.contains('woc-frame-body')).toBe(true);
    expect(bare.el.contains(bare.body)).toBe(true);
  });

  // A window's close button lives in the title bar bare removes.
  it('is refused on a window', () => {
    const win = open({ id: 'panel', density: 'bare' }, 'window');

    expect(win.el.classList.contains('woc-density-bare')).toBe(false);
    expect(win.el.classList.contains('woc-density-comfortable')).toBe(true);
    expect(win.el.querySelector('.woc-close')).not.toBeNull();
  });

  // Without this a bare frame has nothing to grab and cannot be moved at all.
  it('is its own drag handle', () => {
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

// Only the class: every .css import resolves to '' under vitest. The class is the
// whole contract between frame-chrome.ts and styles/chrome.css.
describe('the pointer policy', () => {
  // The game binds world mousedown and wheel to its canvas, so a solid overlay takes
  // targeting, camera look and zoom.
  it('makes a bare frame click-through where it drew nothing', () => {
    expect(
      open({ id: 'overlay', density: 'bare' }).el.classList.contains('woc-pointer-content'),
    ).toBe(true);
  });

  it('leaves every other density solid', () => {
    expect(open({ id: 'a' }).el.classList.contains('woc-pointer-auto')).toBe(true);
    expect(open({ id: 'b', density: 'compact' }).el.classList.contains('woc-pointer-auto')).toBe(
      true,
    );
  });

  it('honours what the addon asked for over the density default', () => {
    const inert = open({ id: 'overlay', density: 'bare', pointer: 'none' });
    const solid = open({ id: 'strip', density: 'bare', pointer: 'auto' });

    expect(inert.el.classList.contains('woc-pointer-none')).toBe(true);
    expect(solid.el.classList.contains('woc-pointer-auto')).toBe(true);
  });

  // A typo must not punch a hole in a panel the player has to click.
  it('falls back to the density default for a value nobody offers', () => {
    const odd = open({ id: 'a', pointer: 'ghost' as 'none' });
    const oddBare = open({ id: 'b', density: 'bare', pointer: 'ghost' as 'none' });

    expect(odd.el.classList.contains('woc-pointer-auto')).toBe(true);
    expect(oddBare.el.classList.contains('woc-pointer-content')).toBe(true);
  });
});

describe('sizing', () => {
  // A written height clips rows with nothing on screen to say so.
  it('does not write a height onto a non-resizable frame', () => {
    const frame = open({ id: 'a' }, 'frame');

    expect(frame.el.style.height).toBe('');
    expect(frame.el.style.left).not.toBe('');
  });

  // A width, not a max-width: under a ceiling the panel still steps in and out as
  // its content reflows.
  it('holds a non-resizable frame to the width it declared', () => {
    const frame = open({ id: 'a', width: 300 }, 'frame');

    expect(frame.el.style.width).toBe('300px');
    expect(frame.el.style.height).toBe('');
  });

  it('falls back to the default frame width when the addon named none', () => {
    expect(open({ id: 'a' }, 'frame').el.style.width).toBe('240px');
  });

  // frame/interactive.ts owns a resizable frame's box.
  it('leaves a resizable frame to the layer that owns its box', () => {
    expect(open({ id: 'a', width: 300, resizable: true }, 'frame').el.style.maxWidth).toBe('');
  });

  it('writes a size onto a window', () => {
    const win = open({ id: 'a' }, 'window');

    expect(win.el.style.width).not.toBe('');
    expect(win.el.style.height).not.toBe('');
  });

  // Asserted on the height: applyWidth writes a width either way, and only the
  // gesture layer writes a height.
  it('honours an explicit resizable flag over the chrome default', () => {
    expect(open({ id: 'a', resizable: true }, 'frame').el.style.height).not.toBe('');
    expect(open({ id: 'b', resizable: false }, 'window').el.style.height).toBe('');
  });

  it('opens a window at the width the addon asked for', () => {
    expect(open({ id: 'a', width: 300, height: 200 }, 'window').el.style.width).toBe('300px');
  });
});

// The arithmetic is in frame-geometry.test.ts; this pins that the four numbers reach
// the clamp on the restore path, the only one that applies a box the loader did not compute.
describe('the size bounds', () => {
  const saved = async (hub: FakeStorage, box: { w: number; h: number }): Promise<void> => {
    await hub.set(uiNamespace(FQID), perCharacterKey('pbe', CHARACTER, 'strip'), {
      box: { x: 40, y: 60, ...box },
      visible: true,
    });
  };

  // Without minWidth the opening size is the floor.
  it('lets a saved box come back smaller than the opening size', async () => {
    const hub = createFakeStorage();
    await saved(hub, { w: 140, h: 80 });

    const frame = open(
      { id: 'strip', save: true, resizable: true, width: 400, height: 200, minWidth: 100 },
      'frame',
      hub,
    );
    await vi.waitUntil(() => frame.el.style.width === '140px');

    expect(frame.el.style.width).toBe('140px');
  });

  it('holds a saved box up to the minimum', async () => {
    const hub = createFakeStorage();
    await saved(hub, { w: 90, h: 80 });

    const frame = open(
      { id: 'strip', save: true, resizable: true, width: 400, minWidth: 200, minHeight: 120 },
      'frame',
      hub,
    );
    await vi.waitUntil(() => frame.el.style.width === '200px');

    expect(frame.el.style.height).toBe('120px');
  });

  it('holds a saved box down to the maximum', async () => {
    const hub = createFakeStorage();
    await saved(hub, { w: 900, h: 700 });

    const frame = open(
      { id: 'strip', save: true, resizable: true, width: 400, maxWidth: 500, maxHeight: 300 },
      'frame',
      hub,
    );
    await vi.waitUntil(() => frame.el.style.width === '500px');

    expect(frame.el.style.height).toBe('300px');
  });

  it('leaves the axis an addon did not bound alone', async () => {
    const hub = createFakeStorage();
    await saved(hub, { w: 900, h: 700 });

    const frame = open(
      { id: 'strip', save: true, resizable: true, width: 400, maxWidth: 500 },
      'frame',
      hub,
    );
    await vi.waitUntil(() => frame.el.style.width === '500px');

    expect(frame.el.style.height).toBe('700px');
  });
});

// The loader owns the box, so without onMove an addon laying out against it would
// have to measure the element and force a layout every frame.
describe('onMove', () => {
  it('reports the box a saved state restored', async () => {
    const hub = createFakeStorage();
    await hub.set(uiNamespace(FQID), perCharacterKey('pbe', CHARACTER, 'meter'), {
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

  // Firing during construction would reach the handler before the addon has the frame.
  it('says nothing about the initial placement', () => {
    const seen: number[] = [];

    open({ id: 'meter', resizable: true, onMove: (box) => seen.push(box.w) });

    expect(seen).toEqual([]);
  });
});

describe('visibility', () => {
  it('is visible by default and hidden by a class', () => {
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

// Frames are built at document-start, before there is a character to key the saved
// state on, so a saved frame starts hidden and the stored answer decides at world entry.
describe('a frame whose state is saved', () => {
  it('starts hidden whatever it asked for', () => {
    const hub = createFakeStorage();

    const frame = open({ id: 'meter', save: true, visible: true }, 'frame', hub);

    expect(frame.visible).toBe(false);
  });

  it('shows itself once nothing turns out to have been stored', async () => {
    const hub = createFakeStorage();

    const frame = open({ id: 'meter', save: true }, 'frame', hub);

    await vi.waitFor(() => expect(frame.visible).toBe(true));
  });

  it('stays hidden when that is what was stored', async () => {
    const hub = createFakeStorage();
    await hub.set(uiNamespace(FQID), perCharacterKey('pbe', CHARACTER, 'meter'), {
      box: { x: 40, y: 60, w: 240, h: 120 },
      visible: false,
    });

    const frame = open({ id: 'meter', save: true, visible: true }, 'frame', hub);
    await vi.waitFor(() => expect(frame.el.style.left).toBe('40px'));

    expect(frame.visible).toBe(false);
  });

  // The player may press the toggle key before the answer lands; the press wins.
  it('does not overrule a toggle pressed before the answer arrived', async () => {
    const hub = createFakeStorage();
    await hub.set(uiNamespace(FQID), perCharacterKey('pbe', CHARACTER, 'meter'), {
      box: { x: 40, y: 60, w: 240, h: 120 },
      visible: false,
    });

    const frame = open({ id: 'meter', save: true }, 'frame', hub);
    frame.show();
    await vi.waitFor(() => expect(frame.el.style.left).toBe('40px'));

    expect(frame.visible).toBe(true);
  });

  it('records an early press against the restored box', async () => {
    const hub = createFakeStorage();
    const key = `${uiNamespace(FQID)}/${perCharacterKey('pbe', CHARACTER, 'meter')}`;
    await hub.set(uiNamespace(FQID), perCharacterKey('pbe', CHARACTER, 'meter'), {
      box: { x: 40, y: 60, w: 240, h: 120 },
      visible: false,
    });

    const frame = open({ id: 'meter', save: true }, 'frame', hub);
    frame.show();

    await vi.waitFor(() => {
      expect(hub.dump()[key]).toMatchObject({ visible: true, box: { x: 40 } });
    });
  });

  it('is visible at once when the addon never asked to save', () => {
    const frame = open({ id: 'meter' }, 'frame', null);

    expect(frame.visible).toBe(true);
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

    const key = `${uiNamespace(FQID)}/${perCharacterKey('pbe', CHARACTER, 'meter')}`;
    expect(hub.dump()[key]).toMatchObject({ visible: false });
  });

  // A write that compares first would save nothing for a drag that moved only the position.
  it('writes the state down when a drag ends', async () => {
    const hub = createFakeStorage();
    const frame = open({ id: 'meter', save: true, title: 'Meter' }, 'window', hub);
    // Before the answer lands the frame sits at its default box.
    await vi.waitFor(() => expect(frame.visible).toBe(true));

    drag(frame.el.querySelector<HTMLElement>('.woc-titlebar') as HTMLElement);

    const key = `${uiNamespace(FQID)}/${perCharacterKey('pbe', CHARACTER, 'meter')}`;
    await vi.waitFor(() => {
      expect(hub.dump()[key]).toBeDefined();
    });
  });

  // A write here would put the default box over last session's position.
  it('writes nothing from a drag made before the saved state arrived', () => {
    const hub = createFakeStorage();
    const frame = open({ id: 'meter', save: true, title: 'Meter' }, 'window', hub);

    drag(frame.el.querySelector<HTMLElement>('.woc-titlebar') as HTMLElement);

    expect(hub.dump()).toEqual({});
  });

  it('restores a saved position and visibility', async () => {
    const hub = createFakeStorage();
    await hub.set(uiNamespace(FQID), perCharacterKey('pbe', CHARACTER, 'meter'), {
      box: { x: 40, y: 60, w: 240, h: 120 },
      visible: false,
    });

    const frame = open({ id: 'meter', save: true }, 'frame', hub);

    // Waited on position: a saved frame starts hidden whatever it stored.
    await vi.waitFor(() => expect(frame.el.style.left).toBe('40px'));
    expect(frame.visible).toBe(false);
  });

  // A NaN style declaration is dropped silently and strands the frame off screen.
  it('ignores an invalid stored state', async () => {
    const hub = createFakeStorage();
    await hub.set(uiNamespace(FQID), perCharacterKey('pbe', CHARACTER, 'meter'), {
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
      // Resolved with no character: an offline session with no player entity.
      known: () => Promise.resolve(),
    });

    store.save('meter', { box: { x: 1, y: 2, w: 3, h: 4 }, visible: true });
    expect(await store.load('meter')).toBeNull();

    expect(hub.dump()).toEqual({});
  });

  it('waits for the character before reading', async () => {
    const hub = createFakeStorage();
    let character: string | null = null;
    let arrive = (): void => undefined;
    const known = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    await hub.set(uiNamespace(FQID), perCharacterKey('pbe', CHARACTER, 'meter'), {
      box: { x: 7, y: 8, w: 9, h: 10 },
      visible: true,
    });
    const store = createFrameStateStore({
      fqid: FQID,
      hub,
      channel: 'pbe',
      character: () => character,
      known: () => known,
    });

    const reading = store.load('meter');
    character = CHARACTER;
    arrive();

    expect(await reading).toMatchObject({ box: { x: 7 } });
  });

  it('does not persist when storage never connected', async () => {
    const hub = createFakeStorage({ connected: false });
    const store = createFrameStateStore({
      fqid: FQID,
      hub,
      channel: 'pbe',
      character: () => CHARACTER,
      known: () => Promise.resolve(),
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

  // Storage may answer after the addon was disabled.
  it('does not resurrect a destroyed frame when its saved state arrives', async () => {
    const hub = createFakeStorage();
    await hub.set(uiNamespace(FQID), perCharacterKey('pbe', CHARACTER, 'meter'), {
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

// An unrecognised density falls back to comfortable, so a typo cannot drop the
// tap-target floor.
describe('density', () => {
  it('defaults to comfortable', () => {
    const frame = open({ id: 'meter' });

    expect(frame.el.classList.contains('woc-density-comfortable')).toBe(true);
    expect(frame.el.classList.contains('woc-density-compact')).toBe(false);
  });

  it('marks a compact frame', () => {
    const frame = open({ id: 'meter', density: 'compact' });

    expect(frame.el.classList.contains('woc-density-compact')).toBe(true);
  });

  it('falls back to comfortable for a value it does not know', () => {
    const frame = open({ id: 'meter', density: 'tiny' as 'compact' });

    expect(frame.el.classList.contains('woc-density-comfortable')).toBe(true);
  });
});

// A text `×` inherits the serif title font and renders thin and off-centre.
describe('the close button', () => {
  // Asserted against the shared constant so the manager's renderer cannot drift.
  it('draws the shared glyph', () => {
    const frame = open({ id: 'meter' }, 'window');
    const close = frame.el.querySelector('.woc-close');

    expect(close?.querySelector('path')?.getAttribute('d')).toBe(CLOSE_PATH);
    expect(close?.textContent).toBe('');
  });

  it('strokes with currentColor so the hover rule reaches it', () => {
    const frame = open({ id: 'meter' }, 'window');
    const path = frame.el.querySelector('.woc-close path');

    expect(path?.getAttribute('stroke')).toBe('currentColor');
  });

  it('is named for a screen reader', () => {
    const frame = open({ id: 'meter' }, 'window');
    const close = frame.el.querySelector('.woc-close');

    expect(close?.getAttribute('aria-label')).toBe('Close');
    expect(close?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('is absent on a frame that did not ask', () => {
    const frame = open({ id: 'meter' }, 'frame');

    expect(frame.el.querySelector('.woc-close')).toBeNull();
  });

  it('is drawn on a frame that asks for one', () => {
    const frame = open({ id: 'meter', closable: true }, 'frame');

    expect(frame.el.querySelector('.woc-close')).not.toBeNull();
  });

  it('is refused on a bare frame, which has no title bar', () => {
    const frame = open({ id: 'meter', closable: true, density: 'bare' }, 'frame');

    expect(frame.el.querySelector('.woc-close')).toBeNull();
  });

  it('is drawn on a window that did not ask', () => {
    const frame = open({ id: 'meter' }, 'window');

    expect(frame.el.querySelector('.woc-close')).not.toBeNull();
  });
});

// An unclicked window holds no z-index, so building or showing one must raise it.
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

  it('does not raise on hide', () => {
    const { raised, make } = raising();
    const frame = make({ id: 'meter' });
    raised.length = 0;

    frame.hide();

    expect(raised).toEqual([]);
  });

  it('works with no raise at all', () => {
    expect(() => open({ id: 'meter' }, 'window')).not.toThrow();
  });
});

// A bare frame is dragged by the rows a player clicks, so its gestures belong to
// arrange mode. A title bar is a deliberate target, so chromed frames are untouched.
describe('the gestures of a frameless overlay', () => {
  function arranged(): { mode: UnlockMode; hint: () => void } {
    return { mode: createUnlockMode(root()), hint: vi.fn(() => undefined) };
  }

  /** Compared against true: interactjs types `enabled` as optional. */
  function draggable(el: HTMLElement): boolean {
    return interact(el).draggable().enabled === true;
  }

  it('leaves the gestures of a bare frame off while frames are locked', () => {
    const { mode, hint } = arranged();

    const frame = open({ id: 'strip', density: 'bare' }, 'frame', null, { unlock: mode, hint });

    expect(draggable(frame.el)).toBe(false);
  });

  it('hands them back the moment the mode goes on', () => {
    const { mode, hint } = arranged();
    const frame = open({ id: 'strip', density: 'bare' }, 'frame', null, { unlock: mode, hint });

    mode.set(true);

    expect(draggable(frame.el)).toBe(true);
  });

  it('starts live for a frame built while the mode is on', () => {
    const { mode, hint } = arranged();
    mode.set(true);

    const frame = open({ id: 'strip', density: 'bare' }, 'frame', null, { unlock: mode, hint });

    expect(draggable(frame.el)).toBe(true);
  });

  it('leaves a chromed frame alone', () => {
    const { mode, hint } = arranged();

    const frame = open({ id: 'panel', title: 'Meter' }, 'frame', null, { unlock: mode, hint });

    expect(draggable(frame.el)).toBe(true);
  });

  // The gate is on the gestures, not the box, so restore and refit still place it.
  it('still lets the loader place a locked frame', () => {
    const { mode, hint } = arranged();
    const frame = open({ id: 'strip', density: 'bare' }, 'frame', null, { unlock: mode, hint });

    globalThis.dispatchEvent(new Event('resize'));

    expect(frame.el.style.left).not.toBe('');
  });

  it('stops following the mode once the frame is destroyed', () => {
    const { mode, hint } = arranged();
    const frame = open({ id: 'strip', density: 'bare' }, 'frame', null, { unlock: mode, hint });
    frame.destroy();

    expect(() => {
      mode.set(true);
    }).not.toThrow();
  });
});

// interactjs with gestures off raises no event, so the press itself is watched.
describe('the arrange hint', () => {
  function press(el: HTMLElement, to: { x: number; y: number }): void {
    const at = (x: number, y: number) => ({ clientX: x, clientY: y, pointerId: 1, bubbles: true });
    el.dispatchEvent(new PointerEvent('pointerdown', at(100, 100)));
    document.dispatchEvent(new PointerEvent('pointermove', at(to.x, to.y)));
    document.dispatchEvent(new PointerEvent('pointerup', at(to.x, to.y)));
  }

  it('says frames are locked when a drag is refused', () => {
    const hint = vi.fn(() => undefined);
    const frame = open({ id: 'strip', density: 'bare' }, 'frame', null, {
      unlock: createUnlockMode(root()),
      hint,
    });

    press(frame.el, { x: 160, y: 140 });

    expect(hint).toHaveBeenCalledTimes(1);
  });

  it('says nothing about a press that did not travel', () => {
    const hint = vi.fn(() => undefined);
    const frame = open({ id: 'strip', density: 'bare' }, 'frame', null, {
      unlock: createUnlockMode(root()),
      hint,
    });

    press(frame.el, { x: 101, y: 102 });

    expect(hint).not.toHaveBeenCalled();
  });

  it('says nothing once the mode is on, because the drag then works', () => {
    const hint = vi.fn(() => undefined);
    const mode = createUnlockMode(root());
    const frame = open({ id: 'strip', density: 'bare' }, 'frame', null, { unlock: mode, hint });

    mode.set(true);
    press(frame.el, { x: 160, y: 140 });

    expect(hint).not.toHaveBeenCalled();
  });
});

// Answers where `onMove` is silent, including right after the frame was built.
describe('reading the box', () => {
  it('answers the opening placement before any gesture', () => {
    const frame = open({ id: 'strip', width: 300, height: 200, resizable: true }, 'frame');

    expect(frame.box().w).toBe(300);
    expect(frame.box().h).toBe(200);
  });

  it('follows a restored box', async () => {
    const hub = createFakeStorage();
    await hub.set(uiNamespace(FQID), perCharacterKey('pbe', CHARACTER, 'strip'), {
      box: { x: 40, y: 60, w: 240, h: 150 },
      visible: true,
    });

    // Without both minimums the opening size is the floor and clamps the restore.
    const frame = open(
      {
        id: 'strip',
        save: true,
        resizable: true,
        width: 400,
        height: 300,
        minWidth: 100,
        minHeight: 100,
      },
      'frame',
      hub,
    );
    await vi.waitUntil(() => frame.box().w === 240);

    expect(frame.box()).toMatchObject({ x: 40, y: 60, w: 240, h: 150 });
  });

  // Read every frame, so it must not force a layout.
  it('does not touch the element to answer', () => {
    const frame = open({ id: 'strip', width: 300, resizable: true }, 'frame');
    const rect = vi.spyOn(frame.el, 'getBoundingClientRect');

    frame.box();

    expect(rect).not.toHaveBeenCalled();
  });
});

// A list whose row count is a setting owns its width and leaves the height to content.
describe('resizing one axis', () => {
  it('writes the width and leaves the height to the content', () => {
    const frame = open({ id: 'list', width: 300, height: 200, resizable: 'width' }, 'frame');

    expect(frame.el.style.width).toBe('300px');
    expect(frame.el.style.height).toBe('');
  });

  it('writes the height and holds the width it declared', () => {
    const frame = open({ id: 'strip', width: 300, height: 200, resizable: 'height' }, 'frame');

    expect(frame.el.style.height).toBe('200px');
    expect(frame.el.style.width).toBe('300px');
  });

  it('offers edges only on the axis it owns', () => {
    const frame = open({ id: 'list', width: 300, resizable: 'width' }, 'frame');
    const { edges } = interact(frame.el).resizable();

    expect(edges).toMatchObject({ top: false, left: true, right: true, bottom: false });
  });

  // Owning an axis it should not would clip the frame's content.
  it('reads an unrecognised value as not resizable', () => {
    const frame = open({ id: 'list', width: 300, resizable: 'both' as 'width' }, 'frame');

    expect(frame.el.style.width).toBe('300px');
    expect(frame.el.style.height).toBe('');
    expect(interact(frame.el).resizable().enabled).toBe(false);
  });
});

// Composed in TypeScript into one attribute, since the sheet could reach only the fqid.
describe('the arrange-mode name chip', () => {
  function label(el: HTMLElement): string | null {
    return el.getAttribute(LABEL_ATTR);
  }

  function named(opts: FrameOpts, addonName?: string, view = VIEW) {
    return createAddonFrame({
      doc: document,
      root: root(),
      fqid: FQID,
      addonName,
      chrome: 'frame',
      opts,
      store: null,
      viewport: () => view,
      window: globalThis,
    });
  }

  it('names the addon and the frame', () => {
    const frame = named({ id: 'main', title: 'Damage' }, 'Combat Meter');

    expect(label(frame.el)).toBe('Combat Meter · Damage');
  });

  it('falls back to the frame id without a title', () => {
    const frame = named({ id: 'main' }, 'Combat Meter');

    expect(label(frame.el)).toBe('Combat Meter · main');
  });

  // Title-casing the id would invent a name.
  it('falls back to the fqid without an addon name', () => {
    const frame = named({ id: 'main', title: 'Damage' });

    expect(label(frame.el)).toBe(`${FQID} · Damage`);
  });

  it('follows a rename', () => {
    const frame = named({ id: 'main', title: 'Damage' }, 'Combat Meter');

    frame.setTitle('Healing');

    expect(label(frame.el)).toBe('Combat Meter · Healing');
  });

  it('stays above a frame with room for it', () => {
    const frame = named({ id: 'main' }, 'Combat Meter');

    expect(frame.el.classList.contains(LABEL_BELOW_CLASS)).toBe(false);
  });

  it('marks a frame whose top leaves no room for the chip', () => {
    const frame = named({ id: 'main' }, 'Combat Meter', { w: 1280, h: 300 });

    expect(frame.el.classList.contains(LABEL_BELOW_CLASS)).toBe(true);
  });
});

// Driven directly: interactjs moves nothing under happy-dom, and a missing grid
// hand-off fails silently.
describe('the arrange grid reaching a frame', () => {
  function gestures(arrange?: FrameArrange) {
    const opts: FrameOpts = { id: 'main', width: 320, height: 200 };
    const chrome = buildChrome({ doc: document, fqid: FQID, chrome: 'frame', opts });
    return gestureDeps(
      {
        doc: document,
        root: root(),
        fqid: FQID,
        chrome: 'frame',
        opts,
        store: null,
        viewport: () => VIEW,
        window: globalThis,
        ...arrangeDep(arrange),
      },
      chrome,
      { w: 320, h: 200 },
      () => undefined,
    );
  }

  function snapping(on: boolean): FrameArrange {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const unlock = createUnlockMode(el, () => on);
    unlock.set(true);
    return { unlock };
  }

  it('takes the grid from the mode the frame was given', () => {
    expect(gestures(snapping(true)).snapGrid?.()).toBe(SNAP_GRID);
  });

  it('takes no grid from a mode whose player has snapping off', () => {
    expect(gestures(snapping(false)).snapGrid?.()).toBe(NO_SNAP);
  });

  it('installs nothing at all for a frame with no mode', () => {
    expect(gestures().snapGrid).toBeUndefined();
  });
});
