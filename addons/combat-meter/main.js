/// <reference types="@woc-addons/types" />

// Combat Meter: a per-ability breakdown of the damage you deal, the healing you do and
// the damage that lands on you, plus your attack-table outcomes. Aggregated from the
// `damage` and `heal2` events the client already receives; nothing is sent.
//
// A fight ends after an idle timeout rather than on a combat flag, since `inCombat` is
// not on the wire. The default matches the 5 seconds the game's own meter uses.
//
// Limits: icons cover your own spellbook only, because art is filed under the ability
// id while an event carries the display name and the two have diverged; pet damage is
// never delivered, since the server filters combat events to the viewer's pid and their
// party's and a pet is a mob-kind entity; and there is no overhealing column, because
// no overheal figure is on the wire.

const MS_PER_SECOND = 1000;
const REPAINT_MS = 500;
const DECIMALS = 1;
const PERCENT = 100;
const SECONDS_PER_MINUTE = 60;
const DEFAULT_TIMEOUT_SECONDS = 5;
const DEFAULT_MAX_ROWS = 10;
const FRAME_WIDTH = 340;
const FRAME_HEIGHT = 320;
/** Auto-attacks arrive with no ability at all. */
const MELEE_LABEL = 'Melee';

/**
 * Attack-table outcomes, in the order they are worth reading. Must hold every kind the
 * wire can send: the line divides by every outcome recorded, so a missing kind still
 * takes its share of the denominator.
 */
const OUTCOMES = ['hit', 'miss', 'dodge', 'parry', 'block', 'resist', 'evade'];

const TABLES = [
  { id: 'dealt', label: 'Damage', noun: 'damage' },
  { id: 'healed', label: 'Healing', noun: 'healing' },
  { id: 'taken', label: 'Taken', noun: 'taken' },
];

function emptyTally() {
  // School is the one identifying field on a damage event that does not depend on the
  // ability id. First seen wins, so one odd event cannot recolour a row mid-fight.
  return { total: 0, count: 0, crits: 0, biggest: 0, absorbed: 0, school: null };
}

/** `endedAt` freezes the duration once the fight closes, so averages stop decaying. */
function emptyFight(at) {
  return {
    startedAt: at,
    endedAt: null,
    lastEventAt: at,
    totals: { dealt: 0, healed: 0, taken: 0 },
    tallies: { dealt: new Map(), healed: new Map(), taken: new Map() },
    outcomes: new Map(),
  };
}

let fight = emptyFight(woc.now());
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

/**
 * The field is already a display name at every site that fills it, so there is nothing
 * to title-case. Deliberately not laundered: if the wire ever starts sending ids,
 * `measured_shot` shows in the panel rather than being tidied into a wrong icon URL.
 */
function labelOf(event) {
  if (typeof event.ability !== 'string' || event.ability.length === 0) {
    return MELEE_LABEL;
  }
  return event.ability;
}

/** Absorbed rides only the events that had some, so an absent field is zero. */
function absorbedOf(event) {
  if (typeof event.absorbed === 'number' && Number.isFinite(event.absorbed)) {
    return event.absorbed;
  }
  return 0;
}

/**
 * Whether a record describes something that happened, which is what earns it a row.
 *
 * The gate is the pair, never the amount alone. A shield that ate a heal or a hit whole
 * leaves `amount: 0` with a real `absorbed`, which is the only field separating it from
 * a miss or an overheal. `cueOnly` is refused earlier, on its own flag.
 */
