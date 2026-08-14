// @vitest-environment happy-dom

// The woc.ui surface.
//
// A thin per-addon binding over one shared kit, so what this suite is about is
// the binding rather than the widgets: every surface an addon creates has to be
// released when the addon is disabled, and every id it puts into the game's own
// document has to be namespaced, because that document is one id space shared
// with the game and with every other addon.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUi } from '../loader/src/runtime/api/ui.ts';
import { elementId } from '../loader/src/runtime/api/ui-injections.ts';
import { DisposalBag } from '../loader/src/runtime/disposal.ts';
import { createAnchors } from '../loader/src/runtime/ui/kit/anchor3d.ts';
import { createArrangeHint } from '../loader/src/runtime/ui/kit/arrange-hint.ts';
import { createBanner } from '../loader/src/runtime/ui/kit/banner.ts';
import { createFrameRoster } from '../loader/src/runtime/ui/kit/frame-roster.ts';
import { createFrameToggles } from '../loader/src/runtime/ui/kit/frame-toggle.ts';
import { createIconUrls } from '../loader/src/runtime/ui/kit/icons.ts';
import { createGameInjector } from '../loader/src/runtime/ui/kit/injections.ts';
import { createItemArt } from '../loader/src/runtime/ui/kit/item-art.ts';
import { createMenus } from '../loader/src/runtime/ui/kit/menu.ts';
import { createSkillArt } from '../loader/src/runtime/ui/kit/skill-art.ts';
import { createStacking } from '../loader/src/runtime/ui/kit/stacking.ts';
import { createToaster } from '../loader/src/runtime/ui/kit/toast.ts';
import { createTooltips } from '../loader/src/runtime/ui/kit/tooltip.ts';
import { createUnlockMode } from '../loader/src/runtime/ui/kit/unlock.ts';
import type { UiKit } from '../loader/src/runtime/ui/mount.ts';
import { HUD_BAND_CLASS, OVERLAY_BAND_CLASS } from '../loader/src/runtime/ui/root.ts';
import type { ScreenPoint } from '../loader/src/runtime/world/project.ts';
import { inertFrameLoop } from './fakes/frame-loop.ts';
import { enterWorld, mountStartScreen } from './fakes/game-dom.ts';

const FQID = 'official/combat-meter';
const VIEW = { w: 1280, h: 800 };

/** Everything a DOM id may contain. */
const ID_SAFE = /^[a-zA-Z0-9-]+$/;

/** A read that never settles, which is what leaves an art manifest unknown. */
const PENDING_MANIFEST = (): Promise<unknown> => new Promise(() => undefined);

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

const teardown: Array<() => void> = [];

afterEach(() => {
  for (const stop of teardown.splice(0)) {
    stop();
  }
  document.body.innerHTML = '';
  project.mockReset();
  project.mockReturnValue({ x: 100, y: 200, depth: 12, behind: false });
  unitPoint.mockReset();
  unitPoint.mockReturnValue(null);
});

/** In front of the camera and on screen, which is what most of this suite wants. */
const project = vi.fn((): ScreenPoint | null => ({ x: 100, y: 200, depth: 12, behind: false }));

/** Replaced per case by the few tests that are about a unit. */
const unitPoint = vi.fn((): { x: number; y: number; z: number } | null => null);

