/// <reference types="@woc-addons/types" />

// Longwatch: the rare spawns, where they live, and when they are due back.
//
// Nothing on the wire says a mob is rare, so matching is on `templateId` against
// `rares.json`, which `generate.mjs` writes from a game checkout. Never hand-edit it.
//
// The zone match is done from position, never from `world.zone`, which is localized
// display text: a string compare here would work on an English client and nowhere else.
//
// Every stamp is `woc.wallClock()` rather than `woc.now()`. The monotonic clock restarts
// on every page load, so a kill stamped with it reads as being in the future next
// session.
//
// A body is evidence, and it is the only evidence most sightings ever produce. A slain mob
// is NOT removed from the world: it lies where it fell for the whole respawn window and
// then stands up again reusing the same entity id, so walking up to a rare's corpse proves
// it is down without saying when it died. That bounds the return rather than fixing it:
// the kill happened at or before the moment the body was found, so the rare is back no
// later than that moment plus its respawn, and no sooner than the last time it was seen
// standing plus the same. `windowOf` is that pair, and the row says which of the two
// readings it is drawing, because a bound presented as a countdown is a lie about how much
// is known.

/** The opening box. The minimums are well under it, since the opening size is the floor. */
const FRAME_WIDTH = 460;
const FRAME_HEIGHT = 300;
const MIN_WIDTH = 210;
const MIN_HEIGHT = 110;

/** The narrowest a column may get. `auto-fill` rather than a fixed count, which squeezes. */
const COLUMN_MIN = 205;

const MS_PER_SECOND = 1000;
/** Under this much left, a row goes warm: the rare is about to be back. */
const NEARLY_BACK = 60;
/** How far a world pin floats above its point, in screen pixels. */
const PIN_LIFT = 28;
/** A pin's side, which is the tap-target floor the game holds its own controls to. */
const PIN_SIZE = 40;
/** The game's own "something rare turned up" chime. */
const SIGHTING_CUE = 'ui_gather_rare';
/**
 * How long a tapped corpse stays owner-locked, which is the game's `LOOT_FFA_DELAY`.
 *
 * The lock is armed at the kill, so a corpse still holding it died inside this window. It
 * is the one reading that narrows a found body to a minute rather than to a respawn, and
 * it is worth nothing on a corpse nobody could loot, which is why it is read off
 * `world.corpses` (a corpse with a loot record) rather than off the `lootable` flag, which
 * every door and ground pickup in the game also carries.
 */
const LOCK_SECONDS = 60;
/** What marks a figure as a ceiling rather than a measurement. */
const AT_MOST = '≤ ';
/** The one per-character key. Everything this addon remembers is inside it. */
const STORE_KEY = 'sightings';
/** The data file the roster lives in, declared as `data` in the manifest. */
const ROSTER_FILE = 'rares.json';

const FULL = 1;
const EMPTY = 0;

/** Sort ranks for the two states that have no countdown to be ranked by. */
const RANK_UP = -1;
const RANK_DUE = 0;

/** The `zones` setting's two answers that are not a zone name. */
const EVERY_ZONE = 'Every zone';
const CURRENT_ZONE = 'The zone I am in';

/** The `sort` setting's answers that are tested by name. Soonest back is the fall-through. */
const BY_NAME = 'Name';
const BY_DISTANCE = 'Distance';

/**
 * The four zone rectangles that hold a rare, from `ZONES` in `src/sim/data.ts`. Half-open
 * on both axes, and the x bounds are load-bearing: Farshore shares Eastbrook's z band, so
 * a test on z alone puts a player standing there in Eastbrook Vale.
 *
 * Four of the game's FOURTEEN, and the narrowness is a decision rather than drift. Nine of
 * the other ten hold no rare, and the tenth holds one that this roster's shape cannot say
 * anything true about; `generate.mjs` carries the measurement. A position anywhere in those
 * ten resolves to null here, which is what the zone filter and the pins read as "nowhere
 * this addon knows about".
 */
