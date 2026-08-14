/// <reference types="@woc-addons/types" />

// Cadence: the four timings a rotation is played against, on one strip.
//
// Everything it reads rides the SELF record. `swingTimer`, `gcdRemaining`, `autoAttack`
// and `comboPoints` are sent on your own entity and nowhere else, so pointed at a target
// this would draw a swing that never swings and raise nothing.
//
// Neither the swing nor the global cooldown publishes its length. The cooldown's is
// arithmetic with every term published (`gcdLength`); the swing's is learned from its
// reset (`relearn`, `swingSeed`), which rides the self record rather than the `damage`
// event, since the event lands a round trip later.
//
// Rows are built once and hidden rather than removed, so nothing moves under the eye at
// the moment a cast starts. Combo pips run over as many slots as the most points seen
// this session: nothing on the wire carries a maximum.

const FRAME_WIDTH = 190;
const DECIMALS = 1;
const PERCENT = 100;
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
/** Shortens a swing. A slow multiplies the period; these join one additive bucket. */
const SWING_HASTE_KINDS = ['buff_haste'];
const MIN_HEIGHT = 8;
const MAX_HEIGHT = 32;
const ROW_GAP = 2;
/** The addon's own floor, above the loader's: only the name can shrink, not the figure. */
const MIN_FRAME_WIDTH = 96;
/** Below this share left, a row goes warm: the thing it counts to is about to land. */
const NEARLY_DONE = 0.25;
const PIP_INSET = 4;
const MIN_PIP_PX = 4;
/** Tighter than the row gap: a run of pips is one reading rather than a list. */
const PIP_GAP = 2;
/** The game's own accent, so a point reads as a point rather than as a swatch. */
const PIP_COLOR = 'var(--gold, rgb(212 175 55))';
/** Filled and spent, as opacity on one colour rather than as two colours. */
const PIP_ON = '1';
const PIP_OFF = '0.25';
/** The band, in the kit's own danger colour. */
const BAND_COLOR = 'rgb(255 143 133 / 30%)';

// The row key, the setting that switches it on, and the label it carries. Triples
// rather than an object, because the setting ids are the manifest's names.
const ROW_SPECS = [
  ['swing', 'show-swing', 'Swing'],
  ['gcd', 'show-gcd', 'GCD'],
  ['cast', 'show-cast', 'Cast'],
  ['power', 'show-power', 'Power'],
];

/**
 * `ResourceType` is exactly these four. The fallback covers a kind a release adds.
 *
 * `focus` arrived with the 0.36.0 class rebuild and is the case the fallback was written
 * for: a hunter read 'Power' for a release rather than reading nothing, which is why the
 * fallback stays even now that the list is complete again.
 */
const RESOURCE_LABELS = [
  ['mana', 'Mana'],
  ['rage', 'Rage'],
  ['energy', 'Energy'],
  ['focus', 'Focus'],
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

/** A number the game gave us, or zero. */
function numberOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return 0;
}

/** Overrides the row-height setting while set. In-session: the loader saves the box. */
let linePx = null;

function rowHeight() {
  const wanted = linePx ?? woc.settings['bar-height'];
  return Math.min(Math.max(wanted, MIN_HEIGHT), MAX_HEIGHT);
}

/** Counted before any row exists, which `shownRows` cannot do: bounds are stated first. */
function wantedRows() {
  let count = 0;
  for (const [, setting] of ROW_SPECS) {
    if (woc.settings[setting]) {
      count += 1;
    }
  }
  return Math.max(count, 1);
}

function stackHeight(height, lines) {
  return lines * height + (lines - 1) * ROW_GAP;
}

function stripHeight(height) {
  return stackHeight(height, wantedRows());
}

/**
 * What the height floor is stated from. The pips are a line that appears mid-session, and
 * bounds are read once, so a floor counting rows alone is one the pips vanish under.
 */
function floorLines() {
  if (woc.settings['show-power']) {
    return wantedRows() + 1;
  }
  return wantedRows();
}

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

/** Re-size without rebuilding: a drag cannot change which rows exist and fires at pointer rate. */
function applySize() {
  for (const row of rows.values()) {
    // The kit sizes the row, its text and its art from one number, and drops an update
    // repeating a height it already holds, so a strip nobody is dragging pays nothing.
    row.bar.update({ size: rowHeight() });
  }
  const size = Math.max(MIN_PIP_PX, rowHeight() - PIP_INSET);
  for (const pip of pips.children) {
    pip.style.width = `${String(size)}px`;
    pip.style.height = `${String(size)}px`;
  }
}

