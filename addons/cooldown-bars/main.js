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
// The rows themselves come from `woc.ui.bar`, which is the loader's own timer row:
// an icon, a name that truncates, a fill behind both, and a right-aligned figure in
// tabular figures so the digits do not shuffle as they count down. This addon used
// to build that out of about twenty inline style declarations, and the reason it no
// longer does is that Combat Meter had built the same thing slightly differently.
// Anything an addon draws that looks like a timer should come from here.
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

const DECIMALS = 1;
const FRAME_WIDTH = 220;
const DEFAULT_MAX_BARS = 8;
/** The global cooldown, and the floor under "worth drawing a bar for". */
const GCD_SECONDS = 1.5;
/** Below this share left, the row goes warm: it is about to be ready. */
const NEARLY_READY = 0.25;

/** Ability id to the bar tracking it: the kit row, and what it had left when seen. */
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

// #region frame
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
// #endregion

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
  woc.ui.tooltip(bar.el, name);
  return bar;
}
// #endregion

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
  const rows = [];
  for (const [abilityId, pool] of chargePools()) {
    const remaining = Number(pool?.recharge);
    const total = Number(pool?.rechargeLength);
    if (remaining > 0 && total > 0) {
      rows.push({ abilityId, remaining, total, charges: Number(pool?.charges) });
    }
  }
  return rows;
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
 */
function timers() {
  const rows = rechargingAbilities();
  const exact = new Set(rows.map((entry) => entry.abilityId));
  for (const entry of runningCooldowns()) {
    if (!exact.has(entry.abilityId)) {
      rows.push(entry);
    }
  }
  return rows;
}

/**
 * Rebuild the set of bars from what is running.
 *
 * A bar that is already up keeps the total it was created with, so a rebuild does
 * not restart its fill. A row with a published total is marked exact and is never
 * re-baselined, since there is nothing to learn.
 */
function syncBars() {
  const running = timers();
  const seen = new Set(running.map((entry) => entry.abilityId));

  for (const [abilityId, row] of bars) {
    if (!seen.has(abilityId)) {
      row.bar.destroy();
      bars.delete(abilityId);
    }
  }

  for (const { abilityId, remaining, total } of running) {
    if (!bars.has(abilityId)) {
      const bar = createBar(abilityId);
      bars.set(abilityId, {
        bar,
        total: total ?? remaining,
        seen: remaining,
        exact: total !== null,
      });
    }
  }
  draw();
}

/** Soonest ready first, which is the order the next decision is made in. */
function drawOrder() {
  return timers()
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

function draw() {
  const order = drawOrder();
  const shown = new Set(order.map((entry) => entry.abilityId));
  for (const [abilityId, row] of bars) {
    if (!shown.has(abilityId)) {
      row.bar.el.remove();
    }
  }
  for (const { abilityId, remaining, charges } of order) {
    const row = bars.get(abilityId);
    rebaseline(row, remaining);
    const fraction = Math.min(remaining / row.total, 1);
    row.bar.update({
      fraction,
      value: figure(remaining, charges),
      tone: toneFor(fraction),
    });
    list.appendChild(row.bar.el);
  }
}

// #region subscribe-and-animate
// The cooldown set changes here; the numbers move in the frame loop below.
// Sampling the set every frame instead would be a Map walk per frame to notice
// nothing. Charges are the other way round, and the frame loop says why.
woc.world.on('cooldowns', syncBars);

/**
 * Redraw while anything is running, and stand down when nothing is.
 *
 * `syncBars` rather than `draw` when a charge pool is recharging: a charge coming
 * back while the pool still holds a use changes no cooldown id, so the
 * subscription cannot raise or drop those rows and only the loop can.
 */
function tick() {
  if (rechargingAbilities().length > 0) {
    syncBars();
  } else if (bars.size > 0) {
    draw();
  }
  woc.requestAnimationFrame(tick);
}
woc.requestAnimationFrame(tick);
// #endregion

syncBars();

// #region keybind
woc.keys.bind('toggle', () => {
  frame.toggle();
});
// #endregion

woc.onSettingsChange(syncBars);