const ZONES = [
  { id: 'eastbrook_vale', name: 'Eastbrook Vale', zMin: -180, zMax: 180 },
  { id: 'mirefen_marsh', name: 'Mirefen Marsh', zMin: 180, zMax: 540 },
  { id: 'thornpeak_heights', name: 'Thornpeak Heights', zMin: 540, zMax: 900 },
  { id: 'veiled_hollow', name: 'The Veiled Hollow', zMin: 900, zMax: 1440 },
];

const STRIP_MIN_X = -180;
const STRIP_MAX_X = 180;

/** The zone ids a roster row is allowed to name, which is these four and no others. */
const ZONE_IDS = new Set(ZONES.map((zone) => zone.id));

/** Empty until the data file lands, which no handler special-cases: nothing matches. */
let rares = [];

/** The roster by template id, which is the shape every lookup here wants. */
let byTemplate = new Map();

/**
 * What is known about each rare. The two entity ids are in-session only, since an entity id
 * is reissued; the four stamps persist.
 *
 *  - `entityId` is the live rare standing there now, and `corpseId` its body. They are
 *    never both set: the game revives a corpse in place under the same id.
 *  - `seenAt` is the last sighting, and is the tooltip's line rather than an input to any
 *    arithmetic. It stays an honest answer to "when did YOU last look at this thing".
 *  - `killedAt` is a kill this character watched happen, and is the only exact reading.
 *  - `downAt` is the EARLIEST moment a body was found since the rare was last seen alive,
 *    which is the ceiling. A later sighting of the same body cannot improve it, so it is
 *    written once and left alone.
 *  - `aliveAt` is the latest moment the rare can be PROVEN to have still been alive, which
 *    is the floor. A sighting sets it; an owner-locked corpse raises it to a minute ago.
 */
const watch = new Map();

/**
 * One roster row, or null for anything that is not one.
 *
 * `woc.data` hands back `unknown`: the loader checks the file is JSON when it fetches it
 * and nothing beyond that, so the shape is a claim and this is where it is checked. What
 * each field is, and where the shipped file read it from:
 *
 *  - `id` is the mob template id, which is what an entity's `templateId` carries and
 *    therefore the only thing a match can be made on.
 *  - `name` is the display name, which the generator takes from the game's `MOBS` table
 *    and cross-checks against the resolved English catalogue, refusing to write the file
 *    if the two disagree. An ability's id and display name already diverge, and that
 *    drift reaching mobs has to stop at the generator.
 *  - `x`/`z` is the authored camp centre, out of the game's own `CAMPS`. Every rare is
 *    authored as a one-mob camp with a radius of 8 or less and the scatter puts it within
 *    a few yards of the centre, so the centre is the location. A rare with two camps has
 *    no honest shape here, which is why the generator refuses one rather than picking.
 *  - `respawn` is seconds, resolved by running the game's own `resolveRespawnSeconds`. It
 *    has to be positive, or a row would divide the fill by nothing and read as due the
 *    instant the rare died.
 *  - `zone` has to be one of the four rectangles above. A row naming any other zone could
 *    never pass the zone filter and would sort by a distance to nowhere.
 */
function readRare(value) {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { id, name, zone, x, z, respawn } = value;
  const named = typeof id === 'string' && id.length > 0;
  const titled = typeof name === 'string' && name.length > 0;
  const placed = Number.isFinite(x) && Number.isFinite(z) && ZONE_IDS.has(zone);
  const timed = Number.isFinite(respawn) && respawn > 0;
  if (named && titled && placed && timed) {
    return { id, name, zone, x, z, respawn };
  }
  return null;
}

/** The file's `rares` array, or null when the file is not the shape it claims. */
function readRoster(file) {
  if (typeof file !== 'object' || file === null) {
    return null;
  }
  const { rares: listed } = file;
  if (!Array.isArray(listed)) {
    return null;
  }
  return listed;
}

/** A bad row is skipped with a warning: one named gap beats a blank panel. */
function adopt(listed) {
  const kept = [];
  for (const [at, row] of listed.entries()) {
    const rare = readRare(row);
    if (rare === null) {
      woc.warn(`${ROSTER_FILE}: entry ${String(at)} is not a rare, leaving it out`, row);
    } else {
      kept.push(rare);
    }
  }
  rares = kept;
  byTemplate = new Map(kept.map((rare) => [rare.id, rare]));
  for (const rare of kept) {
    watch.set(rare.id, blank());
  }
}

