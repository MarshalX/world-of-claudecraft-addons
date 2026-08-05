/// <reference types="@woc-addons/types" />

// Wayline: where the next level is, in time rather than in numbers.
//
// A rate is a lie unless it says what it is a rate of, and that is the whole addon. The
// obvious implementation keeps a running total and divides it by the time since the addon
// started. It looks right for the first hour and fails in the one situation a levelling
// display is looked at: the player stops. The total then stops moving while the
// denominator keeps growing, so the rate decays toward zero and the time to level grows
// without limit, with nothing on screen saying that nothing has happened for forty
// minutes.
//
// So every award is recorded with the moment it landed, the rate is measured over a
// rolling window of the last few minutes, and when the window holds nothing the panel
// says so rather than dividing. The rate row spells that out ("nothing in 10m") and the
// two figures derived from it fall back to a dash.
//
// What the rate is a rate of, since the game makes it slippery: experience from a kill is
// split between everyone within 80 yards, and a kill far below your level lands in the
// grey band and is worth nothing. The same player doing the same thing earns wildly
// different amounts depending on who is standing nearby, so a rate averaged over a
// session that changed either is a number about a session that is over. That is why the
// window is short by default and why its length is the first setting.
//
// Kills are inferred, because an xp event does not say what earned it: it carries an
// amount and, when one applied, the rested bonus inside that amount, and a quest turn-in
// and a kill are the same record. What is separately visible is `death`, which carries
// the dead entity and its killer, so an award landing within a couple of seconds of a
// death credited to you, your pet or your party is counted as a kill award. That is a
// heuristic and the tooltip says so: a quest handed in during a fight is miscounted.
//
// The rested pool is shown and its filling is not. Rested accrues only while the
// character is resting inside an inn, which is a place, and nothing published says where
// you are logged out or whether the pool is filling. So this draws the pool against its
// cap and never a fill rate.
//
// The virtual level is derived, cosmetic, and a function of `lifetimeXp` alone. Nothing
// on the wire carries one, and the field that looks like the one to build it from cannot
// be: `world.player.level` stops at the cap and `character.xp` does not carry on past it
// either, because the game returns before touching that bar for a capped character and
// zeroes the remainder on the award that dings them to it. A virtual level derived from
// it would read as the first one forever. `lifetimeXp` is credited on every award
// including at the cap, which is what makes it the only number this curve can use.
//
// Two clocks, and the split is why this survives a page reload. Sample times are
// `woc.now()`, which is monotonic and restarts at every page load, so a stored one means
// nothing afterwards. Each sample also carries the wall clock reading it was taken at,
// and the restore turns that back into a monotonic one by subtracting the wall time that
// has passed since. Both clocks are needed: a wall reading is not monotonic and a
// monotonic one does not outlive the page.
//
// Nothing here animates, so nothing here runs a frame loop. Every figure moves at most
// once a second, so the display is a `woc.setInterval` at one second for the figures the
// clock moves plus a `world.on('character')` subscription for the ones the game moves.

/**
 * Experience needed to leave each level, index 0 being level 1 to 2.
 *
 * A snapshot of game content, read out of the game's progression source at game 0.33.0.
 * Nothing on the wire carries this table and nothing the loader publishes derives it, so
 * a release that retunes levelling makes these numbers wrong with nothing to report it.
 * Written as a string of figures because that is what it is: one blob of copied content,
 * parsed once.
 *
 * The last entry is the level 20 requirement, which is also what one prestige costs and
 * the figure the virtual level curve grows from.
 */
const XP_PER_LEVEL =
  '400 900 1400 2100 2800 3600 4500 5400 6500 7600 8800 10100 11400 12900 14400 16000 17700 19400 21300 23200'
    .split(' ')
    .map(Number);

