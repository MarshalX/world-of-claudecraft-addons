/// <reference types="@woc-addons/types" />

// Cooldown Bars: one draining timer per ability you are waiting on.
//
// The point of this example is the difference between the two things the world
// API gives you. `world.on('cooldowns')` reports the SET changing: a cooldown
// started, or one finished. It deliberately does not fire as a number counts
// down, because at the frame rate that would be a handler call per ability per
// frame reporting nothing anyone acts on.
//
// So the drawing is the addon's own. The subscription decides WHICH rows exist
// and a frame loop decides how full each one is, reading `world.cooldowns` as it
// goes. That split is the pattern for anything that has to animate: subscribe
// for the change, animate from the read.
//
// The rows themselves come from the loader's kit rather than from this file. A
// `woc.ui.bar` is an icon, a name that truncates, a fill behind both, and a
// right-aligned figure in tabular figures so the digits do not shuffle as they count
// down. This addon used to build that out of about twenty inline style declarations,
// and the reason it no longer does is that Combat Meter had built the same thing
// slightly differently. Anything an addon draws that looks like a timer comes from
// here, in one of the two shapes the last paragraph describes.
//
// The full length of an ordinary cooldown is not published. What is readable is how
// much is LEFT, so a bar's total is whatever it had left the moment it appeared.
// That is exact for a cooldown that starts while you are watching, and honest about
// one that was already running when the addon loaded: it fills the bar from wherever
// it was found rather than pretending to know the rest.
//
// A cooldown only ever counts DOWN, so a remaining that goes UP can only mean the
// ability was re-armed, and the bar re-learns its length there. The game does this
// in ways the set of running ids does not report: casting one shaman shock sets the
// cooldown on every shock, so an entry with two seconds left jumps back to six with
// no id joining or leaving, and the subscription stays silent. Without the
// re-learn a bar whose first sighting was part-way down has a denominator smaller
// than what is left, and reads FULL for the whole difference.
//
// The one case that cannot be detected is a reset followed by a re-press onto a
// shorter cooldown, where the new remaining lands below the old one: 30 then 15
// then 10 is what draining looks like. If any frame catches the gap at zero the
// bar is dropped and rebuilt correctly, and if none does the bar reads low until
// it next reaches zero. Nothing on the wire distinguishes those two, so the addon
// does not pretend to.
//
// CHARGES are the exception to all of that, and the only exact bar here. An ability
// with a charge pool (Twinstrike, Double Charge, frost's second Ice Block) carries
// a real recharge LENGTH alongside its remaining, so its bar has a true denominator
// from the first frame and needs no re-learning at all. Those rows are read from
// `world.player.abilityCharges` in the frame loop rather than from a subscription,
// because a charge regenerating while the pool still holds a use changes no
// cooldown id: the set stays exactly as it was and the subscription never fires.
// Walking that record per frame is cheap in a way walking the cooldown map is not,
// since only a handful of abilities have charges at all.
//
// What is NOT read is `maxCharges`. The server keeps the maximum to itself, so the
// field is present, numeric, and permanently zero, which is why the count reads as
// "2 left" rather than as "2 of 3".
//
// The rows come in two shapes, and the `layout` setting picks between them. A bar
// is a row with the ability's NAME on it, read down a column; a tile is a square
// where the art is the label, read across a strip. Both are kit primitives with the
// same {el, update, destroy}, so everything below the two builders is written once
// and neither shape is the special case. What genuinely differs is where a charge
// count goes and how much room the countdown has, and that is nearly the whole of
// it: the rest is the direction of one flex line.
//
// The strip is also RESIZABLE, and its height is the icon size. That is the one
// place this addon asks the loader for something rather than drawing it: a frame's
// box belongs to the loader, which writes it on a drag, on a viewport change and on
// a restore, so `onMove` is how an addon lays out against it. Measuring the element
// instead would force a synchronous layout on every frame of a display that already
// writes styles on every frame.
//
// The height is the size and the width is only room to grow into, which is a
// deliberate choice rather than an omission: tiles sized to fill the width would
// have to shrink as more cooldowns started, so the icons would change size in the
// middle of a fight, which is exactly when a player is picking one out by shape.
// A frame cannot be dragged SMALLER than the size it was created at, so the strip
// starts at the tap-target floor the game holds its own controls to and grows.

