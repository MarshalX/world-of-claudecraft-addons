// Regenerate `addons/emberwatch/rules.json` from a game checkout.
//
//   node addons/emberwatch/generate.mjs --game=/path/to/world-of-claudecraft
//
// `--game /path` works too. `rules.json` is GENERATED: never hand-edit it, the way
// `marketplace.json` and `CHANGELOG.md` are never hand-edited. The editorial half
// below is the source, so a regeneration cannot lose a hand-chosen rule; an edit
// made in the JSON instead is lost on the next run with nothing to say so.
//
// WHAT IS DERIVED AND WHAT IS EDITORIAL, because this is a CURATED starter set and
// not a mechanical dump of every aura in the game:
//
//   DERIVED from the checkout, and therefore fixed by re-running after a release:
//   the game version stamped into the file, every rule's display NAME, the class an
//   ability-anchored rule belongs to (cross-checked against the editorial class,
//   which is a hard failure if they disagree), and the order the classes come out in.
//
//   EDITORIAL, and living in `RULES` below: which rules exist at all, their ids,
//   which unit each watches, the condition, the threshold, the cue, the banner and
//   bout flags, `mine`, and the label SUFFIX ("fading", "ending", "gone") that turns
//   a bare display name into a sentence. The four class-agnostic rules are editorial
//   end to end, since they match on an aura KIND rather than on one ability.
//
// It reads four things, all read-only, and the never-modify-the-game rule stands:
//
//   src/sim/content/classes.ts        CLASSES for the class order, ABILITIES for
//                                     every id, its display name and its class.
//   src/sim/combat/auto_attack.ts     the proc auras that no ability table lists,
//   src/sim/combat/convergence.ts     applied straight through `ctx.applyAura` with
//   src/sim/combat/fire_mage.ts       a literal id and name.
//   src/sim/combat/frost_mage.ts
//   src/sim/combat/*.ts               every `kind: '...'` literal, as the vocabulary
//                                     a kind-anchored rule is checked against.
//   package.json                      the version stamped into the output.
//
// WHAT A GAME RELEASE CAN INVALIDATE, and what happens when it does. Every one of
// these is a hard failure that writes nothing, rather than a warning over a file
// that quietly lost a rule:
//
//  - AN ABILITY ID DISAPPEARS OR IS RENAMED. The rule naming it fails to resolve.
//    That is the whole reason the ids are checked rather than trusted: a rule for an
//    ability the game no longer has is a rule that can never fire, and nothing on
//    screen would ever say so.
//  - AN ABILITY MOVES CLASS. The derived class stops matching the editorial one.
//  - AN AURA KIND IS RENAMED. A kind-anchored rule stops matching the vocabulary.
//  - A DISPLAY NAME CHANGES. Not a failure: the new name lands in the output and the
//    diff shows it, which is the case this generator exists for. `cold_blood` is the
//    worked example: it is shown in game as "Killer's Calm", the hand-written table
//    said "Cold Blood", and deriving the name is what caught it.
//  - THE SOURCE STOPS BEING PARSEABLE BY A TEXT SCAN. These are regexes over
//    TypeScript rather than a real parse, anchored on the exact indentation the game
//    formats those tables at. A formatter change breaks the scan, and it breaks it
//    LOUDLY, because every id then fails to resolve at once.
//
// Reading a checkout is not the same as reading an endpoint: nothing 404s to tell
// you the source moved. That is why `--game` is required and is never defaulted, and
// why the version is read out of the checkout rather than passed in.
//
// The output is byte-stable. No timestamp, fixed key order, and the rules sorted by
// the game's own class order and then by rule id, so a regeneration against an
// unchanged checkout is a no-op diff and any diff at all means content moved.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** A trailing slash on --game, so a joined path never doubles it. */
const TRAILING_SLASH = /\/$/;
const GAME_FLAG = /^--game=(.+)$/;

/** The one file this may write, resolved against this script rather than the cwd. */
const OUTPUT = fileURLToPath(new URL('rules.json', import.meta.url));

const CLASSES_SOURCE = 'src/sim/content/classes.ts';
const COMBAT_DIR = 'src/sim/combat';
/**
 * Where a proc aura is applied without an ability table entry to name it.
 *
 * Listed rather than discovered, because a walk of every `applyAura` in the game
 * would pick up encounter auras and would make the answer depend on directory
 * order. Sorted, and a name collision between two of them is a failure.
 */
const PROC_SOURCES = [
  'src/sim/combat/auto_attack.ts',
  'src/sim/combat/convergence.ts',
  'src/sim/combat/fire_mage.ts',
  'src/sim/combat/frost_mage.ts',
];

