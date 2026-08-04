/// <reference types="@woc-addons/types" />

// Cadence: the four timings a rotation is actually played against, on one strip.
//
// Almost every line below is animation, and that is the shape the world API asks
// for. `world.on` reports a SET changing and deliberately never reports a number
// counting down, so nothing here can be driven by a subscription: a swing timer,
// a global cooldown and a cast bar are all one number moving between two events
// nobody is told about. The display is therefore `woc.onFrame` reading
// `world.player`, and the ONE world subscription in the file is `combat`, which is
// a state rather than a countdown.
//
// Everything it reads rides the SELF record. `swingTimer`, `gcdRemaining`,
// `autoAttack` and `comboPoints` are sent on your own entity and nowhere else, so
// on every other entity they are present, correctly typed, and permanently zero.
// That is why this reads `world.player` and never takes a unit token: pointed at a
// target the same code would draw a swing that never swings and a rotation that is
// always ready, and nothing would raise.
//
// NEITHER THE SWING NOR THE GLOBAL COOLDOWN PUBLISHES ITS LENGTH, and they are not
// the same problem. The global cooldown's is ARITHMETIC and every term of it is
// published, so that row is exact from the first frame of a session: see
// `gcdLength`. The swing's is not, so that row learns its denominator from the
// RESET, which for a swing is the instant it lands: see `relearn` and `swingSeed`.
//
// That is also why nothing here subscribes to a `damage` event, and the reason is
// worth stating rather than leaving as an absence. The swing reset and the damage
// it dealt do not arrive together: the reset is on the self record of the snapshot
// that resolved the swing, and the event describing the hit lands afterwards. A
// bar reset on the event would run down to zero, sit there for a round trip, and
// then jump, which reads as the display being behind the game. Reading the reset
// is both earlier and simpler.
//
// The latency band is the one thing here the game's own cast bar does not draw,
// and it is a MEASUREMENT of a round trip rather than a promise about a press that
// lands inside it: see `latencyLine`.
//
// EVERY ROW DRAINS. `fraction` means what is LEFT everywhere in the kit, and this
// is four thin bars read together at a glance: a strip where one row empties as
// its event approaches and another fills would make the same shape mean two
// opposite things in the same eyeful.
//
// Rows are built once and HIDDEN rather than removed when they have nothing to
// say. A timing strip is read by muscle memory at a fixed spot, and a cast row
// that appears when a cast starts would move the swing and the global cooldown
// under the player's eye at the exact moment they are watching them. It also means
// nothing is ever re-placed, so no row loses what the browser was tracking on it.
//
// Combo points are pips, and the strip is as wide as the most points seen this
// SESSION rather than a maximum written down here. There is no maximum on the
// wire, exactly as there is none for a charge pool, so a five-slot strip would be
// this file claiming something about every class the game has and being wrong the
// day one of them differs. The resource beside them is a bar and not pips: pips
// for a pool of a hundred mana is a hundred squares.

const FRAME_WIDTH = 190;
const DECIMALS = 1;
const PERCENT = 100;
/** Widths, at the precision the kit writes its own fill at. */
const WIDTH_DECIMALS = 2;
const MS_PER_SECOND = 1000;
/** The unhasted global cooldown, for every class but the one below. */
const GCD_SECONDS = 1.5;
/** A rogue's is a third shorter, and it is the only class the game singles out. */
const ROGUE_GCD_SECONDS = 1;
const ROGUE = 'rogue';
/** The floor, which no amount of haste takes the global cooldown under. */
const MIN_GCD_SECONDS = 0.75;
/** Haste from an aura adds to the stat rather than multiplying against it. */
const HASTE_AURA_KINDS = ['buff_spellhaste'];
/** The two aura kinds that stretch a swing, each a multiplier on the period. */
const SWING_SLOW_KINDS = ['attackspeed', 'sanguine'];
/**
 * The aura kind that SHORTENS a swing, which is the slows' opposite number.
 *
 * Published as a multiplier like a slow and folded like the spell haste above,
 * because that is what the game does with it: a slow multiplies the period and a
 * haste joins one additive bucket the period is then divided through.
 */
