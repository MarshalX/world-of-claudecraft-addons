// @vitest-environment happy-dom

// The HUD is inside <template id="game-ui-template"> and is cloned in only at world entry, so
// a lookup at DOMContentLoaded finds nothing and fails silently.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiagnosticsReading } from '../loader/src/runtime/diagnostics.ts';
import { ENTRY_ID } from '../loader/src/runtime/ui/esc-inject.ts';
import { whenHudMounts } from '../loader/src/runtime/ui/hud-mount.ts';
import { mountUi } from '../loader/src/runtime/ui/mount.ts';
import { inertFrameLoop } from './fakes/frame-loop.ts';
import { enterWorld, leaveWorld, mountStartScreen } from './fakes/game-dom.ts';
import { uiServices } from './fakes/ui-deps.ts';

const READING = {
  origin: 'https://pbe.worldofclaudecraft.com',
  channel: 'pbe',
  loaderVersion: '0.0.0',
  bridged: false,
  game: null,
  probe: null,
  net: {
    connected: false,
    tick: 0,
    tickHz: 20,
    pid: null,
    realm: null,
    seed: null,
    latencyMs: null,
    reconnects: 0,
  },
  anchors: [],
} satisfies DiagnosticsReading;

/** MutationObserver callbacks are microtasks, so a tick settles them. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  document.body.className = '';
});

describe('waiting for the HUD', () => {
  it('does not attach while the player is on the start screen', () => {
    mountStartScreen(document);
    const attach = vi.fn();
    const detach = vi.fn();

    const wait = whenHudMounts({ doc: document, attach, detach });

    expect(attach).not.toHaveBeenCalled();
    expect(wait.attached()).toBe(false);
  });

  it('attaches when world entry clones the HUD in', async () => {
    mountStartScreen(document);
    const attach = vi.fn();
    const detach = vi.fn();
    whenHudMounts({ doc: document, attach, detach });

    enterWorld(document);
    await settle();

    expect(attach).toHaveBeenCalledTimes(1);
  });

  // The loader can start with the player already in the world, leaving no mutation to wait for.
  it('attaches immediately when the HUD is already there', () => {
    mountStartScreen(document);
    enterWorld(document);
    const attach = vi.fn();
    const detach = vi.fn();

    whenHudMounts({ doc: document, attach, detach });

    expect(attach).toHaveBeenCalledTimes(1);
  });

  // Attaching twice would give the player two Addons buttons.
  it('attaches once however many times body changes after', async () => {
    mountStartScreen(document);
    const attach = vi.fn();
    const detach = vi.fn();
    whenHudMounts({ doc: document, attach, detach });

    enterWorld(document);
    await settle();
    document.body.appendChild(document.createElement('div'));
    await settle();

    expect(attach).toHaveBeenCalledTimes(1);
  });

  it('stops waiting when cancelled', async () => {
    mountStartScreen(document);
    const attach = vi.fn();
    const detach = vi.fn();

    whenHudMounts({ doc: document, attach, detach }).cancel();
    enterWorld(document);
    await settle();

    expect(attach).not.toHaveBeenCalled();
  });

  // Re-attach is keyed on the HUD element's identity. Keying on the loader's own
  // elements would spin: an update that renames the rail leaves nothing to find,
  // so "ours is missing" is permanently true and every body mutation reattaches.
  it('re-attaches when the HUD is replaced by a different element', async () => {
    mountStartScreen(document);
    const attach = vi.fn();
    const detach = vi.fn();
    whenHudMounts({ doc: document, attach, detach });
    enterWorld(document);
    await settle();

    document.getElementById('ui')?.remove();
    const replacement = document.createElement('div');
    replacement.id = 'ui';
    document.body.appendChild(replacement);
    await settle();

    expect(detach).toHaveBeenCalledTimes(1);
    expect(attach).toHaveBeenCalledTimes(2);
  });

  it('does not detach while the same HUD stays in the document', async () => {
    mountStartScreen(document);
    const attach = vi.fn();
    const detach = vi.fn();
    whenHudMounts({ doc: document, attach, detach });
    enterWorld(document);
    await settle();

    for (let i = 0; i < 5; i += 1) {
      document.body.appendChild(document.createElement('div'));
    }
    await settle();

    expect(detach).not.toHaveBeenCalled();
    expect(attach).toHaveBeenCalledTimes(1);
  });
});

describe('the composed UI', () => {
  it('mounts the root on the start screen and the routes at world entry', async () => {
    mountStartScreen(document);

    const ui = mountUi({
      doc: document,
      css: '',
      fetchJson: () => new Promise<unknown>(() => undefined),
      frames: inertFrameLoop(),
      unitPoint: () => null,
      project: () => null,
      registry: null,
      storage: null,
      channel: 'pbe',
      readDiagnostics: () => READING,
      ...uiServices(document),
    });

    expect(document.getElementById('woc-addons')).not.toBeNull();
    expect(document.getElementById('woc-addons-micro-button')).toBeNull();

    enterWorld(document);
    await settle();

    expect(document.getElementById('woc-addons-micro-button')).not.toBeNull();
    ui.dispose();
  });

  it('takes both in-game routes away on dispose', async () => {
    mountStartScreen(document);
    const ui = mountUi({
      doc: document,
      css: '',
      fetchJson: () => new Promise<unknown>(() => undefined),
      frames: inertFrameLoop(),
      unitPoint: () => null,
      project: () => null,
      registry: null,
      storage: null,
      channel: 'pbe',
      readDiagnostics: () => READING,
      ...uiServices(document),
    });
    enterWorld(document);
    await settle();

    ui.dispose();

    expect(document.getElementById('woc-addons-micro-button')).toBeNull();
    expect(document.getElementById('woc-addons')).toBeNull();
  });

  it('does not attach after being disposed on the start screen', async () => {
    mountStartScreen(document);
    const ui = mountUi({
      doc: document,
      css: '',
      fetchJson: () => new Promise<unknown>(() => undefined),
      frames: inertFrameLoop(),
      unitPoint: () => null,
      project: () => null,
      registry: null,
      storage: null,
      channel: 'pbe',
      readDiagnostics: () => READING,
      ...uiServices(document),
    });

    ui.dispose();
    enterWorld(document);
    await settle();

    expect(document.getElementById('woc-addons-micro-button')).toBeNull();
  });
});

// Addon frames are hidden whenever the HUD is absent, and the default is hidden. The root is a
// sibling of #ui, so nothing else takes a frame away when the HUD goes.
describe('addon UI against the HUD', () => {
  const NoHud = 'woc-no-hud';

  function root(): HTMLElement {
    const el = document.getElementById('woc-addons');
    if (el === null) {
      throw new Error('the addon root did not mount');
    }
    return el;
  }

  function mount() {
    return mountUi({
      doc: document,
      css: '',
      fetchJson: () => new Promise<unknown>(() => undefined),
      frames: inertFrameLoop(),
      unitPoint: () => null,
      project: () => null,
      registry: null,
      storage: null,
      channel: 'pbe',
      readDiagnostics: () => READING,
      ...uiServices(document),
    });
  }

  // A default of shown would draw restored frames over the landing page.
  it('starts hidden, before anything has been observed', () => {
    mountStartScreen(document);
    const ui = mount();

    expect(root().classList.contains(NoHud)).toBe(true);
    ui.dispose();
  });

  it('shows addon UI once world entry clones the HUD in', async () => {
    mountStartScreen(document);
    const ui = mount();

    enterWorld(document);
    await settle();

    expect(root().classList.contains(NoHud)).toBe(false);
    ui.dispose();
  });

  it('hides it again when logout takes the HUD away', async () => {
    mountStartScreen(document);
    const ui = mount();
    enterWorld(document);
    await settle();

    leaveWorld(document);
    await settle();

    expect(root().classList.contains(NoHud)).toBe(true);
    ui.dispose();
  });

  it('shows it again on the next world entry', async () => {
    mountStartScreen(document);
    const ui = mount();
    enterWorld(document);
    await settle();
    leaveWorld(document);
    await settle();

    enterWorld(document);
    await settle();

    expect(root().classList.contains(NoHud)).toBe(false);
    ui.dispose();
  });

  // The manager must stay reachable with no game, so the rule keys on the addon-frame class
  // rather than on the root's children.
  it('marks addon frames and not the manager', () => {
    mountStartScreen(document);
    const ui = mount();
    ui.manager.open();

    const manager = root().querySelector('.woc-window');
    const frame = ui.kit.root.querySelector('.woc-addon-frame');

    expect(manager).not.toBeNull();
    expect(manager?.classList.contains('woc-addon-frame')).toBe(false);
    // No addon frame exists, so the selector must not match the manager.
    expect(frame).toBeNull();
    ui.dispose();
  });
});

// Both in-game routes are game DOM outside the root, so the stacking listener never sees the
// click. Drive the route itself: a raise wrapped around the returned manager misses both routes.
describe('the manager and the window order', () => {
  function managerEl(): HTMLElement | null {
    return document.querySelector('[data-woc-manager]');
  }

  function z(el: HTMLElement | null): number {
    return Number(el?.style.zIndex);
  }

  /** A window an addon owns, as the stacking service sees one. */
  function addonWindow(root: HTMLElement): HTMLElement {
    const el = document.createElement('section');
    el.className = 'woc-window woc-addon-frame';
    root.appendChild(el);
    return el;
  }

  /** The game menu rendering its list; #options-menu is empty until the player opens it. */
  function renderMenuList(): void {
    const list = document.createElement('div');
    list.className = 'opt-list';
    document.getElementById('options-menu')?.appendChild(list);
  }

  function mount() {
    return mountUi({
      doc: document,
      css: '',
      fetchJson: () => new Promise<unknown>(() => undefined),
      frames: inertFrameLoop(),
      unitPoint: () => null,
      project: () => null,
      registry: null,
      storage: null,
      channel: 'pbe',
      readDiagnostics: () => READING,
      ...uiServices(document),
    });
  }

  it('raises the manager when it is opened', () => {
    mountStartScreen(document);
    const ui = mount();

    ui.manager.open();

    expect(Number(managerEl()?.style.zIndex)).toBeGreaterThan(0);
    ui.dispose();
  });

  // `.woc-window` is every addon frame as well, so the manager needs its own marker.
  it('marks its own window so it can be found', () => {
    mountStartScreen(document);
    const ui = mount();

    ui.manager.open();

    expect(managerEl()?.classList.contains('woc-window')).toBe(true);
    ui.dispose();
  });

  it('raises the manager on toggle, which both in-game routes call', () => {
    mountStartScreen(document);
    const ui = mount();
    ui.manager.open();
    const opened = Number(managerEl()?.style.zIndex);
    ui.manager.close();

    ui.manager.toggle();

    expect(Number(managerEl()?.style.zIndex)).toBeGreaterThan(opened);
    ui.dispose();
  });

  it('opens in front of an addon frame from the game menu entry', async () => {
    mountStartScreen(document);
    const ui = mount();
    enterWorld(document);
    await settle();
    renderMenuList();
    await settle();
    const frame = addonWindow(ui.kit.root);
    ui.kit.stacking.raise(frame);

    document.getElementById(ENTRY_ID)?.dispatchEvent(new Event('click'));

    expect(managerEl()).not.toBeNull();
    expect(z(managerEl())).toBeGreaterThan(z(frame));
    ui.dispose();
  });

  it('raises a window that was already open', () => {
    mountStartScreen(document);
    const ui = mount();
    ui.manager.open();
    const frame = addonWindow(ui.kit.root);
    ui.kit.stacking.raise(frame);

    ui.manager.open();

    expect(z(managerEl())).toBeGreaterThan(z(frame));
    ui.dispose();
  });
});
