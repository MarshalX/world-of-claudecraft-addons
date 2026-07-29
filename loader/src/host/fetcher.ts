// GM_xmlhttpRequest wrapper with an ETag cache.
//
// The @connect allowlist bounds this to raw.githubusercontent.com,
// api.github.com, and localhost.

export function createFetcher(): never {
  throw new Error('not implemented: ETag-cached fetcher');
}
