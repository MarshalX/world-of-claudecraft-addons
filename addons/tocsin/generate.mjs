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
// TWO READING MODES, and the split is forced. Anything the game EXPORTS is evaluated through
// vite's SSR loader, because `MOBS` is a merge of two dozen content modules. The encounter's
// tuning constants are PARSED AS TEXT, because every one is a module-private `const` and SSR
// loading that module yields its functions and none of its numbers.
//
// Text reading is the weaker mechanism, so it is made loud: every constant is named in
// ENCOUNTER_NUMBERS, an absent name is a hard failure, and there is no fallback value in this
// script. The declared ids get the weaker check still, occurring in the source rather than
// being read out of it, and that is stated rather than dressed up.
//
// YELLS ARE DELIBERATELY NOT READ. Every mechanic here is observable from a cast, an aura or
// an entity appearing, and `quietMechanics` settles it: the most dangerous add announces
// itself with no bark at all, so a bark-driven addon would be silent where it matters most.
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

const DATA_MODULE = '/src/sim/data.ts';
const DUNGEONS_MODULE = '/src/sim/content/dungeons.ts';
const TYPES_MODULE = '/src/sim/types.ts';
const HEALER_MODULE = '/src/sim/mob/healer_channel.ts';
const ENCOUNTER_FILE = 'src/sim/encounters/nythraxis.ts';
const OUT_FILE = 'bosses.json';
const ARENA_ID = 'nythraxis_boss_arena';
/** This encounter's own id in the shipped table, which is not the boss template id. */
const ENCOUNTER_ID = 'nythraxis';

const SOURCE_NOTE =
  'src/sim/data.ts, src/sim/content/dungeons.ts, src/sim/types.ts, ' +
  'src/sim/mob/healer_channel.ts, src/sim/encounters/nythraxis.ts';

const NONE = 0;
const ONE = 1;
const INDENT = 2;
/** Gravebreaker's authored half arc, and what it is in degrees. */
const HALF_ARC_SOURCE = 'Math.PI / 3';
const HALF_ARC_DEGREES = 60;

/** `const NAME = value;` on one line, which is how every tuning constant is authored. */
const CONST_LINE = /^const (NYTHRAXIS_[A-Z0-9_]+) = ([^;]+);$/gm;
/** The heroic court's template ids, authored as a multi-line `as const` array. */
const HEROIC_IDS_BLOCK = /const NYTHRAXIS_HEROIC_ADD_IDS = \[([^\]]+)\] as const;/;
/** One quoted id inside that block. */
const QUOTED_ID = /'([a-z0-9_]+)'/g;