function open() {
  const root = document.createElement('div');
  root.id = 'woc-addons';
  document.body.appendChild(root);
  // Real bands rather than the root aliased twice, so a surface mounted into the
  // wrong one is something a case here could see. See loader ui/root.ts.
  const hud = document.createElement('div');
  hud.className = HUD_BAND_CLASS;
  const overlay = document.createElement('div');
  overlay.className = OVERLAY_BAND_CLASS;
  root.append(hud, overlay);

  const injector = createGameInjector({ doc: document });
  teardown.push(injector.dispose);

  const timers = {
    setTimer: (handler: () => void, ms: number) =>
      globalThis.setTimeout(handler, ms) as unknown as number,
    clearTimer: (id: number) => {
      globalThis.clearTimeout(id);
    },
  };

  const kit: UiKit = {
    project,
    unitPoint,
    root,
    hud,
    overlay,
    roster: createFrameRoster(),
    injector,
    toaster: createToaster({ doc: document, root: overlay, ...timers }),
    banner: createBanner({ doc: document, root: overlay, ...timers }),
    tooltips: createTooltips({ doc: document, root, layer: overlay, viewport: () => VIEW }),
    menus: createMenus({ doc: document, root: overlay, viewport: () => VIEW }),
    // A projector that answers, so an anchor an addon creates has somewhere to be,
    // and a loop that never runs, so nothing here needs stopping.
    anchors: createAnchors({
      doc: document,
      root: hud,
      project,
      unitPoint,
      viewport: () => VIEW,
      frames: inertFrameLoop(),
    }),
    stacking: createStacking({ root }),
    unlock: createUnlockMode(root),
    arrangeHint: createArrangeHint({
      toaster: createToaster({ doc: document, root: overlay, ...timers }),
    }),
    // Manifest readers whose fetch never settles, which is the state a first row is
    // drawn in: `has` answers "not known yet", so the builder hands back the URL and
    // the image decides. A suite that wanted the authoritative answer would resolve it.
    icons: createIconUrls(
      createSkillArt({ fetchJson: PENDING_MANIFEST }),
      createItemArt({ fetchJson: PENDING_MANIFEST }),
    ),
  };

  const bag = new DisposalBag();
  const onError = vi.fn();
  const onWarn = vi.fn();
  // A keybind surface that declares nothing, which is this suite's subject: it is
  // about the per-addon binding rather than about the keys. What `toggleKey` does
  // with a real one is tests/ui-frame-toggle.test.ts.
  const toggles = createFrameToggles({
    bind: (id) => {
      throw new Error(`no keybind declared with id '${id}'`);
    },
    warn: onWarn,
  });
  const ui = createUi({
    doc: document,
    kit,
    fqid: FQID,
    bag,
    onError,
    frameStore: null,
    toggles,
    viewport: () => VIEW,
    window: globalThis,
  });
  return { bag, kit, ui, onError, onWarn };
}

describe('creating surfaces', () => {
  it('puts a frame under the addon root, not in the game HUD', () => {
    const { ui } = open();

    const frame = ui.frame({ id: 'meter', title: 'DPS' });

    expect(frame.el.closest('#woc-addons')).not.toBeNull();
  });

  // Which band, not merely which root. A frame is HUD furniture and belongs under
  // the game's own windows, which is what stopped the ESC menu opening behind one;
  // everything the player opened or the loader raised belongs over all of it. See
  // loader ui/root.ts.
  it('puts a frame in the hud band and everything raised in the overlay band', async () => {
    const { ui, kit } = open();

    const frame = ui.frame({ id: 'meter', title: 'DPS' });
    ui.toast('Pull in 5');
    ui.banner('Deathless Rage');
    const answer = ui.alert({ message: 'Reset?', buttons: [{ id: 'yes', label: 'Yes' }] });

    expect(frame.el.parentElement).toBe(kit.hud);
    expect(kit.hud.querySelector('.woc-toast')).toBeNull();
    expect(kit.overlay.querySelector('.woc-toast')).not.toBeNull();
    expect(kit.overlay.querySelector('#woc-banner')).not.toBeNull();
    expect(kit.overlay.querySelector('.woc-modal-backdrop')).not.toBeNull();

    document.querySelector<HTMLButtonElement>('.woc-modal-buttons button')?.click();
    await answer;
  });

  // The tooltip is drawn in the overlay band while its WATCHER covers the whole
  // root, because the element it is describing is an addon's own row down in the
  // hud band. A tooltip in the hud band would be behind the game's own windows.
  it('draws the tooltip over every frame', () => {
    const { ui, kit } = open();
    const frame = ui.frame({ id: 'meter' });
    const row = document.createElement('div');
    frame.body.appendChild(row);

    ui.tooltip(row, 'Aimed Shot');
    row.dispatchEvent(new Event('pointerenter'));

    expect(kit.overlay.querySelector('#woc-tooltip')).not.toBeNull();
    expect(document.getElementById('woc-tooltip')?.textContent).toContain('Aimed Shot');
  });

  it('gives window a close button and frame none', () => {
    const { ui } = open();

    expect(ui.window({ id: 'a' }).el.querySelector('.woc-close')).not.toBeNull();
    expect(ui.frame({ id: 'b' }).el.querySelector('.woc-close')).toBeNull();
  });

  it('shows a toast', () => {
    const { ui } = open();

    ui.toast('Pull in 5');

    expect(document.querySelector('.woc-toast')?.textContent).toBe('Pull in 5');
  });

  it('resolves an alert with the button pressed', async () => {
    const { ui } = open();

    const answer = ui.alert({ message: 'Reset?', buttons: [{ id: 'yes', label: 'Yes' }] });
    document.querySelector<HTMLButtonElement>('.woc-modal-buttons button')?.click();

    expect(await answer).toBe('yes');
  });

  it('shows a banner', () => {
    const { ui } = open();

    ui.banner('Deathless Rage', { detail: 'interrupt it' });

    expect(document.getElementById('woc-banner')?.textContent).toContain('Deathless Rage');
  });

  // The bar is handed back rather than placed: the kit does not know where in an
  // addon's own frame the row belongs.
  it('hands back a bar for the addon to place itself', () => {
    const { ui } = open();

    const bar = ui.bar({ label: 'Aimed Shot', value: '4.2s' });

    expect(bar.el.classList.contains('woc-bar')).toBe(true);
    expect(document.querySelector('.woc-bar')).toBeNull();
  });

  it('hands back a tile the same way', () => {
    const { ui } = open();

    const tile = ui.tile({ label: 'Aimed Shot', fraction: 0.5 });

    expect(tile.el.classList.contains('woc-tile')).toBe(true);
    expect(document.querySelector('.woc-tile')).toBeNull();
  });

  it('carries the icon URL builders', () => {
    const { ui } = open();

    expect(ui.icon.ability('aimed_shot', 'hunter')).toBe('/ui/skills/hunter/aimed_shot.webp');
  });

  it('attaches a tooltip', () => {
    const { ui } = open();
    const el = document.createElement('button');
    document.body.appendChild(el);

    ui.tooltip(el, 'Toggle the meter');
    el.dispatchEvent(new Event('pointerenter'));

    expect(document.getElementById('woc-tooltip')?.textContent).toBe('Toggle the meter');
  });
});

