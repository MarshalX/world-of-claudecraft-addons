// @vitest-environment happy-dom

// Waiting for the game's HUD.
//
// This exists because of a real defect. The loader mounted its in-game entry
// points at DOMContentLoaded, on the reading that the game menu and the rail
// were static markup. They are not: the whole HUD is inside
// <template id="game-ui-template"> and is cloned into the document only at world
// entry, so both lookups found nothing, both routes were silently dead, and
// nothing anywhere raised. A live session is what found it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiagnosticsReading } from '../loader/src/runtime/diagnostics.ts';
import { whenHudMounts } from '../loader/src/runtime/ui/hud-mount.ts';
import { mountUi } from '../loader/src/runtime/ui/mount.ts';
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
  // The regression itself: at DOMContentLoaded the HUD anchors are all inside a
  // template, so nothing may attach yet.
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

  // A userscript can be enabled, or the loader updated, with the player already
  // in the world. There is no mutation left to wait for in that case.
  it('attaches immediately when the HUD is already there', () => {
    mountStartScreen(document);
    enterWorld(document);
    const attach = vi.fn();
    const detach = vi.fn();

    whenHudMounts({ doc: document, attach, detach });

    expect(attach).toHaveBeenCalledTimes(1);
  });

  // The game guards mountGameUi on #ui already existing, so the HUD lands once.
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

  // The guard above only holds if a mutation that leaves the same HUD in place
  // is a no-op, which is every mutation in an ordinary session.
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
  // End to end over the real modules: what the live session actually showed was
  // a mounted root with neither in-game route present.
  it('brings up the manager on the start screen and the routes at world entry', async () => {
    mountStartScreen(document);

    const ui = mountUi({
      doc: document,
      css: '',
      fetchJson: () => new Promise<unknown>(() => undefined),
      // No world anchors in these cases, so the frame clock is never asked for a
      // frame and the projector is never called.
      schedule: () => 0,
      cancelFrame: () => undefined,
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
      // No world anchors in these cases, so the frame clock is never asked for a
      // frame and the projector is never called.
      schedule: () => 0,
      cancelFrame: () => undefined,
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

  // Disposing before world entry must not leave an observer that mounts buttons
  // into a document the loader has already let go of.
  it('does not attach after being disposed on the start screen', async () => {
    mountStartScreen(document);
    const ui = mountUi({
      doc: document,
      css: '',
      fetchJson: () => new Promise<unknown>(() => undefined),
      // No world anchors in these cases, so the frame clock is never asked for a
      // frame and the projector is never called.
      schedule: () => 0,
      cancelFrame: () => undefined,
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

// Addon UI must not be on screen when the game is not.
//
// This is a defect a live session found, and the cause is a deliberate design
// choice one step upstream: the loader's root is a sibling of #ui specifically so
// a HUD re-render cannot take it away, and the cost is that nothing takes it away
// when the HUD legitimately goes. An addon frame with a saved visibility is
// restored the moment its addon starts, which is at document-start, so a meter
// window appeared over the landing page's PLAY button before the player had even
// logged in.
//
// The fix is a class on the root, so this is about the SIGNAL: that the default
// is the safe one before anything has been observed, that it falls on logout as
// well as rising on entry, and that it never reaches the manager, which has to
// stay reachable with no game at all.
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
      // No world anchors in these cases, so the frame clock is never asked for a
      // frame and the projector is never called.
      schedule: () => 0,
      cancelFrame: () => undefined,
      project: () => null,
      registry: null,
      storage: null,
      channel: 'pbe',
      readDiagnostics: () => READING,
      ...uiServices(document),
    });
  }

  // The state that needs no event to be correct: on the landing page nothing has
  // mutated yet, so a default of "shown" would flash addon UI over the page.
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

  // The reported bug. Before the fix the class was never set again and the frame
  // stayed on screen over the landing page.
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

  // The manager is how a player finds out the loader is broken, and one of its
  // three routes in is host-side and works with no game at all. Hiding the whole
  // root would have taken that away, which is why the rule names addon frames
  // rather than the root's children.
  //
  // Asserted on the CLASS the stylesheet keys on, in both directions, because
  // that is the whole mechanism: the manager's window must not carry it, and an
  // addon's must. Checking only the manager would pass just as well if the class
  // had been renamed and nothing carried it at all.
  it('marks addon frames and not the manager', () => {
    mountStartScreen(document);
    const ui = mount();
    ui.manager.open();

    const manager = root().querySelector('.woc-window');
    const frame = ui.kit.root.querySelector('.woc-addon-frame');

    expect(manager).not.toBeNull();
    expect(manager?.classList.contains('woc-addon-frame')).toBe(false);
    // No addon has opened one here, so the count is the point: the selector the
    // rule uses is real and is not accidentally matching the manager.
    expect(frame).toBeNull();
    ui.dispose();
  });
});

// The manager opening in front.
//
// Both in-game routes to it are buttons in the game's own DOM, outside the root,
// so the click that opens the manager is not one the stacking listener sees. A
// manager that opened behind an addon frame would be the same bug the listener
// exists to fix, reached by the one path the listener cannot cover.
describe('the manager and the window order', () => {
  function managerEl(): HTMLElement | null {
    return document.querySelector('[data-woc-manager]');
  }

  function mount() {
    return mountUi({
      doc: document,
      css: '',
      fetchJson: () => new Promise<unknown>(() => undefined),
      // No world anchors in these cases, so the frame clock is never asked for a
      // frame and the projector is never called.
      schedule: () => 0,
      cancelFrame: () => undefined,
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

  // The one hook that says which window is the manager's, since `.woc-window` is
  // every addon frame as well.
  it('marks its own window so it can be found', () => {
    mountStartScreen(document);
    const ui = mount();

    ui.manager.open();

    expect(managerEl()?.classList.contains('woc-window')).toBe(true);
    ui.dispose();
  });

  it('raises it on toggle too, which is what both in-game routes call', () => {
    mountStartScreen(document);
    const ui = mount();
    ui.manager.open();
    const opened = Number(managerEl()?.style.zIndex);
    ui.manager.close();

    ui.manager.toggle();

    expect(Number(managerEl()?.style.zIndex)).toBeGreaterThan(opened);
    ui.dispose();
  });
});
