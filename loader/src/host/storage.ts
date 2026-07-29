// Namespaced GM value store, keyed `addon:<fqid>:<key>`.
//
// GM values live in the extension's storage area, so addon data is not reachable
// from the page's localStorage.

export function createGmStore(): never {
  throw new Error('not implemented: GM value store');
}
