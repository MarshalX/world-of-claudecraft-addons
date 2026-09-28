// Regenerates addons/purelight/refused.json from a World of ClaudeCraft checkout.
//
//   node addons/purelight/generate.mjs --game=/path/to/world-of-claudecraft
//   node addons/purelight/generate.mjs --game /path/to/world-of-claudecraft
//
// The checkout is REQUIRED and never defaulted; both argument forms are accepted.
//
// The game's dispel rule (`isDispellableAura` in src/sim/aura_classify.ts) refuses two classes
// of aura for a reason the wire does not carry: `encounterOwned`, which `wireAura` never emits,
// and the module-private `DEBUFF_DISPLAY_AURA_IDS`. Both are answerable from the aura's id,
// which is on the wire. The table lists what the game REFUSES, never what it allows.
//
// Some encounters stamp the boss's entity id onto an aura (`id: \`hoard_ice_${boss.id}\``). Such a
// row carries the literal head with `perEntity: true`, and the addon matches the head followed by
// an entity id. Any other template shape fails, since there is no id a row could name.
//
// Every `.ts` under src/sim is scanned rather than named, so a new encounter file is picked up.
// Every reading fails hard when it finds nothing: writing what was found is a stale table under
// a green run. Rows are objects rather than bare ids because Biome collapses an array of
// primitives onto one line.

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
/**
 * An object literal's own `id:`, whether it names a constant, spells the id out, or is a template
 * (captured whole, head and placeholders, so its shape can be checked).
 */
const ID_KEY = /(?:^|[^\w$.])id:\s*(?:'([^']*)'|([A-Za-z_$][\w$]*)|`([^`]*)`)/g;
/** The one template shape a row can express: a literal head, then an entity's own id, then nothing. */
const PER_ENTITY_TEMPLATE = /^([a-z0-9_]+)\$\{\s*[A-Za-z_$][\w$]*\.id\s*\}$/;

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
 * Prove the path is the game by package NAME: a wrong path with a `src` scans to nothing, which
 * reads as the game dropping the flag.
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
 * Where the object literal enclosing an offset begins, by a backwards brace count; this holds
 * because braces inside an aura literal are balanced (`{ ...target.pos }`). Null when the count
 * never opens.
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
 * The `id:` an aura literal was given. The LAST match before the flag, so a nested literal's id
 * does not answer for the enclosing aura.
 */
function idTokenIn(span) {
  let token = null;
  for (const match of span.matchAll(ID_KEY)) {
    token = { quoted: match[1], name: match[2], template: match[3] };
  }
  return token;
}

/**
 * Every `const NAME = 'literal'` in the tree. A name declared with two values is ambiguous rather
 * than last-write, and fails only when an aura's `id:` names it.
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

/** The literal head of a per-entity template id, or a failure naming where. */
function perEntityHead(template, where) {
  const head = PER_ENTITY_TEMPLATE.exec(template)?.[ONE];
  if (head === undefined) {
    return fail(
      `${where}: the template id \`${template}\` is not a literal head then an entity id`,
    );
  }
  return head;
}

/** The row one encounter-owned flag stands for: the id its literal gives, and whether it is a head. */
function ownedIdAt(source, at, where, consts) {
  const start = literalStart(source, at);
  if (start === null) {
    return fail(`${where}: this ${OWNED_FLAG} sits in no object literal`);
  }
  const token = idTokenIn(source.slice(start, at));
  if (token === null) {
    return fail(`${where}: the literal carrying ${OWNED_FLAG} declares no id`);
  }
  if (token.template !== undefined) {
    return { id: perEntityHead(token.template, where), perEntity: true };
  }
  if (token.quoted === undefined && consts.ambiguous.has(token.name)) {
    return fail(`${where}: ${token.name} is declared more than once under ${SIM_DIR}`);
  }
  const id = token.quoted ?? consts.values.get(token.name);
  if (id === undefined) {
    return fail(`${where}: ${String(token.name)} is not a string constant under ${SIM_DIR}`);
  }
  return { id, perEntity: false };
}

/** Every aura id one file applies with the encounter-owned flag on it. */
function ownedIdsIn(file, source, consts) {
  const found = [];
  let at = source.indexOf(OWNED_FLAG);
  while (at !== -ONE) {
    found.push(ownedIdAt(source, at, `${file}:${String(lineAt(source, at))}`, consts));
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
  // An EMPTY set is a reading; only the declaration going missing fails, since that is a rename.
  return [...inside.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

/** One row per refused id, sorted so a regeneration diffs as content rather than as order. */
function rowsFrom(owned, display) {
  const rows = new Map();
  for (const { id, perEntity } of owned) {
    if (rows.get(id)?.perEntity === !perEntity) {
      return fail(`'${id}' is applied both as an exact id and as a per-entity head`);
    }
    rows.set(id, { id, reason: 'encounter', perEntity });
  }
  for (const id of display) {
    // Not overwritten: an id that is both is recorded as an encounter's.
    if (!rows.has(id)) {
      rows.set(id, { id, reason: 'display', perEntity: false });
    }
  }
  return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
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
