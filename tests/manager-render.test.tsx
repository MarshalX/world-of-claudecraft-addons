// @vitest-environment happy-dom

// The manager as it renders, mounted into a document.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiagnosticsReading } from '../loader/src/runtime/diagnostics.ts';
import { CLOSE_PATH } from '../loader/src/runtime/ui/kit/close-glyph.ts';
import { createUnlockMode } from '../loader/src/runtime/ui/kit/unlock.ts';
import type { ManagerRegistry } from '../loader/src/runtime/ui/manager/index.tsx';
import { mountManager } from '../loader/src/runtime/ui/manager/index.tsx';
import { UI_TEXT } from '../loader/src/runtime/ui/manager/strings.ts';
import { TABS } from '../loader/src/runtime/ui/manager/tabs.ts';
import type { InstalledAddon } from '../loader/src/shared/protocol.ts';
import { fakeRegistry, managerServices, menuService } from './fakes/ui-deps.ts';

const READING: DiagnosticsReading = {
  origin: 'https://pbe.worldofclaudecraft.com',
  channel: 'pbe',
  loaderVersion: '0.4.1',
  bridged: true,
  game: { version: '0.31.0', build: '1a2b3c4d5e6f' },
  probe: { present: ['world'], missing: [], added: [], ok: true },
  net: {
    connected: true,
    tick: 1200,
    tickHz: 20,
    pid: 658,
    realm: 'Claudemoon',
    seed: 20_061,
    latencyMs: 131.9,
    reconnects: 0,
  },
  anchors: [{ key: 'optionsMenu', selector: '#options-menu', found: true }],
};

function addon(): InstalledAddon {
  return {
    fqid: 'official/minimap',
    marketplace: 'official',
    enabled: true,
    pin: null,
    manifest: {
      id: 'minimap',
      name: 'Better Minimap',
      version: '1.2.0',
      apiVersion: 1,
      author: 'MarshalX',
      description: 'A better minimap.',
      entry: 'main.js',
    },
  };
}

/** Null stands for a bridge that never connected; a partial fills in the rest. */
function asRegistry(registry: Partial<ManagerRegistry> | null): ManagerRegistry | null {
  if (registry === null) {
    return null;
  }
  return fakeRegistry(registry);
}

function open(registry: Partial<ManagerRegistry> | null) {
  const root = document.createElement('div');
  root.id = 'woc-addons';
  document.body.appendChild(root);
  const manager = mountManager({
    doc: document,
    root,
    registry: asRegistry(registry),
    storage: null,
    channel: 'pbe',
    readDiagnostics: () => READING,
    unlock: createUnlockMode(document.createElement('div')),
    openMenu: menuService(document, root),
    ...managerServices(document),
  });
  manager.open();
  return manager;
}

/** Preact batches a state update into a microtask, so the pane swaps a tick later. */
async function clickTab(label: string): Promise<void> {
  const tab = [...document.querySelectorAll<HTMLButtonElement>('.woc-tab')].find(
    (button) => button.textContent === label,
  );
  tab?.click();
  await Promise.resolve();
  await Promise.resolve();
}

function activeTab(): string {
  return document.querySelector('.woc-tab-active')?.textContent ?? '';
}

function text(): string {
  return document.body.textContent ?? '';
}

/** A control inside the pane, by its accessible name. See the catalog suite's copy. */
function buttonNamed(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('.woc-pane button')].find(
    (button) => button.getAttribute('aria-label') === label,
  );
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('opening and closing', () => {
  it('renders nothing until it is opened', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    mountManager({
      doc: document,
      root,
      registry: null,
      storage: null,
      channel: 'pbe',
      readDiagnostics: () => READING,
      unlock: createUnlockMode(document.createElement('div')),
      openMenu: menuService(document, root),
      ...managerServices(document),
    });

    expect(document.querySelector('.woc-window')).toBeNull();
  });

  it('renders the window on open', () => {
    open(null);

    expect(document.querySelector('.woc-window')).not.toBeNull();
  });

  // The game's `window` class is display: none and positioned for the zoomed #ui.
  it('takes the game panel look without the game window layout', () => {
    open(null);

    const window_ = document.querySelector('.woc-window');
    expect(window_?.classList.contains('panel')).toBe(true);
    expect(window_?.classList.contains('window')).toBe(false);
  });

  // A hidden window would keep its Escape handler and swallow the game's close key.
  it('unmounts the window on close', () => {
    const manager = open(null);

    manager.close();

    expect(document.querySelector('.woc-window')).toBeNull();
    expect(manager.isOpen()).toBe(false);
  });

  it('closes on Escape', () => {
    const manager = open(null);

    globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(manager.isOpen()).toBe(false);
  });

  it('stops intercepting Escape once closed', () => {
    const manager = open(null);
    manager.close();
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    const stopped = vi.spyOn(event, 'stopPropagation');

    globalThis.dispatchEvent(event);

    expect(stopped).not.toHaveBeenCalled();
  });

  it('takes its container away on dispose', () => {
    const manager = open(null);

    manager.dispose();

    expect(document.querySelector('.woc-manager')).toBeNull();
  });
});

