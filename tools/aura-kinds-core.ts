// Turns the game's aura classifier sets into a runtime value module and a published union. Pure,
// so a Vitest suite can drive it; `tools/aura-kinds.mjs` is the CLI around it.
//
// It reads a CHECKOUT because the classifier is bundled into the play chunk and served nowhere, so
// nothing 404s when the input is stale: hence the required `--game` and the version in both
// headers. The runtime carries the VALUE as well as the types, having no endpoint to re-read.
//
// The parse is over source TEXT: the game's extensionless imports do not resolve under Node's type
// stripping, and a text parse fails loudly on a refactor where an import would fail obscurely.

import type { ToggleRule } from './aura-toggle-core.ts';
import { byCodePoint } from './icons-core.ts';

const GENERATED_VALUES = 'loader/src/shared/aura-kinds.generated.ts';
const GENERATED_TYPES = 'packages/types/aura-kinds.generated.d.ts';

/** Where the rule lives in the game repository. Relative to the checkout root. */
const SOURCE = 'src/sim/aura_classify.ts';

/** The declaration this parse is anchored on. A refactor that moves it throws. */
const DECLARED = 'DEBUFF_AURA_KINDS';
const OPEN = `export const ${DECLARED}: ReadonlySet<AuraKind> = new Set<AuraKind>([`;
const CLOSE = '\n]);';

const NAME_RE = /'([a-z0-9_]+)'/;
const COMMENT = '//';

/** One line of the set body: a quoted name, or nothing when blank or a comment. */
function kindOnLine(line: string): string[] {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith(COMMENT)) {
    return [];
  }
  const found = NAME_RE.exec(trimmed);
  if (found?.[1] === undefined) {
    throw new Error(`${SOURCE} has a set entry this parse does not understand: ${trimmed}`);
  }
  return [found[1]];
}

/**
 * Every kind the game classifies as harmful by nature, in source order, deduped. Throws on any
 * unrecognised line rather than skipping it: a short set compiles and misclassifies silently.
 */
function debuffKinds(source: string): string[] {
  const open = source.indexOf(OPEN);
  if (open === -1) {
    throw new Error(`${SOURCE} no longer declares ${DECLARED} the expected way`);
  }
  const body = source.slice(open + OPEN.length);
  const close = body.indexOf(CLOSE);
  if (close === -1) {
    throw new Error(`${SOURCE} has an unterminated ${DECLARED} set`);
  }
  const unique = [...new Set(body.slice(0, close).split('\n').flatMap(kindOnLine))];
  if (unique.length === 0) {
    throw new Error(`${SOURCE} names no harmful aura kinds`);
  }
  return unique;
}

/** What both headers record: the source file and the game release it was read from. */
function readFrom(version: string): string {
  return `${SOURCE} in world-of-claudecraft ${version}`;
}

/** One set's members, sorted, so a regenerate diff is one line per name that moved. */
function members(names: readonly string[]): string {
  return [...names]
    .sort(byCodePoint)
    .map((name) => `  '${name}',`)
    .join('\n');
}

/** The TOGGLE rule's three sets, appended to the same generated module. */
function renderToggleValues(rule: ToggleRule): string {
  return `
// The game's TOGGLE rule (\`isToggleAura\` in the same classifier, plus the
// engine-bank term it calls into \`src/sim/persistent_aura.ts\` for). An aura that
// answers this is a MODE, not a timed effect: the sim backs a stance, a form,
// stealth, Ghost Wolf, the carried flag and the rotation banks with a long
// finite duration (3600s, or a whole match) that is SCAFFOLDING rather than
// information, so no surface may print a countdown for one.
//
// UNLIKE the dispel rule above, this one is implemented WHOLE: it reads \`kind\`
// and \`id\` and \`wireAura\` sends both, so there is no clause a client cannot see.
//
// The two id sets the game declares are merged, because the predicate ORs them
// and nothing here can use the difference.
// The opening comment in each body is LOAD-BEARING and not decoration: the
// formatter collapses a short array onto one line and keeps an array carrying a
// comment expanded, so without it the layout of these three would depend on how
// many members the game happens to declare, and the round-trip that proves this
// file is what the generator writes would break the day a set got small enough.
const TOGGLE_AURA_KINDS: ReadonlySet<string> = new Set([
  // A mode whatever id rides it.
${members(rule.kinds)}
]);

const TOGGLE_AURA_IDS: ReadonlySet<string> = new Set([
  // A mode whatever kind it rides: the authored toggles and the engine banks.
${members(rule.ids)}
]);

// The inverse override: an aura riding a toggle KIND that is a genuine timed
// buff and does want its countdown. Greater Invisibility reuses the rogue stealth
// machinery and is a fixed 20s buff.
const TIMED_AURA_IDS: ReadonlySet<string> = new Set([
  // Checked FIRST, so it wins over both sets above.
${members(rule.timed)}
]);
`;
}

