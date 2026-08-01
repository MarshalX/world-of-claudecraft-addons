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
    id: 'combat-meter',
    name: 'Combat Meter',
    version: '1.2.0',
    apiVersion: 1,
    author: 'MarshalX',
    description: 'Rolling damage per second.',
    entry: 'main.js',
    path: 'addons/combat-meter',
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

describe('pinning a source to a tag', () => {
  const stored = [{ owner: 'someone', repo: 'their-addons', ref: 'HEAD' }];
  const tagged = 'https://raw.githubusercontent.com/someone/their-addons/v2.0.0/marketplace.json';

  it('rewrites the persisted ref and re-reads from it', async () => {
    const { market, storage, http } = open({
      stored,
      files: { [THIRD_PARTY]: indexBody(), [tagged]: indexBody([entry({ id: 'theirs' })]) },
    });
    await market.api.refresh();

    await market.api.setRef('gh:someone/their-addons', 'v2.0.0');

    expect(storage.cells.get(`${MARKET_NS}:${MARKETS_KEY}`)).toEqual([
      { owner: 'someone', repo: 'their-addons', ref: 'v2.0.0' },
    ]);
    expect(http.calls).toContain(tagged);
  });

  // The id is derived from owner and repo, so everything installed from this
  // source keeps its fqid and therefore its settings, keybinds, and data.
  it('leaves the id alone, so nothing installed from it loses its storage', async () => {
    const { market } = open({ stored, files: { [tagged]: indexBody() } });

    await market.api.setRef('gh:someone/their-addons', 'v2.0.0');

    expect((await market.api.list()).map((state) => state.ref.id)).toEqual([
      OFFICIAL_ID,
      'gh:someone/their-addons',
    ]);
  });

  // Otherwise a failed read of the new tag would leave the old tag's addons on
  // screen under the new tag's name.
  it('drops the rows the old ref published, even if the new one cannot be read', async () => {
    const { market } = open({ stored, files: { [THIRD_PARTY]: indexBody() } });
    await market.api.refresh();

    await market.api.setRef('gh:someone/their-addons', 'v2.0.0');

    const state = (await market.api.list()).find((row) => row.ref.id === 'gh:someone/their-addons');
    expect(state?.addons).toEqual([]);
    expect(state?.error).toContain('HTTP 404');
  });

  it.each([OFFICIAL_ID, LOCAL_ID])('refuses to repoint %s', async (id) => {
    await expect(open().market.api.setRef(id, 'v2.0.0')).rejects.toThrow(/ships with the loader/);
  });

  it('rejects a ref that is not a valid branch, tag, or commit', async () => {
    const { market } = open({ stored });

    await expect(market.api.setRef('gh:someone/their-addons', 'a ref')).rejects.toThrow(
      /invalid branch, tag, or commit/,
    );
  });

  it('rejects a source that is not in the list', async () => {
    await expect(open().market.api.setRef('gh:nobody/nothing', 'v1')).rejects.toThrow(
      /no such marketplace/,
    );
  });
});

describe('a repository with no marketplace.json', () => {
  const stored = [{ owner: 'someone', repo: 'their-addons', ref: 'HEAD' }];
  const contents = 'https://api.github.com/repos/someone/their-addons/contents/addons?ref=HEAD';
  const manifestFile =
    'https://raw.githubusercontent.com/someone/their-addons/HEAD/addons/theirs/addon.json';

  function theirManifest(): string {
    return JSON.stringify({
      id: 'theirs',
      name: 'Theirs',
      version: '1.0.0',
      apiVersion: 1,
      author: 'someone',
      description: 'An addon.',
      entry: 'main.js',
    });
  }

  it('falls back to enumerating it, and says the reading is degraded', async () => {
    const { market } = open({
      stored,
      files: {
        [contents]: JSON.stringify([{ name: 'theirs', type: 'dir' }]),
        [manifestFile]: theirManifest(),
      },
    });

    await market.api.refresh('gh:someone/their-addons');

    const state = (await market.api.list()).find((row) => row.ref.id === 'gh:someone/their-addons');
    expect(state?.addons.map((row) => row.id)).toEqual(['theirs']);
    expect(state?.degraded).toBe(true);
    expect(state?.error).toBeNull();
  });

  it('reports a source read from a real index as not degraded', async () => {
    const { market } = open();

    await market.api.refresh(OFFICIAL_ID);

    expect((await market.api.list())[0]?.degraded).toBe(false);
  });

  // A repository that answers 404 for its listing too is one the loader cannot
  // see at all, so the message is about the index the player was looking for
  // rather than about an endpoint they never asked for.
  it('reports the index failure, not the contents API, for a repository it cannot see', async () => {
    const { market } = open({ files: {} });

    await market.api.refresh(OFFICIAL_ID);

    expect((await market.api.list())[0]?.error).toContain('marketplace.json');
  });

  // Answering a rate limit by issuing one request per addon would spend what is
  // left of the hour finding out there is none.
  it('does not enumerate when the index failed for any reason but a 404', async () => {
    const { market, http } = open({ stored, files: { [THIRD_PARTY]: '{ not json' } });

    await market.api.refresh('gh:someone/their-addons');

    expect(http.calls).not.toContain(contents);
  });

  // An index that is present but invalid is not a fallback case: the source did
  // publish one, and what it published is the thing to report.
  it('does not enumerate a source whose index is present and malformed', async () => {
    const { market, http } = open({
      stored,
      files: { [THIRD_PARTY]: JSON.stringify({ schema: 9 }) },
    });

    await market.api.refresh('gh:someone/their-addons');

    expect(http.calls).not.toContain(contents);
  });
});

