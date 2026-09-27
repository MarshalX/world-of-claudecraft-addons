// Conditional GET over the userscript manager's cross-origin request API.
//
// Every response is cached with its ETag, so an unchanged refresh costs a bodiless 304, which
// is what makes dev-server polling affordable. The cache writes through the GM adapter and not
// host/storage.ts, because that store publishes every write across the bridge and a poll would
// flood the runtime with events about nothing.

import type { GmAdapter } from './gm.ts';

/** GM value prefix. Distinct from the `ns:key` namespaces host/storage.ts owns. */
const CACHE_PREFIX = 'http:';
const DEFAULT_TIMEOUT_MS = 15_000;

const NOT_MODIFIED = 304;
const OK_MIN = 200;
const OK_MAX = 299;

interface CacheEntry {
  etag: string;
  body: string;
}

interface FetchOutcome {
  /** The body, from the response or from the cache on a 304. */
  body: string;
  /** False when the server confirmed the cached copy is still current. */
  changed: boolean;
}

type CacheStore = Pick<GmAdapter, 'getValue' | 'setValue' | 'deleteValue'>;

interface FetcherDeps {
  request: GmAdapter['request'];
  cache: CacheStore;
  timeoutMs?: number;
}

interface Fetcher {
  /** Conditional GET. Rejects on a transport failure or a non-2xx, non-304 status. */
  get: (url: string) => Promise<FetchOutcome>;
  /** As `get`, with the body parsed. A body that is not JSON rejects. */
  getJson: (url: string) => Promise<{ value: unknown; changed: boolean }>;
  /** Drop one cached entry, so the next `get` is unconditional. */
  forget: (url: string) => Promise<void>;
}

function cacheKey(url: string): string {
  return `${CACHE_PREFIX}${url}`;
}

/**
 * One header, by name. A function because noPropertyAccessFromIndexSignature forbids
 * `headers.etag` and Biome's useLiteralKeys rewrites `headers['etag']` back to it.
 */
function header(headers: Record<string, string>, name: string): string | undefined {
  return headers[name];
}

/** A stored entry, or null when there is none or it no longer has the right shape. */
function readEntry(raw: unknown): CacheEntry | null {
  if (raw === null || typeof raw !== 'object') {
    return null;
  }
  const { etag, body } = raw as Partial<CacheEntry>;
  if (typeof etag !== 'string' || typeof body !== 'string') {
    return null;
  }
  return { etag, body };
}

/**
 * A failed response, carrying its status. The contents fallback branches on it: it runs on a
 * 404 and must NOT run on a 403, the rate limit, which it would only deepen.
 */
class HttpError extends Error {
  readonly status: number;

  constructor(url: string, status: number) {
    super(`HTTP ${status} from ${url}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** Whether a rejection is a response with this status, rather than a transport failure. */
function isHttpStatus(err: unknown, status: number): boolean {
  return err instanceof HttpError && err.status === status;
}

/** What a 2xx response established, gathered so it is one argument. */
interface FreshStore {
  cache: CacheStore;
  url: string;
  /** What was cached before this response, or null on a first read. */
  entry: CacheEntry | null;
  body: string;
  etag: string | undefined;
}

/** The conditional header, when there is a cached validator to send. */
function conditionalHeaders(entry: CacheEntry | null): Record<string, string> {
  if (entry === null) {
    return {};
  }
  return { 'If-None-Match': entry.etag };
}

/**
 * Record what a 2xx response established, and say whether it moved. A server with no ETag is
 * always reported changed: a redundant reload is cheaper than an addon pinned to a stale body.
 */
async function storeFresh(store: FreshStore): Promise<FetchOutcome> {
  const { cache, url, entry, body, etag } = store;
  if (etag !== undefined && etag.length > 0) {
    await cache.setValue(cacheKey(url), { etag, body } satisfies CacheEntry);
  } else if (entry !== null) {
    // The server stopped issuing ETags; the old one would validate against nothing.
    await cache.deleteValue(cacheKey(url));
  }
  return { body, changed: entry === null || entry.body !== body };
}

function createFetcher(deps: FetcherDeps): Fetcher {
  const { request, cache } = deps;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const get = async (url: string): Promise<FetchOutcome> => {
    const entry = readEntry(await cache.getValue<unknown>(cacheKey(url), null));
    const res = await request({
      url,
      method: 'GET',
      headers: conditionalHeaders(entry),
      timeoutMs,
    });

    if (res.status === NOT_MODIFIED) {
      if (entry === null) {
        // Reachable only if the entry was dropped between the read and the response.
        throw new Error(`${url} answered 304 with nothing cached to answer from`);
      }
      return { body: entry.body, changed: false };
    }
    if (res.status < OK_MIN || res.status > OK_MAX) {
      throw new HttpError(url, res.status);
    }
    return await storeFresh({
      cache,
      url,
      entry,
      body: res.text,
      etag: header(res.headers, 'etag'),
    });
  };

  return {
    get,

    getJson: async (url) => {
      const outcome = await get(url);
      try {
        return { value: JSON.parse(outcome.body), changed: outcome.changed };
      } catch (err) {
        throw new Error(`${url} did not return JSON: ${String(err)}`, { cause: err });
      }
    },

    forget: async (url) => {
      await cache.deleteValue(cacheKey(url));
    },
  };
}

export type { CacheStore, Fetcher, FetcherDeps, FetchOutcome };
export { CACHE_PREFIX, createFetcher, HttpError, isHttpStatus };
