/// <reference types="@woc-addons/types" />

// Cooldown Bars: one draining timer per ability you are waiting on.
//
// `world.on('cooldowns')` reports the set changing and never a number counting down, so
// the subscription decides which rows exist and a frame loop decides how full each one
// is. That split is the pattern for anything animated: subscribe for the change,
// animate from the read.
//
// A bar's denominator comes from `world.abilities.byId(id)`, which carries the cooldown
// resolved after talents. That covers your own kit and nothing else. An item cooldown,
// a granted ability, or something that is not an ability at all (the game's anti-relog
// timer rides this same map as `system_unstuck`) has no published length, so those rows
// measure against whatever they had left when they appeared: exact for one that started
// while you were watching, a floor for one that was already running.
//
// Such a row cannot be named either, since ids and display names have diverged
// (`arcane_shot` is displayed as "Fell Shot"). Its title-cased id is marked with `?` and
// the tooltip gives the working. The mark is `foretell`'s, so a player learns it once.
//
// A cooldown only counts down, so a remaining that goes up means the ability was
// re-armed, and a measured row re-learns its length there. The game re-arms without
// changing the set of running ids: casting one shock sets the cooldown on every shock.
// The case this cannot detect is a reset followed by a re-press onto a shorter
// cooldown, where the new remaining lands below the old one, which nothing on the wire
// distinguishes from draining.
//
// Charge pools are exact without the spellbook, because `rechargeLength` is on the
// wire. They are read from `world.player.abilityCharges` in the frame loop rather than
// from a subscription, since the game deletes the cooldown entry while any charge is
// left. The pool size is not on that record: `maxCharges` is present, numeric and
// permanently zero, so `AbilityInfo.charges` is what lets a bar read "2/3".
//
// The `layout` setting picks between bars (a column, the name on each row) and tiles (a
// strip, the art as the label). Both are kit primitives with the same
// {el, update, destroy}, so only the charge count and the room for a countdown differ.
// The strip is resizable and its height is the icon size, taken from `onMove` rather
// than measured. Its width is only room to grow into, or tiles would change size as
// more cooldowns started. Both size bounds are stated, since a frame that states
// neither takes the size it opened at as its floor.

const DECIMALS = 1;
const FRAME_WIDTH = 220;
const DEFAULT_MAX_BARS = 8;
/** The global cooldown, and the floor under "worth drawing a bar for". */
const GCD_SECONDS = 1.5;
/** Below this share left, the row goes warm: it is about to be ready. */
const NEARLY_READY = 0.25;
/** Over this, a tile's countdown is drawn in minutes: 40 pixels does not fit "119". */
const SECONDS_PER_MINUTE = 60;
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

/** Ability id to its widget, denominator, whether that was published, and pool size. */
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