describe('refreshing an index', () => {
  it('parses it and reports the addons', async () => {
    const { market } = open();

    await market.api.refresh(OFFICIAL_ID);

    const [state] = await market.api.list();
    expect(state?.addons.map((row) => row.id)).toEqual(['combat-meter']);
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
    expect(state?.addons.map((row) => row.id)).toEqual(['combat-meter']);
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

// The index cache is per session, and before `ensure` nothing ever seeded it: on
// a fresh install and again after every page reload, Browse drew "no marketplace
// has been read yet" until the player found Refresh, and the update check
// compared installed addons against no rows and reported nothing to update.
describe('seeding the indexes', () => {
  it('reads a source that has not been read this session', async () => {
    const { market, http } = open();

    await market.api.ensure();

    expect(http.calls).toEqual([OFFICIAL_INDEX]);
    expect((await market.api.list())[0]?.addons.map((row) => row.id)).toEqual(['combat-meter']);
  });

  it('reads every source in the list, not only the official one', async () => {
    const { market, http } = open({
      stored: [{ owner: 'someone', repo: 'their-addons', ref: 'HEAD' }],
      files: { [OFFICIAL_INDEX]: indexBody(), [THIRD_PARTY]: indexBody() },
    });

    await market.api.ensure();

    expect(http.calls).toEqual([OFFICIAL_INDEX, THIRD_PARTY]);
  });

  it('reads a source once a session however often it is called', async () => {
    const { market, http } = open();

    await market.api.ensure();
    await market.api.ensure();
    await market.api.ensure();

    expect(http.calls).toEqual([OFFICIAL_INDEX]);
  });

  // Every open of the manager calls this, so retrying a source that is simply
  // unreachable would put a doomed request in front of each of them.
  // A count rather than a list, since a missing index legitimately costs two
  // requests: the contents-API fallback is what the second one is.
  it('does not retry a source whose read failed', async () => {
    const { market, http } = open({ files: {} });
    await market.api.ensure();
    const spent = http.calls.length;

    await market.api.ensure();

    expect(http.calls).toHaveLength(spent);
    expect((await market.api.list())[0]?.error).toContain('HTTP 404');
  });

  it('leaves Refresh able to retry a source it gave up on', async () => {
    const { market, http } = open({ files: {} });
    await market.api.ensure();

    http.put(OFFICIAL_INDEX, indexBody());
    await market.api.refresh(OFFICIAL_ID);

    expect((await market.api.list())[0]?.error).toBeNull();
  });

  // Two calls landing together must not have the second answer before the read
  // the first started: the manager lists straight afterwards, and a caller that
  // returned early would list an index that has not arrived.
  it('joins a read already running rather than returning ahead of it', async () => {
    const { market, http } = open();

    await Promise.all([market.api.ensure(), market.api.ensure()]);

    expect(http.calls).toEqual([OFFICIAL_INDEX]);
    expect((await market.api.list())[0]?.fetchedAt).not.toBeNull();
  });

  it('reads a re-added source again, since removing it forgot what it held', async () => {
    const { market, http } = open({ files: { [THIRD_PARTY]: indexBody([], 'Theirs') } });
    await market.api.add('https://github.com/someone/their-addons');
    await market.api.remove('gh:someone/their-addons');

    await market.api.add('https://github.com/someone/their-addons');
    await market.api.ensure();

    expect(http.calls.filter((url) => url === THIRD_PARTY)).toHaveLength(2);
  });

  it('does not fetch for a source Refresh already read', async () => {
    const { market, http } = open();
    await market.api.refresh(OFFICIAL_ID);

    await market.api.ensure();

    expect(http.calls).toEqual([OFFICIAL_INDEX]);
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

    const found = await market.entry('official/combat-meter');

    expect(found?.market.id).toBe(OFFICIAL_ID);
    expect(found?.row.path).toBe('addons/combat-meter');
  });

  // So installing works straight after adding a source, without the caller
  // having to know that a refresh has to come first.
  it('loads the index on demand when it has never been read', async () => {
    const { market, http } = open();

    await market.entry('official/combat-meter');

    expect(http.calls).toEqual([OFFICIAL_INDEX]);
  });

  it('does not re-fetch an index it already has', async () => {
    const { market, http } = open();
    await market.api.refresh(OFFICIAL_ID);

    await market.entry('official/combat-meter');

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
