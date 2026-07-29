/// <reference types="@woc-addons/types" />

// Combat Meter: what your damage and healing are made of.
//
// The game ships its own meter (party damage, healing and threat, segmented into
// encounters), so this deliberately does not compete on any of that. It answers
// the question nothing in the game answers: your total is made of WHAT. A row per
// ability with its share, its crit rate, its average and its biggest, for what you
// deal, what you heal and what lands on you, plus the attack-table outcomes, which
// is the readout that tells you whether you are hit capped.
//
// All of it is already on the socket. Damage events carry `ability`, `school`,
// `crit`, `kind` and `absorbed`, and `heal2` carries `ability` and `crit`; the
// game's own meter reads the same events and keeps only per-player totals. So this
// aggregates information the player is already being sent, which is exactly the
// line the loader stays on: it reads, and it never sends anything.
//
// A fight ends when nothing has landed for a while, rather than when the game says
// combat dropped. `inCombat` is not on the wire, so on a client it is false for the
// entire session; an earlier version read it, concluded every fight had ended, and
// reset the total on every single hit. The idle timeout needs nothing from the
// server, and it matches the 5 seconds the game's own meter uses to close an
// encounter, so the segments line up.
//
// Two limits, stated rather than hidden. Damage a pet deals is not counted: the
// published surface does not say which entity is yours, and guessing from position
// or name would be wrong often enough to be worse than the omission. And there is
// no overhealing column, because no overheal figure rides the wire at all; the
// healing here is what landed.

const MS_PER_SECOND = 1000;
const REPAINT_MS = 500;
const DECIMALS = 1;
const PERCENT = 100;
const SECONDS_PER_MINUTE = 60;
const DEFAULT_TIMEOUT_SECONDS = 5;
const DEFAULT_MAX_ROWS = 10;
const WINDOW_WIDTH = 340;
const WINDOW_HEIGHT = 320;
/** Auto-attacks arrive with no ability id, and they are usually a real share. */
const MELEE_LABEL = 'Melee';
/** Attack-table outcomes, in the order they are worth reading. */
const OUTCOMES = ['hit', 'miss', 'dodge', 'parry', 'block', 'resist'];

/**
 * The three tables, in the order the game's own meter puts its tabs.
 *
 * A table rather than a branch per question: each entry is the tally map's key,
 * the tab's label, and the noun the summary line uses, so adding a fourth is one
 * row here and nothing else.
 */
const TABLES = [
  { id: 'dealt', label: 'Damage', noun: 'damage' },
  { id: 'healed', label: 'Healing', noun: 'healing' },
  { id: 'taken', label: 'Taken', noun: 'taken' },
];

function emptyTally() {
  return { total: 0, count: 0, crits: 0, biggest: 0, absorbed: 0 };
}

/**
 * The fight being measured.
 *
 * `endedAt` freezes the duration once nothing has landed for the timeout, so the
 * averages stop decaying while you read them. A running fight has null.
 */
function emptyFight(at) {
  return {
    startedAt: at,
    endedAt: null,
    lastEventAt: at,
    /** Table id to its running total. */
    totals: { dealt: 0, healed: 0, taken: 0 },
    /** Table id to a map of ability label to its tally. */
    tallies: { dealt: new Map(), healed: new Map(), taken: new Map() },
    /** Outcome kind to how many of your swings and casts ended that way. */
    outcomes: new Map(),
  };
}

let fight = emptyFight(woc.now());
/** Which table is on screen. */
let tab = 'dealt';

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

function timeoutMs() {
  return settingNumber('fight-timeout', DEFAULT_TIMEOUT_SECONDS) * MS_PER_SECOND;
}