/** What is known about a rare nobody has ever laid eyes on. */
function blank() {
  return {
    entityId: null,
    corpseId: null,
    seenAt: null,
    killedAt: null,
    downAt: null,
    aliveAt: null,
  };
}

/** The stamps that persist, which is everything but the two entity ids. */
const STAMPS = ['seenAt', 'killedAt', 'downAt', 'aliveAt'];

/**
 * Whether the roster has been walked once with anything in it.
 *
 * Keyed on there being something to walk rather than on the first call, since the first
 * line runs at document-start with no world and the roster lands later still.
 */
let firstRoster = true;

/** Rows go across and then down: the sort is a ranking, so column-major would misread. */
const list = document.createElement('div');
list.className = 'woc-lw-list';
list.style.display = 'grid';
list.style.gridTemplateColumns = `repeat(auto-fill, minmax(${String(COLUMN_MIN)}px, 1fr))`;
list.style.gap = '3px 6px';

/**
 * The panel. Resizable WITH a height, which is the pair that makes it scroll: a frame with
 * no height is sized by its content, and nineteen rows reach down the whole screen.
 */
const frame = woc.ui.frame({
  id: 'rares',
  title: 'Longwatch',
  width: FRAME_WIDTH,
  height: FRAME_HEIGHT,
  minWidth: MIN_WIDTH,
  minHeight: MIN_HEIGHT,
  resizable: true,
  density: 'compact',
  closable: true,
  save: true,
});
frame.body.appendChild(list);

/** Whether the countdowns are worth writing down. */
function keepsTimers() {
  return woc.settings['keep-timers'];
}

/**
 * The zone id a point is in, or null for a point in none of the four. The game's own
 * resolution: half-open on both axes, first match wins, no clamping to a nearest band.
 */
function zoneAt(x, z) {
  for (const zone of ZONES) {
    if (z >= zone.zMin && z < zone.zMax && x >= STRIP_MIN_X && x < STRIP_MAX_X) {
      return zone.id;
    }
  }
  return null;
}

/** The zone the player is standing in, or null before world entry. */
function currentZone() {
  const { player } = woc.world;
  if (player === null || player === undefined) {
    return null;
  }
  return zoneAt(player.pos.x, player.pos.z);
}

function zoneName(zoneId) {
  return ZONES.find((zone) => zone.id === zoneId)?.name ?? zoneId;
}

/** How long ago a stamp was, in seconds, or null for a stamp there is none of. */
function since(stampMs) {
  if (stampMs === null) {
    return null;
  }
  return (woc.wallClock() - stampMs) / MS_PER_SECOND;
}

/**
 * Seconds from a stamp to the respawn it starts, going NEGATIVE past the window rather than
 * clamping, since a row that has run out has to be able to say so.
 */
function leftFrom(rare, stampMs) {
  const elapsed = since(stampMs);
  if (elapsed === null) {
    return null;
  }
  return rare.respawn - elapsed;
}

/** Seconds until it is certainly back, for a kill this character watched. Null otherwise. */
function measuredFor(rare) {
  return leftFrom(rare, watch.get(rare.id).killedAt);
}

/**
 * The window a found body bounds the return to, or null when no body was ever found.
 *
 * `latest` is the ceiling and is what the row draws. `earliest` is null whenever nothing
 * proves when the rare was last alive, which is the ordinary case for a body walked into
 * cold, and a null floor means "any moment now" rather than a floor of zero.
 */
function windowOf(rare) {
  const row = watch.get(rare.id);
  const latest = leftFrom(rare, row.downAt);
  if (latest === null) {
    return null;
  }
  return { latest, earliest: leftFrom(rare, row.aliveAt) };
}

/** Seconds until it is back at the latest, measured where it can be and bounded where not. */
function leftFor(rare) {
  return measuredFor(rare) ?? windowOf(rare)?.latest ?? null;
}