/** 'system_unstuck' reads as 'System Unstuck'. Unmarked: `describe` adds the hedge. */
function readable(abilityId) {
  return abilityId
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * What to call this ability, and whether that was worked out rather than read.
 *
 * `world.abilities` covers your own kit. An id it does not carry is something you did
 * not learn, or is not an ability at all, and falls back to a title-cased id. That
 * guess is marked, on the label rather than in a footnote so that it survives a tile,
 * where the art is the label and there is nothing else to carry it.
 */
function describe(abilityId) {
  const known = woc.world.abilities.byId(abilityId) ?? null;
  if (known === null) {
    return { label: `${readable(abilityId)}${GUESS_MARK}`, guessed: true };
  }
  return { label: known.name, guessed: false };
}

/**
 * A published figure, or null where there is none. The two fields say "nothing here"
 * differently: `cooldown` is 0 for an ability that has none, while `charges` is absent
 * for the ordinary single-use ability, and either would poison a division.
 */
function stated(value) {
  if (typeof value === 'number' && value > 0) {
    return value;
  }
  return null;
}

/**
 * What the spellbook knows about an ability, before anything is watched.
 *
 * Both figures are resolved after talents, so a hunter who spent the point reads 5.4 on
 * `arcane_shot` where the content table says 6. Both are null outside your kit, and the
 * nulls are answered differently: a missing length puts the row on the measured path,
 * while a missing pool size only drops a denominator off the count.
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
 * The overlay. Bare, because the rows are the display and a panel behind them is
 * furniture around a thing that needs none. The title is kept as the frame's accessible
 * name and the label the loader shows while frames are unlocked.
 *
 * Only the tile strip resizes: a column of bars is sized by its content, and a fixed
 * height would either pad it out or hide the row that just started.
 *
 * The two layouts are two frame ids, and therefore two saved boxes. A column of five
 * bars saves a box a couple of hundred pixels tall, and restoring that into the strip
 * would open it with icons the size of a portrait.
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
 * Follow the strip's height, which is the icon size. Called at pointer rate, so it does
 * nothing when the height has not moved. The floor is applied here as well as stated on
 * the frame, since the icon size has to hold for a box from anywhere: a restored one, a
 * viewport clamp, or a height a future bound lets through.
 */
function resize(height) {
  const next = Math.max(Math.round(height), TILE_START);
  if (next === tileSize) {
    return;
  }
  tileSize = next;
  for (const row of rows.values()) {
    row.ui.update({ size: tileSize });
  }
}

function applyLayout() {
  list.style.flexDirection = 'column';
  if (drawsTiles()) {
    list.style.flexDirection = 'row';
  }
}
applyLayout();

/**
 * `data-ability` is the addon's own marking, which is what lets the frame be read back
 * by ability rather than by position. Not every ability ships painted art; the kit hides
 * its icon slot when an image fails, so a URL that may not resolve is intended usage.
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
 * that string is how the tile is announced. The tooltip matters more here than on a bar,
 * since an ability with no painted file leaves a square with nothing on it but the sweep.
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

/**
 * The long version of the mark, and the id it guessed from. Nothing for a name the game
 * supplied, which is why the label carries no mark there either.
 */
function guessLine(abilityId) {
  return {
    text: `Worked out from the ability id \`${abilityId}\`. The game publishes an ability's own name only for your own spellbook, so this is a guess and is wrong wherever the two have diverged.`,
    tone: 'muted',
  };
}

// #region tooltip
/**
 * What the row is, and how much of that is measured rather than known.
 *
 * The two hedges are independent and both are read off the row. A charge pool separates
 * them: its length rides the wire, so such a row is exact and still unnamed. The length
 * line describes the denominator this bar was built against, so a row raised before the
 * spellbook arrived stays measured for its whole life.
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
function createRow(abilityId) {
  if (drawsTiles()) {
    return { ui: createTile(abilityId), tile: true };
  }
  return { ui: createBar(abilityId), tile: false };
}

/**
 * The shortest cooldown worth a bar. A global cooldown is on almost every ability almost
 * all the time, so drawing those is a row of bars that flash once per press.
 */
function shortestShown() {
  if (settingFlag('hide-short', true)) {
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
 * Every ability regenerating a charge, with the exact length to measure against.
 * `rechargeLength` is on the wire and is not in the spellbook, so this is the one
 * denominator here the reading has to carry itself.
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
 * entry, because the wire carries no length for an ordinary cooldown; `syncRows` is
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
    if (remaining > 0 && (remaining >= floor || rows.has(abilityId))) {
      running.push({ abilityId, remaining, total: null, charges: null });
    }
  }
  return running;
}

/**
 * Every ability worth a bar right now, charge pools first. An ability whose pool has
 * emptied is also on cooldown, since the empty-pool timer rides the ordinary cooldown
 * wire, so the charge reading wins: it is the one with a real total. The pools are
 * passed in because the frame loop has already read them.
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

/**
 * Rebuild the set of rows from what is running.
 *
 * A row already up keeps the total it was created with, so a rebuild does not restart
 * its fill, and a row with a published total is never re-baselined. The spellbook is
 * consulted here rather than in the reading, so it costs one lookup per row rather than
 * one per running cooldown per frame.
 *
 * The reading is a parameter rather than a read: everything below here runs inside one
 * frame and has to agree about what is running.
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
      const known = published(abilityId);
      const length = total ?? known.length;
      rows.set(abilityId, {
        ...createRow(abilityId),
        total: length ?? remaining,
        seen: remaining,
        exact: length !== null,
        pool: known.pool,
      });
    }
  }
  draw(running);
}

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
 * Re-learn a cooldown's length if it went back up, which is the only signal a measured
 * row has: a shared cooldown re-arming an entry that is already running changes no id,
 * so the subscription stays silent. Skipped for anything exact, where an increase is a
 * fresh press against a length already known.
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
 * The same figure with 40 pixels to say it in: no decimal, no unit, minutes over a
 * minute, and the charge count moved to the corner the kit keeps for it. Rounded up, so
 * a tile never reads 0 while the ability is still coming back.
 */
function countdown(remaining) {
  if (remaining >= SECONDS_PER_MINUTE) {
    return `${String(Math.ceil(remaining / SECONDS_PER_MINUTE))}m`;
  }
  return String(Math.ceil(remaining));
}

/**
 * Tell one row where its timer has got to. The two widgets take the same three fields,
 * so the only branch is the charge count: a bar carries it in parentheses, a tile has a
 * corner for it. That corner is a number, which is why only the bar shows the pool size.
 */
function paint(row, remaining, charges, fraction) {
  const tone = toneFor(fraction);
  if (row.tile) {
    row.ui.update({ fraction, value: countdown(remaining), count: charges, tone });
    return;
  }
  row.ui.update({ fraction, value: figure(remaining, charges, row.pool), tone });
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

/** Move a row to its position only when it is not there already. */
// #region place
function place(el, at) {
  if (list.children[at] !== el) {
    list.insertBefore(el, list.children[at] ?? null);
  }
}
// #endregion

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
 * Throw every row away and start again. A row's shape is decided when it is built, so a
 * layout change cannot be repainted into. Everything else a settings change can move is
 * answered by the next sync.
 */
function rebuild() {
  for (const [abilityId, row] of rows) {
    row.ui.destroy();
    rows.delete(abilityId);
  }
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
