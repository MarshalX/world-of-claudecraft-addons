/// <reference types="@woc-addons/types" />

// Cadence: the timings a rotation is played against, on one strip.
//
// `gcdRemaining`, `comboPoints`, `offhandSwingTimer` and `offhandWeapon` ride the SELF record only.
// `swingTimer` rides every auto-attacking entity in range and is omitted on one that is not
// swinging; the client derives `autoAttack` from its presence, so a server that never sends it
// leaves the target row at 'off'.
//
// No swing publishes its length. The global cooldown's is arithmetic (`gcdLength`); a swing's is
// learned from its reset on the record (`relearn`), since the `damage` event lands a round trip
// later. The hands seed from `weapon.speed` and `offhandWeapon.speed`, unhasted bases; a target
// seeds from nothing, since no weapon speed rides a non-self record.
//
// Rows are built once and hidden rather than removed, so nothing moves under the eye when a cast
// starts. Combo pips run over the most points seen this session: nothing on the wire carries a
// maximum.

const FRAME_WIDTH = 190;
const DECIMALS = 1;
const PERCENT = 100;
const WIDTH_DECIMALS = 2;
const MS_PER_SECOND = 1000;
/** The unhasted global cooldown, for every class but the one below. */
const GCD_SECONDS = 1.5;
/** A rogue's is a third shorter; the only class the game singles out. */
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
/** No length to start from: `relearn` then falls back to the remaining time itself. */
const NO_SEED = 0;
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

// The row key, its enabling setting and its label. Triples rather than an object, because the
// setting ids are the manifest's names.
const ROW_SPECS = [
  ['swing', 'show-swing', 'Swing'],
  ['oswing', 'show-offhand-swing', 'Offhand'],
  ['tswing', 'show-target-swing', 'Target'],
  ['gcd', 'show-gcd', 'GCD'],
  ['cast', 'show-cast', 'Cast'],
  ['speed', 'show-speed', 'Speed'],
  ['power', 'show-power', 'Power'],
];

/**
 * Rows that open HIDDEN: an offhand or a movement effect is unknowable before world entry, so the
 * box is stated without them and `showRow` redivides it when one appears.
 */
const LATE_ROWS = ['oswing', 'speed'];

/** `ResourceType` is exactly these four. The fallback covers a kind a later release adds. */
const RESOURCE_LABELS = [
  ['mana', 'Mana'],
  ['rage', 'Rage'],
  ['energy', 'Energy'],
  ['focus', 'Focus'],
];

/** What the swing counts down FROM, which is the one length nothing publishes. */
const swing = { total: 0, seen: null };

/** The same for the target, keyed on WHOSE: a period learned on one entity is wrong on another. */
const targetSwing = { total: 0, seen: null, id: null };

/** The same for the offhand, keyed on WHICH item: a period from one weapon is wrong on another. */
const offhandSwing = { total: 0, seen: null, item: null };

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

/** Overrides the row-height setting while set. In-session only: the loader saves the box. */
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

/**
 * The lines the strip OPENS with, without `LATE_ROWS`: a height stated for a hidden row is a dead
 * line under every strip that never shows it.
 */
function openLines() {
  let count = 0;
  for (const [key, setting] of ROW_SPECS) {
    if (woc.settings[setting] && !LATE_ROWS.includes(key)) {
      count += 1;
    }
  }
  return Math.max(count, 1);
}

function stripHeight(height) {
  return stackHeight(height, openLines());
}

