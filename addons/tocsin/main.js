/// <reference types="@woc-addons/types" />

// Tocsin: what a raid encounter is about to do, and what the group has to answer.
//
// Nothing about one encounter is written here. The shipped table declares each encounter's
// mechanics and the block KINDS its state is made of, and this file carries one renderer per
// kind, so a second encounter reusing a shape is a table change alone. The table's own
// vocabulary is three lists: a CONDITION is a question about the boss, an ANCHOR is an edge
// that re-arms a cadence, and a SEED is a clock the game rewrites at a phase change.
//
// Three readings are inferences and all three say so on screen. DIFFICULTY is not on the wire,
// so heroic is latched from a tell and until one lands the figures are the normal ones. A
// CHANNEL's outcome has no completion flag: the live reading is a fact, and the post-mortem is
// read from the boss's cast ending early, which is the game confirming every channel landed.
// And a PREDICTION is drawn with a leading `~` for the whole of its life, because the addon is
// counting its own clock rather than reading the game's.
//
// Predictions are only honest because these encounters are SCRIPTED: their driver runs every
// tick, where a template boss counts down on melee contact alone. Nothing here models a
// template boss and it must not be pointed at one.
//
// TWO KNOWN GAPS, neither closable from a client: Varkhul clears his cast bar while he walks
// to the anvil, and his forgestorm sets no cast at all, so in those windows this counts down
// where the game holds still.

const TABLE_FILE = 'bosses.json';
const FRAME_WIDTH = 300;
const FRAME_HEIGHT = 420;
const MIN_FRAME_WIDTH = 180;
const MIN_FRAME_HEIGHT = 120;
const DECIMALS = 1;
const PERCENT = 100;
const MS = 1000;
/** Under this much left, a row is landing rather than coming. */
const IMPACT_SECONDS = 1;
const POSTMORTEM_MS = 12_000;
const BANNER_MS = 4000;
const REWARN_MS = 8000;
/**
 * How little may be left on a channel that vanishes for it to count as COMPLETED.
 *
 * The two endings are far apart, which is what makes this safe rather than a guess. A channel
 * that finishes has its cast cleared on the same tick its remaining hits zero, so the last
 * value seen is one server tick above it. One that BREAKS has its cast cleared wherever the
 * player got to, and the server resets its own counter to the full length. So a false
 * completion needs a channel to break inside its last half second, which the raid sees resolve
 * anyway. This is still an INFERENCE, and the row it produces says DONE rather than claiming
 * the game reported it.
 */
const DONE_SECONDS = 0.5;

/**
 * Most severe first.
 *
 * There is one banner slot loader-wide, so severity is decided here rather than by whichever
 * handler ran last. The two soak shapes outrank everything because their failure is the whole
 * raid rather than one player.
 */
const ALERT_RANK = ['channels', 'soak', 'marks', 'enrage', 'interrupt', 'tank', 'mechanic'];

const ASSUMED_NORMAL = 'Normal figures: nothing on the wire says which difficulty this is.';

/** How far out from an enrage this starts saying so, as a multiple of the trigger itself. */
const ENRAGE_WATCH_MULT = 2;

/**
 * How far above its threshold a gate starts being drawn, as a share of maximum health.
 * Additive rather than the enrage block's multiple: a gate at 65% times two is on screen from
 * the pull.
 */
const GATE_BAND = 0.15;

/**
 * Drawn in this order whatever order the table declares them, so the layout never moves.
 *
 * An enrage is first because it is only ever on screen for the last stretch of a fight, and
 * for that stretch it is the line to read before any of the others. The gates block is second
 * for the same reason in reverse: it is a fight's next hard change, and it is empty otherwise.
 */
const BLOCK_ORDER = [
  'enrage',
  'gates',
  'channels',
  'soak',
  'marks',
  'debuffs',
  'stations',
  'tankStacks',
  'adds',
];

let encounters = [];
let pull = null;
let lastTick = woc.now();
/**
 * The boss this addon last saw standing with nobody on it, which is one of the two ways to
 * tell a pull it WATCHED START from a fight it walked in on. Module level rather than on
 * `pull`, because `drawIdle` clears that on the same frames this has to survive.
 */
let idleBossId = null;
/** The other way: the boss whose own engage line this session heard. */
let pullYellFor = null;
/** How the last attempt ended, kept across the boss leaving so the idle line can say so. */
let lastResult = null;

/**
 * `woc.data` hands back `unknown`: the loader checks the file parses as JSON and nothing
 * beyond that, so the shape is a claim and this is where it is checked. Only what is joined
 * on is required, so a generator that adds a key needs no edit here.
 */
function readTable(raw) {
  const rows = raw?.encounters;
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.filter((row) => typeof row?.templateId === 'string' && Array.isArray(row.mechanics));
}

/** Read live rather than held: an entity comes and goes. */
function livingOf(templateId) {
  const found = [];
  for (const entity of woc.world.entities.values()) {
    if (entity.templateId === templateId && !entity.dead) {
      found.push(entity);
    }
  }
  return found;
}

function activeNow() {
  for (const row of encounters) {
    const [entity] = livingOf(row.templateId);
    if (entity !== undefined) {
      return { row, entity };
    }
  }
  return null;
}

function pullSubject() {
  if (pull === null) {
    return null;
  }
  const entity = woc.world.entities.get(pull.bossId);
  if (entity === undefined || entity.dead) {
    return null;
  }
  return { row: pull.row, entity };
}

function auraOn(entity, id) {
  return entity?.auras?.find((aura) => aura.id === id) ?? null;
}

function bossCast(entity) {
  return woc.world.casts.get(entity.id) ?? null;
}

/** Interest-filtered around the player, so an empty list is "none near me". */
function hazardsOf(kind) {
  return (woc.world.hazards ?? []).filter((one) => one.kind === kind);
}

/** The boss's target, which is the tank for every reading here. */
function tankEntity(entity) {
  const id = entity.aggroTargetId;
  if (id === null || id === undefined) {
    return null;
  }
  return woc.world.entities.get(id) ?? null;
}

function roster() {
  return woc.world.party?.members ?? [];
}

/** The roster's name first, since it survives a member leaving interest scope. */
function nameOf(pid) {
  const row = roster().find((one) => one.pid === pid);
  if (row !== undefined) {
    return row.name;
  }
  return woc.world.entities.get(pid)?.name ?? 'Unknown';
}

function healthFraction(entity) {
  return entity.hp / Math.max(entity.maxHp, 1);
}

function asPercent(fraction) {
  return `${String(Math.round(fraction * PERCENT))}%`;
}