/** The last level the game awards. Everything past it is virtual and cosmetic. */
const LEVEL_CAP = 20;
/** Each virtual level asks a tenth more than the one before it. */
const VIRTUAL_GROWTH = 1.1;
/** Where the virtual curve stops. Past this the game stops counting. */
const MAX_VIRTUAL_LEVEL = 200;
/** One rested bubble is a twentieth of the current level's requirement. */
const BUBBLE_SHARE = 0.05;
/** The rested pool stops here, however long the character rests. */
const RESTED_CAP_LEVELS = 1.5;
/** How long a full pool takes to accrue, in hours of rested time. */
const RESTED_FILL_HOURS = 8;
/** Everyone inside this many yards shares a kill's experience. */
const PARTY_XP_RANGE_YARDS = 80;

const FRAME_WIDTH = 140;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const PERCENT = 100;
const DECIMALS = 1;
/** Where every figure the panel cannot honestly report goes. */
const NO_FIGURE = '--';

const DEFAULT_WINDOW_MINUTES = 10;
const MIN_WINDOW_MINUTES = 1;
const MAX_WINDOW_MINUTES = 60;
/**
 * The shortest stretch that may be called an hourly rate. Without it the first award of a
 * window divides by however many milliseconds have passed since it landed, which for the
 * first second is a rate in the millions. Clamping the denominator rather than refusing
 * to answer means the figure starts low and climbs to the truth, which errs toward saying
 * the level is further away than it is.
 */
const MIN_SPAN_MS = 60_000;
/** How long after a credited death an award still counts as that kill's. */
const KILL_CREDIT_MS = 2000;
/** A ceiling on the recorded awards, so a long night in a raid cannot grow forever. */
const MAX_SAMPLES = 2000;

/** How often the clock-driven figures are redrawn. See the note at the top. */
const PAINT_MS = 1000;
/** How often the recorded awards are written back, when any of them moved. */
const SAVE_MS = 10_000;
/** The one per-character key this addon owns. */
const SAMPLE_KEY = 'samples';

/** Every award still inside the rate window, oldest first. */
const samples = [];
/** When a death credited to this player or their group was last seen. */
const kill = { at: null };
/**
 * How many times the recorded awards have moved, and which of those is on disk. A
 * revision rather than a dirty flag, because a boolean initialised to `false` is read as
 * the literal type `false` and the test guarding the write is then reported as one that
 * can only go one way. A write marks the revision it covered only once it has landed, so
 * a failed one is retried by the next tick.
 */
const store = { revision: 0, written: -1 };
/** What the frame was built at, since a frame's density is decided when it is built. */
const chrome = { density: null };

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

/** A number the game or the wire gave us, or zero. */
function numberOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return 0;
}

/** Held inside what the manifest already bounds, in case a stored value escaped it. */
function windowMinutes() {
  const asked = settingNumber('window-minutes', DEFAULT_WINDOW_MINUTES);
  return Math.min(Math.max(Math.round(asked), MIN_WINDOW_MINUTES), MAX_WINDOW_MINUTES);
}

function windowMs() {
  return windowMinutes() * MS_PER_MINUTE;
}

/** 0 through 1, and 0 rather than a NaN when there is no denominator. */
function share(part, whole) {
  if (whole <= 0) {
    return 0;
  }
  return Math.min(Math.max(part / whole, 0), 1);
}

function percent(part, whole) {
  return `${String(Math.floor(share(part, whole) * PERCENT))}%`;
}

const THOUSANDS_RE = /\B(?=(?:\d{3})+(?!\d))/g;

/** `23200` reads as `23,200`. Grouped by hand, so it reads the same in every locale. */
function grouped(value) {
  return Math.round(value).toString().replace(THOUSANDS_RE, ',');
}

/** `2h 14m`, `14m`, `1d 3h`. A projection nobody can act on past a day is a day. */
function duration(ms) {
  const minutes = Math.round(ms / MS_PER_MINUTE);
  if (minutes < MINUTES_PER_HOUR) {
    return `${String(Math.max(minutes, 1))}m`;
  }
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) {
    return `${String(hours)}h ${String(minutes % MINUTES_PER_HOUR)}m`;
  }
  return `${String(Math.floor(hours / HOURS_PER_DAY))}d ${String(hours % HOURS_PER_DAY)}h`;
}

