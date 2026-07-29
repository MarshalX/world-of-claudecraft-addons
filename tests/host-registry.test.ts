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
import { createFetcher } from '../loader/src/host/fetcher.ts';
import type { MarketService } from '../loader/src/host/marketplace.ts';
import { createRegistry, sourceKey } from '../loader/src/host/registry.ts';
import { LOCAL, OFFICIAL } from '../loader/src/shared/marketplace.ts';
import type { InstalledAddon, MarketplaceEntry } from '../loader/src/shared/protocol.ts';
import { type CapturedDiag, captureDiag } from './fakes/diag.ts';
import { createFakeHostStorage } from './fakes/host-storage.ts';
import { createFakeHttp, createFakeValues } from './fakes/http.ts';

const NS = 'loader';
const KEY = 'installed';
const FQID = 'official/minimap';
const LOCAL_FQID = 'local/minimap';
const NOT_INSTALLED = /not installed/;

const RAW = 'https://raw.githubusercontent.com/MarshalX/world-of-claudecraft-addons/HEAD';
const OFFICIAL_ENTRY_URL = `${RAW}/addons/minimap/main.js`;
const LOCAL_ENTRY_URL = 'http://localhost:5180/addons/minimap/main.js';

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

/** A market that offers `minimap` from the official source and from the dev one. */
function fakeMarket(row: MarketplaceEntry = indexRow()): Pick<MarketService, 'entry'> {
  return {
    entry: (fqid) => {
      if (fqid === FQID) {
        return Promise.resolve({ market: OFFICIAL, row });
      }
      if (fqid === LOCAL_FQID) {
        return Promise.resolve({ market: LOCAL, row });
      }
      return Promise.resolve(null);
    },
  };
}

interface HarnessOpts {
  installed?: InstalledAddon[];
  files?: Record<string, string>;
  row?: MarketplaceEntry;
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
  const registry = createRegistry({
    storage,
    market: fakeMarket(opts.row),
    fetcher,
    onChanged,
  });
  return { registry, storage, http, onChanged };
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

    expect(await registry.list()).toEqual([addon({ enabled: false })]);
    expect(storage.cells.get(`${NS}:${sourceKey(FQID)}`)).toBe('woc.log("hi")');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  // Installing must not turn the addon on. Evaluating third-party code is the
  // player's decision and it is a separate one from acquiring it.
  it('installs disabled', async () => {
    const { registry } = harness();

    await registry.install(FQID);

    expect((await registry.list())[0]?.enabled).toBe(false);
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