/** Nothing defaults, so a name missing from the source stops the run naming what lost it. */
const ENCOUNTER_NUMBERS = {
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
const AURA_IDS = {
  transitionPause: 'nythraxis_transition_pause',
  transitionStun: 'nythraxis_transition_stun',
  deathlessStun: 'nythraxis_deathless_stun',
  wardstoneLit: 'nythraxis_wardstone_lit',
  soulRend: 'nythraxis_soul_rend',
  dreadCurse: 'nythraxis_dread_curse',
  finalStand: 'nythraxis_final_stand',
};

/**
 * `spiritMending` is checked against its own export rather than against the encounter source,
 * because the heal is driven by the generic `channelHeal` mob mechanic and its id lives with
 * that mechanic. That is the stronger of the two checks, which is why it is separate.
 */
const CAST_IDS = {
  deathlessRage: 'nythraxis_deathless_rage',
  wardChannel: 'nythraxis_ward_channel',
  heroicSummon: 'nythraxis_heroic_summon',
  spiritMending: 'nythraxis_spirit_mending',
};

/** Which of those the encounter source itself owns, and can therefore be found in it. */
const ENCOUNTER_OWNED_CASTS = ['deathlessRage', 'wardChannel', 'heroicSummon'];

/**
 * The one editorial line in this file, hand-declared because no field carries it:
 * `ccImmune: false` says an add CAN be controlled and says nothing about a capped heal being
 * impossible to out-damage. The kit numbers beside it are read, so a retune leaves this alone.
 */
const HEROIC_ANSWERS = new Map([
  ['nythraxis_heroic_warrior_add', 'tank'],
  ['nythraxis_heroic_priest_add', 'interrupt'],
  ['nythraxis_heroic_rogue_add', 'control'],
]);

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
 * running its plugin chain to read four modules would tie this script to a build pipeline
 * it has no business knowing about.
 */
async function loadModules(root) {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  try {
    return {
      data: await server.ssrLoadModule(DATA_MODULE),
      dungeons: await server.ssrLoadModule(DUNGEONS_MODULE),
      types: await server.ssrLoadModule(TYPES_MODULE),
      healer: await server.ssrLoadModule(HEALER_MODULE),
    };
  } catch (err) {
    return fail(`could not load the game's modules from ${root}: ${String(err)}`);
  } finally {
    await server.close();
  }
}

function encounterConstants(source) {
  const found = new Map();
  CONST_LINE.lastIndex = NONE;
  let match = CONST_LINE.exec(source);
  while (match !== null) {
    found.set(match[ONE], match[INDENT].trim());
    match = CONST_LINE.exec(source);
  }
  if (found.size === NONE) {
    fail(`${ENCOUNTER_FILE} yielded no NYTHRAXIS_ constants: the read stopped working`);
  }
  return found;
}

function numberFrom(constants, key, name) {
  const raw = constants.get(name);
  if (raw === undefined) {
    return fail(`${ENCOUNTER_FILE} has no ${name}, which is where ${key} comes from`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return fail(`${name} is "${raw}", which is not a plain number this can carry as ${key}`);
  }
  return value;
}

function tuning(constants) {
  const out = {};
  for (const [key, name] of Object.entries(ENCOUNTER_NUMBERS)) {
    out[key] = numberFrom(constants, key, name);
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

function checkIds(source, ids, label) {
  for (const [key, id] of Object.entries(ids)) {
    if (!source.includes(`'${id}'`)) {
      fail(`${ENCOUNTER_FILE} no longer mentions '${id}' (${label}.${key}): it has been renamed`);
    }
  }
}

function arena(dungeons) {
  const found = dungeons.DUNGEON_DEFS?.[ARENA_ID];
  if (typeof found !== 'object' || found === null) {
    return fail(`DUNGEON_DEFS has no ${ARENA_ID}: the arena this addon reads has moved`);
  }
  return found;
}

function bossSpawn(def, bossId) {
  const spawn = (def.spawns ?? []).find((one) => one.mobId === bossId);
  if (spawn === undefined) {
    return fail(`${ARENA_ID} no longer spawns ${bossId}`);
  }
  return { x: spawn.x, z: spawn.z };
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
    return fail(`${ARENA_ID} holds no ${itemId} objects: the wardstones have moved`);
  }
  return found.map((one) => ({ name: one.name, x: one.x, z: one.z }));
}

function template(mobs, id) {
  const found = mobs[id];
  if (typeof found !== 'object' || found === null) {
    return fail(`MOBS has no ${id}: this encounter's roster has changed`);
  }
  return found;
}

/** The heroic court's answers, hardest first: the addon draws and ranks by these words. */
const ANSWER_ORDER = ['interrupt', 'control', 'tank', 'kill'];

function waveAdd(mobs, id) {
  const found = template(mobs, id);
  return {
    templateId: id,
    name: found.name,
    ccImmune: found.ccImmune === true,
    answer: 'kill',
    note: 'no crowd control, kill it',
  };
}

function courtKit(found) {
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
    kit.interruptCast = CAST_IDS.spiritMending;
  }
  if (found.ignoreTaunt === true) {
    kit.ignoreTaunt = true;
  }
  return kit;
}

function courtAdds(mobs, ids) {
  return ids.map((id) => {
    const found = template(mobs, id);
    const answer = HEROIC_ANSWERS.get(id);
    if (answer === undefined) {
      return fail(`${id} is in the heroic court and this file says nothing about answering it`);
    }
    return {
      templateId: id,
      name: found.name,
      ccImmune: found.ccImmune === true,
      quietMechanics: found.quietMechanics === true,
      answer,
      ...courtKit(found),
    };
  });
}

function heroicIds(source) {
  const block = HEROIC_IDS_BLOCK.exec(source);
  if (block === null) {
    return fail(`${ENCOUNTER_FILE} has no NYTHRAXIS_HEROIC_ADD_IDS array to read`);
  }
  const ids = [...block[ONE].matchAll(QUOTED_ID)].map((one) => one[ONE]);
  if (ids.length === NONE) {
    return fail('NYTHRAXIS_HEROIC_ADD_IDS parsed to no ids at all');
  }
  return ids;
}

function exported(module, name, where) {
  const value = module[name];
  if (typeof value !== 'string' && typeof value !== 'number') {
    return fail(`${where} no longer exports ${name}`);
  }
  return value;
}

/**
 * Declarations rather than a bag of numbers, so a second encounter adds rows here and needs
 * no addon code. An `anchor` is what the addon can WATCH to seed the clock; `liveCast` means
 * the game is counting for itself and the prediction gives way.
 */
function mechanicRows(t, waveAddId) {
  return [
    {
      id: 'gravebreaker',
      label: 'Gravebreaker',
      every: t.gravebreakerEvery,
      detail: `${String(t.gravebreakerRange)}yd frontal cone`,
      phase: 'both',
      // The cadence ARMS a swing rather than firing: once due it waits for one to land.
      charge: true,
      anchor: { damage: 'Gravebreaker' },
    },
    {
      id: 'raise-fallen',
      label: 'Raise Fallen',
      every: t.raiseFallenEvery,
      detail: 'no crowd control, kill them',
      phase: 'one',
      anchor: { spawn: waveAddId },
    },
    {
      id: 'soul-rend',
      label: 'Soul Rend',
      every: t.soulRendEvery,
      detail: 'marks stack up',
      phase: 'two',
      anchor: { damage: 'Soul Rend' },
    },
    {
      id: 'deathless',
      label: 'Deathless Rage',
      every: t.deathlessEvery,
      detail: 'three wardstones, three different players',
      phase: 'two',
      liveCast: CAST_IDS.deathlessRage,
      lethal: true,
    },
  ];
}

/**
 * A kind is a SHAPE of raid problem rather than a mechanic, which is what makes it reusable:
 * an encounter declaring a shape the addon already renders draws with no addon change, and
 * only a genuinely new shape needs a new renderer.
 */
function blockRows(t, deps) {
  return [
    channelsBlock(t, deps),
    {
      kind: 'marks',
      label: 'Soul Rend',
      aura: AURA_IDS.soulRend,
      durationSeconds: t.soulRendDuration,
      stackRange: t.soulRendStackRange,
      count: t.soulRendMarks,
      countHeroic: t.soulRendMarksHeroic,
      heroicMult: t.soulRendHeroicMult,
    },
    {
      kind: 'tankStacks',
      label: 'Tank',
      aura: AURA_IDS.dreadCurse,
      perStack: t.dreadCursePerStack,
      maxStacks: t.dreadCurseMaxStacks,
      // Its presence is itself the heroic tell: the boss applies it on no other difficulty.
      heroicOnly: true,
    },
    addsBlock(deps),
  ];
}

function channelsBlock(t, deps) {
  const itemId = deps.wardItemId;
  return {
    kind: 'channels',
    label: 'Wardstones',
    duringCast: CAST_IDS.deathlessRage,
    castSeconds: t.deathlessCast,
    channelCast: CAST_IDS.wardChannel,
    channelSeconds: t.deathlessChannel,
    objectTemplateId: `ground_${itemId}`,
    // The game's own interact range plus a yard, which is the check it makes itself.
    reach: deps.interactRange + ONE,
    distinct: true,
    objects: wardstones(deps.def, itemId),
  };
}

function addsBlock(deps) {
  const court = courtAdds(deps.mobs, heroicIds(deps.source)).map((add) => ({
    ...add,
    heroicTell: true,
  }));
  const ranked = [...court].sort(
    (a, b) => ANSWER_ORDER.indexOf(a.answer) - ANSWER_ORDER.indexOf(b.answer),
  );
  return {
    kind: 'adds',
    label: 'Adds',
    rows: [...ranked, waveAdd(deps.mobs, deps.waveAddId)],
  };
}

function encounterRow(deps) {
  const { source, mobs, types } = deps;
  const bossId = exported(types, 'NYTHRAXIS_BOSS_ID', TYPES_MODULE);
  const constants = encounterConstants(source);
  const wardItemId = constants.get('NYTHRAXIS_WARDSTONE_ITEM_ID')?.replaceAll("'", '');
  if (wardItemId === undefined) {
    return fail(`${ENCOUNTER_FILE} has no NYTHRAXIS_WARDSTONE_ITEM_ID`);
  }
  checkIds(source, AURA_IDS, 'auras');
  checkIds(source, Object.fromEntries(ENCOUNTER_OWNED_CASTS.map((k) => [k, CAST_IDS[k]])), 'casts');
  const t = tuning(constants);
  const inner = {
    ...deps,
    def: arena(deps.dungeons),
    wardItemId,
    interactRange: exported(types, 'INTERACT_RANGE', TYPES_MODULE),
    waveAddId: exported(types, 'NYTHRAXIS_ADD_ID', TYPES_MODULE),
  };
  return {
    id: ENCOUNTER_ID,
    templateId: bossId,
    name: template(mobs, bossId).name,
    arenaId: ARENA_ID,
    bossSpawn: bossSpawn(inner.def, bossId),
    phases: phaseRow(t),
    // What stops every clock at once, as one list of conditions rather than two parallel
    // arrays: each returns early from the game's own per-tick driver, and each says whether
    // it is an aura the boss wears or a cast it is in the middle of.
    freeze: [
      { kind: 'aura', id: AURA_IDS.deathlessStun },
      { kind: 'aura', id: AURA_IDS.transitionPause },
      { kind: 'cast', id: CAST_IDS.deathlessRage },
      { kind: 'cast', id: CAST_IDS.heroicSummon },
    ],
    mechanics: mechanicRows(t, inner.waveAddId),
    blocks: blockRows(t, inner),
  };
}

function phaseRow(t) {
  return {
    transitionAura: AURA_IDS.transitionPause,
    phaseTwoHp: t.phaseTwoHp,
    seeds: {
      gravebreaker: t.phaseTwoSettle,
      'soul-rend': t.phaseTwoSettle,
      deathless: t.phaseTwoSettle + t.deathlessSoulRendLockout,
    },
  };
}

/** A disagreement is a hard stop rather than a silent pick. */
function checkMendingId(healer) {
  const owned = exported(healer, 'NYTHRAXIS_SPIRIT_MENDING_CAST_ID', HEALER_MODULE);
  if (owned !== CAST_IDS.spiritMending) {
    fail(`the scripted heal cast is '${String(owned)}', not '${CAST_IDS.spiritMending}'`);
  }
}

/** Two-space, which is what Biome formats this tree's JSON to. See the header. */
function render(table) {
  return `${JSON.stringify(table, null, INDENT)}\n`;
}

async function main() {
  const root = gamePathFrom(process.argv.slice(INDENT));
  // The identity check FIRST, before the module graph is touched: a wrong path reported as
  // a resolution failure reads as the game having moved something.
  const gameVersion = checkoutVersion(root);
  const source = readFileSync(join(root, ENCOUNTER_FILE), 'utf8');
  const { data, dungeons, types, healer } = await loadModules(root);
  checkMendingId(healer);
  const row = encounterRow({ source, mobs: data.MOBS, dungeons, types });
  // Beside this script rather than anywhere an argument could name, so the only file this
  // can write is the one it exists to write.
  const out = join(import.meta.dirname, OUT_FILE);
  writeFileSync(out, render({ gameVersion, source: SOURCE_NOTE, encounters: [row] }));
  console.log(`generate: wrote ${out} from ${GAME_PACKAGE_NAME} ${gameVersion}`);
  console.log(
    `generate: ${row.name}, ${String(row.mechanics.length)} mechanics, ` +
      `${String(row.blocks.length)} state blocks (${row.blocks.map((b) => b.kind).join(', ')})`,
  );
}

await main();