/** What the game asks for to leave a level, held inside the table it is read from. */
function levelRequirement(level) {
  const at = Math.min(Math.max(Math.round(level), 1), LEVEL_CAP) - 1;
  return XP_PER_LEVEL[at] ?? 0;
}

/**
 * The cumulative lifetime experience needed to reach each level, real and virtual.
 *
 * The shape is the game's own: real levels reuse the table above exactly, so below the cap
 * the virtual level and the real one are the same number, and past it each step grows by
 * a tenth from the level 20 requirement.
 *
 * Where the rounding goes is part of the curve. The running step stays a float and is
 * rounded only on its way into the total, which is where the game rounds it. Rounding it
 * in place, so the next step grows from the rounded figure, is a different curve: it
 * agrees for the first eleven virtual levels and then drifts, by 21 experience at virtual
 * 40 and by billions at 200.
 *
 * Index 1 is 0, since reaching level 1 costs nothing. Index 0 is unused padding, so that
 * the level is the index rather than the index plus one.
 */
const LIFETIME_TO_REACH = (() => {
  const cumulative = [0, 0];
  let total = 0;
  for (let level = 1; level < LEVEL_CAP; level += 1) {
    total += levelRequirement(level);
    cumulative[level + 1] = total;
  }
  let step = levelRequirement(LEVEL_CAP);
  for (let level = LEVEL_CAP; level < MAX_VIRTUAL_LEVEL; level += 1) {
    total += Math.round(step);
    cumulative[level + 1] = total;
    step *= VIRTUAL_GROWTH;
  }
  return cumulative;
})();

/**
 * The virtual level a lifetime total stands at, and the way into the next one.
 *
 * It reads `lifetimeXp` and not `xp`, which is the whole correction here. At the cap `xp`
 * is frozen at 0: the game returns before touching that bar for a capped character and
 * zeroes the remainder on the award that dings them to it, so a curve over it reports
 * virtual 1 for the life of the character. `lifetimeXp` is credited on every award
 * including at the cap and is monotonic, which is what the game's own curve uses.
 *
 * Derived rather than read, because nothing publishes a virtual level. The arithmetic is
 * the game's own construction step for step.
 */
function virtualStanding(lifetime) {
  const total = Math.max(numberOf(lifetime), 0);
  let level = 1;
  while (
    level < MAX_VIRTUAL_LEVEL &&
    (LIFETIME_TO_REACH[level + 1] ?? Number.POSITIVE_INFINITY) <= total
  ) {
    level += 1;
  }
  const floor = LIFETIME_TO_REACH[level] ?? 0;
  const next = LIFETIME_TO_REACH[Math.min(level + 1, MAX_VIRTUAL_LEVEL)] ?? floor;
  return { level, into: Math.max(total - floor, 0), need: Math.max(next - floor, 1) };
}

/** Lifetime experience earned since the cap, which is what the virtual curve spends. */
function pastCap(lifetime) {
  const reached = LIFETIME_TO_REACH[LEVEL_CAP] ?? 0;
  return Math.max(numberOf(lifetime) - reached, 0);
}

function playerLevel() {
  return numberOf(woc.world.player?.level);
}

/**
 * What the panel is counting toward, or null when there is nothing to count to. Below the
 * cap that is the next level; at the cap it is the next virtual level, and only while the
 * virtual display is switched on.
 */
function target() {
  const { character } = woc.world;
  const level = playerLevel();
  if (character === null || level <= 0) {
    return null;
  }
  if (level < LEVEL_CAP) {
    const need = levelRequirement(level);
    return { name: `level ${String(level + 1)}`, remaining: Math.max(need - character.xp, 0) };
  }
  if (!settingFlag('show-virtual', true)) {
    return null;
  }
  const standing = virtualStanding(character.lifetimeXp);
  const name = `virtual ${String(standing.level + 1)}`;
  return { name, remaining: Math.max(standing.need - standing.into, 0) };
}

