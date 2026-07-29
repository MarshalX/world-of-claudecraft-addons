// Conditional GET over the userscript manager's cross-origin request API.
//
// The @connect allowlist bounds this to raw.githubusercontent.com,
// api.github.com, and localhost, and shared/marketplace.ts is what keeps a
// marketplace URL from naming anything else.
//
// Every response is cached with its ETag, so a refresh that finds nothing new
// costs a 304 with no body. That is the common case for a marketplace index,
// and it is also what makes dev-server polling cheap enough to run on a timer:
// `changed` on the outcome is the whole answer to "should this addon reload".
//
// The cache goes through the GM adapter rather than through host/storage.ts on
// purpose. That store publishes every write as a storage.changed event across
// the bridge, and a poll that wrote an ETag entry twice a second would flood the
// runtime with events about nothing.

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
  /**
   * False when the server confirmed the cached copy is still current.
   *
   * This is what the dev watcher polls on, and what lets an index refresh skip
   * re-parsing and re-publishing an index that did not move.
   */
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
 * One header, by name.
 *
 * A computed read rather than `headers.etag`, because
 * noPropertyAccessFromIndexSignature forbids dotting into a string map and the
 * lint rule that would rewrite it back reads the two as interchangeable. The
 * same idiom is `fieldValue` in runtime/net/frames.ts.
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
 * A failed response, carrying its status.
 *
 * The status is the diagnosis often enough to be worth carrying verbatim: 404 on
 * a raw.githubusercontent.com URL is a private or renamed repository, and 403 is
 * the unauthenticated rate limit. It is a field rather than only a substring of
 * the message because one caller branches on it: a marketplace with no
 * marketplace.json falls back to enumerating the repository, and it must do that
 * for a missing file and NOT for a rate limit, which would spend the rest of the
 * hour's quota discovering it is out of quota.
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
 * Record what a 2xx response established, and say whether it moved.
 *
 * A server with no ETag leaves no way to tell a re-fetch from a change, so it is
 * reported as changed. Over-reporting costs a redundant reload; the other
 * direction would silently pin an addon to a stale body.
 */
async function storeFresh(store: FreshStore): Promise<FetchOutcome> {
  const { cache, url, entry, body, etag } = store;
  if (etag !== undefined && etag.length > 0) {
    await cache.setValue(cacheKey(url), { etag, body } satisfies CacheEntry);
  } else if (entry !== null) {
    // The server stopped issuing ETags for this URL. Keeping the old one would
    // make the next request conditional against a validator nothing will match.
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
        // Only reachable if the entry was dropped between the read and the
        // response, since the conditional header is what invites a 304 at all.
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
