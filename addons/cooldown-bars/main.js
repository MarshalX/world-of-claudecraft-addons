/// <reference types="@woc-addons/types" />

// Cooldown Bars: one draining timer per ability you are waiting on.
//
// `world.on('cooldowns')` reports the SET changing and never a number counting down, so
// the subscription decides which rows exist and a frame loop decides how full each is.
//
// A denominator comes from `world.abilities.byId`, which covers your own kit and nothing
// else. An item cooldown, a granted ability, or something that is not an ability at all
// (the anti-relog timer rides this map as `system_unstuck`) has no published length, so
// those rows measure against what they had left when they appeared, and cannot be named
// either: the title-cased id is marked with foretell's `?` so a player learns it once.
//
// A remaining that goes UP means the ability was re-armed, which is how a measured row
// re-learns its length. UNDETECTABLE: a reset then a re-press onto a shorter cooldown
// lands below the old remaining, which nothing on the wire tells from draining.
//
// Every running cooldown is HELD and only the first few drawn, which is `shown`: a row
// pushed off the bottom keeps the length it measured rather than re-learning one from
// mid-cooldown.
//
// Charge pools are exact without the spellbook, since `rechargeLength` is on the wire,
// and are read in the frame loop because the game deletes the cooldown entry while a
// charge is left. `maxCharges` is present, numeric and permanently zero, so the pool
// size comes from `AbilityInfo.charges`.
//
// Both layouts are the player's to size, and each reads its box differently. The strip's
// height is one icon and its width is only room to grow into, or tiles would resize as more
// cooldowns started. The column's height is the whole BUDGET of rows divided between them,
// which is the one thing a column cannot take from the rows currently up: a cooldown
// starting would then resize every other row under the eye of the player who pressed it.

const DECIMALS = 1;
const FRAME_WIDTH = 220;
/** How narrow the column may be dragged. Under this the figure crowds the name off. */
const MIN_FRAME_WIDTH = 120;
/** The global cooldown, and the floor under "worth drawing a bar for". */
const GCD_SECONDS = 1.5;
/** Below this share left, the row goes warm: it is about to be ready. */
const NEARLY_READY = 0.25;
/** What a worked-out ability name is marked with. Foretell's mark, deliberately. */
const GUESS_MARK = '?';
/**
 * The tile strip's starting height, which is also its floor and its icon size. 40 is
 * the tap-target floor the game holds its own controls to, and it is the floor on both
 * axes: one square of height, and one square's worth of room to grow from.
 */
const TILE_START = 40;
/** How wide the strip starts. Only room to grow into. */
const STRIP_WIDTH = 260;
/** The gap between two timers, in either direction. The height budget is stated over it. */
const ROW_GAP = 3;
/**
 * A bar's natural height, measured in a browser: the kit's own 18px icon inside the 2px of
 * padding `.woc-bar` carries. It is the column's floor as well as its opening row, so the
 * column only ever grows. Rows any denser than this is what `max-bars` is for, and a saved
 * box from before the column resized carries the loader's own default height rather than
 * one anybody chose, so a floor below this would silently reopen those columns cramped.
 */
const BAR_HEIGHT = 23;
/** The icon slot in `.woc-bar`, transcribed. See `styleBar` for why it cannot be an em. */
const BAR_ICON = 18;
/** How far past its natural height a row may be dragged. */
const MAX_BAR_SCALE = 3;
/** The grab strip along a panel's growing edge, as thin as interactjs makes that edge. */
const GRIP = 10;

/** The current icon size, which is the strip's height. Ignored by the bars layout. */
let tileSize = TILE_START;

/**
 * The box the column's rows divide between, and the row height that came out of it.
 *
 * A frame's height cannot be restated after it is built and a bare frame CLIPS rather than
 * scrolls, so this is a budget rather than a measurement. Null until a frame has been built.
 */
let boxHeight = null;
let barPx = null;