const SWING_HASTE_KINDS = ['buff_haste'];
const DEFAULT_HEIGHT = 14;
const MIN_HEIGHT = 8;
const MAX_HEIGHT = 32;
/** The space between two rows, which the strip's own height has to allow for. */
const ROW_GAP = 2;
/** The kit row's own side padding, kept while its vertical padding is dropped. */
const ROW_PAD_X = 6;
/**
 * The narrowest the strip may be dragged.
 *
 * The addon's own floor rather than the loader's, which keeps a structural one
 * underneath it so that a frame always has something left to grab. This one is
 * about READING a row: the figure on the right never shrinks and the name is the
 * only part that can, so under roughly this every row is a countdown with nothing
 * to say which timer it is counting.
 */
const MIN_FRAME_WIDTH = 96;
/** Share of a row's height the text is drawn at, so a thin row still reads. */
const TEXT_SCALE = 0.72;
const MIN_TEXT_PX = 9;
/** Below this share left, a row goes warm: the thing it counts to is about to land. */
const NEARLY_DONE = 0.25;
/** How much smaller a combo pip is than the row height it sits under. */
const PIP_INSET = 4;
const MIN_PIP_PX = 4;
/** The game's own accent, so a point reads as a point rather than as a swatch. */
const PIP_COLOR = 'var(--gold, rgb(212 175 55))';
/** Filled and spent, as opacity on one colour rather than as two colours. */
const PIP_ON = '1';
const PIP_OFF = '0.25';
/** The band, in the kit's own danger colour: it is a warning, not an invitation. */
const BAND_COLOR = 'rgb(255 143 133 / 30%)';

// The row key, the setting that switches it on, and the label it carries. Triples
// rather than an object because the setting ids are the MANIFEST's names, not
// names this file chose.
const ROW_SPECS = [
  ['swing', 'show-swing', 'Swing'],
  ['gcd', 'show-gcd', 'GCD'],
  ['cast', 'show-cast', 'Cast'],
  ['power', 'show-power', 'Power'],
];

/**
 * Every resource id the game sends, and what to call each on the row.
 *
 * Three, and three is the WHOLE set rather than the obvious part of a longer one:
 * the game's `ResourceType` is exactly `rage | mana | energy`, and a class without
 * a bar of its own is on mana (a hunter is, which is the one worth saying because
 * it is the class most likely to be assumed to have a fourth). The fallback below
 * is therefore reached only by a kind a future game release adds.
 */
const RESOURCE_LABELS = [
  ['mana', 'Mana'],
  ['rage', 'Rage'],
  ['energy', 'Energy'],
];

/** What the swing counts down FROM, which is the one length nothing publishes. */
const swing = { total: 0, seen: null };

/** The last cast looked up, so the spellbook is not walked on every frame. */
const castMemo = { id: null, label: 'Cast', school: null };

/** Row key to `{ bar, band }`. Rebuilt only when the settings change. */
const rows = new Map();
/** The tooltip attachments, so a rebuild takes its own down rather than leaking. */
const tips = [];

/** The most combo points seen this session, which is the only maximum there is. */
let pipSlots = 0;
/** What the pips were last painted with, so a still count writes nothing. */
let pipsPainted = -1;

function settingFlag(id, fallback) {
  const value = woc.settings[id];
  if (typeof value === 'boolean') {
    return value;
  }
  return fallback;
}

function settingNumber(id, fallback) {
  const value = woc.settings[id];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

/** A number the game gave us, or zero. Every read here is a claim about the game. */
function numberOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return 0;
}

/**
 * What one line gets out of the box, or null until something has divided one.
 *
 * It overrides the row height SETTING while it holds a number, and it is
 * in-session like every other override in this catalogue: an addon cannot write
 * its own settings, and the loader already remembers the frame's BOX per
 * character, so the size comes back on its own without this being persisted.
 */
let linePx = null;

/**
 * The height the loader is drawing the strip at, which the lines divide between.
 *
 * A bare frame CLIPS what does not fit and an addon cannot restate its frame's
 * height after it is built, so the box is the budget and everything on the strip
 * has to come out of it. See `fitLines`.
 */
