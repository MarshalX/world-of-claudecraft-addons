// Which items the deployed game ships a painted icon FILE for, and what the art
// was filed under.
//
// Read from the served `/ui/items/mapping.json`, so a blank slot means "no file" rather than
// "the loader built the wrong id". The game's art-pending ledger can refill whenever content
// lands ahead of its art, so `has()` has a real false to answer.
//
// A generated Heroic weapon variant ships NO file and reuses its base weapon's painting, as
// the game does. `fileIdFor` mirrors that: the variant id is a pure `heroic_${baseId}` prefix
// (the game's `heroicVariantId`), and the base is checked against the manifest like any other
// id. `heroic_mark` is not a variant; it ships its own file and never reaches the fallback.
//
// Curated entries carry the ART SOURCE name, not the item's, and nothing keeps the two in
// step. It is served labelled as such and never generated into the published types.
//
// The read is SYNCHRONOUS, as in `skill-art.ts`: fetched in the background on first use and
// optimistic until it lands. One manifest, so a whole bag grid costs one request.

/** What the manifest is known to contain, or that it could not be read. */
interface ItemManifest {
  ids: ReadonlySet<string>;
  /** Curated entries only. A generated batch ships a file and carries no name. */
  names: ReadonlyMap<string, string>;
}

type KnownArt = ItemManifest | 'unreadable';

interface ItemArt {
  /** Read the manifest. Never rejects: an unreadable manifest is a permanent "unknown". */
  preload: () => Promise<void>;
  /**
   * The manifest id whose FILE serves this item: its own id, a Heroic variant's base, or null
   * once read and neither is listed. Answers the id itself until the manifest is read.
   */
  fileIdFor: (itemId: string) => string | null;
  /**
   * The name the item's ART was filed under, or null (no file, a generated batch, or not read
   * yet). Resolved through `fileIdFor`, so a Heroic variant answers its base's name.
   */
  artName: (itemId: string) => string | null;
}

interface ItemArtDeps {
  fetchJson: (url: string) => Promise<unknown>;
}

/** The served square, which is what says a payload is this manifest and not another. */
const ICON_SIZE = 128;

const MANIFEST_URL = '/ui/items/mapping.json';

/**
 * What a generated Heroic copy's id is its base's id plus: a pure prefix per the game's
 * `heroicVariantId`.
 */
const HEROIC_PREFIX = 'heroic_';

/** The ids a `generatedBatches` array names. Batches carry ids and no names. */
function readBatches(batches: readonly unknown[], ids: Set<string>): void {
  for (const batch of batches) {
    const listed = (batch as { itemIds?: unknown } | null)?.itemIds;
    if (Array.isArray(listed)) {
      for (const id of listed as readonly unknown[]) {
        if (typeof id === 'string' && id.length > 0) {
          ids.add(id);
        }
      }
    }
  }
}

/** The ids and names an `entries` array carries. An entry with no name still has a file. */
function readEntries(
  entries: readonly unknown[],
  ids: Set<string>,
  names: Map<string, string>,
): void {
  for (const entry of entries) {
    const record = entry as { itemId?: unknown; name?: unknown } | null;
    if (typeof record?.itemId === 'string' && record.itemId.length > 0) {
      ids.add(record.itemId);
      if (typeof record.name === 'string' && record.name.length > 0) {
        names.set(record.itemId, record.name);
      }
    }
  }
}

/**
 * The manifest's two lists, or null for a payload that is not one. `iconSize` is the shape
 * check, standing in for the skill manifests' `class`. Lenient per entry, strict on shape.
 */
function manifestFrom(payload: unknown): ItemManifest | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const record = payload as { iconSize?: unknown; entries?: unknown; generatedBatches?: unknown };
  if (record.iconSize !== ICON_SIZE) {
    return null;
  }
  const ids = new Set<string>();
  const names = new Map<string, string>();
  if (Array.isArray(record.entries)) {
    readEntries(record.entries as readonly unknown[], ids, names);
  }
  if (Array.isArray(record.generatedBatches)) {
    readBatches(record.generatedBatches as readonly unknown[], ids);
  }
  if (ids.size === 0) {
    return null;
  }
  return { ids, names };
}

/**
 * The listed id whose file serves this item, once the manifest is known. The base arm is tried
 * only when the item's OWN id is absent.
 */
function listedFor(known: ItemManifest, itemId: string): string | null {
  if (known.ids.has(itemId)) {
    return itemId;
  }
  if (!itemId.startsWith(HEROIC_PREFIX)) {
    return null;
  }
  const base = itemId.slice(HEROIC_PREFIX.length);
  if (!known.ids.has(base)) {
    return null;
  }
  return base;
}

/** The one read and what it holds: caching, and at most one request in flight. */
function manifestReader(deps: ItemArtDeps): {
  ensure: () => Promise<void>;
  manifest: () => ItemManifest | null;
} {
  /** Undefined until the one read has finished, either way. */
  const state: { known: KnownArt | undefined; reading: Promise<void> | undefined } = {
    known: undefined,
    reading: undefined,
  };

  const read = async (): Promise<void> => {
    try {
      state.known = manifestFrom(await deps.fetchJson(MANIFEST_URL)) ?? 'unreadable';
    } catch {
      // No manifest leaves every item optimistic. Recorded so it is not retried per cell.
      state.known = 'unreadable';
    }
  };

  const ensure = (): Promise<void> => {
    if (state.known !== undefined) {
      return Promise.resolve();
    }
    const running =
      state.reading ??
      read().finally(() => {
        state.reading = undefined;
      });
    state.reading = running;
    return running;
  };

  return {
    ensure,

    /** The manifest if it has been read and could be, and null in both other cases. */
    manifest: () => {
      if (state.known === undefined) {
        // Start the read and answer "not known" for this call; later cells are exact.
        ensure().catch(() => undefined);
        return null;
      }
      if (state.known === 'unreadable') {
        return null;
      }
      return state.known;
    },
  };
}

function createItemArt(deps: ItemArtDeps): ItemArt {
  const { ensure, manifest } = manifestReader(deps);

  return {
    preload: ensure,

    fileIdFor: (itemId) => {
      const known = manifest();
      if (known === null) {
        return itemId;
      }
      return listedFor(known, itemId);
    },

    artName: (itemId) => {
      const known = manifest();
      if (known === null) {
        return null;
      }
      const listed = listedFor(known, itemId);
      if (listed === null) {
        return null;
      }
      return known.names.get(listed) ?? null;
    },
  };
}

export type { ItemArt, ItemArtDeps };
export { createItemArt, MANIFEST_URL, manifestFrom };