/** The runtime's copy of BOTH sets: the harmful kinds, and the ids no dispel takes. */
function renderKindValues(
  kinds: readonly string[],
  ids: readonly string[],
  version: string,
  rule: ToggleRule,
): string {
  return `// Generated by tools/aura-kinds.mjs from ${readFrom(version)}. Do not hand-edit.
//
// Every aura kind the game treats as harmful BY NATURE, whatever its magnitude.
// Regenerate with \`pnpm aura-kinds\` after a game release changes the set.
//
// This is half of the game's rule and not the whole of it. The other half is a
// sign test: a \`buff_*\` kind whose magnitude went negative is a drain and is
// harmful too, which is why a mob sapping attack power does not need its own
// kind. \`world/auras.ts\` is where the two clauses are put back together, and it
// is the only place that should: an addon that reads a set writes its own
// classifier, which is the drift the game's own one-classifier rule exists to
// prevent, one level out.
//
// A kind added by a release this file predates reads as NOT harmful. That is the
// conservative direction and the published contract says so: an effect nobody
// classified is not offered as something to remove.

const DEBUFF_AURA_KINDS: ReadonlySet<string> = new Set([
${members(kinds)}
]);

// Every aura id \`isDispellableAura\` refuses OUTRIGHT, whatever the flags and the
// polarity on it say: one inline literal, and one set it consults for auras drawn
// on the debuff surface that are not removable effects.
//
// NOT published as a type, unlike the kinds above: an addon compares \`aura.kind\`
// and never has cause to name one of these.
const UNDISPELLABLE_AURA_IDS: ReadonlySet<string> = new Set([
${members(ids)}
]);
${renderToggleValues(rule)}
export {
  DEBUFF_AURA_KINDS,
  TIMED_AURA_IDS,
  TOGGLE_AURA_IDS,
  TOGGLE_AURA_KINDS,
  UNDISPELLABLE_AURA_IDS,
};
`;
}

/** The same names as a union, for an author writing a comparison against one. */
function renderKindTypes(kinds: readonly string[], version: string): string {
  const union = [...kinds]
    .sort(byCodePoint)
    .map((kind) => `  | '${kind}'`)
    .join('\n');
  return `// Generated by tools/aura-kinds.mjs from ${readFrom(version)}. Do not hand-edit.
//
// Every aura kind the game treats as harmful by nature, which is what
// \`world.harmful\` answers true for without consulting a magnitude. Regenerate
// with \`pnpm aura-kinds\` after a game release changes the set.
//
// Autocomplete only. Ask \`world.harmful(aura)\` rather than testing membership
// yourself: the game's rule has a second clause this union cannot carry, since a
// \`buff_*\` kind with a negative magnitude is a drain and is harmful too.
//
// OPEN, like every generated union here. The set is content, a game release adds
// to it before these types catch up, and a published type must never be able to
// break a working addon.

export type KnownHarmfulAuraKind =
${union};

export type HarmfulAuraKind = KnownHarmfulAuraKind | (string & Record<never, never>);
`;
}

export {
  debuffKinds,
  GENERATED_TYPES,
  GENERATED_VALUES,
  kindOnLine,
  renderKindTypes,
  renderKindValues,
  SOURCE,
};
