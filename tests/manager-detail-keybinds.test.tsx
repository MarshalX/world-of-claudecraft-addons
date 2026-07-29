// @vitest-environment happy-dom

// The keybind editor on an addon's page in the manager, as it actually renders.
//
// Split out of manager-detail.test.tsx, which keeps the rest of the page (how it
// is reached, the settings form, the log tail); every case here turns on a combo,
// so they read as one topic and the two files stay within the length budget.
//
// The addon is deliberately DISABLED, as it is in the sibling suite. Rebinding is
// something a player does to an addon they have just turned off, so an editor that
// needed the addon running would be unavailable exactly when it is wanted. Nothing
// in this suite runs any addon code.

import { afterEach, describe, expect, it } from 'vitest';
import type { DiagnosticsReading } from '../loader/src/runtime/diagnostics.ts';
import { createGameBindings } from '../loader/src/runtime/keys/game-bindings.ts';
import { createLogBuffer } from '../loader/src/runtime/log/buffer.ts';
import { createConfigService } from '../loader/src/runtime/ui/manager/config.ts';
import { mountManager } from '../loader/src/runtime/ui/manager/index.tsx';
import type { InstalledRegistry } from '../loader/src/runtime/ui/manager/store.ts';
import { UI_TEXT } from '../loader/src/runtime/ui/manager/strings.ts';
import type { InstalledAddon } from '../loader/src/shared/protocol.ts';
import { configNamespace, KEYBINDS_KEY } from '../loader/src/shared/storage-keys.ts';
import { createFakeStorage, type FakeStorage } from './fakes/storage.ts';

const FQID = 'official/dps-meter';
const SETTLE_TURNS = 6;

const READING: DiagnosticsReading = {
  origin: 'https://pbe.worldofclaudecraft.com',
  channel: 'pbe',
  loaderVersion: '0.4.1',
  bridged: true,
  game: { version: '0.31.0', build: '1a2b3c4d5e6f' },
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
};

/** Deliberately DISABLED: the page has to work for an addon that is not running. */
function addon(): InstalledAddon {
  return {
    fqid: FQID,
    marketplace: 'official',
    enabled: false,
    pin: null,
    manifest: {
      id: 'dps-meter',
      name: 'DPS Meter',
      version: '1.2.0',
      apiVersion: 1,
      author: 'MarshalX',
      description: 'Rolling damage per second.',
      entry: 'main.js',
      settings: [
        { id: 'window', type: 'number', label: 'Rolling window', default: 5, min: 1, max: 60 },
        { id: 'show-pet', type: 'boolean', label: 'Include pet damage', default: true },
        { id: 'title', type: 'string', label: 'Window title', default: 'DPS' },
        {
          id: 'anchor',
          type: 'select',
          label: 'Anchor',
          default: 'top',
          options: ['top', 'bottom'],
        },
      ],
      keybinds: [{ id: 'toggle', label: 'Toggle DPS window', default: 'Alt+KeyD' }],
    },
  };
}

/** The same addon with its keybinds block taken away. */
function addonWithoutKeybinds(): InstalledAddon {
  const full = addon();
  const { keybinds: _keybinds, ...manifest } = full.manifest;
  return { ...full, manifest };
}

/** A game whose own bindings already claim KeyD, and nothing else. */
function forwardedAction(code: string): string | null {
  if (code === 'KeyD') {
    return 'someGameAction';
  }
  return null;
}

/**
 * Preact batches state into a microtask, and the stores load asynchronously.
 * The turns chain rather than resolve together, because each one releases the
 * continuation the next is waiting on.
 */
async function settle(turns = SETTLE_TURNS): Promise<void> {
  if (turns > 0) {
    await Promise.resolve();
    await settle(turns - 1);
  }
}

interface OpenOptions {
  hub?: FakeStorage;
  game?: unknown;
  capture?: () => Promise<string | null>;
  installed?: InstalledAddon;
}