let boxHeight = null;

/** The row height, held inside what a strip of bars can actually draw. */
function rowHeight() {
  const wanted = linePx ?? settingNumber('bar-height', DEFAULT_HEIGHT);
  return Math.min(Math.max(wanted, MIN_HEIGHT), MAX_HEIGHT);
}

/**
 * How many rows the settings ask for, counted before any of them exist.
 *
 * `shownRows` cannot answer this and is not a candidate: a frame's size bounds are
 * stated when the frame is CREATED, which is before `buildRows` has put a single
 * row on screen.
 */
function wantedRows() {
  let count = 0;
  for (const [, setting] of ROW_SPECS) {
    if (settingFlag(setting, true)) {
      count += 1;
    }
  }
  return Math.max(count, 1);
}

/** What a stack of lines measures at a given line height, gaps included. */
function stackHeight(height, lines) {
  return lines * height + (lines - 1) * ROW_GAP;
}

/** What the rows the settings ask for measure, stacked at a given row height. */
function stripHeight(height) {
  return stackHeight(height, wantedRows());
}

/**
 * The most lines the strip can ever be asked to draw, which is what its FLOOR is
 * stated from.
 *
 * The rows the settings ask for, plus the combo pips wherever the resource row is
 * on. The pips are a line that appears mid-session, on the one class that has
 * points, and a frame's bounds are read once when it is built, so a floor stated
 * for the rows alone is one the pips can be dragged out of existence under. It
 * costs a class with no points ten pixels of a floor it has to drag to before
 * meeting, and it buys the class that has them a strip that cannot be made
 * smaller than what it draws, which is what a density that CLIPS asks for.
 */
function floorLines() {
  if (settingFlag('show-power', true)) {
    return wantedRows() + 1;
  }
  return wantedRows();
}

/** How many rows are on screen, which is what the frame's height is divided between. */
function shownRows() {
  let count = 0;
  for (const row of rows.values()) {
    if (!row.bar.el.hidden) {
      count += 1;
    }
  }
  if (!pips.hidden && pips.isConnected) {
    count += 1;
  }
  return Math.max(count, 1);
}

/**
 * Re-size what is already drawn, without rebuilding it.
 *
 * A settings change rebuilds, because which rows exist can change with it and a
 * row's contents are decided when it is built. A DRAG cannot change which rows
 * exist, and it fires at pointer rate, so it takes this path instead: rebuilding
 * a strip of kit bars and their tooltips on every pointer move is the kind of
 * work that makes a resize feel like it is fighting back.
 */
function applySize() {
  for (const row of rows.values()) {
    styleRow(row.bar.el);
  }
  const size = Math.max(MIN_PIP_PX, rowHeight() - PIP_INSET);
  for (const pip of pips.children) {
    pip.style.width = `${String(size)}px`;
    pip.style.height = `${String(size)}px`;
  }
}

/**
 * Divide the box between the lines currently on the strip.
 *
 * Called when the box changes AND when the number of lines does, and the second
 * half is the one a drag handler alone misses. The combo pips are a line of their
 * own that appears the first time a class has a point to show, and the frame's
 * height was stated for the ROWS: a bare frame clips, and an addon cannot restate
 * that height, so without this the pips are drawn outside the box and the one
 * class that has them never sees them at all.
 *
 * The gaps are paid for before the division and the share is floored, because
 * every pixel over the box is a pixel of the bottom row that is quietly not
 * there. A line count that leaves less than a row's minimum is what the frame's
 * own `minHeight` is for.
 */
function fitLines() {
  if (boxHeight === null) {
    return;
  }
  const lines = shownRows();
  const next = Math.floor((boxHeight - (lines - 1) * ROW_GAP) / lines);
  if (next === linePx) {
    return;
  }
  linePx = next;
  applySize();
}

/** 0 through 1, and 0 rather than a NaN when there is no denominator yet. */
function share(remaining, total) {
  if (total <= 0) {
    return 0;
  }
  return remaining / total;
}

function seconds(value) {
  return `${value.toFixed(DECIMALS)}s`;
}

