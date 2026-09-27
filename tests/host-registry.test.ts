// The registry: the installed set, the enable flag, and the cached entry source. The persisted
// blob is untrusted: the player can edit GM storage and an older loader may have written it.
//
// The fetch half runs through the real fetcher over a fake transport, because a stubbed fetcher
// would pass a version that never wrote the body into the cache.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegistryDeps } from '../loader/src/host/addon-fetch.ts';
import { createFetcher } from '../loader/src/host/fetcher.ts';
import { createRegistry } from '../loader/src/host/registry.ts';
import { dataKey, sourceKey } from '../loader/src/host/registry-keys.ts';
import { DATA_MAX_BYTES } from '../loader/src/shared/addon-data.ts';
import { LOCAL, OFFICIAL } from '../loader/src/shared/marketplace.ts';
import type {
  InstalledAddon,
  MarketplaceEntry,
  MarketplaceState,
} from '../loader/src/shared/protocol.ts';
import { type CapturedDiag, captureDiag } from './fakes/diag.ts';
import { createFakeHostStorage } from './fakes/host-storage.ts';
import { createFakeHttp, createFakeValues } from './fakes/http.ts';
import { marketState } from './fakes/market.ts';

const NS = 'loader';
const KEY = 'installed';
const FQID = 'official/minimap';
const LOCAL_FQID = 'local/minimap';
const NOT_INSTALLED = /not installed/;

const RAW = 'https://raw.githubusercontent.com/MarshalX/world-of-claudecraft-addons/HEAD';
const OFFICIAL_ENTRY_URL = `${RAW}/addons/minimap/main.js`;
const OFFICIAL_ITEMS_URL = `${RAW}/addons/minimap/items.json`;
const OFFICIAL_ZONES_URL = `${RAW}/addons/minimap/zones.json`;
const LOCAL_ENTRY_URL = 'http://localhost:5180/addons/minimap/main.js';
const LOCAL_ITEMS_URL = 'http://localhost:5180/addons/minimap/items.json';

/** A manifest declaring data files, and the bodies that go with it. */
const ITEMS = '{"sword":"Sword"}';
const ZONES = '{"1":"Elwynn"}';

const MANIFEST = {
  id: 'minimap',
  name: 'Better Minimap',
  version: '1.2.0',
  apiVersion: 1,
  author: 'MarshalX',
  description: 'A better minimap.',
  entry: 'main.js',
};

function addon(overrides: Partial<InstalledAddon> = {}): InstalledAddon {
  return {
    fqid: FQID,
    marketplace: 'official',
    enabled: true,
    pin: null,
    manifest: MANIFEST,
    ...overrides,
  };
}

function indexRow(overrides: Partial<MarketplaceEntry> = {}): MarketplaceEntry {
  return { ...MANIFEST, path: 'addons/minimap', ...overrides };
}

/**
 * A market that offers `minimap` from the official source and from the dev one. Only `api.list`
 * answers; the members that write the source list reject, so a registry that calls one fails.
 */
function fakeMarket(
  cell: { row: MarketplaceEntry },
  states: MarketplaceState[] = [],
): RegistryDeps['market'] {
  const unused = () => Promise.reject(new Error('the registry does not write the source list'));
  return {
    entry: (fqid) => {
      if (fqid === FQID) {
        return Promise.resolve({ market: OFFICIAL, row: cell.row });
      }
      if (fqid === LOCAL_FQID) {
        return Promise.resolve({ market: LOCAL, row: cell.row });
      }
      return Promise.resolve(null);
    },
    api: {
      list: () => Promise.resolve(states),
      // Seeding the indexes is the manager's call, never the registry's.
      ensure: () => Promise.resolve(),
      add: unused,
      remove: unused,
      setRef: unused,
      refresh: unused,
    },
  };
}

interface HarnessOpts {
  installed?: InstalledAddon[];
  files?: Record<string, string>;
  row?: MarketplaceEntry;
  /** What the sources' indexes last said, for the update comparison. */
  markets?: MarketplaceState[];
}

