/// <reference types="@woc-addons/types" />

// Combat Meter: a per-ability breakdown of damage dealt, healing done and damage taken,
// plus your attack table. Read off `damage` and `heal2`; nothing is sent.
//
// A fight ends on an idle timeout, because `inCombat` is not on the wire, and its duration
// is floored at a second or a burst divides by a fraction and reports a rate nobody hit.
//
// Closed fights are KEPT, newest first, and the panel pages between them; `keep-fights` says
// how many, counting the one being fought. Each is named after the biggest mob in it, latched
// as the records land, because a mob that died and despawned is gone from `world.entities`
// long before the page is opened. The last page adds the kept fights together rather than
// running a total of its own, so it can only ever report the fights still on the pages behind
// it. Kept fights are written to THIS CHARACTER's store as each one closes, so a reload keeps
// them; the fight in progress is not, since storing that would mean a write per hit.
//
// A pet's output is yours. `damage.sourceOwnerId` says so from game 0.36.0 and `Entity.ownerId`
// says so otherwise, and both are needed: the record's own owner is the only one that survives
// the pet despawning with its dying owner, which is precisely when the last exchange lands.
// Its rows carry the game's own `{pet}: {ability}`.
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
const FRAME_HEIGHT = 348;
/**
 * The height this panel opened at before it grew a fight strip, kept as the floor.
 *
 * A frame's minimum defaults to the size it was declared at, and a saved box is held to the
 * same bounds a dragged one is, so raising the opening height without this would quietly
 * grow every panel already saved at the old one on its owner's next login.
 */
const MIN_FRAME_HEIGHT = 320;
/** Auto-attacks arrive with no ability at all. */
const MELEE_LABEL = 'Melee';
/** A pet the snapshot carries with no name of its own, which nothing has been seen to send. */
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
 * Rows kept per table in a STORED fight. The panel draws at most `max-rows`, which stops at
 * 40, so anything deeper is bytes no page can show. A fight's totals are stored whole and are
 * never summed back from these rows, so trimming them cannot move a figure the summary reports.
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
 * Wider than the density's own 4px, because this row is the one place in the panel where a
 * bordered control sits directly beside plain text: at the shared spacing the arrows read as
 * attached to the name and to the count rather than as controls of their own.
 */
const NAV_GAP = 10;
/** Above and below the strip, on top of the column's own spacing. */
const NAV_BAND_PX = 4;

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

/**
 * `seconds` is null while the fight is open and frozen the moment it closes, which is both
 * how the duration stops decaying and how everything here tells a live fight from a kept one.
 *
 * `at` is a WALL CLOCK reading where the other two stamps are monotonic ones, because this is
 * the field that has to survive a page load: a `now()` reading stored and read back on the
 * next load is a time in the future, with nothing about it to say so.
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

/** Newest first. `fights[0]` is the fight in progress whenever its `seconds` is still null. */
let fights = [];
/**
 * Which page the panel is reading.
 *
 * Null FOLLOWS the newest fight rather than pinning to it, so a new pull takes the view with
 * it. Anything else is the page object itself rather than its index: a closing fight shifts
 * every index along, and a pin by number would silently move the player onto a different
 * fight at exactly the moment they were reading one.
 */
let viewing = null;
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

/**
 * The same question about a damage record's SOURCE, using the owner the record carries.
 *
 * The snapshot lookup has one blind spot and it is the worst-placed one available: a pet
 * despawns when its owner dies, so around a death the killing exchange's source is already
 * gone from `world.entities` and every one of those records was silently dropped. Game
 * 0.36.0 snapshots the owner onto the record at emit for exactly that, so the field is
 * asked first and the lookup is what answers when it is absent.
 *
 * Still asked AGAINST the player: an owner id is an owner id, and a stranger's pet carries
 * one too.
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
 * The pet's own name when the id is something you control, and null when it is you.
 *
 * `recordOwner` is a damage record's `sourceOwnerId` where there is one, and it is what
 * keeps a despawned pet's rows out of your own: the name is unrecoverable once the entity
 * is gone, so those rows take the generic label rather than reading as your own casts.
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
 * Which row an event belongs to, and whose it was. The prefix keeps a pet's melee out of
 * the bucket your own auto-attack lands in, and costs no art that was ever reachable.
 */
