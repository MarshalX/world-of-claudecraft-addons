// A stand-in for the userscript manager's cross-origin request API.
//
// It answers conditional requests FOR REAL: every body gets an etag derived from
// its own text, an If-None-Match that matches gets a 304 with no body, and
// editing a body changes the etag. Stubbing that away would leave every test
// about the ETag cache asserting against a fixture rather than against the
// mechanism, and the mechanism is the thing hot reload rests on.

import type { HttpRequest, HttpResponse } from '../../loader/src/host/gm.ts';

interface FakeHttp {
  request: (req: HttpRequest) => Promise<HttpResponse>;
  /** Replace one body, which changes its etag. */
  put: (url: string, body: string) => void;
  /** Remove one, so it answers 404. */
  remove: (url: string) => void;
  /** Every URL requested, in order, including the ones answered 304. */
  readonly calls: readonly string[];
  /** How many of those were answered 304. */
  notModified: () => number;
}

/**
 * Stable and cheap: a different body has to produce a different tag, no more.
 *
 * The body itself, encoded, rather than a digest. A hash would be shorter and
 * would introduce the one failure mode this fake must not have: a collision that
 * makes two different bodies look unchanged, which is exactly the bug the ETag
 * suites exist to catch.
 */
function etagOf(body: string): string {
  return `"${encodeURIComponent(body)}"`;
}

const OK = 200;
const NOT_MODIFIED = 304;
const NOT_FOUND = 404;

/**
 * @param files url to body. A url that is absent answers 404 rather than
 * throwing, because that is what a private or renamed repository does and it is
 * the case the loader has to render rather than crash on.
 */
function createFakeHttp(files: Record<string, string> = {}): FakeHttp {
  const bodies = new Map(Object.entries(files));
  const calls: string[] = [];
  let cached = 0;

  return {
    calls,
    notModified: () => cached,

    put: (url, body) => {
      bodies.set(url, body);
    },

    remove: (url) => {
      bodies.delete(url);
    },

    request: (req) => {
      calls.push(req.url);
      const body = bodies.get(req.url);
      if (body === undefined) {
        return Promise.resolve({ status: NOT_FOUND, text: '', headers: {} });
      }
      const etag = etagOf(body);
      if (req.headers?.['If-None-Match'] === etag) {
        cached += 1;
        return Promise.resolve({ status: NOT_MODIFIED, text: '', headers: { etag } });
      }
      return Promise.resolve({ status: OK, text: body, headers: { etag } });
    },
  };
}

/** The GM value store the fetcher caches into, as three plain functions. */
function createFakeValues() {
  const values = new Map<string, unknown>();
  return {
    values,
    getValue: <T>(key: string, fallback: T): Promise<T> =>
      Promise.resolve((values.get(key) ?? fallback) as T),
    setValue: (key: string, value: unknown): Promise<void> => {
      values.set(key, value);
      return Promise.resolve();
    },
    deleteValue: (key: string): Promise<void> => {
      values.delete(key);
      return Promise.resolve();
    },
  };
}

export type { FakeHttp };
export { createFakeHttp, createFakeValues, etagOf };