describe('the installed pane', () => {
  it('says the store is unreachable when the bridge never connected', () => {
    open(null);

    expect(text()).toContain(UI_TEXT.installedUnreachable);
  });

  it('says so plainly when nothing is installed', async () => {
    open({ list: () => Promise.resolve([]), setEnabled: vi.fn() });

    await vi.waitFor(() => {
      expect(text()).toContain(UI_TEXT.installedEmpty);
    });
  });

  it('renders a row per installed addon', async () => {
    open({ list: () => Promise.resolve([addon()]), setEnabled: vi.fn() });

    await vi.waitFor(() => {
      expect(document.querySelectorAll('.woc-row')).toHaveLength(1);
    });
    expect(text()).toContain('Better Minimap');
    expect(text()).toContain('1.2.0');
  });

  // Selected by accessible name: the arrange-your-UI switch is a toggle here too.
  it('sends a toggle to the registry', async () => {
    const setEnabled = vi.fn(() => Promise.resolve());
    open({ list: () => Promise.resolve([addon()]), setEnabled });
    const selector = '.woc-toggle input[aria-label*="Better Minimap"]';
    await vi.waitFor(() => {
      expect(document.querySelector(selector)).not.toBeNull();
    });

    document.querySelector<HTMLInputElement>(selector)?.click();

    expect(setEnabled).toHaveBeenCalledWith('official/minimap', false);
  });

  it('offers the arrange-your-UI switch, which belongs to no addon', async () => {
    open({ list: () => Promise.resolve([]), setEnabled: vi.fn() });

    await vi.waitFor(() => {
      expect(document.querySelector('.woc-unlock-row')).not.toBeNull();
    });
    expect(text()).toContain('Unlock frames');
  });

  it('switches a companion back on through the same call its own row makes', async () => {
    const setEnabled = vi.fn(() => Promise.resolve());
    open({
      list: () =>
        Promise.resolve([
          { ...addon(), manifest: { ...addon().manifest, companions: ['ledgerline'] } },
          {
            ...addon(),
            fqid: 'official/ledgerline',
            enabled: false,
            manifest: { ...addon().manifest, id: 'ledgerline', name: 'Ledgerline' },
          },
        ]),
      setEnabled,
    });
    const enable = `${UI_TEXT.companionEnable} Ledgerline`;
    await vi.waitFor(() => {
      expect(buttonNamed(enable)).toBeDefined();
    });

    buttonNamed(enable)?.click();

    expect(setEnabled).toHaveBeenCalledWith('official/ledgerline', true);
  });

  it('offers no action for a companion that is already running', async () => {
    open({
      list: () =>
        Promise.resolve([
          { ...addon(), manifest: { ...addon().manifest, companions: ['ledgerline'] } },
          {
            ...addon(),
            fqid: 'official/ledgerline',
            manifest: { ...addon().manifest, id: 'ledgerline', name: 'Ledgerline' },
          },
        ]),
      setEnabled: vi.fn(),
    });

    await vi.waitFor(() => {
      expect(document.querySelectorAll('.woc-row')).toHaveLength(2);
    });
    expect(document.querySelector('.woc-companion-action')).toBeNull();
  });

  // Another tab's write reaches this one as invalidate().
  it('re-reads on invalidate', async () => {
    const list = vi.fn(() => Promise.resolve([]));
    const manager = open({ list, setEnabled: vi.fn() });
    await vi.waitFor(() => {
      expect(list).toHaveBeenCalledTimes(1);
    });

    manager.invalidate();

    expect(list).toHaveBeenCalledTimes(2);
  });
});

describe('the tabs', () => {
  it('opens on the installed pane', () => {
    open(null);

    expect(activeTab()).toBe('Installed');
  });

  it('renders one tab per entry in the table', () => {
    open(null);

    expect(document.querySelectorAll('.woc-tab')).toHaveLength(TABS.length);
  });

  it('shows the diagnostics reading', async () => {
    open(null);

    await clickTab('Diagnostics');

    expect(activeTab()).toBe('Diagnostics');
    expect(text()).toContain('pbe');
    expect(text()).toContain('0.4.1');
    expect(text()).toContain('0.31.0 build 1a2b3c4d5e6f');
    expect(text()).toContain('Claudemoon');
    expect(text()).toContain('132 ms');
  });

  // A blank tab reads as a broken loader; the per-pane suites check the content.
  it.each(TABS.map((tab) => tab.label))(
    'draws something on the %s tab, with no bridge connected',
    async (label) => {
      open(null);

      await clickTab(label);

      expect(activeTab()).toBe(label);
      expect(text().trim()).not.toBe('');
    },
  );
});

// Both close-button renderers read kit/close-glyph.ts; each suite pins CLOSE_PATH.
describe('the close button', () => {
  it('draws the shared glyph', () => {
    const manager = open(null);
    const close = document.querySelector('.woc-close');

    expect(close?.querySelector('path')?.getAttribute('d')).toBe(CLOSE_PATH);
    expect(close?.textContent).toBe('');
    manager.dispose();
  });

  // The strings module is what a translation pass touches.
  it('is not carried in the strings module', () => {
    expect(Object.keys(UI_TEXT)).not.toContain('closeGlyph');
  });

  it('keeps the accessible name the mark cannot carry', () => {
    const manager = open(null);
    const close = document.querySelector('.woc-close');

    expect(close?.getAttribute('aria-label')).toBe(UI_TEXT.close);
    expect(close?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    manager.dispose();
  });
});
