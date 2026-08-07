/// <reference types="@woc-addons/types" />

// Combat Meter: a per-ability breakdown of damage dealt, healing done and damage taken,
// plus your attack table. Read off `damage` and `heal2`; nothing is sent.
//
// A fight ends on an idle timeout, because `inCombat` is not on the wire, and its duration
// is floored at a second or a burst divides by a fraction and reports a rate nobody hit.
//
// A pet's output is yours and `Entity.ownerId` is what says so, on a server that has resolved
// each side to its controller since game 0.35.0. Its rows carry the game's own `{pet}: {ability}`.
//
// Two limits: art covers your own spellbook alone, since an event carries a display name
// and art is filed under the id, and the overhealing figure is a FLOOR rather than a total,
// because a fully wasted heal emits no record at all.

const MS_PER_SECOND = 1000;
const REPAINT_MS = 500;
const DECIMALS = 1;
const PERCENT = 100;
const SECONDS_PER_MINUTE = 60;
const FRAME_WIDTH = 340;
const FRAME_HEIGHT = 320;
/** Auto-attacks arrive with no ability at all. */
const MELEE_LABEL = 'Melee';
/** A pet the snapshot carries with no name of its own, which nothing has been seen to send. */
const PET_LABEL = 'Pet';
/** What the overhealing figure cannot see, said where the figure is read. */
const OVERHEAL_NOTE = Object.freeze({
  text: 'overhealing seen on landed heals; a fully wasted tick sends nothing',
  tone: 'muted',
});

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

