/// <reference types="@woc-addons/types" />

// Tocsin: what a raid encounter is about to do, and what the group has to answer.
//
// Nothing about one encounter is written here. The shipped table declares each encounter's
// mechanics and the block KINDS its state is made of, and this file carries one renderer per
// kind, so a second encounter reusing a shape is a table change alone.
//
// Two readings are inferences and both say so on screen. DIFFICULTY is not on the wire, so
// heroic is latched from a tell and until one lands the figures are the normal ones. A
// CHANNEL's outcome has no completion flag: the live reading is a fact, and the post-mortem
// is read from the boss's cast ending early, which is the game confirming every channel
// landed.
//
// Predictions are only honest because these encounters are SCRIPTED: their driver runs every
// tick, where a template boss counts down on melee contact alone. Nothing here models a
// template boss and it must not be pointed at one.

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
 * handler ran last. An unanswered channel outranks everything because its failure is the
 * whole raid rather than one player.
 */
const ALERT_RANK = ['channels', 'marks', 'interrupt', 'tank', 'mechanic'];

const ASSUMED_NORMAL = 'Normal figures: nothing on the wire says which difficulty this is.';

/** Drawn in this order whatever order the table declares them, so the layout never moves. */
const BLOCK_ORDER = ['channels', 'marks', 'tankStacks', 'adds'];

let encounters = [];
let pull = null;
let lastTick = woc.now();

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