/**
 * One of 'up', 'down', 'window', 'body', 'due' or 'unseen'. Everything drawn comes from
 * this, and the split that matters is 'down' against 'window': the first is counted from a
 * kill and the second is bounded by a body.
 *
 * 'body' is the state where the arithmetic has run out and the corpse is still lying there,
 * so the rare is provably NOT back whatever the clock says. It outranks 'due' rather than
 * the other way around, because a body in scope is an observation and 'due' is a deduction.
 */
function stateOf(rare) {
  const row = watch.get(rare.id);
  if (row.entityId !== null) {
    return 'up';
  }
  const left = leftFor(rare);
  if (left === null) {
    return 'unseen';
  }
  if (left > 0 && measuredFor(rare) === null) {
    return 'window';
  }
  if (left > 0) {
    return 'down';
  }
  if (row.corpseId !== null) {
    return 'body';
  }
  return 'due';
}

/**
 * The right-hand figure: a countdown, or the word for a state that has no clock.
 *
 * Bounded by one respawn, 21,600 seconds at the longest in `rares.json`, so this stops a
 * tier under the days `sightingLine` reaches.
 */
function figure(rare) {
  const state = stateOf(rare);
  if (state === 'up') {
    return 'Up';
  }
  if (state === 'body') {
    return 'Down';
  }
  if (state === 'due') {
    return 'Due';
  }
  if (state === 'unseen') {
    return 'Unseen';
  }
  const left = woc.fmt.duration(leftFor(rare), 'coarse');
  if (state === 'window') {
    return `${AT_MOST}${left}`;
  }
  return left;
}

/** A rare that is up draws FULL, the opposite sense to a timer: a full bar means go now. */
function fillOf(rare) {
  const state = stateOf(rare);
  if (state === 'up') {
    return FULL;
  }
  if (state === 'down' || state === 'window') {
    return leftFor(rare) / rare.respawn;
  }
  return EMPTY;
}

/**
 * Whether a bounded rare could already be standing there.
 *
 * A window with no floor is deliberately NOT warm. The honest reading of a body walked into
 * cold is that the rare could be back at any moment over the whole respawn, and a row that
 * is warm for six hours has stopped saying anything.
 */
function couldBeBack(rare) {
  const bounds = windowOf(rare);
  if (bounds === null || bounds.earliest === null) {
    return false;
  }
  return bounds.earliest <= 0 || bounds.latest <= NEARLY_BACK;
}

/** Loudest for a rare that is up, warm for one that is back or nearly back. */
function toneFor(rare) {
  const state = stateOf(rare);
  if (state === 'up') {
    return 'danger';
  }
  // A body in scope is proof it is not back, whatever any of the arithmetic says.
  if (state === 'body') {
    return 'default';
  }
  if (state === 'due') {
    return 'warn';
  }
  if (state === 'down' && leftFor(rare) <= NEARLY_BACK) {
    return 'warn';
  }
  if (state === 'window' && couldBeBack(rare)) {
    return 'warn';
  }
  return 'default';
}

/** The quieter second line: where it lives, and how far off it is. */
function detailOf(rare) {
  const away = woc.world.distanceTo(rare);
  if (away === null) {
    return zoneName(rare.zone);
  }
  return `${zoneName(rare.zone)}, ${String(Math.round(away))} yd`;
}

/**
 * The tooltip's last line: when this character last laid eyes on it STANDING.
 *
 * A body is deliberately not a sighting here, since "last seen" beside a countdown reads as
 * when it was last up. The never-seen wording is narrowed where a body was found instead, or
 * the line would contradict the one above it, which says the reading came from that body.
 *
 * UNBOUNDED: `seenAt` is a persisted stamp, so this is the one figure here that reaches
 * `fmt.duration`'s day tier.
 */
function sightingLine(rare) {
  const row = watch.get(rare.id);
  const elapsed = since(row.seenAt);
  if (elapsed === null && row.downAt !== null) {
    return { text: 'You have never seen this one standing', tone: 'muted' };
  }
  if (elapsed === null) {
    return { text: 'You have never seen this one', tone: 'muted' };
  }
  return { text: `Last seen ${woc.fmt.duration(elapsed, 'coarse')} ago`, tone: 'muted' };
}

/**
 * The window a bound gives, spelled out. Two readings a player has to be able to tell
 * apart: with a floor this is a stretch of time the rare turns up inside, and without one
 * the ceiling is all there is and the rare could already be standing there.
 */