const DECIMALS = 1;
const FRAME_WIDTH = 220;
const DEFAULT_MAX_BARS = 8;
/** The global cooldown, and the floor under "worth drawing a bar for". */
const GCD_SECONDS = 1.5;
/** Below this share left, the row goes warm: it is about to be ready. */
const NEARLY_READY = 0.25;
/** Over this, a tile's countdown is drawn in minutes: 40 pixels does not fit "119". */
const SECONDS_PER_MINUTE = 60;
/**
 * The tile strip's starting height, which is also its floor and its icon size.
 *
 * 40 is the tap-target floor the game holds its own controls to, and the kit's own
 * default tile. It is the floor here because a frame's minimum IS the size it was
 * created at, so this is the smallest the strip can be dragged.
 */
const TILE_START = 40;
/** How wide the strip starts. Only room to grow into: see the note at the top. */
const STRIP_WIDTH = 260;

/** Ability id to the row tracking it: the kit widget, and what it had left when seen. */
const rows = new Map();

/** The current icon size, which is the strip's height. Ignored by the bars layout. */
let tileSize = TILE_START;

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

/**
 * 'aimed_shot' reads as 'Aimed Shot'. The FALLBACK, not the label.
 *
 * A guess from the id, and it is wrong wherever the two have diverged: `arcane_shot`
 * is displayed as "Fell Shot", so this returns a name nothing else in the game calls
 * that ability. It is only reached for an id the spellbook does not carry, which is
 * something you did not learn: an item cooldown, or an ability granted by something
 * other than your class kit. Wrong-but-readable beats blank for those.
 */
