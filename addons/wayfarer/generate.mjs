// Regenerate `atlas.json` from a World of ClaudeCraft checkout.
//
//   node addons/wayfarer/generate.mjs --game=/path/to/world-of-claudecraft
//
// `--game` is REQUIRED and never defaulted: a stale checkout answers every read happily
// and produces a table that is quietly a release behind.
//
// It reads, and nothing else:
//
//   src/sim/data.ts                 ZONES (the order), WORLD_SIZE, INSTANCE_X_BASE,
//                                   and the PORTALS spread order
//   src/sim/content/*.ts            one `<NAME>_ZONE: ZoneDef` and one
//                                   `<NAME>_PORTALS: PortalDef[]` per file
//   src/sim/content/graveyards.ts   OVERWORLD_GRAVEYARDS
//   src/sim/content/mailboxes.ts    MAILBOXES
//   src/sim/*_layout.ts             the points, ids and names a town layout owns,
//                                   FOLLOWED FROM EACH READING MODULE'S OWN IMPORT
//                                   rather than from a list here
//   package.json                    the game VERSION stamped into the output
//
// It writes `atlas.json` beside itself. Every array is emitted in the game's own order and
// every object in a fixed key order, so two runs against one checkout are byte-identical.
//
// Two constants must come from the checkout. Some zones carry no x bounds and are the
// full-width strip, so the strip's width (from WORLD_SIZE) has to travel with the table.
// INSTANCE_X_BASE is what the addon's instance refusal turns on; a stale copy turns the
// refusal into a guess.
//
// Content assumptions a release could invalidate. Each throws rather than degrading,
// because a table quietly missing a part is worse than none:
//
//  - A zone's `pois` array is pure literals.
//  - A zone's `{...}` may spread an OBJECT constant declared in the same module. Array
//    spreads (`...MOAT,`) sit under properties this script does not read and are left alone.
//  - Every zone has exactly one `hub`, and a hub's `name` is also one of that zone's poi
//    labels; that pairing marks a poi as a TOWN. A hub matching no poi gets no town.
//  - Every mailbox lies inside exactly one zone rectangle and takes its id and label from
//    that zone's hub, because most mailboxes have no id or name in the game.
//  - A table row or a hub may read a town layout as `<NAME>_LAYOUT.a.b.c`, spread for a point
//    or read for a scalar. The layout module is followed from the reading module's import, so
//    a town moved into a new layout file needs no change here.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const OUTPUT = 'atlas.json';
/** What the checkout's own package.json has to be called for this to be one. */
const GAME_PACKAGE = 'world-of-claudecraft';
const DATA_FILE = 'src/sim/data.ts';
const CONTENT_DIR = 'src/sim/content';
/** The extension a followed import resolves to, since the game writes none. */
const MODULE_EXT = '.ts';

const NOT_FOUND = -1;
/** The characters of `: ` between a key and its value. */
const KEY_GAP = 2;
/** A backslash and the character it escapes. */
const ESCAPE_SPAN = 2;
/** The strip runs from minus half its width to plus half, as `src/sim/data.ts` derives it. */
const HALF = 2;
/** The output's indent, which is what makes two runs comparable byte for byte. */
const INDENT = '  ';
/** `lineWidth` from `biome.json`, because the output has to pass `pnpm lint`. */
const LINE_WIDTH = 100;
/** The comma that follows a value inside a container, which counts toward the width. */
const COMMA = 1;
const EMPTY = 0;
const START = 0;
const FIRST_LETTER = 1;
/** The leading dot of a captured `.a.b.c`, which is not part of the first key. */
const DOT = 1;

