// @vitest-environment happy-dom

// The Dev pane as it actually renders.
//
// A separate suite from manager-render because it needs the market and dev
// halves of the bridge, which every other pane passes as null.
//
// The pane no longer lists what the local server offers: dev mode merges that
// source into the marketplace list, so Browse shows those rows with the same
// confirmation and the same badge as every other source. What is checked here is
// what is left, which is what nothing else owns.
//
// It exists because of how M4's settings pane failed: the code was right in
// isolation and the pane came up blank in the game, because a read that threw
// during render unmounted it. Nothing catches that except rendering.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiagnosticsReading } from '../loader/src/runtime/diagnostics.ts';
import { mountManager } from '../loader/src/runtime/ui/manager/index.tsx';
import { UI_TEXT } from '../loader/src/runtime/ui/manager/strings.ts';
import { TABS } from '../loader/src/runtime/ui/manager/tabs.ts';
import { LOCAL, LOCAL_ORIGIN, OFFICIAL } from '../loader/src/shared/marketplace.ts';
import type {
  DevState,
  MarketplaceEntry,
  MarketplaceState,
} from '../loader/src/shared/protocol.ts';
import { fakeMarketApi, marketState } from './fakes/market.ts';
import { fakeRegistry, managerServices } from './fakes/ui-deps.ts';

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

describe('the tab', () => {
  it('is in the strip', () => {
    expect(TABS.map((tab) => tab.id)).toContain('dev');
  });
});

describe('the pane', () => {
  it('renders rather than coming up blank', async () => {
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

  // Two lists of one thing go out of step, and the one with fewer eyes on it is
  // the one that rots. The pane points at the list that is maintained.
  it('points at Browse for what the server offers rather than listing it again', async () => {
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
      // managerServices supplies a fixed formatter, so this does not depend on
      // the machine's locale.
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

  // Refresh has nothing to refresh with the source switched off, and offering it
  // reads as a way to turn the source on, which it is not.
  it('disables Refresh while dev mode is off', async () => {
    await open({ dev: devState({ enabled: false }) });

    await vi.waitFor(() => {
      expect(buttonNamed(UI_TEXT.devRefresh)?.disabled).toBe(true);
    });
  });
});

describe('with no bridge', () => {
  it('says the loader is not connected rather than rendering empty controls', async () => {
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
      ...managerServices(document),
    });
    cleanups.push(manager.dispose);
    manager.open();
    await clickTab('Dev');

    await vi.waitFor(() => {
      expect(text()).toContain(UI_TEXT.devUnreachable);
    });
  });
});
