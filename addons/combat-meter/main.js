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
// Three limits, stated rather than hidden.
//
// ICONS ONLY FOR YOUR OWN ABILITIES, and the reason is worth keeping. Skill art is
// filed under the ability ID, while a combat event carries the display NAME: `damage`
// and `heal2` fill that field from `ability.name`, and only `castStart` and `spellfx`
// carry `ability.id`. The two have DIVERGED in the game:
//
//   arcane_shot: { name: `Fell Shot`, ... }
//
// The id is `arcane_shot`, the art is `/ui/skills/hunter/arcane_shot.webp`, and every
// event about it says "Fell Shot". Slugifying gives `fell_shot`, which does not exist.
// A first version shipped exactly that and drew icons for the two hunter abilities
// whose names happened to still match their ids, which read as random.
//
// `world.abilities` is what closed it: the loader reads the game's own resolved
// spellbook, which carries the id and the name together, so `byName` walks the join
// backwards and the art is exact. What it covers is YOUR OWN kit, so a mob's ability
// still has no id to find and gets no icon. That is why a missing icon here means
// "not something you cast" rather than "we could not work it out", and why the rows
// are still tinted by school: the tint reaches the rows the art cannot.
//
// Damage a pet deals is not counted: the published surface does not say which entity
// is yours, and guessing from position or name would be wrong often enough to be worse
// than the omission. And there is no overhealing column, because no overheal figure
// rides the wire at all; the healing here is what landed.

const MS_PER_SECOND = 1000;
const REPAINT_MS = 500;
const DECIMALS = 1;
const PERCENT = 100;
const SECONDS_PER_MINUTE = 60;
const DEFAULT_TIMEOUT_SECONDS = 5;
const DEFAULT_MAX_ROWS = 10;
const WINDOW_WIDTH = 340;
const WINDOW_HEIGHT = 320;
/** Auto-attacks arrive with no ability at all, and they are usually a real share. */
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
  // `school` is the one identifying thing about an ability that IS on a damage event
  // and does not depend on the id, which is why the rows are coloured by it. First
  // seen wins: an ability's school does not change, and re-reading it every hit would
  // let one odd event recolour a row mid-fight.
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
 * There was a title-casing pass here and it was DEAD CODE, which is worse than it
 * sounds. A combat event's `ability` is already a display name from every one of the
 * four places the game fills it: `ability.name`, `spell.name`, `queued.def.name`, and
 * a literal 'Auto Shot' or 'Wand' for a ranged auto-attack. So it never had an
 * underscore to split or a lowercase letter to raise.
 *
 * Removing it is the actual fix for how the icon bug hid. Title-casing turned
 * `measured_shot` and `Measured Shot` into the SAME label, so a row looked correct
 * whichever form the field held and no assertion about the frame could tell them
 * apart. Passing the value through means a wire that ever starts sending ids shows
 * `measured_shot` in the panel, which someone reports on the first fight, instead of
 * being laundered into something that looks right and builds the wrong icon URL.
 *
 * Cooldown Bars keeps its own version of that pass and is right to: it reads the
 * cooldown map, whose keys really are ids.
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
    if (event.amount > 0) {
      record('dealt', labelOf(event), event);
    }
  }
  if (atMe && event.amount > 0) {
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
// #endregion

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

/**
 * One row, from the loader's own timer bar rather than hand-built.
 *
 * The kit row is the same shape this addon used to assemble out of about twenty
 * inline style declarations, and Cooldown Bars had assembled a slightly different
 * one. What the shared version gets right and both copies had drifted on is which
 * part may shrink, whether the figure reserves its width before the name takes what
 * is left, and whether the numbers are tabular. Its second line is what carries the
 * per-ability detail, with the fill spanning both, so the share still reads as the
 * whole row's rather than as a bar on the top line of it.
 *
 * The art comes from the label by way of `world.abilities`, which is the only thing
 * that turns the display name an event carries back into the id the icon is filed
 * under. A row with no icon is therefore a row this character did not cast: a mob's
 * ability, or Melee, neither of which is in your own spellbook. That is a real
 * distinction rather than a gap, so it is left visible.
 *
 * The fill stays tinted by SCHOOL. It was the only way to tell two rows apart back
 * when there was no art, and it is still worth having with art: it survives on the
 * rows the icons cannot reach, and it says what KIND of damage a row is made of,
 * which an icon does not. Healing rows pass nothing, because `heal2` carries no
 * school.
 */
// #region school-tint
function createRow(label, school) {
  const bar = woc.ui.bar({ label, school, icon: abilityArt(label), className: 'woc-meter-row' });
  bar.el.dataset.ability = label;
  woc.ui.tooltip(bar.el, label);
  return bar;
}
// #endregion

/**
 * The icon for a row, found from the display name the event gave us.
 *
 * The join that was impossible until `world.abilities` existed: an event names the
 * ability ("Fell Shot"), art is filed under the id (`arcane_shot`), and the two have
 * diverged. Slugifying the name was tried and produced `fell_shot`, which is nothing.
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

function drawRow(label, tally, whole, seconds) {
  const row = rows.get(label) ?? createRow(label, tally.school);
  rows.set(label, row);
  const rate = (tally.total / seconds).toFixed(DECIMALS);
  row.update({
    fraction: tally.total / Math.max(whole, 1),
    value: `${num(tally.total)}  ${pct(tally.total, whole)}  ${rate}`,
    detail: detailLine(tally),
  });
  table.appendChild(row.el);
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