/**
 * What to call this ability, and whether that was worked out rather than read.
 *
 * `describe` covers your own kit and says which answer you got: an id it does not carry
 * comes back title-cased under `known: false`. The mark goes on the label rather than in
 * a footnote so it survives a tile, where the art is the label.
 */
function describe(abilityId) {
  const found = woc.world.abilities.describe(abilityId);
  if (found.known) {
    return { label: found.name, guessed: false };
  }
  return { label: `${found.name}${GUESS_MARK}`, guessed: true };
}

/**
 * A published figure, or null. The two say "nothing here" differently: `cooldown` is 0
 * for an ability with none, `charges` absent for a single-use one, and either would
 * poison a division.
 */
function stated(value) {
  if (typeof value === 'number' && value > 0) {
    return value;
  }
  return null;
}

/**
 * What the spellbook knows, resolved AFTER talents, so a hunter who spent the point reads
 * 5.4 where the content table says 6. The two nulls are answered differently: no length
 * puts the row on the measured path, no pool size only drops a denominator off the count.
 */
function published(abilityId) {
  const info = woc.world.abilities.byId(abilityId);
  return { length: stated(info?.cooldown), pool: stated(info?.charges) };
}

/**
 * The damage school to tint this timer by, or null for none.
 *
 * Only ever what the spellbook carries. A measured row is measured BECAUSE the game
 * published nothing about that ability, so the honest answer there is no colour: an item
 * cooldown and the anti-relog timer are not made of any kind of damage, and inventing one
 * for them would be a claim about the row that nothing made.
 *
 * The string goes through unchecked on purpose. Which schools exist is the KIT's to hold: it
 * tints nothing for a value it does not know, and the same list written out here would be a
 * second claim about the game's palette, free to drift from the first while both still
 * looked right on their own.
 */
function tintFor(abilityId) {
  if (!woc.settings['tint-school']) {
    return null;
  }
  return woc.world.abilities.byId(abilityId)?.school ?? null;
}

/**
 * Your class, which is where the game files a skill icon. An entity's `templateId` is
 * its mob template, except on a player, where it is the class id.
 */
function playerClass() {
  return woc.world.player?.templateId ?? '';
}

/** Whether the timers are drawn as squares. Anything unrecognised is the default. */
function drawsTiles() {
  return woc.settings.layout === 'tiles';
}

/** How many rows the column is sized for, which is the budget rather than a count. */
function maxBars() {
  return woc.settings['max-bars'];
}

function stackHeight(height, count) {
  return count * height + (count - 1) * ROW_GAP;
}

/** The row height the box works out to, held between the natural row and its ceiling. */
function barHeight() {
  const wanted = barPx ?? BAR_HEIGHT;
  return Math.min(Math.max(wanted, BAR_HEIGHT), BAR_HEIGHT * MAX_BAR_SCALE);
}

/**
 * Size one row to the share of the box it was given, art and text with it: a row dragged to
 * three times its height and left holding an 18px icon is a picture with a hole under it.
 *
 * The font is written as an `em`, which is what makes the floor a no-op rather than a change:
 * a row keeps whatever size the game's own font is set to, and a pixel figure calibrated
 * here would be that figure in a game that inherits something else. The icon cannot do the
 * same, because `.woc-bar-icon` is 18px in the kit's own sheet and an em on the slot would be
 * measured against the font this just changed. That 18 is transcribed, so a kit that restyles
 * the slot moves this out of step, and the cost is an icon a few pixels off its row.
 *
 * The three flex declarations are what make the height above the truth rather than a request:
 * a kit row is a block sized by its own line box, so without them the extra height sits under
 * the content instead of around it.
 */
function styleBar(el) {
  const height = barHeight();
  const scale = height / BAR_HEIGHT;
  el.style.height = `${String(height)}px`;
  el.style.boxSizing = 'border-box';
  el.style.display = 'flex';
  el.style.flexDirection = 'column';
  el.style.justifyContent = 'center';
  el.style.fontSize = `${String(scale)}em`;
  const icon = el.querySelector('.woc-bar-icon');
  if (icon !== null) {
    const size = `${String(Math.round(BAR_ICON * scale))}px`;
    icon.style.width = size;
    icon.style.height = size;
  }
}

