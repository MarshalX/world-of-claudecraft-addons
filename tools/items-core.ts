// Turning the game's item-art manifest into a union authors can autocomplete.
//
// The reading and the rendering live here, apart from the fetch, so a Vitest suite
// can drive both without a network. `tools/items.mjs` is the CLI around them, the
// same split cues-core.ts and icons-core.ts use.
//
// WHY THIS IS GENERATED rather than probed. It is the icon argument one content
// table over: only some items ship a painted `.webp`, so an item icon URL is either
// a real file or nothing, and without the manifest the only way to find out is to
// load the image and watch it fail. That made a blank slot ambiguous between "the
// game has no file for this" and "the loader built the wrong id", which a 404
// cannot tell apart.
//
// The gap it describes is bigger than the skill one and has two halves worth
// knowing about. WEAPONS are filed under a MODEL name rather than an item id,
// through a table the game does not serve at all, so no weapon is in this manifest
// and none can be. The rest is art the game has not commissioned yet, which it
// enumerates itself rather than leaving silent.
//
// LIVE ONLY, like the cue and icon generators, because the published types describe
// what most players are running. The channels diverge for items too: measured
// 2026-08-02, live and pbe carried 562 ids to pbe2's 563. The size of that gap is
// not the argument, the DIRECTION is: unioning would autocomplete an id most
// players' games 404 on, and narrowing costs autocomplete and nothing else, since
// the RUNTIME reads the manifest from whichever host the player is on
// (`ui/kit/item-art.ts`) and the union is open where it is used.
//
// One thing differs from the skill manifests and shapes the shape check below.
// There is no per-class fan-out here and so no `class` field to catch a path that
// resolved to the wrong file. `iconSize` stands in for it: it is 128 on every
// channel, and a payload that is not this manifest fails on that and on the
// non-empty union both.

const GENERATED = 'packages/types/items.generated.d.ts';

/** The served square, as a shape check: a payload that is not this manifest fails here. */
const ICON_SIZE = 128;

/** Any total order will do: the sort exists to keep the generated file stable. */
function byCodePoint(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (a < b) {
    return -1;
  }
  return 1;
}

function manifestPath(): string {
  return '/ui/items/mapping.json';
}

/** An array, or an empty one for anything that is not a list. */
function listAt(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  return [];
}

/** The values that could name a file, which is what a usable id is here. */
function usableIds(values: readonly unknown[]): string[] {
  return values.filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/** The ids one `entries` array names, skipping an entry it cannot read. */
function idsFromEntries(entries: readonly unknown[]): string[] {
  return usableIds(entries.map((entry) => (entry as { itemId?: unknown } | null)?.itemId));
}

/** The ids every generated batch names, skipping a batch it cannot read. */
function idsFromBatches(batches: readonly unknown[]): string[] {
  return batches.flatMap((batch) =>
    usableIds(listAt((batch as { itemIds?: unknown } | null)?.itemIds)),
  );
}

/**
 * Every item id the manifest names a committed file for, sorted and deduplicated.
 *
 * Two lists, because the manifest keeps its provenance apart: `entries` are curated
 * art and carry a source name, `generatedBatches` are generated art and carry only
 * ids. Both have a file, so both belong in the union; only the first can answer a
 * name, which is why the name is read at RUN TIME and never generated.
 *
 * Lenient about one malformed entry and strict about the shape, matching the runtime
 * reader: one bad entry loses one id, whereas rejecting the payload loses the
 * certainty for all of them. Throws rather than answering empty, for the reason the
 * cue and icon readers do: an empty union generates a file that compiles, publishes,
 * and quietly takes autocomplete away from every author.
 */
function itemIconIds(manifest: unknown): string[] {
  if (typeof manifest !== 'object' || manifest === null) {
    throw new Error('the item manifest is not an object');
  }
  const record = manifest as { iconSize?: unknown; entries?: unknown; generatedBatches?: unknown };
  if (record.iconSize !== ICON_SIZE) {
    throw new Error(`the item manifest says its icons are ${String(record.iconSize)}, not 128`);
  }
  if (!(Array.isArray(record.entries) || Array.isArray(record.generatedBatches))) {
    throw new Error('the item manifest has neither an entries nor a generatedBatches array');
  }
  const named = idsFromEntries(listAt(record.entries));
  const generated = idsFromBatches(listAt(record.generatedBatches));
  const unique = [...new Set([...named, ...generated])].sort(byCodePoint);
  if (unique.length === 0) {
    throw new Error('the item manifest names no items');
  }
  return unique;
}

/**
 * The generated module's text.
 *
 * The count is in the header rather than folded away, because it is what a reviewer
 * reads on a regenerate diff: a count going up is art landing, and one going DOWN is
 * art moving, which is the change that would otherwise be silent.
 */
function renderItemTypes(ids: readonly string[], source: string): string {
  return `// Generated by tools/items.mjs from ${source}. Do not hand-edit.
//
// Every item the deployed game ships a painted icon FILE for, which is what
// \`woc.ui.icon.item\` can return a URL for. Regenerate with \`pnpm items\` after a
// game release commits art.
//
// This is not every item. Weapons are filed under a MODEL name rather than an item
// id and have no served manifest at all, so no weapon is here and none can be; the
// rest of the gap is art the game has not commissioned yet, which it enumerates
// itself rather than leaving silent.
//
// Names are NOT here. The manifest carries one per curated entry and it is the ART
// SOURCE name, which drifts from the game's display name on a content rename and is
// gated against nothing. \`ui.icon.itemArtName\` serves it at run time, labelled.
//
// Read from LIVE, so these are the ids most players' games have a file for. An id
// that only pbe ships is missing here and still resolves at run time, because the
// loader reads the manifest from the host the player is on and this union is open
// where it is used.
//
// Ids with a file: ${String(ids.length)}

export type KnownItemIcon =
${ids.map((id) => `  | '${id}'`).join('\n')};
`;
}

export { byCodePoint, GENERATED, ICON_SIZE, itemIconIds, manifestPath, renderItemTypes };