/** `radius` on a hub is an identifier in one zone file, and nothing here needs it. */
const HUB_RADIUS = /radius: [^,}]+,?/;
/** `hubMailbox(REALM_ZONE, { x: 7, z: -5 })`, which is a point this has to compute. */
const HUB_MAILBOX = /hubMailbox\((\w+), \{ x: (-?[\d.]+), z: (-?[\d.]+) \}\)/g;
/** The identifiers a `ZoneDef` or `PortalDef` table is declared under. */
const ZONE_DECL = /export const (\w+_ZONE): ZoneDef = \{/;
const PORTAL_DECL = /export const (\w+_PORTALS): PortalDef\[\] = (\[)/;
/** A `...IDENT,` line inside a spread-only array literal. */
const SPREAD_LINE = /^\.\.\.(\w+),$/;
/** A bare identifier on its own line inside an array literal. */
const IDENT_LINE = /^(\w+),$/;
/** Numeric separators, which the game writes INSTANCE_X_BASE with. */
const UNDERSCORES = /_/g;
const TRAILING_COMMA = /,\s*$/;
/** A trailing line comment on a property line, which is not part of its value. */
const TRAILING_COMMENT = / \/\/.*$/;
/** A value import, whose bindings are read for the town layouts a module pulls in. */
const NAMED_IMPORT = /import\s*\{([^}]+)\}\s*from\s*'([^']+)';/g;
/** A binding that names a town layout, e.g. `FENBRIDGE_LAYOUT`. */
const LAYOUT_BINDING = /^\w+_LAYOUT$/;
/** `...FENBRIDGE_LAYOUT.services.mailbox.position`, spread into a table row. */
const LAYOUT_SPREAD = /\.\.\.(\w+_LAYOUT)((?:\.\w+)+)/g;
/** `FENBRIDGE_LAYOUT.services.graveyard.id`, read for a scalar rather than spread. */
const LAYOUT_READ = /(\w+_LAYOUT)((?:\.\w+)+)/g;
/**
 * `...PROVING_SHORE_RECT,`: a spread of a constant declared in the SAME module. The trailing
 * comma tells it apart from a `...X_LAYOUT.a.b,` spread, which LAYOUT_SPREAD owns.
 */
const LOCAL_SPREAD = /\.\.\.([A-Z][A-Z0-9_]*),/g;
/**
 * A bare identifier standing in for a block, e.g. `services: SERVICES,`. SCREAMING_SNAKE only:
 * a looser rule matches a bare `34` and then hunts for a `const 34` that does not exist.
 */
const IDENT_VALUE = /^[A-Z][A-Z0-9_]*$/;
/**
 * A same-module constant read as a VALUE, e.g. `id: LAST_KEEP_GRAVEYARD_ID,`. The lookbehind
 * excludes a layout read, a spread and the tail of a longer name; the lookahead excludes an
 * upper-case property KEY.
 */
const LOCAL_CONST = /(?<![.\w])([A-Z][A-Z0-9_]{2,})\b(?!\s*:)/g;

/** Prose that belongs in the file rather than only in this script. */
const NOTES = [
  "Crafting stations are deliberately NOT here. world.stations is published and carries the game's own placements with their zone ids, so a copy would be a second table to keep in step with nothing gained.",
  'A poi id is FROZEN game content: the exploration deed marks key on it as poi:<zoneId>:<poiId>. A poi label is display-only and the game re-words them freely, which is why the_statuary_walk is labelled The Parterre Walk and the_rose_wilds is labelled Dawnhold Castle.',
  "A town flag marks the poi that stands on its zone's own hub. The game authors the hub separately, with a name and a radius; every zone's hub name is also a poi label, so the flag carries the fact without a duplicate row.",
  "A hidden flag carries the game's own hideOnMap, which drops a poi's label from the world map for a place that no longer reads as a landmark. It is carried rather than dropped because the exploration deed sweep does NOT consult the flag: a hidden poi is still walked to and still marks, so it still counts toward a zone's exploration even though nothing lists it.",
  'Most mailboxes have no id and no name in the game: MAILBOXES is a bare list of points, and only the two towns with their own layout name theirs (mailbox_eastbrook and mailbox_fenbridge). Every id and every label here is derived from the hub of the zone the point falls in, which is the one rule that covers all fifteen and which agrees with the game on both of the named ones. The game also nudges a mailbox clear of buildings at spawn (findSafePos), so a point here is where it was authored rather than exactly where it stands.',
  'A portal has no display name in the game either. The label here is title-cased from the frozen id.',
  'No y anywhere, because the game authors none: ground height is a function of the world seed, which no addon can call and no server sends.',
];

const SOURCE_FILES = [
  'src/sim/data.ts (ZONES, WORLD_SIZE, INSTANCE_X_BASE, PORTALS)',
  'src/sim/content/*.ts (one ZoneDef and one PortalDef[] per zone)',
  'src/sim/content/graveyards.ts (OVERWORLD_GRAVEYARDS)',
  'src/sim/content/mailboxes.ts (MAILBOXES)',
  'src/sim/*_layout.ts (the points, ids and names a town layout owns, which the two tables above and one zone hub read through it)',
];