function windowLine(rare) {
  const bounds = windowOf(rare);
  const ceiling = `Back within ${woc.fmt.duration(Math.max(bounds.latest, 0), 'coarse')}`;
  if (bounds.earliest === null || bounds.earliest <= 0) {
    return { text: `${ceiling}, from finding its body`, tone: 'muted' };
  }
  return {
    text: `${ceiling}, no sooner than ${woc.fmt.duration(bounds.earliest, 'coarse')}`,
    tone: 'muted',
  };
}

/**
 * Where the figure beside the name came from, which a bounded row cannot leave unsaid.
 *
 * Null for the two states with nothing to explain: a rare standing in front of the player,
 * and one nobody has ever seen.
 */
function readingLine(rare) {
  const state = stateOf(rare);
  if (state === 'body') {
    return { text: 'Its body is still lying there', tone: 'muted' };
  }
  if (state === 'window') {
    return windowLine(rare);
  }
  if (state === 'down' || state === 'due') {
    return { text: 'Counted from the kill you watched', tone: 'muted' };
  }
  return null;
}

/** A function rather than a string: the distance, the reading and the sighting all move. */
function rowTooltip(rare) {
  const lines = [
    `${zoneName(rare.zone)}, camp at ${String(rare.x)}, ${String(rare.z)}`,
    { text: `Back ${woc.fmt.duration(rare.respawn, 'coarse')} after it dies`, tone: 'muted' },
    readingLine(rare),
    sightingLine(rare),
  ];
  return {
    title: rare.name,
    icon: woc.ui.icon.mob(rare.id),
    lines: lines.filter((line) => line !== null),
  };
}

/** `ui.icon.mob` rather than `ability`: the portrait directory is keyed by template id. */
function createRow(rare) {
  const bar = woc.ui.bar({
    label: rare.name,
    icon: woc.ui.icon.mob(rare.id),
    className: 'woc-lw-row',
  });
  bar.el.dataset.rare = rare.id;
  woc.ui.tooltip(bar.el, () => rowTooltip(rare));
  return bar;
}

/**
 * Where a pin sits. A function rather than a point, because the answer has two sources.
 * While the rare is standing there the pin follows its live position, which is the game's
 * own mutating object and is read per frame rather than copied. While it is dead the pin
 * sits on the authored camp centre at the player's own height: the camp table carries x
 * and z and no y, since terrain height is not authored.
 */
function pinPoint(rare) {
  return () => {
    const live = watch.get(rare.id).entityId;
    if (live !== null) {
      const entity = woc.world.entities.get(live);
      if (entity !== undefined) {
        return entity.pos;
      }
    }
    const { player } = woc.world;
    if (player === null || player === undefined) {
      return null;
    }
    return { x: rare.x, y: player.pos.y, z: rare.z };
  };
}

/**
 * One world pin: the portrait, with the respawn sweeping over it. A tile rather than a
 * bar, and the name is passed and never drawn: a column of names floating over a zone is
 * a wall of text between the player and the fight. The label is still how the tile is
 * announced, and the list beside it is where the name is written out.
 */
function createPin(rare) {
  const tile = woc.ui.tile({
    label: rare.name,
    icon: woc.ui.icon.mob(rare.id),
    className: 'woc-lw-pin',
    size: PIN_SIZE,
  });
  tile.el.dataset.rare = rare.id;
  const anchor = woc.ui.anchor3d(pinPoint(rare), {
    className: 'woc-lw-anchor',
    offset: { y: -PIN_LIFT },
  });
  anchor.el.appendChild(tile.el);
  return {
    tile,
    anchor,
    destroy: () => {
      tile.destroy();
      anchor.destroy();
    },
  };
}

/** Keyed on the rare rather than its position, so a row holds still through a re-sort. */
const rows = woc.ui.list({
  parent: list,
  key: (rare) => rare.id,
  create: createRow,
  update: (bar, rare) => {
    bar.update({
      fraction: fillOf(rare),
      value: figure(rare),
      detail: detailOf(rare),
      tone: toneFor(rare),
    });
  },
});