function readable(abilityId) {
  return abilityId
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * What the game actually calls this ability.
 *
 * A cooldown map is keyed by ability ID, and the id and the display name have
 * diverged, so for a long time these rows showed a title-cased id and there was no
 * way to do better. `world.abilities` is that way: it carries both for everything in
 * your own kit, which is everything with a cooldown you can see.
 */
function abilityName(abilityId) {
  return woc.world.abilities.byId(abilityId)?.name ?? readable(abilityId);
}

/**
 * Your class, which is where the game files a skill icon.
 *
 * An entity's `templateId` is its mob template, except on a player, where it is the
 * class id. Everything with a cooldown here is something you cast, so your own is
 * the only one that ever applies.
 */
function playerClass() {
  return woc.world.player?.templateId ?? '';
}

/** Whether the timers are drawn as squares. Anything unrecognised is the default. */
function drawsTiles() {
  return woc.settings.layout === 'tiles';
}

// One flex line, whose DIRECTION is the layout. It outlives the frame, because a
// layout change rebuilds the frame and this keeps every row that survives it.
const list = document.createElement('div');
list.className = 'woc-cd-list';
list.style.display = 'flex';
list.style.gap = '3px';

/**
 * The overlay. Bare, and resizable only where resizing means something.
 *
 * Bare: the rows ARE the display, so a panel behind them is furniture around a
 * thing that needs none. The title is kept even though nothing draws it, because
 * it is the frame's accessible name and the label the loader shows while frames
 * are unlocked.
 *
 * The trade is that this frame is invisible while nothing is on cooldown, which is
 * most of the time out of combat. That is correct for an overlay and is why the
 * loader has an unlock mode: it outlines every frame, empty ones included, so this
 * can be positioned at rest.
 *
 * Only the tile strip resizes. A column of bars is sized by its content, and a
 * fixed height would either pad it out or hide the row that just started.
 *
 * The two layouts are two frame IDS, which means two saved boxes. Sharing one was
 * the obvious thing and is wrong: a frame's id is its persistence key, a column of
 * five bars saves a box a couple of hundred pixels tall, and restoring that height
 * into the strip would open it with icons the size of a portrait. They are also
 * different shapes that want different corners of the screen. 'bars' keeps its name
 * so a player who has already positioned it does not lose that.
 */
// #region frame
function buildFrame() {
  if (!drawsTiles()) {
    return woc.ui.frame({
      id: 'bars',
      title: 'Cooldowns',
      width: FRAME_WIDTH,
      density: 'bare',
      save: true,
    });
  }
  return woc.ui.frame({
    id: 'tiles',
    title: 'Cooldowns',
    width: STRIP_WIDTH,
    height: TILE_START,
    resizable: true,
    density: 'bare',
    save: true,
    onMove: (box) => {
      resize(box.h);
    },
  });
}

let frame = buildFrame();
frame.body.appendChild(list);
// #endregion

/**
 * Follow the strip's height, which is the icon size.
 *
 * Called at pointer rate while a resize is in progress, so it does nothing when the
 * height has not actually moved: a drag along the bottom edge changes the height on
 * every event, but a drag along the side changes only x and w.
 */
function resize(height) {
  if (height === tileSize || height <= 0) {
    return;
  }
  tileSize = height;
  for (const row of rows.values()) {
    row.ui.update({ size: tileSize });
  }
}

/** Column of bars, or strip of tiles. One declaration, because that is all it is. */
function applyLayout() {
  list.style.flexDirection = 'column';
  if (drawsTiles()) {
    list.style.flexDirection = 'row';
  }
}
applyLayout();

/**
 * One row, from the kit rather than hand-built.
 *
 * `data-ability` is the addon's own marking: the kit does not put one on, and this
 * is what lets the frame be read back by ability rather than by position.
 *
 * Not every ability ships painted art, and the ones that do not have no URL at all.
 * The kit hides its own icon slot when an image fails, so passing a URL that may
 * not resolve is the intended usage rather than something to guard against here.
 */
// #region bar
function createBar(abilityId) {
  const name = abilityName(abilityId);
  const bar = woc.ui.bar({
    label: name,
    icon: woc.ui.icon.ability(abilityId, playerClass()),
    className: 'woc-cd-bar',
  });
  bar.el.dataset.ability = abilityId;
  // The full name is one hover away, so truncating costs nothing.
  woc.ui.tooltip(bar.el, () => timerTooltip(abilityId));
  return bar;
}
// #endregion

/**
 * The same timer as a square, for the strip layout.
 *
 * The label is passed and never drawn: a tile is all art, so that string is how the
 * tile is announced rather than what it shows. The tooltip matters more here than on
 * a bar for the same reason, since the art is the only thing naming the ability, and
 * an ability with no painted file leaves a square with nothing on it but the sweep.
 */
// #region tile
function createTile(abilityId) {
  const name = abilityName(abilityId);
  const tile = woc.ui.tile({
    label: name,
    icon: woc.ui.icon.ability(abilityId, playerClass()),
    className: 'woc-cd-tile',
    // Whatever the strip is at now, so a tile that appears mid-fight matches the
    // ones beside it rather than the size the strip was created at.
    size: tileSize,
  });
  tile.el.dataset.ability = abilityId;
  woc.ui.tooltip(tile.el, () => timerTooltip(abilityId));
  return tile;
}
// #endregion

// #region tooltip
function timerTooltip(abilityId) {
  const name = abilityName(abilityId);
  const entry = timers().find((row) => row.abilityId === abilityId);
  if (entry === undefined) {
    return name;
  }
  const lines = [`${entry.remaining.toFixed(DECIMALS)}s left`];
  if (typeof entry.charges === 'number' && entry.charges > 0) {
    lines.push({ text: `${String(entry.charges)} charge(s) ready`, tone: 'good' });
  }
  if (entry.total === null) {
    lines.push({ text: 'length unknown, measured from when it was first seen', tone: 'muted' });
  }
  return { title: name, icon: woc.ui.icon.ability(abilityId, playerClass()), lines };
}
// #endregion

/** One timer in the shape the player picked. The kind travels with it: see `paint`. */
function createRow(abilityId) {
  if (drawsTiles()) {
    return { ui: createTile(abilityId), tile: true };
  }
  return { ui: createBar(abilityId), tile: false };
}

/**
 * The shortest cooldown worth a bar.
 *
 * A global cooldown is on almost every ability almost all the time, so drawing
 * those is a row of bars that flash once per press and say nothing.
 */
function shortestShown() {
  if (settingFlag('hide-short', true)) {
    return GCD_SECONDS;
  }
  return 0;
}

/** The charge pools, or an empty list before any ability with one has been used. */
function chargePools() {
  const pools = woc.world.player?.abilityCharges;
  if (typeof pools !== 'object' || pools === null) {
    return [];
  }
  return Object.entries(pools);
}

/**
 * Every ability regenerating a charge, with the exact length to measure against.
 *
 * `rechargeLength` is what makes these rows different from every other bar in this
 * addon: it is a real total, published, so the fill is right on the first frame.
 */
function rechargingAbilities() {
  const found = [];
  for (const [abilityId, pool] of chargePools()) {
    const remaining = Number(pool?.recharge);
    const total = Number(pool?.rechargeLength);
    if (remaining > 0 && total > 0) {
      found.push({ abilityId, remaining, total, charges: Number(pool?.charges) });
    }
  }
  return found;
}

/** Everything running, in whatever order the game's map is in. */
function runningCooldowns() {
  const live = woc.world.cooldowns;
  if (live === null) {
    return [];
  }
  const floor = shortestShown();
  const running = [];
  for (const [abilityId, remaining] of live) {
    if (remaining > 0 && (remaining >= floor || rows.has(abilityId))) {
      running.push({ abilityId, remaining, total: null, charges: null });
    }
  }
  return running;
}

/**
 * Every ability worth a bar right now, charge pools first.
 *
 * An ability whose pool has emptied is ALSO on cooldown, because the empty-pool
 * timer rides the ordinary cooldown wire. One row per ability, and the charge
 * reading wins where there is one, because it is the one with a real total.
 *
 * The charge pools are passed in rather than read here, because the frame loop has
 * already had to read them to know whether there is anything to do at all. Reading
 * them again would be the same walk twice in one frame.
 */
function timersFrom(recharging) {
  const found = [...recharging];
  const exact = new Set(found.map((entry) => entry.abilityId));
  for (const entry of runningCooldowns()) {
    if (!exact.has(entry.abilityId)) {
      found.push(entry);
    }
  }
  return found;
}

/** The same reading for the callers that have no pool list already in hand. */
function timers() {
  return timersFrom(rechargingAbilities());
}

/**
 * Rebuild the set of rows from what is running.
 *
 * A row that is already up keeps the total it was created with, so a rebuild does
 * not restart its fill. A row with a published total is marked exact and is never
 * re-baselined, since there is nothing to learn.
 *
 * The reading is a parameter, not a read. Everything below here runs inside one
 * frame and has to agree about what is running: taking a fresh reading per function
 * was three walks of the cooldown map for one frame, and the last of them could
 * legitimately disagree with the first about which rows exist.
 */
function syncRows(running) {
  const seen = new Set(running.map((entry) => entry.abilityId));

  for (const [abilityId, row] of rows) {
    if (!seen.has(abilityId)) {
      row.ui.destroy();
      rows.delete(abilityId);
    }
  }

  for (const { abilityId, remaining, total } of running) {
    if (!rows.has(abilityId)) {
      rows.set(abilityId, {
        ...createRow(abilityId),
        total: total ?? remaining,
        seen: remaining,
        exact: total !== null,
      });
    }
  }
  draw(running);
}

/** The three callers that want a sync but have no reading in hand. */
function resync() {
  syncRows(timers());
}

/** Soonest ready first, which is the order the next decision is made in. */
function drawOrder(running) {
  return running
    .filter((entry) => rows.has(entry.abilityId))
    .sort((a, b) => a.remaining - b.remaining)
    .slice(0, settingNumber('max-bars', DEFAULT_MAX_BARS));
}

/**
 * Re-learn a cooldown's length if it went back up.
 *
 * The only signal there is. A cooldown counts down, so an increase can only be a
 * re-arm, and it is the one the set of running ids never reports: a shared
 * cooldown re-arming an entry that is already running changes no id at all.
 *
 * A charge recharge is skipped: its total is published, so an increase there is a
 * fresh recharge starting against the same known length rather than news.
 */
function rebaseline(row, remaining) {
  if (!row.exact && remaining > row.seen) {
    row.total = remaining;
  }
  row.seen = remaining;
}

/** Warm as an ability comes back up, so a glance finds the next thing ready. */
function toneFor(fraction) {
  if (fraction <= NEARLY_READY) {
    return 'warn';
  }
  return 'default';
}

/** `4.2s`, or `4.2s (2)` for an ability still holding a charge while it recharges. */
function figure(remaining, charges) {
  const left = `${remaining.toFixed(DECIMALS)}s`;
  if (typeof charges === 'number' && charges > 0) {
    return `${left} (${String(charges)})`;
  }
  return left;
}

/**
 * The same figure with 40 pixels to say it in.
 *
 * A tile has no room for "119.4s" and no room for a charge count beside the time
 * either, so the seconds lose their decimal and their unit, anything over a minute
 * is drawn in minutes, and the count moves to the corner the kit keeps for it.
 * Rounded UP, so a tile never reads 0 while the ability is still coming back.
 */
function countdown(remaining) {
  if (remaining >= SECONDS_PER_MINUTE) {
    return `${String(Math.ceil(remaining / SECONDS_PER_MINUTE))}m`;
  }
  return String(Math.ceil(remaining));
}

/**
 * Tell one row where its timer has got to, in the terms its shape understands.
 *
 * The two kit widgets take the same three fields for the timer itself, so the only
 * branch is the charge count: a bar has one figure and carries it in parentheses,
 * a tile has a corner for it and a `count` field that hides itself when there is
 * nothing to show.
 */
function paint(row, remaining, charges, fraction) {
  const tone = toneFor(fraction);
  if (row.tile) {
    row.ui.update({ fraction, value: countdown(remaining), count: charges, tone });
    return;
  }
  row.ui.update({ fraction, value: figure(remaining, charges), tone });
}

function draw(running) {
  const order = drawOrder(running);
  const shown = new Set(order.map((entry) => entry.abilityId));
  for (const [abilityId, row] of rows) {
    if (!shown.has(abilityId)) {
      row.ui.el.remove();
    }
  }
  for (const [at, entry] of order.entries()) {
    const row = rows.get(entry.abilityId);
    rebaseline(row, entry.remaining);
    const fraction = Math.min(entry.remaining / row.total, 1);
    paint(row, entry.remaining, entry.charges, fraction);
    place(row.ui.el, at);
  }
}

/**
 * Put a row at its position, and only if it is not there already.
 */
// #region place
function place(el, at) {
  if (list.children[at] !== el) {
    list.insertBefore(el, list.children[at] ?? null);
  }
}
// #endregion

// #region subscribe-and-animate
// The cooldown set changes here; the numbers move in the frame loop below.
// Sampling the set every frame instead would be a Map walk per frame to notice
// nothing. Charges are the other way round, and the frame loop says why.
woc.world.on('cooldowns', resync);

/**
 * Redraw while anything is running, and do as little as possible when nothing is.
 */
let wasVisible = false;

function tick() {
  const { visible } = frame;
  const appeared = visible && !wasVisible;
  wasVisible = visible;
  if (visible) {
    const recharging = rechargingAbilities();
    if (appeared || recharging.length > 0) {
      syncRows(timersFrom(recharging));
    } else if (rows.size > 0) {
      draw(timersFrom(recharging));
    }
  }
  woc.requestAnimationFrame(tick);
}
woc.requestAnimationFrame(tick);
// #endregion

resync();

// #region keybind
woc.keys.bind('toggle', () => {
  frame.toggle();
});
// #endregion

/**
 * Throw every row away and start again.
 *
 * A row's SHAPE is decided when it is built, so a layout change cannot be repainted
 * into: the elements themselves have to go. Everything else a settings change can
 * move (how many rows, whether short cooldowns count) is answered by the next sync,
 * and rebuilding for those costs one frame of a display that redraws every frame
 * anyway.
 */
function rebuild() {
  for (const [abilityId, row] of rows) {
    row.ui.destroy();
    rows.delete(abilityId);
  }
  // The frame goes too, because whether it resizes is decided when it is built.
  // Rebuilding under the same id restores the same saved box, so the overlay does
  // not move; the tile size goes back to the floor and the restore moves it again.
  const previous = frame;
  // Back to the floor BEFORE the new frame exists, because a restored box reports
  // its height through onMove and that answer has to win rather than be overwritten.
  tileSize = TILE_START;
  frame = buildFrame();
  frame.body.appendChild(list);
  previous.destroy();
  applyLayout();
  resync();
}

woc.onSettingsChange(rebuild);
