// Regenerates addons/purelight/refused.json from a World of ClaudeCraft checkout.
//
//   node addons/purelight/generate.mjs --game=/path/to/world-of-claudecraft
//   node addons/purelight/generate.mjs --game /path/to/world-of-claudecraft
//
// The checkout is REQUIRED and never defaulted. Both argument forms are accepted, since the
// wrong one trips the required-argument error and reads as a missing flag.
//
// WHAT THIS TABLE IS. The game's dispel rule (`isDispellableAura` in src/sim/aura_classify.ts)
// refuses two classes of aura for a reason the WIRE DOES NOT CARRY:
//
//  - `encounterOwned`, added at game 0.41.0. `wireAura` (server/snapshot_timer_wire.ts) emits
//    `perm`, `ub`, `und` and `bt` and nothing for this one.
//  - `DEBUFF_DISPLAY_AURA_IDS`, a module-private set of ids shown on the debuff surface that
//    are nonetheless refused by every removal path. Also 0.41.0.
//
// Both are answerable from the aura's id, which is on the wire. The table lists what the game
// REFUSES, never what it allows.
//
// FILES ARE DISCOVERED, NOT NAMED: every `.ts` under src/sim is scanned for the flag, so a
// mechanic added to an existing encounter and a new encounter file are both picked up by a
// regeneration.
//
// EVERY READING IS A HARD FAILURE WHEN IT FINDS NOTHING, and no reading has a fallback: a
// generator that writes what it found is a stale table arriving under a green run.
//
// THE OUTPUT MUST SURVIVE BIOME: it collapses an array of primitives onto one line and leaves
// an array of objects expanded, so every row is an object rather than a bare id string.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

/** What the checkout's own package.json has to call itself to be the game. */
const GAME_PACKAGE_NAME = 'world-of-claudecraft';

/** The tree every aura in the game is applied from. Walked, never enumerated. */
const SIM_DIR = 'src/sim';
/** The one module holding the game's whole removability rule. */
const CLASSIFY_FILE = 'src/sim/aura_classify.ts';
/** The module-private set of ids that module refuses on sight. */
const DISPLAY_SET_NAME = 'DEBUFF_DISPLAY_AURA_IDS';
const OUT_FILE = 'refused.json';

const SOURCE_NOTE = `${SIM_DIR} (every applyAura literal carrying encounterOwned), ${CLASSIFY_FILE}`;

const NONE = 0;
const ONE = 1;
const INDENT = 2;
const TS_SUFFIX = '.ts';

/** The flag itself, as the encounters author it. */
const OWNED_FLAG = 'encounterOwned: true';
/** `export const NAME = 'literal';` and its module-private form, on one line. */
const STRING_CONST = /^(?:export )?const ([A-Za-z_$][\w$]*) = '([^']*)';$/gm;
/** An object literal's own `id:`, whether it names a constant or spells the id out. */
const ID_KEY = /(?:^|[^\w$.])id:\s*(?:'([^']*)'|([A-Za-z_$][\w$]*))/g;

/** The first capture of the first match, or null. */
function firstGroup(re, source) {
  for (const match of source.matchAll(re)) {
    return match[ONE];
  }
  return null;
}

function fail(message) {
  console.error(`generate: ${message}`);
  process.exit(ONE);
}

/** The checkout to read, in either argument form. Never guessed. */
function gamePathFrom(args) {
  const joined = args.find((arg) => arg.startsWith('--game='));
  if (joined !== undefined) {
    const path = joined.slice('--game='.length);
    if (path.length === NONE) {
      return fail('--game= is empty. Pass the world-of-claudecraft checkout to read from.');
    }
    return path;
  }
  const at = args.indexOf('--game');
  if (at === -ONE) {
    return fail('no --game=<path>. Pass the world-of-claudecraft checkout to read from.');
  }
  const next = args[at + ONE];
  if (next === undefined || next.length === NONE) {
    return fail('--game is empty. Pass the world-of-claudecraft checkout to read from.');
  }
  return next;
}

/**
 * Prove the path is the game before reading it, by package NAME rather than by the presence of
 * `src`: a wrong path with a `src` scans to nothing, which reads as the game dropping the flag.
 */
function checkoutVersion(root) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch (err) {
    return fail(`could not read ${root}/package.json (is this the game checkout?): ${String(err)}`);
  }
  if (parsed.name !== GAME_PACKAGE_NAME) {
    return fail(`${root} is "${String(parsed.name)}", not ${GAME_PACKAGE_NAME}`);
  }
  if (typeof parsed.version !== 'string' || parsed.version.length === NONE) {
    return fail(`${root}/package.json carries no version to stamp`);
  }
  return parsed.version;
}

/** Every `.ts` under one directory, depth first. */
function tsFilesUnder(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...tsFilesUnder(path));
    } else if (entry.endsWith(TS_SUFFIX)) {
      found.push(path);
    }
  }
  return found;
}

/**
 * Where the object literal enclosing an offset begins. A backwards brace count, which holds
 * because the only braces inside an aura literal are balanced (`{ ...target.pos }`); null when
 * the count never opens.
 */
