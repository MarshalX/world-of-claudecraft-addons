/// <reference types="@woc-addons/types" />

// Combat Meter: a per-ability breakdown of damage dealt, healing done and damage taken, plus your
// attack table. Read off `damage` and `heal2`; nothing is sent.
//
// A fight ends on an idle timeout, because entity `inCombat` is not on the wire, and its duration
// is floored at a second so a burst does not report a rate nobody hit.
//
// Closed fights are KEPT, newest first, and the panel pages between them; `keep-fights` counts the
// one in progress. Each is named after the biggest mob in it, latched as records land, because a
// dead mob despawns before the page is opened. The last page adds the kept fights together, so it
// only reports fights still on the pages behind it. Kept fights are written to THIS CHARACTER's
// store as each closes; the live one is not, since that would be a write per hit.
//
// A pet's output is yours: `damage.sourceOwnerId` first, `Entity.ownerId` otherwise, since only the
// record's own owner survives the pet despawning with its dying owner. Its rows carry the game's
// `{pet}: {ability}`.
//
// Art covers your own spellbook alone (events carry a display name, art is filed under the id), and
// overhealing is a FLOOR, because a fully wasted heal emits no record.

const MS_PER_SECOND = 1000;
const REPAINT_MS = 500;
const DECIMALS = 1;
const PERCENT = 100;
const SECONDS_PER_MINUTE = 60;
const FRAME_WIDTH = 340;
const FRAME_HEIGHT = 348;
/**
 * The panel's opening height before the fight strip, kept as the floor: a saved box is held to the
 * declared bounds, so raising the floor would grow every saved panel on its owner's next login.
 */
const MIN_FRAME_HEIGHT = 320;
/** Auto-attacks arrive with no ability at all. */
const MELEE_LABEL = 'Melee';
/** A pet the snapshot carries with no name of its own. */
const PET_LABEL = 'Pet';
/** What the overhealing figure cannot see, said where the figure is read. */
const OVERHEAL_NOTE = Object.freeze({
  text: 'overhealing seen on landed heals; a fully wasted tick sends nothing',
  tone: 'muted',
});

/** Where this character's kept fights are written, and the shape they are written in. */
const STORE_KEY = 'fights';
const STORE_VERSION = 1;
/**
 * Rows kept per table in a STORED fight. The panel draws at most `max-rows` (40), and totals are
 * stored whole rather than summed from rows, so trimming cannot move a reported figure.
 */
const STORED_ROWS = 40;
/** The last page: the kept fights added together. A string, because it is not one of them. */
const SESSION_PAGE = 'session';
const SESSION_LABEL = 'All kept fights';
/** What page 0 is called while it is still being fought, and once it is not. */
const LIVE_LABEL = 'Current';
const CLOSED_LABEL = 'Last fight';
const OLDER_LABEL = 'Older fight';
const NEWER_LABEL = 'Newer fight';
const OLDER_GLYPH = '‹';
const NEWER_GLYPH = '›';
/**
 * Wider than the density's 4px: at the shared spacing the bordered arrows read as attached to the
 * plain text beside them.
 */
const NAV_GAP = 10;
/** Above and below the strip, on top of the column's own spacing. */
const NAV_BAND_PX = 4;

/**
 * Attack-table outcomes, in reading order. Must hold every kind the wire can send, since the line
 * divides by every outcome recorded.
 */
const OUTCOMES = ['hit', 'miss', 'dodge', 'parry', 'block', 'resist', 'evade'];

const TABLES = [
  { id: 'dealt', label: 'Damage', noun: 'damage' },
  { id: 'healed', label: 'Healing', noun: 'healing' },
  { id: 'taken', label: 'Taken', noun: 'taken' },
];