/** 'aimed_shot' reads as 'Aimed Shot'. The game publishes ids, not display names. */
function readable(abilityId) {
  return abilityId
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** What to call the ability behind one event. An auto-attack has none. */
function labelOf(event) {
  if (typeof event.ability !== 'string' || event.ability.length === 0) {
    return MELEE_LABEL;
  }
  return readable(event.ability);
}

/** Absorbed rides only the events that had some, so an absent field is zero. */
function absorbedOf(event) {
  if (typeof event.absorbed === 'number' && Number.isFinite(event.absorbed)) {
    return event.absorbed;
  }
  return 0;
}

function num(value) {
  return Math.round(value).toLocaleString();
}

function pct(part, whole) {
  if (whole <= 0) {
    return '0%';
  }
  return `${Math.round((part / whole) * PERCENT).toFixed(0)}%`;
}

/** `1m 42s` rather than `102s`, which is how the game's own meter reads. */
function duration(seconds) {
  const whole = Math.round(seconds);
  if (whole < SECONDS_PER_MINUTE) {
    return `${String(whole)}s`;
  }
  const minutes = Math.floor(whole / SECONDS_PER_MINUTE);
  return `${String(minutes)}m ${String(whole % SECONDS_PER_MINUTE)}s`;
}

function nounFor(id) {
  return TABLES.find((entry) => entry.id === id)?.noun ?? '';
}

/** Add one event's amount to a table's tally for its ability. */
function record(id, label, event) {
  const map = fight.tallies[id];
  const tally = map.get(label) ?? emptyTally();
  tally.total += event.amount;
  tally.count += 1;
  if (event.crit === true) {
    tally.crits += 1;
  }
  tally.biggest = Math.max(tally.biggest, event.amount);
  tally.absorbed += absorbedOf(event);
  map.set(label, tally);
  fight.totals[id] += event.amount;
}

function fightSeconds(now) {
  const until = fight.endedAt ?? now;
  return Math.max(until - fight.startedAt, MS_PER_SECOND) / MS_PER_SECOND;
}

function startFight() {
  fight = emptyFight(woc.now());
}

/**
 * Close the fight once nothing has landed for the timeout.
 *
 * Called from the repaint rather than from a timer of its own: the frame is being
 * redrawn anyway, and a second timer would be a second thing to tear down. The
 * duration is measured to the last event, not to the moment the timeout noticed,
 * or every fight would read the timeout longer than it was.
 */
function expireFight(now) {
  if (fight.endedAt === null && now - fight.lastEventAt >= timeoutMs()) {
    fight.endedAt = fight.lastEventAt;
  }
}

/**
 * Note that something happened, opening a fight if the last one had closed.
 *
 * Healing counts, which is what makes the meter work for a healer at all: they may
 * deal no damage and take none for a whole encounter. The cost is that topping
 * yourself up out of combat opens a short fight, which is exactly what the game's
 * own meter does under the same rule.
 */
function noteActivity() {
  if (fight.endedAt !== null) {
    startFight();
  }
  fight.lastEventAt = woc.now();
}

woc.net.onEvent('damage', (event) => {
  const { player } = woc.world;
  if (player === null) {
    return;
  }
  const mine = event.sourceId === player.id;
  const atMe = event.targetId === player.id;
  if (!(mine || atMe)) {
    return;
  }
  noteActivity();

  if (mine) {
    // Every outcome counts, including the ones that dealt nothing: a miss rate is
    // the reason that line exists. Damage TAKEN is excluded, since that is the
    // attacker's attack table and not yours.
    const kind = String(event.kind);
    fight.outcomes.set(kind, (fight.outcomes.get(kind) ?? 0) + 1);
    if (event.amount > 0) {
      record('dealt', labelOf(event), event);
    }
  }
  if (atMe && event.amount > 0) {
    record('taken', labelOf(event), event);
  }
});

// `heal2`, not `heal`: only the former carries a `sourceId`, so it is the only one
// a heal can be attributed from.
woc.net.onEvent('heal2', (event) => {
  const { player } = woc.world;
  if (player === null || event.sourceId !== player.id) {
    return;
  }
  // `cueOnly` events carry no healing and exist to drive a sound. The game's own
  // comment says a meter must ignore them by this FLAG rather than by amount, and
  // it is right: a genuine direct heal can legitimately land at 0 on a target at
  // full health, and inferring it from the amount would drop those too.
  if (event.cueOnly === true) {
    return;
  }
  noteActivity();
  if (event.amount > 0) {
    record('healed', labelOf(event), event);
  }
});

const panel = woc.ui.window({
  id: 'meter',
  title: 'Combat',
  width: WINDOW_WIDTH,
  height: WINDOW_HEIGHT,
  density: 'compact',
  save: true,
});

// The tabs come first, the way the game's own meter puts them: they say what the
// numbers under them are, so reading them second is reading backwards.
const tabs = document.createElement('div');
tabs.className = 'woc-tabs woc-meter-tabs';

const total = document.createElement('div');
total.className = 'woc-meter-total';
total.style.opacity = '0.75';
total.style.fontVariantNumeric = 'tabular-nums';

const table = document.createElement('div');
table.className = 'woc-meter-table';
table.style.display = 'flex';
table.style.flexDirection = 'column';
table.style.gap = '2px';

const outcomes = document.createElement('div');
outcomes.className = 'woc-meter-outcomes';
outcomes.style.marginTop = '6px';
outcomes.style.opacity = '0.75';

panel.body.append(tabs, total, table, outcomes);

/** Ability label to its row elements, reused across repaints. */
const rows = new Map();

/** Drop every row, for a tab switch or a reset. Rows are keyed by label. */
function clearRows() {
  rows.clear();
  table.replaceChildren();
}

/**
 * One tab per table.
 *
 * `woc-tab` is the loader's own tab family, which the manager's strip uses, so
 * these get its hover and focus treatment rather than a private imitation. Inside
 * a compact frame it is drawn compact, which is what the density option is for.
 */
function createTab(entry) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'woc-tab woc-meter-tab';
  button.dataset.tab = entry.id;
  button.textContent = entry.label;
  button.addEventListener('click', () => {
    tab = entry.id;
    // Clearing is what makes the switch instant rather than one repaint late.
    clearRows();
    repaint();
  });
  tabs.appendChild(button);
  return button;
}