/**
 * What the height floor is stated from. The pips appear mid-session and bounds are read once, so a
 * floor counting rows alone lets the pips vanish.
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
    // The kit sizes the row, its text and its art from one number and drops a repeated height, so a
    // strip nobody is dragging pays nothing.
    row.bar.update({ size: rowHeight() });
  }
  const size = Math.max(MIN_PIP_PX, rowHeight() - PIP_INSET);
  for (const pip of pips.children) {
    pip.style.width = `${String(size)}px`;
    pip.style.height = `${String(size)}px`;
  }
}

/**
 * Divide the box between the lines on the strip, on a box change and on a line count change. Gaps
 * come out before the division and the share is floored, since a pixel over the box clips the
 * bottom row. The box comes from `frame.box()`, because `onMove` never fires for the opening
 * placement.
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
 * What a countdown counts down from, learned from its own reset. `seen` is null before the first
 * sample and whenever the strip stops drawing, so the frame that resumes only records rather than
 * reading a mid-swing return as a re-arm.
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
  // Stated, or the kit opens at its fallback and leaves an invisible drag area over the game.
  height: stripHeight(rowHeight()),
  density: 'bare',
  save: true,
  // A bare strip has no chrome to dismiss it with, so this is the only way off screen.
  toggleKey: 'toggle',
  // Resizable, because the player reads numbers off these bars' width.
  resizable: true,
  // Both bounds are stated, or the frame takes its first paint as its floor. The height floor is
  // the row-height setting's minimum over every line the strip can show (see `floorLines`). Bounds
  // are read once, so switching a row off keeps the floor until reload.
  minWidth: MIN_FRAME_WIDTH,
  minHeight: stackHeight(MIN_HEIGHT, floorLines()),
  /**
   * The lines follow the box; measuring the element would force a layout per pointer move. Split
   * between SHOWN lines, so hiding a row makes the rest taller.
   */
  onMove: fitLines,
});
frame.body.appendChild(list);

/**
 * The latency band, inside the cast row behind its text. A negative z-index like the kit's fill,
 * appended after it, so it sits over the fill and under the label.
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
      const row = createRow(key, label);
      // See `LATE_ROWS`: no line until a frame finds something to put in it.
      if (LATE_ROWS.includes(key)) {
        woc.ui.show(row.bar.el, false);
      }
      rows.set(key, row);
    }
  }
  if (rows.has('power')) {
    list.appendChild(pips);
  }
}

/**
 * The cast's label and school, looked up only when the ability changes, since `world.abilities`
 * rebuilds a signature over the whole spellbook on every read.
 *
 * `woc.fmt.titleCase` is the fallback outside your spellbook, wrong where the display name diverges
 * from the id but better than a blank row. An activity sentinel in `castingAbility` resolves in no
 * spellbook, so the lane reads "Crafting"; the game's cast bar does the same, and an exclusion list
 * would need editing every release.
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
 * What the first swing is measured against, from a hand's base speed. Melee haste and stance
 * mastery are NOT on the wire and the game applies both to either hand, so both seeds run long
 * until the first observed reset.
 */
function swingSeed(me, speed) {
  const period = foldAuras(me, SWING_SLOW_KINDS, numberOf(speed), stretched);
  const haste = foldAuras(me, SWING_HASTE_KINDS, 0, hastened);
  return period / (1 + Math.max(0, haste));
}

/** The swing row. Without `autoAttack` there is nothing to count to. */
function paintSwing(row, me) {
  const remaining = numberOf(me.swingTimer);
  const total = relearn(swing, remaining, swingSeed(me, me.weapon?.speed));
  if (me.autoAttack !== true) {
    row.bar.update({ fraction: 0, value: 'off', tone: 'default' });
    return;
  }
  const fraction = share(remaining, total);
  row.bar.update({ fraction, value: seconds(remaining), tone: toneFor(fraction) });
}

/**
 * Hold an offhand, discarding the last one's learned period. Keyed on the ITEM, so a swap between
 * two weapons of one speed still relearns; null covers an unequip.
 */
function hold(itemId) {
  if (offhandSwing.item === itemId) {
    return;
  }
  offhandSwing.item = itemId;
  offhandSwing.total = 0;
  offhandSwing.seen = null;
}

/** Show or hide a row, redividing the box when that changed how many lines there are. */
function showRow(row, on) {
  if (!row.bar.el.hidden === on) {
    return;
  }
  woc.ui.show(row.bar.el, on);
  fitLines();
}

/**
 * The offhand swing, drawn only while one is held. `offhandWeapon !== null` answers dual-wield and
 * `offhandItemId` does not, since a shield fills the id. `offhandSwingTimer` sits at zero with the
 * swing off, hence 'off'.
 */
