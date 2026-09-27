// @vitest-environment happy-dom

// Browse, Marketplaces, and Updates as they render. Rendered rather than asserted on the store,
// because a read that throws during render unmounts the pane and only rendering catches that.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiagnosticsReading } from '../loader/src/runtime/diagnostics.ts';
import { createUnlockMode } from '../loader/src/runtime/ui/kit/unlock.ts';
import { mountManager } from '../loader/src/runtime/ui/manager/index.tsx';
import { COMPANION_TEXT, UI_TEXT } from '../loader/src/runtime/ui/manager/strings.ts';
import type { MarketplaceRef } from '../loader/src/shared/marketplace.ts';
import { OFFICIAL } from '../loader/src/shared/marketplace.ts';
import type {
  InstalledAddon,
  MarketplaceEntry,
  MarketplaceState,
  UpdateRow,
} from '../loader/src/shared/protocol.ts';
import { fakeMarketApi, marketEntry, marketState } from './fakes/market.ts';
import { fakeRegistry, managerServices, menuService } from './fakes/ui-deps.ts';

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

function installedRow(fqid = FQID, patch: Partial<MarketplaceEntry> = {}): InstalledAddon {
  const { path: _path, ...manifest } = marketEntry(patch);
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
    unlock: createUnlockMode(document.createElement('div')),
    openMenu: menuService(document, root),
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
 * A control inside the pane, by its text or its accessible name. Scoped to `.woc-pane` because
 * the tab strip also has an "Installed" button.
 */
function buttonNamed(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('.woc-pane button')].find(
    (button) => button.textContent === label || button.getAttribute('aria-label') === label,
  );
}

