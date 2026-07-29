// @vitest-environment happy-dom

// An addon's own page in the manager, as it actually renders: how a player reaches it,
// the settings form, and the log tail. The keybind editor is its own suite, in
// manager-detail-keybinds.test.tsx, standing on the same scaffolding.
//
// The case worth proving is that it works for a DISABLED addon: one that misbehaves is
// one a player turns off first and reconfigures second, so a settings screen needing the
// addon running would be unavailable exactly then. Nothing here runs any addon code.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiagnosticsReading } from '../loader/src/runtime/diagnostics.ts';
import { createGameBindings } from '../loader/src/runtime/keys/game-bindings.ts';
import { createLogBuffer } from '../loader/src/runtime/log/buffer.ts';
import { createConfigService } from '../loader/src/runtime/ui/manager/config.ts';
import { mountManager } from '../loader/src/runtime/ui/manager/index.tsx';
import type { InstalledRegistry } from '../loader/src/runtime/ui/manager/store.ts';
import { UI_TEXT } from '../loader/src/runtime/ui/manager/strings.ts';
import type { InstalledAddon } from '../loader/src/shared/protocol.ts';
import { configNamespace, SETTINGS_KEY } from '../loader/src/shared/storage-keys.ts';
import { createFakeStorage, type FakeStorage } from './fakes/storage.ts';
import { fakeRegistry, supervisorServices } from './fakes/ui-deps.ts';

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
function addon(overrides: Partial<InstalledAddon> = {}): InstalledAddon {
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
    ...overrides,
  };
}

function addonWithoutSettings(): InstalledAddon {
  const full = addon();
  const { settings: _settings, ...manifest } = full.manifest;
  return { ...full, manifest };
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
  installed?: InstalledAddon;
  logs?: ReturnType<typeof createLogBuffer>;
  setEnabled?: (fqid: string, on: boolean) => Promise<void>;
}