/** No `parent`: each pin carries its own `ui.anchor3d`, which already places it. */
const pins = woc.ui.list({
  key: (rare) => rare.id,
  create: createPin,
  update: (pin, rare) => {
    pin.tile.update({ fraction: fillOf(rare), value: figure(rare), tone: toneFor(rare) });
  },
});

/** Whether a rare passes the zone filter. `here` is resolved once by the caller. */
function passes(rare, choice, here) {
  if (choice === EVERY_ZONE) {
    return true;
  }
  if (choice === CURRENT_ZONE) {
    return rare.zone === here;
  }
  return zoneName(rare.zone) === choice;
}

/**
 * Up first, then soonest back, with the ones nobody has killed at the bottom.
 *
 * A bounded row is ranked by its ceiling, which puts it later in the list than a measured
 * row that will genuinely be back at the same time. That is the right way round: the list
 * is where a player decides what to walk to, and what is known beats what is guessed at.
 */
function dueRank(rare) {
  const state = stateOf(rare);
  if (state === 'up') {
    return RANK_UP;
  }
  const left = leftFor(rare);
  if (left === null) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(left, RANK_DUE);
}

function order(entries, choice) {
  if (choice === BY_NAME) {
    return [...entries].sort((a, b) => a.name.localeCompare(b.name));
  }
  if (choice === BY_DISTANCE) {
    return [...entries].sort(
      (a, b) => (woc.world.distanceTo(a) ?? 0) - (woc.world.distanceTo(b) ?? 0),
    );
  }
  return [...entries].sort((a, b) => dueRank(a) - dueRank(b));
}

/** Recomputed per draw, which is what makes the zone filter follow the player over a
 * border with nothing watching the border. Affordable: the roster is fixed at nineteen.
 */
function wanted() {
  const choice = woc.settings.zones;
  const here = currentZone();
  const shown = rares.filter((rare) => passes(rare, choice, here));
  return order(shown, woc.settings.sort);
}

/** The rares to pin into the world: the ones in the zone the player is standing in. */
function pinnable(entries) {
  if (!frame.visible) {
    return [];
  }
  const here = currentZone();
  if (here === null) {
    return [];
  }
  return entries.filter((rare) => rare.zone === here);
}

function sync(entries) {
  rows.sync(entries);
  pins.sync(pinnable(entries));
}

/** The pins are anchors over the world rather than children of the frame, so hiding the
 * frame does not take them down and nothing else would.
 */
function redraw() {
  if (frame.visible) {
    sync(wanted());
  } else if (pins.size > 0) {
    pins.clear();
  }
}

/**
 * Write the stamps down, once the character they belong to is known.
 *
 * A per-character write REJECTS before world entry, so the await is a guard rather than a
 * delay. The entity id is left out: it is this session's id for the thing standing there.
 */
async function save() {
  if (!keepsTimers()) {
    return;
  }
  await woc.world.ready;
  const pairs = [];
  for (const [id, row] of watch) {
    const stamps = STAMPS.filter((stamp) => row[stamp] !== null);
    if (stamps.length > 0) {
      pairs.push([id, Object.fromEntries(STAMPS.map((stamp) => [stamp, row[stamp]]))]);
    }
  }
  await woc.storage.character.set(STORE_KEY, Object.fromEntries(pairs));
}

/** The same, for the callers that are event handlers and cannot await anything. */
function persist() {
  save().catch((err) => {
    woc.warn('could not write the rare timers down', err);
  });
}

/** A stored stamp, or null for anything that is not one. */
function stampOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}

/** Fills gaps and never overwrites: a death can land before the read settles, and what
 * this session observed is newer than anything on disk.
 */
function reclaim(id, record) {
  const row = watch.get(id);
  if (row === undefined || STAMPS.some((stamp) => row[stamp] !== null)) {
    return;
  }
  if (typeof record !== 'object' || record === null) {
    return;
  }
  for (const stamp of STAMPS) {
    row[stamp] = stampOf(record[stamp]);
  }
}

async function restore() {
  if (!keepsTimers()) {
    return;
  }
  const stored = await woc.storage.character.get(STORE_KEY, null);
  if (typeof stored !== 'object' || stored === null) {
    return;
  }
  for (const [id, record] of Object.entries(stored)) {
    reclaim(id, record);
  }
  redraw();
}

