// The source list, and fetching each source's index.
//
// The two properties worth the most here are ordering and what cannot be
// removed. The official source is merged in from the loader build on every read,
// so it is present with nothing persisted and cannot be edited or dropped. The
// local dev source sits behind a switch and is never persisted at all.

import { describe, expect, it } from 'vitest';
import { DEV_KEY } from '../loader/src/host/dev-settings.ts';
import { createFetcher } from '../loader/src/host/fetcher.ts';
import { MARKET_NS, MARKETS_KEY } from '../loader/src/host/market-list.ts';
import { createMarketService } from '../loader/src/host/marketplace.ts';
import {
  indexUrl,
  LOCAL,
  LOCAL_ID,
  OFFICIAL,
  OFFICIAL_ID,
} from '../loader/src/shared/marketplace.ts';
import type { HostEvent, MarketplaceEntry } from '../loader/src/shared/protocol.ts';
import { createFakeHostStorage } from './fakes/host-storage.ts';
import { createFakeHttp, createFakeValues } from './fakes/http.ts';

const OFFICIAL_INDEX = indexUrl(OFFICIAL);
const LOCAL_INDEX = indexUrl(LOCAL);
const THIRD_PARTY = 'https://raw.githubusercontent.com/someone/their-addons/HEAD/marketplace.json';

function entry(overrides: Partial<MarketplaceEntry> = {}): MarketplaceEntry {
  return {
    id: 'dps-meter',
    name: 'DPS Meter',
    version: '1.2.0',
    apiVersion: 1,
    author: 'MarshalX',
    description: 'Rolling damage per second.',
    entry: 'main.js',
    path: 'addons/dps-meter',
    ...overrides,
  };
}

function indexBody(addons: MarketplaceEntry[] = [entry()], name = 'Official Marketplace'): string {
  return JSON.stringify({ schema: 1, name, generated: '2026-07-29T00:00:00Z', addons });
}

interface Options {
  files?: Record<string, string>;
  stored?: unknown;
  dev?: { enabled?: boolean; hotReload?: boolean };
}

function open(options: Options = {}) {
  const seed: Record<string, unknown> = {};
  if (options.stored !== undefined) {
    seed[`${MARKET_NS}:${MARKETS_KEY}`] = options.stored;
  }
  if (options.dev !== undefined) {
    seed[`${MARKET_NS}:${DEV_KEY}`] = options.dev;
  }
  const storage = createFakeHostStorage(seed);
  const http = createFakeHttp(options.files ?? { [OFFICIAL_INDEX]: indexBody() });
  const fetcher = createFetcher({ request: http.request, cache: createFakeValues() });
  const events: HostEvent[] = [];
  const market = createMarketService({
    storage,
    fetcher,
    emit: (event) => events.push(event),
    now: () => 1_700_000_000_000,
  });
  return { market, storage, http, events };
}

describe('the source list', () => {
  it('has the official source with nothing persisted', async () => {
    const { market } = open();

    const list = await market.api.list();

    expect(list.map((state) => state.ref.id)).toEqual([OFFICIAL_ID]);
    expect(list[0]?.builtin).toBe(true);
  });

  // fetchedAt null is a different state from an index that was read and found
  // empty, and the manager renders them differently.
  it('reports an unfetched source as unfetched rather than as empty', async () => {
    const { market } = open();

    expect((await market.api.list())[0]).toMatchObject({
      fetchedAt: null,
      addons: [],
      error: null,
    });
  });

  it('puts the official source first, ahead of anything added', async () => {
    const { market } = open({ stored: [{ owner: 'someone', repo: 'their-addons', ref: 'HEAD' }] });

    expect((await market.api.list()).map((state) => state.ref.id)).toEqual([
      OFFICIAL_ID,
      'gh:someone/their-addons',
    ]);
  });

  it('drops a persisted record that no longer validates', async () => {
    const { market } = open({ stored: [{ owner: 'a b', repo: 'r', ref: 'HEAD' }, 'nonsense'] });

    expect((await market.api.list()).map((state) => state.ref.id)).toEqual([OFFICIAL_ID]);
  });

  it('reads a store holding something that is not a list as empty', async () => {
    const { market } = open({ stored: { notAnArray: true } });

    expect(await market.api.list()).toHaveLength(1);
  });
});