/** The game's own package name, which is what makes a directory the right checkout. */
const GAME_PACKAGE = 'world-of-claudecraft';

const FORMAT = 'emberwatch-rules';
const FILE_VERSION = 1;
const INDENT = 2;
const NOTE =
  'Generated by addons/emberwatch/generate.mjs from a game checkout. Do not hand-edit: ' +
  'the editorial half lives in that script and a change made here is lost on the next run. ' +
  'Every id is the id an aura actually carries on the wire, which for a self-buff and a dot ' +
  "is the applying ability's id.";

/** The class token a rule uses when it applies to every class. */
const ANY = 'any';
/** Rules for every class sort ahead of every real class, whatever the game's order. */
const ANY_RANK = -1;

/** Redhand banks two charges, so one is an opener and two is the thing to spend. */
const OVERPOWER_CHARGES = 2;
/** Three applications of anything harmful is the point a ramp is worth interrupting. */
const RAMPING_STACKS = 3;

/**
 * THE EDITORIAL SET. Everything a checkout cannot decide.
 *
 * `ability` names the id whose DISPLAY NAME becomes the label and whose existence is
 * checked; `suffix` is the editorial half of the label. A rule with no `ability`
 * matches on a kind or on polarity alone and carries its own `label`.
 */
const RULES = [
  {
    id: 'stunned',
    cls: ANY,
    unit: 'player',
    kind: 'stun',
    on: 'gained',
    cue: 'ui_error',
    banner: true,
    label: 'Stunned',
  },
  {
    id: 'silenced',
    cls: ANY,
    unit: 'player',
    kind: 'silence',
    on: 'gained',
    cue: 'ui_error',
    label: 'Silenced',
  },
  {
    id: 'stacking-on-you',
    cls: ANY,
    unit: 'player',
    harmful: true,
    on: 'stacks',
    threshold: RAMPING_STACKS,
    cue: 'debuff_apply',
    label: 'Stacking up on you',
  },
  {
    id: 'bout-target-untouchable',
    cls: ANY,
    unit: 'target',
    kind: 'stasis',
    on: 'gained',
    cue: 'ui_error',
    bout: true,
    label: 'Target untouchable',
  },

  {
    id: 'warrior-battle-trance',
    cls: 'warrior',
    unit: 'player',
    ability: 'battle_trance',
    on: 'gained',
    cue: 'buff_apply',
  },
  {
    id: 'warrior-sudden-death',
    cls: 'warrior',
    unit: 'player',
    ability: 'sudden_death',
    on: 'gained',
    cue: 'buff_apply',
  },
  {
    id: 'warrior-overpower',
    cls: 'warrior',
    unit: 'player',
    ability: 'overpower',
    on: 'stacks',
    threshold: OVERPOWER_CHARGES,
    suffix: 'at two',
  },
  {
    id: 'warrior-recklessness',
    cls: 'warrior',
    unit: 'player',
    ability: 'recklessness',
    on: 'expiring',
    suffix: 'ending',
  },

  {
    id: 'mage-hot-streak',
    cls: 'mage',
    unit: 'player',
    ability: 'hot_streak',
    on: 'gained',
    cue: 'buff_apply',
  },
  {
    id: 'mage-brain-freeze',
    cls: 'mage',
    unit: 'player',
    ability: 'brain_freeze',
    on: 'gained',
    cue: 'buff_apply',
  },
  {
    id: 'mage-arcane-power',
    cls: 'mage',
    unit: 'player',
    ability: 'arcane_power',
    on: 'expiring',
    suffix: 'ending',
  },
  {
    id: 'mage-pyroblast',
    cls: 'mage',
    unit: 'target',
    ability: 'pyroblast',
    mine: true,
    on: 'expiring',
    suffix: 'fading',
  },

  {
    id: 'rogue-cold-blood',
    cls: 'rogue',
    unit: 'player',
    ability: 'cold_blood',
    on: 'gained',
    cue: 'buff_apply',
  },
  {
    id: 'rogue-rupture',
    cls: 'rogue',
    unit: 'target',
    ability: 'rupture',
    mine: true,
    on: 'expiring',
    suffix: 'fading',
  },
  {
    id: 'rogue-garrote',
    cls: 'rogue',
    unit: 'target',
    ability: 'garrote',
    mine: true,
    on: 'expiring',
    suffix: 'fading',
  },
  {
    id: 'rogue-evasion',
    cls: 'rogue',
    unit: 'player',
    ability: 'evasion',
    on: 'expiring',
    suffix: 'ending',
  },

  {
    id: 'paladin-sacred-bulwark',
    cls: 'paladin',
    unit: 'player',
    ability: 'sacred_bulwark',
    on: 'expiring',
    suffix: 'ending',
  },
  {
    id: 'paladin-righteous-fury',
    cls: 'paladin',
    unit: 'player',
    ability: 'righteous_fury',
    on: 'faded',
    cue: 'ui_error',
    suffix: 'gone',
  },

  {
    id: 'hunter-serpent-sting',
    cls: 'hunter',
    unit: 'target',
    ability: 'serpent_sting',
    mine: true,
    on: 'expiring',
    suffix: 'fading',
  },
  {
    id: 'hunter-bestial-wrath',
    cls: 'hunter',
    unit: 'player',
    ability: 'bestial_wrath',
    on: 'expiring',
    suffix: 'ending',
  },
  {
    id: 'hunter-rapid-fire',
    cls: 'hunter',
    unit: 'player',
    ability: 'rapid_fire',
    on: 'expiring',
    suffix: 'ending',
  },

  {
    id: 'priest-shadow-word-pain',
    cls: 'priest',
    unit: 'target',
    ability: 'shadow_word_pain',
    mine: true,
    on: 'expiring',
    suffix: 'fading',
  },
  {
    id: 'priest-shadowform',
    cls: 'priest',
    unit: 'player',
    ability: 'shadowform',
    on: 'faded',
    suffix: 'gone',
  },

  {
    id: 'shaman-flame-shock',
    cls: 'shaman',
    unit: 'target',
    ability: 'flame_shock',
    mine: true,
    on: 'expiring',
    suffix: 'fading',
  },
  {
    id: 'shaman-convergence',
    cls: 'shaman',
    unit: 'player',
    ability: 'elemental_convergence',
    on: 'gained',
    cue: 'buff_apply',
  },
  {
    id: 'shaman-elemental-mastery',
    cls: 'shaman',
    unit: 'player',
    ability: 'elemental_mastery',
    on: 'gained',
    cue: 'buff_apply',
  },

  {
    id: 'warlock-corruption',
    cls: 'warlock',
    unit: 'target',
    ability: 'corruption',
    mine: true,
    on: 'expiring',
    suffix: 'fading',
  },
  {
    id: 'warlock-immolate',
    cls: 'warlock',
    unit: 'target',
    ability: 'immolate',
    mine: true,
    on: 'expiring',
    suffix: 'fading',
  },
  {
    id: 'warlock-curse-of-agony',
    cls: 'warlock',
    unit: 'target',
    ability: 'curse_of_agony',
    mine: true,
    on: 'expiring',
    suffix: 'fading',
  },
  {
    id: 'warlock-metamorphosis',
    cls: 'warlock',
    unit: 'player',
    ability: 'metamorphosis',
    on: 'expiring',
    suffix: 'ending',
  },

  {
    id: 'druid-moonfire',
    cls: 'druid',
    unit: 'target',
    ability: 'moonfire',
    mine: true,
    on: 'expiring',
    suffix: 'fading',
  },
  {
    id: 'druid-rip',
    cls: 'druid',
    unit: 'target',
    ability: 'rip',
    mine: true,
    on: 'expiring',
    suffix: 'fading',
  },
  {
    id: 'druid-tigers-fury',
    cls: 'druid',
    unit: 'player',
    ability: 'tigers_fury',
    on: 'expiring',
    suffix: 'ending',
  },
  {
    id: 'druid-barkskin',
    cls: 'druid',
    unit: 'player',
    ability: 'barkskin',
    on: 'expiring',
    suffix: 'ending',
  },
];

