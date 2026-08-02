// The registry: the installed set, the enable flag, and the cached entry source.
//
// The persisted blob is untrusted input: it lives in GM storage, which the
// player can edit and which an older loader may have written differently.
//
// The fetch half is tested through the real fetcher over a fake transport rather
// than by stubbing the fetcher out. What install and update are FOR is putting a
// body in the cache that a later enable can read without a network, and a stub
// would let a version that never wrote it pass.

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
 * A market that offers `minimap` from the official source and from the dev one.
 *
 * `api.list` is the reading update rows are compared against, so it is the one
 * MarketApi member with a real answer. The three that write the source list
 * reject: the registry has no business calling them, and a rejection says so
 * where a no-op would let a version that did call one pass.
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
      // The registry reads the indexes as they are; seeding them is the
      // manager's call, ahead of the read that reaches here.
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
  // A cell rather than a captured value, so a suite can move what the index
  // offers between an install and the update that follows it. That is the only
  // way to drive the case where a new version DROPS a data file.
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

  // One bad record must not hide every good one, and the loss has to be
  // reported rather than swallowed.
  it('drops an unreadable record and keeps the rest', async () => {
    const good = addon({ fqid: 'official/keeper' });
    const { registry } = harness({ installed: [{ fqid: 'official/broken' } as never, good] });

    await expect(registry.list()).resolves.toEqual([good]);
    expect(diag.errors()).toHaveLength(1);
  });

  // A manifest that no longer parses is as unreadable as a missing one: the
  // manager renders the manifest, so a half-valid row would render blanks.
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

  // Silently doing nothing would leave the manager showing a toggle that never
  // takes, with no way to tell that from a slow write.
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

  // Enabled, so the supervisor starts it on the registry.changed this write
  // emits. Installing used to leave the addon off, which was right when install
  // fetched only the manifest and enable went and got the code. The body is
  // cached at install now, so nothing was left to defer and the player was made
  // to press a second control to get what they had already confirmed.
  it('installs enabled, and announces the change that starts it', async () => {
    const { registry, onChanged } = harness();

    await registry.install(FQID);

    expect((await registry.list())[0]?.enabled).toBe(true);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  // `path` belongs to the index row, not to a manifest. A stale copy of it would
  // send the next update's fetch to a directory the addon has moved out of.
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

  // A record with no body would show as installed and fail on every enable, and
  // the failure would name the loader rather than the empty file.
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

  // The dev source is the deliberate exception: reopening the game has to pick
  // up whatever is on disk now, which is the entire point of pointing the loader
  // at a dev server.
  it('re-reads a dev-server addon rather than trusting the cache', async () => {
    const { registry, http } = harness({
      files: { [LOCAL_ENTRY_URL]: 'first' },
    });
    await registry.install(LOCAL_FQID);
    http.put(LOCAL_ENTRY_URL, 'second');

    await expect(registry.source(LOCAL_FQID)).resolves.toBe('second');
  });

  // A dev server that is not running must leave the last body it served working.
  // Failing here would disable an addon because a terminal was closed.
  it('falls back to the cached body when the dev server is unreachable', async () => {
    const { registry, http } = harness({ files: { [LOCAL_ENTRY_URL]: 'first' } });
    await registry.install(LOCAL_FQID);
    http.remove(LOCAL_ENTRY_URL);

    await expect(registry.source(LOCAL_FQID)).resolves.toBe('first');
  });
});

describe('data files', () => {
  // The whole point of fetching at install: enabling an addon, and every later
  // read, must not be a network call.
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

  // An addon that starts and then cannot read its own table is worse than one
  // that never installed, because nothing says why.
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

  // The record has to go with the addon, and so does every file's cache entry:
  // a data file has exactly the same conditional-request problem the body does.
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

  // The regression the empty branch of writeAddonData exists for: without it,
  // woc.data would keep answering from a version nobody is running.
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

  // An addon installed before the field existed has no record at all. The
  // message has to send the player at the update rather than at their addon.
  it('rejects by name for an addon whose files were never fetched', async () => {
    const { registry } = harness({ installed: [addon()] });

    await expect(registry.data(FQID, 'items.json')).rejects.toThrow(/update it/);
  });

  // The same deliberate exception the body gets: a table an author just
  // regenerated has to be what the next load reads.
  it('re-reads a dev-server data file on every call', async () => {
    const { registry, http } = harness({
      row: indexRow({ data: ['items.json'] }),
      files: { [LOCAL_ENTRY_URL]: 'first', [LOCAL_ITEMS_URL]: ITEMS },
    });
    await registry.install(LOCAL_FQID);
    http.put(LOCAL_ITEMS_URL, ZONES);

    await expect(registry.data(LOCAL_FQID, 'items.json')).resolves.toBe(ZONES);
  });

  // A dev server that is not running must leave the last copy working, rather
  // than breaking an addon because a terminal was closed.
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

  // Only what the marketplace owns is replaced. Updating an addon must not turn
  // one the player disabled back on.
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

  // Reinstalling to fix something is the common case, and it must not silently
  // cost the player their settings and window positions.
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

  // A marketplace serves one version per ref, so a pin cannot mean "install
  // that instead": there is no older body to go back to.
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

  // The badge must never be the thing that decides to go to the network, or
  // opening the manager would cost a request per source before it could draw.
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
  // Pinned because the key is what an existing install is found under: changing
  // it silently empties every player's registry.
  it('reads and writes the loader namespace', async () => {
    const { registry, storage } = harness({ installed: [addon()] });

    await registry.setEnabled(FQID, false);

    expect(storage.touched).toEqual([
      [NS, KEY],
      [NS, KEY],
    ]);
  });

  // The body is kept off the installed list so the list stays small enough to
  // read and rewrite on every toggle.
  it('caches each body under its own key', async () => {
    const { registry, storage } = harness();

    await registry.install(FQID);

    expect(storage.cells.has(`${NS}:${sourceKey(FQID)}`)).toBe(true);
    expect(JSON.stringify(storage.cells.get(`${NS}:${KEY}`))).not.toContain('woc.log');
  });
});