/** The `--game=` path, or a refusal. Never defaulted: see the header. */
function gameArg() {
  const given = process.argv.find((one) => one.startsWith('--game='));
  if (given === undefined) {
    throw new Error(
      'pass the game checkout: node addons/wayfarer/generate.mjs --game=/path/to/world-of-claudecraft',
    );
  }
  const path = given.slice('--game='.length);
  if (path.length === 0) {
    throw new Error('--game= needs a path after it');
  }
  return path;
}

/** The checkout's version, having proved the path really is the game. */
function gameVersion(root) {
  const manifest = join(root, 'package.json');
  if (!existsSync(manifest)) {
    throw new Error(`${root} has no package.json, so it is not a checkout`);
  }
  const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
  if (parsed.name !== GAME_PACKAGE) {
    throw new Error(`${root} is "${String(parsed.name)}" rather than ${GAME_PACKAGE}`);
  }
  if (!existsSync(join(root, DATA_FILE))) {
    throw new Error(`${root} has no ${DATA_FILE}, so this is not a checkout to read`);
  }
  if (typeof parsed.version !== 'string') {
    throw new Error(`${root} declares no version to stamp`);
  }
  return parsed.version;
}

function read(root, path) {
  return readFileSync(join(root, path), 'utf8');
}

/** Past a quoted string, so a brace inside one cannot move a depth count. */
function skipString(text, from) {
  const quote = text[from];
  let at = from + 1;
  while (at < text.length) {
    if (text[at] === '\\') {
      at += ESCAPE_SPAN;
    } else if (text[at] === quote) {
      return at + 1;
    } else {
      at += 1;
    }
  }
  throw new Error(`unterminated string at ${String(from)}`);
}

function isQuote(ch) {
  return ch === "'" || ch === '"' || ch === '`';
}

/**
 * The balanced block starting at `from`, both delimiters included. Strings and line comments
 * are skipped, since a label may hold either delimiter.
 */
function blockAt(text, from, open, close) {
  let depth = 0;
  let at = from;
  while (at < text.length) {
    const ch = text[at];
    if (isQuote(ch)) {
      at = skipString(text, at);
    } else if (ch === '/' && text[at + 1] === '/') {
      at = text.indexOf('\n', at);
      if (at === NOT_FOUND) {
        at = text.length;
      }
    } else {
      depth += Number(ch === open) - Number(ch === close);
      if (ch === close && depth === 0) {
        return text.slice(from, at + 1);
      }
      at += 1;
    }
  }
  throw new Error(`unbalanced ${open} from ${String(from)}`);
}

/**
 * The value text of a top-level `name: value,` line inside a block, or null. A trailing
 * comment is cut first, or it swallows the closing parenthesis `literal` wraps the value in.
 */
function propText(block, name) {
  const want = `${name}: `;
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith(want)) {
      const value = trimmed.slice(name.length + KEY_GAP).replace(TRAILING_COMMENT, '');
      return value.replace(TRAILING_COMMA, '');
    }
  }
  return null;
}

/**
 * Where a named declaration's literal opens. Searches for `= [`, because the first `[` after
 * a name typed `GraveyardDef[]` is the TYPE's, and reading from there yields a silent `[]`.
 */
function openerAt(text, marker, open) {
  const at = text.indexOf(marker);
  if (at === NOT_FOUND) {
    throw new Error(`"${marker}" is no longer declared where this expects it`);
  }
  const assign = text.indexOf(`= ${open}`, at);
  if (assign === NOT_FOUND) {
    throw new Error(`"${marker}" no longer opens with ${open}`);
  }
  return assign + KEY_GAP;
}

/** The balanced block a named property opens, or null when the property is absent. */
function propBlock(block, name, open, close) {
  const at = block.indexOf(`${name}: ${open}`);
  if (at === NOT_FOUND) {
    return null;
  }
  return blockAt(block, at + name.length + KEY_GAP, open, close);
}

/**
 * Evaluate a pure object or array literal out of the checkout. `new Function` because these
 * are JS literals (trailing commas, comments, single quotes); anything naming an identifier
 * throws, which is the loud failure a restructured table should produce.
 *
 * An ABSENT value is refused here: `propText` answers null for a property no longer on its
 * own line, and `return (null)` would otherwise evaluate happily. Callers with a genuinely
 * optional property (xMin, xMax) null-check before calling.
 */