/**
 * What one award contributes to the rate. The rested bonus is inside the amount rather
 * than on top of it, so leaving it out is a subtraction. It is a setting because the two
 * readings answer different questions: the whole amount is what landed in the bar, and
 * the amount without the bonus is the pace that survives the pool running out.
 */
function counted(sample) {
  if (settingFlag('rested-apart', false)) {
    return Math.max(sample.amount - sample.rested, 0);
  }
  return sample.amount;
}

/** Drop everything the window no longer covers, and anything over the ceiling. */
function prune(now) {
  const cutoff = now - windowMs();
  while (samples.length > 0 && samples[0].at < cutoff) {
    samples.shift();
  }
  while (samples.length > MAX_SAMPLES) {
    samples.shift();
  }
}

function countedTotal() {
  return samples.reduce((sum, sample) => sum + counted(sample), 0);
}

function restedTotal() {
  return samples.reduce((sum, sample) => sum + sample.rested, 0);
}

/**
 * Experience per hour over the window, or null when the window holds nothing. The null is
 * the point of the whole file: an average over the time since the addon started keeps
 * answering forever, about a session that has stopped.
 */
function ratePerHour(now) {
  prune(now);
  const [first] = samples;
  if (first === undefined) {
    return null;
  }
  const earned = countedTotal();
  if (earned <= 0) {
    return null;
  }
  return (earned / Math.max(now - first.at, MIN_SPAN_MS)) * MS_PER_HOUR;
}

/** The average kill award in the window, or null when none has been credited. */
function averageKillAward() {
  const kills = samples.filter((sample) => sample.kill);
  if (kills.length === 0) {
    return null;
  }
  return kills.reduce((sum, sample) => sum + counted(sample), 0) / kills.length;
}

/**
 * Show or hide a row, both ways. `hidden` is a UA rule at the lowest priority there is,
 * and the loader's own stylesheet is unlayered and more specific, so the attribute alone
 * leaves a kit row on screen. The display is removed rather than set back to a value, so
 * this never has to know what the sheet draws that row as.
 */
function setShown(el, shown) {
  el.hidden = !shown;
  el.style.display = 'none';
  if (shown) {
    el.style.removeProperty('display');
  }
}

// The panel. It outlives the frame, because a density change rebuilds the frame and every
// row inside this survives it. One gap for every row, because every row is the same kind
// of thing: the three middle figures are kit rows too, so what separates the panel's
// three parts is which of them carry a fill.
const panel = document.createElement('div');
panel.className = 'woc-wayline';
panel.style.display = 'flex';
panel.style.flexDirection = 'column';
panel.style.gap = '2px';

const levelBar = woc.ui.bar({ label: 'Level', className: 'woc-wayline-level' });
panel.appendChild(levelBar.el);

/**
 * One of the three figures, which is a kit row whose fill is never set. None of the three
 * has a whole to be a fraction of, so none can be a bar in the sense the rows above and
 * below are. What the kit is being asked for is the row: the padding, the ellipsis on a
 * long label, the tabular figures, and above all the font size, which a compact bar sets
 * for itself and a plain div inherits from the frame instead.
 */
function createLine(key, name) {
  const line = woc.ui.bar({ label: name, className: 'woc-wayline-line' });
  line.el.dataset.wayline = key;
  panel.appendChild(line.el);
  return line;
}

const rateLine = createLine('rate', 'Rate');
const killsLine = createLine('kills', 'Kills left');
const timeLine = createLine('time', 'Time left');

const restedBar = woc.ui.bar({ label: 'Rested', className: 'woc-wayline-rested' });
panel.appendChild(restedBar.el);

const virtualBar = woc.ui.bar({ label: 'Virtual', className: 'woc-wayline-virtual' });
panel.appendChild(virtualBar.el);
setShown(virtualBar.el, false);

