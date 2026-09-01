// Regenerates addons/tocsin/bosses.json from a World of ClaudeCraft checkout.
//
//   node addons/tocsin/generate.mjs --game=/path/to/world-of-claudecraft
//   node addons/tocsin/generate.mjs --game /path/to/world-of-claudecraft
//
// The checkout is REQUIRED and never defaulted: nothing tells you a stale working tree is
// stale the way a 404 tells you an endpoint moved. Both argument forms are accepted because
// they have drifted across this tree, and the wrong one trips the required-argument error,
// which reads as a missing flag rather than a wrong one.
//
// TWO READING MODES. Anything the game EXPORTS is evaluated through vite's SSR loader;
// anything module-PRIVATE is parsed as text, because SSR loading a module yields its exports
// and none of its private numbers. Text reading is the weaker mechanism, so it is made loud:
// every name is declared, an absent name is a hard failure, and there is no fallback value.
//
// A CONSTANT THAT IS STILL EXPORTED IS NOT THEREBY STILL USED: at game 0.41.0
// `IGNIVAR_SOAK_AURA_ID` is still exported and passed to `applyAura` nowhere, and resolving it
// would ship a soak row that can never fire. So nothing here is emitted off a declaration
// alone: `liveSitesIn` requires an aura id in an `id:` position, a cast assigned to
// `castingAbility` and a damage label passed to a damage entry point, and every clock is parsed
// out of the assignment that WRITES it.
//
// YELLS ARE READ FOR THE RAID BOSSES AND NOT FOR NYTHRAXIS: a yell is the only exact PULL edge
// the wire carries, and every Nythraxis mechanic is observable from a cast, an aura or an
// entity appearing. A yell is range-gated (`emitMobYell` drops anyone past `YELL_RANGE`), so
// it is an anchor with a backstop rather than a source of truth.
//
// HEROIC IS NOT SHIPPED: at game 0.41.0 the forge-lift is absent from HEROIC_DUNGEON_IDS, so
// a raid always resolves to normal. Heroic tuning is not read and no heroic-only mechanic is
// declared.
//
// THE OUTPUT MUST SURVIVE BIOME, which is a constraint on its SHAPE. `JSON.stringify` always
// expands an array; Biome collapses one of primitives that fits the line and leaves one of
// OBJECTS expanded. A bare `["a", "b"]` here therefore fails lint and `pnpm fix` rewrites it
// into a form the next run undoes, a loop with no resting state. Every list is a list of
// objects that say what they are. Check with: generate, `pnpm fix`, generate, compare.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { createServer } from 'vite';

/** What the checkout's own package.json has to call itself to be the game. */
const GAME_PACKAGE_NAME = 'world-of-claudecraft';

const OUT_FILE = 'bosses.json';

const NONE = 0;
const ONE = 1;
const INDENT = 2;
const PERCENT = 100;

const MODULES = {
  data: '/src/sim/data.ts',
  dungeons: '/src/sim/content/dungeons.ts',
  types: '/src/sim/types.ts',
  healer: '/src/sim/mob/healer_channel.ts',
  ignivar: '/src/sim/encounters/ignivar.ts',
  ignivarArena: '/src/sim/ignivar_arena.ts',
  ignivarMeteors: '/src/sim/ignivar_meteors.ts',
  ignivarForgeWave: '/src/sim/ignivar_forge_wave.ts',
  ignivarJudgment: '/src/sim/ignivar_forge_judgment.ts',
  ignivarDialogue: '/src/sim/encounters/ignivar_dialogue.ts',
  raidIds: '/src/sim/ignivar_raid_ids.ts',
  varkhul: '/src/sim/encounters/varkhul.ts',
  varkhulPyre: '/src/sim/varkhul_shared_pyre.ts',
  varkhulArtificer: '/src/sim/varkhul_cinder_artificer.ts',
  varkhulIntermission: '/src/sim/varkhul_forge_intermission.ts',
  varkhulDialogue: '/src/sim/encounters/varkhul_dialogue.ts',
};

const SOURCES = {
  nythraxis: 'src/sim/encounters/nythraxis.ts',
  ignivar: 'src/sim/encounters/ignivar.ts',
  varkhul: 'src/sim/encounters/varkhul.ts',
};

const SOURCE_NOTE =
  'src/sim/data.ts, src/sim/content/dungeons.ts, src/sim/types.ts, ' +
  'src/sim/mob/healer_channel.ts, src/sim/encounters/nythraxis.ts, ' +
  'src/sim/encounters/ignivar.ts, src/sim/encounters/varkhul.ts, ' +
  'src/sim/ignivar_arena.ts, src/sim/ignivar_meteors.ts, src/sim/ignivar_forge_wave.ts, ' +
  'src/sim/ignivar_forge_judgment.ts, src/sim/ignivar_raid_ids.ts, ' +
  'src/sim/varkhul_shared_pyre.ts, src/sim/varkhul_cinder_artificer.ts, ' +
  'src/sim/varkhul_forge_intermission.ts, src/sim/encounters/*_dialogue.ts';

/** `const NAME = value;` on one line, exported or not, which is how tuning is authored. */
const CONST_LINE = /^(?:export )?const ([A-Z][A-Z0-9_]*) = ([^;]+);$/gm;
/** The heroic court's template ids, authored as a multi-line `as const` array. */
const HEROIC_IDS_BLOCK = /const NYTHRAXIS_HEROIC_ADD_IDS = \[([^\]]+)\] as const;/;
/** One quoted id inside that block. */
const QUOTED_ID = /'([a-z0-9_]+)'/g;
/** `st.<name>Timer = <expr>;`, which is how a phase change re-seeds a clock. */
const TIMER_ASSIGNED = /st\.(\w+Timer) = ([^;]+);/g;
/** `<name>Timer: <expr>,`, which is how an encounter's own initialiser starts one. */
const TIMER_INITIALISED = /(\w+Timer): ([^,\n]+),/g;
/** `Math.min(st.xTimer, <expr>)` and its max, which is a FLOOR or a CAP rather than a set. */
const TIMER_BOUNDED = /^Math\.(min|max)\(st\.\w+Timer, ([^)]+)\)$/;
/** Any run of whitespace, since the game's formatter wraps a long call across lines. */
const SPAN = /\s+/g;
const DANGLING_COMMA = /,\s*\)/g;
const OPEN_BREAK = /\(\s+/g;
const WIPE_CALL = /(?:resolveEncounterWipe|wipeEncounter)\(([^;]*?)\);/g;
/** `id: X,` inside an effect literal, which is where an aura id is USED rather than declared. */
const AURA_ID_USE = /\bid: ([A-Z_][A-Z0-9_]*|'[^']*'),/g;
/** `<something>.castingAbility = X;`, which is the only way a mob puts a bar on screen. */
const CAST_USE = /castingAbility = ([A-Z_][A-Z0-9_]*|'[^']*'|"[^"]*");/g;
const DAMAGE_CALL = /\b(?:dealDamage|dealFractionalDamage)\(([\s\S]*?)\);/g;
const TOKEN = /[A-Z_][A-Z0-9_]*|'[^']*'|"[^"]*"/g;

const BOUND_MODES = { min: 'cap', max: 'floor' };

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
 * Prove the path really is the game before loading a module out of it.
 *
 * The package NAME rather than the presence of a directory: a wrong path that happens to
 * hold a `src` reads as plausible until the module graph fails, and a resolution failure
 * reads as the game having moved something.
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

/**
 * The game's own modules, through its own module graph.
 *
 * `configFile: false` on purpose: the game's vite config is about building the game, and
 * running its plugin chain to read a handful of modules would tie this script to a build
 * pipeline it has no business knowing about.
 */
async function loadModules(root) {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  const loaded = {};
  try {
    const names = Object.keys(MODULES);
    const values = await Promise.all(names.map((name) => server.ssrLoadModule(MODULES[name])));
    names.forEach((name, index) => {
      loaded[name] = values[index];
    });
  } catch (err) {
    return fail(`could not load the game's modules from ${root}: ${String(err)}`);
  } finally {
    await server.close();
  }
  return loaded;
}

function constantsIn(source, where) {
  const found = new Map();
  CONST_LINE.lastIndex = NONE;
  let match = CONST_LINE.exec(source);
  while (match !== null) {
    found.set(match[ONE], match[INDENT].trim());
    match = CONST_LINE.exec(source);
  }
  if (found.size === NONE) {
    fail(`${where} yielded no constants at all: the read stopped working`);
  }
  return found;
}