describe('adding a source', () => {
  it('persists only the three fields the user chose', async () => {
    const { market, storage } = open({ files: { [THIRD_PARTY]: indexBody([], 'Theirs') } });

    await market.api.add('https://github.com/someone/their-addons');

    expect(storage.cells.get(`${MARKET_NS}:${MARKETS_KEY}`)).toEqual([
      { owner: 'someone', repo: 'their-addons', ref: 'HEAD' },
    ]);
  });

  it('loads its index straight away', async () => {
    const { market } = open({ files: { [THIRD_PARTY]: indexBody([entry({ id: 'theirs' })]) } });

    await market.api.add('someone/their-addons');

    const added = (await market.api.list()).find(
      (state) => state.ref.id === 'gh:someone/their-addons',
    );
    expect(added?.addons.map((row) => row.id)).toEqual(['theirs']);
  });

  it('refuses a URL that is not a GitHub repository', async () => {
    await expect(open().market.api.add('https://evil.example/x/y')).rejects.toThrow(
      /must be GitHub repositories/,
    );
  });

  it('refuses one that is already in the list', async () => {
    const { market } = open({ stored: [{ owner: 'someone', repo: 'their-addons', ref: 'HEAD' }] });

    await expect(market.api.add('someone/their-addons')).rejects.toThrow(/already in the list/);
  });
});

// The rule lives in the host, not the UI, so hiding the control is presentation
// and this is what makes a hand-crafted call from the runtime fail too.
describe('removing a source', () => {
  it.each([OFFICIAL_ID, LOCAL_ID])('refuses to remove %s', async (id) => {
    await expect(open().market.api.remove(id)).rejects.toThrow(/ships with the loader/);
  });

  it('removes a user-added one and forgets its index', async () => {
    const { market, storage } = open({
      stored: [{ owner: 'someone', repo: 'their-addons', ref: 'HEAD' }],
      files: { [OFFICIAL_INDEX]: indexBody(), [THIRD_PARTY]: indexBody() },
    });
    await market.api.refresh();

    await market.api.remove('gh:someone/their-addons');

    expect(storage.cells.get(`${MARKET_NS}:${MARKETS_KEY}`)).toEqual([]);
    expect((await market.api.list()).map((state) => state.ref.id)).toEqual([OFFICIAL_ID]);
  });

  it('rejects one that is not in the list', async () => {
    await expect(open().market.api.remove('gh:nobody/nothing')).rejects.toThrow(
      /no such marketplace/,
    );
  });
});

describe('refreshing an index', () => {
  it('parses it and reports the addons', async () => {
    const { market } = open();

    await market.api.refresh(OFFICIAL_ID);

    const [state] = await market.api.list();
    expect(state?.addons.map((row) => row.id)).toEqual(['dps-meter']);
    expect(state?.fetchedAt).toBe(1_700_000_000_000);
    expect(state?.error).toBeNull();
  });

  it('announces progress and then the change', async () => {
    const { market, events } = open();

    await market.api.refresh(OFFICIAL_ID);

    expect(events).toEqual([
      { k: 'market.progress', id: OFFICIAL_ID, state: 'fetching' },
      { k: 'market.progress', id: OFFICIAL_ID, state: 'ok' },
      { k: 'market.changed', id: OFFICIAL_ID },
    ]);
  });

  // The repository is private while it is being built, so this is the state the
  // official source is actually in and the manager has to render it.
  it('records an HTTP failure as that source own error', async () => {
    const { market } = open({ files: {} });

    await market.api.refresh(OFFICIAL_ID);

    expect((await market.api.list())[0]?.error).toContain('HTTP 404');
  });

  it('records a malformed index without discarding what it already had', async () => {
    const { market, http } = open();
    await market.api.refresh(OFFICIAL_ID);

    http.put(OFFICIAL_INDEX, JSON.stringify({ schema: 9 }));
    await market.api.refresh(OFFICIAL_ID);

    const [state] = await market.api.list();
    expect(state?.error).toContain('the index is not valid');
    expect(state?.addons.map((row) => row.id)).toEqual(['dps-meter']);
  });

  it('clears a previous error once a refresh succeeds', async () => {
    const { market, http } = open({ files: {} });
    await market.api.refresh(OFFICIAL_ID);

    http.put(OFFICIAL_INDEX, indexBody());
    await market.api.refresh(OFFICIAL_ID);

    expect((await market.api.list())[0]?.error).toBeNull();
  });

  it('refreshes every source when given no id', async () => {
    const { market, http } = open({
      stored: [{ owner: 'someone', repo: 'their-addons', ref: 'HEAD' }],
      files: { [OFFICIAL_INDEX]: indexBody(), [THIRD_PARTY]: indexBody() },
    });

    await market.api.refresh();

    expect(http.calls).toContain(OFFICIAL_INDEX);
    expect(http.calls).toContain(THIRD_PARTY);
  });

  it('rejects an id that is not in the list', async () => {
    await expect(open().market.api.refresh('gh:nobody/nothing')).rejects.toThrow(
      /no such marketplace/,
    );
  });
});