function open(options: OpenOptions = {}) {
  const hub = options.hub ?? createFakeStorage();
  const registry: InstalledRegistry = {
    list: async () => [options.installed ?? addon()],
    setEnabled: async () => undefined,
  };
  const root = document.createElement('div');
  root.id = 'woc-addons';
  document.body.appendChild(root);

  const config = createConfigService({
    hub,
    game: createGameBindings({ game: () => options.game ?? null, storage: () => null }),
    addonBindings: () => ({}),
    onChange: () => {
      repaint();
    },
  });

  const manager = mountManager({
    doc: document,
    root,
    registry,
    storage: null,
    channel: 'pbe',
    readDiagnostics: () => READING,
    config,
    capture: options.capture ?? (() => Promise.resolve(null)),
    logs: createLogBuffer(),
  });
  const repaint = (): void => {
    if (manager.isOpen()) {
      manager.invalidate();
    }
  };

  manager.open();
  return { hub, manager, config };
}

function click(selector: string): void {
  document.querySelector<HTMLElement>(selector)?.click();
}

function clickLabelled(label: string): void {
  const target = [...document.querySelectorAll<HTMLElement>('button')].find(
    (button) => button.getAttribute('aria-label')?.startsWith(label) === true,
  );
  target?.click();
}

function text(): string {
  return document.body.textContent ?? '';
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the keybind editor', () => {
  const gameWithForward = {
    input: {
      keybinds: {
        heldActionForCode: forwardedAction,
        edgeActionForCombo: () => null,
      },
    },
  };

  async function openEditor(options: OpenOptions = {}) {
    const opened = open(options);
    await settle();
    clickLabelled(UI_TEXT.configure);
    await settle();
    return opened;
  }

  it('shows the combo in a readable form rather than as a key code', async () => {
    await openEditor();

    expect(document.querySelector('.woc-combo')?.textContent).toBe('Alt+D');
  });

  it('captures a new combo and persists it', async () => {
    const { hub } = await openEditor({ capture: () => Promise.resolve('Ctrl+KeyM') });

    click('.woc-combo');
    await settle();

    expect(hub.dump()[`${configNamespace(FQID)}/${KEYBINDS_KEY}`]).toEqual({
      toggle: 'Ctrl+KeyM',
    });
  });

  // Null is a closed prompt, not an answer, and must not clear the binding.
  it('leaves the binding alone when the prompt is cancelled', async () => {
    const { hub } = await openEditor({ capture: () => Promise.resolve(null) });

    click('.woc-combo');
    await settle();

    expect(hub.dump()[`${configNamespace(FQID)}/${KEYBINDS_KEY}`]).toBeUndefined();
  });

  it('offers Reset only once the binding has been overridden', async () => {
    const hub = createFakeStorage();
    await openEditor({ hub, capture: () => Promise.resolve('Ctrl+KeyM') });

    const reset = (): HTMLButtonElement | null =>
      [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent === UI_TEXT.resetBind,
      ) ?? null;
    expect(reset()?.disabled).toBe(true);

    click('.woc-combo');
    await settle();

    expect(reset()?.disabled).toBe(false);
  });

  it('resets back to the manifest default', async () => {
    const hub = createFakeStorage();
    await hub.set(configNamespace(FQID), KEYBINDS_KEY, { toggle: 'Ctrl+KeyM' });
    await openEditor({ hub });

    expect(document.querySelector('.woc-combo')?.textContent).toBe('Ctrl+M');
    clickLabelled(UI_TEXT.resetBind);
    await settle();

    expect(document.querySelector('.woc-combo')?.textContent).toBe('Alt+D');
  });

  // A conflict WARNS and never blocks: deliberately overriding a game binding is
  // legitimate.
  it('warns about a game binding without disabling anything', async () => {
    await openEditor({ game: gameWithForward });

    expect(text()).toContain(UI_TEXT.conflictPrefix);
    expect(text()).toContain('someGameAction');
    expect(document.querySelector<HTMLButtonElement>('.woc-combo')?.disabled).toBe(false);
  });

  it('says nothing when the combo is free', async () => {
    await openEditor({
      game: {
        input: {
          keybinds: { heldActionForCode: () => null, edgeActionForCombo: () => null },
        },
      },
    });

    expect(text()).not.toContain(UI_TEXT.conflictPrefix);
  });

  it('says so plainly when an addon declares no keybinds', async () => {
    await openEditor({ installed: addonWithoutKeybinds() });

    expect(text()).toContain(UI_TEXT.keybindsNone);
  });
});