/** Flat, ignoring height, which is what the game's own range checks measure. */
function apart(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * An unrecognised kind answers false: a newer table then draws a mechanic it should have
 * hidden, which is visible, where true would hide one it should have drawn.
 */
function conditionHolds(condition, entity) {
  if (condition?.kind === 'aura') {
    return auraOn(entity, condition.id) !== null;
  }
  if (condition?.kind === 'cast') {
    return bossCast(entity)?.ability === condition.id;
  }
  if (condition?.kind === 'hazard') {
    return hazardsOf(condition.id).length > 0;
  }
  if (condition?.kind === 'belowHp') {
    return healthFraction(entity) <= condition.hp;
  }
  return false;
}

function anyHolds(conditions, entity) {
  return (conditions ?? []).some((one) => conditionHolds(one, entity));
}

/**
 * Everything the game does at a phase change happens on an edge, so a re-seed read from
 * presence would fire on every frame. THE FIRST SAMPLE IS NEVER AN EDGE: walking into a room
 * where a conduit is already running, or the boss is already in its last phase, would
 * otherwise read as that having just happened.
 */
function edgeOf(key, holds) {
  const was = pull.edges.get(key);
  pull.edges.set(key, holds);
  if (was === undefined) {
    return { rising: false, falling: false };
  }
  return { rising: holds && !was, falling: was && !holds };
}

/**
 * Latched for the pull rather than sampled: every tell is a transient, since an add dies and
 * an aura falls off, while a difficulty does not change mid-fight.
 */
function noteHeroic() {
  if (pull !== null) {
    pull.heroic = true;
  }
}

function heroic() {
  return pull?.heroic === true;
}

/**
 * A pull this addon saw begin (the boss stood idle, or its engage line arrived) is seeded from
 * the game's own opening clocks. A fight walked in on gets no seeds: a made-up figure is worse
 * than the row saying it has not seen one yet.
 */
function seedPull(row) {
  if (idleBossId !== pull.bossId && pullYellFor !== pull.bossId) {
    return;
  }
  idleBossId = null;
  pullYellFor = null;
  pull.seeded = true;
  applySeeds(row.pullSeeds, woc.world.entities.get(pull.bossId));
}

function startPull(found) {
  const timers = {};
  for (const mechanic of found.row.mechanics) {
    timers[mechanic.id] = { dueAt: null, cycle: 0 };
  }
  pull = {
    bossId: found.entity.id,
    encounterId: found.row.id,
    row: found.row,
    heroic: false,
    seeded: false,
    transitionSeenAt: null,
    phaseTwoAt: null,
    seenSpawns: new Set(),
    castAbility: null,
    woundedAt: null,
    enraged: false,
    timers,
    edges: new Map(),
    stations: new Map(),
    channels: null,
    outcome: null,
    alert: null,
    firedAt: new Map(),
    announced: new Map(),
  };
  seedPull(found.row);
}

/** A target is the only engagement signal a mob sends: `inCombat` is not on the wire. */
function engaged(entity) {
  const target = entity.aggroTargetId;
  return target !== null && target !== undefined;
}

/**
 * Whether the encounter has RESET under a pull this addon still thinks is running.
 *
 * A wipe restores the boss to full health and clears its threat, but it does NOT clear the
 * target field, so `engaged` goes on reading true against a boss standing idle at its spawn.
 * Without this the next attempt inherits the last one's clocks, phase and difficulty latch,
 * which is a timer column that is confidently wrong rather than merely unseeded.
 *
 * Full health after being seen wounded is the only reading available for it. A boss healed
 * all the way back would read the same, and that is the right way round: the cost is
 * forgetting what this addon had learned, where the cost of not checking is inventing it.
 */
function encounterReset(entity) {
  if (healthFraction(entity) < 1) {
    pull.woundedAt = woc.now();
    return false;
  }
  return pull.woundedAt !== null;
}

/**
 * The transition is an AURA rather than a health fraction, which is what makes it a fact: a
 * fraction is a guess about which side of a threshold one snapshot landed on. The fraction is
 * the fallback for a fight this addon joined after the transition, which is what `phaseTwoAt`
 * distinguishes.
 *
 * `phases` models a scripted intermission with a hard boundary on either side; a phase that IS
 * an aura the boss wears is a condition on the mechanic instead.
 */
function phaseOf(row, entity) {
  const { phases } = row;
  if (phases === undefined) {
    return 'one';
  }
  if (auraOn(entity, phases.transitionAura) !== null) {
    return 'transition';
  }
  if (pull.phaseTwoAt !== null) {
    return 'two';
  }
  if (healthFraction(entity) <= phases.phaseTwoHp) {
    return 'two';
  }
  return 'one';
}

function inPhase(mechanic, phase) {
  const declared = mechanic.phase ?? 'both';
  return declared === 'both' || declared === phase;
}

/** Whether a mechanic exists at all right now, which is separate from when it is next due. */
function mechanicShown(mechanic, entity, phase) {
  if (!inPhase(mechanic, phase)) {
    return false;
  }
  if (mechanic.when !== undefined && !anyHolds(mechanic.when, entity)) {
    return false;
  }
  return !anyHolds(mechanic.unless, entity);
}

/**
 * Applied where a cadence is ARMED and never to a clock already running, which is what the
 * game does: a clock armed before the phase opened keeps its length.
 */
function rateNow(row, entity) {
  let rate = 1;
  for (const rule of row.rates ?? []) {
    if (conditionHolds(rule.when, entity)) {
      rate = rule.multiplier;
    }
  }
  return rate;
}

/** The LAST matching override wins, as in the game's own cadence function. */
function cadenceFor(row, mechanic, entity) {
  let { every } = mechanic;
  for (const rule of mechanic.cadences ?? []) {
    if (conditionHolds(rule.when, entity)) {
      ({ every } = rule);
    }
  }
  return every / Math.max(rateNow(row, entity), Number.EPSILON);
}

/**
 * `cycle` counts ARMINGS rather than time, and the alert path is what needs it: a freeze moves
 * `dueAt` on every frame it holds, so a call already made cannot be recognised by the time it
 * was made for.
 */
function fired(row, mechanic, entity) {
  const timer = pull?.timers[mechanic.id];
  if (timer !== undefined) {
    timer.dueAt = woc.now() + cadenceFor(row, mechanic, entity) * MS;
    timer.cycle += 1;
  }
}

/** Null means nothing has ever seeded it, which is drawn rather than counted from zero. */
function dueIn(timer) {
  if (timer.dueAt === null) {
    return null;
  }
  return Math.max((timer.dueAt - woc.now()) / MS, 0);
}

/**
 * Per mechanic rather than one flag on the pull: Ignivar's four paced abilities keep ticking
 * through each other's casts while the brand and the tank strike do not.
 */
function holdTimers(row, entity, elapsed) {
  const globally = anyHolds(row.freeze, entity);
  for (const mechanic of row.mechanics) {
    const timer = pull.timers[mechanic.id];
    const held = globally || anyHolds(mechanic.freeze, entity);
    if (held && timer !== undefined && timer.dueAt !== null) {
      timer.dueAt += elapsed;
    }
  }
}

/**
 * `floor` and `cap` are `Math.max` and `Math.min` at the game's own call site, bounding a
 * clock it is still running; setting outright would move a prediction the game left alone. A
 * clock never seeded has no bound to apply, so both fall back to a set.
 */
function writeSeed(timer, seed) {
  const at = woc.now() + seed.seconds * MS;
  timer.cycle += 1;
  if (timer.dueAt === null || seed.mode === undefined || seed.mode === 'set') {
    timer.dueAt = at;
    return;
  }
  if (seed.mode === 'floor') {
    timer.dueAt = Math.max(timer.dueAt, at);
    return;
  }
  timer.dueAt = Math.min(timer.dueAt, at);
}

function applySeeds(seeds, entity) {
  if (entity === undefined) {
    return;
  }
  for (const seed of seeds ?? []) {
    const timer = pull.timers[seed.id];
    if (timer !== undefined) {
      writeSeed(timer, seed);
    }
  }
}

function seedPhase(row) {
  applySeeds(row.phases?.seeds, woc.world.entities.get(pull.bossId));
  pull.phaseTwoAt = woc.now();
}

function trackPhase(row, phase) {
  if (phase === 'transition') {
    pull.transitionSeenAt = woc.now();
    return;
  }
  if (pull.transitionSeenAt !== null && pull.phaseTwoAt === null) {
    seedPhase(row);
  }
}

/**
 * A mechanic hidden by a gate is armed anyway: Ignivar's last phase alternates the same two
 * casts it paces normally, and the one off screen is the one whose clock has to be right
 * when it comes back.
 */
function armAnchored(row, entity, kind, id) {
  for (const mechanic of row.mechanics) {
    if ((mechanic.anchor ?? []).some((one) => one.kind === kind && one.id === id)) {
      fired(row, mechanic, entity);
    }
  }
}

function trackSpawns(row, entity) {
  for (const mechanic of row.mechanics) {
    for (const anchor of mechanic.anchor ?? []) {
      if (anchor.kind === 'spawn') {
        watchSpawn(row, entity, mechanic, anchor.id);
      }
    }
  }
}

function watchSpawn(row, entity, mechanic, templateId) {
  for (const spawned of livingOf(templateId)) {
    if (!pull.seenSpawns.has(spawned.id)) {
      pull.seenSpawns.add(spawned.id);
      fired(row, mechanic, entity);
    }
  }
}

/**
 * A cast STARTING is an anchor like any other, and for a mechanic that ends in one it is the
 * only edge there is: the game arms the next cadence where it opens the cast, and the damage
 * that cast would deal is not dealt at all on the cycles the raid answers, so watching for the
 * damage instead would leave the clock dead for exactly the pulls that went well.
 *
 * Joining mid-cast needs no correction for the same reason the freeze exists: the game holds
 * its own counter at full for the length of the cast, so reading the start late reads it right.
 */
function trackCasts(row, entity) {
  const ability = bossCast(entity)?.ability ?? null;
  const before = pull.castAbility;
  pull.castAbility = ability;
  if (before !== null && before !== ability) {
    spaceAfter(row, entity, before);
  }
  if (ability !== null && ability !== before) {
    armAnchored(row, entity, 'cast', ability);
  }
}

/**
 * The gap the game leaves after any one of a group resolves; without it every prediction in
 * the group reads up to that gap early. A floor rather than a set, for the reason `writeSeed`
 * gives.
 */
function spaceAfter(row, entity, endedAbility) {
  const { spacing } = row;
  if (spacing === undefined) {
    return;
  }
  const ended = row.mechanics.find(
    (one) =>
      one.group === spacing.group &&
      (one.anchor ?? []).some((a) => a.kind === 'cast' && a.id === endedAbility),
  );
  if (ended === undefined) {
    return;
  }
  const seeds = row.mechanics
    .filter((one) => one.group === spacing.group)
    .map((one) => ({ id: one.id, seconds: spacing.seconds, mode: 'floor' }));
  applySeeds(seeds, entity);
}

/**
 * Neither hazard mechanic sets a cast, and both deal damage only to whoever failed to move,
 * so damage would leave the clock dead on exactly the cycles the raid answered. The list is
 * interest-filtered, so an out-of-range warning is missed rather than wrong.
 */
function trackHazards(row, entity) {
  for (const mechanic of row.mechanics) {
    for (const anchor of mechanic.anchor ?? []) {
      if (anchor.kind === 'hazard') {
        const edge = edgeOf(`hazard:${mechanic.id}:${anchor.id}`, hazardsOf(anchor.id).length > 0);
        if (edge.rising) {
          fired(row, mechanic, entity);
        }
      }
    }
  }
}

/** A state the boss enters, for a mechanic whose start has no cast and no ground warning. */
function trackBossAnchors(row, entity) {
  for (const mechanic of row.mechanics) {
    for (const anchor of mechanic.anchor ?? []) {
      if (anchor.kind === 'boss') {
        const edge = edgeOf(`boss:${mechanic.id}`, conditionHolds(anchor.when, entity));
        if (edge.rising) {
          fired(row, mechanic, entity);
        }
      }
    }
  }
}

function trackReseeds(row, entity) {
  (row.reseeds ?? []).forEach((rule, index) => {
    const edge = edgeOf(`reseed:${String(index)}`, conditionHolds(rule.on, entity));
    const wanted = rule.edge === 'leaves';
    if ((wanted && edge.falling) || (!wanted && edge.rising)) {
      applySeeds(rule.seeds, entity);
    }
  });
}

function predictionRow(row, mechanic, timer, entity) {
  const left = dueIn(timer);
  if (left === null) {
    return { id: mechanic.id, label: mechanic.label, detail: 'armed, not seen yet', value: '' };
  }
  const built = {
    id: mechanic.id,
    label: mechanic.label,
    detail: mechanic.detail ?? '',
    value: `~${left.toFixed(DECIMALS)}s`,
    fraction: left / Math.max(cadenceFor(row, mechanic, entity), 1),
    seconds: left,
  };
  if (left <= IMPACT_SECONDS) {
    built.tone = 'danger';
  }
  return built;
}

/**
 * A charged mechanic never counts to a fire. The game arms it on a timer and then holds the
 * charge through every miss, dodge and parry, so the release is the next landed swing.
 */
function chargedRow(row, mechanic, timer, entity) {
  const left = dueIn(timer);
  if (left !== null && left <= 0) {
    return {
      id: mechanic.id,
      label: mechanic.label,
      detail: `${mechanic.detail ?? ''}, charged`,
      value: 'next swing',
      tone: 'warn',
    };
  }
  return predictionRow(row, mechanic, timer, entity);
}

/** The game's own remaining time, so this row is drawn solid rather than as a prediction. */
function liveRow(mechanic, cast) {
  return {
    id: mechanic.id,
    label: mechanic.label,
    detail: mechanic.detail ?? '',
    value: `${cast.remaining.toFixed(DECIMALS)}s`,
    fraction: cast.remaining / Math.max(cast.total, 1),
    tone: 'danger',
    school: 'shadow',
  };
}

/** A mechanic's cast ANCHOR is also its live cast: it re-arms the cadence and draws the bar. */
function liveCastOf(mechanic, cast) {
  if (cast === null) {
    return null;
  }
  const matched = (mechanic.anchor ?? []).some(
    (one) => one.kind === 'cast' && one.id === cast.ability,
  );
  if (matched) {
    return cast;
  }
  return null;
}

function mechanicRow(row, mechanic, entity, cast) {
  const timer = pull.timers[mechanic.id];
  const live = liveCastOf(mechanic, cast);
  if (live !== null) {
    return liveRow(mechanic, live);
  }
  if (mechanic.charge === true) {
    return chargedRow(row, mechanic, timer, entity);
  }
  return predictionRow(row, mechanic, timer, entity);
}

function mechanicRows(row, entity, phase) {
  const cast = bossCast(entity);
  const rows = [];
  for (const mechanic of row.mechanics) {
    if (mechanicShown(mechanic, entity, phase) && pull.timers[mechanic.id] !== undefined) {
      rows.push(mechanicRow(row, mechanic, entity, cast));
    }
  }
  return rows;
}

/**
 * The objects' names with the words they all share dropped from the end.
 *
 * A banner has about a second of a player's attention mid-fight, so it carries the word that
 * TELLS THEM APART and not the word they have in common: three stones called Left, Right and
 * Threshold Wardstone are Left, Right and Threshold. Derived from the set rather than from a
 * rule about names, so a set with nothing in common keeps its full names.
 */
function shortLabels(names) {
  const parts = names.map((name) => name.split(' '));
  // `every` is true on an empty list, so without the length check the loop reads `parts[0]`
  // of nothing.
  while (parts.length > 0 && parts.every((one) => one.length > 1)) {
    const tail = parts[0].at(-1);
    if (!parts.every((one) => one.at(-1) === tail)) {
      break;
    }
    for (const one of parts) {
      one.pop();
    }
  }
  return parts.map((one) => one.join(' '));
}

/**
 * A COSMETIC derivation, the only one in this file: the conduits are named for their corner
 * in snake_case, so `north_west` becomes `North West`.
 */
const WORD_BREAK = /[\s_]+/;

function humanLabel(name) {
  return name
    .split(WORD_BREAK)
    .filter((word) => word.length > 0)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

function startChannelWatch(block) {
  // Left to right, which is the order a player reads them across the room.
  const objects = livingOf(block.objectTemplateId).sort((a, b) => a.pos.x - b.pos.x);
  const short = shortLabels(objects.map((object) => object.name));
  pull.channels = {
    startedAt: woc.now(),
    slots: objects.map((object, index) => ({
      id: object.id,
      name: object.name,
      short: short[index] ?? object.name,
      holderId: null,
      remaining: null,
      doneBy: null,
      touchedBy: new Set(),
    })),
  };
}

function slotUnder(entity, slots, reach) {
  let nearest = null;
  let best = reach;
  for (const slot of slots) {
    const object = woc.world.entities.get(slot.id);
    if (object !== undefined && apart(entity.pos, object.pos) <= best) {
      best = apart(entity.pos, object.pos);
      nearest = slot;
    }
  }
  return nearest;
}

/**
 * Rebuilt from scratch every pass rather than tracked incrementally: a channel that breaks
 * fires no event, so anything remembering a holder would keep showing one after they died,
 * were stunned or walked out of range, which is the exact case this block exists for.
 */
function readChannels(block) {
  const { slots } = pull.channels;
  const before = slots.map((slot) => ({ holderId: slot.holderId, remaining: slot.remaining }));
  for (const slot of slots) {
    slot.holderId = null;
    slot.remaining = null;
  }
  for (const [id, cast] of woc.world.casts) {
    const entity = woc.world.entities.get(id);
    if (cast.ability === block.channelCast && entity !== undefined) {
      const slot = slotUnder(entity, slots, block.reach);
      if (slot !== null) {
        slot.holderId = id;
        slot.remaining = cast.remaining;
        slot.touchedBy.add(id);
      }
    }
  }
  noteCompleted(slots, before);
}

/**
 * A channel that has just vanished either finished or broke, and the difference decides
 * whether the raid still has to answer this object. Without it a done object reads exactly
 * like one nobody ever touched, which sends somebody to a stone that is already held while
 * the empty one keeps the same row.
 */
function noteCompleted(slots, before) {
  slots.forEach((slot, index) => {
    const was = before[index];
    const left = was?.remaining;
    const vanished =
      slot.holderId === null && was?.holderId !== null && was?.holderId !== undefined;
    if (vanished && slot.doneBy === null && typeof left === 'number' && left <= DONE_SECONDS) {
      slot.doneBy = was.holderId;
    }
  });
}

/** Done objects are not unheld, which is what keeps them out of the banner and the outcome. */
function unheldSlots() {
  return pull.channels.slots.filter((slot) => slot.holderId === null && slot.doneBy === null);
}

/**
 * A `distinct` block needs a different player per object, so a second one taken by somebody
 * who already held one does not count and nothing on screen says so.
 */
function duplicateHolders() {
  const seen = new Map();
  for (const slot of pull.channels.slots) {
    for (const id of slot.touchedBy) {
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => nameOf(id));
}

function closeChannelWatch(block, interrupted) {
  const unheld = [];
  if (!interrupted) {
    unheld.push(...unheldSlots().map((slot) => slot.name));
  }
  const duplicates = [];
  if (block.distinct === true) {
    duplicates.push(...duplicateHolders());
  }
  pull.outcome = { at: woc.now(), interrupted, unheld, duplicates };
  pull.channels = null;
}

function trackChannels(block, entity) {
  const cast = bossCast(entity);
  if (cast !== null && cast.ability === block.duringCast) {
    if (pull.channels === null) {
      startChannelWatch(block);
    }
    readChannels(block);
    channelAlert(cast);
    return;
  }
  if (pull.channels !== null) {
    // Early is the one unambiguous signal available: the game clears this cast before its
    // full length only when every channel landed, on as many different people as it required.
    const ran = woc.now() - pull.channels.startedAt;
    closeChannelWatch(block, ran < block.castSeconds * MS);
  }
}

function channelRow(slot, block) {
  if (slot.holderId === null && slot.doneBy !== null) {
    return {
      id: String(slot.id),
      label: slot.name,
      detail: nameOf(slot.doneBy),
      value: 'DONE',
      fraction: 1,
    };
  }
  if (slot.holderId === null) {
    return {
      id: String(slot.id),
      label: slot.name,
      detail: 'nobody channelling',
      value: 'UNHELD',
      tone: 'danger',
    };
  }
  const left = slot.remaining ?? 0;
  return {
    id: String(slot.id),
    label: slot.name,
    detail: nameOf(slot.holderId),
    value: `${left.toFixed(DECIMALS)}s`,
    fraction: left / Math.max(block.channelSeconds, 1),
    tone: 'warn',
  };
}

function describeUnheld(unheld) {
  if (unheld.length === 0) {
    return 'every one was held, so a channel broke';
  }
  return unheld.join(', ');
}

function outcomeRows() {
  const { outcome } = pull;
  if (outcome === null || woc.now() - outcome.at > POSTMORTEM_MS) {
    return [];
  }
  const rows = [];
  if (outcome.interrupted) {
    rows.push({ id: 'outcome', label: 'Interrupted', detail: 'every channel landed' });
  } else {
    rows.push({
      id: 'outcome',
      label: 'Resolved',
      detail: `unheld: ${describeUnheld(outcome.unheld)}`,
      tone: 'danger',
    });
  }
  if (outcome.duplicates.length > 0) {
    rows.push({
      id: 'duplicates',
      label: 'Two at once, one player',
      detail: `${outcome.duplicates.join(', ')}: only distinct players count`,
      tone: 'warn',
    });
  }
  return rows;
}

/**
 * Three rows where the encounter has four objects reads as a complete answer, and an object
 * out of interest range cannot be read at all, so the count says so rather than the list
 * quietly standing in for it.
 */
function rangeRow(declared, shown) {
  if (typeof declared !== 'number' || declared <= shown) {
    return null;
  }
  return {
    id: 'out-of-range',
    label: `${String(shown)} of ${String(declared)} in range`,
    detail: 'the rest are too far away to read',
    tone: 'warn',
  };
}

function channelsBlockRows(block) {
  if (pull.channels === null) {
    return outcomeRows();
  }
  const rows = pull.channels.slots.map((slot) => channelRow(slot, block));
  const short = rangeRow((block.objects ?? []).length, rows.length);
  if (short !== null) {
    rows.push(short);
  }
  return rows;
}

/**
 * Built from party ROWS rather than entities so a mark on somebody across the room still
 * reads: a row exists for every member and carries a position. The exact remaining time comes
 * off the entity when there is one, since a row's strip is whole seconds.
 */
function carriersOf(auraId) {
  const found = [];
  for (const row of roster()) {
    const [compact] = woc.world.partyAuras(row.pid, { id: auraId });
    if (compact !== undefined) {
      const exact = auraOn(woc.world.entities.get(row.pid), auraId);
      found.push({
        pid: row.pid,
        name: row.name,
        x: row.x,
        z: row.z,
        remaining: exact?.remaining ?? compact.remaining ?? null,
        aura: exact,
      });
    }
  }
  return found;
}

/** Counting itself, because that is the divisor the game applies. */
function stackedWith(mark, marks, block) {
  return marks.filter((other) => apart(mark, other) <= block.stackRange).length;
}

function markShare(stacked, block) {
  let mult = 1;
  if (heroic()) {
    mult = block.heroicMult ?? 1;
  }
  return mult / Math.max(stacked, 1);
}

function markRow(mark, marks, block) {
  const stacked = stackedWith(mark, marks, block);
  const share = asPercent(markShare(stacked, block));
  const row = {
    id: String(mark.pid),
    label: mark.name,
    detail: `${String(stacked)} stacked, ${share} of health each`,
    fraction: 0,
  };
  if (stacked === 1) {
    row.detail = `alone, ${share} of health`;
    row.tone = 'danger';
  }
  if (mark.remaining !== null) {
    row.value = `${mark.remaining.toFixed(0)}s`;
    row.fraction = mark.remaining / Math.max(block.durationSeconds, 1);
  }
  return row;
}

function marksBlockRows(block) {
  const marks = carriersOf(block.aura);
  if (marks.length > block.count) {
    noteHeroic();
  }
  markAlert(marks, block);
  return marks.map((mark) => markRow(mark, marks, block));
}

/**
 * Measured against the WHOLE roster, not the other carriers: Ignivar's brand pulses on any
 * pair inside its radius, marked or not.
 */
function nearestOther(carrier) {
  let best = null;
  for (const row of roster()) {
    const gap = apart(carrier, row);
    if (row.pid !== carrier.pid && (best === null || gap < best.gap)) {
      best = { name: row.name, gap };
    }
  }
  return best;
}

function crowdingDetail(carrier, block) {
  const near = nearestOther(carrier);
  if (near === null) {
    return { detail: 'nobody else in the group is near enough to read' };
  }
  if (near.gap <= block.apart) {
    return { detail: `${near.name} is ${near.gap.toFixed(DECIMALS)}yd away`, tone: 'danger' };
  }
  return { detail: `${block.note ?? 'clear'} ${String(block.apart)}yd` };
}

/**
 * No `durationSeconds` is a decision: a mark removed by an action rather than by expiring has
 * no share to draw, and a bar under it would sit full all fight.
 */
function debuffRow(carrier, block) {
  const row = { id: String(carrier.pid), label: carrier.name, detail: block.note ?? '' };
  if (block.apart !== undefined) {
    Object.assign(row, crowdingDetail(carrier, block));
  }
  if (typeof block.durationSeconds === 'number' && carrier.remaining !== null) {
    row.value = `${carrier.remaining.toFixed(0)}s`;
    row.fraction = carrier.remaining / Math.max(block.durationSeconds, 1);
  }
  return row;
}

function debuffsBlockRows(block) {
  const carriers = carriersOf(block.aura);
  return carriers.map((carrier) => debuffRow(carrier, block));
}

/**
 * The game puts the bodies it wants in `stacks` and the damage it will split in `value2`, so
 * both are read off the AURA. The table's copies are the fallback for a carrier outside
 * interest range, where only the party strip's compact aura is available.
 */
function soakRow(carrier, block) {
  const { aura } = carrier;
  const wanted = aura?.stacks ?? block.required;
  const total = aura?.value2 ?? block.total;
  const soakers = roster().filter((one) => apart(carrier, one) <= block.radius).length;
  const row = {
    id: String(carrier.pid),
    label: carrier.name,
    value: `${String(soakers)} of ${String(wanted)}`,
    fraction: soakers / Math.max(wanted, 1),
    detail: `${asPercent(total / Math.max(soakers, 1))} of health each`,
  };
  if (soakers < wanted) {
    const missing = wanted - soakers;
    const raid = asPercent(missing * (block.perMissing ?? 0));
    row.detail = `${row.detail}, and ${raid} to everyone`;
    row.tone = 'danger';
  }
  return row;
}

function soakBlockRows(block) {
  const carriers = carriersOf(block.aura);
  const rows = carriers.map((carrier) => soakRow(carrier, block));
  soakAlert(carriers, block);
  return rows;
}

/** Which of a station's three template ids it is wearing, which is the whole of its state. */
function stationState(entity, block) {
  if (entity.templateId === block.active) {
    return 'active';
  }
  if (entity.templateId === block.ready) {
    return 'ready';
  }
  return 'spent';
}

/**
 * A station's TEMPLATE changes and the id is an identity field, diffed per tick and
 * re-broadcast on change, so the swap reaches every viewer in range; that re-send is the edge
 * the countdown stands on.
 */
function stationsSeen(block) {
  const found = [
    ...livingOf(block.ready),
    ...livingOf(block.active),
    ...livingOf(block.spent),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const short = shortLabels(found.map((one) => one.name));
  return found.map((entity, index) => {
    const state = stationState(entity, block);
    const key = `station:${String(entity.id)}`;
    const edge = edgeOf(key, state === 'active');
    if (edge.rising) {
      pull.stations.set(entity.id, woc.now());
    }
    return { entity, state, label: humanLabel(short[index] ?? entity.name) };
  });
}

/**
 * A live station's own seconds are NOT on the wire, so this counts from the swap this addon
 * saw, and a station already running on arrival says so instead of inventing one.
 */
function activeStationRow(station, block) {
  const startedAt = pull.stations.get(station.entity.id);
  if (startedAt === undefined) {
    return {
      id: String(station.entity.id),
      label: station.label,
      detail: 'running, started before this was watching',
      value: 'LIVE',
      tone: 'warn',
    };
  }
  const left = Math.max(block.activeSeconds - (woc.now() - startedAt) / MS, 0);
  return {
    id: String(station.entity.id),
    label: station.label,
    detail: block.use ?? '',
    value: `~${left.toFixed(DECIMALS)}s`,
    fraction: left / Math.max(block.activeSeconds, 1),
    tone: 'warn',
  };
}

function stationRow(station, block) {
  if (station.state === 'active') {
    return activeStationRow(station, block);
  }
  if (station.state === 'ready') {
    return {
      id: String(station.entity.id),
      label: station.label,
      detail: 'waiting to be lit',
      value: 'READY',
    };
  }
  return {
    id: String(station.entity.id),
    label: station.label,
    detail: 'used up for this attempt',
    value: 'SPENT',
  };
}

function stationsBlockRows(block) {
  const stations = stationsSeen(block);
  const rows = stations.map((station) => stationRow(station, block));
  const short = rangeRow(block.count, rows.length);
  if (short !== null) {
    rows.push(short);
  }
  return rows;
}

function describeRemaining(remaining) {
  if (remaining === null || remaining === undefined) {
    return 'holding';
  }
  return `${String(remaining)}s`;
}

/**
 * The stack counter is keyed to the boss's target rather than to the aura, so a taunt resets
 * it while the previous tank keeps their own aura for its full duration. Swapping back before
 * that expires is the mistake, which is why the other tank's residual is drawn rather than a
 * bare instruction to swap.
 */
function reliefRow(tankPid, block) {
  const other = roster().find((row) => row.role === 'tank' && row.pid !== tankPid);
  if (other === undefined) {
    return null;
  }
  const [held] = woc.world.partyAuras(other.pid, { id: block.aura });
  if (held === undefined) {
    return { id: 'relief', label: other.name, detail: 'clear, can take it', value: 'ready' };
  }
  return {
    id: 'relief',
    label: other.name,
    detail: 'still carrying their own stacks',
    value: describeRemaining(held.remaining),
    tone: 'warn',
  };
}

/** A share of the declared maximum, so the setting means the same on any encounter. */
function warnStacks(block) {
  return (woc.settings['tank-warn'] / PERCENT) * block.maxStacks;
}

function toneForStacks(stacks, block) {
  if (stacks >= warnStacks(block)) {
    return 'danger';
  }
  return 'warn';
}

/**
 * `value` is the count and `detail` is what it is worth: the count is the number a group
 * calls a swap on and the percentage is what makes the case for it.
 */
function tankStacksBlockRows(block, entity) {
  const tank = tankEntity(entity);
  const curse = auraOn(tank, block.aura);
  if (curse === null) {
    return [];
  }
  if (block.heroicOnly === true) {
    noteHeroic();
  }
  const stacks = curse.stacks ?? 1;
  tankAlert(tank, stacks, block);
  const rows = [
    {
      id: 'tank',
      label: tank.name,
      detail: `+${asPercent(stacks * block.perStack)} damage taken`,
      value: `${String(stacks)} stacks`,
      fraction: stacks / Math.max(block.maxStacks, 1),
      tone: toneForStacks(stacks, block),
    },
  ];
  const relief = reliefRow(tank.id, block);
  if (relief !== null) {
    rows.push(relief);
  }
  return rows;
}

function toneForAnswer(answer) {
  if (answer === 'interrupt') {
    return 'danger';
  }
  if (answer === 'kill') {
    return 'default';
  }
  return 'warn';
}

/**
 * An add whose CAST is the thing to race: it channels a raid wipe, so the cast bar is the
 * headline and its health the supporting figure.
 */
function addCountdownRow(add, entity) {
  const cast = woc.world.casts.get(entity.id);
  if (cast === undefined) {
    return null;
  }
  return {
    id: String(entity.id),
    label: entity.name,
    detail: `${asPercent(healthFraction(entity))} health, ${add.note ?? add.answer}`,
    value: `${cast.remaining.toFixed(DECIMALS)}s`,
    fraction: cast.remaining / Math.max(cast.total, 1),
    tone: 'danger',
  };
}

function addRow(add, entity) {
  if (add.castCountdown === true) {
    const racing = addCountdownRow(add, entity);
    if (racing !== null) {
      return racing;
    }
  }
  return {
    id: String(entity.id),
    label: entity.name,
    detail: add.note ?? add.answer,
    value: asPercent(healthFraction(entity)),
    fraction: healthFraction(entity),
    tone: toneForAnswer(add.answer),
  };
}

/**
 * Table order rather than health or distance: several adds can look nearly identical on
 * screen and want different things done to them, and the one that cannot be out-damaged has
 * to be the row read first.
 */
function addsBlockRows(block) {
  const rows = [];
  for (const add of block.rows ?? []) {
    for (const entity of livingOf(add.templateId)) {
      if (add.heroicTell === true) {
        noteHeroic();
      }
      interruptAlert(add, entity);
      rows.push(addRow(add, entity));
    }
  }
  return rows;
}

/** Drawn only inside `GATE_BAND` above the threshold, and off the game's own bar while it casts. */
function gateRow(gate, entity) {
  const cast = bossCast(entity);
  if (gate.cast !== undefined && cast !== null && cast.ability === gate.cast) {
    return {
      id: gate.id,
      label: gate.name,
      detail: gate.detail ?? '',
      value: `${cast.remaining.toFixed(DECIMALS)}s`,
      fraction: cast.remaining / Math.max(cast.total, 1),
      tone: 'danger',
    };
  }
  const left = healthFraction(entity);
  if (left <= gate.hp || left - gate.hp > GATE_BAND) {
    return null;
  }
  return {
    id: gate.id,
    label: gate.name,
    detail: gate.detail ?? '',
    value: `at ${asPercent(gate.hp)}`,
    fraction: left,
    tone: 'warn',
  };
}

function gatesBlockRows(block, entity) {
  const rows = [];
  for (const gate of block.rows ?? []) {
    const row = gateRow(gate, entity);
    if (row !== null) {
      rows.push(row);
    }
  }
  return rows;
}

/**
 * The one state on a fight nothing is DONE about, which is why it is drawn from the boss's
 * own health rather than from a clock: knowing it is close is the whole of the answer.
 *
 * The aura runs to the end of the fight once it lands, so the call is made on it ARRIVING.
 * Made on its presence it would be the same call every re-warn floor until the boss died.
 */
function enragedRow(block, entity, aura) {
  const left = healthFraction(entity);
  enrageAlert(left);
  const row = {
    id: 'enrage',
    label: block.name,
    detail: `${asPercent(left)} left`,
    value: 'ENRAGED',
    fraction: left,
    tone: 'danger',
  };
  // Where the table says `countdown`, the enrage ends in a wipe and the game keeps the length
  // on the aura itself, so the row draws those seconds rather than a health share.
  if (block.countdown === true && typeof aura.remaining === 'number') {
    row.value = `${aura.remaining.toFixed(0)}s`;
    row.detail = `${asPercent(left)} left, then the raid dies`;
    row.fraction = aura.remaining / Math.max(block.seconds ?? 1, 1);
  }
  return row;
}

function enrageBlockRows(block, entity) {
  const aura = auraOn(entity, block.aura);
  if (aura !== null) {
    return [enragedRow(block, entity, aura)];
  }
  const left = healthFraction(entity);
  if (left > block.hp * ENRAGE_WATCH_MULT) {
    return [];
  }
  return [
    {
      id: 'enrage',
      label: block.name,
      detail: `at ${asPercent(block.hp)}`,
      value: asPercent(left),
      fraction: left,
      tone: 'warn',
    },
  ];
}

const BLOCK_RENDERERS = new Map([
  ['channels', (block) => channelsBlockRows(block)],
  ['marks', (block) => marksBlockRows(block)],
  ['debuffs', (block) => debuffsBlockRows(block)],
  ['soak', (block) => soakBlockRows(block)],
  ['stations', (block) => stationsBlockRows(block)],
  ['tankStacks', (block, entity) => tankStacksBlockRows(block, entity)],
  ['adds', (block) => addsBlockRows(block)],
  ['gates', (block, entity) => gatesBlockRows(block, entity)],
  ['enrage', (block, entity) => enrageBlockRows(block, entity)],
]);

function outranks(next, held) {
  if (held === null || woc.now() >= held.until) {
    return true;
  }
  return ALERT_RANK.indexOf(next) < ALERT_RANK.indexOf(held.key);
}

/** `large` is kept for the ones that end the pull: if everything is large then nothing is. */
function sizeFor(lethal) {
  if (lethal) {
    return 'large';
  }
  return 'normal';
}

/**
 * Answers whether the call was actually MADE, because a caller that has to remember it has
 * spoken must not remember a banner the slot refused.
 *
 * `floor` separates the re-warn floor from the RANK, which is what lets several mechanics
 * share one place in the order without sharing one throttle: two of them coming due inside
 * eight seconds is the ordinary case at a phase change.
 */
function warn(alert) {
  const { key, text, detail, lethal } = alert;
  const floor = alert.floor ?? key;
  // The banner is the one surface that draws over the middle of the game rather than in a
  // panel the player parked, so it is worth switching off on its own.
  if (!woc.settings.alerts) {
    return false;
  }
  const now = woc.now();
  // Every caller runs on a frame handler, so without this floor one call is sixty banners.
  if (now - (pull.firedAt.get(floor) ?? -REWARN_MS) < REWARN_MS) {
    return false;
  }
  if (!outranks(key, pull.alert)) {
    return false;
  }
  pull.firedAt.set(floor, now);
  pull.alert = { key, until: now + BANNER_MS };
  woc.ui.banner(text, {
    detail,
    timeout: BANNER_MS,
    kind: 'warn',
    size: sizeFor(lethal),
  });
  if (woc.settings.cue) {
    woc.sound.alert();
  }
  return true;
}

/**
 * The big line is the ACTION or the thing to look at, and the quiet line is who and how long.
 * A banner read mid-fight is read in about a second, so a sentence there is a sentence nobody
 * finishes.
 */
function channelAlert(cast) {
  if (cast.remaining > woc.settings['alert-lead']) {
    return;
  }
  const unheld = unheldSlots();
  if (unheld.length > 0) {
    warn({
      key: 'channels',
      text: `${unheld.map((slot) => slot.short).join(' + ')} UNHELD`,
      detail: `${cast.remaining.toFixed(0)}s`,
      lethal: true,
    });
  }
}

/**
 * Names players who may have no addon at all, which is why it is worth a banner. Your own
 * name comes first and reads as "You", because whether it is on you is the one thing you need
 * off this banner before you read any other word of it.
 */
function markAlert(marks, block) {
  if (marks.length === 0) {
    return;
  }
  const alone = marks.some((mark) => stackedWith(mark, marks, block) === 1);
  warn({
    key: 'marks',
    text: 'STACK',
    detail: markNames(marks),
    lethal: heroic() && alone,
  });
}

function markNames(marks) {
  const me = woc.world.player?.id;
  const mine = marks.filter((mark) => mark.pid === me);
  const others = marks.filter((mark) => mark.pid !== me).map((mark) => mark.name);
  if (mine.length === 0) {
    return others.join(', ');
  }
  return ['You', ...others].join(', ');
}

function soakAlert(carriers, block) {
  for (const carrier of carriers) {
    const wanted = carrier.aura?.stacks ?? block.required;
    const soakers = roster().filter((row) => apart(carrier, row) <= block.radius).length;
    const left = carrier.remaining;
    const late = left === null || left <= woc.settings['alert-lead'];
    if (soakers < wanted && late) {
      warn({
        key: 'soak',
        text: `SOAK ${carrier.name}`,
        detail: `${String(soakers)} of ${String(wanted)}`,
        lethal: true,
      });
    }
  }
}

/**
 * The game's `quietMechanics` flag silences an add's barks, so a lethal channel on an add
 * nobody is targeting has a cast bar and no other notice at all.
 */
function interruptAlert(add, entity) {
  if (typeof add.interruptCast !== 'string') {
    return;
  }
  const cast = woc.world.casts.get(entity.id);
  if (cast !== undefined && cast.ability === add.interruptCast) {
    warn({ key: 'interrupt', text: 'INTERRUPT', detail: entity.name, lethal: false });
  }
}

function tankAlert(tank, stacks, block) {
  if (stacks >= warnStacks(block)) {
    warn({
      key: 'tank',
      text: 'TAUNT',
      detail: `${tank.name}, ${String(stacks)} stacks`,
      lethal: false,
    });
  }
}

function enrageAlert(left) {
  // Compared rather than tested, for the reason `heroic()` is: the latch is initialised to a
  // literal `false`, so a bare truthiness check reads to the linter as never satisfiable.
  if (pull.enraged === true) {
    return;
  }
  pull.enraged = true;
  warn({ key: 'enrage', text: 'ENRAGED', detail: `${asPercent(left)} left`, lethal: false });
}

/** The row's timer if it is inside the lead and has not been called for this arming. */
function uncalled(row, lead) {
  const timer = pull.timers[row.id];
  if (timer === undefined || typeof row.seconds !== 'number' || row.seconds > lead) {
    return null;
  }
  if (pull.announced.get(row.id) === timer.cycle) {
    return null;
  }
  return timer;
}

/**
 * One call per ARMED CYCLE per mechanic, rather than one per re-warn floor.
 *
 * A prediction that has run out stays on screen at zero, honestly: the game defers a cast
 * while another mechanic is unresolved and retries every second. Saying so again every eight
 * seconds for the rest of the pull is the same call over and over about something the raid
 * has already been told is due.
 *
 * The cycle is recorded only where the banner was actually SHOWN, so a call the slot refused
 * to a louder one is still owed and is made when that one has had its four seconds.
 */
function mechanicAlert(rows) {
  const lead = woc.settings['alert-lead'];
  for (const row of rows) {
    const timer = uncalled(row, lead);
    if (timer !== null) {
      const floor = `mechanic:${row.id}`;
      if (warn({ key: 'mechanic', floor, text: row.label, detail: row.detail, lethal: false })) {
        pull.announced.set(row.id, timer.cycle);
      }
      return;
    }
  }
}

/**
 * `ability` is a display NAME rather than an id, and matching on one is safe only because the
 * game CARRIES the label on the record rather than it being derived here. These reach this
 * client because they land on the group, which is the whole raid in a boss room.
 *
 * A raid wipe arrives here and nowhere else: ordinary damage of a hundred times a player's
 * health under the mechanic's own label, with no lifecycle event beside it.
 */
woc.net.onEvent('damage', (event) => {
  const found = pullSubject();
  if (found === null) {
    return;
  }
  if ((found.row.wipes ?? []).some((one) => one.ability === event.ability)) {
    lastResult = { at: woc.now(), text: `${found.row.name} wiped the raid on ${event.ability}.` };
  }
  armAnchored(found.row, found.entity, 'damage', event.ability);
});

/**
 * The brand's damage label is worn by its tick and its proximity pulse too, so damage would
 * re-arm it several times a second; the aura gain is the one clean edge.
 */
woc.net.onEvent('aura', (event) => {
  const found = pullSubject();
  if (found !== null && event.gained) {
    armAnchored(found.row, found.entity, 'partyAura', event.name);
  }
});

/**
 * A boss's own line is the only EXACT pull edge the wire carries. It is range-gated, so a
 * player out of yell range gets unseeded clocks and the health backstop still catches the
 * fight starting.
 */
woc.net.onEvent('chat', (event) => {
  if (event.channel !== 'yell') {
    return;
  }
  const found = activeNow();
  if (found === null || event.entityId !== found.entity.id) {
    return;
  }
  const yell = (found.row.yells ?? []).find((one) => one.text === event.text);
  if (yell?.edge === 'pull') {
    notePullYell(found);
  }
  if (yell?.edge === 'kill') {
    lastResult = { at: woc.now(), text: `${found.row.name} is down.` };
  }
});

function notePullYell(found) {
  pullYellFor = found.entity.id;
  if (pull !== null && pull.bossId === found.entity.id && !pull.seeded) {
    seedPull(found.row);
  }
}

const frame = woc.ui.frame({
  id: 'raid',
  title: 'Raid',
  width: FRAME_WIDTH,
  height: FRAME_HEIGHT,
  density: 'compact',
  save: true,
  resizable: true,
  minWidth: MIN_FRAME_WIDTH,
  minHeight: MIN_FRAME_HEIGHT,
  toggleKey: 'toggle',
});

const body = woc.ui.column({ parent: frame.body });
const emptyLine = woc.ui.line({ parent: body, tone: 'muted' });

function barRow(bar, row) {
  bar.update({
    label: row.label,
    detail: row.detail ?? '',
    value: row.value ?? '',
    fraction: row.fraction ?? 0,
    tone: row.tone ?? 'default',
    school: row.school ?? null,
  });
}

function createRow(row) {
  const bar = woc.ui.bar();
  bar.el.dataset.row = row.id;
  return bar;
}

/**
 * One section per KIND rather than per encounter, so the DOM does not churn when a pull ends
 * and the layout is the same fight to fight. The heading is whatever the active encounter
 * calls that block.
 */
function section(id, parent) {
  const wrap = woc.ui.column({ parent });
  wrap.dataset.block = id;
  const heading = woc.ui.line({ parent: wrap, tone: 'muted' });
  const rows = woc.ui.list({
    parent: woc.ui.column({ parent: wrap }),
    key: (row) => row.id,
    create: createRow,
    update: barRow,
  });
  return { wrap, heading, rows };
}

const mechanicSection = section('mechanics', body);
/** Held open here so the sections built after the table is read land above `note`. */
const blocksHost = woc.ui.column({ parent: body });
const note = woc.ui.line({ parent: body, tone: 'muted' });

/**
 * Built once the table is read because an encounter may declare a kind twice (Varkhul has two
 * debuff blocks), and one section per kind would draw the second over the first. The count is
 * the widest any encounter needs, so switching fights never rebuilds.
 */
const blockSections = new Map();

function buildSections(rows) {
  for (const kind of BLOCK_ORDER) {
    const needed = Math.max(0, ...rows.map((row) => countOfKind(row, kind)));
    const made = [];
    for (let index = 0; index < needed; index += 1) {
      made.push(section(sectionId(kind, index), blocksHost));
    }
    blockSections.set(kind, made);
  }
}

function countOfKind(row, kind) {
  return (row.blocks ?? []).filter((block) => block.kind === kind).length;
}

/** The first of a kind keeps the bare name, so a selector for a single block is unchanged. */
function sectionId(kind, index) {
  if (index === 0) {
    return kind;
  }
  return `${kind}-${String(index + 1)}`;
}

/** A block with nothing to say takes its heading with it, so the frame fits the fight. */
function fill(block, label, rows) {
  const shown = rows.length > 0;
  woc.ui.show(block.wrap, shown);
  if (shown) {
    block.heading.textContent = label;
  }
  block.rows.sync(rows);
}

function hideAll() {
  mechanicSection.rows.clear();
  woc.ui.show(mechanicSection.wrap, false);
  for (const made of blockSections.values()) {
    for (const block of made) {
      block.rows.clear();
      woc.ui.show(block.wrap, false);
    }
  }
  woc.ui.show(note, false);
}

/** Which silence this is, because an empty panel reads as a measurement of nothing. */
function drawIdle(reason) {
  pull = null;
  emptyLine.textContent = idleLine(reason);
  woc.ui.show(emptyLine, true);
  hideAll();
}

/**
 * A kill and a wipe both take the boss out of the readable state within seconds, so without
 * this the panel answers "did that work" by going blank.
 */
function idleLine(reason) {
  if (lastResult !== null && woc.now() - lastResult.at <= POSTMORTEM_MS) {
    return `${lastResult.text} ${reason}`;
  }
  return reason;
}

/**
 * Built whatever the setting says, because building a block is what notices a heroic tell and
 * what raises that block's alert. A setting that hides a panel must not also silence the
 * warnings the panel would have justified, or it does something its label does not say.
 */
function buildBlocks(row, entity) {
  const built = [];
  const taken = new Map();
  for (const block of row.blocks ?? []) {
    const render = BLOCK_RENDERERS.get(block.kind);
    const at = taken.get(block.kind) ?? 0;
    taken.set(block.kind, at + 1);
    if (render === undefined || (blockSections.get(block.kind)?.length ?? 0) <= at) {
      woc.warn(`no renderer for block kind '${String(block.kind)}', so it is not drawn`);
    } else {
      built.push({ kind: block.kind, at, label: block.label, rows: render(block, entity) });
    }
  }
  return built;
}

function paintBlocks(built) {
  const drawn = new Set();
  for (const one of built) {
    const target = blockSections.get(one.kind)?.[one.at];
    if (target !== undefined) {
      drawn.add(sectionId(one.kind, one.at));
      fill(target, one.label, one.rows);
    }
  }
  for (const [kind, made] of blockSections) {
    made.forEach((target, index) => {
      if (!drawn.has(sectionId(kind, index))) {
        fill(target, '', []);
      }
    });
  }
}

/** Channels is the one kind whose state has to be tracked across frames. */
function trackBlocks(row, entity) {
  for (const block of row.blocks ?? []) {
    if (block.kind === 'channels') {
      trackChannels(block, entity);
    }
  }
}

function trackFight(row, entity, phase) {
  trackPhase(row, phase);
  trackBlocks(row, entity);
  trackSpawns(row, entity);
  trackCasts(row, entity);
  trackHazards(row, entity);
  trackBossAnchors(row, entity);
  trackReseeds(row, entity);
}

function drawFight(row, entity) {
  const phase = phaseOf(row, entity);
  trackFight(row, entity, phase);
  const rows = mechanicRows(row, entity, phase);
  const showMechanics = woc.settings.mechanics && rows.length > 0;
  woc.ui.show(mechanicSection.wrap, showMechanics);
  if (showMechanics) {
    mechanicSection.heading.textContent = row.name;
    mechanicSection.rows.sync(rows);
  }
  const built = buildBlocks(row, entity);
  mechanicAlert(rows);
  if (woc.settings.state) {
    paintBlocks(built);
  } else {
    paintBlocks([]);
  }
  woc.ui.show(emptyLine, false);
  note.textContent = ASSUMED_NORMAL;
  woc.ui.show(note, !heroic());
}

woc.onFrame(() => {
  const now = woc.now();
  const elapsed = now - lastTick;
  lastTick = now;
  const found = activeNow();
  if (found === null) {
    // Not merely "no pull": a boss out of range says nothing about whether one is under way,
    // so a player who zones into a fight must not read as having watched it start.
    idleBossId = null;
    drawIdle('No encounter this addon knows is in range.');
    return;
  }
  if (!engaged(found.entity)) {
    idleBossId = found.entity.id;
    drawIdle(`${found.row.name} is not in combat.`);
    return;
  }
  if (pull === null || pull.bossId !== found.entity.id || encounterReset(found.entity)) {
    startPull(found);
  }
  holdTimers(found.row, found.entity, elapsed);
  drawFight(found.row, found.entity);
});

/** Everything above is wired before this await, or a handler would miss what landed during it. */
async function boot() {
  encounters = readTable(await woc.data(TABLE_FILE));
  if (encounters.length === 0) {
    throw new Error(`${TABLE_FILE} carries no encounter this can read`);
  }
  buildSections(encounters);
}

boot().catch((err) => {
  woc.error('could not read the encounter table, so there is nothing to time', err);
});