describe('dev mode', () => {
  it('is off until it is turned on', async () => {
    const { market } = await open();

    await expect(market.dev.state()).resolves.toMatchObject({ enabled: false, hotReload: false });
  });

  it('adds the local source to the list, second, when on', async () => {
    const { market } = open({
      dev: { enabled: true },
      files: { [OFFICIAL_INDEX]: indexBody(), [LOCAL_INDEX]: indexBody([], 'Local dev server') },
      stored: [{ owner: 'someone', repo: 'their-addons', ref: 'HEAD' }],
    });

    expect((await market.api.list()).map((state) => state.ref.id)).toEqual([
      OFFICIAL_ID,
      LOCAL_ID,
      'gh:someone/their-addons',
    ]);
  });

  // Persisting it would create a second copy that turning dev mode off could not
  // take away.
  it('never writes the local source to the persisted list', async () => {
    const { market, storage } = open({
      files: { [LOCAL_INDEX]: indexBody([entry({ id: 'dev-harness' })], 'Local') },
    });

    await market.dev.setEnabled(true);

    expect(storage.cells.get(`${MARKET_NS}:${MARKETS_KEY}`)).toBeUndefined();
  });

  // So the pane has rows to show rather than an empty list the player has to
  // refresh by hand.
  it('loads the local index as soon as it is enabled', async () => {
    const { market } = open({
      files: { [LOCAL_INDEX]: indexBody([entry({ id: 'dev-harness' })], 'Local') },
    });

    await market.dev.setEnabled(true);

    const local = (await market.api.list()).find((state) => state.ref.id === LOCAL_ID);
    expect(local?.addons.map((row) => row.id)).toEqual(['dev-harness']);
  });

  it('takes the source and its index away when it is turned off', async () => {
    const { market } = open({
      dev: { enabled: true },
      files: { [OFFICIAL_INDEX]: indexBody(), [LOCAL_INDEX]: indexBody([], 'Local') },
    });
    await market.api.refresh(LOCAL_ID);

    await market.dev.setEnabled(false);

    expect((await market.api.list()).map((state) => state.ref.id)).not.toContain(LOCAL_ID);
  });

  it('persists both switches', async () => {
    const { market, storage } = open();

    await market.dev.setHotReload(true);

    expect(storage.cells.get(`${MARKET_NS}:${DEV_KEY}`)).toEqual({
      enabled: false,
      hotReload: true,
    });
  });

  // A dev server that is not running is the ordinary state, and the pane shows
  // that reading rather than only the last action's failure.
  it('carries the local source fetch error into the dev reading', async () => {
    const { market } = open({ dev: { enabled: true }, files: { [OFFICIAL_INDEX]: indexBody() } });

    await market.api.refresh(LOCAL_ID);

    await expect(market.dev.state()).resolves.toMatchObject({
      error: expect.stringContaining('404'),
    });
  });

  it('reads a corrupt dev setting as off rather than as on', async () => {
    const { market } = open({ dev: { enabled: 'yes' as unknown as boolean } });

    await expect(market.dev.state()).resolves.toMatchObject({ enabled: false });
  });
});

describe('finding one addon', () => {
  it('answers the marketplace and the index row', async () => {
    const { market } = open();

    const found = await market.entry('official/dps-meter');

    expect(found?.market.id).toBe(OFFICIAL_ID);
    expect(found?.row.path).toBe('addons/dps-meter');
  });

  // So installing works straight after adding a source, without the caller
  // having to know that a refresh has to come first.
  it('loads the index on demand when it has never been read', async () => {
    const { market, http } = open();

    await market.entry('official/dps-meter');

    expect(http.calls).toEqual([OFFICIAL_INDEX]);
  });

  it('does not re-fetch an index it already has', async () => {
    const { market, http } = open();
    await market.api.refresh(OFFICIAL_ID);

    await market.entry('official/dps-meter');

    expect(http.calls).toHaveLength(1);
  });

  it.each([
    ['an addon the source does not offer', 'official/nothing'],
    ['a source that is not in the list', 'gh:nobody/nothing/addon'],
    ['a malformed fqid', 'nosep'],
  ])('answers null for %s', async (_case, fqid) => {
    await expect(open().market.entry(fqid)).resolves.toBeNull();
  });
});
