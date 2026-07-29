/// <reference types="@woc-addons/types" />

// Cooldown Bars: one draining bar per ability you are waiting on.
//
// The point of this example is the difference between the two things the world
// API gives you. `world.on('cooldowns')` reports the SET changing: a cooldown
// started, or one finished. It deliberately does not fire as a number counts
// down, because at the frame rate that would be a handler call per ability per
// frame reporting nothing anyone acts on.
//
// So the drawing is the addon's own. The subscription decides WHICH bars exist
// and a frame loop decides how full each one is, reading `world.cooldowns` as it
// goes. That split is the pattern for anything that has to animate: subscribe
// for the change, animate from the read.
//
// The full length of a cooldown is not published. What is readable is how much
// is left, so a bar's total is whatever it had left the moment it appeared. That
// is exact for a cooldown that starts while you are watching, and honest about
// one that was already running when the addon loaded: it fills the bar from
// wherever it was found rather than pretending to know the rest.
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

const FULL_PERCENT = 100;
const DECIMALS = 1;
const FRAME_WIDTH = 200;
const DEFAULT_MAX_BARS = 8;
/** The global cooldown, and the floor under "worth drawing a bar for". */
const GCD_SECONDS = 1.5;

/** Ability id to the bar tracking it: its element, and what it had left when seen. */
const bars = new Map();

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

/** 'aimed_shot' reads as 'Aimed Shot'. The game publishes ids, not display names. */
function readable(abilityId) {
  return abilityId
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const frame = woc.ui.frame({
  id: 'bars',
  title: 'Cooldowns',
  width: FRAME_WIDTH,
  save: true,
});

const list = document.createElement('div');
list.className = 'woc-cd-list';
list.style.display = 'flex';
list.style.flexDirection = 'column';
list.style.gap = '3px';
frame.body.appendChild(list);

/**
 * One row: a name, a remaining figure, and the fill behind both.
 *
 * The row is a flex line rather than a float, and the name is the only part
 * allowed to shrink. Floating the counter put it in the same inline flow as the
 * name, so a long one ran straight underneath it and the two overlapped; a flex
 * line reserves the counter's width first and gives the name whatever is left.
 * `min-width: 0` is what actually lets the name shrink, since a flex item
 * refuses to go below its content width without it, and that alone is what makes
 * the ellipsis appear instead of an overflow.
 */
function createBar(abilityId) {
  const row = document.createElement('div');
  row.className = 'woc-cd-bar';
  row.dataset.ability = abilityId;
  row.style.position = 'relative';
  row.style.display = 'flex';
  row.style.alignItems = 'baseline';
  row.style.gap = '6px';
  row.style.padding = '2px 6px';
  row.style.overflow = 'hidden';

  const fill = document.createElement('div');
  fill.className = 'woc-cd-fill';
  fill.style.position = 'absolute';
  fill.style.inset = '0 auto 0 0';
  fill.style.background = 'rgb(120 160 255 / 30%)';

  const label = document.createElement('span');
  label.className = 'woc-cd-label';
  label.style.position = 'relative';
  label.style.flex = '1 1 auto';
  label.style.minWidth = '0';
  label.style.overflow = 'hidden';
  label.style.textOverflow = 'ellipsis';
  label.style.whiteSpace = 'nowrap';
  label.textContent = readable(abilityId);
  // The full name is one hover away, so truncating costs nothing.
  woc.ui.tooltip(label, readable(abilityId));

  const left = document.createElement('span');
  left.className = 'woc-cd-left';
  left.style.position = 'relative';
  left.style.flex = '0 0 auto';
  left.style.marginLeft = 'auto';
  left.style.fontVariantNumeric = 'tabular-nums';

  row.append(fill, label, left);
  return { row, fill, left };
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

/** Everything running, in whatever order the game's map is in. */
function runningCooldowns() {
  const live = woc.world.cooldowns;
  if (live === null) {
    return [];
  }
  const floor = shortestShown();
  const running = [];
  for (const [abilityId, remaining] of live) {
    if (remaining > 0 && (remaining >= floor || bars.has(abilityId))) {
      running.push({ abilityId, remaining });
    }
  }
  return running;
}

/**
 * Rebuild the set of bars from the set of running cooldowns.
 *
 * Only on a set change, which is what the subscription reports. A bar that is
 * already up keeps the total it was created with, so a rebuild does not restart
 * its fill.
 */
function syncBars() {
  const running = runningCooldowns();
  const seen = new Set(running.map((entry) => entry.abilityId));

  for (const [abilityId, bar] of bars) {
    if (!seen.has(abilityId)) {
      bar.row.remove();
      bars.delete(abilityId);
    }
  }

  for (const { abilityId, remaining } of running) {
    if (!bars.has(abilityId)) {
      const bar = createBar(abilityId);
      bars.set(abilityId, { ...bar, total: remaining, seen: remaining });
    }
  }
  draw();
}

/** Soonest ready first, which is the order the next decision is made in. */
function drawOrder() {
  return runningCooldowns()
    .filter((entry) => bars.has(entry.abilityId))
    .sort((a, b) => a.remaining - b.remaining)
    .slice(0, settingNumber('max-bars', DEFAULT_MAX_BARS));
}

/**
 * Re-learn a cooldown's length if it went back up.
 *
 * The only signal there is. A cooldown counts down, so an increase can only be a
 * re-arm, and it is the one the set of running ids never reports: a shared
 * cooldown re-arming an entry that is already running changes no id at all.
 */
function rebaseline(bar, remaining) {
  if (remaining > bar.seen) {
    bar.total = remaining;
  }
  bar.seen = remaining;
}

function draw() {
  const order = drawOrder();
  for (const [abilityId, bar] of bars) {
    if (!order.some((entry) => entry.abilityId === abilityId)) {
      bar.row.remove();
    }
  }
  for (const { abilityId, remaining } of order) {
    const bar = bars.get(abilityId);
    rebaseline(bar, remaining);
    const fraction = Math.min(remaining / bar.total, 1);
    bar.fill.style.width = `${(fraction * FULL_PERCENT).toFixed(DECIMALS)}%`;
    bar.left.textContent = `${remaining.toFixed(DECIMALS)}s`;
    list.appendChild(bar.row);
  }
}

// The set changes here; the numbers move in the frame loop below. Sampling the
// set every frame instead would be a Map walk per frame to notice nothing.
woc.world.on('cooldowns', syncBars);

/** Redraw while anything is running, and stand down when nothing is. */
function tick() {
  if (bars.size > 0) {
    draw();
  }
  woc.requestAnimationFrame(tick);
}
woc.requestAnimationFrame(tick);

syncBars();

woc.keys.bind('toggle', () => {
  frame.toggle();
});

woc.onSettingsChange(syncBars);