function harness(opts: HarnessOpts = {}) {
  const seed: Record<string, unknown> = {};
  if (opts.installed !== undefined) {
    seed[`${NS}:${KEY}`] = opts.installed;
  }
  const storage = createFakeHostStorage(seed);
  const http = createFakeHttp(opts.files ?? { [OFFICIAL_ENTRY_URL]: 'woc.log("hi")' });
  const fetcher = createFetcher({ request: http.request, cache: createFakeValues() });
  const onChanged = vi.fn();
  // A cell, so a suite can change the index between an install and the update after it.
  const cell = { row: opts.row ?? indexRow() };
  const registry = createRegistry({
    storage,
    market: fakeMarket(cell, opts.markets),
    fetcher,
    onChanged,
  });
  return { registry, storage, http, onChanged, cell };
}

// The corrupt-record cases report through the diagnostic channel by design.
let diag: CapturedDiag;

beforeEach(() => {
  diag = captureDiag();
});

afterEach(() => {
  diag.restore();
});

describe('reading the installed set', () => {
  it('reads an unwritten store as empty', async () => {
    await expect(harness().registry.list()).resolves.toEqual([]);
  });

  it('round-trips a valid record', async () => {
    await expect(harness({ installed: [addon()] }).registry.list()).resolves.toEqual([addon()]);
  });

  it('drops an unreadable record and keeps the rest', async () => {
    const good = addon({ fqid: 'official/keeper' });
    const { registry } = harness({ installed: [{ fqid: 'official/broken' } as never, good] });

    await expect(registry.list()).resolves.toEqual([good]);
    expect(diag.errors()).toHaveLength(1);
  });

  // The manager renders the manifest, so a half-valid row would render blanks.
  it('drops a record whose manifest no longer validates', async () => {
    const { registry } = harness({ installed: [addon({ manifest: { name: 'no id' } as never })] });

    await expect(registry.list()).resolves.toEqual([]);
  });

  it('reads a store holding something that is not a list as empty', async () => {
    const { registry } = harness({ installed: { notAnArray: true } as never });

    await expect(registry.list()).resolves.toEqual([]);
  });
});