/** One companion line's name element, which is where its reason hangs. */
function companionNamed(name: string): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>('.woc-companion-name')].find(
      (el) => el.textContent === name,
    ) ?? null
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

  it("draws a row thumbnail from the addon's own directory", async () => {
    await browse({
      markets: [
        marketState(OFFICIAL, [
          marketEntry({ preview: { file: 'preview.png', alt: 'A meter, mid-fight.' } }),
        ]),
      ],
    });

    await until(() => {
      expect(document.querySelector('.woc-shot-thumb')).not.toBeNull();
    });
    const shot = document.querySelector('.woc-shot-thumb');
    expect(shot?.getAttribute('src')).toContain('/addons/combat-meter/preview.png');
    expect(shot?.getAttribute('alt')).toBe('A meter, mid-fight.');
  });

  it('draws no column at all when nothing on offer has a preview', async () => {
    await browse({ markets: [marketState(OFFICIAL, [marketEntry()])] });

    await until(() => {
      expect(text()).toContain('Combat Meter');
    });
    expect(document.querySelector('.woc-shot')).toBeNull();
    expect(document.querySelector('.woc-shot-slot')).toBeNull();
  });

  // Without the reserved slot, rows with a picture indent their text and rows without do not.
  it('reserves the slot on rows with no preview once any row has one', async () => {
    await browse({
      markets: [
        marketState(OFFICIAL, [
          marketEntry({ preview: { file: 'preview.png', alt: 'A meter, mid-fight.' } }),
          marketEntry({ id: 'plain', name: 'Plain' }),
        ]),
      ],
    });

    await until(() => {
      expect(text()).toContain('Plain');
    });
    expect(document.querySelectorAll('.woc-shot-thumb')).toHaveLength(1);
    expect(document.querySelectorAll('.woc-shot-slot')).toHaveLength(1);
  });

  // Asked of every source rather than the filtered rows, so typing cannot toggle the column.
  it('keeps the column while a filter hides every row that has a preview', async () => {
    await browse({
      markets: [
        marketState(OFFICIAL, [
          marketEntry({ preview: { file: 'preview.png', alt: 'A meter, mid-fight.' } }),
          marketEntry({ id: 'plain', name: 'Plain' }),
        ]),
      ],
    });

    await until(() => {
      expect(text()).toContain('Plain');
    });
    const search = document.querySelector('#woc-browse-search') as HTMLInputElement;
    search.value = 'Plain';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    await until(() => {
      expect(text()).not.toContain('Combat Meter');
    });
    expect(document.querySelectorAll('.woc-shot-slot')).toHaveLength(1);
  });

  it('reserves no slot on the confirmation for an addon with no preview', async () => {
    await browse({ markets: [marketState(OFFICIAL, [marketEntry()])] });

    await until(() => {
      expect(text()).toContain('Combat Meter');
    });
    buttonNamed(`${UI_TEXT.browseInstall} Combat Meter`)?.click();

    await until(() => {
      expect(document.querySelector('.woc-confirm')).not.toBeNull();
    });
    expect(document.querySelector('.woc-confirm .woc-shot-slot')).toBeNull();
  });

  it('says a source has not been read yet rather than showing an empty list', async () => {
    await browse({ markets: [marketState(OFFICIAL, [], { fetchedAt: null })] });

    await until(() => {
      expect(text()).toContain(UI_TEXT.browseEmpty);
    });
  });

  // "Refresh to fetch their indexes" is wrong advice here: the index was fetched and answered 404.
  it('points at the Marketplaces tab when a source could not be read', async () => {
    await browse({
      markets: [marketState(OFFICIAL, [], { fetchedAt: null, error: 'HTTP 404' })],
    });

    await until(() => {
      expect(text()).toContain(UI_TEXT.browseUnreadable);
    });
    expect(text()).not.toContain(UI_TEXT.browseEmpty);
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

  // Install is never one click: the declaration and the note that it is not enforced come first.
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

  // The rule itself lives in MarketApi.remove; this pins its presentation.
  it('gives the official source no Remove control', async () => {
    await markets({ markets: bothSources });

    await until(() => {
      expect(text()).toContain(OFFICIAL.name);
    });
    expect(buttonNamed(`${UI_TEXT.marketsRemove} ${OFFICIAL.name}`)).toBeUndefined();
    expect(buttonNamed(`${UI_TEXT.marketsRemove} ${THIRD_PARTY.name}`)).toBeDefined();
  });

  it('says what official means', async () => {
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

    type('#woc-market-url', 'someone/their-addons');
    type('#woc-market-ref', 'v2.0.0');
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

// A companion note gates nothing: every action it offers jumps into a control that already exists.
describe('companion notes', () => {
  async function browse(options: Options = {}) {
    const opened = open(options);
    await clickTab('Browse');
    await until(() => {
      expect(document.querySelector('.woc-browse')).not.toBeNull();
    });
    return opened;
  }

  it('draws a companion note without touching the Install control', async () => {
    await browse({
      markets: [
        marketState(OFFICIAL, [
          marketEntry({ companions: ['lorebind'] }),
          marketEntry({ id: 'lorebind', name: 'Lorebind' }),
        ]),
      ],
    });

    await until(() => {
      expect(text()).toContain(UI_TEXT.companions);
    });
    expect(buttonNamed(`${UI_TEXT.browseInstall} Combat Meter`)?.disabled).toBe(false);
  });

  it('draws the name a source offers rather than the bare id', async () => {
    await browse({
      markets: [
        marketState(OFFICIAL, [
          marketEntry({ companions: ['lorebind'] }),
          marketEntry({ id: 'lorebind', name: 'Lorebind' }),
        ]),
      ],
    });

    await until(() => {
      expect(companionNamed('Lorebind')).not.toBeNull();
    });
    expect(companionNamed('lorebind')).toBeNull();
  });

  it('carries the reason its manifest gave, on the name', async () => {
    await browse({
      markets: [
        marketState(OFFICIAL, [
          marketEntry({
            companions: ['lorebind'],
            companionReasons: { lorebind: 'publishes the item prices this adds up' },
          }),
          marketEntry({ id: 'lorebind', name: 'Lorebind' }),
        ]),
      ],
    });

    await until(() => {
      expect(companionNamed('Lorebind')).not.toBeNull();
    });
    expect(companionNamed('Lorebind')?.title).toContain('publishes the item prices this adds up');
  });

  it('says when a named companion is installed but switched off', async () => {
    await browse({
      markets: [
        marketState(OFFICIAL, [
          marketEntry({ companions: ['lorebind'] }),
          marketEntry({ id: 'lorebind', name: 'Lorebind' }),
        ]),
      ],
      installed: [
        {
          ...installedRow('official/lorebind', { id: 'lorebind', name: 'Lorebind' }),
          enabled: false,
        },
      ],
    });

    await until(() => {
      expect(text()).toContain(COMPANION_TEXT.disabled);
    });
    expect(companionNamed('Lorebind')).not.toBeNull();
  });

  it('offers no Enable in Browse', async () => {
    await browse({
      markets: [
        marketState(OFFICIAL, [
          marketEntry({ companions: ['lorebind'] }),
          marketEntry({ id: 'lorebind', name: 'Lorebind' }),
        ]),
      ],
      installed: [
        {
          ...installedRow('official/lorebind', { id: 'lorebind', name: 'Lorebind' }),
          enabled: false,
        },
      ],
    });

    await until(() => {
      expect(text()).toContain(COMPANION_TEXT.disabled);
    });
    expect(buttonNamed(`${UI_TEXT.companionEnable} Lorebind`)).toBeUndefined();
  });

  // Get takes the same install path as the row's own button, via the confirmation.
  it('sends Get to the confirmation for the companion, not for the naming row', async () => {
    await browse({
      markets: [
        marketState(OFFICIAL, [
          marketEntry({
            companions: ['lorebind'],
            companionReasons: { lorebind: 'publishes the item prices this adds up' },
          }),
          marketEntry({ id: 'lorebind', name: 'Lorebind' }),
        ]),
      ],
    });

    await until(() => {
      expect(buttonNamed(`${UI_TEXT.companionGet} Lorebind`)).toBeDefined();
    });
    buttonNamed(`${UI_TEXT.companionGet} Lorebind`)?.click();

    await until(() => {
      expect(text()).toContain(`${UI_TEXT.confirmHeading} Lorebind`);
    });
    // The confirmation names who recommended the companion.
    expect(text()).toContain(`${UI_TEXT.confirmRecommendedBy} Combat Meter`);
    expect(text()).toContain('publishes the item prices this adds up');
  });

  // The search is held by the manager, not Browse, so it survives the tab switch.
  it('sends Find it to Browse with the companion already searched for', async () => {
    open({
      markets: [
        marketState(OFFICIAL, [
          marketEntry(),
          marketEntry({ id: 'lorebind', name: 'Lorebind', description: 'Every item in the game.' }),
        ]),
      ],
      installed: [installedRow(FQID, { companions: ['lorebind'] })],
    });
    const find = `${UI_TEXT.companionFind} Lorebind`;
    await until(() => {
      expect(buttonNamed(find)).toBeDefined();
    });

    buttonNamed(find)?.click();

    await until(() => {
      expect(document.querySelector('.woc-browse')).not.toBeNull();
    });
    expect(document.querySelector<HTMLInputElement>('#woc-browse-search')?.value).toBe('Lorebind');
    // The list is narrowed, not just the field filled.
    expect(document.querySelectorAll('.woc-row')).toHaveLength(1);
    expect(text()).toContain('Every item in the game.');
  });

  // The pending row is resolved against every row, not the filtered ones.
  it('opens the confirmation for a companion the current search hides', async () => {
    await browse({
      markets: [
        marketState(OFFICIAL, [
          marketEntry({ companions: ['lorebind'] }),
          marketEntry({ id: 'lorebind', name: 'Lorebind' }),
        ]),
      ],
    });

    await until(() => {
      expect(buttonNamed(`${UI_TEXT.companionGet} Lorebind`)).toBeDefined();
    });
    type('#woc-browse-search', 'combat');
    await until(() => {
      expect(text()).not.toContain('Lorebind Official Marketplace');
    });
    buttonNamed(`${UI_TEXT.companionGet} Lorebind`)?.click();

    await until(() => {
      expect(text()).toContain(`${UI_TEXT.confirmHeading} Lorebind`);
    });
  });
});

// The registry keeps no directory for an installed addon, so its picture comes from the catalog.
describe("the Installed pane's thumbnails", () => {
  const shot = { file: 'preview.png', alt: 'The panel, mid-fight.' };

  /** The pane the manager opens on, so there is no tab to click. */
  async function installed(options: Options) {
    const opened = open(options);
    await until(() => {
      expect(document.querySelector('.woc-row')).not.toBeNull();
    });
    return opened;
  }

  it("draws the picture the addon's own source places", async () => {
    await installed({
      markets: [marketState(OFFICIAL, [marketEntry({ preview: shot })])],
      installed: [installedRow()],
    });

    await until(() => {
      expect(document.querySelector('.woc-shot-thumb')).not.toBeNull();
    });
    const drawn = document.querySelector('.woc-shot-thumb');
    expect(drawn?.getAttribute('src')).toContain('/addons/combat-meter/preview.png');
    expect(drawn?.getAttribute('alt')).toBe(shot.alt);
  });

  // Unlike Browse, the column is asked of the installed rows only.
  it('draws no column when no installed addon has a picture', async () => {
    await installed({
      markets: [marketState(OFFICIAL, [marketEntry({ preview: shot })])],
      installed: [installedRow('official/lorebind')],
    });

    expect(document.querySelector('.woc-shot')).toBeNull();
    expect(document.querySelector('.woc-shot-slot')).toBeNull();
  });

  it('reserves the slot for a row the catalog cannot place once another has one', async () => {
    await installed({
      markets: [marketState(OFFICIAL, [marketEntry({ preview: shot })])],
      installed: [installedRow(), installedRow('official/lorebind')],
    });

    await until(() => {
      expect(document.querySelectorAll('.woc-shot-thumb')).toHaveLength(1);
    });
    expect(document.querySelectorAll('.woc-shot-slot')).toHaveLength(1);
  });
});
