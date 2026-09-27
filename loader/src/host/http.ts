// The manager's cross-origin request API, as a promise. Both spellings of the global, both
// response conventions and a missing grant are all resolved here, so callers see one shape.

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

/** Parse the CRLF-joined header blob, lower-casing names since servers send `ETag` or `etag`. */
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
 * The callback-style GM request, as a promise. Every HTTP status resolves, 304 and 404
 * included; only a transport failure rejects.
 */
function createRequester(send: RawRequest): Requester {
  return (req) =>
    new Promise<HttpResponse>((resolve, reject) => {
      send(detailsFor(req, resolve, reject));
    });
}

/**
 * The stand-in for a manager that granted no request API. Rejects rather than throwing, so it
 * costs marketplaces only: installed addons still run from cached source.
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

/** The request surface for whatever the manager actually granted. */
function resolveRequester(send: RawRequest | undefined): Requester {
  if (send === undefined) {
    return createMissingRequester();
  }
  return createRequester(send);
}

export type { GmRequestDetails, GmResponse, HttpRequest, HttpResponse, RawRequest, Requester };
export { createMissingRequester, createRequester, parseHeaders, resolveRequester };
