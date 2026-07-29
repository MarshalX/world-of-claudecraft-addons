// @vitest-environment happy-dom

// The woc.ui surface.
//
// A thin per-addon binding over one shared kit, so what this suite is about is
// the binding rather than the widgets: every surface an addon creates has to be
// released when the addon is disabled, and every id it puts into the game's own
// document has to be namespaced, because that document is one id space shared
// with the game and with every other addon.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUi, elementId } from '../loader/src/runtime/api/ui.ts';
import { DisposalBag } from '../loader/src/runtime/disposal.ts';
import { createGameInjector } from '../loader/src/runtime/ui/kit/injections.ts';
import { createStacking } from '../loader/src/runtime/ui/kit/stacking.ts';
import { createToaster } from '../loader/src/runtime/ui/kit/toast.ts';
import { createTooltips } from '../loader/src/runtime/ui/kit/tooltip.ts';
import type { UiKit } from '../loader/src/runtime/ui/mount.ts';
import { enterWorld, mountStartScreen } from './fakes/game-dom.ts';

const FQID = 'official/combat-meter';
const VIEW = { w: 1280, h: 800 };

/** Everything a DOM id may contain. */
const ID_SAFE = /^[a-zA-Z0-9-]+$/;

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
});

function open() {
  const root = document.createElement('div');
  root.id = 'woc-addons';
  document.body.appendChild(root);

  const injector = createGameInjector({ doc: document });
  teardown.push(injector.dispose);

  const kit: UiKit = {
    root,
    injector,
    toaster: createToaster({
      doc: document,
      root,
      setTimer: (handler, ms) => globalThis.setTimeout(handler, ms) as unknown as number,
      clearTimer: (id) => {
        globalThis.clearTimeout(id);
      },
    }),
    tooltips: createTooltips({ doc: document, root, viewport: () => VIEW }),
    stacking: createStacking({ root }),
  };

  const bag = new DisposalBag();
  const ui = createUi({
    doc: document,
    kit,
    fqid: FQID,
    bag,
    frameStore: null,
    viewport: () => VIEW,
    window: globalThis,
  });
  return { bag, kit, ui };
}

describe('creating surfaces', () => {
  it('puts a frame under the addon root, not in the game HUD', () => {
    const { ui } = open();

    const frame = ui.frame({ id: 'meter', title: 'DPS' });

    expect(frame.el.closest('#woc-addons')).not.toBeNull();
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

  it('attaches a tooltip', () => {
    const { ui } = open();
    const el = document.createElement('button');
    document.body.appendChild(el);

    ui.tooltip(el, 'Toggle the meter');
    el.dispatchEvent(new Event('pointerenter'));

    expect(document.getElementById('woc-tooltip')?.textContent).toBe('Toggle the meter');
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