/** A top-level entry in the CLASSES or ABILITIES record: exactly two spaces in. */
const RECORD_ENTRY_RE = /^ {2}([a-z0-9_]+): \{$/gm;
/** A property of one of those entries: exactly four. Both quote styles, since
 *  `cold_blood` is named "Killer's Calm" and an apostrophe forces double quotes. */
const NAME_RE = /^ {4}name: (?:'([^']*)'|"([^"]*)")/m;
const CLASS_RE = /^ {4}class: '([a-z]+)'/m;
/** One `ctx.applyAura(target, { ... })` call with literal fields. */
const APPLY_AURA_RE = /applyAura\([^)]*?\{([\s\S]{0,400}?)\}\s*\)/g;
const AURA_ID_RE = /\bid: '([a-z0-9_]+)'/;
const AURA_NAME_RE = /\bname: (?:'([^']*)'|"([^"]*)")/;
const KIND_RE = /\bkind: '([a-z0-9_]+)'/g;

function reason(err) {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * The checkout root, from `--game=X` or `--game X`.
 *
 * Required and never defaulted. This reads a CHECKOUT rather than an endpoint, so
 * nothing will 404 to say the source moved: a default would silently read whatever
 * happened to be at that path, at whatever version it happened to be.
 */
function gameArg() {
  const inline = process.argv.map((value) => GAME_FLAG.exec(value)).find((match) => match !== null);
  if (inline !== undefined) {
    return inline[1].replace(TRAILING_SLASH, '');
  }
  const at = process.argv.indexOf('--game');
  if (at === -1) {
    throw new Error(
      '--game is required and has no default: this reads a CHECKOUT rather than an ' +
        'endpoint, so nothing will 404 to tell you it is stale. Pass the game repository ' +
        'root, e.g. --game=/path/to/world-of-claudecraft',
    );
  }
  const given = process.argv[at + 1];
  if (given === undefined) {
    throw new Error('--game needs a value, e.g. --game=/path/to/world-of-claudecraft');
  }
  return given.replace(TRAILING_SLASH, '');
}

function read(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`${path} could not be read: ${reason(err)}`, { cause: err });
  }
}

