// The manager's cross-origin request API, as a promise.
//
// Its own module rather than a corner of gm.ts, because it is the only part of
// the GM surface that is not a value store: everything else there is about
// reading and watching keys, and this is the loader's one way out of the
// sandbox. It is bounded by the userscript's @connect list, and
// shared/marketplace.ts is what keeps a marketplace URL from naming another
// host.
//
// The callers of this take the shape it exposes, not the manager's: both
// spellings of the global, both response conventions, and either arm's absence
// are decided here so nothing downstream has to.

/** One `name: value` line of the raw responseHeaders blob. */
const HEADER_LINE_RE = /^([^:]+):\s*(.*)$/;
const HEADER_SEPARATOR_RE = /\r?\n/;

interface HttpRequest {
  url: string;
  /** GET only: the loader never writes to a marketplace. */
  method?: 'GET' | undefined;
  headers?: Record<string, string> | undefined;
  timeoutMs?: number | undefined;
}

interface HttpResponse {
  status: number;
  text: string;
  /** Lower-cased names, so `etag` is one lookup rather than two guesses. */
  headers: Record<string, string>;
}

/** The manager's response object, reduced to what this reads. */
interface GmResponse {
  status: number;
  responseText?: string | undefined;
  /** One CRLF-joined `name: value` blob, not a map. */
  responseHeaders?: string | undefined;
}

interface GmRequestDetails {
  method: string;
  url: string;
  headers: Record<string, string>;
  timeout?: number;
  onload: (res: GmResponse) => void;
  onerror: () => void;
  ontimeout: () => void;
  onabort: () => void;
}

type RawRequest = (details: GmRequestDetails) => unknown;

type Requester = (req: HttpRequest) => Promise<HttpResponse>;

/**
 * Header names, lower-cased.
 *
 * The managers hand back one CRLF-joined string rather than a map, and the
 * casing is whatever the server sent, so `ETag` and `etag` both arrive and a
 * case-sensitive lookup finds one of them at random.
 */
function parseHeaders(raw: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of (raw ?? '').split(HEADER_SEPARATOR_RE)) {
    const match = HEADER_LINE_RE.exec(line.trim());
    if (match) {
      headers[(match[1] as string).toLowerCase()] = (match[2] as string).trim();
    }
  }
  return headers;
}

function toResponse(res: GmResponse): HttpResponse {
  return {
    status: res.status,
    text: res.responseText ?? '',
    headers: parseHeaders(res.responseHeaders),
  };
}

/** The details object one request becomes, with its four outcomes wired up. */
function detailsFor(
  req: HttpRequest,
  resolve: (res: HttpResponse) => void,
  reject: (err: Error) => void,
): GmRequestDetails {
  const details: GmRequestDetails = {
    method: req.method ?? 'GET',
    url: req.url,
    headers: req.headers ?? {},
    onload: (res) => {
      resolve(toResponse(res));
    },
    onerror: () => {
      reject(new Error(`could not reach ${req.url}`));
    },
    ontimeout: () => {
      reject(new Error(`timed out reaching ${req.url}`));
    },
    onabort: () => {
      reject(new Error(`the request to ${req.url} was aborted`));
    },
  };
  if (req.timeoutMs !== undefined) {
    details.timeout = req.timeoutMs;
  }
  return details;
}

/**
 * The callback-style GM request, as a promise.
 *
 * Every HTTP status resolves, including 304 and 404: the caller decides what a
 * status means, and a conditional request whose whole purpose is to return 304
 * must not arrive as a rejection. Only a transport failure rejects.
 */
function createRequester(send: RawRequest): Requester {
  return (req) =>
    new Promise<HttpResponse>((resolve, reject) => {
      send(detailsFor(req, resolve, reject));
    });
}

/**
 * The stand-in for a manager that granted no request API.
 *
 * Rejects rather than throwing, so a missing grant reaches the caller's catch
 * and costs marketplaces rather than the loader: the manager and every
 * already-installed addon work from cached source without it.
 */
function createMissingRequester(): Requester {
  return () =>
    Promise.reject(
      new Error(
        'the userscript manager grants neither GM.xmlHttpRequest nor GM_xmlhttpRequest, ' +
          'so marketplaces cannot be fetched',
      ),
    );
}

/**
 * The request surface for whatever the manager actually granted.
 *
 * The decision lives here rather than at the call site so the absent case is
 * handled once, next to the message it produces.
 */
function resolveRequester(send: RawRequest | undefined): Requester {
  if (send === undefined) {
    return createMissingRequester();
  }
  return createRequester(send);
}

export type { GmRequestDetails, GmResponse, HttpRequest, HttpResponse, RawRequest, Requester };
export { createMissingRequester, createRequester, parseHeaders, resolveRequester };
