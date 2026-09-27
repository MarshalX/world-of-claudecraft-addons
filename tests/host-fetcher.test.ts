// The conditional GET and its ETag cache. Hot reload and index refresh both act on `changed`.

import { describe, expect, it } from 'vitest';
import { CACHE_PREFIX, createFetcher } from '../loader/src/host/fetcher.ts';
import { createFakeHttp, createFakeValues } from './fakes/http.ts';

const URL_A = 'https://raw.githubusercontent.com/o/r/HEAD/marketplace.json';
const URL_B = 'http://localhost:5180/addons/dev-harness/main.js';

function harness(files: Record<string, string> = {}) {
  const http = createFakeHttp(files);
  const cache = createFakeValues();
  return { http, cache, fetcher: createFetcher({ request: http.request, cache }) };
}

describe('the first request', () => {
  it('is unconditional and reports the body as changed', async () => {
    const { fetcher } = harness({ [URL_A]: 'first' });

    await expect(fetcher.get(URL_A)).resolves.toEqual({ body: 'first', changed: true });
  });

  it('caches the body against its etag', async () => {
    const { fetcher, cache } = harness({ [URL_A]: 'first' });

    await fetcher.get(URL_A);

    expect(cache.values.has(`${CACHE_PREFIX}${URL_A}`)).toBe(true);
  });
});

describe('a repeat request', () => {
  it('sends If-None-Match and answers from the cache on a 304', async () => {
    const { fetcher, http } = harness({ [URL_A]: 'first' });
    await fetcher.get(URL_A);

    const second = await fetcher.get(URL_A);

    expect(second).toEqual({ body: 'first', changed: false });
    expect(http.notModified()).toBe(1);
  });

  it('reports a body that moved as changed', async () => {
    const { fetcher, http } = harness({ [URL_A]: 'first' });
    await fetcher.get(URL_A);
    http.put(URL_A, 'second');

    await expect(fetcher.get(URL_A)).resolves.toEqual({ body: 'second', changed: true });
  });

  // An edit then a revert moves the running addon twice, so both are reported.
  it('measures change against what was last read, not against the original', async () => {
    const { fetcher, http } = harness({ [URL_B]: 'v1' });
    await fetcher.get(URL_B);
    http.put(URL_B, 'v2');
    await expect(fetcher.get(URL_B)).resolves.toMatchObject({ changed: true });

    http.put(URL_B, 'v1');

    await expect(fetcher.get(URL_B)).resolves.toEqual({ body: 'v1', changed: true });
  });

  it('stays unchanged across repeated polls of a file nobody touched', async () => {
    const { fetcher } = harness({ [URL_B]: 'v1' });
    await fetcher.get(URL_B);

    await expect(fetcher.get(URL_B)).resolves.toMatchObject({ changed: false });
    await expect(fetcher.get(URL_B)).resolves.toMatchObject({ changed: false });
  });

  it('tracks each URL separately', async () => {
    const { fetcher, http } = harness({ [URL_A]: 'index', [URL_B]: 'source' });
    await fetcher.get(URL_A);
    await fetcher.get(URL_B);
    http.put(URL_B, 'edited');

    await expect(fetcher.get(URL_A)).resolves.toMatchObject({ changed: false });
    await expect(fetcher.get(URL_B)).resolves.toMatchObject({ changed: true });
  });
});

describe('forget', () => {
  it('makes the next request unconditional again', async () => {
    const { fetcher, http } = harness({ [URL_A]: 'first' });
    await fetcher.get(URL_A);

    await fetcher.forget(URL_A);
    await fetcher.get(URL_A);

    expect(http.notModified()).toBe(0);
  });
});

describe('failures', () => {
  // A raw 404 means a private or renamed repository, so the status is kept verbatim.
  it('rejects with the status and the URL', async () => {
    const { fetcher } = harness({});

    await expect(fetcher.get(URL_A)).rejects.toThrow(`HTTP 404 from ${URL_A}`);
  });

  it('lets a transport failure through', async () => {
    const fetcher = createFetcher({
      request: () => Promise.reject(new Error('no grant')),
      cache: createFakeValues(),
    });

    await expect(fetcher.get(URL_A)).rejects.toThrow('no grant');
  });

  it('does not cache a failed response', async () => {
    const { fetcher, cache, http } = harness({});
    await expect(fetcher.get(URL_A)).rejects.toThrow();

    http.put(URL_A, 'now there');

    await expect(fetcher.get(URL_A)).resolves.toEqual({ body: 'now there', changed: true });
    expect(cache.values.size).toBe(1);
  });
});

describe('getJson', () => {
  it('parses the body and carries the changed flag', async () => {
    const { fetcher } = harness({ [URL_A]: '{"schema":1}' });

    await expect(fetcher.getJson(URL_A)).resolves.toEqual({ value: { schema: 1 }, changed: true });
  });

  it('names the URL when the body is not JSON', async () => {
    const { fetcher } = harness({ [URL_A]: '<!doctype html>' });

    await expect(fetcher.getJson(URL_A)).rejects.toThrow(`${URL_A} did not return JSON`);
  });
});

// With no validator, over-reporting costs a reload; under-reporting pins a stale body forever.
describe('a server that issues no etag', () => {
  it('reports every response as changed', async () => {
    const fetcher = createFetcher({
      request: () => Promise.resolve({ status: 200, text: 'same', headers: {} }),
      cache: createFakeValues(),
    });

    await expect(fetcher.get(URL_A)).resolves.toMatchObject({ changed: true });
    await expect(fetcher.get(URL_A)).resolves.toMatchObject({ changed: true });
  });

  it('drops a cached etag when the server stops issuing them', async () => {
    // Annotated rather than inferred: from the initializer alone the type is the
    // literal `true`, and the second branch reads as unreachable.
    const server: { issuesEtags: boolean } = { issuesEtags: true };
    const etagHeaders = (): Record<string, string> => {
      if (server.issuesEtags) {
        return { etag: '"v1"' };
      }
      return {};
    };
    const cache = createFakeValues();
    const fetcher = createFetcher({
      request: () =>
        Promise.resolve({
          status: 200,
          text: 'body',
          headers: etagHeaders(),
        }),
      cache,
    });

    await fetcher.get(URL_A);
    expect(cache.values.size).toBe(1);

    server.issuesEtags = false;
    await fetcher.get(URL_A);

    expect(cache.values.size).toBe(0);
  });
});