/** Warm as the thing a row counts to comes up, so a glance finds what is next. */
function toneFor(fraction) {
  if (fraction <= NEARLY_DONE) {
    return 'warn';
  }
  return 'default';
}

/**
 * What a countdown counts down FROM, learned from its own reset.
 *
 * The swing is the only caller, and it is the only one there can be: this is what
 * a row does when the arithmetic is unavailable, and the global cooldown's is
 * available. Learning a figure that can be computed would draw the first bar of a
 * session against a guess for no reason at all.
 *
 * `seen` is null before the first sample and whenever the strip stops drawing, so
 * the frame that resumes only records. Without that a row coming back mid-swing
 * would read the gap as a re-arm and take a part-spent remaining as the length.
 */
function relearn(cell, remaining, seed) {
  const rearmed = cell.seen !== null && remaining > cell.seen;
  cell.seen = remaining;
  if (rearmed) {
    cell.total = remaining;
  }
  if (cell.total <= 0) {
    cell.total = seed;
  }
  if (cell.total <= 0) {
    cell.total = remaining;
  }
  return cell.total;
}

/**
 * Show or hide a flex line, BOTH ways, because either alone is wrong here.
 *
 * `hidden` is an attribute the UA answers with `display: none` at the lowest
 * priority there is, so an inline `display: flex` beats it outright and an
 * element hidden that way is still on screen. Setting only the display would fix
 * the drawing and leave the element in the accessibility tree, announcing a
 * strip of timers that nobody can see.
 */
function setShown(el, shown) {
  el.hidden = !shown;
  el.style.display = 'none';
  if (shown) {
    el.style.display = 'flex';
  }
}

// One flex column. It outlives a rebuild, because the rows inside it do not.
const list = document.createElement('div');
list.className = 'woc-cadence';
list.style.flexDirection = 'column';
list.style.gap = `${String(ROW_GAP)}px`;
setShown(list, true);

/** The combo pips, last so that a class that gains them shifts nothing above. */
const pips = document.createElement('div');
pips.className = 'woc-cadence-pips';
pips.style.gap = '2px';
setShown(pips, false);

/**
 * The overlay. Bare, because the rows ARE the display and a panel behind four
 * thin bars is furniture around something that needs none. The title is kept for
 * the accessible name and for the label the loader draws while frames are
 * unlocked, which is how this gets positioned while it is empty.
 */
const frame = woc.ui.frame({
  id: 'strip',
  title: 'Cadence',
  width: FRAME_WIDTH,
  // The rows and their gaps, and nothing else: a bare frame has no chrome to
  // allow for. Without a height the kit opens at its own fallback, which for four
  // 14px rows is nearly twice the strip and leaves the difference as an invisible
  // drag area sitting over the game.
  height: stripHeight(rowHeight()),
  density: 'bare',
  save: true,
  // A frame is content-sized and therefore not resizable by default, which is
  // right for a list whose height is its rows and wrong here: these bars have a
  // width the player reads numbers off and a height that is a matter of taste.
  resizable: true,
  // BOTH bounds are stated, because a frame that states neither takes the size it
  // opened at as its floor and can never be dragged smaller than its first paint.
  // That was reported from a live session as the strip refusing to come down, and
  // the height was the worse half: the floor was the kit's fallback rather than
  // anything about these rows.
  //
  // The height's floor is the ROW HEIGHT setting's own minimum spread over every
  // line the strip can be asked for, which makes that setting the thing that
  // decides how small the strip goes. It is a real limit and not a convenience:
  // the lines follow the box, they stop shrinking at that minimum, and a frame
  // shorter than its lines would clip them rather than get any smaller. See
  // `floorLines` for the line the row count alone does not know about.
  //
  // Both are read once, here. Switching a row off later rebuilds the strip but
  // cannot restate the bounds, so a player who does that keeps the floor of the
  // row count they logged in with until the next reload.
  minWidth: MIN_FRAME_WIDTH,
  minHeight: stackHeight(MIN_HEIGHT, floorLines()),
  /**
   * The lines follow the box, which is the whole point of letting it be dragged.
   *
   * Measuring the element instead would force a synchronous layout on every
   * pointer move of a display that already writes styles every frame, which is
   * why the loader hands the box over rather than making an addon ask for it.
   *
   * The height is split between the lines that are SHOWN, so hiding a row makes
   * the rest taller rather than leaving a gap where it was.
   */
  onMove: (box) => {
    boxHeight = box.h;
    fitLines();
  },
});
frame.body.appendChild(list);
// The height asked for above, which is the budget until the loader reports one of
// its own. A restored box arrives through `onMove` and replaces it.
boxHeight = stripHeight(rowHeight());