/** No default, so a rename stops the run naming what lost it. */
function privateNumber(constants, name, where) {
  const raw = constants.get(name);
  if (raw === undefined) {
    return fail(`${where} no longer declares ${name}`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return fail(`${name} in ${where} is "${raw}", which is not a plain number`);
  }
  return value;
}

function exported(module, name, where) {
  const value = module[name];
  if (typeof value !== 'string' && typeof value !== 'number') {
    return fail(`${where} no longer exports ${name}`);
  }
  return value;
}

/** One top-level function, up to the first line that closes at column zero. */
function functionBody(source, name, where) {
  const head = Math.max(
    source.indexOf(`export function ${name}(`),
    source.indexOf(`\nfunction ${name}(`),
  );
  if (head < NONE) {
    return fail(`${where} has no ${name}, which is where a clock is seeded`);
  }
  const end = source.indexOf('\n}', head);
  if (end < NONE) {
    return fail(`${name} in ${where} does not close: the read stopped working`);
  }
  return source.slice(head, end);
}

/** A number, a constant, or a sum of them. Anything else is a stop rather than a guess. */
function seedValue(expr, constants, where) {
  let total = NONE;
  for (const term of expr.split('+')) {
    const one = term.trim();
    const literal = Number(one);
    const named = constants.get(one);
    if (Number.isFinite(literal) && one !== '') {
      total += literal;
    } else if (named !== undefined && Number.isFinite(Number(named))) {
      total += Number(named);
    } else {
      return fail(`${where} is "${expr.trim()}", which this cannot resolve to a number of seconds`);
    }
  }
  return total;
}

/**
 * `Math.max(st.xTimer, n)` is a FLOOR and `Math.min` a CAP: the game is bounding a clock it is
 * still running, and setting it outright would move a prediction the game did not move.
 */
function seedFrom(id, expr, constants, where) {
  // Flattened first: the game's formatter wraps a long assignment across lines, and unflattened
  // the shape check reports a rename that did not happen.
  const flat = expr
    .replaceAll(SPAN, ' ')
    .replaceAll(DANGLING_COMMA, ')')
    .replaceAll(OPEN_BREAK, '(')
    .trim();
  const bounded = TIMER_BOUNDED.exec(flat);
  if (bounded === null) {
    return { id, seconds: seedValue(flat, constants, where) };
  }
  return {
    id,
    seconds: seedValue(bounded[INDENT], constants, where),
    mode: BOUND_MODES[bounded[ONE]],
  };
}

/** A list rather than a map, for the Biome constraint in the header. */
function seedsFrom(source, constants, spec) {
  const body = functionBody(source, spec.fn, spec.where);
  const found = [];
  const seen = new Set();
  spec.pattern.lastIndex = NONE;
  let match = spec.pattern.exec(body);
  while (match !== null) {
    const id = spec.fields[match[ONE]];
    if (id !== undefined && !seen.has(id)) {
      seen.add(id);
      found.push(seedFrom(id, match[INDENT], constants, `${spec.fn}'s ${match[ONE]}`));
    }
    match = spec.pattern.exec(body);
  }
  if (found.length === NONE) {
    fail(`${spec.fn} seeds no clock this addon knows: the fields have been renamed`);
  }
  return found;
}

/** Modules go LAST so an evaluated value (`WARNING + ACTIVE`) wins over its declaration text. */
function resolvableIn(source, where, modules) {
  const found = constantsIn(source, where);
  for (const module of modules) {
    for (const [name, value] of Object.entries(module)) {
      if (typeof value === 'string') {
        found.set(name, `'${value}'`);
      }
      if (typeof value === 'number') {
        found.set(name, String(value));
      }
    }
  }
  return found;
}

function literalOf(token, constants) {
  const quoted = token.startsWith("'") || token.startsWith('"');
  if (quoted) {
    return token.slice(ONE, -ONE);
  }
  const named = constants.get(token);
  if (named === undefined || !named.startsWith("'")) {
    return null;
  }
  return named.slice(ONE, -ONE);
}

function usedValues(source, pattern, constants) {
  const found = new Set();
  pattern.lastIndex = NONE;
  let match = pattern.exec(source);
  while (match !== null) {
    for (const token of match[ONE].match(TOKEN) ?? []) {
      const value = literalOf(token, constants);
      if (value !== null) {
        found.add(value);
      }
    }
    match = pattern.exec(source);
  }
  return found;
}

/** What an encounter DOES, so a row is checked against a live site and not an export (see the header). */
function liveSitesIn(source, where, constants) {
  return {
    auras: usedValues(source, AURA_ID_USE, constants),
    casts: usedValues(source, CAST_USE, constants),
    damage: usedValues(source, DAMAGE_CALL, constants),
    where,
  };
}

const SITE_SHAPES = {
  auras: 'applied as an aura',
  casts: 'put on a cast bar',
  damage: 'dealt as damage',
};

/** A hard stop rather than a warning: the row it would have written can never fire. */
function requireUse(sites, shape, values) {
  for (const value of values) {
    if (!sites[shape].has(value)) {
      fail(
        `'${value}' is no longer ${SITE_SHAPES[shape]} anywhere in ${sites.where}: ` +
          'it is an export this can still read and a mechanic that can never fire',
      );
    }
  }
}

function checkIds(source, ids, label, where) {
  for (const [key, id] of Object.entries(ids)) {
    if (!(source.includes(`'${id}'`) || source.includes(`"${id}"`))) {
      fail(`${where} no longer mentions '${id}' (${label}.${key}): it has been renamed`);
    }
  }
}

function template(mobs, id) {
  const found = mobs[id];
  if (typeof found !== 'object' || found === null) {
    return fail(`MOBS has no ${id}: this encounter's roster has changed`);
  }
  return found;
}

function dungeon(dungeons, id) {
  const found = dungeons.DUNGEON_DEFS?.[id];
  if (typeof found !== 'object' || found === null) {
    return fail(`DUNGEON_DEFS has no ${id}: the arena this addon reads has moved`);
  }
  return found;
}

function bossSpawn(def, bossId, arenaId) {
  const spawn = (def.spawns ?? []).find((one) => one.mobId === bossId);
  if (spawn === undefined) {
    return fail(`${arenaId} no longer spawns ${bossId}`);
  }
  return { x: spawn.x, z: spawn.z };
}

/** The table's condition vocabulary, evaluated by the addon against the BOSS. */
function whenAura(id) {
  return { kind: 'aura', id };
}

function whenCast(id) {
  return { kind: 'cast', id };
}

function whenHazard(id) {
  return { kind: 'hazard', id };
}

function whenBelowHp(hp) {
  return { kind: 'belowHp', hp };
}

/**
 * The table's anchor vocabulary: an EDGE the addon watches to re-arm a cadence. A `cast`
 * anchor also makes the mechanic draw the game's own remaining time while that cast runs.
 */
function onCast(id) {
  return { kind: 'cast', id };
}

function onDamage(id) {
  return { kind: 'damage', id };
}

function onSpawn(id) {
  return { kind: 'spawn', id };
}

function onPartyAura(name) {
  return { kind: 'partyAura', id: name };
}

function onHazard(kind) {
  return { kind: 'hazard', id: kind };
}

function onBoss(condition) {
  return { kind: 'boss', when: condition };
}

const NYTHRAXIS_ARENA_ID = 'nythraxis_boss_arena';
const NYTHRAXIS_ID = 'nythraxis';
/** Gravebreaker's authored half arc, and what it is in degrees. */
const HALF_ARC_SOURCE = 'Math.PI / 3';
const HALF_ARC_DEGREES = 60;

/**
 * Every seed is READ from the source rather than derived from a cadence, because the two
 * disagree and nothing says so: phase two starts Gravebreaker at 3 where its cadence is 12,
 * and the deathless seed is the settle delay plus a bare 15 that is not the lockout constant
 * it happens to equal.
 */
const NYTHRAXIS_TIMER_FIELDS = {
  gravebreakerTimer: 'gravebreaker',
  raiseFallenTimer: 'raise-fallen',
  soulRendTimer: 'soul-rend',
  deathlessTimer: 'deathless',
};

const NYTHRAXIS_NUMBERS = {
  gravebreakerEvery: 'NYTHRAXIS_GRAVEBREAKER_EVERY',
  gravebreakerRange: 'NYTHRAXIS_GRAVEBREAKER_RANGE',
  gravebreakerSplashMult: 'NYTHRAXIS_GRAVEBREAKER_SPLASH_MULT',
  raiseFallenEvery: 'NYTHRAXIS_RAISE_FALLEN_EVERY',
  phaseTwoHp: 'NYTHRAXIS_PHASE_TWO_HP',
  finalStandHp: 'NYTHRAXIS_FINAL_STAND_HP',
  transitionSeconds: 'NYTHRAXIS_TRANSITION_DURATION',
  phaseTwoSettle: 'NYTHRAXIS_PHASE_TWO_SETTLE_DELAY',
  soulRendEvery: 'NYTHRAXIS_SOUL_REND_EVERY',
  soulRendDuration: 'NYTHRAXIS_SOUL_REND_DURATION',
  soulRendStackRange: 'NYTHRAXIS_SOUL_REND_STACK_RANGE',
  soulRendMarks: 'NYTHRAXIS_SOUL_REND_MARKS',
  soulRendMarksHeroic: 'NYTHRAXIS_SOUL_REND_MARKS_HEROIC',
  soulRendHeroicMult: 'NYTHRAXIS_SOUL_REND_HEROIC_MULT',
  deathlessEvery: 'NYTHRAXIS_DEATHLESS_EVERY',
  deathlessCast: 'NYTHRAXIS_DEATHLESS_CAST',
  deathlessChannel: 'NYTHRAXIS_DEATHLESS_CHANNEL',
  deathlessStun: 'NYTHRAXIS_DEATHLESS_STUN',
  deathlessPct: 'NYTHRAXIS_DEATHLESS_PCT',
  deathlessPctHeroic: 'NYTHRAXIS_DEATHLESS_PCT_HEROIC',
  deathlessSoulRendLockout: 'NYTHRAXIS_DEATHLESS_SOUL_REND_LOCKOUT',
  heroicSummonChannel: 'NYTHRAXIS_HEROIC_SUMMON_CHANNEL',
  dreadCurseEvery: 'NYTHRAXIS_DREAD_CURSE_EVERY',
  dreadCurseDuration: 'NYTHRAXIS_DREAD_CURSE_DURATION',
  dreadCursePerStack: 'NYTHRAXIS_DREAD_CURSE_PER_STACK',
  dreadCurseMaxStacks: 'NYTHRAXIS_DREAD_CURSE_MAX_STACKS',
};

/** Declared rather than read: these are string literals no export reaches. */
const NYTHRAXIS_AURA_IDS = {
  transitionPause: 'nythraxis_transition_pause',
  transitionStun: 'nythraxis_transition_stun',
  deathlessStun: 'nythraxis_deathless_stun',
  wardstoneLit: 'nythraxis_wardstone_lit',
  soulRend: 'nythraxis_soul_rend',
  dreadCurse: 'nythraxis_dread_curse',
  finalStand: 'nythraxis_final_stand',
};

/**
 * Declared for the same reason the ids are, and checked the same way: an aura's display name
 * is a string literal in an `applyAura` call that no export reaches. Only the ones an addon
 * SHOWS are here, since a name nothing draws is a name nothing can get wrong.
 */
const NYTHRAXIS_AURA_NAMES = {
  finalStand: 'Final Stand',
};

/**
 * `spiritMending` is checked against its own export rather than against the encounter source,
 * because the heal is driven by the generic `channelHeal` mob mechanic and its id lives with
 * that mechanic. That is the stronger of the two checks, which is why it is separate.
 */
const NYTHRAXIS_CAST_IDS = {
  deathlessRage: 'nythraxis_deathless_rage',
  wardChannel: 'nythraxis_ward_channel',
  heroicSummon: 'nythraxis_heroic_summon',
  spiritMending: 'nythraxis_spirit_mending',
};

/** Which of those the encounter source itself owns, and can therefore be found in it. */
const NYTHRAXIS_OWNED_CASTS = ['deathlessRage', 'wardChannel', 'heroicSummon'];

/**
 * The one editorial line in the Nythraxis arm, hand-declared because no field carries it:
 * `ccImmune: false` says an add CAN be controlled and says nothing about a capped heal being
 * impossible to out-damage. The kit numbers beside it are read, so a retune leaves this alone.
 */
const NYTHRAXIS_ANSWERS = new Map([
  ['nythraxis_heroic_warrior_add', 'tank'],
  ['nythraxis_heroic_priest_add', 'interrupt'],
  ['nythraxis_heroic_rogue_add', 'control'],
]);

/** The answers, hardest first: the addon draws and ranks by these words. */
const ANSWER_ORDER = ['interrupt', 'control', 'tank', 'kill'];

function nythraxisTuning(constants) {
  const out = {};
  for (const [key, name] of Object.entries(NYTHRAXIS_NUMBERS)) {
    out[key] = privateNumber(constants, name, SOURCES.nythraxis);
  }
  const arc = constants.get('NYTHRAXIS_GRAVEBREAKER_HALF_ARC');
  if (arc !== HALF_ARC_SOURCE) {
    return fail(
      `NYTHRAXIS_GRAVEBREAKER_HALF_ARC is "${String(arc)}" rather than "${HALF_ARC_SOURCE}": ` +
        'the cone has changed shape and this conversion no longer describes it',
    );
  }
  out.gravebreakerHalfArcDeg = HALF_ARC_DEGREES;
  return out;
}

/**
 * The three wardstones, in the game's own authored order and carrying its own names.
 *
 * The NAME is the whole point of reading these rather than deriving a side from a bearing:
 * "Left" and "Right" are what a player reads when they target one, and a client-derived
 * side flips with the camera. A rename in the game therefore rewrites this table.
 */
function wardstones(def, itemId) {
  const found = (def.objects ?? []).filter((one) => one.itemId === itemId);
  if (found.length === NONE) {
    return fail(`${NYTHRAXIS_ARENA_ID} holds no ${itemId} objects: the wardstones have moved`);
  }
  return found.map((one) => ({ name: one.name, x: one.x, z: one.z }));
}

function nythraxisMechanics(t, waveAddId) {
  return [
    {
      id: 'gravebreaker',
      label: 'Gravebreaker',
      every: t.gravebreakerEvery,
      detail: `${String(t.gravebreakerRange)}yd frontal cone`,
      phase: 'both',
      // The cadence ARMS a swing rather than firing: once due it waits for one to land.
      charge: true,
      anchor: [onDamage('Gravebreaker')],
    },
    {
      id: 'raise-fallen',
      label: 'Raise Fallen',
      every: t.raiseFallenEvery,
      detail: 'no crowd control, kill them',
      phase: 'one',
      anchor: [onSpawn(waveAddId)],
    },
    {
      id: 'soul-rend',
      label: 'Soul Rend',
      every: t.soulRendEvery,
      detail: 'marks stack up',
      phase: 'two',
      anchor: [onDamage('Soul Rend')],
    },
    {
      id: 'deathless',
      label: 'Deathless Rage',
      every: t.deathlessEvery,
      detail: 'three wardstones, three different players',
      phase: 'two',
      // STARTING the cast is the only edge to watch: a Rage the raid answers deals no damage.
      anchor: [onCast(NYTHRAXIS_CAST_IDS.deathlessRage)],
      lethal: true,
    },
  ];
}

function nythraxisChannelsBlock(t, deps) {
  const itemId = deps.wardItemId;
  return {
    kind: 'channels',
    label: 'Wardstones',
    duringCast: NYTHRAXIS_CAST_IDS.deathlessRage,
    castSeconds: t.deathlessCast,
    channelCast: NYTHRAXIS_CAST_IDS.wardChannel,
    channelSeconds: t.deathlessChannel,
    objectTemplateId: `ground_${itemId}`,
    // The game's own interact range plus a yard, which is the check it makes itself.
    reach: deps.interactRange + ONE,
    distinct: true,
    objects: wardstones(deps.def, itemId),
  };
}

function nythraxisCourtKit(found) {
  const kit = {};
  if (found.cleave) {
    kit.cleaveRadius = found.cleave.radius;
    kit.cleaveName = found.cleave.name;
  }
  if (found.channelHeal) {
    kit.healEvery = found.channelHeal.every;
    kit.healRadius = found.channelHeal.radius;
    kit.healMax = found.channelHeal.maxHeal;
    kit.healName = found.channelHeal.name;
    // The cast the heal renders as, which is the only notice a quietMechanics add gives.
    kit.interruptCast = NYTHRAXIS_CAST_IDS.spiritMending;
  }
  if (found.ignoreTaunt === true) {
    kit.ignoreTaunt = true;
  }
  return kit;
}

function nythraxisCourt(mobs, ids) {
  return ids.map((id) => {
    const found = template(mobs, id);
    const answer = NYTHRAXIS_ANSWERS.get(id);
    if (answer === undefined) {
      return fail(`${id} is in the heroic court and this file says nothing about answering it`);
    }
    return {
      templateId: id,
      name: found.name,
      ccImmune: found.ccImmune === true,
      quietMechanics: found.quietMechanics === true,
      answer,
      ...nythraxisCourtKit(found),
      heroicTell: true,
    };
  });
}

function nythraxisHeroicIds(source) {
  const block = HEROIC_IDS_BLOCK.exec(source);
  if (block === null) {
    return fail(`${SOURCES.nythraxis} has no NYTHRAXIS_HEROIC_ADD_IDS array to read`);
  }
  const ids = [...block[ONE].matchAll(QUOTED_ID)].map((one) => one[ONE]);
  if (ids.length === NONE) {
    return fail('NYTHRAXIS_HEROIC_ADD_IDS parsed to no ids at all');
  }
  return ids;
}

function nythraxisAddsBlock(deps) {
  const court = nythraxisCourt(deps.mobs, nythraxisHeroicIds(deps.source));
  const ranked = [...court].sort(
    (a, b) => ANSWER_ORDER.indexOf(a.answer) - ANSWER_ORDER.indexOf(b.answer),
  );
  const wave = template(deps.mobs, deps.waveAddId);
  return {
    kind: 'adds',
    label: 'Adds',
    rows: [
      ...ranked,
      {
        templateId: deps.waveAddId,
        name: wave.name,
        ccImmune: wave.ccImmune === true,
        answer: 'kill',
        note: 'no crowd control, kill it',
      },
    ],
  };
}

function nythraxisBlocks(t, deps) {
  return [
    nythraxisChannelsBlock(t, deps),
    {
      kind: 'marks',
      label: 'Soul Rend',
      aura: NYTHRAXIS_AURA_IDS.soulRend,
      durationSeconds: t.soulRendDuration,
      stackRange: t.soulRendStackRange,
      count: t.soulRendMarks,
      countHeroic: t.soulRendMarksHeroic,
      heroicMult: t.soulRendHeroicMult,
    },
    {
      // The last stretch of the fight, and the one state on this boss that is not a mechanic
      // to answer: nothing is done about it except to know it is coming.
      kind: 'enrage',
      // The heading names the SHAPE and the row names the aura, the way the adds block heads
      // 'Adds' over each add's own name. One row is still a row.
      label: 'Enrage',
      name: NYTHRAXIS_AURA_NAMES.finalStand,
      aura: NYTHRAXIS_AURA_IDS.finalStand,
      hp: t.finalStandHp,
    },
    {
      kind: 'tankStacks',
      label: 'Tank',
      aura: NYTHRAXIS_AURA_IDS.dreadCurse,
      perStack: t.dreadCursePerStack,
      maxStacks: t.dreadCurseMaxStacks,
      // Its presence is itself the heroic tell: the boss applies it on no other difficulty.
      heroicOnly: true,
    },
    nythraxisAddsBlock(deps),
  ];
}

function nythraxisRow(deps) {
  const { source, mobs, types } = deps;
  const bossId = exported(types, 'NYTHRAXIS_BOSS_ID', MODULES.types);
  const constants = constantsIn(source, SOURCES.nythraxis);
  const wardItemId = constants.get('NYTHRAXIS_WARDSTONE_ITEM_ID')?.replaceAll("'", '');
  if (wardItemId === undefined) {
    return fail(`${SOURCES.nythraxis} has no NYTHRAXIS_WARDSTONE_ITEM_ID`);
  }
  checkIds(source, NYTHRAXIS_AURA_IDS, 'auras', SOURCES.nythraxis);
  checkIds(source, NYTHRAXIS_AURA_NAMES, 'aura names', SOURCES.nythraxis);
  const owned = Object.fromEntries(NYTHRAXIS_OWNED_CASTS.map((k) => [k, NYTHRAXIS_CAST_IDS[k]]));
  checkIds(source, owned, 'casts', SOURCES.nythraxis);
  const t = nythraxisTuning(constants);
  const inner = {
    ...deps,
    def: dungeon(deps.dungeons, NYTHRAXIS_ARENA_ID),
    wardItemId,
    interactRange: exported(types, 'INTERACT_RANGE', MODULES.types),
    waveAddId: exported(types, 'NYTHRAXIS_ADD_ID', MODULES.types),
  };
  return {
    id: NYTHRAXIS_ID,
    templateId: bossId,
    name: template(mobs, bossId).name,
    arenaId: NYTHRAXIS_ARENA_ID,
    bossSpawn: bossSpawn(inner.def, bossId, NYTHRAXIS_ARENA_ID),
    phases: {
      transitionAura: NYTHRAXIS_AURA_IDS.transitionPause,
      phaseTwoHp: t.phaseTwoHp,
      seeds: seedsFrom(source, constants, {
        fn: 'updateNythraxisTransition',
        pattern: TIMER_ASSIGNED,
        fields: NYTHRAXIS_TIMER_FIELDS,
        where: SOURCES.nythraxis,
      }),
    },
    // What every clock starts at when the fight opens, which is the game's own initialiser
    // rather than each mechanic's cadence: they agree today and nothing holds them together.
    pullSeeds: seedsFrom(source, constants, {
      fn: 'initNythraxisEncounter',
      pattern: TIMER_INITIALISED,
      fields: NYTHRAXIS_TIMER_FIELDS,
      where: SOURCES.nythraxis,
    }),
    // What stops every clock at once, as one list of conditions rather than two parallel
    // arrays: each returns early from the game's own per-tick driver, and each says whether
    // it is an aura the boss wears or a cast it is in the middle of.
    freeze: [
      whenAura(NYTHRAXIS_AURA_IDS.deathlessStun),
      whenAura(NYTHRAXIS_AURA_IDS.transitionPause),
      whenCast(NYTHRAXIS_CAST_IDS.deathlessRage),
      whenCast(NYTHRAXIS_CAST_IDS.heroicSummon),
    ],
    mechanics: nythraxisMechanics(t, inner.waveAddId),
    blocks: nythraxisBlocks(t, inner),
  };
}

/** A disagreement is a hard stop rather than a silent pick. */
function checkMendingId(healer) {
  const owned = exported(healer, 'NYTHRAXIS_SPIRIT_MENDING_CAST_ID', MODULES.healer);
  if (owned !== NYTHRAXIS_CAST_IDS.spiritMending) {
    fail(`the scripted heal cast is '${String(owned)}', not '${NYTHRAXIS_CAST_IDS.spiritMending}'`);
  }
}

const IGNIVAR_ID = 'ignivar';

const IGNIVAR_TIMER_FIELDS = {
  brandTimer: 'brand',
  forgeStrikeTimer: 'forge-strike',
  frontalTimer: 'searing',
  skyfireTimer: 'skyfire',
  meteorTimer: 'meteors',
  rotatingRaysTimer: 'rays',
  forgeWaveTimer: 'forge-wave',
  finalFrontalTimer: 'last-flame',
};

function ignivarTuning(mods) {
  const read = (module, name) => exported(mods[module], name, MODULES[module]);
  return {
    brandEvery: read('ignivar', 'IGNIVAR_BRAND_EVERY'),
    brandEveryLate: read('ignivar', 'IGNIVAR_BRAND_EVERY_LATE'),
    brandEveryFinal: read('ignivar', 'IGNIVAR_BRAND_EVERY_FINAL'),
    brandRadius: read('ignivar', 'IGNIVAR_BRAND_RADIUS'),
    brandTargets: read('ignivar', 'IGNIVAR_BRAND_TARGETS_NORMAL'),
    brandTick: read('ignivar', 'IGNIVAR_BRAND_TICK_SECONDS'),
    forgeStrikeEvery: read('ignivar', 'IGNIVAR_FORGE_STRIKE_EVERY'),
    moltenPerStack: read('ignivar', 'IGNIVAR_MOLTEN_ARMOR_PER_STACK'),
    moltenMaxStacks: read('ignivar', 'IGNIVAR_MOLTEN_ARMOR_MAX_STACKS'),
    frontalEvery: read('ignivar', 'IGNIVAR_FRONTAL_EVERY'),
    frontalCast: read('ignivar', 'IGNIVAR_FRONTAL_CAST_SECONDS'),
    frontalRange: read('ignivarArena', 'IGNIVAR_FRONTAL_RANGE'),
    skyfireEvery: read('ignivar', 'IGNIVAR_SKYFIRE_EVERY'),
    skyfireCast: read('ignivar', 'IGNIVAR_SKYFIRE_CAST_SECONDS'),
    skyfireCones: read('ignivar', 'IGNIVAR_SKYFIRE_CONE_COUNT'),
    skyfireRange: read('ignivar', 'IGNIVAR_SKYFIRE_RANGE'),
    raysEvery: read('ignivar', 'IGNIVAR_ROTATING_RAYS_EVERY'),
    raysWindup: read('ignivar', 'IGNIVAR_ROTATING_RAYS_WINDUP_SECONDS'),
    raysActive: read('ignivar', 'IGNIVAR_ROTATING_RAYS_ACTIVE_SECONDS'),
    waveEvery: read('ignivarForgeWave', 'IGNIVAR_FORGE_WAVE_EVERY'),
    waveWindup: read('ignivarForgeWave', 'IGNIVAR_FORGE_WAVE_WINDUP_SECONDS'),
    meteorEvery: read('ignivarMeteors', 'IGNIVAR_METEOR_EVERY'),
    meteorCount: read('ignivarMeteors', 'IGNIVAR_METEOR_COUNT_NORMAL'),
    meteorTelegraph: read('ignivarMeteors', 'IGNIVAR_METEOR_TELEGRAPH_SECONDS'),
    finalFrontalEvery: read('ignivar', 'IGNIVAR_FINAL_FRONTAL_EVERY'),
    finalRaysEvery: read('ignivar', 'IGNIVAR_FINAL_ROTATING_RAYS_EVERY'),
    finalMeteorEvery: read('ignivar', 'IGNIVAR_FINAL_METEOR_EVERY'),
    apocalypseHp: read('ignivar', 'IGNIVAR_APOCALYPSE_HP_THRESHOLD'),
    apocalypseCast: read('ignivar', 'IGNIVAR_APOCALYPSE_CAST_SECONDS'),
    judgmentHp: read('ignivarJudgment', 'IGNIVAR_JUDGMENT_HP_THRESHOLD'),
    judgmentSeconds: read('ignivarJudgment', 'IGNIVAR_JUDGMENT_DURATION_SECONDS'),
    shelters: read('ignivarJudgment', 'IGNIVAR_JUDGMENT_SHELTER_COUNT'),
    lastInfernoHp: read('ignivar', 'IGNIVAR_LAST_INFERNO_HP_THRESHOLD'),
    lastInfernoSeconds: read('ignivar', 'IGNIVAR_LAST_INFERNO_SECONDS'),
    conduitActive: read('ignivar', 'IGNIVAR_CONDUIT_ACTIVE_SECONDS'),
    cleanseRadius: read('ignivar', 'IGNIVAR_WATER_CLEANSE_RADIUS'),
    majorGap: read('ignivar', 'IGNIVAR_MAJOR_ABILITY_GAP_SECONDS'),
  };
}

function ignivarIds(mods) {
  const read = (module, name) => exported(mods[module], name, MODULES[module]);
  return {
    boss: read('types', 'IGNIVAR_BOSS_ID'),
    arena: read('raidIds', 'IGNIVAR_RAID_ARENA_ID'),
    brandAura: read('ignivar', 'IGNIVAR_BRAND_AURA_ID'),
    moltenAura: read('ignivar', 'IGNIVAR_MOLTEN_ARMOR_AURA_ID'),
    lastInfernoAura: read('ignivar', 'IGNIVAR_LAST_INFERNO_AURA_ID'),
    frontalCast: read('ignivar', 'IGNIVAR_FRONTAL_CAST_ID'),
    skyfireCast: read('ignivar', 'IGNIVAR_SKYFIRE_CAST_ID'),
    raysCast: read('ignivar', 'IGNIVAR_ROTATING_RAYS_CAST_ID'),
    waveCast: read('ignivar', 'IGNIVAR_FORGE_WAVE_CAST_ID'),
    judgmentCast: read('ignivar', 'IGNIVAR_JUDGMENT_CAST_ID'),
    apocalypseCast: read('ignivar', 'IGNIVAR_APOCALYPSE_CAST_ID'),
    apocalypseAdd: read('ignivar', 'IGNIVAR_APOCALYPSE_ADD_ID'),
    forgeStrike: read('ignivar', 'IGNIVAR_FORGE_STRIKE_ID'),
    meteorCast: read('ignivarMeteors', 'IGNIVAR_METEOR_CAST_ID'),
  };
}

/**
 * The brand and the tank strike do NOT tick while any of these is in flight, and the four
 * major clocks DO, which is why the freeze is per mechanic rather than on the encounter.
 */
function ignivarMajorCasts(ids) {
  return [
    whenCast(ids.frontalCast),
    whenCast(ids.skyfireCast),
    whenCast(ids.raysCast),
    whenCast(ids.waveCast),
  ];
}

function ignivarPacedMechanics(t, ids) {
  const final = whenAura(ids.lastInfernoAura);
  return [
    {
      id: 'searing',
      label: ids.frontalCast,
      every: t.frontalEvery,
      detail: `${String(t.frontalRange)}yd cone, ${String(t.frontalCast)}s cast`,
      unless: [final],
      group: 'major',
      anchor: [onCast(ids.frontalCast)],
    },
    {
      id: 'skyfire',
      label: ids.skyfireCast,
      every: t.skyfireEvery,
      detail: `${String(t.skyfireCones)} cones out to ${String(t.skyfireRange)}yd`,
      unless: [final],
      group: 'major',
      anchor: [onCast(ids.skyfireCast)],
    },
    {
      id: 'rays',
      label: ids.raysCast,
      every: t.raysEvery,
      detail: `${String(t.raysWindup)}s windup then ${String(t.raysActive)}s of turning beams`,
      cadences: [{ when: final, every: t.finalRaysEvery }],
      group: 'major',
      anchor: [onCast(ids.raysCast)],
    },
    {
      id: 'forge-wave',
      label: ids.waveCast,
      every: t.waveEvery,
      detail: 'expanding ring with one gap in it',
      unless: [final],
      group: 'major',
      anchor: [onCast(ids.waveCast)],
    },
    {
      id: 'meteors',
      label: ids.meteorCast,
      every: t.meteorEvery,
      detail: `${String(t.meteorCount)} marked circles, ${String(t.meteorTelegraph)}s to land`,
      cadences: [{ when: final, every: t.finalMeteorEvery }],
      // No cast, and damage only on whoever failed to move, so the ground warning appearing is
      // the one edge that fires every cycle.
      anchor: [onHazard('ignivarMeteor')],
    },
    {
      // The final phase replaces four separate clocks with one alternating slot, so this is a
      // mechanic of its own rather than a cadence on either of the two casts it fires.
      id: 'last-flame',
      label: 'Searing Torrent or Rain of Cinders',
      every: t.finalFrontalEvery,
      detail: 'alternating, with no room left between them',
      when: [final],
      group: 'major',
      anchor: [onCast(ids.frontalCast), onCast(ids.skyfireCast)],
      lethal: true,
    },
  ];
}

function ignivarMechanics(t, ids) {
  const final = whenAura(ids.lastInfernoAura);
  return [
    {
      id: 'brand',
      label: 'Brand of the Pyre',
      every: t.brandEvery,
      detail: `${String(t.brandTargets)} marked, stay ${String(t.brandRadius)}yd from everyone`,
      // Order matters: the last match wins, as in the game's `ignivarBrandCadence`.
      cadences: [
        { when: whenBelowHp(t.judgmentHp), every: t.brandEveryLate },
        { when: final, every: t.brandEveryFinal },
      ],
      freeze: ignivarMajorCasts(ids),
      // Its damage label is worn by the dot tick and the proximity hit too, so damage would
      // re-arm this several times a second; the `aura` gain is the only clean edge.
      anchor: [onPartyAura('Brand of the Pyre')],
    },
    {
      id: 'forge-strike',
      label: ids.forgeStrike,
      every: t.forgeStrikeEvery,
      detail: 'tank hit, one more stack of Molten Armor',
      charge: true,
      unless: [final],
      freeze: ignivarMajorCasts(ids),
      anchor: [onDamage(ids.forgeStrike)],
    },
    ...ignivarPacedMechanics(t, ids),
  ];
}

function ignivarGatesBlock(t, ids) {
  return {
    kind: 'gates',
    label: 'Ahead',
    rows: [
      {
        id: 'apocalypse',
        name: ids.apocalypseCast,
        hp: t.apocalypseHp,
        detail: `a ${String(t.apocalypseCast)}s channel that wipes the raid`,
      },
      {
        id: 'judgment',
        name: ids.judgmentCast,
        hp: t.judgmentHp,
        cast: ids.judgmentCast,
        detail: `${String(t.shelters)} shelters, one of them safe`,
      },
    ],
  };
}

function ignivarAddsBlock(ids, mobs) {
  const add = template(mobs, ids.apocalypseAdd);
  return {
    kind: 'adds',
    label: 'Adds',
    rows: [
      {
        templateId: ids.apocalypseAdd,
        name: add.name,
        ccImmune: add.ccImmune === true,
        answer: 'kill',
        note: `kill it before ${ids.apocalypseCast} finishes`,
        // Its cast bar is a countdown to the wipe, so the row draws that rather than health.
        castCountdown: true,
      },
    ],
  };
}

function ignivarBlocks(t, ids, deps) {
  return [
    ignivarGatesBlock(t, ids),
    {
      kind: 'enrage',
      label: 'Enrage',
      name: 'Last Inferno',
      aura: ids.lastInfernoAura,
      hp: t.lastInfernoHp,
      // The game mirrors its own countdown onto the aura every tick, and it ends in a wipe.
      countdown: true,
      seconds: t.lastInfernoSeconds,
    },
    {
      kind: 'debuffs',
      label: 'Brand of the Pyre',
      aura: ids.brandAura,
      // No `durationSeconds`: the brand is applied for ten minutes and is removed by water
      // rather than by expiring, so a bar under it would be full for the whole fight.
      apart: t.brandRadius,
      note: 'nobody within',
    },
    {
      kind: 'stations',
      label: 'Water conduits',
      ready: exported(deps.conduitTemplates, 'ready', MODULES.ignivarArena),
      active: exported(deps.conduitTemplates, 'active', MODULES.ignivarArena),
      // The game's `cooldown`, renamed because a conduit never comes back and "cooldown" on
      // screen would send somebody to wait at one.
      spent: exported(deps.conduitTemplates, 'cooldown', MODULES.ignivarArena),
      activeSeconds: t.conduitActive,
      count: deps.conduitCount,
      use: `stand within ${String(t.cleanseRadius)}yd to wash the Brand off`,
    },
    {
      kind: 'tankStacks',
      label: 'Tank',
      aura: ids.moltenAura,
      perStack: t.moltenPerStack,
      maxStacks: t.moltenMaxStacks,
    },
    ignivarAddsBlock(ids, deps.mobs),
  ];
}

function ignivarRow(deps) {
  const t = ignivarTuning(deps.mods);
  const ids = ignivarIds(deps.mods);
  const source = deps.sources.ignivar;
  const constants = resolvableIn(source, SOURCES.ignivar, [
    deps.mods.ignivar,
    deps.mods.ignivarMeteors,
    deps.mods.ignivarForgeWave,
    deps.mods.ignivarJudgment,
    deps.mods.ignivarArena,
  ]);
  checkIgnivarSites(source, constants, ids);
  const conduitTemplates = deps.mods.ignivarArena.IGNIVAR_WATER_CONDUIT_TEMPLATES;
  const conduits = deps.mods.ignivarArena.IGNIVAR_CONDUITS;
  if (typeof conduitTemplates !== 'object' || !Array.isArray(conduits)) {
    return fail(`${MODULES.ignivarArena} no longer publishes the conduit table`);
  }
  const dialogue = deps.mods.ignivarDialogue.IGNIVAR_DIALOGUE;
  const def = dungeon(deps.dungeons, ids.arena);
  const inner = { ...deps, conduitTemplates, conduitCount: conduits.length };
  return {
    id: IGNIVAR_ID,
    templateId: ids.boss,
    name: template(deps.mobs, ids.boss).name,
    arenaId: ids.arena,
    bossSpawn: bossSpawn(def, ids.boss, ids.arena),
    yells: ignivarYells(dialogue),
    wipes: wipesIn(source, constants, [ids.apocalypseCast, 'Last Inferno'], SOURCES.ignivar),
    pullSeeds: seedsFrom(source, constants, {
      fn: 'initIgnivarEncounter',
      pattern: TIMER_INITIALISED,
      fields: IGNIVAR_TIMER_FIELDS,
      where: SOURCES.ignivar,
    }),
    // Judgment is the only thing that stops EVERY clock; see `ignivarMajorCasts` for the rest.
    freeze: [whenCast(ids.judgmentCast)],
    spacing: { group: 'major', seconds: t.majorGap },
    reseeds: ignivarReseeds(source, constants, ids),
    mechanics: ignivarMechanics(t, ids),
    blocks: ignivarBlocks(t, ids, inner),
  };
}

/**
 * A wipe is dealt as ordinary damage of a hundred times a player's health under the
 * mechanic's own label, with no lifecycle event beside it. The check proves the label is still
 * passed to a wipe call, not that nothing else passes one too.
 */
function wipesIn(source, constants, names, where) {
  const calls = [...source.matchAll(WIPE_CALL)].map((one) => one[ONE].replaceAll(SPAN, ' '));
  if (calls.length === NONE) {
    fail(`${where} makes no wipe call this can read: the helper has been renamed`);
  }
  return names.map((ability) => {
    const aliases = [...constants.entries()]
      .filter(([, value]) => value === `'${ability}'`)
      .map(([name]) => name);
    const named = (args) => aliases.some((alias) => args.includes(alias));
    if (!calls.some((args) => args.includes(`'${ability}'`) || named(args))) {
      fail(`${where} no longer wipes the raid under '${ability}'`);
    }
    return { ability };
  });
}

function ignivarYells(dialogue) {
  if (typeof dialogue?.engage !== 'string' || typeof dialogue?.death !== 'string') {
    return fail(`${MODULES.ignivarDialogue} no longer carries an engage and a death line`);
  }
  return [
    { text: dialogue.engage, edge: 'pull' },
    { text: dialogue.death, edge: 'kill' },
  ];
}

function checkIgnivarSites(source, constants, ids) {
  const sites = liveSitesIn(source, SOURCES.ignivar, constants);
  requireUse(sites, 'auras', [ids.brandAura, ids.moltenAura, ids.lastInfernoAura]);
  requireUse(sites, 'casts', [
    ids.frontalCast,
    ids.skyfireCast,
    ids.raysCast,
    ids.waveCast,
    ids.judgmentCast,
    ids.apocalypseCast,
  ]);
  requireUse(sites, 'damage', [ids.forgeStrike, ids.meteorCast]);
}

function ignivarReseeds(source, constants, ids) {
  const spec = { pattern: TIMER_ASSIGNED, fields: IGNIVAR_TIMER_FIELDS, where: SOURCES.ignivar };
  return [
    {
      on: whenCast(ids.judgmentCast),
      edge: 'leaves',
      seeds: seedsFrom(source, constants, { ...spec, fn: 'finishForgeJudgment' }),
    },
    {
      on: whenAura(ids.lastInfernoAura),
      edge: 'enters',
      seeds: seedsFrom(source, constants, { ...spec, fn: 'updateLastInferno' }),
    },
  ];
}

const VARKHUL_ID = 'varkhul';

/** The one display name this encounter writes out rather than naming a constant. */
const VARKHUL_MASTERPIECE_NAME = 'Masterpiece Unbound';

/** Module-private, so there is no export to read them from. */
const VARKHUL_CADENCE_FIELDS = {
  cinderOrbsTimer: 'orbsEvery',
  frontalTimer: 'sweepEvery',
  forgestormTimer: 'stormEvery',
  anvilTimer: 'anvilEvery',
};

const VARKHUL_TIMER_FIELDS = {
  makersBrandTimer: 'makers-brand',
  frontalTimer: 'sweep',
  cinderOrbsTimer: 'orbs',
  interceptBeamTimer: 'beam',
  forgestormTimer: 'forgestorm',
  sharedPyreTimer: 'pyre',
  anvilTimer: 'anvil',
};

function varkhulTuning(mods) {
  const read = (module, name) => exported(mods[module], name, MODULES[module]);
  return {
    brandEvery: read('varkhul', 'VARKHUL_MAKERS_BRAND_EVERY'),
    brandDuration: read('varkhul', 'VARKHUL_MAKERS_BRAND_DURATION'),
    brandPerStack: read('varkhul', 'VARKHUL_MAKERS_BRAND_PER_STACK'),
    brandMaxStacks: read('varkhul', 'VARKHUL_MAKERS_BRAND_MAX_STACKS'),
    brandSwapStacks: read('varkhul', 'VARKHUL_MAKERS_BRAND_TANK_SWAP_STACKS'),
    sweepCast: read('varkhul', 'VARKHUL_FRONTAL_CAST_SECONDS'),
    sweepRange: read('varkhul', 'VARKHUL_FRONTAL_RANGE'),
    orbTargets: read('varkhul', 'VARKHUL_CINDER_ORBS_TARGETS'),
    orbMarkSeconds: read('varkhul', 'VARKHUL_CINDER_ORBS_MARK_SECONDS'),
    beamEvery: read('varkhul', 'VARKHUL_INTERCEPT_BEAM_EVERY_SECONDS'),
    beamFirst: read('varkhul', 'VARKHUL_INTERCEPT_BEAM_FIRST_SECONDS'),
    beamCast: read('varkhul', 'VARKHUL_INTERCEPT_BEAM_CAST_SECONDS'),
    woundSeconds: read('varkhul', 'VARKHUL_INTERCEPT_BEAM_DEBUFF_SECONDS'),
    woundTaken: read('varkhul', 'VARKHUL_INTERCEPT_BEAM_DEBUFF_DAMAGE_TAKEN'),
    stormWaves: read('varkhul', 'VARKHUL_FORGESTORM_WAVES'),
    stormWarning: read('varkhul', 'VARKHUL_FORGESTORM_WARNING_SECONDS'),
    stormRadius: read('varkhul', 'VARKHUL_FORGESTORM_RADIUS'),
    anvilStrikes: read('varkhul', 'VARKHUL_ANVILS_DECREE_STRIKES'),
    anvilStrikeSeconds: read('varkhul', 'VARKHUL_ANVILS_DECREE_STRIKE_SECONDS'),
    pyreEvery: read('varkhulPyre', 'VARKHUL_SHARED_PYRE_EVERY_SECONDS'),
    pyreFirst: read('varkhulPyre', 'VARKHUL_SHARED_PYRE_FIRST_SECONDS'),
    pyreCast: read('varkhulPyre', 'VARKHUL_SHARED_PYRE_CAST_SECONDS'),
    pyreRadius: read('varkhulPyre', 'VARKHUL_SHARED_PYRE_RADIUS'),
    pyreRequired: read('varkhulPyre', 'VARKHUL_SHARED_PYRE_REQUIRED_NORMAL'),
    pyreTotal: read('varkhulPyre', 'VARKHUL_SHARED_PYRE_TOTAL_DAMAGE_NORMAL'),
    pyrePerMissing: read('varkhulPyre', 'VARKHUL_SHARED_PYRE_RAID_DAMAGE_PER_MISSING'),
    assemblyHp: read('varkhul', 'VARKHUL_MASTERS_ASSEMBLY_HP_THRESHOLD'),
    assemblySeconds: read('varkhulIntermission', 'VARKHUL_FORGE_INTERMISSION_SECONDS_NORMAL'),
    masterpieceHp: read('varkhul', 'VARKHUL_MASTERPIECE_UNBOUND_HP_THRESHOLD'),
    masterpieceSpeed: read('varkhul', 'VARKHUL_MASTERPIECE_UNBOUND_SPEED_MULTIPLIER'),
    masterpieceSeconds: read('varkhul', 'VARKHUL_MASTERPIECE_UNBOUND_SECONDS'),
    repairSeconds: read('varkhulArtificer', 'VARKHUL_CINDER_REPAIR_CHANNEL_SECONDS'),
  };
}

function varkhulIds(mods) {
  const read = (module, name) => exported(mods[module], name, MODULES[module]);
  return {
    boss: read('raidIds', 'VARKHUL_BOSS_ID'),
    arena: read('raidIds', 'IGNIVAR_SECOND_WING_ID'),
    brandAura: read('varkhul', 'VARKHUL_MAKERS_BRAND_AURA_ID'),
    brandCast: read('varkhul', 'VARKHUL_MAKERS_BRAND_CAST_ID'),
    sweepCast: read('varkhul', 'VARKHUL_FRONTAL_CAST_ID'),
    orbsCast: read('varkhul', 'VARKHUL_CINDER_ORBS_CAST_ID'),
    orbsAura: read('varkhul', 'VARKHUL_CINDER_ORBS_AURA_ID'),
    metalAura: read('varkhul', 'VARKHUL_RED_HOT_METAL_AURA_ID'),
    beamCast: read('varkhul', 'VARKHUL_INTERCEPT_BEAM_CAST_ID'),
    woundAura: read('varkhul', 'VARKHUL_INTERCEPT_BEAM_DEBUFF_AURA_ID'),
    woundName: read('varkhul', 'VARKHUL_INTERCEPT_BEAM_DEBUFF_NAME'),
    stormCast: read('varkhul', 'VARKHUL_FORGESTORM_CAST_ID'),
    anvilCast: read('varkhul', 'VARKHUL_ANVILS_DECREE_CAST_ID'),
    pyreAura: read('varkhulPyre', 'VARKHUL_SHARED_PYRE_AURA_ID'),
    pyreName: read('varkhulPyre', 'VARKHUL_SHARED_PYRE_NAME'),
    assemblyAura: read('varkhul', 'VARKHUL_MASTERS_ASSEMBLY_AURA_ID'),
    assemblyCast: read('varkhul', 'VARKHUL_MASTERS_ASSEMBLY_CAST_ID'),
    masterpieceAura: read('varkhul', 'VARKHUL_MASTERPIECE_UNBOUND_AURA_ID'),
    repairCast: read('varkhulArtificer', 'VARKHUL_CINDER_REPAIR_CAST_ID'),
    repairName: read('varkhulArtificer', 'VARKHUL_CINDER_REPAIR_NAME'),
    artificer: read('varkhul', 'VARKHUL_CINDER_ARTIFICER_ID'),
    warden: read('varkhul', 'VARKHUL_CRUCIBLE_WARDEN_ID'),
    sentinel: read('varkhul', 'VARKHUL_EMBER_SENTINEL_ID'),
  };
}

/**
 * One list because his driver returns before EVERY cadence while any major ability is in
 * flight. Two windows cannot be closed from a client: Anvil's Decree clears the cast while he
 * walks to the anvil, and the forgestorm's warnings lapse between waves, so there this counts
 * down where the game does not.
 */
function varkhulFreeze(ids) {
  return [
    whenAura(ids.assemblyAura),
    whenCast(ids.sweepCast),
    whenCast(ids.orbsCast),
    whenCast(ids.beamCast),
    whenCast(ids.pyreName),
    whenCast(ids.anvilCast),
    whenHazard('varkhulForgestorm'),
  ];
}

/**
 * Read from the `st.<field> = <NAME>;` that arms each cycle, never from the declaration: a
 * cadence no longer assigned there is a mechanic the encounter has stopped pacing.
 */
function varkhulCadences(source, constants) {
  const body = source;
  const out = {};
  TIMER_ASSIGNED.lastIndex = NONE;
  let match = TIMER_ASSIGNED.exec(body);
  while (match !== null) {
    const key = VARKHUL_CADENCE_FIELDS[match[ONE]];
    const raw = match[INDENT].trim();
    if (key !== undefined && constants.has(raw)) {
      out[key] = seedValue(raw, constants, `${match[ONE]}'s cadence`);
    }
    match = TIMER_ASSIGNED.exec(body);
  }
  for (const key of Object.values(VARKHUL_CADENCE_FIELDS)) {
    if (out[key] === undefined) {
      fail(`${SOURCES.varkhul} no longer arms ${key} from a named cadence: the pacing has moved`);
    }
  }
  return out;
}

function checkVarkhulSites(source, constants, ids) {
  const sites = liveSitesIn(source, SOURCES.varkhul, constants);
  requireUse(sites, 'auras', [
    ids.brandAura,
    ids.orbsAura,
    ids.woundAura,
    ids.pyreAura,
    ids.assemblyAura,
    ids.masterpieceAura,
  ]);
  requireUse(sites, 'casts', [
    ids.sweepCast,
    ids.orbsCast,
    ids.beamCast,
    ids.pyreName,
    ids.anvilCast,
    ids.repairCast,
  ]);
  requireUse(sites, 'damage', [ids.brandCast]);
}

function varkhulMechanics(t, ids, priv) {
  return [
    {
      id: 'makers-brand',
      label: ids.brandCast,
      every: t.brandEvery,
      detail: `tank hit, swap at ${String(t.brandSwapStacks)} stacks`,
      charge: true,
      anchor: [onDamage(ids.brandCast)],
    },
    {
      id: 'sweep',
      label: ids.sweepCast,
      every: priv.sweepEvery,
      detail: `${String(t.sweepRange)}yd cone, ${String(t.sweepCast)}s cast`,
      anchor: [onCast(ids.sweepCast)],
    },
    {
      id: 'orbs',
      label: ids.orbsCast,
      every: priv.orbsEvery,
      detail: `${String(t.orbTargets)} marked, spread out`,
      anchor: [onCast(ids.orbsCast)],
    },
    {
      id: 'beam',
      label: ids.beamCast,
      every: t.beamEvery,
      detail: 'the first body in the line takes it',
      anchor: [onCast(ids.beamCast)],
    },
    {
      id: 'forgestorm',
      label: ids.stormCast,
      every: priv.stormEvery,
      detail: `${String(t.stormWaves)} waves, ${String(t.stormWarning)}s of warning each`,
      // He sets no cast for this one, so the ground warning is the only edge on every cycle.
      anchor: [onHazard('varkhulForgestorm')],
    },
    {
      id: 'pyre',
      label: ids.pyreName,
      every: t.pyreEvery,
      detail: `${String(t.pyreRequired)} bodies on the mark`,
      anchor: [onCast(ids.pyreName)],
      lethal: true,
    },
    {
      id: 'anvil',
      label: ids.anvilCast,
      every: priv.anvilEvery,
      detail: `${String(t.anvilStrikes)} strikes, ${String(t.anvilStrikeSeconds)}s apart`,
      anchor: [onCast(ids.anvilCast)],
    },
    {
      // One cycle: it opens once, and the clock under it is the game's own length rather than
      // a repeating cadence.
      id: 'assembly',
      label: ids.assemblyCast,
      every: t.assemblySeconds,
      detail: 'he is immune, the forge is not',
      when: [whenAura(ids.assemblyAura)],
      anchor: [onBoss(whenAura(ids.assemblyAura))],
    },
  ];
}

function varkhulAdds(mobs, ids, t) {
  const rows = [
    {
      templateId: ids.artificer,
      name: template(mobs, ids.artificer).name,
      ccImmune: template(mobs, ids.artificer).ccImmune === true,
      answer: 'interrupt',
      note: `${ids.repairName}, a ${String(t.repairSeconds)}s channel that repairs the forge`,
      interruptCast: ids.repairCast,
    },
    {
      templateId: ids.warden,
      name: template(mobs, ids.warden).name,
      ccImmune: template(mobs, ids.warden).ccImmune === true,
      answer: 'tank',
      note: wardenNote(mobs, ids.warden),
    },
    {
      templateId: ids.sentinel,
      name: template(mobs, ids.sentinel).name,
      ccImmune: template(mobs, ids.sentinel).ccImmune === true,
      answer: 'kill',
      note: 'kill it before the next wave',
    },
  ];
  return { kind: 'adds', label: 'Adds', rows };
}

/**
 * Its `castId` is snake_case and its `name` is prose, and BOTH ride `castingAbility` on
 * different mobs in this raid, so the note carries the name a player reads on the cast bar.
 */
function wardenNote(mobs, id) {
  const big = template(mobs, id).bigCast;
  if (typeof big?.name !== 'string' || typeof big?.castTime !== 'number') {
    return fail(`${id} no longer carries a bigCast to describe`);
  }
  return `${big.name}, ${String(big.castTime)}s, ${String(big.radius)}yd around it`;
}

function varkhulGatesBlock(t, ids) {
  return {
    kind: 'gates',
    label: 'Ahead',
    rows: [
      {
        id: 'assembly',
        name: ids.assemblyCast,
        hp: t.assemblyHp,
        detail: `${String(t.assemblySeconds)}s of adds while he is immune`,
      },
      {
        id: 'masterpiece',
        name: VARKHUL_MASTERPIECE_NAME,
        hp: t.masterpieceHp,
        detail: 'everything he does comes faster',
      },
    ],
  };
}

function varkhulBlocks(t, ids, mobs) {
  return [
    varkhulGatesBlock(t, ids),
    {
      kind: 'enrage',
      label: 'Enrage',
      name: VARKHUL_MASTERPIECE_NAME,
      aura: ids.masterpieceAura,
      hp: t.masterpieceHp,
      // The game re-syncs this aura against its own clock only on heroic, but both fall by one
      // tick per tick from the same length, so on normal the aura's remaining IS the clock.
      countdown: true,
      seconds: t.masterpieceSeconds,
    },
    {
      kind: 'soak',
      label: ids.pyreName,
      aura: ids.pyreAura,
      radius: t.pyreRadius,
      seconds: t.pyreCast,
      // Fallbacks only: the addon reads `stacks` and `value2` off the aura itself, and uses
      // these where only the party strip's copy of a mark is in range.
      required: t.pyreRequired,
      total: t.pyreTotal,
      perMissing: t.pyrePerMissing,
    },
    {
      kind: 'debuffs',
      label: ids.orbsCast,
      aura: ids.orbsAura,
      durationSeconds: t.orbMarkSeconds,
      count: t.orbTargets,
      note: 'spread out',
    },
    {
      kind: 'debuffs',
      label: ids.woundName,
      aura: ids.woundAura,
      durationSeconds: t.woundSeconds,
      note: `+${String(Math.round(t.woundTaken * PERCENT))}% damage taken`,
    },
    {
      kind: 'tankStacks',
      label: 'Tank',
      aura: ids.brandAura,
      perStack: t.brandPerStack,
      maxStacks: t.brandMaxStacks,
    },
    varkhulAdds(mobs, ids, t),
  ];
}

function varkhulYells(dialogue) {
  if (typeof dialogue?.engage !== 'string' || typeof dialogue?.death !== 'string') {
    return fail(`${MODULES.varkhulDialogue} no longer carries an engage and a death line`);
  }
  return [
    { text: dialogue.engage, edge: 'pull' },
    { text: dialogue.death, edge: 'kill' },
  ];
}

function varkhulRow(deps) {
  const t = varkhulTuning(deps.mods);
  const ids = varkhulIds(deps.mods);
  const source = deps.sources.varkhul;
  const constants = resolvableIn(source, SOURCES.varkhul, [
    deps.mods.varkhul,
    deps.mods.varkhulPyre,
    deps.mods.varkhulArtificer,
    deps.mods.varkhulIntermission,
  ]);
  checkVarkhulSites(source, constants, ids);
  const priv = varkhulCadences(source, constants);
  const def = dungeon(deps.dungeons, ids.arena);
  return {
    id: VARKHUL_ID,
    templateId: ids.boss,
    name: template(deps.mobs, ids.boss).name,
    arenaId: ids.arena,
    bossSpawn: bossSpawn(def, ids.boss, ids.arena),
    // Only the one: the forge meltdown kills over several seconds under its own label rather
    // than in one hit, so it is not a wipe this can name.
    wipes: wipesIn(deps.sources.varkhul, constants, [VARKHUL_MASTERPIECE_NAME], SOURCES.varkhul),
    yells: varkhulYells(deps.mods.varkhulDialogue.VARKHUL_DIALOGUE),
    pullSeeds: seedsFrom(source, constants, {
      fn: 'initVarkhulEncounter',
      pattern: TIMER_INITIALISED,
      fields: VARKHUL_TIMER_FIELDS,
      where: SOURCES.varkhul,
    }),
    freeze: varkhulFreeze(ids),
    rates: [{ when: whenAura(ids.masterpieceAura), multiplier: t.masterpieceSpeed }],
    mechanics: varkhulMechanics(t, ids, priv),
    blocks: varkhulBlocks(t, ids, deps.mobs),
  };
}

/** Two-space, which is what Biome formats this tree's JSON to. See the header. */
function render(table) {
  return `${JSON.stringify(table, null, INDENT)}\n`;
}

function report(row) {
  console.log(
    `generate: ${row.name}, ${String(row.mechanics.length)} mechanics, ` +
      `${String(row.blocks.length)} state blocks (${row.blocks.map((b) => b.kind).join(', ')})`,
  );
}

async function main() {
  const root = gamePathFrom(process.argv.slice(INDENT));
  // The identity check FIRST, before the module graph is touched: a wrong path reported as
  // a resolution failure reads as the game having moved something.
  const gameVersion = checkoutVersion(root);
  const sources = {};
  for (const [name, path] of Object.entries(SOURCES)) {
    sources[name] = readFileSync(join(root, path), 'utf8');
  }
  const mods = await loadModules(root);
  checkMendingId(mods.healer);
  const deps = { mods, sources, mobs: mods.data.MOBS, dungeons: mods.dungeons, types: mods.types };
  const rows = [
    nythraxisRow({ ...deps, source: sources.nythraxis }),
    ignivarRow(deps),
    varkhulRow(deps),
  ];
  // Beside this script rather than anywhere an argument could name, so the only file this
  // can write is the one it exists to write.
  const out = join(import.meta.dirname, OUT_FILE);
  writeFileSync(out, render({ gameVersion, source: SOURCE_NOTE, encounters: rows }));
  console.log(`generate: wrote ${out} from ${GAME_PACKAGE_NAME} ${gameVersion}`);
  for (const row of rows) {
    report(row);
  }
}

await main();
