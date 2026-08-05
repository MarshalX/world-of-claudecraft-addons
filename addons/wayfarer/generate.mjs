// Regenerate `atlas.json` from a World of ClaudeCraft checkout.
//
//   node addons/wayfarer/generate.mjs --game=/path/to/world-of-claudecraft
//
// `--game` is REQUIRED and is never defaulted. A checkout is not an endpoint: a
// stale one answers every read happily and produces a table that is quietly a
// release behind, where a moved endpoint would 404. Naming the path every time is
// what makes the reader say which checkout they meant.
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
//                                   which the two tables above and one zone's hub
//                                   read through it. FOLLOWED FROM EACH READING
//                                   MODULE'S OWN IMPORT rather than from a list here
//   package.json                    the game VERSION stamped into the output
//
// It writes `atlas.json` beside itself and nothing else, anywhere.
//
// DETERMINISTIC. Every array is emitted in the game's own order (zones follow the
// ZONES array, portals follow the PORTALS spread, everything else follows its own
// table), every object is built in a fixed key order, and the output is
// `JSON.stringify(_, null, 2)` with a trailing newline. Two runs against an
// unchanged checkout are byte-identical.
//
// THE TWO CONSTANTS THAT MUST COME FROM THE CHECKOUT, and the reason this script
// exists rather than a paste:
//
//  - The zone table is NOT a set of plain rectangles. Five zones carry no x bounds
//    at all and are the original full-width strip; nine carry them and are grid
//    columns beside it. So the strip's own width has to travel with the table, and
//    it is derived here exactly as `src/sim/data.ts` derives it, from
//    WORLD_SIZE. A release that widens the world moves it.
//  - INSTANCE_X_BASE is what the addon's instance-plane refusal turns on. It has
//    already moved once (it was 600 before the world grid), and a release that
//    moves it again would silently turn the refusal into a guess.
//
// CONTENT ASSUMPTIONS A GAME RELEASE COULD INVALIDATE. Each of these throws rather
// than degrading, because a table that is quietly missing a part is worse than no
// table at all:
//
//  - A zone's `pois` array is pure literals. An entry built from an identifier or a
//    call would fail to evaluate here, loudly.
//  - Every zone has exactly one `hub`, and a hub's `name` is also one of that
//    zone's poi labels. That pairing is what marks a poi as a TOWN, and it holds
//    for all fourteen zones today. A zone whose hub name matches no poi simply gets
//    no town, which is the safe direction.
//  - Every mailbox lies inside exactly one zone rectangle, and its label is taken
//    from that zone's hub. Most mailboxes have no id and no name in the game at all,
//    so the ids emitted here are this addon's own, derived from the hub name. Where
//    a town layout DOES name its own (`mailbox_eastbrook`, `mailbox_fenbridge`) the
//    derivation happens to agree, and it is the derivation that is emitted, because
//    it is the one rule that covers all fourteen.
//  - A table row, or a zone's hub, may read a town layout as `<NAME>_LAYOUT.a.b.c`,
//    either spread for a point or read for a scalar. The module holding that layout
//    is followed from the READING module's own import, so a town rebuilt into a new
//    layout file is picked up without a name being added here. That generality is
//    not speculative: Fenbridge became the second town to move this way, and a
//    script that had hard-coded the first one simply stopped. A path that no longer
//    resolves, and a spread that no longer reads a point, both throw.

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
 * A bare identifier standing in for a block, e.g. `services: SERVICES,`.
 *
 * Deliberately only SCREAMING_SNAKE, which is what the game writes its layout tables
 * in. A looser rule matches a bare `34` as readily as a name, and would then hunt for
 * a `const 34` and report a missing declaration where the value was sitting in hand.
 */
const IDENT_VALUE = /^[A-Z][A-Z0-9_]*$/;

