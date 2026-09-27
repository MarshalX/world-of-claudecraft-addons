// @vitest-environment happy-dom

// The Dev pane as it renders. Separate from manager-render because it needs the market
// and dev halves of the bridge; a read that throws during render blanks a pane, and only
// rendering catches that.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiagnosticsReading } from '../loader/src/runtime/diagnostics.ts';
import { isFrozen, setFrozen } from '../loader/src/runtime/freeze.ts';
import { createUnlockMode } from '../loader/src/runtime/ui/kit/unlock.ts';
import { mountManager } from '../loader/src/runtime/ui/manager/index.tsx';
import { UI_TEXT } from '../loader/src/runtime/ui/manager/strings.ts';
import { TABS } from '../loader/src/runtime/ui/manager/tabs.ts';
import { FROZEN_CLASS } from '../loader/src/runtime/ui/root.ts';
import { LOCAL, LOCAL_ORIGIN, OFFICIAL } from '../loader/src/shared/marketplace.ts';
import type {
  DevState,
  MarketplaceEntry,
  MarketplaceState,
} from '../loader/src/shared/protocol.ts';
import { fakeMarketApi, marketState } from './fakes/market.ts';
import { fakeRegistry, managerServices, menuService } from './fakes/ui-deps.ts';

const READING: DiagnosticsReading = {
  origin: 'https://pbe.worldofclaudecraft.com',
  channel: 'pbe',
  loaderVersion: '0.5.0',
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
  anchors: [],
};

function offered(id = 'dev-harness'): MarketplaceEntry {
  return {
    id,
    name: 'Dev Harness',
    version: '1.0.0',
    apiVersion: 1,
    author: 'MarshalX',
    description: 'Checks every part of the addon API.',
    entry: 'main.js',
    path: `addons/${id}`,
  };
}

function devState(overrides: Partial<DevState> = {}): DevState {
  return {
    enabled: true,
    hotReload: false,
    origin: LOCAL_ORIGIN,
    polledAt: null,
    error: null,
    ...overrides,
  };
}

interface Options {
  dev?: DevState;
  addons?: MarketplaceEntry[];
  installed?: string[];
  install?: () => Promise<void>;
  setEnabled?: () => Promise<void>;
  setHotReload?: () => Promise<void>;
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const stop of cleanups.splice(0)) {
    stop();
  }
  // Module state by design, so a frozen case would freeze the next one.
  setFrozen(document, false);
  document.body.innerHTML = '';
});

function markets(addons: MarketplaceEntry[]): MarketplaceState[] {
  return [marketState(OFFICIAL, [], { fetchedAt: null }), marketState(LOCAL, addons)];
}

async function open(options: Options = {}) {
  const root = document.createElement('div');
  root.id = 'woc-addons';
  document.body.appendChild(root);

  const calls = {
    setEnabled: vi.fn(options.setEnabled ?? (() => Promise.resolve())),
    setHotReload: vi.fn(options.setHotReload ?? (() => Promise.resolve())),
    install: vi.fn(options.install ?? (() => Promise.resolve())),
    uninstall: vi.fn(() => Promise.resolve()),
  };

  const manager = mountManager({
    doc: document,
    root,
    registry: fakeRegistry({
      list: () => Promise.resolve((options.installed ?? []).map((fqid) => ({ fqid }) as never)),
      install: calls.install,
      uninstall: calls.uninstall,
    }),
    storage: null,
    channel: 'pbe',
    readDiagnostics: () => READING,
    unlock: createUnlockMode(document.createElement('div')),
    openMenu: menuService(document, root),
    ...managerServices(document),
    market: fakeMarketApi({
      list: () => Promise.resolve(markets(options.addons ?? [offered()])),
    }),
    dev: {
      state: () => Promise.resolve(options.dev ?? devState()),
      setEnabled: calls.setEnabled,
      setHotReload: calls.setHotReload,
    },
  });
  cleanups.push(manager.dispose);
  manager.open();

  await clickTab('Dev');
  return { manager, calls };
}

/** Preact batches a state update into a microtask, so the pane swaps a tick later. */
async function clickTab(label: string): Promise<void> {
  const tab = [...document.querySelectorAll<HTMLButtonElement>('.woc-tab')].find(
    (button) => button.textContent === label,
  );
  tab?.click();
  await Promise.resolve();
}

const text = (): string => document.body.textContent ?? '';

const buttonNamed = (label: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('.woc-dev button')].find(
    (button) => button.textContent === label,
  );

