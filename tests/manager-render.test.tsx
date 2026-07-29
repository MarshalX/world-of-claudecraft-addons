// @vitest-environment happy-dom

// The manager as it actually renders, mounted into a document.
//
// These assert what a player would see: which pane is showing, what the empty
// and unreachable states say, and that closing takes the window away rather
// than hiding it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiagnosticsReading } from '../loader/src/runtime/diagnostics.ts';
import { mountManager } from '../loader/src/runtime/ui/manager/index.tsx';
import type { InstalledRegistry } from '../loader/src/runtime/ui/manager/store.ts';
import { UI_TEXT } from '../loader/src/runtime/ui/manager/strings.ts';
import { TABS } from '../loader/src/runtime/ui/manager/tabs.ts';
import type { InstalledAddon } from '../loader/src/shared/protocol.ts';
import { managerServices } from './fakes/ui-deps.ts';

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

function open(registry: InstalledRegistry | null) {
  const root = document.createElement('div');
  root.id = 'woc-addons';
  document.body.appendChild(root);
  const manager = mountManager({
    doc: document,
    root,
    registry,
    storage: null,
    channel: 'pbe',
    readDiagnostics: () => READING,
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
      ...managerServices(document),
    });

    expect(document.querySelector('.woc-window')).toBeNull();
  });

  it('renders the window on open', () => {
    open(null);

    expect(document.querySelector('.woc-window')).not.toBeNull();
  });

  // The window carries the game's panel class so it inherits the game's border,
  // background, and tokens, but never `window`, which is display: none and
  // positioned for life inside the HUD's zoomed #ui.
  it('takes the game panel look without the game window layout', () => {
    open(null);

    const window_ = document.querySelector('.woc-window');
    expect(window_?.classList.contains('panel')).toBe(true);
    expect(window_?.classList.contains('window')).toBe(false);
  });

  // Unmounted rather than hidden: a hidden window keeps its Escape handler live,
  // which would swallow the game's own close key with nothing on screen.
  it('unmounts the window on close rather than hiding it', () => {
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

  // The handler is removed with the window, so a later Escape must reach the
  // game rather than being stopped by a listener nothing is behind.
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

  it('sends a toggle to the registry', async () => {
    const setEnabled = vi.fn(() => Promise.resolve());
    open({ list: () => Promise.resolve([addon()]), setEnabled });
    await vi.waitFor(() => {
      expect(document.querySelector('.woc-toggle input')).not.toBeNull();
    });

    document.querySelector<HTMLInputElement>('.woc-toggle input')?.click();

    expect(setEnabled).toHaveBeenCalledWith('official/minimap', false);
  });

  // The host emits registry.changed when another tab writes, and the runtime
  // turns that into invalidate(). Without a re-read this tab shows a stale list.
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

  // A tab that renders nothing reads as a broken loader. One that says what it
  // is waiting for reads as an unfinished one, which is the truth.
  it('says what an unbuilt pane is waiting for', async () => {
    open(null);

    await clickTab('Browse');

    expect(activeTab()).toBe('Browse');

    const pending = TABS.find((tab) => tab.id === 'browse')?.pending ?? '';
    expect(pending).not.toBe('');
    expect(text()).toContain(pending);
  });
});
