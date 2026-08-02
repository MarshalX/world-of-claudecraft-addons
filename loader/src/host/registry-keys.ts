// Where the loader's own records live inside GM storage.
//
// Its own module because two writers now share the namespace: registry.ts owns
// the installed list and the entry body, addon-data.ts owns the sibling data
// files, and having either import the namespace from the other would make the
// two a cycle. The storage layout is one subject in any case.
//
// These strings ARE the boundary, the way shared/storage-keys.ts is for the
// addon-facing namespaces. They cannot change without stranding what is already
// on disk.

/** The loader's own namespace, alongside the per-addon `addon:<fqid>` ones. */
const REGISTRY_NS = 'loader';

/** The installed set, as one record. */
const INSTALLED_KEY = 'installed';

/** One addon's cached entry body. Kept off the installed list, which stays small. */
function sourceKey(fqid: string): string {
  return `source:${fqid}`;
}

/**
 * One addon's cached data files, as declared path to raw text.
 *
 * ONE key rather than one per file, so uninstalling drops them all without
 * enumerating a manifest that may since have changed: a file dropped from `data`
 * between an install and an update would otherwise leave a key nothing owns.
 */
function dataKey(fqid: string): string {
  return `data:${fqid}`;
}

export { dataKey, INSTALLED_KEY, REGISTRY_NS, sourceKey };
