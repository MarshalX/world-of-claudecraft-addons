// The game's TOGGLE-aura rule (`isToggleAura`): whether an aura is a MODE (stance, form, stealth,
// carried flag, rotation bank) whose long finite duration is scaffolding and gets no countdown.
// It reads only `kind` and `id`, both on the wire, so the loader mirrors it exactly.
//
// Four declarations across two files, since the predicate's third term calls into another module.

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

/** The members of one declared set. Throws rather than answering short or empty. */
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
 * Throws unless the predicate still consults every term parsed here, so a rewritten predicate with
 * the declarations left in place cannot generate a rule the game no longer applies.
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

/** The whole rule, from both files. The two id sets are merged because the predicate ORs them. */
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