function paintOffhandSwing(row, me) {
  const offhand = me.offhandWeapon ?? null;
  showRow(row, offhand !== null);
  if (offhand === null) {
    hold(null);
    return;
  }
  hold(me.offhandItemId ?? null);
  const remaining = numberOf(me.offhandSwingTimer);
  const total = relearn(offhandSwing, remaining, swingSeed(me, offhand.speed));
  if (me.autoAttack !== true) {
    row.bar.update({ fraction: 0, value: 'off', tone: 'default' });
    return;
  }
  const fraction = share(remaining, total);
  row.bar.update({ fraction, value: seconds(remaining), tone: toneFor(fraction) });
}

/**
 * Point the row at an entity, discarding the last one's learned period. Null means nothing to
 * count, so a target dying or leaving range discards it too.
 */
function aimAt(id) {
  if (targetSwing.id === id) {
    return;
  }
  targetSwing.id = id;
  targetSwing.total = 0;
  targetSwing.seen = null;
}

/** Why the target row cannot count, or null when it can. `object` is the game's own exclusion. */
function targetStand(target) {
  if (target === null) {
    return 'no target';
  }
  if (target.dead === true) {
    return 'dead';
  }
  if (target.kind === 'object' || target.autoAttack !== true) {
    return 'off';
  }
  return null;
}

/** So the row says which entity the period on it was learned from. */
function targetName(target) {
  if (typeof target.name === 'string' && target.name.length > 0) {
    return target.name;
  }
  return 'Target';
}

/**
 * The target's swing, read live since the target may have been replaced. `NO_SEED` because no
 * weapon speed rides a non-self record; do not guess from the mob template, whose swing is a weapon
 * times a haste multiplier under three clamps.
 */
function paintTargetSwing(row) {
  const target = woc.world.unit('target');
  const stood = targetStand(target);
  if (stood !== null) {
    aimAt(null);
    row.bar.update({ label: 'Target', fraction: 0, value: stood, tone: 'default' });
    return;
  }
  aimAt(target.id);
  const remaining = numberOf(target.swingTimer);
  const fraction = share(remaining, relearn(targetSwing, remaining, NO_SEED));
  row.bar.update({
    label: targetName(target),
    fraction,
    value: seconds(remaining),
    tone: toneFor(fraction),
  });
}

/** Whether one of your own effects is of this kind. The array is the game's. */
function hasKind(me, kind) {
  const carried = me.auras;
  if (!Array.isArray(carried)) {
    return false;
  }
  return carried.some((aura) => aura?.kind === kind);
}

/**
 * The movement multiplier when it is worth saying, or null when it is not.
 *
 * `world.moveSpeedMult` carries no breakdown, so the row names no cause. Null means no answer
 * (before world entry, offline, spectating) and is tested by kind, since 0 is a real reading. A
 * slow-immune player with a snare reads exactly 1; a ghost is a flat 1.25, a mount adds 60% to 80%,
 * and stealth is folded into the same `Math.min` as a snare, so the number cannot tell those apart.
 */
function speedToShow(me) {
  const mult = woc.world.moveSpeedMult;
  if (typeof mult !== 'number' || !Number.isFinite(mult) || mult === 1) {
    return null;
  }
  if (me.ghost === true || hasKind(me, 'stealth')) {
    return null;
  }
  if (typeof me.mountKey === 'string' && me.mountKey.length > 0) {
    return null;
  }
  return mult;
}

/** Slowed is the reading worth catching. At or above your normal speed is not. */
function speedTone(mult) {
  if (mult < 1) {
    return 'warn';
  }
  return 'default';
}

/**
 * The fill is the share of your NORMAL speed; above 1 the kit clamps it and the figure carries the
 * excess.
 */
function paintSpeed(row, me) {
  const mult = speedToShow(me);
  showRow(row, mult !== null);
  if (mult === null) {
    return;
  }
  row.bar.update({
    fraction: mult,
    value: `${String(Math.round(mult * PERCENT))}%`,
    tone: speedTone(mult),
  });
}

/** The unhasted base; one class alone has a shorter one. */
function gcdBase(me) {
  if (me.templateId === ROGUE) {
    return ROGUE_GCD_SECONDS;
  }
  return GCD_SECONDS;
}