/**
 * Divide the box between the budget of rows, on every box change. The gaps are paid before
 * the division and the share floored, since a pixel over the box is a pixel of the bottom row
 * the frame quietly clips.
 *
 * The layout is asked rather than each row, because a box can arrive from a frame the player
 * has just switched away from: a restore lands asynchronously and the old frame outlives the
 * rebuild by a moment, so the row it would style is a tile by then.
 */
function fitBars() {
  if (boxHeight === null || drawsTiles()) {
    return;
  }
  const budget = maxBars();
  const next = Math.floor((boxHeight - (budget - 1) * ROW_GAP) / budget);
  if (next === barPx) {
    return;
  }
  barPx = next;
  for (const row of rows.values()) {
    styleBar(row.ui.el);
  }
}

// One flex line, whose DIRECTION is the layout. It outlives the frame, because a
// layout change rebuilds the frame and this keeps every row that survives it.
const list = document.createElement('div');
list.className = 'woc-cd-list';
list.style.display = 'flex';
list.style.gap = `${String(ROW_GAP)}px`;

/**
 * The one edge a player can always take hold of.
 *
 * A bare frame passes the pointer through everything it did not DRAW, and neither layout
 * fills its own box: the column is sized for its whole budget of rows and the strip for more
 * tiles than are usually up, so the edge that grows each of them is over dead space almost
 * always. Without this, the drag works only in the moment the panel happens to be full, and a
 * player who tries once and gets nothing concludes the panel does not resize. The loader's
 * arrange mode does hand the whole frame back, and it is the wrong thing to need for a
 * gesture the player is already making correctly.
 *
 * What it takes from the game is a strip as thin as the edge itself, along one side of a
 * panel the player put there. Positioned against the frame rather than laid out in the list,
 * or it would be a row in the column and a tile in the strip. It has to be a direct child of
 * the frame BODY, which is what the kit hands the pointer back to.
 */
function buildGrip() {
  const grip = document.createElement('div');
  grip.className = 'woc-cd-grip';
  grip.style.position = 'absolute';
  // The growing edge of whichever layout is up: the bottom of a column, the side of a strip.
  if (drawsTiles()) {
    grip.style.inset = '0 0 0 auto';
    grip.style.width = `${String(GRIP)}px`;
    return grip;
  }
  grip.style.inset = 'auto 0 0 0';
  grip.style.height = `${String(GRIP)}px`;
  return grip;
}

/**
 * Ability id to its widget, denominator, whether that was published, and pool size.
 *
 * The bar budget is applied by `shown` rather than before the sync, so a row cut off the
 * bottom keeps the length it measured. Rebuilt when it came back, it would baseline from
 * mid-cooldown and draw a bar that is wrong rather than one that is missing.
 */
// #region list
const rows = woc.ui.list({
  parent: list,
  key: (entry) => entry.abilityId,
  create: createRow,
  update: paintRow,
  shown: (_entry, index) => index < woc.settings['max-bars'],
  element: (row) => row.ui.el,
});
// #endregion

/**
 * The strip: bare, because the tiles are the display, and one square tall to start.
 *
 * Both axes take the same floor. One tap-target square is a whole tile whatever the bar
 * budget is set to and however many cooldowns are running.
 */
function buildStrip() {
  return woc.ui.frame({
    id: 'tiles',
    title: 'Cooldowns',
    width: STRIP_WIDTH,
    height: TILE_START,
    resizable: true,
    density: 'bare',
    save: true,
    toggleKey: 'toggle',
    minWidth: TILE_START,
    minHeight: TILE_START,
    onMove: (box) => {
      resize(box.h);
    },
  });
}

/**
 * Two frame ids and therefore two saved boxes. Shared, a column's height would open the
 * strip with icons the size of a portrait.
 */
function buildFrame() {
  if (drawsTiles()) {
    return buildStrip();
  }
  return buildColumn();
}