const tabButtons = TABLES.map(createTab);

function createRow(label) {
  const row = document.createElement('div');
  row.className = 'woc-meter-row';
  row.dataset.ability = label;
  row.style.position = 'relative';
  row.style.padding = '2px 6px';
  row.style.overflow = 'hidden';

  const fill = document.createElement('div');
  fill.className = 'woc-meter-fill';
  fill.style.position = 'absolute';
  fill.style.inset = '0 auto 0 0';
  fill.style.background = 'rgb(120 160 255 / 30%)';

  // A flex line, and the name is the only part allowed to shrink. `min-width: 0`
  // is what lets it: a flex item refuses to go below its content width without it,
  // and that is the difference between an ellipsis and an overlap.
  const head = document.createElement('div');
  head.style.position = 'relative';
  head.style.display = 'flex';
  head.style.alignItems = 'baseline';
  head.style.gap = '6px';

  const name = document.createElement('span');
  name.className = 'woc-meter-name';
  name.style.flex = '1 1 auto';
  name.style.minWidth = '0';
  name.style.overflow = 'hidden';
  name.style.textOverflow = 'ellipsis';
  name.style.whiteSpace = 'nowrap';
  name.textContent = label;
  woc.ui.tooltip(name, label);

  const figure = document.createElement('span');
  figure.className = 'woc-meter-figure';
  figure.style.flex = '0 0 auto';
  figure.style.fontVariantNumeric = 'tabular-nums';

  const detail = document.createElement('div');
  detail.className = 'woc-meter-detail';
  detail.style.position = 'relative';
  detail.style.fontSize = '11px';
  detail.style.opacity = '0.7';

  head.append(name, figure);
  row.append(fill, head, detail);
  return { row, fill, figure, detail };
}

/** The tallies for the table on screen, biggest first and capped. */
function tableRows() {
  const source = fight.tallies[tab];
  const ordered = [...source.entries()].sort((a, b) => b[1].total - a[1].total);
  return ordered.slice(0, settingNumber('max-rows', DEFAULT_MAX_ROWS));
}