function load() {
  restore().catch((err) => {
    woc.warn('could not read the rare timers back', err);
  });
}

/** A rare has come into range. Loud, because that is the whole point of the addon. */
function announce(rare) {
  if (firstRoster || !woc.settings.alert) {
    return;
  }
  woc.ui.banner(`${rare.name} is up`, { kind: 'info', detail: zoneName(rare.zone) });
  woc.sound.play(SIGHTING_CUE);
}

/**
 * Every reading a kill or a body left behind, dropped.
 *
 * Called where the rare is demonstrably standing there, so whatever the arithmetic said
 * about it is spent. Both bounds go with the kill stamp, or a body found before this one
 * would go on bounding a rare that has already come back.
 */
function forgetDeath(row) {
  row.killedAt = null;
  row.downAt = null;
}

function arrived(entity, rare) {
  const row = watch.get(rare.id);
  row.seenAt = woc.wallClock();
  // Every pass rather than only the first, so a rare watched for an hour and then found
  // dead is floored an hour later than one merely glimpsed. It is the same stamp `seenAt`
  // takes and is kept apart from it because that one is an answer to a question the player
  // asked, and this one is an input to arithmetic a lock reading can also move.
  row.aliveAt = woc.wallClock();
  row.corpseId = null;
  if (row.entityId === entity.id) {
    return;
  }
  row.entityId = entity.id;
  forgetDeath(row);
  announce(rare);
  persist();
}

/**
 * Raise the floor from the corpse's own loot lock, which is armed at the kill and lapses a
 * minute later. Still held means the kill was inside that minute, which turns a six hour
 * window into a one minute one.
 *
 * Read off `world.corpses` rather than the entity, because the lock is only meaningful on a
 * corpse that went through a loot roll and that map is exactly those. An unreadable timer
 * is taken as HELD by the loader, which would be a claim rather than a reading, so nothing
 * is concluded from a corpse the map does not carry.
 */
function readLock(entity, row) {
  const view = woc.world.corpses.get(entity.id);
  if (view === undefined || view.ffa) {
    return;
  }
  const floor = woc.wallClock() - LOCK_SECONDS * MS_PER_SECOND;
  if (row.aliveAt === null || row.aliveAt < floor) {
    row.aliveAt = floor;
  }
}

/**
 * Whether a body needs a bound written for it, which is where THIS death is not the one the
 * stamps already describe.
 *
 * A spent ceiling is the test. A bound whose window has run out cannot be about the body in
 * front of the player, since that body would have stood up, so the rare came back and died
 * again unwatched and the old reading is about a life that has ended. A bound still running
 * is left exactly where it is: the first sighting of a body is the tightest ceiling any
 * later sighting of it could give.
 */
function needsBound(rare, row) {
  return row.downAt === null || leftFrom(rare, row.downAt) <= 0;
}

/**
 * A body found. The kill stamp wins where there is one, since that is a measurement and
 * this is a bound.
 *
 * The lock is read once, at the sighting that writes the bound. Holding a body in view does
 * narrow the floor by a second a second until the lock lapses, and that is deliberately
 * given up: it is at most a minute off a window measured in hours, and taking it would mean
 * a storage write every second for as long as the player stands over the corpse.
 */
function foundBody(entity, rare) {
  const row = watch.get(rare.id);
  const known = row.corpseId === entity.id;
  row.corpseId = entity.id;
  if (known || row.killedAt !== null || !needsBound(rare, row)) {
    return;
  }
  if (row.downAt !== null) {
    // Only reached for a SPENT bound, so whatever proved this rare alive proved it about a
    // life that has since ended. Kept where the bound is new, which is the ordinary case of
    // watching a rare and then finding its body: that sighting is the floor.
    row.aliveAt = null;
  }
  row.downAt = woc.wallClock();
  readLock(entity, row);
  persist();
}

