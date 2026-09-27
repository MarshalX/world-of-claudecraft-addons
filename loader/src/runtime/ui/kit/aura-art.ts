// Which auras the deployed game ships a painted icon FILE for.
//
// Read from the served `/ui/auras/mapping.json`.
//
// An entry resolves two ways, which is why this module answers a URL. `assets[]` names a
// file under `/ui/auras`; `externalAssets[]` carries a finished `runtimeUrl` into another
// art family (`/ui/delve-affixes/`, `/ui/fiesta/powerups/`), so composing a path would miss.
//
// NOT OPTIMISTIC, unlike `skill-art.ts` and `item-art.ts`. This family is small and covers
// only auras the ability art does not (the game's `auraImageUrl` falls back to ability art),
// so most ids handed here are legitimately absent and guessing would 404 per row. `preload`
// is there for a caller that wants the first row exact.

/** What the manifest is known to contain, or that it could not be read. */
type KnownArt = ReadonlyMap<string, string> | 'unreadable';

interface AuraArt {
  /** Read the manifest. Never rejects: an unreadable manifest is a permanent "unknown". */
  preload: () => Promise<void>;
  /** The URL of this aura's painted art, or null. Null until the manifest has been read. */
  urlFor: (auraId: string) => string | null;
}

interface AuraArtDeps {
  fetchJson: (url: string) => Promise<unknown>;
}

const MANIFEST_URL = '/ui/auras/mapping.json';
const AURA_DIR = '/ui/auras';

/**
 * A manifest string that could name a file under this directory, or null. Encoded, as in
 * `icons.ts`, so a value carrying a slash cannot point elsewhere on the origin.
 */
function fileSegment(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  return encodeURIComponent(value);
}

/**
 * An `externalAssets` URL, accepted only as a same-origin absolute path. `//host/x` and
 * `https://host/x` leave the origin, and a relative path resolves against the current page.
 */
function externalUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return null;
  }
  return value;
}

/**
 * A manifest field read as a list, empty for anything that is not one (`externalAssets` may be
 * absent).
 */
function listOf(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value as readonly unknown[];
}

/**
 * Every aura id the manifest names, mapped to its URL, or null for a payload that is not this
 * manifest. Lenient per entry and strict on shape, like `skill-art.ts`; `family` is the shape
 * check, without which any other payload reads as a manifest naming nothing.
 */
function urlsFrom(manifest: unknown): ReadonlyMap<string, string> | null {
  if (typeof manifest !== 'object' || manifest === null) {
    return null;
  }
  const record = manifest as { family?: unknown; assets?: unknown; externalAssets?: unknown };
  if (record.family !== 'auras' || !Array.isArray(record.assets)) {
    return null;
  }
  const urls = new Map<string, string>();
  for (const entry of record.assets as readonly unknown[]) {
    const row = entry as { auraId?: unknown; output?: unknown } | null;
    const id = fileSegment(row?.auraId);
    const file = fileSegment(row?.output);
    if (id !== null && file !== null) {
      urls.set(row?.auraId as string, `${AURA_DIR}/${file}`);
    }
  }
  for (const entry of listOf(record.externalAssets)) {
    const row = entry as { auraId?: unknown; runtimeUrl?: unknown } | null;
    const url = externalUrl(row?.runtimeUrl);
    if (typeof row?.auraId === 'string' && row.auraId.length > 0 && url !== null) {
      urls.set(row.auraId, url);
    }
  }
  return urls;
}

function createAuraArt(deps: AuraArtDeps): AuraArt {
  let known: KnownArt | undefined;
  /** One manifest and one URL, so a frameful of aura rows costs one request. */
  let reading: Promise<void> | undefined;

  const read = async (): Promise<void> => {
    try {
      known = urlsFrom(await deps.fetchJson(MANIFEST_URL)) ?? 'unreadable';
    } catch {
      // An older game serves no aura manifest. Recorded so it is not retried on every row.
      known = 'unreadable';
    }
  };

  const ensure = (): Promise<void> => {
    if (known !== undefined) {
      return Promise.resolve();
    }
    reading ??= read().finally(() => {
      reading = undefined;
    });
    return reading;
  };

  return {
    preload: ensure,

    urlFor: (auraId) => {
      if (typeof auraId !== 'string' || auraId.length === 0) {
        return null;
      }
      if (known === undefined) {
        // Start the read and answer "none" for this call. Nothing awaits it: the
        // point of the cache is that the row after this one is exact.
        ensure().catch(() => undefined);
        return null;
      }
      if (known === 'unreadable') {
        return null;
      }
      return known.get(auraId) ?? null;
    },
  };
}

export type { AuraArt, AuraArtDeps };
export { createAuraArt, MANIFEST_URL, urlsFrom };
