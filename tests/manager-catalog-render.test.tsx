// @vitest-environment happy-dom

// Browse, Marketplaces, and Updates as they actually render.
//
// Rendered rather than asserted on the store, for the reason M4's settings pane
// established: the code was right in isolation and the pane came up blank in the
// game, because a read that threw during render unmounted it. Nothing catches
// that except rendering.
//
// The claims worth the most here are the ones about trust, because they are the
// ones a defect makes quietly weaker rather than visibly broken: an install has
// to show what the addon declares before it happens, adding a source has to warn
// first, and the official source must offer no control that would remove it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiagnosticsReading } from '../loader/src/runtime/diagnostics.ts';
import { mountManager } from '../loader/src/runtime/ui/manager/index.tsx';
import { UI_TEXT } from '../loader/src/runtime/ui/manager/strings.ts';
import type { MarketplaceRef } from '../loader/src/shared/marketplace.ts';
import { OFFICIAL } from '../loader/src/shared/marketplace.ts';
import type { InstalledAddon, MarketplaceState, UpdateRow } from '../loader/src/shared/protocol.ts';
import { fakeMarketApi, marketEntry, marketState } from './fakes/market.ts';
import { fakeRegistry, managerServices } from './fakes/ui-deps.ts';

const READING: DiagnosticsReading = {
  origin: 'https://pbe.worldofclaudecraft.com',
  channel: 'pbe',
  loaderVersion: '0.6.0',
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

const THIRD_PARTY: MarketplaceRef = {
  id: 'gh:someone/their-addons',
  name: 'someone/their-addons',
  source: { kind: 'github', owner: 'someone', repo: 'their-addons', ref: 'v2.0.0' },
};

const FQID = 'official/combat-meter';

function installedRow(fqid = FQID): InstalledAddon {
  const { path: _path, ...manifest } = marketEntry();
  return { fqid, marketplace: 'official', manifest, enabled: true, pin: null };
}

interface Options {
  markets?: MarketplaceState[];
  installed?: InstalledAddon[];
  updates?: UpdateRow[];
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const stop of cleanups.splice(0)) {
    stop();
  }
  document.body.innerHTML = '';
});

function open(options: Options = {}) {
  const root = document.createElement('div');
  root.id = 'woc-addons';
  document.body.appendChild(root);

  const calls = {
    install: vi.fn(() => Promise.resolve()),
    update: vi.fn(() => Promise.resolve()),
    setPin: vi.fn(() => Promise.resolve()),
    add: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
    setRef: vi.fn(() => Promise.resolve()),
    refresh: vi.fn(() => Promise.resolve()),
  };

  const manager = mountManager({
    doc: document,
    root,
    registry: fakeRegistry({
      list: () => Promise.resolve(options.installed ?? []),
      install: calls.install,
      update: calls.update,
      setPin: calls.setPin,
      updates: () => Promise.resolve(options.updates ?? []),
    }),
    storage: null,
    channel: 'pbe',
    readDiagnostics: () => READING,
    ...managerServices(document),
    market: fakeMarketApi({
      list: () => Promise.resolve(options.markets ?? [marketState(OFFICIAL, [marketEntry()])]),
      add: calls.add,
      remove: calls.remove,
      setRef: calls.setRef,
      refresh: calls.refresh,
    }),
    dev: null,
  });
  cleanups.push(manager.dispose);
  manager.open();
  return { manager, calls };
}

const text = (): string => document.body.textContent ?? '';

/** Wait for the pane to hold something, since the stores load asynchronously. */
const until = (assertion: () => void): Promise<void> => vi.waitFor(assertion);

async function clickTab(label: string): Promise<void> {
  const tab = [...document.querySelectorAll<HTMLButtonElement>('.woc-tab')].find(
    (button) => button.textContent === label,
  );
  tab?.click();
  await Promise.resolve();
}