/** Which rares are standing and which are lying there, in one pass over the entity set. */
function scan() {
  const standing = new Set();
  const fallen = new Set();
  const { entities } = woc.world;
  for (const entity of entities.values()) {
    const rare = byTemplate.get(entity.templateId);
    if (rare !== undefined && entity.dead === true) {
      fallen.add(rare.id);
      foundBody(entity, rare);
    } else if (rare !== undefined) {
      standing.add(rare.id);
      arrived(entity, rare);
    }
  }
  for (const [id, row] of watch) {
    if (row.corpseId !== null && !fallen.has(id)) {
      row.corpseId = null;
    }
    if (row.entityId !== null && !standing.has(id)) {
      row.seenAt = woc.wallClock();
      row.entityId = null;
      persist();
    }
  }
  if (entities.size > 0 && rares.length > 0) {
    firstRoster = false;
  }
  redraw();
}

// A rare walking into range changes the entity SET, so this is the prompt signal for one
// arriving or leaving. It is not enough on its own: a rare dying in front of the player
// keeps its entity id and its place in the set, so the transition to a body is invisible
// here and is caught by the once-a-second pass instead.
woc.world.on('entities', scan);

// The record identifies nothing but an entity id, so the template is read off the corpse,
// which is still in scope at the moment the event lands.
woc.net.onEvent('death', (event) => {
  const entity = woc.world.entities.get(event.entityId);
  if (entity === undefined) {
    return;
  }
  const rare = byTemplate.get(entity.templateId);
  if (rare === undefined) {
    return;
  }
  const row = watch.get(rare.id);
  row.killedAt = woc.wallClock();
  row.entityId = null;
  // A measurement, so the bounds this character had are spent. Left in place they would
  // outlive the kill they were guessing at and go on narrowing nothing.
  row.downAt = null;
  row.aliveAt = null;
  persist();
  redraw();
});

/**
 * The player has become somebody else without the page reloading.
 *
 * The game clones and removes its HUD on a switch rather than reloading, so nothing forces
 * an addon to start again. Left in place, the next kill would write the previous
 * character's stamps out under this one's key, which outlives the session.
 *
 * NOT YET VERIFIED against a real switch: no suite reproduces the HUD clone, so the tests
 * only prove that a change of key clears what memory held. A live session still has to
 * confirm the key moves once rather than through an intermediate reading with no
 * character in it.
 */
woc.world.on('characterKey', () => {
  // Replaced rather than cleared field by field, so a stamp added later cannot be the one
  // somebody forgets to blank here and carry from one character onto another's key.
  for (const id of [...watch.keys()]) {
    watch.set(id, blank());
  }
  firstRoster = true;
  load();
  redraw();
});

// Once a second, which is as often as any figure here moves, and a full re-read rather than
// a redraw: a rare dying or standing up in view is a field change on an entity that was
// already in the set, which `world.on('entities')` cannot see. The cost is one pass over
// the entities in interest scope. The lag it leaves is up to a second on the zone filter
// and on the pins leaving the world; the keybind answers the second on the path a player
// takes most.
woc.setInterval(scan, MS_PER_SECOND);

// Bound by hand rather than with the frame's own `toggleKey`, DECLINED because this key
// does two things: `toggleKey` only toggles, and the pins are anchors over the world that
// nothing else takes down. No visibility callback on `FrameOpts` to hang the redraw on.
woc.keys.bind('toggle', () => {
  frame.toggle();
  // Now, rather than up to a second from now: somebody who just hid the panel should not
  // watch its pins hang over the world waiting for the next tick.
  redraw();
});

woc.onSettingsChange(() => {
  // Turning the countdowns back on mid-session needs the read offered again. It fills
  // only what is blank, so it cannot undo what this session learned.
  load();
  redraw();
});

/**
 * Every handler above is wired BEFORE this await: subscribing after one would miss
 * whatever landed during it. `load()` rather than `await restore()`, since a per-character
 * read waits for the character and would hold the first draw on the landing page.
 */
async function boot() {
  const listed = readRoster(await woc.data(ROSTER_FILE));
  if (listed === null) {
    throw new Error(`${ROSTER_FILE} carries no "rares" array`);
  }
  adopt(listed);
  load();
  scan();
}

boot().catch((err) => {
  woc.error('could not read the rare roster, so there is nothing to watch for', err);
});