/**
 * Throw the recorded awards away and start measuring again.
 *
 * The kit's own button class, so it is drawn at the frame's density with the loader's
 * hover and focus treatment. It exists because of the trap in the header: the moment a
 * player leaves a group, changes zone or stops grinding, the awards still in the window
 * describe something they are no longer doing.
 *
 * Its size is left to the density and is deliberately not shrunk to match the rows. A
 * compact frame already gives up the game's tap-target floor and a comfortable one keeps
 * it, so an inline height here would take the floor away from a player who asked for it.
 */
const reset = document.createElement('button');
reset.type = 'button';
reset.className = 'woc-btn woc-wayline-reset';
reset.textContent = 'Reset';
reset.style.alignSelf = 'flex-end';
reset.style.marginTop = '4px';
panel.appendChild(reset);

function densitySetting() {
  return settingText('density', 'compact');
}

/**
 * The panel. `ui.frame` rather than `ui.window` because of what the two announce: a window
 * is `role="dialog"`, something the player opened, and a frame is `role="group"`, HUD
 * furniture that is toggled. Not `bare` either: bare drops the panel from behind the
 * content, and six rows of small text are unreadable over a moving game.
 */
function buildFrame() {
  chrome.density = densitySetting();
  return woc.ui.frame({
    id: 'panel',
    title: 'Wayline',
    width: FRAME_WIDTH,
    density: chrome.density,
    save: true,
    // The mouse route to the same dismissal the keybind is, which is what a frame asks
    // for instead of becoming a window: a titled panel without one leaves the player
    // hunting for a keybind they never chose.
    closable: true,
  });
}

let frame = buildFrame();
frame.body.appendChild(panel);

/**
 * The level row. `fraction` here is progress made rather than what is left, which is the
 * opposite of what the kit's timer rows mean by it: this is the same bar the game draws
 * for the same number, and a levelling bar that drained would be read backwards.
 */
function paintLevel() {
  const { character } = woc.world;
  const level = playerLevel();
  if (character === null || level <= 0) {
    levelBar.update({ label: 'Level', fraction: 0, value: NO_FIGURE, detail: '' });
    return;
  }
  if (level >= LEVEL_CAP) {
    levelBar.update({
      label: `Level ${String(LEVEL_CAP)}`,
      fraction: 1,
      value: 'max',
      // Lifetime past the cap, not `xp`: `xp` is frozen at 0 for a capped character, so a
      // detail read from it would say `0 past the cap` forever.
      detail: `${grouped(pastCap(character.lifetimeXp))} past the cap`,
    });
    return;
  }
  const need = levelRequirement(level);
  levelBar.update({
    label: `Level ${String(level)}`,
    fraction: share(character.xp, need),
    value: percent(character.xp, need),
    detail: `${grouped(character.xp)} / ${grouped(need)}`,
  });
}

function rateFigure(rate) {
  if (rate === null) {
    return `nothing in ${String(windowMinutes())}m`;
  }
  return `${grouped(rate)} xp/hr`;
}

function killsFigure(goal) {
  const average = averageKillAward();
  if (goal === null || average === null || average <= 0) {
    return NO_FIGURE;
  }
  return String(Math.ceil(goal.remaining / average));
}

function timeFigure(rate, goal) {
  if (rate === null || goal === null || rate <= 0 || goal.remaining <= 0) {
    return NO_FIGURE;
  }
  return duration((goal.remaining / rate) * MS_PER_HOUR);
}

function paintFigures(now) {
  const rate = ratePerHour(now);
  const goal = target();
  rateLine.update({ value: rateFigure(rate) });
  killsLine.update({ value: killsFigure(goal) });
  timeLine.update({ value: timeFigure(rate, goal) });
}