function literal(text, what) {
  if (text === null || text === undefined) {
    throw new Error(`${what} is no longer declared where this reads it`);
  }
  try {
    return new Function(`return (${text});`)();
  } catch (err) {
    throw new Error(`${what} is no longer a plain literal: ${String(err)}`, { cause: err });
  }
}

/** A `export const NAME = <number>;` out of a module, with separators stripped. */
function constNumber(text, name) {
  const marker = `export const ${name} = `;
  const at = text.indexOf(marker);
  if (at === NOT_FOUND) {
    throw new Error(`${name} is no longer declared in ${DATA_FILE}`);
  }
  const from = at + marker.length;
  const end = text.indexOf(';', from);
  const value = Number(text.slice(from, end).replace(UNDERSCORES, ''));
  if (!Number.isFinite(value)) {
    throw new Error(`${name} is no longer a plain number in ${DATA_FILE}`);
  }
  return value;
}

/** The identifiers an array of bare names or spreads lists, in order. */
function identsIn(text, name, pattern) {
  const block = blockAt(text, openerAt(text, name, '['), '[', ']');
  const found = [];
  for (const line of block.split('\n')) {
    const matched = pattern.exec(line.trim());
    if (matched !== null) {
      found.push(matched[1]);
    }
  }
  return found;
}

/** Every content module, read once, keyed by file name and walked in sorted order. */
function contentModules(root) {
  const dir = join(root, CONTENT_DIR);
  const names = readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .sort();
  return names.map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));
}

/** One content module by file name, or a refusal naming the one that moved. */
function moduleNamed(modules, name) {
  const found = modules.find((one) => one.name === name);
  if (found === undefined) {
    throw new Error(`${CONTENT_DIR}/${name} is gone, so its table cannot be read`);
  }
  return found;
}

/** Declaration identifier to the module text declaring it. */
function declaredIn(modules, pattern) {
  const found = new Map();
  for (const module of modules) {
    const matched = pattern.exec(module.text);
    if (matched !== null) {
      found.set(matched[1], module);
    }
  }
  return found;
}

/**
 * A zone's hub, which is where its town stands and what names it. The block form is tried
 * first, because on a multi-line hub `propText` hands back the opening brace alone.
 */
function hubOf(block, ident, layouts) {
  const text = propBlock(block, 'hub', '{', '}') ?? propText(block, 'hub');
  if (text === null) {
    throw new Error(`${ident} no longer declares a hub`);
  }
  return literal(withLayoutValues(text.replace(HUB_RADIUS, ''), layouts), `${ident} hub`);
}

/**
 * One point of interest, with each flag present only when true. `hidden` is the game's
 * `hideOnMap`; the row is kept because the deed sweep ignores the flag and still counts it.
 */
function poiOf(poi, hub) {
  const built = { id: poi.id, label: poi.label, x: poi.x, z: poi.z };
  if (poi.label === hub.name) {
    built.town = true;
  }
  if (poi.hideOnMap === true) {
    built.hidden = true;
  }
  return built;
}

/**
 * One zone. `xMin` and `xMax` are emitted ONLY where the game declares them: their absence
 * means the full-width strip, and flattening it would put Farshore Isle into Eastbrook Vale.
 */
function zoneOf(root, module, ident) {
  const block = withLocalSpreads(
    blockAt(module.text, openerAt(module.text, `export const ${ident}: ZoneDef`, '{'), '{', '}'),
    module,
  );
  const hub = hubOf(block, ident, layoutsFor(root, module));
  const pois = literal(propBlock(block, 'pois', '[', ']'), `${ident} pois`);
  const built = {
    id: literal(propText(block, 'id'), `${ident} id`),
    name: literal(propText(block, 'name'), `${ident} name`),
    zMin: literal(propText(block, 'zMin'), `${ident} zMin`),
    zMax: literal(propText(block, 'zMax'), `${ident} zMax`),
  };
  for (const bound of ['xMin', 'xMax']) {
    const text = propText(block, bound);
    if (text !== null) {
      built[bound] = literal(text, `${ident} ${bound}`);
    }
  }
  built.levelRange = literal(propText(block, 'levelRange'), `${ident} levelRange`);
  built.pois = pois.map((poi) => poiOf(poi, hub));
  return { zone: built, hub };
}

