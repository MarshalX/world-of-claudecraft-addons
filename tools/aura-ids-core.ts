// The aura IDS the game refuses to dispel, read out of the same file the kinds are.
//
// Two of `isDispellableAura`'s clauses refuse an aura by ID rather than by any
// flag on it. One is a declared set and parses like the kinds (a rename throws);
// the other is an inline literal inside the predicate body, which is a weaker
// statement parse, and each parse says which it is.

const SOURCE = 'src/sim/aura_classify.ts';

/** The display-override set, which IS a named declaration and parses like the kinds. */
const DISPLAY_DECLARED = 'DEBUFF_DISPLAY_AURA_IDS';
const DISPLAY_OPEN = `const ${DISPLAY_DECLARED}: ReadonlySet<string> = new Set([`;
const DISPLAY_CLOSE = ']);';

/** The predicate the other refusal lives INSIDE, as a statement rather than a declaration. */
const PREDICATE = 'isDispellableAura';
const PREDICATE_OPEN = `export function ${PREDICATE}(`;
/**
 * The body opener. Anchor it AFTER the function name: the signature carries quoted
 * names inside a `Pick<>`, and two sibling predicates end with this same token.
 */
const BODY_OPEN = '): boolean {';
const BODY_CLOSE = '\n}';

const NAME_RE = /'([a-z0-9_]+)'/g;
/** The refusal shape: a literal id compared against the aura's own. */
const REFUSED_RE = /aura\.id === '([a-z0-9_]+)'/g;
/** Any comparison of the aura's id at all. */
const COMPARES_ID = 'aura.id ===';
const REFUSAL = 'return false;';
const COMMENT = '//';

/** Every quoted name on one line, or none for a blank line or a whole-line comment. */
function namesOnLine(line: string): string[] {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith(COMMENT)) {
    return [];
  }
  const found = [...trimmed.matchAll(NAME_RE)].map((match) => match[1] ?? '');
  if (found.length === 0) {
    throw new Error(
      `${SOURCE}: ${DISPLAY_DECLARED} has an entry this parse cannot read: ${trimmed}`,
    );
  }
  return found;
}

/**
 * The text between an opening token and its terminator, or a throw. Never an
 * empty block: that would write a table saying the game refuses nothing.
 */
function blockAfter(source: string, open: string, close: string, what: string): string {
  const at = source.indexOf(open);
  if (at === -1) {
    throw new Error(`${SOURCE} no longer declares ${what} the expected way`);
  }
  const body = source.slice(at + open.length);
  const end = body.indexOf(close);
  if (end === -1) {
    throw new Error(`${SOURCE} has an unterminated ${what}`);
  }
  return body.slice(0, end);
}

/**
 * The ids the game shows on the debuff surface but refuses to let a player remove.
 *
 * An empty BODY is a real answer, unlike the harmful-kind set: the game can empty
 * this set without the feature going away. A missing DECLARATION is still a hard
 * failure, because it cannot be told from a rename.
 */
function displayOverrideIds(source: string): string[] {
  const body = blockAfter(source, DISPLAY_OPEN, DISPLAY_CLOSE, DISPLAY_DECLARED);
  return [...new Set(body.split('\n').flatMap(namesOnLine))];
}

/**
 * One line of the predicate body, as the ids it refuses by literal.
 *
 * Anchored on the refusal rather than on the id's own `export const` in
 * `paladin_devotion.ts`: only this line says the predicate REFUSES the id, and a
 * release that dropped the clause and kept the constant must stop refusing it.
 * An `aura.id === '...'` guarding anything but `return false;` is a hard failure,
 * not a skip, because collecting it would read a non-refusal as a refusal.
 */
function refusalsOnLine(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.includes(COMPARES_ID)) {
    return [];
  }
  if (!trimmed.endsWith(REFUSAL)) {
    throw new Error(
      `${SOURCE}: ${PREDICATE} compares an aura id in a statement this parse does not ` +
        `understand, so it cannot tell a refusal from anything else: ${trimmed}`,
    );
  }
  return [...trimmed.matchAll(REFUSED_RE)].map((match) => match[1] ?? '');
}

/**
 * The ids refused inline by the predicate, plus the proof the parsed set is wired
 * in: a release that keeps `DEBUFF_DISPLAY_AURA_IDS` declared and stops consulting
 * it must fail here rather than emit ids the game no longer refuses.
 */
function inlineRefusedIds(source: string): string[] {
  const at = source.indexOf(PREDICATE_OPEN);
  if (at === -1) {
    throw new Error(`${SOURCE} no longer declares ${PREDICATE} the expected way`);
  }
  // Sliced to the predicate FIRST: two sibling predicates end with the same token.
  const body = blockAfter(source.slice(at), BODY_OPEN, BODY_CLOSE, PREDICATE);
  if (!body.includes(DISPLAY_DECLARED)) {
    throw new Error(
      `${SOURCE}: ${PREDICATE} no longer consults ${DISPLAY_DECLARED}, so that set is ` +
        'declared and unused and generating from it would refuse what the game allows',
    );
  }
  return body.split('\n').flatMap(refusalsOnLine);
}

/**
 * Every aura id the game refuses to dispel, from both clauses, deduped. Empty is
 * a failure: the inline half is never empty, so nothing found means a rewritten
 * predicate. The declaration is parsed before the body so a rename of the set
 * reports as a rename rather than as "declared and unused".
 */
function undispellableIds(source: string): string[] {
  const found = [...new Set([...displayOverrideIds(source), ...inlineRefusedIds(source)])];
  if (found.length === 0) {
    throw new Error(`${SOURCE}: ${PREDICATE} refuses no aura by id, which it always has`);
  }
  return found;
}

export { displayOverrideIds, inlineRefusedIds, refusalsOnLine, undispellableIds };