/**
 * Divide the box between the lines on the strip, on a box change and on a line count
 * change: the pips appear mid-session and the frame's height was stated without them.
 * Gaps are paid before the division and the share floored, since a pixel over the box is
 * a pixel of the bottom row quietly missing.
 *
 * The box is read from the frame rather than held. `onMove` never fires for the opening
 * placement, so a copy of the box had to be seeded with the height this file had just
 * asked for, in two places that could disagree; `frame.box()` is the loader's own answer
 * and is right from the first paint.
 */
function fitLines() {
  const next = woc.ui.units(frame.box().h, {
    count: shownRows(),
    gap: ROW_GAP,
    min: MIN_HEIGHT,
    max: MAX_HEIGHT,
  });
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
 * What a countdown counts down from, learned from its own reset.
 *
 * `seen` is null before the first sample and whenever the strip stops drawing, so the
 * frame that resumes only records: otherwise a row returning mid-swing reads as a re-arm.
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

// One flex column. It outlives a rebuild, because the rows inside it do not.
const list = woc.ui.column({ className: 'woc-cadence', gap: ROW_GAP });

/** The combo pips, last so that a class that gains them shifts nothing above. */
const pips = woc.ui.row({ className: 'woc-cadence-pips', gap: PIP_GAP });
woc.ui.show(pips, false);

/** Bare: the rows are the display. The title is the accessible name and the unlock label. */
const frame = woc.ui.frame({
  id: 'strip',
  title: 'Cadence',
  width: FRAME_WIDTH,
  // The rows and their gaps, and nothing else. Without a height the kit opens at its own
  // fallback, which for four 14px rows leaves an invisible drag area over the game.
  height: stripHeight(rowHeight()),
  density: 'bare',
  save: true,
  // A bare strip has no chrome to dismiss it with, so this is the only way off screen.
  toggleKey: 'toggle',
  // A frame is content-sized and therefore not resizable by default, which is wrong
  // here: these bars have a width the player reads numbers off.
  resizable: true,
  // Both bounds are stated, because a frame that states neither takes the size it opened
  // at as its floor and can never be dragged smaller than its first paint.
  //
  // The height's floor is the row height setting's own minimum spread over every line the
  // strip can be asked for, so that setting decides how small the strip goes. See
  // `floorLines` for the line the row count alone does not know about.
  //
  // Both are read once, here. Switching a row off later rebuilds the strip but cannot
  // restate the bounds, so the floor holds until the next reload.
  minWidth: MIN_FRAME_WIDTH,
  minHeight: stackHeight(MIN_HEIGHT, floorLines()),
  /**
   * The lines follow the box. Measuring the element would force a synchronous layout on
   * every pointer move. Split between SHOWN lines, so hiding a row makes the rest taller.
   */
  onMove: fitLines,
});
frame.body.appendChild(list);

/**
 * The latency band, inside the cast row and behind its text. A negative z-index like the
 * kit's own fill, appended after it, so the band sits over the fill and under the label.
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
  const bar = woc.ui.bar({ label, className: 'woc-cadence-row', size: rowHeight() });
  bar.el.dataset.row = key;
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
    if (woc.settings[setting]) {
      rows.set(key, createRow(key, label));
    }
  }
  if (rows.has('power')) {
    list.appendChild(pips);
  }
}

/**
 * The cast's label and school, looked up only when the ability changed.
 * `world.abilities` rebuilds a signature over the whole spellbook on every read, which is
 * wasteful sixty times a second for an answer that moves only when a cast starts.
 *
 * `woc.fmt.titleCase` is the FALLBACK, reached only outside your own spellbook, and wrong
 * wherever the game's display name has diverged from the id. Wrong-but-readable beats a
 * blank row on a live cast.
 *
 * `castingAbility` carries an ability id OR an activity sentinel, from a set that grows
 * with the game. A sentinel resolves in no spellbook, so the lane reads "Crafting" while
 * you craft. Left alone: the game's own cast bar draws the same thing, and an exclusion
 * list would need editing every release.
 */
function castOf(me) {
  const abilityId = me.castingAbility;
  if (typeof abilityId !== 'string' || abilityId.length === 0) {
    return null;
  }
  if (castMemo.id !== abilityId) {
    const info = woc.world.abilities.byId(abilityId);
    castMemo.id = abilityId;
    castMemo.label = woc.fmt.titleCase(abilityId);
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

/** A fold rather than a filtered list: both callers run every frame. The array is the game's. */
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
 * What the first swing of a session is measured against. The melee haste stat is NOT on
 * the wire and `spellHaste` cannot stand in for it, so this runs long for a player
 * carrying it until the first observed reset replaces it.
 */
function swingSeed(me) {
  const period = foldAuras(me, SWING_SLOW_KINDS, numberOf(me.weapon?.speed), stretched);
  const haste = foldAuras(me, SWING_HASTE_KINDS, 0, hastened);
  return period / (1 + Math.max(0, haste));
}

/**
 * The swing row. `autoAttack` decides whether there is anything to say at all: a swing
 * timer on a character who is not attacking counts to nothing.
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
 * The game's own arithmetic, which is what makes this row exact on the first press. Three
 * terms the obvious version gets wrong: a rogue's base is 1.0, no haste takes it under
 * the 0.75 floor, and haste auras ADD to `spellHaste` rather than folding in.
 */
function gcdLength(me) {
  const haste = foldAuras(me, HASTE_AURA_KINDS, numberOf(me.spellHaste), added);
  return Math.max(MIN_GCD_SECONDS, gcdBase(me) / (1 + Math.max(0, haste)));
}

/**
 * Empty rather than zero when not running, since that is ready. The length is recomputed
 * each frame, so an aura falling off mid-cooldown leaves a remaining longer than the
 * length says; the kit clamps the fill.
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
 * The last stretch of the cast that your round trip covers. Drawn from the left edge
 * because the fill drains toward it, so the band is the end of the cast.
 */
function paintBand(row, total) {
  const { band } = row;
  if (band === null) {
    return;
  }
  const ms = woc.net.state.latencyMs;
  if (typeof ms !== 'number' || total <= 0 || !woc.settings['show-latency']) {
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
 * One pip per point, over as many slots as the most ever seen. Repainted only when the
 * count moved, since this runs at frame rate. The first point adds a line, so the box is
 * divided again on the frame that reveals it.
 */
function paintPips(points) {
  if (points > pipSlots) {
    pipSlots = points;
  }
  if (points === pipsPainted && pips.children.length === pipSlots) {
    return;
  }
  const wasShown = !pips.hidden;
  woc.ui.show(pips, pipSlots > 0);
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
 * The frame's own visibility is left alone: it is the player's and the loader persists it,
 * so writing it too would argue with the restore of a frame they had closed.
 */
function drawing() {
  if (!woc.settings['hide-out-of-combat']) {
    return true;
  }
  return woc.world.combat.active;
}

function applyVisibility() {
  woc.ui.show(list, drawing());
}

/** Forget the last SAMPLE, so the frame that resumes records rather than relearns. */
function stand() {
  swing.seen = null;
}

buildRows();
applyVisibility();

// The one subscription in the file. Combat is a state that changes, which is what
// `world.on` reports; everything else here is a number counting down.
woc.world.on('combat', applyVisibility);

// On the loop the loader already runs. Four bars whose numbers move every frame is what
// that tick is for, and a strip standing down is one `if` on a shared callback.
woc.onFrame(() => {
  const me = woc.world.player;
  if (frame.visible && !list.hidden && me !== null) {
    draw(me);
    return;
  }
  stand();
});

/**
 * Throw the rows away and build them again. Which rows exist and how tall they are are
 * both decided when a row is built, so neither can be repainted into.
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
  // The rows the settings now ask for, divided into the box the frame already has. A new
  // row height cannot land here: the frame's height was stated when it was built and an
  // addon cannot restate it, so honouring the setting now would draw rows the bare frame
  // clips. It opens at the new height next reload.
  fitLines();
}

woc.onSettingsChange(rebuild);

// Nothing is registered with `woc.onDispose`: everything this file creates lives inside
// a kit widget or inside the frame body, both of which the loader drains on disable, and
// the frame handler is `woc.onFrame`, which is unsubscribed with them.