/** `12 hits, 24% crit, avg 350, max 780`, plus absorbed when any was. */
function detailText(tally) {
  const parts = [
    `${num(tally.count)} hits`,
    `${pct(tally.crits, tally.count)} crit`,
    `avg ${num(tally.total / Math.max(tally.count, 1))}`,
    `max ${num(tally.biggest)}`,
  ];
  if (tally.absorbed > 0) {
    parts.push(`${num(tally.absorbed)} absorbed`);
  }
  return parts.join(', ');
}

function drawRow(label, tally, whole, seconds) {
  const row = rows.get(label) ?? createRow(label);
  rows.set(label, row);
  const share = (tally.total / Math.max(whole, 1)) * PERCENT;
  const rate = (tally.total / seconds).toFixed(DECIMALS);
  row.fill.style.width = `${share.toFixed(DECIMALS)}%`;
  row.figure.textContent = `${num(tally.total)}  ${pct(tally.total, whole)}  ${rate}`;
  if (settingFlag('show-detail', true)) {
    row.detail.textContent = detailText(tally);
  } else {
    row.detail.textContent = '';
  }
  table.appendChild(row.row);
}

function drawTable(seconds) {
  const ordered = tableRows();
  const whole = fight.totals[tab];
  const shown = new Set(ordered.map(([label]) => label));
  for (const [label, row] of rows) {
    if (!shown.has(label)) {
      row.row.remove();
      rows.delete(label);
    }
  }
  for (const [label, tally] of ordered) {
    drawRow(label, tally, whole, seconds);
  }
}

/** `hit 92%, miss 5%, dodge 3%`: only the outcomes that happened. */
function outcomeText() {
  let swings = 0;
  for (const count of fight.outcomes.values()) {
    swings += count;
  }
  if (swings === 0) {
    return '';
  }
  const parts = [];
  for (const kind of OUTCOMES) {
    const count = fight.outcomes.get(kind) ?? 0;
    if (count > 0) {
      parts.push(`${kind} ${pct(count, swings)}`);
    }
  }
  return parts.join(', ');
}

/**
 * The attack table is yours and is about damage, so it belongs to that tab only.
 *
 * On Healing it would be a non sequitur, and on Taken it would read as the
 * attacker's outcomes rather than as your own, which is the opposite of true.
 */
function outcomeLine() {
  if (tab !== 'dealt' || !settingFlag('show-outcomes', true)) {
    return '';
  }
  return outcomeText();
}

/** Says the fight is over, so a frozen average does not read as a live one. */
function fightSuffix() {
  if (fight.endedAt === null) {
    return '';
  }
  return ', last fight';
}

function repaint() {
  const now = woc.now();
  expireFight(now);
  const seconds = fightSeconds(now);

  // One direction per tab. Reporting all three put a "0 healing" in front of
  // everyone who does not heal, which is most players most of the time.
  const amount = num(fight.totals[tab]);
  total.textContent = `${amount} ${nounFor(tab)} in ${duration(seconds)}${fightSuffix()}`;

  for (const button of tabButtons) {
    const active = button.dataset.tab === tab;
    button.setAttribute('aria-pressed', String(active));
    // `woc-tab-active` is the loader's own marking, so the open tab looks the way
    // the manager's does. aria-pressed alone is invisible to anyone looking.
    button.classList.toggle('woc-tab-active', active);
  }
  drawTable(seconds);
  outcomes.textContent = outcomeLine();
}

repaint();
woc.setInterval(repaint, REPAINT_MS);

woc.keys.bind('toggle', () => {
  panel.toggle();
});

woc.keys.bind('reset', () => {
  startFight();
  clearRows();
  repaint();
});

// A changed row cap has to take effect on the next repaint rather than at the next
// hit, or the table sits on the old shape until something is attacked.
woc.onSettingsChange(repaint);