/**
 * The breakdown under the pool, and nothing at all when the pool is empty. An empty detail
 * is hidden by the kit rather than blanked, so the row loses its second line instead of
 * keeping an empty one. That matters most at the cap, where the pool stays at zero for the
 * life of the character and a line reading `0 bubbles, 0 xp` under a row already reading
 * `0.0 levels` is the same nothing said twice. Why it is zero is in the row's tooltip.
 */
function restedDetail(rested, levels) {
  if (rested <= 0) {
    return '';
  }
  return `${String(Math.floor(levels / BUBBLE_SHARE))} bubbles, ${grouped(rested)} xp`;
}

function paintRested() {
  const { character } = woc.world;
  const need = levelRequirement(playerLevel());
  if (character === null || need <= 0) {
    restedBar.update({ fraction: 0, value: NO_FIGURE, detail: '' });
    return;
  }
  const levels = character.restedXp / need;
  restedBar.update({
    fraction: share(levels, RESTED_CAP_LEVELS),
    value: `${levels.toFixed(DECIMALS)} levels`,
    detail: restedDetail(character.restedXp, levels),
  });
}

function paintVirtual() {
  const { character } = woc.world;
  const wanted = playerLevel() >= LEVEL_CAP && settingFlag('show-virtual', true);
  setShown(virtualBar.el, wanted && character !== null);
  if (character === null || !wanted) {
    return;
  }
  const standing = virtualStanding(character.lifetimeXp);
  virtualBar.update({
    // The level standing at, not the next one: `standing.level` is absolute, since the
    // curve is a function of the lifetime total rather than a count of levels past the cap.
    label: `Virtual ${String(standing.level)}`,
    fraction: share(standing.into, standing.need),
    value: percent(standing.into, standing.need),
    detail: `${grouped(standing.into)} / ${grouped(standing.need)}`,
  });
}

function paint() {
  paintLevel();
  // Before the button is judged, because this is what prunes: the awards a reset would
  // throw away are the ones still inside the window after that call.
  paintFigures(woc.now());
  paintRested();
  paintVirtual();
  // A control that would do nothing says so, rather than sitting there at full strength
  // offering it. This is the state the panel spends every break in.
  reset.disabled = samples.length === 0;
}

function levelTip() {
  const { character } = woc.world;
  if (character === null) {
    return 'Nothing to show until you are in the world.';
  }
  const level = playerLevel();
  const lines = [`${grouped(character.lifetimeXp)} earned in this character's life.`];
  if (level < LEVEL_CAP) {
    lines.push(`${grouped(Math.max(levelRequirement(level) - character.xp, 0))} left to go.`);
  }
  if (level >= LEVEL_CAP) {
    lines.push({
      text: `Level ${String(LEVEL_CAP)} is the cap, so what you earn now buys virtual levels.`,
      tone: 'muted',
    });
  }
  if (character.prestigeRank > 0) {
    lines.push(`Prestige rank ${String(character.prestigeRank)}.`);
  }
  return { title: `Level ${String(level)}`, lines };
}

/** The honest paragraph, which is most of why this row has a tooltip at all. */
function rateTip() {
  const rate = ratePerHour(woc.now());
  const lines = [`Measured over the last ${String(windowMinutes())} minutes of play.`];
  if (rate === null) {
    lines.push({
      text: 'Nothing has been earned in that window, so there is no rate to report and none is being made up.',
      tone: 'muted',
    });
  }
  if (rate !== null) {
    lines.push(
      `${String(samples.length)} awards, of which ${grouped(restedTotal())} was rested bonus.`,
    );
  }
  lines.push({
    text: `A kill is split between everyone within ${String(PARTY_XP_RANGE_YARDS)} yards, and one far below you is worth nothing at all, so a long window over a session that changed either describes something you have stopped doing. Short is honest.`,
    tone: 'muted',
  });
  return { title: 'Experience per hour', lines };
}