/** The zones, in the order `ZONES` lists them, each with its hub and ident beside it. */
function readZones(root, modules) {
  const data = read(root, DATA_FILE);
  const idents = identsIn(data, 'export const ZONES: ZoneDef[] = [', IDENT_LINE);
  const files = declaredIn(modules, ZONE_DECL);
  return idents.map((ident) => {
    const module = files.get(ident);
    if (module === undefined) {
      throw new Error(`${ident} is in ZONES but is declared in no content module`);
    }
    return { ...zoneOf(root, module, ident), ident };
  });
}

/**
 * Every `<NAME>_LAYOUT` a content module imports, mapped to the text declaring it. Read from
 * the module's own imports, so a town moved into a new layout file resolves unchanged.
 */
function layoutsFor(root, module) {
  const found = new Map();
  for (const [, bindings, specifier] of module.text.matchAll(NAMED_IMPORT)) {
    const named = bindings.split(',').filter((one) => LAYOUT_BINDING.test(one.trim()));
    for (const binding of named) {
      found.set(binding.trim(), read(root, `${join(CONTENT_DIR, specifier)}${MODULE_EXT}`));
    }
  }
  return found;
}

/** The object literal a layout module exports under `ident`, `deepFreeze(` and all. */
function layoutBlock(text, ident) {
  const marker = `export const ${ident} = `;
  const at = text.indexOf(marker);
  if (at === NOT_FOUND) {
    throw new Error(`${ident} is no longer exported by the module its reader imports it from`);
  }
  return blockAt(text, text.indexOf('{', at + marker.length), '{', '}');
}

/** The block a bare identifier value stands for, e.g. the `SERVICES` in `services:`. */
function indirection(text, value) {
  if (!IDENT_VALUE.test(value)) {
    return null;
  }
  const marker = `const ${value} = `;
  const at = text.indexOf(marker);
  if (at === NOT_FOUND) {
    throw new Error(`${value} stands in for a value this script cannot find`);
  }
  return blockAt(text, at + marker.length, '{', '}');
}

/**
 * A key read out of a block written on ONE line, e.g. `{ x: 0, z: 300 }`, which the
 * line-oriented `propText` cannot see.
 */
function inlineKey(block, key) {
  let parsed = null;
  try {
    parsed = new Function(`return (${block});`)();
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || !(key in parsed)) {
    return null;
  }
  return JSON.stringify(parsed[key]);
}

/** One key of a dotted path: a nested block, an identifier followed, or a leaf. */
function layoutStep(text, block, key, what) {
  const nested = propBlock(block, key, '{', '}');
  if (nested !== null) {
    return nested;
  }
  const value = propText(block, key) ?? inlineKey(block, key);
  if (value === null) {
    throw new Error(`${what} no longer resolves: nothing carries "${key}"`);
  }
  return indirection(text, value) ?? value;
}

/** The value a dotted path reads out of a layout, e.g. `services.mailbox.position`. */
function layoutValue(text, ident, path, what) {
  let at = layoutBlock(text, ident);
  for (const key of path) {
    at = layoutStep(text, at, key, what);
  }
  return literal(at, what);
}

/** What one `<NAME>_LAYOUT.a.b.c` reference reads, from the module declaring it. */
function layoutRef(layouts, whole, ident, dotted) {
  const text = layouts.get(ident);
  if (text === undefined) {
    throw new Error(`${whole} names a layout the module reading it does not import`);
  }
  return layoutValue(text, ident, dotted.slice(DOT).split('.'), whole);
}

/**
 * Where a same-module `const IDENT = {` opens, or null when it is not an object. Not
 * `openerAt`, whose forward search would find an unrelated object further down for an array
 * constant like `MOAT`. Null rather than a throw, since array spreads sit under properties
 * this script does not read.
 */
function objectConstAt(text, ident) {
  const at = text.indexOf(`const ${ident}`);
  if (at === NOT_FOUND) {
    return null;
  }
  const assign = text.indexOf('=', at);
  const open = text.indexOf('{', assign);
  if (assign === NOT_FOUND || open === NOT_FOUND || text.slice(assign + 1, open).trim() !== '') {
    return null;
  }
  return open;
}

/**
 * Every `...IDENT,` spread of a same-module constant, replaced by its properties. One per
 * LINE, because `propText` reads line by line; emitted from the evaluated object so
 * non-scalar values still come out as readable syntax.
 */
