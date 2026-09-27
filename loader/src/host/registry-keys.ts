// Where the loader's own records live inside GM storage. These strings cannot change without
// stranding what is already on disk.

/** The loader's own namespace, alongside the per-addon `addon:<fqid>` ones. */
const REGISTRY_NS = 'loader';

/** The installed set, as one record. */
const INSTALLED_KEY = 'installed';

/** One addon's cached entry body. Kept off the installed list, which stays small. */
function sourceKey(fqid: string): string {
  return `source:${fqid}`;
}

/**
 * One addon's cached data files, declared path to raw text. ONE key, so uninstalling drops
 * them all without trusting a manifest whose `data` list may have changed since.
 */
function dataKey(fqid: string): string {
  return `data:${fqid}`;
}

export { dataKey, INSTALLED_KEY, REGISTRY_NS, sourceKey };