function killsTip() {
  const average = averageKillAward();
  const goal = target();
  const lines = [];
  if (average === null) {
    lines.push({ text: 'No kill has been credited in this window yet.', tone: 'muted' });
  }
  if (average !== null && goal !== null) {
    lines.push(`About ${grouped(average)} a kill, and ${grouped(goal.remaining)} to ${goal.name}.`);
  }
  lines.push({
    text: 'An award does not say what earned it, so a kill is one that landed just after a death credited to you or your group. A quest handed in mid-fight is counted with them.',
    tone: 'muted',
  });
  return { title: 'Kills to go', lines };
}

function timeTip() {
  const goal = target();
  const lines = [];
  if (goal !== null) {
    lines.push(`${grouped(goal.remaining)} to ${goal.name}, at the rate above.`);
  }
  if (goal === null) {
    lines.push({ text: 'There is nothing to count toward right now.', tone: 'muted' });
  }
  lines.push({
    text: 'When nothing has been earned in the window there is no rate, so this stops rather than growing without limit.',
    tone: 'muted',
  });
  return { title: 'Time to go', lines };
}

function restedTip() {
  const lines = [
    `A bubble is ${String(Math.round(BUBBLE_SHARE * PERCENT))} percent of a level, and the pool stops at ${String(RESTED_CAP_LEVELS)} levels.`,
    `A full pool takes about ${String(RESTED_FILL_HOURS)} hours of rested time.`,
    {
      text: 'It fills only while you are resting inside an inn, which is a place rather than a state. Nothing published says where you are logged out, so this shows the pool and never how fast it is filling.',
      tone: 'muted',
    },
  ];
  // The one thing that can be said about the filling, and it is a negative. A capped
  // character accrues no rested at all, so this row is a pool that will not move rather
  // than one whose movement cannot be seen.
  if (playerLevel() >= LEVEL_CAP) {
    lines.push({
      text: `At level ${String(LEVEL_CAP)} it stops filling entirely, however long you rest.`,
      tone: 'muted',
    });
  }
  return { title: 'Rested', lines };
}

function virtualTip() {
  return {
    title: 'Virtual level',
    lines: [
      `Past the cap each level asks a tenth more than the one before, stopping at ${String(MAX_VIRTUAL_LEVEL)}.`,
      {
        text: 'Nothing on the wire carries a virtual level, so this is worked out here from the lifetime experience the game does publish. Not a guess: it is the same curve the game itself counts on, step for step. Cosmetic all the same, since it is a number nobody else can see.',
        tone: 'muted',
      },
    ],
  };
}

woc.ui.tooltip(levelBar.el, levelTip);
woc.ui.tooltip(rateLine.el, rateTip);
woc.ui.tooltip(killsLine.el, killsTip);
woc.ui.tooltip(timeLine.el, timeTip);
woc.ui.tooltip(restedBar.el, restedTip);
woc.ui.tooltip(virtualBar.el, virtualTip);
woc.ui.tooltip(reset, 'Throw away the recorded awards and start measuring from now.');

/** Whether a death is one this player was in line to be paid for. */
function credited(killerId, me) {
  if (killerId === me.id) {
    return true;
  }
  const pet = woc.world.unit('pet');
  if (pet !== null && killerId === pet.id) {
    return true;
  }
  const { party } = woc.world;
  if (party === null) {
    return false;
  }
  return party.members.some((member) => member.pid === killerId);
}

/**
 * Remember a death that this player's group is owed experience for. The player's own death
 * is skipped rather than filtered later: it is credited to whatever killed them, and a
 * duel or a battleground puts a party member on the other end of it.
 */
function noteDeath(event) {
  const me = woc.world.player;
  if (me === null) {
    return;
  }
  const dead = numberOf(event?.entityId);
  if (dead === me.id) {
    return;
  }
  if (credited(numberOf(event?.killerId), me)) {
    kill.at = woc.now();
  }
}

/** Whether an award landing now is close enough to a credited death to be its. */
function fromKill(now) {
  return kill.at !== null && now - kill.at <= KILL_CREDIT_MS;
}