function emptyTally(pet) {
  // School is the one identifying field that does not depend on the ability id. First seen wins, so
  // one odd event cannot recolour a row. `pet` is fixed by the label.
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

/**
 * `seconds` is null while the fight is open and frozen when it closes, which is how everything
 * tells a live fight from a kept one.
 *
 * `at` is a WALL CLOCK reading where the other stamps are monotonic, because it survives a page
 * load: a stored `now()` reads as a future time on the next load.
 */
function emptyFight(at) {
  return {
    startedAt: at,
    lastEventAt: at,
    at: woc.wallClock(),
    seconds: null,
    label: null,
    biggestHp: -1,
    totals: { dealt: 0, healed: 0, taken: 0 },
    tallies: { dealt: new Map(), healed: new Map(), taken: new Map() },
    outcomes: new Map(),
  };
}

/** What the panel reads before anything has been fought. Never recorded into, never stored. */
const NO_FIGHT = emptyFight(0);
NO_FIGHT.seconds = 1;

/** Newest first. `fights[0]` is the fight in progress whenever its `seconds` is null. */
let fights = [];
/**
 * Which page the panel is reading. Null FOLLOWS the newest fight, so a new pull takes the view with
 * it. Otherwise it is the page object, not its index: a closing fight shifts every index and a
 * numeric pin would move the player onto another fight.
 */
let viewing = null;
let tab = 'dealt';

function timeoutMs() {
  return woc.settings['fight-timeout'] * MS_PER_SECOND;
}

/**
 * The field is already a display name at every site, so nothing is title-cased. Not laundered
 * either: if the wire starts sending ids, `measured_shot` shows rather than being tidied into a
 * wrong icon URL.
 */
function labelOf(event) {
  if (typeof event.ability !== 'string' || event.ability.length === 0) {
    return MELEE_LABEL;
  }
  return event.ability;
}

/**
 * Whether an id is you, or something you control. Asked AGAINST the player: resolving any owned
 * entity to its principal would make this a zone-wide display.
 */
function ownedByPlayer(id, player) {
  if (id === player.id) {
    return true;
  }
  return woc.world.entities.get(id)?.ownerId === player.id;
}

/**
 * The same question about a damage record's SOURCE, asking the record's own owner first. A pet
 * despawns when its owner dies, so the killing exchange's source is already gone from
 * `world.entities`; the snapshot lookup is the fallback. Still asked against the player, since a
 * stranger's pet carries an owner too.
 */
function damageIsMine(event, player) {
  if (event.sourceId === player.id) {
    return true;
  }
  if (typeof event.sourceOwnerId === 'number') {
    return event.sourceOwnerId === player.id;
  }
  return ownedByPlayer(event.sourceId, player);
}

/**
 * The pet's name when the id is something you control, null when it is you. A despawned pet's name
 * is unrecoverable, so its rows (known through `recordOwner`) take the generic label rather than
 * reading as your casts.
 */
function petNameOf(id, player, recordOwner) {
  if (id === player.id) {
    return null;
  }
  const entity = woc.world.entities.get(id);
  if (entity !== undefined && entity.ownerId === player.id) {
    if (typeof entity.name === 'string' && entity.name.length > 0) {
      return entity.name;
    }
    return PET_LABEL;
  }
  if (recordOwner === player.id) {
    return PET_LABEL;
  }
  return null;
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
 * Which row an event belongs to, and whose. The prefix keeps a pet's melee out of your own
 * auto-attack bucket.
 */
function rowFor(event, id, player, recordOwner) {
  const pet = petNameOf(id, player, recordOwner);
  if (pet === null) {
    return { label: labelOf(event), pet: null };
  }
  return { label: `${pet}: ${labelOf(event)}`, pet };
}

/**
 * The gate is the PAIR, never the amount alone: a shield that ate a hit whole leaves `amount: 0`
 * with a real `absorbed`.
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

/** When a kept fight was fought, which is the one thing a stored page cannot say for itself. */
function clockTime(at) {
  return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function nounFor(id) {
  return TABLES.find((entry) => entry.id === id)?.noun ?? '';
}

function record(fight, id, row, event) {
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
 * Name the fight after the biggest thing in it, on either side of the exchange. Latched at RECORD
 * time, because a mob despawns when it dies. Biggest by maximum health, as the game picks the boss
 * out of its trash. A player is not a name, so a duel or battleground stays unnamed.
 */
function nameFight(fight, id) {
  const entity = woc.world.entities.get(id);
  if (entity === undefined || entity.kind !== 'mob' || entity.maxHp <= fight.biggestHp) {
    return;
  }
  fight.biggestHp = entity.maxHp;
  if (typeof entity.name === 'string' && entity.name.length > 0) {
    fight.label = entity.name;
  }
}

/**
 * How long a fight ran: frozen once closed, floored at a second as the game floors the same figure.
 */
function fightSeconds(fight, now) {
  if (fight.seconds !== null) {
    return fight.seconds;
  }
  return Math.max(now - fight.startedAt, MS_PER_SECOND) / MS_PER_SECOND;
}

/** The fight in progress, opening one if the last has closed. Trims to the cap as it goes. */
function openFight() {
  const [first] = fights;
  if (first !== undefined && first.seconds === null) {
    return first;
  }
  const started = emptyFight(woc.now());
  fights.unshift(started);
  fights.length = Math.min(fights.length, woc.settings['keep-fights']);
  return started;
}

/**
 * Close the fight once nothing has landed for the timeout. Measured to the last event, or every
 * fight would read the timeout longer.
 */
function expireFight(now) {
  const [first] = fights;
  if (first === undefined || first.seconds !== null || now - first.lastEventAt < timeoutMs()) {
    return;
  }
  first.seconds = Math.max(first.lastEventAt - first.startedAt, MS_PER_SECOND) / MS_PER_SECOND;
  persist();
}

/**
 * Note that something happened, opening a fight if needed. Healing counts, or a healer's encounter
 * would never open one.
 */
function noteActivity() {
  const fight = openFight();
  fight.lastEventAt = woc.now();
  return fight;
}

/**
 * Your attack table alone. Every outcome counts. A pet's swing rolls against the PET's hit rating,
 * so the raw `sourceId` keeps it out: the one place a pet is not you.
 */
function countOutcome(fight, event, player) {
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
  const mine = damageIsMine(event, player);
  const atMe = ownedByPlayer(event.targetId, player);
  if (!(mine || atMe)) {
    return;
  }
  const fight = noteActivity();

  if (mine) {
    nameFight(fight, event.targetId);
    countOutcome(fight, event, player);
    if (landed(event)) {
      record(fight, 'dealt', rowFor(event, event.sourceId, player, event.sourceOwnerId), event);
    }
  }
  // Damage your pet took is shown, and the server delivers it to you. The prefix names who it
  // LANDED on; the ability is the attacker's.
  if (atMe && landed(event)) {
    nameFight(fight, event.sourceId);
    record(fight, 'taken', rowFor(event, event.targetId, player), event);
  }
});

// #region heal-attribution
// `heal2`, not `heal`: only the former carries a `sourceId` to attribute from.
woc.net.onEvent('heal2', (event) => {
  const { player } = woc.world;
  if (player === null || !ownedByPlayer(event.sourceId, player)) {
    return;
  }
  // `cueOnly` events carry no healing and exist for a sound. Skip them on the flag, not the amount:
  // a direct heal can land at 0 on a full target.
  if (event.cueOnly === true) {
    return;
  }
  const fight = noteActivity();
  if (landed(event)) {
    record(fight, 'healed', rowFor(event, event.sourceId, player), event);
  }
});
// #endregion

function mergeTally(into, label, tally) {
  const found = into.get(label) ?? emptyTally(tally.pet);
  if (found.school === null) {
    found.school = tally.school;
  }
  found.total += tally.total;
  found.count += tally.count;
  found.crits += tally.crits;
  found.biggest = Math.max(found.biggest, tally.biggest);
  found.absorbed += tally.absorbed;
  found.overheal += tally.overheal;
  into.set(label, found);
}

function mergeFight(into, fight) {
  for (const table of TABLES) {
    into.totals[table.id] += fight.totals[table.id];
    for (const [label, tally] of fight.tallies[table.id]) {
      mergeTally(into.tallies[table.id], label, tally);
    }
  }
  for (const [kind, count] of fight.outcomes) {
    into.outcomes.set(kind, (into.outcomes.get(kind) ?? 0) + count);
  }
}

/**
 * The last page: the kept fights added together when READ. A running total would keep counting
 * fights that aged out of the cap. Its duration is the fights' durations summed, not the wall
 * clock, or walking time would dilute the rate.
 */
function sessionSegment(now) {
  const all = emptyFight(0);
  all.label = SESSION_LABEL;
  let seconds = 0;
  for (const fight of fights) {
    seconds += fightSeconds(fight, now);
    mergeFight(all, fight);
  }
  all.seconds = Math.max(seconds, 1);
  return all;
}

/** Every page in order, newest fight first. Empty until something has been fought. */
function pages() {
  if (fights.length === 0) {
    return [];
  }
  return [...fights, SESSION_PAGE];
}

/** Where the view points. A fight aged out from under the pin takes it back to the newest. */
function pageIndex() {
  if (viewing === null) {
    return 0;
  }
  return Math.max(pages().indexOf(viewing), 0);
}

function viewed(now) {
  const page = pages()[pageIndex()];
  if (page === SESSION_PAGE) {
    return sessionSegment(now);
  }
  return page ?? NO_FIGHT;
}

/** Index 0 is a FOLLOW rather than a pin, so a new pull takes the view with it. */
function pinFor(list, index) {
  if (index === 0) {
    return null;
  }
  return list[index] ?? null;
}

function turnPage(step) {
  const list = pages();
  if (list.length === 0) {
    return;
  }
  const next = Math.min(Math.max(pageIndex() + step, 0), list.length - 1);
  viewing = pinFor(list, next);
  // Clearing makes the turn instant rather than one repaint late.
  bars.clear();
  draw();
}

/** What an unnamed fight is called: the newest closed one, and the rest counting back. */
function positionLabel(index) {
  if (index === 0) {
    return CLOSED_LABEL;
  }
  return `Fight -${String(index)}`;
}

function pageLabel() {
  const index = pageIndex();
  const page = pages()[index];
  if (page === undefined) {
    return LIVE_LABEL;
  }
  if (page === SESSION_PAGE) {
    return SESSION_LABEL;
  }
  // On the page still being fought, liveness beats the name; the tooltip has the rest.
  if (index === 0 && page.seconds === null) {
    return LIVE_LABEL;
  }
  return page.label ?? positionLabel(index);
}

function sessionTip(list) {
  return {
    title: SESSION_LABEL,
    lines: [{ text: `${woc.fmt.count(list.length - 1, 'kept fight')} added together` }],
  };
}

function fightTipLines(page, index, count) {
  const lines = [{ text: `fight ${String(index + 1)} of ${String(count)}` }];
  if (page.seconds === null) {
    lines.push({ text: `started ${clockTime(page.at)}, still going`, tone: 'muted' });
    return lines;
  }
  lines.push({ text: `${clockTime(page.at)}, ${duration(page.seconds)} long`, tone: 'muted' });
  return lines;
}

function pageTip() {
  const list = pages();
  const index = pageIndex();
  const page = list[index];
  if (page === undefined) {
    return 'No fight measured yet.';
  }
  if (page === SESSION_PAGE) {
    return sessionTip(list);
  }
  return { title: pageLabel(), lines: fightTipLines(page, index, list.length - 1) };
}

/**
 * A frame: HUD furniture toggled by a keybind. `resizable` is explicit because `max-rows` goes to
 * 40, so the panel is not content-sized.
 */
const panel = woc.ui.frame({
  id: 'meter',
  title: 'Combat',
  width: FRAME_WIDTH,
  height: FRAME_HEIGHT,
  minHeight: MIN_FRAME_HEIGHT,
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
// The addon's own marking, for its own styling.
strip.el.classList.add('woc-meter-tabs');

/**
 * The fight strip: which page is open, and steps between pages. Always drawn, because a row
 * appearing with the second fight would move the figures mid-pull. The buttons wear `.woc-btn`, so
 * they follow density and the touch tap-target floor.
 */
const nav = woc.ui.row({ className: 'woc-meter-nav', gap: NAV_GAP });
nav.dataset.role = 'fights';
// Its own band, because the tab strip's rule and the column's 4px otherwise glue it to the tabs
// above and the figures below. A margin on this box, never a size on the controls, which would opt
// them out of the tap-target floor.
nav.style.margin = `${String(NAV_BAND_PX)}px 0`;

function navButton(glyph, label, step) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'woc-btn';
  el.textContent = glyph;
  el.title = label;
  el.setAttribute('aria-label', label);
  el.dataset.step = String(step);
  el.addEventListener('click', () => {
    turnPage(step);
  });
  return el;
}

const older = navButton(OLDER_GLYPH, OLDER_LABEL, 1);
const newer = navButton(NEWER_GLYPH, NEWER_LABEL, -1);

const pageName = document.createElement('span');
pageName.className = 'woc-meter-page';
pageName.style.flex = '1';
pageName.style.overflow = 'hidden';
pageName.style.textOverflow = 'ellipsis';
pageName.style.whiteSpace = 'nowrap';

const pagePosition = document.createElement('span');
pagePosition.className = 'woc-meter-position';
pagePosition.style.opacity = '0.75';
pagePosition.style.fontVariantNumeric = 'tabular-nums';

nav.append(older, pageName, pagePosition, newer);
woc.ui.tooltip(pageName, () => pageTip());

panel.body.append(strip.el, nav, total, table, outcomes);

/**
 * Keyed on the label, never position, or rows swap identities as the ranking moves. Nothing is
 * measured on a row, so the cap slices before `sync` and `shown` is not needed.
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
 * Art comes from the label through `world.abilities`, the only way from a display name to the id
 * art is filed under, so a row with no icon is one this character did not cast. The fill is tinted
 * by school instead; healing rows pass none, since `heal2` carries no school.
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
  const tally = viewed(woc.now()).tallies[tab].get(label);
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
 * Null outside your own spellbook, and for a pet row, since a pet's abilities are in nobody's. The
 * kit hides the slot for a null or a 404.
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

function tableRows(fight) {
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
  // A floor: a tick that overhealed COMPLETELY sends no record. Hence the `+`, and no percentage,
  // which would divide by a total missing the same ticks.
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
 * Per second, and it says so. No share of the rate beside it: share of damage and of DPS are the
 * same number.
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

/** The total and the duration ride the item, decided once per sync. */
function drawTable(fight, seconds) {
  const whole = fight.totals[tab];
  bars.sync(tableRows(fight).map(([label, tally]) => ({ label, tally, whole, seconds })));
}

function outcomeText(fight) {
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
function outcomeLine(fight) {
  if (tab !== 'dealt' || !woc.settings['show-outcomes']) {
    return '';
  }
  return outcomeText(fight);
}

/**
 * Said on the newest page alone, where it means the fight has closed; the strip already says which
 * page is open.
 */
function fightSuffix() {
  const [first] = fights;
  if (pageIndex() !== 0 || first === undefined || first.seconds === null) {
    return '';
  }
  return ', last fight';
}

function positionText(index, count) {
  if (count === 0) {
    return '';
  }
  return `${String(index + 1)}/${String(count)}`;
}

function drawNav() {
  const list = pages();
  const index = pageIndex();
  pageName.textContent = pageLabel();
  pagePosition.textContent = positionText(index, list.length);
  older.disabled = index >= list.length - 1;
  newer.disabled = index === 0;
}

/**
 * `{ frame }` holds a repaint asked for while hidden and performs one when it returns, so nothing
 * here checks visibility. At most one draw per frame.
 */
const draw = woc.paint(
  () => {
    const now = woc.now();
    const fight = viewed(now);
    const seconds = fightSeconds(fight, now);

    // One direction per tab, or a player who never heals reads a "0 healing" line.
    const amount = num(fight.totals[tab]);
    const rate = rateOf(fight.totals[tab], seconds);
    const summary = `${amount} ${nounFor(tab)} (${rate}) in ${duration(seconds)}`;
    total.textContent = `${summary}${fightSuffix()}`;

    drawNav();
    drawTable(fight, seconds);
    outcomes.textContent = outcomeLine(fight);
  },
  { frame: panel },
);

function storedRows(map) {
  return [...map.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, STORED_ROWS)
    .map(([label, tally]) => ({ label, ...tally }));
}

function storedFight(fight) {
  return {
    at: fight.at,
    seconds: fight.seconds,
    label: fight.label,
    totals: { ...fight.totals },
    tallies: {
      dealt: storedRows(fight.tallies.dealt),
      healed: storedRows(fight.tallies.healed),
      taken: storedRows(fight.tallies.taken),
    },
    outcomes: Object.fromEntries(fight.outcomes),
  };
}

/**
 * The fight in progress is left out: storing it would be a write per hit, and a stale copy read
 * back after a reload would report a fight that never ended.
 */
async function save() {
  await woc.world.ready;
  const closed = fights.filter((fight) => fight.seconds !== null);
  await woc.storage.character.set(STORE_KEY, {
    version: STORE_VERSION,
    fights: closed.map(storedFight),
  });
}

function persist() {
  save().catch((err) => {
    woc.warn('could not write the kept fights down', err);
  });
}

function numberOr0(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return 0;
}

function textOrNull(value) {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return null;
}

function readRow(row) {
  if (typeof row !== 'object' || row === null || typeof row.label !== 'string') {
    return null;
  }
  const tally = emptyTally(textOrNull(row.pet));
  tally.total = numberOr0(row.total);
  tally.count = numberOr0(row.count);
  tally.crits = numberOr0(row.crits);
  tally.biggest = numberOr0(row.biggest);
  tally.absorbed = numberOr0(row.absorbed);
  tally.overheal = numberOr0(row.overheal);
  tally.school = textOrNull(row.school);
  return [row.label, tally];
}

function readRows(value) {
  const map = new Map();
  if (!Array.isArray(value)) {
    return map;
  }
  for (const row of value) {
    const pair = readRow(row);
    if (pair !== null) {
      map.set(pair[0], pair[1]);
    }
  }
  return map;
}

function readOutcomes(value) {
  const map = new Map();
  if (typeof value !== 'object' || value === null) {
    return map;
  }
  for (const [kind, count] of Object.entries(value)) {
    map.set(kind, numberOr0(count));
  }
  return map;
}

/**
 * A stored fight, or null for anything this version cannot read. Totals are read back rather than
 * summed from the capped rows, which would shrink a big fight every round trip.
 */
function readFight(stored) {
  if (typeof stored !== 'object' || stored === null) {
    return null;
  }
  const fight = emptyFight(0);
  fight.at = numberOr0(stored.at);
  fight.seconds = Math.max(numberOr0(stored.seconds), 1);
  fight.label = textOrNull(stored.label);
  for (const entry of TABLES) {
    fight.totals[entry.id] = numberOr0(stored.totals?.[entry.id]);
    fight.tallies[entry.id] = readRows(stored.tallies?.[entry.id]);
  }
  fight.outcomes = readOutcomes(stored.outcomes);
  return fight;
}

function readFights(stored) {
  if (typeof stored !== 'object' || stored === null) {
    return [];
  }
  if (stored.version !== STORE_VERSION || !Array.isArray(stored.fights)) {
    return [];
  }
  const loaded = [];
  for (const one of stored.fights) {
    const fight = readFight(one);
    if (fight !== null) {
      loaded.push(fight);
    }
  }
  return loaded;
}

/**
 * Read back at world entry, when the character is known. They go BEHIND what this session has
 * measured, since a pull can start before the read settles and is newer by definition.
 */
async function restore() {
  const stored = await woc.storage.character.get(STORE_KEY, null);
  const loaded = readFights(stored);
  if (loaded.length === 0) {
    return;
  }
  fights = [...fights, ...loaded].slice(0, woc.settings['keep-fights']);
  draw();
}

function load() {
  restore().catch((err) => {
    woc.warn('could not read the kept fights back', err);
  });
}

async function forget() {
  await woc.world.ready;
  await woc.storage.character.delete(STORE_KEY);
}

/**
 * Expiry keeps running while the panel is away, or a fight that closed behind it reopens looking
 * live; drawing does not, which is the split `woc.paint` owns. Twice a second, not per event.
 */
function tick() {
  expireFight(woc.now());
  draw();
}

tick();
load();
woc.setInterval(tick, REPAINT_MS);

// Everything, not only the live fight: a reset that left the kept pages would leave the numbers one
// press away, with no second control.
woc.keys.bind('reset', () => {
  fights = [];
  viewing = null;
  bars.clear();
  forget().catch((err) => {
    woc.warn('could not clear the kept fights', err);
  });
  draw();
});

// A changed row cap takes effect on the next repaint, and a lowered fight cap drops the oldest
// pages now.
woc.onSettingsChange(() => {
  fights.length = Math.min(fights.length, woc.settings['keep-fights']);
  draw();
});