/**
 * Size one row to the height the player picked.
 *
 * The kit row is a block whose head is a flex line, so the height is written here
 * and the head is centred in it rather than sitting at the top of a thin bar. The
 * text scales with the row for the same reason: a 16px label in a 10px row is
 * cropped by the row's own overflow rule and reads as a bar with no name.
 */
function styleRow(el) {
  const height = rowHeight();
  el.style.height = `${String(height)}px`;
  el.style.boxSizing = 'border-box';
  el.style.display = 'flex';
  el.style.flexDirection = 'column';
  el.style.justifyContent = 'center';
  el.style.fontSize = `${String(Math.max(MIN_TEXT_PX, Math.round(height * TEXT_SCALE)))}px`;
  // The three declarations that make the height above the truth rather than a
  // request, and every one of them is a thing a flex column does on its own. A
  // kit row carries 2px of vertical padding and a normal line box, so its own
  // content measures more than a thin row is given; `min-height: auto` on a flex
  // item then refuses to shrink it, and the strip silently stands taller than the
  // box its frame was built at. A bare frame clips, so what that costs is the
  // BOTTOM row, which is a display that is simply missing its last line and says
  // nothing about why. Verified in a browser through `pnpm stage`, since happy-dom
  // lays nothing out and every one of these reads as correct in a suite.
  el.style.padding = `0 ${String(ROW_PAD_X)}px`;
  el.style.lineHeight = '1';
  el.style.minHeight = '0';
}

/**
 * The latency band, inside the cast row and behind its text.
 *
 * A negative z-index like the kit's own fill, and appended after it, so the band
 * sits over the fill and under the label. The row already has `position: relative`
 * and clips its own overflow, so nothing here can escape the bar it belongs to.
 */
function createBand(el) {
  const band = document.createElement('div');
  band.className = 'woc-cadence-band';
  band.style.position = 'absolute';
  band.style.inset = '0 auto 0 0';
  band.style.width = '0';
  band.style.zIndex = '-1';
  band.style.backgroundColor = BAND_COLOR;
  band.hidden = true;
  el.appendChild(band);
  return band;
}

function createRow(key, label) {
  const bar = woc.ui.bar({ label, className: 'woc-cadence-row' });
  bar.el.dataset.row = key;
  styleRow(bar.el);
  list.appendChild(bar.el);
  const row = { bar, band: null };
  if (key === 'cast') {
    row.band = createBand(bar.el);
  }
  tips.push(woc.ui.tooltip(bar.el, () => rowTip(key)));
  return row;
}

function createPip() {
  const size = Math.max(MIN_PIP_PX, rowHeight() - PIP_INSET);
  const pip = document.createElement('div');
  pip.className = 'woc-cadence-pip';
  pip.style.width = `${String(size)}px`;
  pip.style.height = `${String(size)}px`;
  pip.style.borderRadius = '2px';
  pip.style.backgroundColor = PIP_COLOR;
  pip.style.opacity = PIP_OFF;
  return pip;
}

function buildRows() {
  for (const [key, setting, label] of ROW_SPECS) {
    if (settingFlag(setting, true)) {
      rows.set(key, createRow(key, label));
    }
  }
  if (rows.has('power')) {
    list.appendChild(pips);
  }
}

/**
 * 'frost_bolt' reads as 'Frost Bolt'. The FALLBACK, not the label.
 *
 * A guess from the id, reached only for something outside your own spellbook,
 * and wrong wherever the game's own name has diverged from the id: `arcane_shot`
 * is displayed everywhere as "Fell Shot". Wrong-but-readable beats a blank row on
 * the one thing you are currently casting.
 */