function withLocalSpreads(text, module) {
  return text.replaceAll(LOCAL_SPREAD, (whole, ident) => {
    const opener = objectConstAt(module.text, ident);
    if (opener === null) {
      return whole;
    }
    const body = literal(blockAt(module.text, opener, '{', '}'), `${ident} in ${module.name}`);
    return Object.entries(body)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)},`)
      .join('\n');
  });
}

/**
 * Every layout reference in a table or a hub, replaced by the value it reads. Spreads go
 * first, since a spread contains a read and resolving that half would leave the dots behind.
 */
function withLayoutValues(text, layouts) {
  const spread = text.replaceAll(LAYOUT_SPREAD, (whole, ident, dotted) => {
    const point = layoutRef(layouts, whole, ident, dotted);
    if (typeof point?.x !== 'number' || typeof point?.z !== 'number') {
      throw new Error(`${whole} is no longer a point to spread`);
    }
    return `x: ${String(point.x)}, z: ${String(point.z)}`;
  });
  return spread.replaceAll(LAYOUT_READ, (whole, ident, dotted) =>
    JSON.stringify(layoutRef(layouts, whole, ident, dotted)),
  );
}

/**
 * Every same-module SCALAR constant read as a value, replaced by what it holds. Anything it
 * cannot resolve is LEFT ALONE so `literal` still throws on it: this widens what can be read
 * and must never widen what can be read wrong.
 */
function withLocalConstants(text, module) {
  return text.replaceAll(LOCAL_CONST, (whole, ident) => {
    const marker = `export const ${ident} = `;
    const at = module.text.indexOf(marker);
    if (at === NOT_FOUND) {
      return whole;
    }
    const end = module.text.indexOf(';', at);
    if (end === NOT_FOUND) {
      return whole;
    }
    const value = literal(module.text.slice(at + marker.length, end), `${ident} in ${module.name}`);
    return JSON.stringify(value);
  });
}

function readGraveyards(root, modules) {
  const module = moduleNamed(modules, 'graveyards.ts');
  const opener = openerAt(module.text, 'export const OVERWORLD_GRAVEYARDS', '[');
  const block = blockAt(module.text, opener, '[', ']');
  // Layouts first: their reads carry dots, which LOCAL_CONST's lookbehind skips anyway.
  const resolved = withLocalConstants(withLayoutValues(block, layoutsFor(root, module)), module);
  const rows = literal(resolved, 'OVERWORLD_GRAVEYARDS');
  return rows.map((row) => ({ id: row.id, label: row.name, x: row.x, z: row.z }));
}

/** The zone whose rectangle contains a point, by the same strict test the addon uses. */
function zoneAt(zones, strip, x, z) {
  return (
    zones.find((one) => {
      const xMin = one.zone.xMin ?? strip.stripMinX;
      const xMax = one.zone.xMax ?? strip.stripMaxX;
      return z >= one.zone.zMin && z < one.zone.zMax && x >= xMin && x < xMax;
    }) ?? null
  );
}

/** Every `hubMailbox(ZONE, offset)` call, replaced by the point it computes to. */
function withHubPoints(text, zones) {
  const byIdent = new Map(zones.map((one) => [one.ident, one.hub]));
  return text.replaceAll(HUB_MAILBOX, (whole, ident, dx, dz) => {
    const hub = byIdent.get(ident);
    if (hub === undefined) {
      throw new Error(`${whole} names a zone this script did not read`);
    }
    return `{ x: ${String(hub.x + Number(dx))}, z: ${String(hub.z + Number(dz))} }`;
  });
}

/**
 * The mailboxes, each named for the town it stands in. The game gives a mailbox neither id
 * nor name, so both come from the hub of the zone the point falls in.
 */
function readMailboxes(root, modules, zones, strip) {
  const module = moduleNamed(modules, 'mailboxes.ts');
  const opener = openerAt(module.text, 'export const MAILBOXES', '[');
  const block = blockAt(module.text, opener, '[', ']');
  const resolved = withHubPoints(withLayoutValues(block, layoutsFor(root, module)), zones);
  return literal(resolved, 'MAILBOXES').map((box) => {
    const home = zoneAt(zones, strip, box.x, box.z);
    if (home === null) {
      throw new Error(`the mailbox at ${String(box.x)}, ${String(box.z)} is in no zone`);
    }
    const label = home.hub.name;
    return { id: `mailbox_${slug(label)}`, label, x: box.x, z: box.z };
  });
}

/** A hub name as an id fragment: `Dawnrest Camp` becomes `dawnrest_camp`. */
function slug(label) {
  return label.toLowerCase().split(' ').join('_');
}

/** `duskfall_passage` reads as `Duskfall Passage`. The game names a portal nothing. */
function titleCase(id) {
  return id
    .split('_')
    .map((word) => word.slice(START, FIRST_LETTER).toUpperCase() + word.slice(FIRST_LETTER))
    .join(' ');
}

/** The portals, in the order the PORTALS spread joins the per-zone arrays. */
function readPortals(root, modules) {
  const data = read(root, DATA_FILE);
  const idents = identsIn(data, 'export const PORTALS: PortalDef[] = [', SPREAD_LINE);
  const files = declaredIn(modules, PORTAL_DECL);
  const built = [];
  for (const ident of idents) {
    const module = files.get(ident);
    if (module === undefined) {
      throw new Error(`${ident} is in PORTALS but is declared in no content module`);
    }
    const opener = openerAt(module.text, `export const ${ident}: PortalDef`, '[');
    const block = blockAt(module.text, opener, '[', ']');
    for (const portal of literal(block, ident)) {
      built.push({
        id: portal.id,
        label: titleCase(portal.id),
        radius: portal.radius,
        a: { x: portal.a.x, z: portal.a.z },
        b: { x: portal.b.x, z: portal.b.z },
      });
    }
  }
  return built;
}

/** The world's own strip width and the base of the instanced plane. */
function readStrip(root) {
  const data = read(root, DATA_FILE);
  const width = constNumber(data, 'WORLD_SIZE');
  return {
    stripMinX: -width / HALF,
    stripMaxX: width / HALF,
    instanceXBase: constNumber(data, 'INSTANCE_X_BASE'),
  };
}

function isScalar(value) {
  return value === null || typeof value !== 'object';
}

/**
 * An array, inline when it is all scalars and the line has room. This is why the output is
 * not `JSON.stringify(_, null, 2)`: Biome collapses an array that fits, so the stringified
 * form fails `pnpm lint` on formatting.
 */
function emitArray(value, indent, used) {
  if (value.length === EMPTY) {
    return '[]';
  }
  if (value.every(isScalar)) {
    const inline = `[${value.map((one) => JSON.stringify(one)).join(', ')}]`;
    if (used + inline.length + COMMA <= LINE_WIDTH) {
      return inline;
    }
  }
  const inner = indent + INDENT;
  const parts = value.map((one) => inner + emit(one, inner, inner.length));
  return `[\n${parts.join(',\n')}\n${indent}]`;
}

/** An object, always expanded, which is the shape Biome then leaves alone. */
function emitObject(value, indent) {
  const entries = Object.entries(value);
  if (entries.length === EMPTY) {
    return '{}';
  }
  const inner = indent + INDENT;
  const parts = entries.map(([key, one]) => {
    const head = `${inner}${JSON.stringify(key)}: `;
    return head + emit(one, inner, head.length);
  });
  return `{\n${parts.join(',\n')}\n${indent}}`;
}

function emit(value, indent, used) {
  if (Array.isArray(value)) {
    return emitArray(value, indent, used);
  }
  if (!isScalar(value)) {
    return emitObject(value, indent);
  }
  return JSON.stringify(value);
}

/** The whole file, with the checkout proved to be one before anything is read. */
function build(root) {
  const version = gameVersion(root);
  const modules = contentModules(root);
  const strip = readStrip(root);
  const zones = readZones(root, modules);
  return {
    source: { game: version, files: SOURCE_FILES, notes: NOTES },
    world: strip,
    zones: zones.map((one) => one.zone),
    graveyards: readGraveyards(root, modules),
    mailboxes: readMailboxes(root, modules, zones, strip),
    portals: readPortals(root, modules),
  };
}

function main() {
  const root = gameArg();
  const atlas = build(root);
  const target = join(import.meta.dirname, OUTPUT);
  writeFileSync(target, `${emit(atlas, '', START)}\n`);
  const pois = atlas.zones.reduce((total, zone) => total + zone.pois.length, START);
  console.log(
    `wayfarer: wrote ${OUTPUT} from game ${atlas.source.game}: ` +
      `${String(atlas.zones.length)} zones, ${String(pois)} points, ` +
      `${String(atlas.graveyards.length)} graveyards, ` +
      `${String(atlas.mailboxes.length)} mailboxes, ` +
      `${String(atlas.portals.length)} portals`,
  );
}

function reason(err) {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

try {
  main();
} catch (err) {
  console.error(`wayfarer: ${reason(err)}`);
  process.exit(1);
}