// A frame's onMove runs inside the loader's own pointer handling, which is the
// same position a socket tap runs in: a throw there must not break the gesture the
// player is in the middle of, and it must not be swallowed either. Reported through
// the addon's own log, which is what the manager's log tail shows a player.
describe('a frame callback that throws', () => {
  it('reports it and leaves the frame working', () => {
    const { ui, onError } = open();
    ui.frame({
      id: 'strip',
      resizable: true,
      onMove: () => {
        throw new Error('the addon is broken');
      },
    });

    expect(() => globalThis.dispatchEvent(new Event('resize'))).not.toThrow();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toContain('strip');
  });
});

// The three surfaces commit 8 added, checked here for the one thing their own
// suites cannot see: that they reached the object an addon is handed, and that
// what they create is released with the addon.
describe('the settings-pane surfaces', () => {
  it('hands back a field for the addon to place itself', () => {
    const { ui } = open();

    const field = ui.field.checkbox({ label: 'Show pet', value: true, onChange: vi.fn() });

    expect(field.el.classList.contains('woc-field')).toBe(true);
    expect(document.querySelector('.woc-field')).toBeNull();
  });

  it('carries all four field builders', () => {
    const { ui } = open();

    expect(Object.keys(ui.field).sort()).toEqual(['checkbox', 'select', 'slider', 'text']);
  });

  it('hands back a tab strip', () => {
    const { ui } = open();

    const strip = ui.tabs({ tabs: [{ id: 'a', label: 'A' }], onSelect: vi.fn() });

    expect(strip.active()).toBe('a');
  });

  it('opens a menu in the loader root', () => {
    const { ui, kit } = open();

    ui.menu({ x: 10, y: 10 }, [{ label: 'Reset', onSelect: vi.fn() }]);

    expect(kit.root.querySelector('.woc-menu')).not.toBeNull();
  });

  // Disable is hot, with no page reload. A menu is the loudest of these to leave
  // behind: it sits in the overlay band above every window.
  it('takes an open menu, its fields and its tabs away on dispose', () => {
    const { bag, ui, kit } = open();
    kit.root.append(
      ui.field.text({ label: 'Title', value: '', onChange: vi.fn() }).el,
      ui.tabs({ tabs: [{ id: 'a', label: 'A' }], onSelect: vi.fn() }).el,
    );
    ui.menu({ x: 10, y: 10 }, [{ label: 'Reset', onSelect: vi.fn() }]);

    bag.dispose();

    expect(document.querySelector('.woc-menu')).toBeNull();
    expect(document.querySelector('.woc-field')).toBeNull();
    expect(document.querySelector('.woc-tabs')).toBeNull();
  });

  // A tooltip took a string and still does: the structured form is an addition,
  // because a published surface changing shape is what moves the API major.
  it('takes both a string and structured content', () => {
    const { ui } = open();
    const el = document.createElement('button');
    document.body.appendChild(el);

    ui.tooltip(el, { title: 'Fell Shot', lines: ['55 mana'] });
    el.dispatchEvent(new Event('pointerenter'));

    expect(document.querySelector('.woc-tip-title')?.textContent).toBe('Fell Shot');
  });
});