function readable(abilityId) {
  return abilityId
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * The cast's label and school, looked up only when the ability changed.
 *
 * `world.abilities` rebuilds a signature over the whole spellbook on every read,
 * which is fine once a cast and wasteful sixty times a second for an answer that
 * only moves when a cast starts.
 */
function castOf(me) {
  const abilityId = me.castingAbility;
  if (typeof abilityId !== 'string' || abilityId.length === 0) {
    return null;
  }
  if (castMemo.id !== abilityId) {
    const info = woc.world.abilities.byId(abilityId);
    castMemo.id = abilityId;
    castMemo.label = readable(abilityId);
    castMemo.school = null;
    if (info !== null) {
      castMemo.label = info.name;
      castMemo.school = info.school;
    }
  }
  return castMemo;
}

/** Back to a row that names nothing, so the tooltip cannot title a finished cast. */
function forgetCast() {
  castMemo.id = null;
  castMemo.label = 'Cast';
  castMemo.school = null;
}

/**
 * Fold every aura of the given kinds into one number.
 *
 * A fold rather than a filtered list of magnitudes, because both callers run on
 * every frame and this file already refuses per-frame work it can avoid: two
 * throwaway arrays sixty times a second, to read at most a handful of numbers, is
 * the same waste as walking the spellbook once a frame would be.
 *
 * The aura list is the game's own array handed over untouched, so it is read
 * defensively. An entity that turns out to carry none costs a term rather than
 * the frame the whole strip is drawn in.
 */
function foldAuras(me, kinds, start, fold) {
  const carried = me.auras;
  if (!Array.isArray(carried)) {
    return start;
  }
  let total = start;
  for (const aura of carried) {
    if (kinds.includes(aura?.kind)) {
      total = fold(total, numberOf(aura?.value));
    }
  }
  return total;
}

/** A slow is a multiplier over the period, and a nonsense one is skipped. */
function stretched(period, value) {
  if (value > 0) {
    return period * value;
  }
  return period;
}

function added(total, value) {
  return total + value;
}

/** A haste multiplier's share of the additive bucket, which is its excess over 1. */
function hastened(total, value) {
  if (value > 0) {
    return total + value - 1;
  }
  return total;
}

/**
 * What the first swing of a session is measured against.
 *
 * `weapon.speed` is the unhasted period and every aura term of the game's own
 * period is published, so the seed reproduces its arithmetic: the kinds that
 * STRETCH a swing multiply it, and the kind that shortens one joins an additive
 * bucket the result is divided through.
 *
 * What is left over is the melee haste STAT, which is not on the wire and which
 * the published `spellHaste` cannot stand in for. That term alone, so the seed is
 * long only for a player carrying melee haste from gear or a passive, and the
 * first observed reset replaces it either way.
 */
function swingSeed(me) {
  const period = foldAuras(me, SWING_SLOW_KINDS, numberOf(me.weapon?.speed), stretched);
  const haste = foldAuras(me, SWING_HASTE_KINDS, 0, hastened);
  return period / (1 + Math.max(0, haste));
}

/**
 * The swing row.
 *
 * `autoAttack` decides whether there is anything to say at all: a swing timer on a
 * character who is not attacking is a number counting to nothing.
 */
function paintSwing(row, me) {
  const remaining = numberOf(me.swingTimer);
  const total = relearn(swing, remaining, swingSeed(me));
  if (me.autoAttack !== true) {
    row.bar.update({ fraction: 0, value: 'off', tone: 'default' });
    return;
  }
  const fraction = share(remaining, total);
  row.bar.update({ fraction, value: seconds(remaining), tone: toneFor(fraction) });
}

/** The unhasted base, which the game gives one class alone a shorter one of. */
function gcdBase(me) {
  if (me.templateId === ROGUE) {
    return ROGUE_GCD_SECONDS;
  }
  return GCD_SECONDS;
}

/**
 * How long the global cooldown currently running actually is.
 *
 * The game's own arithmetic rather than an observation, and every term of it is
 * published, which is what makes this row exact on the first press of a session
 * where the swing above it cannot be. Three things the obvious version gets
 * wrong, and each is a wrong denominator on a real character rather than a
 * rounding difference: a rogue's base is 1.0 and not 1.5, no amount of haste
 * takes it under a 0.75 floor, and haste AURAS add on top of the `spellHaste`
 * stat rather than already being folded into it.
 */
function gcdLength(me) {
  const haste = foldAuras(me, HASTE_AURA_KINDS, numberOf(me.spellHaste), added);
  return Math.max(MIN_GCD_SECONDS, gcdBase(me) / (1 + Math.max(0, haste)));
}

/**
 * The global cooldown. Empty rather than zero when it is not running: that is ready.
 *
 * The length is recomputed each frame, so a haste aura that falls off part way
 * through leaves a remaining longer than the length now says. The kit clamps the
 * fill, which draws a full bar, and full is the honest reading: what is left is
 * everything this row can still count.
 */
function paintGcd(row, me) {
  const remaining = numberOf(me.gcdRemaining);
  if (remaining <= 0) {
    row.bar.update({ fraction: 0, value: '', tone: 'default' });
    return;
  }
  row.bar.update({ fraction: share(remaining, gcdLength(me)), value: seconds(remaining) });
}

/**
 * The last stretch of the cast that your round trip covers.
 *
 * Drawn from the left edge because the fill drains toward it, so the band is the
 * end of the cast rather than the start of it.
 */
function paintBand(row, total) {
  const { band } = row;
  if (band === null) {
    return;
  }
  const ms = woc.net.state.latencyMs;
  if (typeof ms !== 'number' || total <= 0 || !settingFlag('show-latency', true)) {
    band.hidden = true;
    return;
  }
  band.hidden = false;
  const covered = Math.min(share(ms / MS_PER_SECOND, total), 1);
  band.style.width = `${(covered * PERCENT).toFixed(WIDTH_DECIMALS)}%`;
}

function paintCast(row, me) {
  const cast = castOf(me);
  if (cast === null) {
    forgetCast();
    row.bar.update({ label: 'Cast', fraction: 0, value: '', school: null, tone: 'default' });
    paintBand(row, 0);
    return;
  }
  const remaining = numberOf(me.castRemaining);
  const total = numberOf(me.castTotal);
  row.bar.update({
    label: castChannelLabel(cast, me),
    fraction: share(remaining, total),
    value: seconds(remaining),
    school: cast.school,
  });
  paintBand(row, total);
}

/** A channel drains the same way a cast does, and it is not the same thing. */
function castChannelLabel(cast, me) {
  if (me.channeling === true) {
    return `${cast.label} (channel)`;
  }
  return cast.label;
}

/** One of the three, or the neutral word for a kind a game release adds later. */
function resourceLabel(me) {
  const found = RESOURCE_LABELS.find(([id]) => id === me.resourceType);
  if (found === undefined) {
    return 'Power';
  }
  return found[1];
}

/**
 * One pip per combo point, over as many slots as the most points ever seen.
 *
 * Repainted only when the count moved, since this runs at the frame rate and a
 * still combo count is the ordinary case.
 *
 * The first point of a session adds a LINE to the strip, so the box is divided
 * again on the frame that reveals it: see `fitLines`. That is the whole of what makes
 * the pips visible at all, since the frame was built for the rows alone.
 */
function paintPips(points) {
  if (points > pipSlots) {
    pipSlots = points;
  }
  if (points === pipsPainted && pips.children.length === pipSlots) {
    return;
  }
  const wasShown = !pips.hidden;
  setShown(pips, pipSlots > 0);
  pipsPainted = points;
  while (pips.children.length < pipSlots) {
    pips.appendChild(createPip());
  }
  for (const [at, pip] of [...pips.children].entries()) {
    pip.style.opacity = PIP_OFF;
    if (at < points) {
      pip.style.opacity = PIP_ON;
    }
  }
  if (wasShown !== !pips.hidden) {
    fitLines();
  }
}

function paintPower(row, me) {
  const resource = numberOf(me.resource);
  row.bar.update({
    label: resourceLabel(me),
    fraction: share(resource, numberOf(me.maxResource)),
    value: String(Math.round(resource)),
  });
  paintPips(numberOf(me.comboPoints));
}

function rowTip(key) {
  if (key === 'swing') {
    return {
      title: 'Swing timer',
      lines: [
        'Counts to your next auto-attack.',
        { text: 'Reset when the swing lands, not when its damage arrives.', tone: 'muted' },
      ],
    };
  }
  if (key === 'gcd') {
    return { title: 'Global cooldown', lines: ['Empty means your next press goes through.'] };
  }
  if (key === 'cast') {
    return { title: castMemo.label, lines: [latencyLine()] };
  }
  return { title: 'Resource', lines: powerLines() };
}

/** The pips are mentioned only once there are any, since most classes have none. */
function powerLines() {
  const lines = ['What you have to spend right now.'];
  if (pipSlots > 0) {
    lines.push('Combo points are the pips underneath.');
  }
  return lines;
}

/** The honest sentence about the band, which is most of why the tooltip exists. */
function latencyLine() {
  const ms = woc.net.state.latencyMs;
  if (typeof ms !== 'number') {
    return { text: 'No round trip measured yet, so no band is drawn.', tone: 'muted' };
  }
  return {
    text: `The band is your ${String(Math.round(ms))}ms round trip. It is what was measured, not a promise about a queued press.`,
    tone: 'muted',
  };
}

function paintRow(key, paint, me) {
  const row = rows.get(key);
  if (row !== undefined) {
    paint(row, me);
  }
}

function draw(me) {
  paintRow('swing', paintSwing, me);
  paintRow('gcd', paintGcd, me);
  paintRow('cast', paintCast, me);
  paintRow('power', paintPower, me);
}

/**
 * Whether the strip draws at all right now.
 *
 * The frame's own visibility is left alone deliberately: it is the player's, the
 * loader persists it per character, and an addon that also wrote it would argue
 * with the restore of a frame the player had closed. Hiding the CONTENT of a bare
 * frame leaves nothing on screen either way.
 */
function drawing() {
  if (!settingFlag('hide-out-of-combat', false)) {
    return true;
  }
  return woc.world.combat.active;
}

function applyVisibility() {
  setShown(list, drawing());
}

/** Forget the last SAMPLE, so the frame that resumes records rather than relearns. */
function stand() {
  swing.seen = null;
}

buildRows();
applyVisibility();

// The one subscription in the file. Combat is a state that changes, which is
// exactly what world.on reports; everything else here is a number counting down,
// which it deliberately does not.
woc.world.on('combat', applyVisibility);

// On the loop the loader already runs, rather than one of this addon's own. Four
// bars whose numbers genuinely move every frame is what that tick is for, and a
// strip standing down is one `if` on a shared callback rather than a browser one
// per addon.
woc.onFrame(() => {
  const me = woc.world.player;
  if (frame.visible && !list.hidden && me !== null) {
    draw(me);
    return;
  }
  stand();
});

woc.keys.bind('toggle', () => {
  frame.toggle();
});

/**
 * Throw the rows away and build them again.
 *
 * Which rows exist and how tall they are are both decided when a row is BUILT, so
 * neither can be repainted into. Everything a rebuild costs is one frame of a
 * display that redraws every frame anyway.
 */
function rebuild() {
  for (const off of tips.splice(0)) {
    off();
  }
  for (const row of rows.values()) {
    row.bar.destroy();
  }
  rows.clear();
  pips.remove();
  pips.replaceChildren();
  pipsPainted = -1;
  buildRows();
  applyVisibility();
  // The rows the settings now ask for, divided into the box the frame already
  // has. A NEW row height cannot land here and is not meant to: the frame's
  // height was stated when it was built and an addon cannot restate it, so
  // honouring the setting now would draw rows taller than the box and a bare
  // frame would clip the difference away. It opens at the new height next
  // reload, which is the same reload the size bounds above wait for.
  fitLines();
}

woc.onSettingsChange(rebuild);

// Nothing is registered with woc.onDispose, and that is a statement rather than an
// omission: everything this file creates lives inside a kit widget or inside the
// frame body, both of which the loader drains on disable, and the frame handler is
// woc.onFrame, which is unsubscribed with them.