/**
 * The checkout's own version, and the proof that this IS the checkout.
 *
 * Both together, because they answer the same question: a generator pointed at the
 * wrong directory is the silent failure every throw in this file exists to prevent,
 * and a package name is the cheapest thing that cannot be true of anywhere else.
 */
function gameVersion(checkout) {
  const parsed = JSON.parse(read(`${checkout}/package.json`));
  if (parsed?.name !== GAME_PACKAGE) {
    throw new Error(
      `${checkout} is not the game checkout: its package.json is named ` +
        `"${String(parsed?.name)}" rather than "${GAME_PACKAGE}"`,
    );
  }
  const version = parsed?.version;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`${checkout}/package.json declares no version`);
  }
  return version;
}

/** Every top-level entry of a record, as `[key, body]`, in source order. */
function entriesOf(source) {
  const marks = [...source.matchAll(RECORD_ENTRY_RE)].map((match) => ({
    key: match[1],
    at: match.index,
  }));
  return marks.map((mark, at) => [mark.key, source.slice(mark.at, marks[at + 1]?.at)]);
}

/** The slice of a file between two `export const` markers. */
function section(source, from, to) {
  const start = source.indexOf(from);
  if (start === -1) {
    throw new Error(`${CLASSES_SOURCE} no longer declares ${from}`);
  }
  const end = source.indexOf(to, start);
  if (end === -1) {
    throw new Error(`${CLASSES_SOURCE} no longer declares ${to}`);
  }
  return source.slice(start, end);
}

/**
 * The game's own class order, which is the order the output groups rules in.
 *
 * Derived rather than written down, so a class added or reordered by a release moves
 * the file rather than needing this script edited.
 */
function classOrder(source) {
  const found = entriesOf(section(source, 'export const CLASSES', 'export const ABILITIES')).map(
    ([key]) => key,
  );
  if (found.length === 0) {
    throw new Error(`${CLASSES_SOURCE}: no classes found, so the table format has moved`);
  }
  return found;
}

/** Ability id to its display name and the class it belongs to. */
function abilities(source) {
  const found = new Map();
  for (const [key, body] of entriesOf(source.slice(source.indexOf('export const ABILITIES')))) {
    const name = NAME_RE.exec(body);
    const cls = CLASS_RE.exec(body);
    if (name !== null) {
      found.set(key, { name: name[1] ?? name[2], cls: cls?.[1] ?? null });
    }
  }
  if (found.size === 0) {
    throw new Error(`${CLASSES_SOURCE}: no abilities found, so the table format has moved`);
  }
  return found;
}

/**
 * The proc auras applied straight through `applyAura` with no ability entry.
 *
 * A collision between two files is a failure rather than a first-wins, because a
 * first-wins would make the answer depend on the order this list happens to be in.
 */
function procAuras(checkout) {
  const found = new Map();
  for (const relative of PROC_SOURCES) {
    for (const [, body] of read(`${checkout}/${relative}`).matchAll(APPLY_AURA_RE)) {
      const id = AURA_ID_RE.exec(body);
      const name = AURA_NAME_RE.exec(body);
      if (id !== null && name !== null) {
        addProc(found, id[1], name[1] ?? name[2], relative);
      }
    }
  }
  return found;
}

function addProc(found, id, name, relative) {
  const seen = found.get(id);
  if (seen !== undefined && seen.name !== name) {
    throw new Error(
      `proc aura "${id}" is named "${seen.name}" in ${seen.from} and "${name}" in ${relative}`,
    );
  }
  found.set(id, { name, from: relative });
}