function record(event) {
  const amount = numberOf(event?.amount);
  if (amount <= 0) {
    return;
  }
  const now = woc.now();
  samples.push({
    at: now,
    wallAt: woc.wallClock(),
    amount,
    rested: Math.min(numberOf(event?.rested), amount),
    kill: fromKill(now),
  });
  prune(now);
  store.revision += 1;
  paint();
}

/** What survives a page load. `at` deliberately does not: see the header. */
function stored(sample) {
  return { wallAt: sample.wallAt, amount: sample.amount, rested: sample.rested, kill: sample.kill };
}

/**
 * Put stored awards back on this page's monotonic clock. Merged and re-sorted rather than
 * assigned, because the read waits for the character and awards can land while it waits.
 */
function adopt(entries) {
  const now = woc.now();
  const wallNow = woc.wallClock();
  for (const entry of entries) {
    const wallAt = numberOf(entry?.wallAt);
    const amount = numberOf(entry?.amount);
    if (amount > 0 && wallAt > 0 && wallAt <= wallNow) {
      samples.push({
        at: now - (wallNow - wallAt),
        wallAt,
        amount,
        rested: numberOf(entry?.rested),
        kill: entry?.kill === true,
      });
    }
  }
  samples.sort((a, b) => a.at - b.at);
  prune(now);
  paint();
}

async function restore() {
  const found = await woc.storage.character.get(SAMPLE_KEY, []);
  if (Array.isArray(found)) {
    adopt(found);
  }
}

/**
 * Write the recorded awards back, for this character only.
 *
 * `world.ready` is awaited because a per-character write refuses to wait on its own: its
 * payload was decided when it was called, so a held one would land on whichever character
 * the player then picked.
 *
 * The player is checked first, which is not the same guard twice. Awaiting `world.ready`
 * on the landing page is awaiting something that resolves only if the player enters the
 * world, so a tick every ten seconds before then would leave a pending promise behind on
 * each one. Every award this writes arrives from inside the world.
 */
async function save() {
  const at = store.revision;
  if (at === store.written || woc.world.player === null) {
    return;
  }
  await woc.world.ready;
  prune(woc.now());
  await woc.storage.character.set(SAMPLE_KEY, samples.map(stored));
  store.written = at;
}

/** The write, reported rather than swallowed and never left floating. */
function persist() {
  save().catch((err) => {
    woc.warn('could not write the recorded experience for this character', err);
  });
}

/** The read back, under the same rule. */
function load() {
  restore().catch((err) => {
    woc.warn('could not read back the recorded experience for this character', err);
  });
}

reset.addEventListener('click', () => {
  samples.length = 0;
  kill.at = null;
  store.revision += 1;
  paint();
});

woc.net.onEvent('xp', record);
woc.net.onEvent('death', noteDeath);

// A level up moves the denominator and resets the experience into it, and the clock below
// would show the old level for up to a second after.
woc.net.onEvent('levelup', paint);

// The sheet moving is what the game reports; everything else on the panel is what the
// clock moves, which is the interval underneath.
woc.world.on('character', paint);

woc.setInterval(paint, PAINT_MS);
woc.setInterval(persist, SAVE_MS);

woc.keys.bind('toggle', () => {
  frame.toggle();
});

/**
 * Rebuild only what a setting actually decided. A frame's density is fixed when it is
 * built, so that one setting needs a new frame; everything else is answered by the next
 * paint. Rebuilding on every change would destroy and restore the saved box needlessly.
 */
woc.onSettingsChange(() => {
  if (densitySetting() !== chrome.density) {
    const previous = frame;
    frame = buildFrame();
    frame.body.appendChild(panel);
    previous.destroy();
  }
  paint();
});

// The one thing registered, and it is a write rather than a teardown: disable is hot, so
// the awards recorded since the last save would otherwise be the only ones a player loses
// by turning the addon off. Everything else lives inside a kit widget, inside the frame
// body, or on a woc timer, and the loader drains all three.
woc.onDispose(persist);

load();
paint();
