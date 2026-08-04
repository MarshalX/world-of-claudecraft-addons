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
// All of it is already on the socket: damage events carry `ability`, `school`, `crit`,
// `kind` and `absorbed`, and `heal2` carries `ability`, `crit` and an `absorbed` of its
// own, for the heal-absorb shields that eat a heal before it lands. So this aggregates
// what the player is already being sent, and never sends anything.
//
// A fight ends when nothing has landed for a while, rather than when the game says
// combat dropped. `inCombat` is not on the wire, so on a client it is false for the
// entire session, and reading it concludes that every fight has ended and resets the
// total on every hit. The idle timeout needs nothing from the server, and it matches
// the 5 seconds the game's own meter uses to close an encounter, so the segments line
// up.
//
// Three limits, stated rather than hidden.
//
// ICONS ONLY FOR YOUR OWN ABILITIES. Skill art is filed under the ability ID, while a
// combat event carries the display NAME: `damage` and `heal2` fill that field from
// `ability.name`, and only `castStart` and `spellfx` carry `ability.id`. The two have
// DIVERGED in the game, where `arcane_shot` is displayed as "Fell Shot", so slugifying
// the name gives `fell_shot`, which is not a file. `world.abilities` carries the id and
// the name together and walks that join backwards, and what it covers is YOUR OWN kit,
// so a mob's ability has no id to find and gets no icon. A missing icon here therefore
// means "not something you cast" rather than "we could not work it out", and it is why
// the rows are also tinted by school: the tint reaches the rows the art cannot.
//
// PET DAMAGE IS NOT COUNTED, AND CANNOT BE. The server delivers a combat event only
// when its `sourceId` or `targetId` is the viewer's own pid or one of their party's
// pids. A pet is a `mob`-kind entity with its own entity id and a party's members are
// player pids, so a pet's swing at a mob matches neither and is dropped before it is
// ever serialized; `net` is read-only, and there is no recovering an event the server
// did not send. The game's own meter folds pet output into the owner's row, which is
// real and works OFFLINE where the client runs the sim itself, and is unreachable
// online because the events it needs are filtered out one layer below it. A pet hitting
// YOU is delivered, since you are the target, and lands in the Taken table.
//
// There is no overhealing column, because no overheal figure rides the wire at all; the
// healing here is what LANDED. The one thing the wire does report about a heal that
// landed nothing is a shield eating it, and that shows as a row totalling zero with its
// absorbed figure beside it. Reading differently from an overheal is the whole point:
// the target is still at low health and the healing is being taken off them.

const MS_PER_SECOND = 1000;
const REPAINT_MS = 500;
const DECIMALS = 1;
const PERCENT = 100;
const SECONDS_PER_MINUTE = 60;
const DEFAULT_TIMEOUT_SECONDS = 5;
const DEFAULT_MAX_ROWS = 10;
const FRAME_WIDTH = 340;
const FRAME_HEIGHT = 320;
/** Auto-attacks arrive with no ability at all, and they are usually a real share. */
const MELEE_LABEL = 'Melee';

/**
 * Attack-table outcomes, in the order they are worth reading.
 *
 * This list has to hold EVERY kind the wire can send, not only the ones worth
 * reading about: the line divides by every outcome recorded, so a kind missing
 * from here still takes its share of the denominator and shrinks every printed
 * percentage to make room for a row that is never drawn. `evade` was exactly
 * that, a leashing wild mob refusing the hit, and it read as a mystery miss rate.
 */
const OUTCOMES = ['hit', 'miss', 'dodge', 'parry', 'block', 'resist', 'evade'];

/** The three tables, in the order the game's own meter puts its tabs. */
const TABLES = [
  { id: 'dealt', label: 'Damage', noun: 'damage' },
  { id: 'healed', label: 'Healing', noun: 'healing' },
  { id: 'taken', label: 'Taken', noun: 'taken' },
];