/**
 * The column: bare for the reason the strip is, and sized for the whole BUDGET of rows
 * rather than for the rows that happen to be running, so the ones a player is watching hold
 * still as cooldowns come and go. What that costs is dead space under a half-full column,
 * which is what `buildGrip` is there to keep hold of.
 *
 * Its floor is the natural row and there is nothing under it: a denser column is what
 * `max-bars` is for, and a shorter box could only crop rows a bare frame then clips. Stated
 * rather than left to the default that works out the same, because it is a decision.
 *
 * The title is still the frame's accessible name and its label while frames are unlocked.
 */
// #region frame
function buildColumn() {
  // The height asked for, which stands until a box of the player's own arrives on `onMove`.
  boxHeight = stackHeight(BAR_HEIGHT, maxBars());
  return woc.ui.frame({
    id: 'bars',
    title: 'Cooldowns',
    width: FRAME_WIDTH,
    height: boxHeight,
    resizable: true,
    density: 'bare',
    save: true,
    toggleKey: 'toggle',
    minWidth: MIN_FRAME_WIDTH,
    minHeight: stackHeight(BAR_HEIGHT, maxBars()),
    maxHeight: stackHeight(BAR_HEIGHT * MAX_BAR_SCALE, maxBars()),
    // The rows follow the box. Measuring the element would force a synchronous layout on
    // every pointer move, for a number the loader is holding anyway.
    onMove: (box) => {
      boxHeight = box.h;
      fitBars();
    },
  });
}

let frame = buildFrame();
frame.body.appendChild(list);
frame.body.appendChild(buildGrip());
// #endregion

/**
 * Follow the strip's height, which is the icon size. The floor is applied here as well as
 * stated on the frame, since the size has to hold for a box from anywhere: a restored
 * one, a viewport clamp, or a height a future bound lets through.
 *
 * The size reaches the tiles already up through `paint`, on the next frame. A tile drops
 * an update repeating a size it holds, so a strip nobody is dragging pays nothing.
 */
function resize(height) {
  tileSize = Math.max(Math.round(height), TILE_START);
}

function applyLayout() {
  list.style.flexDirection = 'column';
  if (drawsTiles()) {
    list.style.flexDirection = 'row';
  }
}
applyLayout();

/**
 * `data-ability` is this addon's own marking, so the frame reads back by ability rather
 * than by position. Not every ability ships art, and the kit hides its icon slot when an
 * image fails, so a URL that may not resolve is intended usage.
 *
 * The school is set once, here, rather than on every paint: it is a fact about the ability
 * and cannot change while the row is up, and the setting that switches it on rebuilds.
 */
// #region bar
function createBar(abilityId) {
  const { label } = describe(abilityId);
  const bar = woc.ui.bar({
    label,
    icon: woc.ui.icon.ability(abilityId, playerClass()),
    className: 'woc-cd-bar',
    school: tintFor(abilityId),
  });
  bar.el.dataset.ability = abilityId;
  // Whatever the column is at now, so a bar appearing mid-fight matches its neighbours.
  styleBar(bar.el);
  // The full name is one hover away, so truncating costs nothing.
  woc.ui.tooltip(bar.el, () => timerTooltip(abilityId));
  return bar;
}
// #endregion

/**
 * The same timer as a square. The label is passed and never drawn: a tile is all art, so
 * that string is only how it is announced, and the tooltip matters more here since an
 * ability with no file leaves a square holding nothing but its sweep.
 */
// #region tile
function createTile(abilityId) {
  const { label } = describe(abilityId);
  const tile = woc.ui.tile({
    label,
    icon: woc.ui.icon.ability(abilityId, playerClass()),
    className: 'woc-cd-tile',
    // Whatever the strip is at now, so a tile appearing mid-fight matches its neighbours.
    size: tileSize,
    // A tile wears its school as a BORDER, which is where the game puts one too.
    school: tintFor(abilityId),
  });
  tile.el.dataset.ability = abilityId;
  woc.ui.tooltip(tile.el, () => timerTooltip(abilityId));
  return tile;
}
// #endregion