function auraOn(entity, id) {
  return entity?.auras?.find((aura) => aura.id === id) ?? null;
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

function startPull(found) {
  const timers = {};
  for (const mechanic of found.row.mechanics) {
    timers[mechanic.id] = { dueAt: null };
  }
  pull = {
    bossId: found.entity.id,
    encounterId: found.row.id,
    heroic: false,
    transitionSeenAt: null,
    phaseTwoAt: null,
    seenSpawns: new Set(),
    woundedAt: null,
    timers,
    channels: null,
    outcome: null,
    alert: null,
    firedAt: new Map(),
  };
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

function bossCast(entity) {
  return woc.world.casts.get(entity.id) ?? null;
}

/**
 * The transition is an AURA rather than a health fraction, which is what makes it a fact: a
 * fraction is a guess about which side of a threshold one snapshot landed on. The fraction is
 * the fallback for a fight this addon joined after the transition, which is what `phaseTwoAt`
 * distinguishes.
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

/**
 * Every declared condition returns early from the game's own per-tick driver, so nothing in
 * the kit advances while one holds. Counting through them drifts by a whole mechanic a cycle.
 */
function frozen(row, entity) {
  const cast = bossCast(entity);
  for (const condition of row.freeze ?? []) {
    if (condition.kind === 'aura' && auraOn(entity, condition.id) !== null) {
      return true;
    }
    if (condition.kind === 'cast' && cast !== null && cast.ability === condition.id) {
      return true;
    }
  }
  return false;
}

function fired(id, every) {
  const timer = pull?.timers[id];
  if (timer !== undefined) {
    timer.dueAt = woc.now() + every * MS;
  }
}

/** Null means nothing has ever seeded it, which is drawn rather than counted from zero. */
function dueIn(timer) {
  if (timer.dueAt === null) {
    return null;
  }
  return Math.max((timer.dueAt - woc.now()) / MS, 0);
}

function holdTimers(elapsed) {
  for (const timer of Object.values(pull.timers)) {
    if (timer.dueAt !== null) {
      timer.dueAt += elapsed;
    }
  }
}

/** The only way to count the first of a phase down before it has ever been seen fire. */
function seedPhase(row) {
  const now = woc.now();
  for (const [id, seconds] of Object.entries(row.phases?.seeds ?? {})) {
    const timer = pull.timers[id];
    if (timer !== undefined) {
      timer.dueAt = now + seconds * MS;
    }
  }
  pull.phaseTwoAt = now;
}

function trackSpawns(row) {
  for (const mechanic of row.mechanics) {
    const templateId = mechanic.anchor?.spawn;
    if (typeof templateId === 'string') {
      for (const entity of livingOf(templateId)) {
        if (!pull.seenSpawns.has(entity.id)) {
          pull.seenSpawns.add(entity.id);
          fired(mechanic.id, mechanic.every);
        }
      }
    }
  }
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

function predictionRow(mechanic, timer) {
  const left = dueIn(timer);
  if (left === null) {
    return { id: mechanic.id, label: mechanic.label, detail: 'armed, not seen yet', value: '' };
  }
  const row = {
    id: mechanic.id,
    label: mechanic.label,
    detail: mechanic.detail ?? '',
    value: `~${left.toFixed(DECIMALS)}s`,
    fraction: left / Math.max(mechanic.every, 1),
    seconds: left,
  };
  if (left <= IMPACT_SECONDS) {
    row.tone = 'danger';
  }
  return row;
}

/**
 * A charged mechanic never counts to a fire. The game arms it on a timer and then holds the
 * charge through every miss, dodge and parry, so the release is the next landed swing.
 */
function chargedRow(mechanic, timer) {
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
  return predictionRow(mechanic, timer);
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

function mechanicRows(row, entity, phase) {
  const cast = bossCast(entity);
  const rows = [];
  for (const mechanic of row.mechanics) {
    const timer = pull.timers[mechanic.id];
    if (inPhase(mechanic, phase) && timer !== undefined) {
      if (cast !== null && mechanic.liveCast === cast.ability) {
        rows.push(liveRow(mechanic, cast));
      } else if (mechanic.charge === true) {
        rows.push(chargedRow(mechanic, timer));
      } else {
        rows.push(predictionRow(mechanic, timer));
      }
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
  while (parts.every((one) => one.length > 1)) {
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

function channelsBlockRows(block) {
  if (pull.channels === null) {
    return outcomeRows();
  }
  const rows = pull.channels.slots.map((slot) => channelRow(slot, block));
  const declared = (block.objects ?? []).length;
  // Three rows where the encounter has four objects reads as a complete answer. An object out
  // of interest range cannot be read at all, so the count says so rather than the list
  // quietly standing in for it.
  if (declared > rows.length) {
    rows.push({
      id: 'out-of-range',
      label: `${String(rows.length)} of ${String(declared)} in range`,
      detail: 'the rest are too far away to read',
      tone: 'warn',
    });
  }
  return rows;
}

/**
 * Built from party ROWS rather than entities so a mark on somebody across the room still
 * reads: a row exists for every member and carries a position. The exact remaining time comes
 * off the entity when there is one, since a row's strip is whole seconds.
 */
function marksNow(block) {
  const marks = [];
  for (const row of roster()) {
    const [compact] = woc.world.partyAuras(row.pid, { id: block.aura });
    if (compact !== undefined) {
      const exact = auraOn(woc.world.entities.get(row.pid), block.aura);
      marks.push({
        pid: row.pid,
        name: row.name,
        x: row.x,
        z: row.z,
        remaining: exact?.remaining ?? compact.remaining ?? null,
      });
    }
  }
  return marks;
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
  const marks = marksNow(block);
  if (marks.length > block.count) {
    noteHeroic();
  }
  markAlert(marks, block);
  return marks.map((mark) => markRow(mark, marks, block));
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
      rows.push({
        id: String(entity.id),
        label: entity.name,
        detail: add.note ?? add.answer,
        value: asPercent(healthFraction(entity)),
        fraction: healthFraction(entity),
        tone: toneForAnswer(add.answer),
      });
    }
  }
  return rows;
}

const BLOCK_RENDERERS = new Map([
  ['channels', (block) => channelsBlockRows(block)],
  ['marks', (block) => marksBlockRows(block)],
  ['tankStacks', (block, entity) => tankStacksBlockRows(block, entity)],
  ['adds', (block) => addsBlockRows(block)],
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

function warn(alert) {
  const { key, text, detail, lethal } = alert;
  // The banner is the one surface that draws over the middle of the game rather than in a
  // panel the player parked, so it is worth switching off on its own.
  if (!woc.settings.alerts) {
    return;
  }
  const now = woc.now();
  // Every caller runs on a frame handler, so without this floor one call is sixty banners.
  if (now - (pull.firedAt.get(key) ?? -REWARN_MS) < REWARN_MS) {
    return;
  }
  if (!outranks(key, pull.alert)) {
    return;
  }
  pull.firedAt.set(key, now);
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

function mechanicAlert(rows) {
  const lead = woc.settings['alert-lead'];
  for (const row of rows) {
    if (typeof row.seconds === 'number' && row.seconds <= lead) {
      warn({ key: 'mechanic', text: row.label, detail: row.detail, lethal: false });
      return;
    }
  }
}

/**
 * `ability` is a display NAME rather than an id, and matching on one is safe only because the
 * game CARRIES the label on the record rather than it being derived here. These reach this
 * client because they land on the group, which is the whole raid in a boss room.
 */
woc.net.onEvent('damage', (event) => {
  if (pull === null) {
    return;
  }
  const row = encounters.find((one) => one.id === pull.encounterId);
  for (const mechanic of row?.mechanics ?? []) {
    if (mechanic.anchor?.damage === event.ability) {
      fired(mechanic.id, mechanic.every);
    }
  }
});

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
function section(id) {
  const wrap = woc.ui.column({ parent: body });
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

const mechanicSection = section('mechanics');
const blockSections = new Map(BLOCK_ORDER.map((kind) => [kind, section(kind)]));
const note = woc.ui.line({ parent: body, tone: 'muted' });

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
  for (const block of blockSections.values()) {
    block.rows.clear();
    woc.ui.show(block.wrap, false);
  }
  woc.ui.show(note, false);
}

/** Which silence this is, because an empty panel reads as a measurement of nothing. */
function drawIdle(reason) {
  pull = null;
  emptyLine.textContent = reason;
  woc.ui.show(emptyLine, true);
  hideAll();
}

/**
 * Built whatever the setting says, because building a block is what notices a heroic tell and
 * what raises that block's alert. A setting that hides a panel must not also silence the
 * warnings the panel would have justified, or it does something its label does not say.
 */
function buildBlocks(row, entity) {
  const built = [];
  for (const block of row.blocks ?? []) {
    const render = BLOCK_RENDERERS.get(block.kind);
    if (render === undefined || !blockSections.has(block.kind)) {
      woc.warn(`no renderer for block kind '${String(block.kind)}', so it is not drawn`);
    } else {
      built.push({ kind: block.kind, label: block.label, rows: render(block, entity) });
    }
  }
  return built;
}

function paintBlocks(built) {
  const drawn = new Set();
  for (const one of built) {
    const target = blockSections.get(one.kind);
    if (target !== undefined) {
      drawn.add(one.kind);
      fill(target, one.label, one.rows);
    }
  }
  for (const [kind, target] of blockSections) {
    if (!drawn.has(kind)) {
      fill(target, '', []);
    }
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

function drawFight(row, entity) {
  const phase = phaseOf(row, entity);
  trackPhase(row, phase);
  trackBlocks(row, entity);
  trackSpawns(row);
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
    drawIdle('No encounter this addon knows is in range.');
    return;
  }
  if (!engaged(found.entity)) {
    drawIdle(`${found.row.name} is not in combat.`);
    return;
  }
  if (pull === null || pull.bossId !== found.entity.id || encounterReset(found.entity)) {
    startPull(found);
  }
  if (frozen(found.row, found.entity)) {
    holdTimers(elapsed);
  }
  drawFight(found.row, found.entity);
});

/** Everything above is wired before this await, or a handler would miss what landed during it. */
async function boot() {
  encounters = readTable(await woc.data(TABLE_FILE));
  if (encounters.length === 0) {
    throw new Error(`${TABLE_FILE} carries no encounter this can read`);
  }
}

boot().catch((err) => {
  woc.error('could not read the encounter table, so there is nothing to time', err);
});
