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
// The strip's width is only room to grow into, or tiles would resize as more cooldowns
// started, and both bounds are stated since a frame stating neither takes the size it
// opened at as its floor.

const DECIMALS = 1;
const FRAME_WIDTH = 220;
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

/** The current icon size, which is the strip's height. Ignored by the bars layout. */
let tileSize = TILE_START;

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

// One flex line, whose DIRECTION is the layout. It outlives the frame, because a
// layout change rebuilds the frame and this keeps every row that survives it.
const list = document.createElement('div');
list.className = 'woc-cd-list';
list.style.display = 'flex';
list.style.gap = '3px';

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
 * Bare, because the rows are the display. The title is still the frame's accessible name
 * and its label while frames are unlocked.
 *
 * Only the strip resizes: a column of bars is sized by its content, and a fixed height
 * would pad it out or hide the row that just started. The two layouts are two frame ids
 * and therefore two saved boxes, or a column's height would open the strip with icons
 * the size of a portrait.
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
      toggleKey: 'toggle',
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
    toggleKey: 'toggle',
    // Both axes take the same constant: the floor is one tap-target square whatever the
    // bar budget is set to and however many cooldowns are running.
    minWidth: TILE_START,
    minHeight: TILE_START,
    onMove: (box) => {
      resize(box.h);
    },
  });
}

let frame = buildFrame();
frame.body.appendChild(list);
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
 */
// #region bar
function createBar(abilityId) {
  const { label } = describe(abilityId);
  const bar = woc.ui.bar({
    label,
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
  // The frame goes too, because whether it resizes is decided when it is built.
  // Rebuilding under the same id restores the same saved box, so the overlay does not move.
  const previous = frame;
  // Back to the floor before the new frame exists, because a restored box reports its
  // height through onMove and that answer has to win rather than be overwritten.
  tileSize = TILE_START;
  frame = buildFrame();
  frame.body.appendChild(list);
  previous.destroy();
  applyLayout();
  resync();
}

woc.onSettingsChange(rebuild);