function open(options: OpenOptions = {}) {
  const hub = options.hub ?? createFakeStorage();
  const logs = options.logs ?? createLogBuffer();
  const registry: InstalledRegistry = fakeRegistry({
    list: async () => [options.installed ?? addon()],
    setEnabled: options.setEnabled ?? (async () => undefined),
  });
  const root = document.createElement('div');
  root.id = 'woc-addons';
  document.body.appendChild(root);

  const config = createConfigService({
    hub,
    game: createGameBindings({ game: () => null, storage: () => null }),
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
    capture: () => Promise.resolve(null),
    logs,
    market: null,
    dev: null,
    ...supervisorServices(),
  });
  const repaint = (): void => {
    if (manager.isOpen()) {
      manager.invalidate();
    }
  };

  manager.open();
  return { hub, logs, manager, config };
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

describe('reaching an addon page', () => {
  it('opens from the Configure button on the row', async () => {
    open();
    await settle();

    clickLabelled(UI_TEXT.configure);
    await settle();

    expect(text()).toContain(UI_TEXT.settingsHeading);
    expect(text()).toContain('DPS Meter');
  });

  it('goes back to the list', async () => {
    open();
    await settle();
    clickLabelled(UI_TEXT.configure);
    await settle();

    click('.woc-back');
    await settle();

    expect(text()).not.toContain(UI_TEXT.settingsHeading);
    expect(text()).toContain('Rolling damage per second.');
  });

  // Reopening on a page the player did not choose is disorienting, especially
  // when they closed the window to go and look at a different addon.
  it('reopens on the list rather than the page it was closed on', async () => {
    const { manager } = open();
    await settle();
    clickLabelled(UI_TEXT.configure);
    await settle();

    manager.close();
    manager.open();
    await settle();

    expect(text()).not.toContain(UI_TEXT.settingsHeading);
  });
});

describe('the settings form', () => {
  async function openForm(options: OpenOptions = {}) {
    const opened = open(options);
    await settle();
    clickLabelled(UI_TEXT.configure);
    await settle();
    return opened;
  }

  it('renders one control per declared setting, of the declared kind', async () => {
    await openForm();

    expect(document.querySelector('input[type="number"]')).not.toBeNull();
    expect(document.querySelector('input[type="checkbox"].woc-input')).toBeNull();
    expect(document.querySelector('.woc-field input[type="checkbox"]')).not.toBeNull();
    expect(document.querySelector('input[type="text"]')).not.toBeNull();
    expect(document.querySelectorAll('select option')).toHaveLength(2);
  });

  it('shows the stored value rather than the default', async () => {
    const hub = createFakeStorage();
    await hub.set(configNamespace(FQID), SETTINGS_KEY, { window: 30 });
    await openForm({ hub });

    expect(document.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('30');
  });

  it('persists an edit for an addon that is not running', async () => {
    const { hub } = await openForm();
    const field = document.querySelector<HTMLInputElement>('input[type="number"]');

    if (field !== null) {
      field.value = '25';
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await settle();

    expect(hub.dump()[`${configNamespace(FQID)}/${SETTINGS_KEY}`]).toMatchObject({ window: 25 });
  });

  it('persists a boolean toggle', async () => {
    const { hub } = await openForm();
    const field = document.querySelector<HTMLInputElement>('.woc-field input[type="checkbox"]');

    if (field !== null) {
      field.checked = false;
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await settle();

    expect(hub.dump()[`${configNamespace(FQID)}/${SETTINGS_KEY}`]).toMatchObject({
      'show-pet': false,
    });
  });

  it('says so plainly when an addon declares no settings', async () => {
    await openForm({ installed: addonWithoutSettings() });

    expect(text()).toContain(UI_TEXT.settingsNone);
  });
});

describe('the log tail', () => {
  it('says so when the addon has not logged', async () => {
    open();
    await settle();
    clickLabelled(UI_TEXT.configure);
    await settle();

    expect(text()).toContain(UI_TEXT.logsEmpty);
  });

  it('shows what the addon logged, newest last', async () => {
    const logs = createLogBuffer();
    logs.append(FQID, 'info', 1, 'started');
    logs.append(FQID, 'error', 2, 'could not read the roster');
    open({ logs });
    await settle();
    clickLabelled(UI_TEXT.configure);
    await settle();

    const lines = [...document.querySelectorAll('.woc-log-line')].map((el) => el.textContent);
    expect(lines).toEqual(['started', 'could not read the roster']);
    expect(document.querySelector('.woc-log-error')?.textContent).toBe('could not read the roster');
  });

  it("does not show another addon's lines", async () => {
    const logs = createLogBuffer();
    logs.append('other/addon', 'info', 1, 'not mine');
    open({ logs });
    await settle();
    clickLabelled(UI_TEXT.configure);
    await settle();

    expect(text()).not.toContain('not mine');
  });
});

// Found in the game, on the first real install. Installing does not enable, so
// the addon's own page opens reading STOPPED; before this it had Reload and
// Uninstall and no way to start the thing, and Reload itself is a no-op on a
// stopped addon because there is no running copy to re-evaluate. The page was a
// dead end that looked like a broken loader.
describe('starting a stopped addon from its own page', () => {
  it('offers an enable toggle', async () => {
    open({ installed: addon({ enabled: false }) });
    await settle();
    clickLabelled(UI_TEXT.configure);
    await settle();

    expect(document.querySelector('.woc-detail .woc-toggle input')).not.toBeNull();
  });

  it('sends the flip to the registry', async () => {
    const setEnabled = vi.fn(async () => undefined);
    open({ installed: addon({ enabled: false }), setEnabled });
    await settle();
    clickLabelled(UI_TEXT.configure);
    await settle();

    document.querySelector<HTMLInputElement>('.woc-detail .woc-toggle input')?.click();

    expect(setEnabled).toHaveBeenCalledWith(FQID, true);
  });

  it('shows the toggle reflecting the enable state', async () => {
    open({ installed: addon({ enabled: true }) });
    await settle();
    clickLabelled(UI_TEXT.configure);
    await settle();

    const box = document.querySelector<HTMLInputElement>('.woc-detail .woc-toggle input');
    expect(box?.checked).toBe(true);
  });

  // A button that answers a click with no visible effect reads as a broken
  // loader, which is exactly how this was reported.
  it('disables Reload while the addon is stopped, and says why', async () => {
    open({ installed: addon({ enabled: false }) });
    await settle();
    clickLabelled(UI_TEXT.configure);
    await settle();

    const reload = buttonNamed(UI_TEXT.reload);
    expect(reload?.disabled).toBe(true);
    expect(reload?.title).toBe(UI_TEXT.reloadNeedsEnabled);
  });

  it('enables Reload once the addon is running', async () => {
    open({ installed: addon({ enabled: true }) });
    await settle();
    clickLabelled(UI_TEXT.configure);
    await settle();

    expect(buttonNamed(UI_TEXT.reload)?.disabled).toBe(false);
  });
});

/** One of the detail page's own buttons, by its visible label. */
function buttonNamed(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('.woc-detail button')].find(
    (button) => button.textContent === label,
  );
}