/** Every aura kind literal the sim's combat code mentions, as a membership test. */
function auraKinds(checkout, classesSource) {
  const found = new Set();
  const files = readdirSync(`${checkout}/${COMBAT_DIR}`)
    .filter((name) => name.endsWith('.ts'))
    .sort();
  const sources = [
    classesSource,
    ...files.map((name) => read(`${checkout}/${COMBAT_DIR}/${name}`)),
  ];
  for (const source of sources) {
    for (const [, kind] of source.matchAll(KIND_RE)) {
      found.add(kind);
    }
  }
  if (found.size === 0) {
    throw new Error(`${COMBAT_DIR}: no aura kinds found, so the source format has moved`);
  }
  return found;
}

/** The display name a rule's label is built from, checked against the checkout. */
function nameFor(rule, table, procs) {
  const known = table.get(rule.ability);
  if (known !== undefined) {
    if (known.cls !== null && known.cls !== rule.cls) {
      throw new Error(
        `rule "${rule.id}" is filed under ${rule.cls} and "${rule.ability}" is a ` +
          `${known.cls} ability`,
      );
    }
    return known.name;
  }
  const proc = procs.get(rule.ability);
  if (proc !== undefined) {
    return proc.name;
  }
  throw new Error(
    `rule "${rule.id}" names "${rule.ability}", which is in neither the ability table ` +
      'nor any proc site this script reads',
  );
}

function labelFor(rule, name) {
  if (rule.suffix === undefined) {
    return name;
  }
  return `${name} ${rule.suffix}`;
}

/** The label and the aura id half of a rule, derived or editorial. */
function subjectOf(rule, table, procs, kinds) {
  if (rule.ability === undefined) {
    if (rule.kind !== undefined && !kinds.has(rule.kind)) {
      throw new Error(`rule "${rule.id}" matches on kind "${rule.kind}", which the game has not`);
    }
    return { label: rule.label };
  }
  return { label: labelFor(rule, nameFor(rule, table, procs)), auraId: rule.ability };
}

/**
 * One output row, with its keys written in one fixed order.
 *
 * Assigned conditionally rather than spread, so an absent clause is an absent KEY:
 * the addon distinguishes a clause that was not asked from one asked as null, and a
 * null would make the rule match nothing.
 */
function rowFor(rule, subject) {
  const row = { id: rule.id, class: rule.cls, label: subject.label, unit: rule.unit };
  if (subject.auraId !== undefined) {
    row.auraId = subject.auraId;
  }
  for (const key of ['kind', 'mine', 'harmful']) {
    if (rule[key] !== undefined) {
      row[key] = rule[key];
    }
  }
  row.on = rule.on;
  for (const key of ['threshold', 'cue', 'banner', 'bout']) {
    if (rule[key] !== undefined) {
      row[key] = rule[key];
    }
  }
  return row;
}

function rankOf(cls, order) {
  if (cls === ANY) {
    return ANY_RANK;
  }
  const at = order.indexOf(cls);
  if (at === -1) {
    throw new Error(`rules are filed under "${cls}", which the game has no class for`);
  }
  return at;
}

/** The game's own class order first, then rule id. Both are stable across runs. */
function sorted(rows, order) {
  return [...rows].sort((a, b) => {
    const byClass = rankOf(a.class, order) - rankOf(b.class, order);
    if (byClass !== 0) {
      return byClass;
    }
    return a.id.localeCompare(b.id, 'en');
  });
}

function duplicates(rules) {
  const seen = new Set();
  for (const rule of rules) {
    if (seen.has(rule.id)) {
      throw new Error(`two rules share the id "${rule.id}"`);
    }
    seen.add(rule.id);
  }
}

function build(checkout, version) {
  const classesSource = read(`${checkout}/${CLASSES_SOURCE}`);
  const table = abilities(classesSource);
  const procs = procAuras(checkout);
  const kinds = auraKinds(checkout, classesSource);
  duplicates(RULES);
  const rows = RULES.map((rule) => rowFor(rule, subjectOf(rule, table, procs, kinds)));
  return {
    format: FORMAT,
    version: FILE_VERSION,
    game: version,
    note: NOTE,
    rules: sorted(rows, classOrder(classesSource)),
  };
}

function main() {
  const checkout = gameArg();
  const version = gameVersion(checkout);
  const file = build(checkout, version);
  writeFileSync(OUTPUT, `${JSON.stringify(file, null, INDENT)}\n`);
  console.log(
    `emberwatch: wrote ${String(file.rules.length)} starter rules from game ${version} to ` +
      'addons/emberwatch/rules.json',
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(`emberwatch: ${reason(err)}`);
    process.exit(1);
  }
}
