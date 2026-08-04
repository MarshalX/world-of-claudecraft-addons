/// <reference types="@woc-addons/types" />

// Emberwatch: say which effect on which unit is worth knowing about, and get a tile, a
// cue and a banner when it happens.
//
// The model is the aura list and never the aura event. The `aura` event carries a display
// name, a gained flag and a target and no id at all, so an engine built on it would
// confuse two abilities that share a name and could not express "the one I applied".
// Everything here reads `world.aurasOn(unit, query)` and `world.partyAuras(pid, query)`,
// which carry ids, sources, stacks and durations. Nothing subscribes to an event.
//
// The clock is `woc.onFrame`, and the two aura watch keys are deliberately not
// subscribed, because three of the four conditions this engine tests are invisible to
// them: `world.on('auras')` signs your auras by id and caster and not by stack count, so
// a debuff ramping on you fires nothing; neither key fires as a remaining ticks down, and
// "running out" is a threshold on that remaining; and a party row has no watch key at
// all. What is subscribed is `characterKey`, since the rule set and the stored rows
// belong to one character and the game swaps characters inside one page load.
//
// A party row is a smaller shape and the display says so. A row carries an id, a kind, a
// whole-second remaining and nothing else: no source, so `mine` cannot be asked and a
// rule naming it has that clause dropped rather than silently ignored; no duration, so a
// tile from a row gets no sweep; no stacks; no school and no `unbreakableControl`, so
// `world.dispellable` refuses it. All of that is said in the rules pane and in the tile's
// tooltip. The reason to read rows at all is that one exists for a member on the far side
// of the map where an entity does not.
//
// Polarity is the loader's predicate rather than this file's arithmetic. `world.harmful`
// takes either shape and puts both of the game's clauses together: a kind in the harmful
// set, or a `buff_*` kind whose magnitude went negative, which is a drain reusing the
// buff kind. A party row's `neg` flag is a sign test on that magnitude and nothing else,
// so a dot, a root, a stun and a silence all arrive without it.
//
// What cannot be built, and is said on screen as well as here: "your crowd control is
// about to break, and how much damage it will take". The soak and the per-hit break
// chance never leave the server, and what rides the wire is a bare presence marker saying
// a soak exists. The marker survives into a field the published `Aura` does not declare,
// and an undeclared field is one nothing has promised, so nothing here touches it. The
// rules pane says the limit in words, because an engine that alerts on control and stays
// quiet about this is read as denying it.
//
// An effect a mob applied has no icon anywhere. The game composites aura art on a canvas
// from a bundled table, so the only art an addon can point at is the applying ability's,
// which is filed per player class. An interrupt's lockout aura carries an `_lockout`
// suffix that no ability answers to and will 404 whatever the caster was. The kit hides a
// failed slot, so the cost is a blank square.
//
// `world.abilities` is deliberately not consulted for a name. An entity's aura carries
// `name` on the wire, which is right for every aura including a mob's; a party row
// carries none, and a spellbook lookup would answer for the handful in your own kit and
// leave the rest guessed, which is a label that is authoritative one row and a guess the
// next. A row is labelled from its id, title-cased, and the tooltip says so.
//
// There is no sending here and there could not be. This says what landed; the player
// decides what to spend.
//
// The starter table is game content and lives in `rules.json`, read through `woc.data`.
// It is generated: `generate.mjs` beside this file says which half of a row is read out
// of a game checkout and which half is editorial. `woc.data` hands back `unknown`, so
// every row is checked in `readRule` before it is allowed to fire anything.

const RULES_FILE = 'rules.json';
/** Where a player's own rows and their disabled ids are filed, per character. */
const STORE_ROWS = 'rows';
const STORE_OFF = 'disabled';

const DECIMALS = 1;
/** How long a `faded` alert stays up. It has no aura left to count down. */
const FADED_LINGER_MS = 4000;
/**
 * The strip's starting square, which is also its floor. Larger than the kit's own 40,
 * because this is a centre-screen alert read at a glance in the middle of a fight.
 */
const TILE_FLOOR = 48;
/** The caption band under a square, stated so a drag can solve back for the square. */
const CAPTION_HEIGHT = 15;
const CAPTION_FONT = 11;
const STRIP_WIDTH = 420;
const SECONDS_PER_MINUTE = 60;
const DEFAULT_MAX_TILES = 6;
const DEFAULT_EXPIRING_SECONDS = 4;
const DEFAULT_STACK_THRESHOLD = 2;
const DEFAULT_VOLUME = 0.8;
const SINGLE_STACK = 1;
const PANE_WIDTH = 460;
const PANE_HEIGHT = 380;
const PANE_MIN_WIDTH = 280;
/** The notes band plus one row, which is the pane at its smallest useful size. */
const PANE_MIN_HEIGHT = 190;

