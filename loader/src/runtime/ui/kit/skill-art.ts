// Which abilities the deployed game ships a painted icon FILE for.
//
// Only some abilities are files; the rest are canvas-composited by the game with no URL. The
// served `/ui/skills/<class>/mapping.json` says which, so a blank slot means "no file" rather
// than "the loader built the wrong id". Read live, never bundled: it changes with releases.
//
// The read is SYNCHRONOUS, since `icon.ability()` is called while building a row. A class is
// fetched in the background on first use and the answer is optimistic until it lands (the
// image load decides). `preload` makes the first row exact too.

/** What one class's manifest is known to contain, or that it could not be read. */
type ClassArt = ReadonlySet<string> | 'unreadable';

interface SkillArt {
  /** Read a class's manifest. Never rejects: an unreadable manifest is a permanent "unknown". */
  preload: (cls: string) => Promise<void>;
  /**
   * Whether this class ships a file for this ability. Null means not read yet, which is not a
   * false.
   */
  has: (cls: string, id: string) => boolean | null;
}

interface SkillArtDeps {
  fetchJson: (url: string) => Promise<unknown>;
}

function manifestUrl(cls: string): string {
  return `/ui/skills/${encodeURIComponent(cls)}/mapping.json`;
}

/**
 * The ability ids a manifest names, or null for a payload that is not one. Lenient per entry
 * and strict on shape: one malformed entry loses one icon, not the whole class.
 */
function idsFrom(manifest: unknown, cls: string): ReadonlySet<string> | null {
  if (typeof manifest !== 'object' || manifest === null) {
    return null;
  }
  const record = manifest as { class?: unknown; abilities?: unknown };
  if (record.class !== cls || !Array.isArray(record.abilities)) {
    return null;
  }
  const ids = new Set<string>();
  for (const entry of record.abilities as readonly unknown[]) {
    const id = (entry as { abilityId?: unknown } | null)?.abilityId;
    if (typeof id === 'string' && id.length > 0) {
      ids.add(id);
    }
  }
  return ids;
}

function createSkillArt(deps: SkillArtDeps): SkillArt {
  const known = new Map<string, ClassArt>();
  /** In-flight reads, so a frameful of rows costs one request rather than one each. */
  const reading = new Map<string, Promise<void>>();

  const read = async (cls: string): Promise<void> => {
    try {
      known.set(cls, idsFrom(await deps.fetchJson(manifestUrl(cls)), cls) ?? 'unreadable');
    } catch {
      // A class with no manifest is ordinary. Recorded so it is not retried on every row.
      known.set(cls, 'unreadable');
    }
  };

  const ensure = (cls: string): Promise<void> => {
    if (known.has(cls)) {
      return Promise.resolve();
    }
    const running = reading.get(cls) ?? read(cls).finally(() => reading.delete(cls));
    reading.set(cls, running);
    return running;
  };

  return {
    preload: ensure,

    has: (cls, id) => {
      const art = known.get(cls);
      if (art === undefined) {
        // Start the read and answer "not known" for this call; later rows are exact.
        ensure(cls).catch(() => undefined);
        return null;
      }
      if (art === 'unreadable') {
        return null;
      }
      return art.has(id);
    },
  };
}

export type { SkillArt, SkillArtDeps };
export { createSkillArt, idsFrom, manifestUrl };