function emptyTally() {
  // Rows are coloured by school: it is the one identifying thing on a damage event that
  // does not depend on the ability id. First seen wins, so one odd event cannot recolour
  // a row mid-fight.
  return { total: 0, count: 0, crits: 0, biggest: 0, absorbed: 0, school: null };
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

/**
 * What to call the ability behind one event: exactly what the event said.
 *
 * The field is already a display name from every one of the four places the game fills
 * it (`ability.name`, `spell.name`, `queued.def.name`, and a literal 'Auto Shot' or
 * 'Wand' for a ranged auto-attack), so there is nothing here to title-case. Deliberately
 * NOT laundered: a wire that ever starts sending ids shows `measured_shot` in the panel,
 * which somebody reports on the first fight, rather than being tidied into something
 * that looks right and builds the wrong icon URL.
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
 * Whether a record is a thing that happened, which is what earns it a row.
 *
 * The gate is the PAIR, never the amount alone, and one rule covers all three
 * tables because all three meet the same record. A shield that ate a heal or a hit
 * whole leaves `amount: 0` with a real `absorbed`, and dropping that loses the only
 * fact separating two events that deserve opposite reactions: on Healing, a cast
 * wasted on somebody already at full health versus a target still at low health
 * whose healing is being eaten off them; on Taken, a swing that missed versus one
 * your own shield stopped. Both arrive at 0 and `absorbed` is all that parts them.
 *
 * What this must NOT let in is the genuinely empty record. A miss, a dodge, an
 * evade and an overheal all land at 0 carrying no absorb, and none of them belongs
 * in a table of what your total is made of. `cueOnly` is not decided here at all:
 * it is refused earlier, on its own flag, because it is not an event.
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
    if (landed(event)) {
      record('dealt', labelOf(event), event);
    }
  }
  if (atMe && landed(event)) {
    record('taken', labelOf(event), event);
  }
});

// #region heal-attribution
// `heal2`, not `heal`: only the former carries a `sourceId`, so it is the only one
// a heal can be attributed from.
woc.net.onEvent('heal2', (event) => {
  const { player } = woc.world;
  if (player === null || event.sourceId !== player.id) {
    return;
  }
  // `cueOnly` events carry no healing and exist to drive a sound. They must be skipped
  // by this FLAG rather than by amount: a genuine direct heal can legitimately land at 0
  // on a target already at full health, and inferring it from the amount drops those too.
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
 * The panel.
 *
 * A frame rather than a window, because a window's close button is what marks a
 * panel the player OPENS to read and then dismisses with the mouse. This is the
 * other kind: a readout that lives on the HUD for the length of a fight, put up
 * and taken down by the keybind the manifest declares for exactly that.
 *
 * `resizable` has to be spelled out, since a frame defaults to false and this one
 * is not sized by its content: `max-rows` goes to 40, and forty rows is a panel
 * taller than the game. The height is the box the player chose and the body
 * scrolls inside it.
 *
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
    // Clearing is what makes the switch instant rather than one repaint late.
    clearRows();
    repaint();
  },
});
// The addon's own marking, for its own styling. The kit's classes are already on it.
strip.el.classList.add('woc-meter-tabs');

panel.body.append(strip.el, total, table, outcomes);

/** Ability label to its row, reused across repaints. */
const rows = new Map();

/** Drop every row, for a tab switch or a reset. Rows are keyed by label. */
function clearRows() {
  for (const row of rows.values()) {
    row.destroy();
  }
  rows.clear();
  table.replaceChildren();
}

/**
 * One row, from the loader's own timer bar rather than hand-built. Its second line
 * carries the per-ability detail with the fill spanning both, so the share reads as
 * the whole row's rather than as a bar on the top line of it.
 *
 * The art comes from the label by way of `world.abilities`, the only thing that turns
 * the display name an event carries back into the id the icon is filed under. A row
 * with no icon is therefore a row this character did not cast: a mob's ability, or
 * Melee. That is a real distinction rather than a gap, so it is left visible.
 *
 * The fill is tinted by SCHOOL, which survives on the rows the icons cannot reach and
 * says what KIND of damage a row is made of, which an icon does not. Healing rows pass
 * nothing, because `heal2` carries no school.
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
 * The icon for a row, found from the display name the event gave us.
 *
 * Null for anything not in your own spellbook, which is every mob ability and Melee.
 * The kit hides its icon slot for a null or a URL that fails to load, so a row that
 * cannot have art simply has none.
 */
function abilityArt(label) {
  const info = woc.world.abilities.byName(label);
  if (info === null) {
    return null;
  }
  // A player entity's templateId is its class, which is where skill art is filed.
  return woc.ui.icon.ability(info.id, woc.world.player?.templateId ?? '');
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

/** The detail line, or an empty string when the player has switched it off. */
function detailLine(tally) {
  if (settingFlag('show-detail', true)) {
    return detailText(tally);
  }
  return '';
}

/** Put a row at its position, and only if it is not there already. */
function place(el, at) {
  if (table.children[at] !== el) {
    table.insertBefore(el, table.children[at] ?? null);
  }
}

/** One row, against the table it is part of: the whole, the clock, and its slot. */
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

/** Cleared by the first draw. Until then the panel has never had any content. */
let neverDrawn = true;

function repaint() {
  const now = woc.now();
  // Ahead of the visibility check on purpose: a hidden panel keeps tallying, so it has
  // to keep deciding when a fight ended.
  expireFight(now);
  if (!(panel.visible || neverDrawn)) {
    return;
  }
  neverDrawn = false;
  const seconds = fightSeconds(now);

  // One direction per tab. Reporting all three put a "0 healing" in front of
  // everyone who does not heal, which is most players most of the time.
  const amount = num(fight.totals[tab]);
  total.textContent = `${amount} ${nounFor(tab)} in ${duration(seconds)}${fightSuffix()}`;

  drawTable(seconds);
  outcomes.textContent = outcomeLine();
}

repaint();
// Twice a second, and deliberately neither of the two obvious alternatives. Nothing here
// moves on a frame, so `woc.onFrame` would redraw the same strings sixty times a second
// between two hits; and a repaint per event would put a sort plus a write per row on the
// game's event rate, which in a raid is not yours.
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

// A changed row cap has to take effect on the next repaint rather than at the next
// hit, or the table sits on the old shape until something is attacked.
woc.onSettingsChange(() => {
  repaint();
});