function emptyTally(pet) {
  // School is the one identifying field on a damage event that does not depend on the
  // ability id. First seen wins, so one odd event cannot recolour a row mid-fight.
  // `pet` is fixed by the label, which carries the name, so it never changes after this.
  return {
    total: 0,
    count: 0,
    crits: 0,
    biggest: 0,
    absorbed: 0,
    overheal: 0,
    school: null,
    pet,
  };
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

function timeoutMs() {
  return woc.settings['fight-timeout'] * MS_PER_SECOND;
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

/**
 * Whether an id is you, or something you control.
 *
 * Asked AGAINST the player rather than by resolving both sides to a principal: a resolver
 * that folded in any owned entity would make this a zone-wide damage display.
 */
function ownedByPlayer(id, player) {
  if (id === player.id) {
    return true;
  }
  return woc.world.entities.get(id)?.ownerId === player.id;
}

/** The pet's own name when the id is something you control, and null when it is you. */
function petNameOf(id, player) {
  if (id === player.id) {
    return null;
  }
  const entity = woc.world.entities.get(id);
  if (entity === undefined || entity.ownerId !== player.id) {
    return null;
  }
  if (typeof entity.name === 'string' && entity.name.length > 0) {
    return entity.name;
  }
  return PET_LABEL;
}

/** Absorbed rides only the events that had some, so an absent field is zero. */
function absorbedOf(event) {
  if (typeof event.absorbed === 'number' && Number.isFinite(event.absorbed)) {
    return event.absorbed;
  }
  return 0;
}

/** Overhealing rides only the heals that lost some, so an absent field is zero. */
function overhealOf(event) {
  if (typeof event.overheal === 'number' && Number.isFinite(event.overheal)) {
    return event.overheal;
  }
  return 0;
}

/**
 * Which row an event belongs to, and whose it was. The prefix keeps a pet's melee out of
 * the bucket your own auto-attack lands in, and costs no art that was ever reachable.
 */
function rowFor(event, id, player) {
  const pet = petNameOf(id, player);
  if (pet === null) {
    return { label: labelOf(event), pet: null };
  }
  return { label: `${pet}: ${labelOf(event)}`, pet };
}

/**
 * The gate is the PAIR, never the amount alone: a shield that ate a hit whole leaves
 * `amount: 0` with a real `absorbed`, the only field separating it from a miss.
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

/** Not `fmt.duration`: this is elapsed time and rounds to nearest, where that ceils. */
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

function record(id, row, event) {
  const map = fight.tallies[id];
  const tally = map.get(row.label) ?? emptyTally(row.pet);
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
  tally.overheal += overhealOf(event);
  map.set(row.label, tally);
  fight.totals[id] += event.amount;
}

/**
 * Floored at a second, which is the game's own floor on the same figure: a fight measured
 * at a fraction of a second reports a rate no player sustained for any of it.
 */
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

/**
 * Your attack table, and yours alone. Every outcome counts, since a miss rate is the point.
 * A pet's swing rolls against the PET's hit rating, so the raw `sourceId` keeps it out:
 * the one place a pet is not treated as you.
 */
function countOutcome(event, player) {
  if (event.sourceId !== player.id) {
    return;
  }
  const kind = String(event.kind);
  fight.outcomes.set(kind, (fight.outcomes.get(kind) ?? 0) + 1);
}

woc.net.onEvent('damage', (event) => {
  const { player } = woc.world;
  if (player === null) {
    return;
  }
  const mine = ownedByPlayer(event.sourceId, player);
  const atMe = ownedByPlayer(event.targetId, player);
  if (!(mine || atMe)) {
    return;
  }
  noteActivity();

  if (mine) {
    countOutcome(event, player);
    if (landed(event)) {
      record('dealt', rowFor(event, event.sourceId, player), event);
    }
  }
  // Damage your pet took is damage you should see, and since game 0.35.0 the server delivers
  // it on exactly that basis. The prefix names who it LANDED on rather than who dealt it,
  // which is this table's reading: the ability is the attacker's.
  if (atMe && landed(event)) {
    record('taken', rowFor(event, event.targetId, player), event);
  }
});

// #region heal-attribution
// `heal2`, not `heal`: only the former carries a `sourceId` to attribute from.
woc.net.onEvent('heal2', (event) => {
  const { player } = woc.world;
  if (player === null || !ownedByPlayer(event.sourceId, player)) {
    return;
  }
  // `cueOnly` events carry no healing and exist to drive a sound. Skip them on the flag
  // rather than on the amount: a direct heal legitimately lands at 0 on a full target.
  if (event.cueOnly === true) {
    return;
  }
  noteActivity();
  if (landed(event)) {
    record('healed', rowFor(event, event.sourceId, player), event);
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
  toggleKey: 'toggle',
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
    bars.clear();
    draw();
  },
});
// The addon's own marking, for its own styling. The kit's classes are already on it.
strip.el.classList.add('woc-meter-tabs');

panel.body.append(strip.el, total, table, outcomes);

/**
 * Keyed on the label, never on position, or two rows swap identities as the ranking moves.
 * Nothing is measured on a row, so the cap can slice before `sync` and `shown` is not needed.
 */
const bars = woc.ui.list({
  parent: table,
  key: (item) => item.label,
  create: (item) => createRow(item.label, item.tally),
  update: (bar, item) => {
    drawRow(bar, item);
  },
});

/**
 * The art comes from the label through `world.abilities`, the only way back from an
 * event's display name to the id the icon is filed under, so a row with no icon is one
 * this character did not cast. The fill is tinted by school instead, which reaches those
 * rows; healing rows pass nothing, since `heal2` carries no school.
 */
// #region school-tint
function createRow(label, tally) {
  const bar = woc.ui.bar({
    label,
    school: tally.school,
    icon: abilityArt(label, tally),
    className: 'woc-meter-row',
  });
  bar.el.dataset.ability = label;
  woc.ui.tooltip(bar.el, () => rowTooltip(label));
  return bar;
}
// #endregion

/** Why a row has no art, which an empty icon slot cannot say for itself. */
function artNote(label, tally) {
  if (tally.pet !== null) {
    return { text: `your pet ${tally.pet}`, tone: 'muted' };
  }
  if (abilityArt(label, tally) === null) {
    return { text: 'not in your spellbook', tone: 'muted' };
  }
  return null;
}

function rowTooltip(label) {
  const tally = fight.tallies[tab].get(label);
  if (tally === undefined) {
    return label;
  }
  const lines = [detailText(tally)];
  if (tally.school !== null) {
    lines.push({ text: `${tally.school} damage`, tone: 'muted' });
  }
  if (tally.overheal > 0) {
    lines.push(OVERHEAL_NOTE);
  }
  const note = artNote(label, tally);
  if (note !== null) {
    lines.push(note);
  }
  return { title: label, icon: abilityArt(label, tally), lines };
}

/**
 * Null outside your own spellbook, and for a pet row without asking, since a pet's
 * abilities are in nobody's. The kit hides the slot for a null or a URL that 404s.
 */
function abilityArt(label, tally) {
  if (tally.pet !== null) {
    return null;
  }
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
  return ordered.slice(0, woc.settings['max-rows']);
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
  // A floor, not a total: a tick that overhealed COMPLETELY sends no record. Hence the
  // `+`, and hence no percentage, which would divide by a total missing the same ticks.
  if (tally.overheal > 0) {
    parts.push(`${num(tally.overheal)}+ overhealed`);
  }
  return parts.join(', ');
}

function detailLine(tally) {
  if (woc.settings['show-detail']) {
    return detailText(tally);
  }
  return '';
}

/**
 * Per second, and it says so. No share of the rate beside it: share of damage and share of
 * DPS are the same number, since both divide by the one fight duration.
 */
function rateOf(amount, seconds) {
  // Grouped like every other figure, or `1000.0/s` sits beside `1,000 damage`.
  const perSecond = (amount / seconds).toLocaleString(undefined, {
    minimumFractionDigits: DECIMALS,
    maximumFractionDigits: DECIMALS,
  });
  return `${perSecond}/s`;
}

function drawRow(bar, item) {
  const share = pct(item.tally.total, item.whole);
  bar.update({
    fraction: item.tally.total / Math.max(item.whole, 1),
    value: `${num(item.tally.total)}  ${share}  ${rateOf(item.tally.total, item.seconds)}`,
    detail: detailLine(item.tally),
  });
}

/** The total and the duration ride the item: per-sync facts, decided in one place. */
function drawTable(seconds) {
  const whole = fight.totals[tab];
  bars.sync(tableRows().map(([label, tally]) => ({ label, tally, whole, seconds })));
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
  if (tab !== 'dealt' || !woc.settings['show-outcomes']) {
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

/**
 * `{ frame }` holds a repaint asked for while the panel is hidden and performs exactly one
 * when it returns, so nothing here checks visibility. Coalesced: one draw per frame at most.
 */
const draw = woc.paint(
  () => {
    const seconds = fightSeconds(woc.now());

    // One direction per tab, or a player who never heals reads a "0 healing" line.
    const amount = num(fight.totals[tab]);
    const rate = rateOf(fight.totals[tab], seconds);
    const summary = `${amount} ${nounFor(tab)} (${rate}) in ${duration(seconds)}`;
    total.textContent = `${summary}${fightSuffix()}`;

    drawTable(seconds);
    outcomes.textContent = outcomeLine();
  },
  { frame: panel },
);

/**
 * Expiring the fight must keep running while the panel is away, or a fight that closed
 * behind it reopens looking live. Drawing must not, which is the split `woc.paint` owns.
 * Twice a second rather than per event: a hit rate of repaints would sort and rewrite rows.
 */
function tick() {
  expireFight(woc.now());
  draw();
}

tick();
woc.setInterval(tick, REPAINT_MS);

woc.keys.bind('reset', () => {
  startFight();
  bars.clear();
  draw();
});

// A changed row cap takes effect on the next repaint rather than at the next hit.
woc.onSettingsChange(() => {
  draw();
});