describe('setting the enable state', () => {
  it('persists the flip and reports the change', async () => {
    const { registry, storage, onChanged } = harness({ installed: [addon({ enabled: true })] });

    await registry.setEnabled(FQID, false);

    expect(storage.cells.get(`${NS}:${KEY}`)).toEqual([addon({ enabled: false })]);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  // A no-op write still wakes every other tab through the value-change
  // listener, so the already-in-that-state case must not touch storage.
  it('writes nothing when the state already matches', async () => {
    const { registry, storage, onChanged } = harness({ installed: [addon({ enabled: true })] });
    const set = vi.spyOn(storage, 'set');

    await registry.setEnabled(FQID, true);

    expect(set).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('rejects an addon that is not installed', async () => {
    const { registry } = harness({ installed: [] });

    await expect(registry.setEnabled('official/ghost', true)).rejects.toThrow(NOT_INSTALLED);
  });

  it('leaves the other records untouched', async () => {
    const other = addon({ fqid: 'official/other', enabled: true });
    const { registry, storage } = harness({ installed: [addon({ enabled: true }), other] });

    await registry.setEnabled(FQID, false);

    expect(storage.cells.get(`${NS}:${KEY}`)).toEqual([addon({ enabled: false }), other]);
  });
});

describe('install', () => {
  it('persists the manifest and the fetched body', async () => {
    const { registry, storage, onChanged } = harness();

    await registry.install(FQID);

    expect(await registry.list()).toEqual([addon({ enabled: true })]);
    expect(storage.cells.get(`${NS}:${sourceKey(FQID)}`)).toBe('woc.log("hi")');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  // The supervisor starts it on the registry.changed this write emits.
  it('installs enabled, and announces the change that starts it', async () => {
    const { registry, onChanged } = harness();

    await registry.install(FQID);

    expect((await registry.list())[0]?.enabled).toBe(true);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  // A stale `path` would send the next update's fetch to a directory the addon has left.
  it('does not persist the index row path as part of the manifest', async () => {
    const { registry } = harness();

    await registry.install(FQID);

    expect((await registry.list())[0]?.manifest).not.toHaveProperty('path');
  });

  it('fetches from the marketplace path, not from the addon id', async () => {
    const { registry, http } = harness({ row: indexRow({ path: 'addons/nested/minimap' }) });
    http.put(`${RAW}/addons/nested/minimap/main.js`, 'ok');

    await registry.install(FQID);

    expect(http.calls).toContain(`${RAW}/addons/nested/minimap/main.js`);
  });

  it('refuses an fqid no marketplace offers', async () => {
    await expect(harness().registry.install('official/ghost')).rejects.toThrow(/not offered/);
  });

  it('refuses to install the same addon twice', async () => {
    const { registry } = harness({ installed: [addon()] });

    await expect(registry.install(FQID)).rejects.toThrow(/already installed/);
  });

  it('refuses a body that is empty', async () => {
    const { registry } = harness({ files: { [OFFICIAL_ENTRY_URL]: '   \n ' } });

    await expect(registry.install(FQID)).rejects.toThrow(/is empty/);
    expect(await registry.list()).toEqual([]);
  });

  it('reports the status when the source cannot be fetched', async () => {
    const { registry } = harness({ files: {} });

    await expect(registry.install(FQID)).rejects.toThrow(/HTTP 404/);
  });
});

describe('source', () => {
  it('answers from the cache without a request', async () => {
    const { registry, http } = harness();
    await registry.install(FQID);
    const afterInstall = http.calls.length;

    await expect(registry.source(FQID)).resolves.toBe('woc.log("hi")');
    expect(http.calls).toHaveLength(afterInstall);
  });

  it('rejects for an addon with no cached body', async () => {
    const { registry } = harness({ installed: [addon()] });

    await expect(registry.source(FQID)).rejects.toThrow(/no cached source/);
  });

  it('re-reads a dev-server addon rather than trusting the cache', async () => {
    const { registry, http } = harness({
      files: { [LOCAL_ENTRY_URL]: 'first' },
    });
    await registry.install(LOCAL_FQID);
    http.put(LOCAL_ENTRY_URL, 'second');

    await expect(registry.source(LOCAL_FQID)).resolves.toBe('second');
  });

  it('falls back to the cached body when the dev server is unreachable', async () => {
    const { registry, http } = harness({ files: { [LOCAL_ENTRY_URL]: 'first' } });
    await registry.install(LOCAL_FQID);
    http.remove(LOCAL_ENTRY_URL);

    await expect(registry.source(LOCAL_FQID)).resolves.toBe('first');
  });
});

describe('data files', () => {
  it('fetches every declared file at install and answers later reads from the cache', async () => {
    const { registry, storage, http } = harness({
      row: indexRow({ data: ['items.json', 'zones.json'] }),
      files: {
        [OFFICIAL_ENTRY_URL]: 'woc.log("hi")',
        [OFFICIAL_ITEMS_URL]: ITEMS,
        [OFFICIAL_ZONES_URL]: ZONES,
      },
    });

    await registry.install(FQID);
    const afterInstall = http.calls.length;

    expect(storage.cells.get(`${NS}:${dataKey(FQID)}`)).toEqual({
      'items.json': ITEMS,
      'zones.json': ZONES,
    });
    await expect(registry.data(FQID, 'items.json')).resolves.toBe(ITEMS);
    await expect(registry.data(FQID, 'zones.json')).resolves.toBe(ZONES);
    expect(http.calls).toHaveLength(afterInstall);
  });

  it('fails the install when a data file is not JSON, leaving nothing behind', async () => {
    const { registry, storage } = harness({
      row: indexRow({ data: ['items.json'] }),
      files: { [OFFICIAL_ENTRY_URL]: 'woc.log("hi")', [OFFICIAL_ITEMS_URL]: 'not json' },
    });

    await expect(registry.install(FQID)).rejects.toThrow(/is not JSON/);

    expect(await registry.list()).toEqual([]);
    expect(storage.cells.has(`${NS}:${sourceKey(FQID)}`)).toBe(false);
    expect(storage.cells.has(`${NS}:${dataKey(FQID)}`)).toBe(false);
  });

  it('fails the install when a data file is over the ceiling, with the byte count', async () => {
    const huge = `"${'x'.repeat(DATA_MAX_BYTES)}"`;
    const { registry } = harness({
      row: indexRow({ data: ['items.json'] }),
      files: { [OFFICIAL_ENTRY_URL]: 'woc.log("hi")', [OFFICIAL_ITEMS_URL]: huge },
    });

    await expect(registry.install(FQID)).rejects.toThrow(String(huge.length));
  });

  // A data file has the same conditional-request problem as the body.
  it('drops the record and forgets every file on uninstall, so a reinstall re-reads', async () => {
    const { registry, storage, http } = harness({
      row: indexRow({ data: ['items.json'] }),
      files: { [OFFICIAL_ENTRY_URL]: 'woc.log("hi")', [OFFICIAL_ITEMS_URL]: ITEMS },
    });
    await registry.install(FQID);

    await registry.uninstall(FQID);
    expect(storage.cells.has(`${NS}:${dataKey(FQID)}`)).toBe(false);

    http.put(OFFICIAL_ITEMS_URL, '{"sword":"Renamed"}');
    await registry.install(FQID);

    await expect(registry.data(FQID, 'items.json')).resolves.toBe('{"sword":"Renamed"}');
  });

  // Pins the empty branch of writeAddonData.
  it('deletes the record when an update removes the last data file', async () => {
    const { registry, storage, cell } = harness({
      row: indexRow({ data: ['items.json'] }),
      files: { [OFFICIAL_ENTRY_URL]: 'woc.log("hi")', [OFFICIAL_ITEMS_URL]: ITEMS },
    });
    await registry.install(FQID);
    expect(storage.cells.has(`${NS}:${dataKey(FQID)}`)).toBe(true);

    cell.row = indexRow({ version: '2.0.0' });
    await registry.update(FQID);

    expect(storage.cells.has(`${NS}:${dataKey(FQID)}`)).toBe(false);
  });

  // The message points the player at an update rather than at their addon.
  it('rejects by name for an addon whose files were never fetched', async () => {
    const { registry } = harness({ installed: [addon()] });

    await expect(registry.data(FQID, 'items.json')).rejects.toThrow(/update it/);
  });

  it('re-reads a dev-server data file on every call', async () => {
    const { registry, http } = harness({
      row: indexRow({ data: ['items.json'] }),
      files: { [LOCAL_ENTRY_URL]: 'first', [LOCAL_ITEMS_URL]: ITEMS },
    });
    await registry.install(LOCAL_FQID);
    http.put(LOCAL_ITEMS_URL, ZONES);

    await expect(registry.data(LOCAL_FQID, 'items.json')).resolves.toBe(ZONES);
  });

  it('falls back to the cached copy when the dev server is unreachable', async () => {
    const { registry, http } = harness({
      row: indexRow({ data: ['items.json'] }),
      files: { [LOCAL_ENTRY_URL]: 'first', [LOCAL_ITEMS_URL]: ITEMS },
    });
    await registry.install(LOCAL_FQID);
    http.remove(LOCAL_ITEMS_URL);

    await expect(registry.data(LOCAL_FQID, 'items.json')).resolves.toBe(ITEMS);
  });
});

describe('update', () => {
  it('replaces the manifest and the body', async () => {
    const { registry, storage, http } = harness({
      installed: [addon({ manifest: { ...MANIFEST, version: '1.2.0' } })],
      files: { [OFFICIAL_ENTRY_URL]: 'woc.log("v2")' },
      row: indexRow({ version: '2.0.0' }),
    });

    await registry.update(FQID);

    expect((await registry.list())[0]?.manifest.version).toBe('2.0.0');
    expect(storage.cells.get(`${NS}:${sourceKey(FQID)}`)).toBe('woc.log("v2")');
    expect(http.calls).toContain(OFFICIAL_ENTRY_URL);
  });

  it('keeps the enable flag and the pin', async () => {
    const { registry } = harness({
      installed: [addon({ enabled: false, pin: '1.2.0' })],
      row: indexRow({ version: '2.0.0' }),
    });

    await registry.update(FQID);

    const [row] = await registry.list();
    expect(row?.enabled).toBe(false);
    expect(row?.pin).toBe('1.2.0');
    expect(row?.manifest.version).toBe('2.0.0');
  });

  it('rejects an addon that is not installed', async () => {
    await expect(harness().registry.update(FQID)).rejects.toThrow(NOT_INSTALLED);
  });
});

describe('uninstall', () => {
  it('drops the record and the cached body', async () => {
    const { registry, storage, onChanged } = harness();
    await registry.install(FQID);
    onChanged.mockClear();

    await registry.uninstall(FQID);

    expect(await registry.list()).toEqual([]);
    expect(storage.cells.has(`${NS}:${sourceKey(FQID)}`)).toBe(false);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('leaves the addon own storage namespaces alone', async () => {
    const { registry, storage } = harness();
    await registry.install(FQID);
    await storage.set(`addon:${FQID}`, 'note', 'kept');
    await storage.set(`config:${FQID}`, 'values', { a: 1 });

    await registry.uninstall(FQID);

    expect(storage.cells.get(`addon:${FQID}:note`)).toBe('kept');
    expect(storage.cells.get(`config:${FQID}:values`)).toEqual({ a: 1 });
  });

  // Without this, a reinstall issues a conditional request, gets a 304, and is
  // served the body from before the uninstall.
  it('forgets the cached etag so a reinstall fetches the current body', async () => {
    const { registry, http } = harness();
    await registry.install(FQID);
    await registry.uninstall(FQID);
    http.put(OFFICIAL_ENTRY_URL, 'woc.log("changed")');

    await registry.install(FQID);

    await expect(registry.source(FQID)).resolves.toBe('woc.log("changed")');
  });

  it('rejects an addon that is not installed', async () => {
    await expect(harness().registry.uninstall(FQID)).rejects.toThrow(NOT_INSTALLED);
  });
});

describe('pinning an addon to a version', () => {
  it('records the pin and leaves everything else alone', async () => {
    const { registry, storage } = harness({ installed: [addon()] });

    await registry.setPin(FQID, '1.2.0');

    const [row] = storage.cells.get(`${NS}:${KEY}`) as InstalledAddon[];
    expect(row?.pin).toBe('1.2.0');
    expect(row?.enabled).toBe(true);
    expect(row?.manifest.version).toBe('1.2.0');
  });

  it('releases the addon back to tracking its marketplace', async () => {
    const { registry } = harness({ installed: [addon({ pin: '1.2.0' })] });

    await registry.setPin(FQID, null);

    expect((await registry.list())[0]?.pin).toBeNull();
  });

  // A marketplace serves one version per ref, so there is no older body to fetch.
  it('fetches nothing', async () => {
    const { registry, http } = harness({ installed: [addon()] });

    await registry.setPin(FQID, '1.2.0');

    expect(http.calls).toEqual([]);
  });

  it('rejects a version that is not semver', async () => {
    const { registry } = harness({ installed: [addon()] });

    await expect(registry.setPin(FQID, 'latest')).rejects.toThrow(/must be semver/);
    expect((await registry.list())[0]?.pin).toBeNull();
  });

  it('rejects an addon that is not installed', async () => {
    await expect(harness().registry.setPin(FQID, '1.2.0')).rejects.toThrow(NOT_INSTALLED);
  });

  // A no-op write still wakes every other tab through the value-change listener.
  it('does not write when the pin is already what was asked for', async () => {
    const { registry, onChanged } = harness({ installed: [addon({ pin: '1.2.0' })] });

    await registry.setPin(FQID, '1.2.0');

    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('updates', () => {
  it('reports an addon its marketplace has moved ahead of', async () => {
    const { registry } = harness({
      installed: [addon()],
      markets: [marketState(OFFICIAL, [indexRow({ version: '1.3.0' })], { builtin: true })],
    });

    await expect(registry.updates()).resolves.toEqual([
      {
        fqid: FQID,
        name: 'Better Minimap',
        marketplace: 'official',
        installed: '1.2.0',
        available: '1.3.0',
        pin: null,
      },
    ]);
  });

  // Otherwise opening the manager would cost a request per source.
  it('fetches nothing', async () => {
    const { registry, http } = harness({
      installed: [addon()],
      markets: [marketState(OFFICIAL, [indexRow({ version: '1.3.0' })])],
    });

    await registry.updates();

    expect(http.calls).toEqual([]);
  });

  it('reports nothing when no index has been read', async () => {
    const { registry } = harness({ installed: [addon()] });

    await expect(registry.updates()).resolves.toEqual([]);
  });
});

describe('the storage location', () => {
  // Changing the key silently empties every player's registry.
  it('reads and writes the loader namespace', async () => {
    const { registry, storage } = harness({ installed: [addon()] });

    await registry.setEnabled(FQID, false);

    expect(storage.touched).toEqual([
      [NS, KEY],
      [NS, KEY],
    ]);
  });

  // Keeps the list small enough to rewrite on every toggle.
  it('caches each body under its own key', async () => {
    const { registry, storage } = harness();

    await registry.install(FQID);

    expect(storage.cells.has(`${NS}:${sourceKey(FQID)}`)).toBe(true);
    expect(JSON.stringify(storage.cells.get(`${NS}:${KEY}`))).not.toContain('woc.log');
  });
});