/** The two things this addon cannot answer, drawn in the pane rather than hidden here. */
const PANE_NOTES = [
  'A party row carries an id, a kind and whole seconds. No source, so "only mine" is dropped; no duration, so there is no sweep; no stacks; and removability cannot be answered at all.',
  'Nothing here can tell you how much damage a control will take before it breaks. The soak and the per-hit chance stay on the server, and the wire carries only a marker that a soak exists rather than what it is.',
];

/** Every condition a rule may test. Anything else is not a rule. */
const CONDITIONS = ['gained', 'faded', 'stacks', 'expiring'];
/** Every unit a rule may name. `party` is the group's rows, which reach across the map. */
const UNITS = ['player', 'target', 'party'];

/** What the starter file said, once it has been read and checked. */
let starter = [];
/** Whether the table has come back at all, which an empty one is not evidence of. */
let tableRead = false;
/** This character's own rows, and the ids they have switched off. */
let mine = [];
let disabled = new Set();
/** The class the active rule set was assembled for, so a switch rebuilds it. */
let assembledFor = null;
let active = [];

/** What matched on the previous evaluation, which is the only way a fade is visible. */
let previous = new Map();
/** Alert key to the record on screen. */
const alerts = new Map();
/** Alert key to its cell, and to its world anchor when one is placed over a unit. */
const cells = new Map();
const anchors = new Map();

/**
 * Whether a reading has any news in it yet. The first reading of a live world is
 * everything already up, so without this an addon enabled mid-fight opens with a cue and
 * a banner per effect already on the player.
 */
let primed = false;