function landed(event) {
  return event.amount > 0 || absorbedOf(event) > 0;
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

function record(id, label, event) {
  const map = fight.tallies[id];
  const tally = map.get(label) ?? emptyTally();
  if (tally.school === null && typeof event.school === 'string' && event.school.length > 0) {
    tally.school = event.school;
  }
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
 * Close the fight once nothing has landed for the timeout. The duration is measured to
 * the last event, or every fight would read the timeout longer than it was.
 */
function expireFight(now) {
  if (fight.endedAt === null && now - fight.lastEventAt >= timeoutMs()) {
    fight.endedAt = fight.lastEventAt;
  }
}

/**
 * Note that something happened, opening a fight if the last one had closed. Healing
 * counts, or the meter would do nothing for a healer who deals no damage all encounter.
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
    // Every outcome counts, including the ones that dealt nothing, since a miss rate is
    // the reason that line exists. Damage taken is the attacker's attack table, not yours.
    const kind = String(event.kind);
    fight.outcomes.set(kind, (fight.outcomes.get(kind) ?? 0) + 1);
    if (landed(event)) {
      record('dealt', labelOf(event), event);
    }
  }
  if (atMe && landed(event)) {
    record('taken', labelOf(event), event);
  }
});

// #region heal-attribution
// `heal2`, not `heal`: only the former carries a `sourceId` to attribute from.
woc.net.onEvent('heal2', (event) => {
  const { player } = woc.world;
  if (player === null || event.sourceId !== player.id) {
    return;
  }
  // `cueOnly` events carry no healing and exist to drive a sound. Skip them on the flag
  // rather than on the amount: a direct heal legitimately lands at 0 on a full target.
  if (event.cueOnly === true) {
    return;
  }
  noteActivity();
  if (landed(event)) {
    record('healed', labelOf(event), event);
  }
});
// #endregion

/**
 * A frame rather than a window: HUD furniture toggled by a keybind. `resizable` is
 * explicit because the panel is not sized by its content, since `max-rows` goes to 40.
 */
const panel = woc.ui.frame({
  id: 'meter',
  title: 'Combat',
  width: FRAME_WIDTH,
  height: FRAME_HEIGHT,
  density: 'compact',
  resizable: true,
  closable: true,
  save: true,
});

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

const strip = woc.ui.tabs({
  tabs: TABLES.map((entry) => ({ id: entry.id, label: entry.label })),
  active: tab,
  onSelect: (id) => {
    tab = id;
    // Clearing makes the switch instant rather than one repaint late.
    clearRows();
    repaint();
  },
});
// The addon's own marking, for its own styling. The kit's classes are already on it.
strip.el.classList.add('woc-meter-tabs');

panel.body.append(strip.el, total, table, outcomes);

const rows = new Map();

function clearRows() {
  for (const row of rows.values()) {
    row.destroy();
  }
  rows.clear();
  table.replaceChildren();
}

/**
 * The art comes from the label through `world.abilities`, the only way back from an
 * event's display name to the id the icon is filed under, so a row with no icon is one
 * this character did not cast. The fill is tinted by school instead, which reaches those
 * rows; healing rows pass nothing, since `heal2` carries no school.
 */
// #region school-tint
function createRow(label, school) {
  const bar = woc.ui.bar({ label, school, icon: abilityArt(label), className: 'woc-meter-row' });
  bar.el.dataset.ability = label;
  woc.ui.tooltip(bar.el, () => rowTooltip(label, school));
  return bar;
}
// #endregion

function rowTooltip(label, school) {
  const tally = fight.tallies[tab].get(label);
  if (tally === undefined) {
    return label;
  }
  const lines = [detailText(tally)];
  if (school !== null && school !== undefined) {
    lines.push({ text: `${school} damage`, tone: 'muted' });
  }
  if (abilityArt(label) === null) {
    lines.push({ text: 'not in your spellbook', tone: 'muted' });
  }
  return { title: label, icon: abilityArt(label), lines };
}

/**
 * Null for anything outside your own spellbook. The kit hides its icon slot for a null
 * or a URL that fails to load.
 */
function abilityArt(label) {
  const info = woc.world.abilities.byName(label);
  if (info === null) {
    return null;
  }
  // A player entity's templateId is its class, which is where skill art is filed.
  return woc.ui.icon.ability(info.id, woc.world.player?.templateId ?? '');
}

function tableRows() {
  const source = fight.tallies[tab];
  const ordered = [...source.entries()].sort((a, b) => b[1].total - a[1].total);
  return ordered.slice(0, settingNumber('max-rows', DEFAULT_MAX_ROWS));
}

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

function detailLine(tally) {
  if (settingFlag('show-detail', true)) {
    return detailText(tally);
  }
  return '';
}

/** Move a row to its position only when it is not there already. */
function place(el, at) {
  if (table.children[at] !== el) {
    table.insertBefore(el, table.children[at] ?? null);
  }
}

function drawRow(label, tally, table_) {
  const row = rows.get(label) ?? createRow(label, tally.school);
  rows.set(label, row);
  const rate = (tally.total / table_.seconds).toFixed(DECIMALS);
  row.update({
    fraction: tally.total / Math.max(table_.whole, 1),
    value: `${num(tally.total)}  ${pct(tally.total, table_.whole)}  ${rate}`,
    detail: detailLine(tally),
  });
  place(row.el, table_.at);
}

function drawTable(seconds) {
  const ordered = tableRows();
  const whole = fight.totals[tab];
  const shown = new Set(ordered.map(([label]) => label));
  for (const [label, row] of rows) {
    if (!shown.has(label)) {
      row.destroy();
      rows.delete(label);
    }
  }
  for (const [at, [label, tally]] of ordered.entries()) {
    drawRow(label, tally, { whole, seconds, at });
  }
}

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

/** Your own attack table, so it belongs to the damage tab only. */
function outcomeLine() {
  if (tab !== 'dealt' || !settingFlag('show-outcomes', true)) {
    return '';
  }
  return outcomeText();
}

function fightSuffix() {
  if (fight.endedAt === null) {
    return '';
  }
  return ', last fight';
}

let neverDrawn = true;

function repaint() {
  const now = woc.now();
  // Ahead of the visibility check: a hidden panel keeps tallying, so it has to keep
  // deciding when a fight ended.
  expireFight(now);
  if (!(panel.visible || neverDrawn)) {
    return;
  }
  neverDrawn = false;
  const seconds = fightSeconds(now);

  // One direction per tab, or every player who does not heal reads a "0 healing" line.
  const amount = num(fight.totals[tab]);
  total.textContent = `${amount} ${nounFor(tab)} in ${duration(seconds)}${fightSuffix()}`;

  drawTable(seconds);
  outcomes.textContent = outcomeLine();
}

repaint();
// Twice a second: nothing here moves on a frame, and a repaint per event would put a
// sort plus a write per row on the game's event rate.
woc.setInterval(repaint, REPAINT_MS);

woc.keys.bind('toggle', () => {
  panel.toggle();
  repaint();
});

woc.keys.bind('reset', () => {
  startFight();
  clearRows();
  repaint();
});

// A changed row cap takes effect on the next repaint rather than at the next hit.
woc.onSettingsChange(() => {
  repaint();
});