function rowFor(event, id, player, recordOwner) {
  const pet = petNameOf(id, player, recordOwner);
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
 * Name the fight after the biggest thing in it, whichever side of the exchange it was on.
 *
 * Read at RECORD time and latched, because the answer is unrecoverable later: a mob despawns
 * when it dies, so by the time a player pages back to the fight that killed it there is
 * nothing in `world.entities` to ask. Biggest by maximum health, which is the game's own
 * choice on the same question and picks the boss out of its own trash.
 *
 * A player is not a name: a duel and a battleground stay unnamed rather than being filed
 * under whoever happened to be hit hardest.
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
 * How long a fight ran: frozen once it closed, and floored at a second.
 *
 * The floor is the game's own on the same figure: a fight measured at a fraction of a second
 * reports a rate no player sustained for any of it.
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
 * Close the fight once nothing has landed for the timeout. The duration is measured to
 * the last event, or every fight would read the timeout longer than it was.
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
 * Note that something happened, opening a fight if the last one had closed. Healing
 * counts, or the meter would do nothing for a healer who deals no damage all encounter.
 */
function noteActivity() {
  const fight = openFight();
  fight.lastEventAt = woc.now();
  return fight;
}

/**
 * Your attack table, and yours alone. Every outcome counts, since a miss rate is the point.
 * A pet's swing rolls against the PET's hit rating, so the raw `sourceId` keeps it out:
 * the one place a pet is not treated as you.
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
  // Damage your pet took is damage you should see, and since game 0.35.0 the server delivers
  // it on exactly that basis. The prefix names who it LANDED on rather than who dealt it,
  // which is this table's reading: the ability is the attacker's.
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
  // `cueOnly` events carry no healing and exist to drive a sound. Skip them on the flag
  // rather than on the amount: a direct heal legitimately lands at 0 on a full target.
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
 * The last page: every kept fight added together, worked out when it is READ.
 *
 * A running total kept as the events land would go on counting fights that have since aged
 * out of the cap, so it would report more than any page behind it could account for, and it
 * would have to be stored and reconciled on top of that. Its duration is the fights added
 * up rather than the wall clock, or the rate would be divided by every minute spent walking.
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

/** Where the view is pointing. A fight aged out from under the pin takes it back to the newest. */
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
  // Clearing makes the turn instant rather than one repaint late, the same as a tab switch.
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
  // Liveness beats the name on the page whose figures are still moving: whether what you are
  // reading is still being fought is the thing to know first, and the tooltip has the rest.
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
 * A frame rather than a window: HUD furniture toggled by a keybind. `resizable` is
 * explicit because the panel is not sized by its content, since `max-rows` goes to 40.
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
// The addon's own marking, for its own styling. The kit's classes are already on it.
strip.el.classList.add('woc-meter-tabs');

/**
 * The fight strip: which page is open, and the two steps between pages.
 *
 * Drawn whether or not there is anything to page through, because a row that appeared once
 * a second fight existed would move the figures under the eye of a player mid-pull. The
 * buttons wear `.woc-btn`, the loader's own labelled control, so they answer to the frame's
 * density and to the tap-target floor on a phone without this addon sizing anything.
 */
const nav = woc.ui.row({ className: 'woc-meter-nav', gap: NAV_GAP });
nav.dataset.role = 'fights';
// Its own band rather than a third row packed against the two around it: the tab strip carries
// a rule under it, so with the column's own 4px this strip reads as attached to the tabs above
// and pressed against the figures below. A margin on the addon's own box, never a size on the
// controls inside it, which would opt them out of the tap-target floor on a phone.
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
 * Said on the newest page alone, where it means the fight has closed. Every page behind it
 * is a last fight of its own, and the strip above already says which one is open.
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
 * `{ frame }` holds a repaint asked for while the panel is hidden and performs exactly one
 * when it returns, so nothing here checks visibility. Coalesced: one draw per frame at most.
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
 * The fight in progress is left out, which is what keeps this to one write per fight: a
 * stored live fight would have to be rewritten on every hit to be worth anything, and a
 * stale copy of one read back after a reload would report a fight that never ended.
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
 * A stored fight, or null for anything this version cannot read.
 *
 * The totals are read back rather than summed from the rows, because the rows were capped
 * on the way out and the totals were not: a summed total would quietly shrink a big fight
 * every time it was stored and read again.
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
 * Read back at world entry, which is when the character these belong to is known.
 *
 * They go BEHIND whatever this session has already measured rather than replacing it: the
 * read settles after the world does, by which time a pull can have started, and a fight
 * happening now is newer than every stored one by definition.
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
 * Expiring the fight must keep running while the panel is away, or a fight that closed
 * behind it reopens looking live. Drawing must not, which is the split `woc.paint` owns.
 * Twice a second rather than per event: a hit rate of repaints would sort and rewrite rows.
 */
function tick() {
  expireFight(woc.now());
  draw();
}

tick();
load();
woc.setInterval(tick, REPAINT_MS);

// Everything, rather than the fight in progress alone: with the kept fights still on the
// pages behind it, resetting only the newest would leave the numbers the player asked to be
// rid of one press of the strip away, and there is no second control to reach for.
woc.keys.bind('reset', () => {
  fights = [];
  viewing = null;
  bars.clear();
  forget().catch((err) => {
    woc.warn('could not clear the kept fights', err);
  });
  draw();
});

// A changed row cap takes effect on the next repaint rather than at the next hit, and a
// lowered fight cap drops the oldest pages now rather than at the end of the next fight.
woc.onSettingsChange(() => {
  fights.length = Math.min(fights.length, woc.settings['keep-fights']);
  draw();
});
