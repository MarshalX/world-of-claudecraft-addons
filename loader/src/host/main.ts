// Userscript sandbox entry: owns GM storage, marketplace fetching, and the
// registry. Never touches the page's JS heap.

export function bootHost(): void {
  throw new Error('not implemented: host bootstrap');
}