function chargeWord(charges) {
  if (charges === 1) {
    return 'charge';
  }
  return 'charges';
}

function chargeLine(charges, pool) {
  if (pool === null) {
    return `${String(charges)} ${chargeWord(charges)} ready`;
  }
  return `${String(charges)} of ${String(pool)} charges ready`;
}

/** The long version of the mark. Nothing for a name the game supplied. */
function guessLine(abilityId) {
  return {
    text: `Worked out from the ability id \`${abilityId}\`. The game publishes an ability's own name only for your own spellbook, so this is a guess and is wrong wherever the two have diverged.`,
    tone: 'muted',
  };
}

// #region tooltip
/**
 * What the row is, and how much of it is measured rather than known. The two hedges are
 * independent: a charge pool's length rides the wire, so such a row is exact and still
 * unnamed. The length line describes the denominator this bar was BUILT against, which a
 * row raised before the spellbook arrived keeps for life.
 */
function timerTooltip(abilityId) {
  const { label, guessed } = describe(abilityId);
  const entry = timers().find((timer) => timer.abilityId === abilityId);
  const row = rows.get(abilityId);
  if (entry === undefined || row === undefined) {
    return label;
  }
  const lines = [`${entry.remaining.toFixed(DECIMALS)}s left`];
  if (typeof entry.charges === 'number' && entry.charges > 0) {
    lines.push({ text: chargeLine(entry.charges, row.pool), tone: 'good' });
  }
  if (guessed) {
    lines.push(guessLine(abilityId));
  }
  if (!row.exact) {
    lines.push({ text: 'length unknown, measured from when it was first seen', tone: 'muted' });
  }
  return { title: label, icon: woc.ui.icon.ability(abilityId, playerClass()), lines };
}
// #endregion

/** One timer in the shape the player picked. The kind travels with it: see `paint`. */
function createWidget(abilityId) {
  if (drawsTiles()) {
    return { ui: createTile(abilityId), tile: true };
  }
  return { ui: createBar(abilityId), tile: false };
}

/**
 * One row, with the denominator it is measured against for the rest of its life. The
 * spellbook is read here rather than in the reading, so it costs one lookup per row
 * rather than one per running cooldown per frame.
 */
function createRow(entry) {
  const known = published(entry.abilityId);
  const length = entry.total ?? known.length;
  const built = createWidget(entry.abilityId);
  return {
    ...built,
    total: length ?? entry.remaining,
    seen: entry.remaining,
    exact: length !== null,
    pool: known.pool,
    destroy: built.ui.destroy,
  };
}

/** A global cooldown rides almost every press, so those bars would flash once each. */
function shortestShown() {
  if (woc.settings['hide-short']) {
    return GCD_SECONDS;
  }
  return 0;
}

function chargePools() {
  const pools = woc.world.player?.abilityCharges;
  if (typeof pools !== 'object' || pools === null) {
    return [];
  }
  return Object.entries(pools);
}

/**
 * `rechargeLength` is on the wire and not in the spellbook, so this is the one
 * denominator the reading has to carry itself.
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

/**
 * Everything running, in whatever order the game's map is in. `total` is null on every
 * entry, because the wire carries no length for an ordinary cooldown; `createRow` is
 * where the spellbook join happens.
 */
function runningCooldowns() {
  const live = woc.world.cooldowns;
  if (live === null) {
    return [];
  }
  const floor = shortestShown();
  const running = [];
  for (const [abilityId, remaining] of live) {
    if (remaining > 0 && (remaining >= floor || rows.get(abilityId) !== undefined)) {
      running.push({ abilityId, remaining, total: null, charges: null });
    }
  }
  return running;
}

/**
 * Charge pools first: an emptied pool also rides the ordinary cooldown wire, and the
 * charge reading is the one with a real total. The pools are passed in because the frame
 * loop has already read them.
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

function timers() {
  return timersFrom(rechargingAbilities());
}

/** Soonest ready first, which is the order the next decision is made in. */
function soonestFirst(running) {
  return [...running].sort((a, b) => a.remaining - b.remaining);
}