/**
 * A control inside the pane, by its text or its accessible name.
 *
 * Scoped to `.woc-pane` rather than the document, because the tab strip is
 * buttons too and one of them is labelled "Installed", which is also what the
 * Browse row's control says once an addon is.
 */
function buttonNamed(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('.woc-pane button')].find(
    (button) => button.textContent === label || button.getAttribute('aria-label') === label,
  );
}

function type(selector: string, value: string): void {
  const field = document.querySelector<HTMLInputElement>(selector);
  if (field === null) {
    throw new Error(`no field matched ${selector}`);
  }
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('the Browse pane', () => {
  async function browse(options: Options = {}) {
    const opened = open(options);
    await clickTab('Browse');
    await until(() => {
      expect(document.querySelector('.woc-browse')).not.toBeNull();
    });
    return opened;
  }

  it('lists what every source offers, with the source named on each row', async () => {
    await browse({
      markets: [
        marketState(OFFICIAL, [marketEntry()]),
        marketState(THIRD_PARTY, [marketEntry({ id: 'theirs', name: 'Theirs' })], {
          builtin: false,
        }),
      ],
    });

    await until(() => {
      expect(text()).toContain('Combat Meter');
    });
    expect(text()).toContain('Theirs');
    expect(text()).toContain(OFFICIAL.name);
    expect(text()).toContain(THIRD_PARTY.name);
  });

  it('says a source has not been read yet rather than showing an empty list', async () => {
    await browse({ markets: [marketState(OFFICIAL, [], { fetchedAt: null })] });

    await until(() => {
      expect(text()).toContain(UI_TEXT.browseEmpty);
    });
  });

  it('reports an unmatched search differently from an unread source', async () => {
    await browse();
    await until(() => {
      expect(text()).toContain('Combat Meter');
    });

    type('.woc-filters input[type="search"]', 'unicorn');
    await Promise.resolve();

    expect(text()).toContain(UI_TEXT.browseNoMatch);
    expect(text()).not.toContain(UI_TEXT.browseEmpty);
  });

  it('offers no Install for something already installed', async () => {
    await browse({ installed: [installedRow()] });

    await until(() => {
      expect(text()).toContain(UI_TEXT.browseInstalled);
    });
    expect(buttonNamed(UI_TEXT.browseInstalled)?.disabled).toBe(true);
  });

  // The trust question. Install must not be one click from a browse row: what
  // the addon declares, and the fact that the declaration is not enforced, both
  // have to be on screen before anything is fetched.
  it('shows the declared permissions and the trust note before installing', async () => {
    const { calls } = await browse({
      markets: [marketState(OFFICIAL, [marketEntry({ permissions: ['net.read', 'storage'] })])],
    });
    await until(() => {
      expect(text()).toContain('Combat Meter');
    });

    buttonNamed(`${UI_TEXT.browseInstall} Combat Meter`)?.click();
    await Promise.resolve();

    expect(calls.install).not.toHaveBeenCalled();
    expect(text()).toContain('login token');
    expect(document.querySelectorAll('.woc-perms li')).toHaveLength(2);
  });

  // The list the player came from shows it, and then the screen where they
  // actually decide used to drop it.
  it('shows what the addon says it does', async () => {
    await browse({
      markets: [
        marketState(OFFICIAL, [marketEntry({ description: 'Rolling damage per second.' })]),
      ],
    });
    await until(() => {
      expect(text()).toContain('Combat Meter');
    });

    buttonNamed(`${UI_TEXT.browseInstall} Combat Meter`)?.click();
    await Promise.resolve();

    expect(document.querySelector('.woc-confirm')).not.toBeNull();
    expect(document.querySelector('.woc-confirm .woc-row-desc')?.textContent).toBe(
      'Rolling damage per second.',
    );
  });

  it('installs by fqid once the confirmation is accepted', async () => {
    const { calls } = await browse();
    await until(() => {
      expect(text()).toContain('Combat Meter');
    });
    buttonNamed(`${UI_TEXT.browseInstall} Combat Meter`)?.click();
    await Promise.resolve();

    buttonNamed(UI_TEXT.confirmInstall)?.click();
    await Promise.resolve();

    expect(calls.install).toHaveBeenCalledWith(FQID);
  });

  it('installs nothing when the confirmation is cancelled', async () => {
    const { calls } = await browse();
    await until(() => {
      expect(text()).toContain('Combat Meter');
    });
    buttonNamed(`${UI_TEXT.browseInstall} Combat Meter`)?.click();
    await Promise.resolve();

    buttonNamed(UI_TEXT.confirmCancel)?.click();
    await Promise.resolve();

    expect(calls.install).not.toHaveBeenCalled();
    expect(document.querySelector('.woc-confirm')).toBeNull();
  });
});

describe('the Marketplaces pane', () => {
  async function markets(options: Options = {}) {
    const opened = open(options);
    await clickTab('Marketplaces');
    await until(() => {
      expect(document.querySelector('.woc-markets')).not.toBeNull();
    });
    return opened;
  }

  const bothSources: MarketplaceState[] = [
    marketState(OFFICIAL, [marketEntry()]),
    marketState(THIRD_PARTY, [], { builtin: false }),
  ];

  // The rule lives in MarketApi.remove; this is the presentation of it, and the
  // presentation is what a player experiences as the guarantee.
  it('gives the official source no Remove control', async () => {
    await markets({ markets: bothSources });

    await until(() => {
      expect(text()).toContain(OFFICIAL.name);
    });
    expect(buttonNamed(`${UI_TEXT.marketsRemove} ${OFFICIAL.name}`)).toBeUndefined();
    expect(buttonNamed(`${UI_TEXT.marketsRemove} ${THIRD_PARTY.name}`)).toBeDefined();
  });

  it('says what official means, since it does not mean endorsed by the game', async () => {
    await markets({ markets: bothSources });

    await until(() => {
      expect(text()).toContain(UI_TEXT.marketsOfficialNote);
    });
  });

  it('shows a user-added source its ref and its addon count', async () => {
    await markets({ markets: bothSources });

    await until(() => {
      expect(text()).toContain('v2.0.0');
    });
  });

  it('warns when a source had to be read by enumerating the repository', async () => {
    await markets({
      markets: [marketState(THIRD_PARTY, [], { builtin: false, degraded: true })],
    });

    await until(() => {
      expect(text()).toContain(UI_TEXT.marketsDegraded);
    });
  });

  it('says nothing about enumeration for a source that published an index', async () => {
    await markets({ markets: bothSources });

    await until(() => {
      expect(text()).toContain(OFFICIAL.name);
    });
    expect(text()).not.toContain(UI_TEXT.marketsDegraded);
  });

  // Adding a source is the friction-carrying act: everything it publishes
  // becomes code the player has chosen to run, with the page's globals in scope.
  it('carries the trust warning on the add form', async () => {
    await markets();

    await until(() => {
      expect(text()).toContain(UI_TEXT.marketsAddWarning);
    });
  });

  it('adds a source with the ref the form supplied', async () => {
    const { calls } = await markets();
    await until(() => {
      expect(buttonNamed(UI_TEXT.marketsAdd)).toBeDefined();
    });

    type('.woc-form label:first-of-type input', 'someone/their-addons');
    type('.woc-form label:last-of-type input', 'v2.0.0');
    await Promise.resolve();
    buttonNamed(UI_TEXT.marketsAdd)?.click();

    expect(calls.add).toHaveBeenCalledWith('someone/their-addons', 'v2.0.0');
  });

  it('repoints a source through the ref field', async () => {
    const { calls } = await markets({ markets: bothSources });
    await until(() => {
      expect(document.querySelector('.woc-market .woc-combo')).not.toBeNull();
    });

    type('.woc-market .woc-combo', 'v3.0.0');
    await Promise.resolve();
    buttonNamed(UI_TEXT.marketsPin)?.click();

    expect(calls.setRef).toHaveBeenCalledWith(THIRD_PARTY.id, 'v3.0.0');
  });
});

describe('the Updates pane', () => {
  const pending: UpdateRow = {
    fqid: FQID,
    name: 'Combat Meter',
    marketplace: 'official',
    installed: '1.2.0',
    available: '1.3.0',
    pin: null,
  };

  async function updates(options: Options = {}) {
    const opened = open(options);
    await clickTab('Updates');
    await until(() => {
      expect(document.querySelector('.woc-updates')).not.toBeNull();
    });
    return opened;
  }

  // The absence of auto-update is a decision, not an omission, so the pane says
  // so rather than leaving it to be inferred from nothing happening.
  it('states that auto-update is off and that the rows are from a cached index', async () => {
    await updates();

    await until(() => {
      expect(text()).toContain(UI_TEXT.updatesAuto);
    });
    expect(text()).toContain(UI_TEXT.updatesStale);
  });

  it('says everything is current when nothing has moved', async () => {
    await updates();

    await until(() => {
      expect(text()).toContain(UI_TEXT.updatesNone);
    });
  });

  it('shows the installed and available versions on a row that moved', async () => {
    await updates({ updates: [pending] });

    await until(() => {
      expect(text()).toContain('1.2.0');
    });
    expect(text()).toContain('1.3.0');
  });

  it('updates one addon by fqid', async () => {
    const { calls } = await updates({ updates: [pending] });
    await until(() => {
      expect(buttonNamed(`${UI_TEXT.updatesUpdate} Combat Meter`)).toBeDefined();
    });

    buttonNamed(`${UI_TEXT.updatesUpdate} Combat Meter`)?.click();

    expect(calls.update).toHaveBeenCalledWith(FQID);
  });

  it('pins an addon at the version it already has', async () => {
    const { calls } = await updates({ updates: [pending] });
    await until(() => {
      expect(buttonNamed(`${UI_TEXT.updatesPin} Combat Meter`)).toBeDefined();
    });

    buttonNamed(`${UI_TEXT.updatesPin} Combat Meter`)?.click();

    expect(calls.setPin).toHaveBeenCalledWith(FQID, '1.2.0');
  });

  // A pinned row still appears, so the pane can say an update exists and that
  // the player's own pin is what is holding it back.
  it('offers a pinned row Unpin instead of Update', async () => {
    await updates({ updates: [{ ...pending, pin: '1.2.0' }] });

    await until(() => {
      expect(text()).toContain(UI_TEXT.updatesPinned);
    });
    expect(buttonNamed(`${UI_TEXT.updatesUnpin} Combat Meter`)).toBeDefined();
    expect(buttonNamed(`${UI_TEXT.updatesUpdate} Combat Meter`)).toBeUndefined();
  });

  it('leaves a pinned row out of Update all', async () => {
    await updates({ updates: [{ ...pending, pin: '1.2.0' }] });

    await until(() => {
      expect(buttonNamed(UI_TEXT.updatesUpdateAll)).toBeDefined();
    });
    expect(buttonNamed(UI_TEXT.updatesUpdateAll)?.disabled).toBe(true);
  });

  it('updates every unpinned row in turn', async () => {
    const second = { ...pending, fqid: 'official/bag-sort', name: 'Bag Sorter' };
    const { calls } = await updates({ updates: [pending, second] });
    await until(() => {
      expect(buttonNamed(UI_TEXT.updatesUpdateAll)?.disabled).toBe(false);
    });

    buttonNamed(UI_TEXT.updatesUpdateAll)?.click();
    await until(() => {
      expect(calls.update).toHaveBeenCalledTimes(2);
    });

    expect(calls.update.mock.calls).toEqual([[FQID], ['official/bag-sort']]);
  });
});