describe("ids in the game's document", () => {
  // Two addons may both call a button 'toggle', and the game's document is one
  // id space. Without prefixing, the second addon's button silently replaces
  // the first's.
  it('namespaces a rail button by addon and kind', async () => {
    mountStartScreen(document);
    const { ui } = open();
    enterWorld(document);
    await settle();

    ui.microButton({ id: 'toggle', label: 'DPS', onClick: vi.fn() });

    expect(document.getElementById(elementId(FQID, 'micro', 'toggle'))).not.toBeNull();
  });

  it('lets two addons use the same button id', () => {
    expect(elementId('official/a', 'micro', 'toggle')).not.toBe(
      elementId('official/b', 'micro', 'toggle'),
    );
  });

  it('produces an id with nothing in it that is not id-safe', () => {
    expect(elementId('gh:someone/their-addons', 'menu', 'open')).toMatch(ID_SAFE);
  });

  it('adds a menu entry that opens on click', async () => {
    mountStartScreen(document);
    const { ui } = open();
    enterWorld(document);
    await settle();
    // World entry clones an EMPTY #options-menu; the button list only exists
    // once the player opens the menu and the game renders its root view.
    const menu = document.getElementById('options-menu');
    if (menu !== null) {
      menu.innerHTML = '<div class="opt-list"></div><div class="opt-version">v0.31</div>';
    }
    const onClick = vi.fn();

    ui.menuEntry({ id: 'open', label: 'DPS', onClick });
    document.querySelector<HTMLButtonElement>('.opt-list button:last-of-type')?.click();

    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('disposal', () => {
  it('destroys every frame the addon made', () => {
    const { bag, ui } = open();
    ui.frame({ id: 'a' });
    ui.window({ id: 'b' });

    bag.dispose();

    expect(document.querySelectorAll('.woc-addon-frame')).toHaveLength(0);
  });

  it('dismisses every toast the addon showed', () => {
    const { bag, ui } = open();
    ui.toast('one', { timeout: 0 });
    ui.toast('two', { timeout: 0 });

    bag.dispose();

    expect(document.querySelectorAll('.woc-toast')).toHaveLength(0);
  });

  it('takes down a banner the addon left up', () => {
    const { bag, ui } = open();
    ui.banner('Phase two', { timeout: 0 });

    bag.dispose();

    expect(document.querySelectorAll('.woc-banner-card')).toHaveLength(0);
  });

  // Disable is hot, with no page reload, so a row left in a frame the loader has
  // already removed would outlive whatever was updating it.
  it('removes every bar the addon put on screen', () => {
    const { bag, ui, kit } = open();
    kit.root.append(ui.bar({ label: 'Fireball' }).el, ui.bar({ label: 'Frostbolt' }).el);

    bag.dispose();

    expect(document.querySelectorAll('.woc-bar')).toHaveLength(0);
  });

  // A strip of tiles is the same kind of leak, and there are usually more of them:
  // an aura display rebuilds its whole row every time an effect lands.
  it('removes every tile the addon put on screen', () => {
    const { bag, ui, kit } = open();
    kit.root.append(ui.tile({ label: 'Renew' }).el, ui.tile({ label: 'Rejuvenation' }).el);

    bag.dispose();

    expect(document.querySelectorAll('.woc-tile')).toHaveLength(0);
  });

  // The addon's await is mid-way through something, so being disabled has to
  // release it rather than leave it hanging forever.
  it('closes an open alert and resolves its promise', async () => {
    const { bag, ui } = open();

    const answer = ui.alert({
      message: 'Reset?',
      buttons: [{ id: 'no', label: 'No', cancel: true }],
    });
    bag.dispose();

    expect(await answer).toBe('no');
    expect(document.querySelector('.woc-modal-backdrop')).toBeNull();
  });

  it('detaches every tooltip', () => {
    const { bag, ui } = open();
    const el = document.createElement('button');
    document.body.appendChild(el);
    ui.tooltip(el, 'one');

    bag.dispose();
    el.dispatchEvent(new Event('pointerenter'));

    expect(document.getElementById('woc-tooltip')?.hidden ?? true).toBe(true);
  });

  it("takes the addon's buttons out of the game HUD", async () => {
    mountStartScreen(document);
    const { bag, ui } = open();
    enterWorld(document);
    await settle();
    const menu = document.getElementById('options-menu');
    if (menu !== null) {
      menu.innerHTML = '<div class="opt-list"></div>';
    }
    ui.microButton({ id: 'toggle', label: 'DPS', onClick: vi.fn() });
    ui.menuEntry({ id: 'open', label: 'DPS', onClick: vi.fn() });
    // Asserted present first: without this the disposal check below passes for
    // an entry that was never injected at all.
    expect(document.getElementById(elementId(FQID, 'micro', 'toggle'))).not.toBeNull();
    expect(document.getElementById(elementId(FQID, 'menu', 'open'))).not.toBeNull();

    bag.dispose();

    expect(document.getElementById(elementId(FQID, 'micro', 'toggle'))).toBeNull();
    expect(document.getElementById(elementId(FQID, 'menu', 'open'))).toBeNull();
  });

  // The shared kit outlives every addon: disabling one must not take the toast
  // stack or the tooltip element away from the others.
  it('leaves the shared kit intact for other addons', () => {
    const { bag, kit } = open();

    bag.dispose();
    kit.toaster.show('still working', { timeout: 0 });

    expect(document.querySelector('.woc-toast')?.textContent).toBe('still working');
  });

  it('lets an explicit teardown also drop its bag entry', () => {
    const { bag, ui } = open();

    const dismiss = ui.toast('one', { timeout: 0 });
    const withToast = bag.size;
    dismiss();

    expect(bag.size).toBeLessThan(withToast);
  });
});

// `ui.project` is the same read `ui.anchor3d` places by, with no element.
//
// What is worth pinning is what it REFUSES, because the refusal is the whole
// safety of the call: there is deliberately no `onScreen` flag, since a flag is a
// thing an addon can forget to read, and the point it would be forgotten on is the
// one whose coordinates are finite and wrong.
describe('projecting a point', () => {
  const Point = { x: 1, y: 2, z: 3 };

  it('answers where the point is, with its depth', () => {
    const { ui } = open();

    expect(ui.project(Point)).toEqual({ x: 100, y: 200, depth: 12 });
  });

  it.each([
    ['a point the guard rejected', { x: 100, y: 200, depth: 12, behind: true }],
    ['a game that cannot be asked', null],
  ])('answers null for %s', (_case, answer) => {
    const { ui } = open();
    project.mockReturnValue(answer);

    expect(ui.project(Point)).toBeNull();
  });

  // An off-screen point in front of the camera is what an arrow pointing at an
  // off-screen unit is built from, so turning it into a null would remove a
  // feature to save an addon one comparison.
  it('answers a point that is off screen but in front', () => {
    const { ui } = open();
    project.mockReturnValue({ x: -900, y: 200, depth: 12, behind: false });

    expect(ui.project(Point)?.x).toBe(-900);
  });

  it('resolves a unit through the same resolver anchor3d uses', () => {
    const { ui } = open();
    unitPoint.mockReturnValue({ x: 9, y: 9, z: 9 });

    const at = ui.project({ unit: 'target' });

    expect(unitPoint).toHaveBeenCalledExactlyOnceWith({ unit: 'target' });
    expect(project).toHaveBeenCalledExactlyOnceWith(9, 9, 9);
    expect(at).not.toBeNull();
  });

  it('answers null for a unit with no point, without asking the renderer', () => {
    const { ui } = open();

    expect(ui.project({ unit: 'target', over: 'head' })).toBeNull();
    expect(project).not.toHaveBeenCalled();
  });
});
