// Turning the game's skill-art manifests into a union authors can autocomplete.
//
// The reading and the rendering live here, apart from the fetch, so a Vitest suite
// can drive both without a network. `tools/icons.mjs` is the CLI around them, the
// same split as cues-core.ts.
//
// WHY THIS IS GENERATED rather than probed. Only a subset of abilities ship a
// painted `.webp`; the rest are composited on a canvas inside the game, by a module
// an addon cannot reach. So an icon URL is either a real file or nothing, and
// without this manifest the only way to find out is to load the image and watch it
// fail. That made a blank icon slot ambiguous between "the game has no file for
// this" and "the loader built the wrong id", which cost a long debugging session.
// The manifest settles it before a request is made.
//
// It is the same argument as the sound pack, and the same shape of answer: content
// the deployed game serves, read from the game rather than copied into the loader.
//
// LIVE ONLY, like the cue generator, because the published types describe what most
// players are running. The channels diverge in BOTH directions, so this is a choice
// rather than an accident: measured across all three on 2026-07-30, pbe carried 318 ids
// to live's 237 while live carried `judgement`, which pbe had already dropped, and pbe2
// matched live exactly. Unioning them would autocomplete names most players' games have
// no file for. That reading is DATED on purpose. The divergence is what the argument
// rests on and it keeps; the counts move every release, and live is at 327 as of game
// 0.35.0. Re-measure before quoting a number, rather than trusting the one above.
//
// Narrowing to live costs autocomplete and nothing else. The RUNTIME reads the manifest
// from whichever host the player is actually on (`ui/kit/skill-art.ts`), so an addon on
// pbe still gets the right answer for a pbe-only ability; the union is also open at the
// use site, so a name outside it is not rejected. Point `--host` at pbe to see what is
// coming.
//
// The one thing the manifest does NOT carry is a display name. Entries are
// `{abilityId, sourceFile, output}`, so this cannot turn "Measured Shot" back into
// `measured_shot`; it can only say which ids have a file. Combat events name the
// ability rather than identifying it, which is why `combat-meter` still derives the
// id itself and why an `Aura` (which carries both) is the only exact pairing.

const GENERATED = 'packages/types/icons.generated.d.ts';

/**
 * Every class the game files skill art under.
 *
 * Written out because nothing is served that lists them: `/ui/skills/` has no
 * index, and the class set is content. The cost is that a class added by a game
 * release is invisible here until someone adds it, so the CLI treats a manifest
 * that 404s for a class in THIS list as a failure. That covers the direction that
 * breaks silently (art moved), and leaves the direction that merely goes
 * incomplete (a new class) to a release note.
 */
const ICON_CLASSES = [
  'druid',
  'hunter',
  'mage',
  'paladin',
  'priest',
  'rogue',
  'shaman',
  'warlock',
  'warrior',
] as const;

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

function manifestPath(cls: string): string {
  return `/ui/skills/${cls}/mapping.json`;
}

/**
 * The ability ids one class's manifest names, sorted and deduplicated.
 *
 * Throws rather than answering empty, for the reason the cue reader does: an empty
 * union generates a file that compiles, publishes, and quietly takes autocomplete
 * away from every author. The `class` field is checked against the class asked for,
 * which is what catches a path that resolved to the wrong manifest.
 */
function iconIds(manifest: unknown, cls: string): string[] {
  if (typeof manifest !== 'object' || manifest === null) {
    throw new Error(`the ${cls} skill manifest is not an object`);
  }
  const record = manifest as { class?: unknown; abilities?: unknown };
  if (record.class !== cls) {
    throw new Error(`the ${cls} manifest says it is for ${String(record.class)}`);
  }
  if (!Array.isArray(record.abilities)) {
    throw new Error(`the ${cls} skill manifest has no abilities array`);
  }
  const ids = record.abilities.map((entry) => {
    const id = (entry as { abilityId?: unknown } | null)?.abilityId;
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error(`the ${cls} skill manifest has an entry with no abilityId`);
    }
    return id;
  });
  const unique = [...new Set(ids)].sort(byCodePoint);
  if (unique.length === 0) {
    throw new Error(`the ${cls} skill manifest names no abilities`);
  }
  return unique;
}

/**
 * The generated module's text.
 *
 * One flat union across every class rather than one per class, following the cue union:
 * what an author wants to know is whether an id has a file, and a per-class type would
 * make them name the class twice for a call that already takes it.
 *
 * The per-class counts are in the header rather than folded away, because they are what
 * a reviewer reads on a regenerate diff: a count going up is art landing, and one going
 * DOWN is art moving, which is the change that would otherwise be silent.
 */
function renderIconTypes(byClass: ReadonlyMap<string, readonly string[]>, source: string): string {
  const all = [...new Set([...byClass.values()].flat())].sort(byCodePoint);
  const classes = [...byClass.keys()].sort(byCodePoint);
  const counts = classes.map((cls) => `//   ${cls}: ${String(byClass.get(cls)?.length ?? 0)}`);
  return `// Generated by tools/icons.mjs from ${source}. Do not hand-edit.
//
// Every ability the deployed game ships a painted icon FILE for, which is what
// \`woc.ui.icon.ability\` can return a URL for. Regenerate with \`pnpm icons\` after a
// game release commits art.
//
// This is not every ability. The game composites an icon on a canvas for anything
// without a file, from a module an addon cannot reach, so an ability outside this union
// has an icon in the game and no icon an addon can point at. That is a gap in what is
// REACHABLE, not a gap in the game.
//
// Read from LIVE, so these are the names most players' games have a file for. A pbe-only
// ability is missing here and still resolves at run time, because the loader reads the
// manifest from the host the player is on and this union is open where it is used.
//
// Ids with a file, per class:
${counts.join('\n')}

export type SkillIconClass =
${classes.map((cls) => `  | '${cls}'`).join('\n')};

export type KnownSkillIcon =
${all.map((id) => `  | '${id}'`).join('\n')};
`;
}

export { byCodePoint, GENERATED, ICON_CLASSES, iconIds, manifestPath, renderIconTypes };