function settingNumber(id, fallback) {
  const value = woc.settings[id];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

function settingFlag(id, fallback) {
  const value = woc.settings[id];
  if (typeof value === 'boolean') {
    return value;
  }
  return fallback;
}

function settingText(id, fallback) {
  const value = woc.settings[id];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return fallback;
}

/**
 * One rule, or null for anything that is not one.
 *
 * `woc.data` hands back `unknown`: the loader checks the file parses as JSON at install
 * and nothing else, so the shape is a claim and this is where it is checked. The same
 * function checks a row the player captured, since a stored row is a claim of the same
 * kind, written by a previous version of this addon.
 *
 * A rule has to be able to match something, so a row naming neither an aura id nor a kind
 * nor a polarity is refused: it would fire on every effect on its unit.
 */
function readRule(value) {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { id, label, unit, on } = value;
  const identified = typeof id === 'string' && id.length > 0 && typeof label === 'string';
  const described = identified && label.length > 0;
  if (!(described && UNITS.includes(unit) && CONDITIONS.includes(on))) {
    return null;
  }
  const rule = { id, label, unit, on, ...optionalOf(value) };
  if (rule.auraId === null && rule.kind === null && rule.harmful === null) {
    return null;
  }
  return rule;
}

/** The half of a rule that may be absent, normalised so nothing below asks twice. */
function optionalOf(value) {
  return {
    forClass: stringOr(value.class, 'any'),
    auraId: stringOr(value.auraId, null),
    kind: stringOr(value.kind, null),
    mine: flagOr(value.mine),
    harmful: flagOr(value.harmful),
    removable: flagOr(value.removable) === true,
    bout: flagOr(value.bout) === true,
    banner: flagOr(value.banner) === true,
    cue: stringOr(value.cue, null),
    threshold: numberOr(value.threshold),
  };
}

function stringOr(value, fallback) {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return fallback;
}

function flagOr(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  return null;
}

function numberOr(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}

/**
 * Take a list of rules on, dropping any row that did not check out. A bad row is skipped
 * with a warning naming its position rather than the whole list being thrown away.
 */
function adopt(listed, source) {
  const kept = [];
  for (const [at, row] of listed.entries()) {
    const rule = readRule(row);
    if (rule === null) {
      woc.warn(`${source}: entry ${String(at)} is not a rule, leaving it out`, row);
    } else {
      kept.push(rule);
    }
  }
  return kept;
}

/** The file's `rules` array, or null when the file is not the shape it claims. */
function readFile(file) {
  if (typeof file !== 'object' || file === null || file.format !== 'emberwatch-rules') {
    return null;
  }
  if (!Array.isArray(file.rules)) {
    return null;
  }
  return file.rules;
}

/** The class the starter set is picked by, or null before world entry. */
function playerClass() {
  const { player } = woc.world;
  if (player === null || player.kind !== 'player') {
    return null;
  }
  return player.templateId;
}

/**
 * The rules in force for whoever is playing. Rebuilt when the class changes and never per
 * frame. Before world entry there is no class, so only the rows that apply to every class
 * are in force, which is the honest answer rather than an empty engine.
 */
function assemble() {
  const cls = playerClass();
  if (cls === assembledFor) {
    return;
  }
  assembledFor = cls;
  active = [...starter, ...mine].filter((rule) => appliesTo(rule, cls));
}

function appliesTo(rule, cls) {
  if (disabled.has(rule.id)) {
    return false;
  }
  return rule.forClass === 'any' || rule.forClass === cls;
}

/** Anything the rule set depends on moved, so build it again on the next read. */
function reassemble() {
  assembledFor = false;
  assemble();
}

/** `shadow_word_pain` to "Shadow Word Pain", which is a GUESS and is labelled as one. */
function readable(id) {
  return id
    .split('_')
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * The applying ability's art, or null when there is no file to point at. Only a
 * player-applied effect resolves, since art is filed per player class. A lockout aura
 * never resolves either, because its id carries a suffix no file is named for.
 */
function artOf(auraId, sourceId) {
  const caster = woc.world.entities.get(sourceId);
  if (caster === undefined || caster.kind !== 'player') {
    return null;
  }
  return woc.ui.icon.ability(auraId, caster.templateId);
}

/** The query an entity read takes. `mine` is the clause a dot tracker cannot skip. */
function queryFor(rule) {
  const query = rowQueryFor(rule);
  if (rule.mine !== null) {
    query.mine = rule.mine;
  }
  return query;
}

/**
 * The same for a party row, which carries no source and so cannot answer `mine`. A clause
 * the rule does not carry is left out rather than passed as null: both query filters test
 * the field against `undefined` to decide whether they were asked at all, so a null reads
 * as "match only auras whose kind is null", which is none of them.
 */
function rowQueryFor(rule) {
  const query = {};
  if (rule.auraId !== null) {
    query.id = rule.auraId;
  }
  if (rule.kind !== null) {
    query.kind = rule.kind;
  }
  return query;
}

/** Whether this rule's extra clauses hold for one full aura. */
function keepsAura(rule, aura, hostile) {
  if (rule.harmful !== null && rule.harmful !== woc.world.harmful(aura)) {
    return false;
  }
  return !rule.removable || woc.world.dispellable(aura, hostile);
}

/** Whether they hold for a party row, which can answer polarity and nothing else. */
function keepsRow(rule, row) {
  if (rule.removable) {
    return false;
  }
  return rule.harmful === null || rule.harmful === woc.world.harmful(row);
}

function candidateKey(rule, unitKey, auraId, sourceId) {
  return `${rule.id}|${unitKey}|${auraId}|${String(sourceId)}`;
}

/** One match off an ENTITY, which is the shape that can answer every clause. */
function fromAura(rule, unit, unitKey, aura) {
  return {
    key: candidateKey(rule, unitKey, aura.id, aura.sourceId),
    rule,
    unitKey,
    who: unit.name,
    entityId: unit.id,
    row: false,
    auraId: aura.id,
    name: aura.name,
    derivedName: false,
    kind: aura.kind,
    school: aura.school,
    stacks: aura.stacks ?? SINGLE_STACK,
    remaining: aura.remaining,
    duration: aura.duration,
    encounterOwned: aura.unbreakableControl === true,
    art: artOf(aura.id, aura.sourceId),
  };
}

/**
 * One match off a party row. Everything a row does not carry is null rather than a
 * default, because the display has to tell "no stacks on this effect" from "a row cannot
 * say".
 */
function fromRow(rule, member, row) {
  const unitKey = `party:${String(member.pid)}`;
  return {
    key: candidateKey(rule, unitKey, row.id, 0),
    rule,
    unitKey,
    who: member.name,
    entityId: null,
    row: true,
    auraId: row.id,
    name: readable(row.id),
    derivedName: true,
    kind: row.kind,
    school: null,
    stacks: null,
    remaining: row.remaining ?? null,
    duration: null,
    encounterOwned: false,
    art: null,
  };
}

/** Which direction removability points on a unit: strip a benefit off a hostile one. */
function hostility(unit) {
  return unit.hostile === true;
}

function entityMatches(rule, token) {
  const unit = woc.world.unit(token);
  if (unit === null) {
    return [];
  }
  const found = [];
  for (const aura of woc.world.aurasOn(token, queryFor(rule))) {
    if (keepsAura(rule, aura, hostility(unit))) {
      found.push(fromAura(rule, unit, token, aura));
    }
  }
  return found;
}

function partyMatches(rule) {
  const found = [];
  for (const member of woc.world.party?.members ?? []) {
    for (const row of woc.world.partyAuras(member.pid, rowQueryFor(rule))) {
      if (keepsRow(rule, row)) {
        found.push(fromRow(rule, member, row));
      }
    }
  }
  return found;
}

/** Whether a rule is allowed to run at all right now. */
function ruleRuns(rule) {
  if (rule.on === 'expiring' && !settingFlag('expiring', true)) {
    return false;
  }
  return !rule.bout || woc.world.match !== null;
}

function candidatesFor(rule) {
  if (!ruleRuns(rule)) {
    return [];
  }
  if (rule.unit === 'party') {
    return partyMatches(rule);
  }
  return entityMatches(rule, rule.unit);
}

/** Seconds left that counts as running out, for a rule that names none itself. */
function expiryThreshold(rule) {
  return rule.threshold ?? settingNumber('expiring-seconds', DEFAULT_EXPIRING_SECONDS);
}

function stackThreshold(rule) {
  return rule.threshold ?? DEFAULT_STACK_THRESHOLD;
}

/**
 * Whether a match is currently worth an alert. `gained` holds for as long as the effect
 * is there, which is what makes the tile a readout rather than a flash. `stacks` and
 * `expiring` are thresholds on fields a party row does not carry, so a row answers false
 * rather than guessing.
 */
function holds(found) {
  const { rule } = found;
  if (rule.on === 'gained') {
    return true;
  }
  if (rule.on === 'stacks') {
    return found.stacks !== null && found.stacks >= stackThreshold(rule);
  }
  if (rule.on === 'expiring') {
    return found.remaining !== null && found.remaining <= expiryThreshold(rule);
  }
  return false;
}

/** How much of the effect is left, or null when nothing published a denominator. */
function fractionOf(found) {
  if (found.duration === null || found.duration <= 0 || found.remaining === null) {
    return null;
  }
  return Math.min(found.remaining / found.duration, 1);
}

/** `8`, or `2m` for anything a square has no room to spell out. Empty when unknown. */
function countdown(found) {
  if (found.remaining === null) {
    return '';
  }
  if (found.remaining >= SECONDS_PER_MINUTE) {
    return `${String(Math.ceil(found.remaining / SECONDS_PER_MINUTE))}m`;
  }
  return String(Math.ceil(found.remaining));
}

function stackCount(found) {
  if (found.stacks === null || found.stacks <= SINGLE_STACK) {
    return null;
  }
  return found.stacks;
}

function toneOf(found) {
  if (found.rule.banner) {
    return 'danger';
  }
  if (found.rule.on === 'expiring') {
    return 'warn';
  }
  return 'default';
}

/** Tell anyone listening. The four fields are the ones the topic registry names. */
function announce(found, state) {
  woc.bus.emit('alert', {
    ruleId: found.rule.id,
    unit: found.unitKey,
    auraId: found.auraId,
    state,
  });
}

function bannerFor(found) {
  woc.ui.banner(found.rule.label, {
    kind: 'danger',
    size: settingText('banner-size', 'normal'),
    detail: `on ${found.who}`,
  });
}

/**
 * The noise an alert makes on the frame it arrives, and only then. Nothing sounds while
 * the engine is priming, or everything already up would arrive at once as news.
 */
function sound(found) {
  if (!primed) {
    return;
  }
  if (found.rule.cue !== null) {
    woc.sound.play(found.rule.cue, { volume: settingNumber('volume', DEFAULT_VOLUME) });
  }
  if (found.rule.banner) {
    bannerFor(found);
  }
}

/** When a momentary alert should come down, or null for one that is a state. */
function lingerUntil(now, momentary) {
  if (momentary) {
    return now + FADED_LINGER_MS;
  }
  return null;
}

function raise(found, now, momentary) {
  const existing = alerts.get(found.key);
  if (existing === undefined) {
    alerts.set(found.key, { found, at: now, until: lingerUntil(now, momentary) });
    sound(found);
    announce(found, 'active');
    return;
  }
  existing.found = found;
}

function clear(key) {
  const record = alerts.get(key);
  if (record === undefined) {
    return;
  }
  alerts.delete(key);
  announce(record.found, 'cleared');
}

/** Every rule against everything it names, once. */
function collect() {
  const current = new Map();
  for (const rule of active) {
    for (const found of candidatesFor(rule)) {
      current.set(found.key, found);
    }
  }
  return current;
}

/**
 * A rule watching for an effect to go cannot see it in the reading that follows, so the
 * fade is the previous reading minus this one. A match that comes back clears the
 * lingering alert rather than leaving it up beside the effect it announced the loss of.
 */
function fades(current, now) {
  for (const [key, found] of previous) {
    if (found.rule.on === 'faded' && !current.has(key)) {
      raise(found, now, true);
    }
  }
}

function states(current, now) {
  for (const [key, found] of current) {
    if (found.rule.on !== 'faded' && holds(found)) {
      raise(found, now, false);
    } else {
      clear(key);
    }
  }
}

/**
 * An alert whose match has gone entirely. `states` only walks what matched this time, so
 * an effect that fell off between two readings is in neither loop and would otherwise sit
 * on the strip for the rest of the session. A momentary alert legitimately outlives its
 * match, which is what `until` marks it as.
 */
function orphans(current) {
  for (const [key, record] of alerts) {
    if (record.until === null && !current.has(key)) {
      clear(key);
    }
  }
}

/** A momentary alert has had its time. Nothing else here comes down on a clock. */
function retire(now) {
  for (const [key, record] of alerts) {
    if (record.until !== null && now >= record.until) {
      clear(key);
    }
  }
}

function evaluate(now) {
  assemble();
  const current = collect();
  states(current, now);
  orphans(current);
  fades(current, now);
  retire(now);
  previous = current;
  primed = woc.world.player !== null;
}

const list = document.createElement('div');
list.className = 'woc-ew-list';
list.style.display = 'flex';
list.style.alignItems = 'flex-start';
list.style.gap = '6px';

/** What the strip is not showing. A budget nobody can see is a budget that lies. */
const overflow = document.createElement('span');
overflow.className = 'woc-ew-overflow';
overflow.style.fontSize = `${String(CAPTION_FONT)}px`;
overflow.style.alignSelf = 'center';
overflow.style.whiteSpace = 'nowrap';

function stripHeight(size) {
  return size + CAPTION_HEIGHT;
}

/** The square the strip is drawing at now, which is its height less the caption. */
let tileSize = TILE_FLOOR;

/**
 * The overlay. Bare, because the tiles are the display. The title is kept as the frame's
 * accessible name and the label the loader shows while frames are unlocked, which is how
 * a strip that draws nothing at rest gets positioned at all.
 */
const frame = woc.ui.frame({
  id: 'alerts',
  title: 'Emberwatch',
  width: STRIP_WIDTH,
  // Stated, because a frame with no height opens at the kit's own fallback, which for a
  // row of squares leaves an invisible drag area over the game. It is also what makes the
  // frame draggable at all: a content-sized frame is never given a box.
  height: stripHeight(TILE_FLOOR),
  density: 'bare',
  save: true,
  resizable: true,
  // Both bounds are constants and both floor at one square, never at whatever is on
  // screen: a floor taken from the current alert count traps the player who sized it
  // during a pull and then has one tile.
  minWidth: TILE_FLOOR,
  minHeight: stripHeight(TILE_FLOOR),
  onMove: (box) => {
    resize(box.h);
  },
});
frame.body.appendChild(list);
list.appendChild(overflow);

/**
 * Follow the strip's height, which is one square and the caption under it. Called at
 * pointer rate, so it does nothing when the square has not moved. The floor is applied
 * here as well as declared on the frame, since the arithmetic has to hold for a box from
 * anywhere: a restore, a viewport clamp, or a height a future bound lets through.
 */
function resize(height) {
  const next = Math.max(Math.round(height - CAPTION_HEIGHT), TILE_FLOOR);
  if (next === tileSize) {
    return;
  }
  tileSize = next;
  for (const cell of cells.values()) {
    sizeCell(cell);
  }
}

function sizeCell(cell) {
  cell.el.style.width = `${String(tileSize)}px`;
  cell.ui.update({ size: tileSize });
}

/** Where the effect is being read from, which is the line a player checks a gap against. */
function sourceLine(found) {
  if (found.row) {
    return {
      text: 'Read off a party row: whole seconds, no stacks, no source, and at most eight effects.',
      tone: 'warn',
    };
  }
  return { text: 'Read off the unit itself.', tone: 'muted' };
}

function conditionLine(found) {
  const { rule } = found;
  if (rule.on === 'stacks') {
    return `Fires at ${String(stackThreshold(rule))} applications or more.`;
  }
  if (rule.on === 'expiring') {
    return `Fires with ${String(expiryThreshold(rule))}s or less left.`;
  }
  if (rule.on === 'faded') {
    return 'Fires when the effect goes.';
  }
  return 'Fires while the effect is there.';
}

function remainingLine(found) {
  if (found.remaining === null) {
    return { text: 'No remaining time on this reading.', tone: 'warn' };
  }
  return `${found.remaining.toFixed(DECIMALS)}s left.`;
}

/** The lines a tile adds when the effect is one nothing the player does will shift. */
function extraLines(found) {
  const lines = [];
  if (found.encounterOwned) {
    lines.push({ text: 'The encounter owns this one: nothing you do breaks it.', tone: 'danger' });
  }
  if (found.derivedName) {
    lines.push({
      text: `Name derived from "${found.auraId}", not read from the wire.`,
      tone: 'muted',
    });
  }
  if (found.rule.unit === 'party' && found.rule.mine !== null) {
    lines.push({ text: '"Only mine" was dropped: a party row carries no source.', tone: 'warn' });
  }
  return lines;
}

/**
 * What one tile says under the pointer. A function, so it answers with what is left now
 * rather than with what was left when the tile was built, and so it can say which rule
 * put it there.
 */
function tooltipFor(key) {
  const record = alerts.get(key);
  if (record === undefined) {
    return 'This alert has gone.';
  }
  const { found } = record;
  return {
    title: found.name,
    icon: found.art,
    lines: [
      `${found.rule.label}, on ${found.who}`,
      conditionLine(found),
      remainingLine(found),
      ...extraLines(found),
      sourceLine(found),
    ],
  };
}

function createCell(found) {
  const tile = woc.ui.tile({ label: labelFor(found), className: 'woc-ew-tile' });
  const el = document.createElement('div');
  el.className = 'woc-ew-cell';
  el.dataset.alert = found.key;
  el.style.display = 'flex';
  el.style.flexDirection = 'column';
  el.style.alignItems = 'center';
  // A flex item shrinks by default, so a strip narrowed under its content would squash
  // the squares out of true rather than running past the edge.
  el.style.flexShrink = '0';
  const caption = document.createElement('span');
  caption.className = 'woc-ew-caption';
  caption.style.overflow = 'hidden';
  caption.style.textOverflow = 'ellipsis';
  caption.style.whiteSpace = 'nowrap';
  caption.style.maxWidth = '100%';
  caption.style.fontSize = `${String(CAPTION_FONT)}px`;
  // Stated in both directions, because the strip's height is a square plus exactly this
  // and the drag solves back for the square.
  caption.style.height = `${String(CAPTION_HEIGHT)}px`;
  caption.style.lineHeight = `${String(CAPTION_HEIGHT)}px`;
  el.append(tile.el, caption);
  const cell = { ui: tile, el, caption };
  sizeCell(cell);
  woc.ui.tooltip(el, () => tooltipFor(found.key));
  return cell;
}

/**
 * How a tile is announced. A tile is all art, so everything it says has to be in here as
 * well: which rule fired, on whom, and about what.
 */
function labelFor(found) {
  return `${found.rule.label}: ${found.name} on ${found.who}`;
}

/**
 * A tile with no denominator gets a full square rather than an empty one. A party row
 * publishes no duration, so there is nothing to sweep against, and an empty square reads
 * as an effect that has already expired.
 */
function sweepOf(found) {
  return fractionOf(found) ?? 1;
}

function paint(cell, found) {
  cell.caption.textContent = found.who;
  cell.ui.update({
    label: labelFor(found),
    icon: found.art,
    fraction: sweepOf(found),
    value: countdown(found),
    count: stackCount(found),
    school: found.school,
    tone: toneOf(found),
  });
}

/** Put an element at its position, and only if it is not there already. */
function place(parent, el, at) {
  if (parent.children[at] !== el) {
    parent.insertBefore(el, parent.children[at] ?? null);
  }
}

/**
 * Alerts newest first, so the thing that just happened is the leftmost square. Ranked by
 * arrival rather than by remaining: an effect up for thirty seconds moving ahead of one
 * that just landed would reorder the strip while the player is looking at it.
 */
function newestFirst(a, b) {
  return b.at - a.at;
}

function ordered() {
  const rows = [...alerts.entries()].sort(([, a], [, b]) => newestFirst(a, b));
  const budget = Math.max(Math.round(settingNumber('max-tiles', DEFAULT_MAX_TILES)), 1);
  return { shown: rows.slice(0, budget), hidden: Math.max(rows.length - budget, 0) };
}

/** Whether an alert should be drawn over the unit rather than on the strip. */
function anchoredKey(key, found) {
  if (settingText('placement', 'strip') !== 'unit' || found.entityId === null) {
    return null;
  }
  return key;
}

/**
 * The element a cell belongs in. A party row has no entity, so a rule over the group
 * cannot be anchored over anybody and stays on the strip whatever the setting says: an
 * anchor follows a unit the renderer is drawing, and a member on the far side of the map
 * has no model to follow.
 */
function anchorFor(key, found) {
  const existing = anchors.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const made = woc.ui.anchor3d({ unit: found.entityId, over: 'head' }, { className: 'woc-ew-pin' });
  anchors.set(key, made);
  return made;
}

function dropAnchor(key) {
  const anchor = anchors.get(key);
  if (anchor !== undefined) {
    anchor.destroy();
    anchors.delete(key);
  }
}

function attach(key, cell, found, at) {
  const anchored = anchoredKey(key, found);
  if (anchored === null) {
    dropAnchor(key);
    place(list, cell.el, at);
    return false;
  }
  place(anchorFor(key, found).el, cell.el, 0);
  return true;
}

/** Drop the cells for alerts that are gone, or that the budget no longer reaches. */
function sync(shown) {
  const seen = new Set(shown.map(([key]) => key));
  for (const [key, cell] of cells) {
    if (!seen.has(key)) {
      cell.ui.destroy();
      cell.el.remove();
      cells.delete(key);
      dropAnchor(key);
    }
  }
}

function cellFor(key, found) {
  const existing = cells.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const made = createCell(found);
  cells.set(key, made);
  return made;
}

function drawOverflow(hidden, at) {
  if (hidden === 0) {
    overflow.textContent = '';
    return;
  }
  overflow.textContent = `+${String(hidden)} more`;
  place(list, overflow, at);
}

function draw() {
  const { shown, hidden } = ordered();
  sync(shown);
  let placed = 0;
  for (const [key, record] of shown) {
    const cell = cellFor(key, record.found);
    paint(cell, record.found);
    if (!attach(key, cell, record.found, placed)) {
      placed += 1;
    }
  }
  drawOverflow(hidden, placed);
}

/**
 * Nothing is on screen, so nothing has to be laid out. Anchors still come down: `sync`
 * with nothing shown rather than its own teardown, because a world anchor is not inside
 * the frame and a second copy of that walk is a second place to forget one.
 */
function blank() {
  if (cells.size === 0 && overflow.textContent === '') {
    return;
  }
  sync([]);
  overflow.textContent = '';
}

/**
 * The rules pane: what is being watched, and what this addon cannot answer.
 *
 * A frame rather than a window, with a close button, since this one is opened to be read
 * and dismissed with the mouse. Resizable, because the content is a list that reflows with
 * the box, and both bounds are stated so the floor is one row rather than however many
 * rules happened to be in force when it first opened.
 */
const paneBody = document.createElement('div');
paneBody.className = 'woc-ew-rules';
paneBody.style.display = 'flex';
paneBody.style.flexDirection = 'column';
paneBody.style.gap = '6px';

const pane = woc.ui.frame({
  id: 'rules',
  title: 'Emberwatch rules',
  width: PANE_WIDTH,
  height: PANE_HEIGHT,
  minWidth: PANE_MIN_WIDTH,
  minHeight: PANE_MIN_HEIGHT,
  resizable: true,
  closable: true,
  save: true,
  visible: false,
});
pane.body.appendChild(paneBody);

/** The rows the pane is holding, so a rebuild can take their controls down. */
const paneRows = [];

function note(text) {
  const el = document.createElement('div');
  el.className = 'woc-ew-note';
  el.style.fontSize = `${String(CAPTION_FONT)}px`;
  el.style.opacity = '0.7';
  el.textContent = text;
  return el;
}

/** What a rule matches on, in the order the engine asks it. */
function subjectOf(rule) {
  if (rule.auraId !== null) {
    return rule.auraId;
  }
  if (rule.kind !== null) {
    return rule.kind;
  }
  if (rule.harmful === true) {
    return 'any harmful effect';
  }
  return 'any beneficial effect';
}

/** What a rule watches, in one line, so a row can be checked without a tooltip. */
function describe(rule) {
  const parts = [`${rule.unit}: ${subjectOf(rule)}`, rule.on];
  if (rule.mine === true && rule.unit !== 'party') {
    parts.push('mine only');
  }
  if (rule.bout) {
    parts.push('in a bout only');
  }
  return parts.join(', ');
}

function removeRow(rule) {
  mine = mine.filter((row) => row.id !== rule.id);
  persist(STORE_ROWS, mine);
  reassemble();
  fillPane();
}

/** The Remove control, for a row the player captured. A starter row has none. */
function removeButton(rule) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'woc-btn';
  button.textContent = 'Remove';
  button.addEventListener('click', () => {
    removeRow(rule);
  });
  return button;
}

function setEnabled(rule, on) {
  if (on) {
    disabled.delete(rule.id);
  } else {
    disabled.add(rule.id);
  }
  persist(STORE_OFF, [...disabled]);
  reassemble();
}

function paneRow(rule, own) {
  const el = document.createElement('div');
  el.className = 'woc-ew-rule';
  el.dataset.rule = rule.id;
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'space-between';
  el.style.gap = '8px';
  const field = woc.ui.field.checkbox({
    label: rule.label,
    value: !disabled.has(rule.id),
    onChange: (on) => {
      setEnabled(rule, on);
    },
  });
  el.append(field.el, note(describe(rule)));
  if (own) {
    el.appendChild(removeButton(rule));
  }
  paneRows.push({ el, field });
  return el;
}

/** Every rule the player could switch on, including the ones another class owns. */
function paneRules() {
  const cls = playerClass();
  return [...starter, ...mine].filter((rule) => rule.forClass === 'any' || rule.forClass === cls);
}

/**
 * Why the pane is empty, in words. An empty list would otherwise read as "nothing is
 * being watched", which is three different facts: the table may not have arrived, the
 * player may be on the login screen where there is no class to pick a starter set by, or
 * this class may have nothing in the shipped set. `tableRead` separates the first from
 * the third, since a table that arrived empty and one that has not arrived look alike.
 */
function emptyReason() {
  if (!tableRead) {
    return 'The starter rules have not been read yet.';
  }
  if (playerClass() === null) {
    return 'No class yet: the starter set is picked once you are in the world.';
  }
  return 'No rules for this character yet. Capture one off your target to add the first.';
}

function fillPane() {
  for (const row of paneRows.splice(0)) {
    row.field.destroy();
    row.el.remove();
  }
  paneBody.replaceChildren();
  const rules = paneRules();
  const ownIds = new Set(mine.map((rule) => rule.id));
  if (rules.length === 0) {
    paneBody.appendChild(note(emptyReason()));
  }
  for (const rule of rules) {
    paneBody.appendChild(paneRow(rule, ownIds.has(rule.id)));
  }
  for (const line of PANE_NOTES) {
    paneBody.appendChild(note(line));
  }
}

/**
 * The effect on your target most worth a rule, or null. Harmful before helpful, because a
 * debuff you are keeping up is what a rule is usually for; then the one you applied, since
 * that is the copy you can do anything about; then longest remaining.
 */
function priority(aura, playerId) {
  const harm = woc.world.harmful(aura);
  const ours = aura.sourceId === playerId;
  return [harm, ours, aura.remaining];
}

function betterAura(a, b, playerId) {
  const left = priority(a, playerId);
  const right = priority(b, playerId);
  for (const [at, value] of left.entries()) {
    if (value !== right[at]) {
      return value > right[at];
    }
  }
  return false;
}

function bestOnTarget() {
  const playerId = woc.world.player?.id ?? null;
  let best = null;
  for (const aura of woc.world.aurasOn('target')) {
    if (best === null || betterAura(aura, best, playerId)) {
      best = aura;
    }
  }
  return best;
}

/**
 * Turn what is on the target into a rule of the player's own. `mine` is stamped from
 * whether the player actually applied the effect, which is the difference between "watch
 * my dot" and "watch this debuff whoever put it there".
 */
function ruleFromAura(aura, playerId) {
  return {
    id: `own-${aura.id}-${String(woc.wallClock())}`,
    label: aura.name,
    class: playerClass() ?? 'any',
    unit: 'target',
    auraId: aura.id,
    mine: aura.sourceId === playerId && playerId !== null,
    on: 'expiring',
    cue: 'buff_apply',
  };
}

function capture() {
  const aura = bestOnTarget();
  if (aura === null) {
    woc.ui.toast('Nothing on your target to watch.', { kind: 'warn' });
    return;
  }
  const rule = readRule(ruleFromAura(aura, woc.world.player?.id ?? null));
  if (rule === null) {
    woc.warn('could not turn that effect into a rule', aura);
    return;
  }
  mine = [...mine, rule];
  persist(STORE_ROWS, mine);
  reassemble();
  fillPane();
  woc.ui.toast(`Watching ${aura.name} on your target.`);
}

/**
 * Write one per-character key down, once the character it belongs to is known. A
 * per-character write rejects before world entry, because its value was decided when it
 * was called. Nothing here can produce a row before world entry anyway, since both
 * callers are gestures, so the await is a guard rather than a delay.
 */
async function write(key, value) {
  await woc.world.ready;
  await woc.storage.character.set(key, value);
}

/** The same, for the callers that are event handlers and cannot await anything. */
function persist(key, value) {
  write(key, value).catch((err) => {
    woc.warn(`could not save "${key}"`, err);
  });
}

/** A stored array of rules, checked exactly as the shipped file is. */
function readStoredRules(stored) {
  if (!Array.isArray(stored)) {
    return [];
  }
  return adopt(stored, STORE_ROWS);
}

function readStoredOff(stored) {
  if (!Array.isArray(stored)) {
    return new Set();
  }
  return new Set(stored.filter((id) => typeof id === 'string'));
}

/**
 * Take this character's own rows back. A per-character read waits for the character, so
 * this settles at world entry with the rows of whoever logged in. It runs again on
 * `characterKey` because the game clones and removes its HUD rather than reloading, so a
 * character switch happens inside one page load.
 */
async function restore() {
  const [rows, off] = await Promise.all([
    woc.storage.character.get(STORE_ROWS, null),
    woc.storage.character.get(STORE_OFF, null),
  ]);
  mine = readStoredRules(rows);
  disabled = readStoredOff(off);
  reassemble();
  fillPane();
}

function load() {
  restore().catch((err) => {
    woc.warn("could not read this character's own rules back", err);
  });
}

async function boot() {
  const rules = readFile(await woc.data(RULES_FILE));
  if (rules === null) {
    throw new Error(`${RULES_FILE} carries no "rules" array`);
  }
  starter = adopt(rules, RULES_FILE);
  tableRead = true;
  reassemble();
  fillPane();
}

// The engine keeps running while the strip is hidden: the cue and the banner are the
// half of this addon that works when nobody is looking at the overlay. Only the drawing
// is skipped.
woc.onFrame(() => {
  evaluate(woc.now());
  if (frame.visible) {
    draw();
  } else {
    blank();
  }
});

// A character switch inside one page load changes both halves of the rule set: the
// class the starter rows are picked by, and the stored rows themselves.
woc.world.on('characterKey', load);

woc.keys.bind('toggle', () => {
  frame.toggle();
});

woc.keys.bind('capture', capture);

// The pane's own way in. The keybinds are spent on the two things done mid-fight.
woc.ui.menuEntry({
  id: 'rules',
  label: 'Emberwatch rules',
  onClick: () => {
    pane.show();
  },
});

// Every setting is read while the next frame is being built, so a change is on screen a
// frame later with nothing torn down. The pane is the exception: its rows are built from
// the rule set rather than from a setting.
fillPane();

boot().catch((err) => {
  woc.error('could not read the starter rules, so only your own rows will fire', err);
});

load();