/**
 * A row already up keeps the total it was created with, so a rebuild does not restart its
 * fill. The reading is a parameter rather than a read: everything below here runs inside
 * one frame and has to agree about what is running.
 */
function syncRows(running) {
  rows.sync(soonestFirst(running));
}

function resync() {
  syncRows(timers());
}

/**
 * A remaining that went UP is the only signal a measured row has, since a shared cooldown
 * re-arming a running entry changes no id and the subscription stays silent. Skipped for
 * anything exact, where an increase is a fresh press against a length already known.
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

function chargeCount(charges, pool) {
  if (pool === null) {
    return String(charges);
  }
  return `${String(charges)}/${String(pool)}`;
}

function figure(remaining, charges, pool) {
  const left = `${remaining.toFixed(DECIMALS)}s`;
  if (typeof charges === 'number' && charges > 0) {
    return `${left} (${chargeCount(charges, pool)})`;
  }
  return left;
}

/**
 * The two widgets take the same three fields, so the only branch is the charge count: a
 * bar carries it in parentheses and a tile has a corner, which is a number, which is why
 * only the bar shows the pool size.
 *
 * `fmt.duration` is the figure with 40 pixels to say it in, rounded up so a tile never
 * reads 0 while the ability is still coming back. The size rides every paint, which is
 * how a drag reaches the tiles already on screen.
 */
function paint(row, remaining, charges, fraction) {
  const tone = toneFor(fraction);
  if (row.tile) {
    const value = woc.fmt.duration(remaining);
    row.ui.update({ fraction, value, count: charges, tone, size: tileSize });
    return;
  }
  row.ui.update({ fraction, value: figure(remaining, charges, row.pool), tone });
}

/**
 * Where one row's timer has got to, and where a measured row re-learns its length. Runs
 * for every row HELD, including a cut one, so a row coming back into view has been
 * following its cooldown all along rather than picking it up from wherever it got to.
 */
function paintRow(row, entry) {
  rebaseline(row, entry.remaining);
  const fraction = Math.min(entry.remaining / row.total, 1);
  paint(row, entry.remaining, entry.charges, fraction);
}

// #region subscribe-and-animate
// The cooldown set changes here; the numbers move in the frame loop below. Sampling the
// set every frame instead would be a Map walk per frame to notice nothing. Charges are
// the other way round, and the frame loop says why.
woc.world.on('cooldowns', resync);

/** Redraw while anything is running, and do as little as possible when nothing is. */
let wasVisible = false;

function tick() {
  const { visible } = frame;
  const appeared = visible && !wasVisible;
  wasVisible = visible;
  if (visible) {
    const recharging = rechargingAbilities();
    if (appeared || recharging.length > 0 || rows.size > 0) {
      syncRows(timersFrom(recharging));
    }
  }
  woc.requestAnimationFrame(tick);
}
woc.requestAnimationFrame(tick);
// #endregion

resync();

/**
 * A row's shape is decided when it is built, so a layout change cannot be repainted into.
 * Everything else a settings change moves is answered by the next sync.
 */
function rebuild() {
  rows.clear();
  // The frame goes too, because whether it resizes is decided when it is built. Rebuilding
  // under the same id restores the same saved box, so the overlay does not move. The grip
  // goes with the frame rather than surviving it like the list: which edge it holds is the
  // layout, which is what a rebuild is usually for.
  const previous = frame;
  // Back to the floor before the new frame exists, because a restored box reports its
  // height through onMove and that answer has to win rather than be overwritten. The row
  // height goes too: `max-bars` may be what changed, and it is the divisor.
  tileSize = TILE_START;
  barPx = null;
  frame = buildFrame();
  frame.body.appendChild(list);
  frame.body.appendChild(buildGrip());
  previous.destroy();
  applyLayout();
  resync();
}

woc.onSettingsChange(rebuild);