/**
 * The game's own arithmetic, so the row is exact on the first press. Three terms the obvious
 * version gets wrong: a rogue's base is 1.0, no haste goes under the 0.75 floor, and haste auras
 * ADD to `spellHaste`.
 */
function gcdLength(me) {
  const haste = foldAuras(me, HASTE_AURA_KINDS, numberOf(me.spellHaste), added);
  return Math.max(MIN_GCD_SECONDS, gcdBase(me) / (1 + Math.max(0, haste)));
}

/**
 * Empty rather than zero when not running, since that is ready. The length is recomputed each
 * frame, so an aura falling off mid-cooldown can leave remaining above length; the kit clamps the
 * fill.
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
 * The last stretch of the cast your round trip covers, drawn from the left edge because the fill
 * drains toward it.
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
 * One pip per point, over as many slots as the most seen. Repainted only when the count moved. The
 * first point adds a line, so the box is redivided on that frame.
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
  if (key === 'oswing') {
    return offhandTip();
  }
  if (key === 'speed') {
    return speedTip();
  }
  if (key === 'tswing') {
    return targetTip();
  }
  if (key === 'gcd') {
    return { title: 'Global cooldown', lines: ['Empty means your next press goes through.'] };
  }
  if (key === 'cast') {
    return { title: castMemo.label, lines: [latencyLine()] };
  }
  return { title: 'Resource', lines: powerLines() };
}

function offhandTip() {
  return {
    title: 'Offhand swing',
    lines: [
      'Counts to your offhand auto-attack, which runs on its own clock.',
      {
        text: 'Your weapon speed is the unhasted one, so the length starts as an estimate and is corrected by watching one swing, exactly as the mainhand above is.',
        tone: 'muted',
      },
    ],
  };
}

function speedTip() {
  return {
    title: 'Movement speed',
    lines: [
      'The share of your normal speed the server says you are moving at.',
      {
        text: 'One net figure over everything affecting you, with no breakdown, so this names no cause. There is no yards-per-second anywhere on the wire.',
        tone: 'muted',
      },
      {
        text: 'Silent while mounted, stealthed or a ghost: each of those reads exactly like a snare or a rush and is not one.',
        tone: 'muted',
      },
    ],
  };
}

function targetTip() {
  return {
    title: 'Target swing',
    lines: [
      "Counts to your target's next auto-attack.",
      {
        text: 'No weapon speed is sent for anyone but you, so the length is learned by watching this target swing once. Until then the bar starts full.',
        tone: 'muted',
      },
      { text: 'Switching target throws that away rather than carrying it over.', tone: 'muted' },
    ],
  };
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
  paintRow('oswing', paintOffhandSwing, me);
  paintRow('tswing', paintTargetSwing, me);
  paintRow('gcd', paintGcd, me);
  paintRow('cast', paintCast, me);
  paintRow('speed', paintSpeed, me);
  paintRow('power', paintPower, me);
}

/**
 * The frame's visibility is the player's and the loader persists it; writing it here would fight
 * the restore.
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
  offhandSwing.seen = null;
  targetSwing.seen = null;
}

buildRows();
applyVisibility();

// The one subscription: combat is a state change, which is what `world.on` reports; everything else
// counts down.
woc.world.on('combat', applyVisibility);

// On the loader's frame loop, which is what bars moving every frame need.
woc.onFrame(() => {
  const me = woc.world.player;
  if (frame.visible && !list.hidden && me !== null) {
    draw(me);
    return;
  }
  stand();
});

/**
 * Throw the rows away and rebuild: which rows exist and how tall they are are both fixed when a row
 * is built.
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
  // The rows the settings now ask for, divided into the existing box. A new row height cannot land
  // here: the bare frame's height cannot be restated, so the rows would be clipped. It applies next
  // reload.
  fitLines();
}

woc.onSettingsChange(rebuild);

// Nothing is registered with `woc.onDispose`: everything lives in kit widgets or the frame body,
// which the loader drains on disable, and `woc.onFrame` is unsubscribed with them.
