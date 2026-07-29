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
import { enterWorld, mountStartScreen } from './fakes/game-dom.ts';

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
      registry: null,
      storage: null,
      channel: 'pbe',
      readDiagnostics: () => READING,
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
      registry: null,
      storage: null,
      channel: 'pbe',
      readDiagnostics: () => READING,
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
      registry: null,
      storage: null,
      channel: 'pbe',
      readDiagnostics: () => READING,
    });

    ui.dispose();
    enterWorld(document);
    await settle();

    expect(document.getElementById('woc-addons-micro-button')).toBeNull();
  });
});