const toggleNamed = (label: string): HTMLInputElement | null => {
  const found = [...document.querySelectorAll<HTMLLabelElement>('.woc-dev .woc-toggle')].find(
    (one) => one.textContent === label,
  );
  return found?.querySelector('input') ?? null;
};

describe('the tab', () => {
  it('is in the strip', () => {
    expect(TABS.map((tab) => tab.id)).toContain('dev');
  });
});

describe('the pane', () => {
  it('renders', async () => {
    await open();

    expect(document.querySelector('.woc-dev')).not.toBeNull();
  });

  it('says where the dev server is', async () => {
    await open();

    await vi.waitFor(() => {
      expect(text()).toContain(LOCAL_ORIGIN);
    });
  });

  it('says so plainly when dev mode is off', async () => {
    await open({ dev: devState({ enabled: false }) });

    await vi.waitFor(() => {
      expect(text()).toContain(UI_TEXT.devOff);
    });
  });

  it('points at Browse for what the server offers', async () => {
    await open();

    await vi.waitFor(() => {
      expect(text()).toContain(UI_TEXT.devInBrowse);
    });
    expect(document.querySelectorAll('.woc-dev .woc-row')).toHaveLength(0);
  });

  it('reports a dev server that is not running', async () => {
    await open({ dev: devState({ error: 'HTTP 404 from http://localhost:5180' }) });

    await vi.waitFor(() => {
      expect(text()).toContain('HTTP 404');
    });
  });

  it('renders the last index read once there has been one', async () => {
    await open({ dev: devState({ polledAt: 42 }) });

    await vi.waitFor(() => {
      // managerServices supplies a fixed, locale-independent formatter.
      expect(text()).toContain('t+42');
    });
  });
});

describe('the controls', () => {
  it('turns dev mode on from the toggle', async () => {
    const { calls } = await open({ dev: devState({ enabled: false }) });

    await vi.waitFor(() => {
      expect(document.querySelector('.woc-dev .woc-toggle input')).not.toBeNull();
    });
    document.querySelector<HTMLInputElement>('.woc-dev .woc-toggle input')?.click();

    await vi.waitFor(() => {
      expect(calls.setEnabled).toHaveBeenCalledWith(true);
    });
  });

  it('disables Refresh while dev mode is off', async () => {
    await open({ dev: devState({ enabled: false }) });

    await vi.waitFor(() => {
      expect(buttonNamed(UI_TEXT.devRefresh)?.disabled).toBe(true);
    });
  });
});

// What the freeze does is tests/freeze.test.ts; this is the control and its wiring.
describe('the freeze', () => {
  it('freezes every addon window from the toggle', async () => {
    await open();

    await vi.waitFor(() => {
      expect(toggleNamed(UI_TEXT.devFreeze)).not.toBeNull();
    });
    toggleNamed(UI_TEXT.devFreeze)?.click();

    await vi.waitFor(() => {
      expect(isFrozen()).toBe(true);
    });
    expect(document.getElementById('woc-addons')?.classList.contains(FROZEN_CLASS)).toBe(true);
  });

  it('unfreezes from the same toggle', async () => {
    await open();

    await vi.waitFor(() => {
      expect(toggleNamed(UI_TEXT.devFreeze)).not.toBeNull();
    });
    toggleNamed(UI_TEXT.devFreeze)?.click();
    toggleNamed(UI_TEXT.devFreeze)?.click();

    expect(isFrozen()).toBe(false);
  });

  // Never persisted, so a page reload always recovers from a freeze.
  it('reaches neither the host nor a store', async () => {
    const { calls } = await open();

    await vi.waitFor(() => {
      expect(toggleNamed(UI_TEXT.devFreeze)).not.toBeNull();
    });
    toggleNamed(UI_TEXT.devFreeze)?.click();

    expect(calls.setEnabled).not.toHaveBeenCalled();
    expect(calls.setHotReload).not.toHaveBeenCalled();
  });
});

describe('with no bridge', () => {
  async function openUnbridged(): Promise<void> {
    const root = document.createElement('div');
    root.id = 'woc-addons';
    document.body.appendChild(root);

    const manager = mountManager({
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
    cleanups.push(manager.dispose);
    manager.open();
    await clickTab('Dev');
  }

  it('says the loader is not connected', async () => {
    await openUnbridged();

    await vi.waitFor(() => {
      expect(text()).toContain(UI_TEXT.devUnreachable);
    });
  });

  // Freezing is pure runtime, so it stays available when the handshake failed.
  it('still offers the freeze', async () => {
    await openUnbridged();

    await vi.waitFor(() => {
      expect(toggleNamed(UI_TEXT.devFreeze)).not.toBeNull();
    });
  });
});