function literalStart(source, at) {
  let depth = NONE;
  let i = at;
  while (i >= NONE) {
    const ch = source[i];
    if (ch === '}') {
      depth += ONE;
    } else if (ch === '{') {
      if (depth === NONE) {
        return i;
      }
      depth -= ONE;
    }
    i -= ONE;
  }
  return null;
}

/**
 * The `id:` an aura literal was given. The LAST match before the flag, so a nested literal
 * carrying its own id does not answer for the aura enclosing it.
 */
function idTokenIn(span) {
  let token = null;
  for (const match of span.matchAll(ID_KEY)) {
    token = { quoted: match[1], name: match[2] };
  }
  return token;
}

/**
 * Every `const NAME = 'literal'` in the tree. A name declared twice with two values is recorded
 * as ambiguous rather than resolved last-write, and fails only when an aura's `id:` names it.
 */
function stringConstants(files) {
  const values = new Map();
  const ambiguous = new Set();
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(STRING_CONST)) {
      const seen = values.get(match[1]);
      if (seen !== undefined && seen !== match[2]) {
        ambiguous.add(match[1]);
      }
      values.set(match[1], match[2]);
    }
  }
  return { values, ambiguous };
}

/** Which line an offset falls on, so a failure names somewhere a reader can open. */
function lineAt(source, at) {
  return source.slice(NONE, at).split('\n').length;
}

/** Every aura id one file applies with the encounter-owned flag on it. */
function ownedIdsIn(file, source, consts) {
  const found = [];
  let at = source.indexOf(OWNED_FLAG);
  while (at !== -ONE) {
    const where = `${file}:${String(lineAt(source, at))}`;
    const start = literalStart(source, at);
    if (start === null) {
      return fail(`${where}: this ${OWNED_FLAG} sits in no object literal`);
    }
    const token = idTokenIn(source.slice(start, at));
    if (token === null) {
      return fail(`${where}: the literal carrying ${OWNED_FLAG} declares no id`);
    }
    if (token.quoted === undefined && consts.ambiguous.has(token.name)) {
      return fail(`${where}: ${token.name} is declared more than once under ${SIM_DIR}`);
    }
    const id = token.quoted ?? consts.values.get(token.name);
    if (id === undefined) {
      return fail(`${where}: ${String(token.name)} is not a string constant under ${SIM_DIR}`);
    }
    found.push(id);
    at = source.indexOf(OWNED_FLAG, at + OWNED_FLAG.length);
  }
  return found;
}

/** Every id in the game's display-override set, which no removal path will take off. */
function displayIds(root) {
  const path = join(root, CLASSIFY_FILE);
  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch (err) {
    return fail(`could not read ${path}: ${String(err)}`);
  }
  const declared = new RegExp(`${DISPLAY_SET_NAME}[^=]*= new Set\\(\\[([^\\]]*)\\]`, 'g');
  const inside = firstGroup(declared, source);
  if (inside === null) {
    return fail(`${CLASSIFY_FILE} no longer declares ${DISPLAY_SET_NAME} as a Set literal`);
  }
  // An EMPTY set is a reading, not a failure; only the declaration going missing is, since that
  // is a rename.
  return [...inside.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

/** One row per refused id, sorted so a regeneration diffs as content rather than as order. */
function rowsFrom(owned, display) {
  const reasons = new Map();
  for (const id of owned) {
    reasons.set(id, 'encounter');
  }
  for (const id of display) {
    // Deliberately not overwritten: an id that is both is refused as an encounter's first.
    if (!reasons.has(id)) {
      reasons.set(id, 'display');
    }
  }
  return [...reasons.entries()]
    .map(([id, reason]) => ({ id, reason }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function render(table) {
  return `${JSON.stringify(table, null, INDENT)}\n`;
}

function main() {
  const root = gamePathFrom(process.argv.slice(INDENT));
  // The identity check FIRST, so a wrong path is never reported as an empty scan.
  const gameVersion = checkoutVersion(root);
  const files = tsFilesUnder(join(root, SIM_DIR));
  const consts = stringConstants(files);
  const owned = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (source.includes(OWNED_FLAG)) {
      owned.push(...ownedIdsIn(file, source, consts));
    }
  }
  if (owned.length === NONE) {
    return fail(
      `no ${OWNED_FLAG} anywhere under ${join(root, SIM_DIR)}; has the flag been renamed?`,
    );
  }
  const auras = rowsFrom(owned, displayIds(root));
  // Beside this script, never a path an argument could name.
  const out = join(import.meta.dirname, OUT_FILE);
  writeFileSync(out, render({ gameVersion, source: SOURCE_NOTE, auras }));
  console.log(`generate: wrote ${out} from ${GAME_PACKAGE_NAME} ${gameVersion}`);
  console.log(
    `generate: ${String(auras.length)} refused ids from ${String(files.length)} sim modules ` +
      `(${String(auras.filter((row) => row.reason === 'encounter').length)} encounter-owned)`,
  );
}

main();