/** Prose that belongs in the file rather than only in this script. */
const NOTES = [
  "Crafting stations are deliberately NOT here. world.stations is published and carries the game's own placements with their zone ids, so a copy would be a second table to keep in step with nothing gained.",
  'A poi id is FROZEN game content: the exploration deed marks key on it as poi:<zoneId>:<poiId>. A poi label is display-only and the game re-words them freely, which is why the_statuary_walk is labelled The Parterre Walk and the_rose_wilds is labelled Dawnhold Castle.',
  "A town flag marks the poi that stands on its zone's own hub. The game authors the hub separately, with a name and a radius; every zone's hub name is also a poi label, so the flag carries the fact without a duplicate row.",
  'Most mailboxes have no id and no name in the game: MAILBOXES is a bare list of points, and only the two towns with their own layout name theirs (mailbox_eastbrook and mailbox_fenbridge). Every id and every label here is derived from the hub of the zone the point falls in, which is the one rule that covers all fourteen and which agrees with the game on both of the named ones. The game also nudges a mailbox clear of buildings at spawn (findSafePos), so a point here is where it was authored rather than exactly where it stands.',
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
 * The balanced block starting at `from`, both delimiters included.
 *
 * Strings and line comments are skipped rather than counted, because a label or an
 * authored welcome line may hold either delimiter and a naive count would stop in
 * the middle of the table.
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
 * The value text of a top-level `name: value,` line inside a block, or null.
 *
 * The trailing comment is cut before the trailing comma, and it has to be: one zone
 * carries `zMax: 1440, // the northern 180yd is open ocean`, and a comment left on
 * the end swallows the closing parenthesis of the expression this value goes into.
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
 * Where a named declaration's literal actually opens.
 *
 * It searches for `= [` rather than for the first bracket, and it has to: every one
 * of these tables is typed `GraveyardDef[] = [`, so the first `[` after the name is
 * the one in the TYPE and a block read from there is the empty pair `[]`. That reads
 * as a table with nothing in it rather than as a failure, which is the quiet kind.
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
 * Evaluate a pure object or array literal out of the checkout.
 *
 * `new Function` rather than a JSON transform, because these are JavaScript
 * literals with trailing commas, comments and single quotes in them, and a
 * transform that handled all three would be a parser. It is deliberately narrow:
 * anything referring to an identifier throws here, which is the loud failure a
 * content release restructuring a table should produce.
 */
function literal(text, what) {
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
 * A zone's hub, which is where its town stands and what names it.
 *
 * The block form is tried first because a hub whose point comes out of a town layout
 * is written over four lines, and `propText` would hand back the opening brace alone.
 */
function hubOf(block, ident, layouts) {
  const text = propBlock(block, 'hub', '{', '}') ?? propText(block, 'hub');
  if (text === null) {
    throw new Error(`${ident} no longer declares a hub`);
  }
  return literal(withLayoutValues(text.replace(HUB_RADIUS, ''), layouts), `${ident} hub`);
}

/** One point of interest, with the town flag present only when it is true. */
function poiOf(poi, hub) {
  const built = { id: poi.id, label: poi.label, x: poi.x, z: poi.z };
  if (poi.label === hub.name) {
    built.town = true;
  }
  return built;
}

/**
 * One zone.
 *
 * `xMin` and `xMax` are emitted ONLY where the game declares them, because their
 * absence is the fact: a zone without them is the full-width strip rather than a
 * zone with no width, and flattening that away is what would put a player standing
 * on Farshore Isle into Eastbrook Vale.
 */
function zoneOf(root, module, ident) {
  const block = blockAt(
    module.text,
    openerAt(module.text, `export const ${ident}: ZoneDef`, '{'),
    '{',
    '}',
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
 * Every `<NAME>_LAYOUT` a content module imports, mapped to the text declaring it.
 *
 * Read from the module's OWN imports rather than from a list here, so a town moved
 * into a layout file this script has never heard of resolves on the first run.
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
 * A key read out of a block the game wrote on ONE line, e.g. `{ x: 0, z: 300 }`.
 *
 * `propText` is line-oriented, so a point authored inline hands it no line beginning
 * `x: ` and it reports the key as gone. A layout writes both forms freely.
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
 * Every layout reference in a table or a hub, replaced by the value it reads.
 *
 * The spreads go first, because a spread's own text is a read with three dots in
 * front of it and resolving the read half would leave those dots on a property list.
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

function readGraveyards(root, modules) {
  const module = moduleNamed(modules, 'graveyards.ts');
  const opener = openerAt(module.text, 'export const OVERWORLD_GRAVEYARDS', '[');
  const block = blockAt(module.text, opener, '[', ']');
  const resolved = withLayoutValues(block, layoutsFor(root, module));
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
 * The mailboxes, each named for the town it stands in.
 *
 * The game gives a mailbox neither an id nor a name, so both come from the hub of
 * the zone the point falls in. There is exactly one hub per zone and one mailbox per
 * town, which is what makes that a derivation rather than a guess.
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
    return { id: `mailbox_${label.toLowerCase()}`, label, x: box.x, z: box.z };
  });
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
 * An array, inline when it is all scalars and the line has room.
 *
 * That one rule is the whole reason this file is not `JSON.stringify(_, null, 2)`.
 * Biome PRESERVES an object the author expanded but does not preserve an array: it
 * collapses one whose elements fit, so a stringified `"levelRange": [\n 1,\n 7\n]`
 * fails `pnpm lint` on formatting. Emitting what the formatter would emit is what
 * keeps a generated file inside the same gate as everything else.
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
