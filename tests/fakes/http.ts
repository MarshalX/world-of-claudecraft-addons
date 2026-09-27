// A stand-in for the userscript manager's cross-origin request API. It answers conditional
// requests for real (etag from the body, 304 on a match), since the ETag cache is under test.

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

/** The encoded body itself, never a hash: a collision would make two bodies look unchanged. */
function etagOf(body: string): string {
  return `"${encodeURIComponent(body)}"`;
}

const OK = 200;
const NOT_MODIFIED = 304;
const NOT_FOUND = 404;

/** @param files url to body. An absent url answers 404, as a private or renamed repository does. */
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
