// The game's TOGGLE-aura rule, read out of the checkout beside the dispel one.
//
// `isToggleAura` (src/sim/aura_classify.ts) answers whether an aura is a MODE
// rather than a timed effect: a stance, a druid form, stealth, Ghost Wolf, the
// carried flag, or one of the never-ageing rotation banks. The sim backs each
// with a long finite duration, 3600s or a whole match, which is SCAFFOLDING and
// not information, so the game prints no countdown for one.
//
// It reads two facts, `kind` and `id`, and `wireAura` sends both, so unlike
// `isDispellableAura` this is a rule the loader can implement EXACTLY. That is
// why it is worth mirroring at all: there is no clause here we cannot see.
//
// FOUR declarations across TWO files, because the predicate's third term calls
// into another module. They are read together and merged into the two sets the
// predicate actually needs, since nothing downstream has cause to tell a toggle
// id from a persistent-engine one.

/** Where each declaration lives, relative to the checkout root. */
const CLASSIFY = 'src/sim/aura_classify.ts';
const PERSISTENT = 'src/sim/persistent_aura.ts';

const KINDS = 'TOGGLE_AURA_KINDS';
const IDS = 'TOGGLE_AURA_IDS';
const TIMED = 'TIMED_AURA_IDS';
const ENGINE = 'PERSISTENT_ENGINE_AURA_IDS';

const PREDICATE = 'isToggleAura';

const KINDS_OPEN = `export const ${KINDS}: ReadonlySet<AuraKind> = new Set<AuraKind>([`;
const IDS_OPEN = `export const ${IDS}: ReadonlySet<string> = new Set([`;
const TIMED_OPEN = `export const ${TIMED}: ReadonlySet<string> = new Set([`;
const ENGINE_OPEN = `const ${ENGINE}: ReadonlySet<string> = new Set([`;
const CLOSE = ']);';

const NAME_RE = /'([a-z0-9_]+)'/g;
const COMMENT = '//';

/** Every quoted name on one line; none for a blank line or a whole-line comment. */
function namesOnLine(where: string, declared: string, line: string): string[] {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith(COMMENT)) {
    return [];
  }
  const found = [...trimmed.matchAll(NAME_RE)].map((match) => match[1] ?? '');
  if (found.length === 0) {
    throw new Error(`${where}: ${declared} has an entry this parse cannot read: ${trimmed}`);
  }
  return found;
}

/**
 * The members of one declared set, or a throw.
 *
 * Never answers short. A set that quietly loses names generates a file that
 * compiles and then prints a countdown under every stance in the game, which is
 * the exact drift the game's own one-classifier rule exists to prevent.
 */
function setMembers(where: string, source: string, open: string, declared: string): string[] {
  const at = source.indexOf(open);
  if (at === -1) {
    throw new Error(`${where} no longer declares ${declared} the expected way`);
  }
  const body = source.slice(at + open.length);
  const end = body.indexOf(CLOSE);
  if (end === -1) {
    throw new Error(`${where} has an unterminated ${declared}`);
  }
  const found = [
    ...new Set(
      body
        .slice(0, end)
        .split('\n')
        .flatMap((line) => namesOnLine(where, declared, line)),
    ),
  ];
  if (found.length === 0) {
    throw new Error(`${where}: ${declared} names nothing`);
  }
  return found;
}

/**
 * The proof the three sets we parse are the three the predicate consults.
 *
 * Without it, a release that keeps all four declarations and rewrites the
 * predicate to consult something else generates a rule the game no longer uses,
 * and nothing anywhere fails. The same guard `inlineRefusedIds` puts on
 * `DEBUFF_DISPLAY_AURA_IDS`, for the same reason.
 */
function checkPredicate(source: string): void {
  const at = source.indexOf(`export function ${PREDICATE}(`);
  if (at === -1) {
    throw new Error(`${CLASSIFY} no longer declares ${PREDICATE} the expected way`);
  }
  const body = source.slice(at);
  const end = body.indexOf('\n}');
  if (end === -1) {
    throw new Error(`${CLASSIFY} has an unterminated ${PREDICATE}`);
  }
  const named = body.slice(0, end);
  for (const term of [KINDS, IDS, TIMED, 'isPersistentEngineAura']) {
    if (!named.includes(term)) {
      throw new Error(
        `${CLASSIFY}: ${PREDICATE} no longer consults ${term}, so generating from it would ` +
          'mirror a rule the game has stopped applying',
      );
    }
  }
}

interface ToggleRule {
  /** Aura kinds that are a mode whatever the id. */
  kinds: string[];
  /** Aura ids that are a mode whatever the kind: the authored toggles AND the engine banks. */
  ids: string[];
  /** The inverse override: a genuine timed buff riding a toggle kind. */
  timed: string[];
}

/**
 * The whole rule, from both files.
 *
 * The two id sets are MERGED because the predicate ORs them and nothing
 * downstream can use the difference. Both counts are reported by the CLI so a
 * regeneration still says which side moved.
 */
function toggleRule(classify: string, persistent: string): ToggleRule {
  checkPredicate(classify);
  const authored = setMembers(CLASSIFY, classify, IDS_OPEN, IDS);
  const engine = setMembers(PERSISTENT, persistent, ENGINE_OPEN, ENGINE);
  return {
    kinds: setMembers(CLASSIFY, classify, KINDS_OPEN, KINDS),
    ids: [...new Set([...authored, ...engine])],
    timed: setMembers(CLASSIFY, classify, TIMED_OPEN, TIMED),
  };
}

export type { ToggleRule };
export { CLASSIFY, namesOnLine, PERSISTENT, setMembers, toggleRule };
