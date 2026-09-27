/// <reference types="@woc-addons/types" />

// Longwatch: the rare spawns, where they live, and when they are due back.
//
// Nothing on the wire says a mob is rare, so matching is on `templateId` against `rares.json`,
// written by `generate.mjs` from a game checkout; never hand-edit it. The zone match is from
// position, never `world.zone`, which is localized display text. Every stamp is `woc.wallClock()`:
// `woc.now()` restarts on every page load, so a stored kill would read as future.
//
// A slain mob stays where it fell for the whole respawn and stands up under the same entity id, so
// a found corpse proves the rare is down without saying when it died. That bounds the return: no
// later than the find plus the respawn, no sooner than the last sighting alive plus the same.
// `windowOf` is that pair, and the row says which reading it draws, since a bound shown as a
// countdown overstates what is known.
//
// A rare with an authored respawn WINDOW draws its delay fresh on every death, so even a watched
// kill gives a stretch of time. `rares.json` carries both ends for such a rare, and `isExact`
// decides whether a row may count down to a moment.

/** The opening box. The minimums are well under it, since the opening size is the floor. */
const FRAME_WIDTH = 460;
const FRAME_HEIGHT = 300;
const MIN_WIDTH = 210;
const MIN_HEIGHT = 110;

/** The narrowest a column may get. `auto-fill`, where a fixed count would squeeze. */
const COLUMN_MIN = 205;

const MS_PER_SECOND = 1000;
/** Under this much left, a row goes warm: the rare is about to be back. */
const NEARLY_BACK = 60;
/** How far a world pin floats above its point, in screen pixels. */
const PIN_LIFT = 28;
/** A pin's side: the game's tap-target floor. */
const PIN_SIZE = 40;
/** The game's own "something rare turned up" chime. */
const SIGHTING_CUE = 'ui_gather_rare';
/**
 * How long a tapped corpse stays owner-locked: the game's `LOOT_FFA_DELAY`, armed at the kill. A
 * corpse still locked died inside this window, narrowing a found body to a minute. Read off
 * `world.corpses` (corpses with a loot record), not the `lootable` flag, which doors and ground
 * pickups also carry.
 */
const LOCK_SECONDS = 60;
/** What marks a figure as a ceiling rather than a measurement. */
const AT_MOST = '≤ ';
/** The one per-character key. Everything this addon remembers is inside it. */
const STORE_KEY = 'sightings';
/** The data file the roster lives in, declared as `data` in the manifest. */
const ROSTER_FILE = 'rares.json';
/** The rank table this addon carries for other addons. Nothing here draws from it. */
const RANKS_FILE = 'mobs.json';
/**
 * The topic the rank table is published on. A bare noun; `follow` derives `mobs:ask` from it.
 * Listed in the authoring docs' topic table, the only registry the bus has.
 */
const RANKS_TOPIC = 'mobs';

const FULL = 1;
const EMPTY = 0;

/** Sort ranks for the two states that have no countdown to be ranked by. */
const RANK_UP = -1;
const RANK_DUE = 0;

/** The `zones` setting's two answers that are not a zone name. */
const EVERY_ZONE = 'Every zone';
const CURRENT_ZONE = 'The zone I am in';

/** The `sort` answers tested by name; soonest back is the fall-through. */
const BY_NAME = 'Name';
const BY_DISTANCE = 'Distance';

/**
 * The four zone rectangles that hold a rare, from `ZONES` in `src/sim/data.ts`. Half-open, and the
 * x bounds matter: Farshore shares Eastbrook's z band. The other zones hold no rare this roster can
 * describe (`generate.mjs` says why), so a position in them resolves to null: nowhere this addon
 * knows about.
 */
const ZONES = [
  { id: 'eastbrook_vale', name: 'Eastbrook Vale', zMin: -180, zMax: 180 },
  { id: 'mirefen_marsh', name: 'Mirefen Marsh', zMin: 180, zMax: 540 },
  { id: 'thornpeak_heights', name: 'Thornpeak Heights', zMin: 540, zMax: 900 },
  { id: 'veiled_hollow', name: 'The Veiled Hollow', zMin: 900, zMax: 1440 },
];

const STRIP_MIN_X = -180;
const STRIP_MAX_X = 180;

/** The zone ids a roster row may name: these four only. */
const ZONE_IDS = new Set(ZONES.map((zone) => zone.id));

/** Empty until the data file lands; nothing matches meanwhile, so no handler special-cases it. */
let rares = [];

/** The roster by template id. */
let byTemplate = new Map();

/**
 * What is known about each rare. The entity ids are in-session only, since an entity id is
 * reissued; the four stamps persist.
 *
 *  - `entityId` is the live rare standing there, `corpseId` its body. Never both set: the game
 *    revives a corpse in place under the same id.
 *  - `seenAt` is the last sighting, for the tooltip only, not for arithmetic.
 *  - `killedAt` is a kill this character watched, the only exact reading.
 *  - `downAt` is the EARLIEST moment a body was found since the rare was last seen alive: the
 *    ceiling. Written once, since a later sighting of the same body cannot improve it.
 *  - `aliveAt` is the latest moment the rare is PROVEN alive: the floor. A sighting sets it;
 *    an owner-locked corpse raises it to a minute ago.
 */
const watch = new Map();

/**
 * One roster row, or null for anything that is not one. `woc.data` hands back `unknown` (the
 * loader checks only that the file is JSON), so the shape is checked here.
 *
 *  - `id` is the mob template id, what an entity's `templateId` carries.
 *  - `name` is the display name from the game's `MOBS`, cross-checked by the generator against
 *    the English catalogue so id/name drift stops there.
 *  - `x`/`z` is the authored camp centre from `CAMPS`. Every rare is a one-mob camp with a small
 *    radius, so the centre is the location; the generator refuses a rare with two camps.
 *  - `respawn` is seconds from the game's own `resolveRespawnSeconds`, and must be positive or
 *    a row reads as due the instant the rare died.
 *  - `respawnMax` is present only where the game authored a random window. Absent, a watched
 *    kill gives an exact countdown; present, it never can. A value not above `respawn` is
 *    dropped, since a backwards window would make every row due.
 *  - `zone` must be one of the four rectangles, or the row can never pass the zone filter.
 */
function readRare(value) {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { id, name, zone, x, z, respawn, respawnMax } = value;
  const named = typeof id === 'string' && id.length > 0;
  const titled = typeof name === 'string' && name.length > 0;
  const placed = Number.isFinite(x) && Number.isFinite(z) && ZONE_IDS.has(zone);
  const timed = Number.isFinite(respawn) && respawn > 0;
  if (named && titled && placed && timed) {
    return { id, name, zone, x, z, respawn, respawnMax: ceilingOf(respawn, respawnMax) };
  }
  return null;
}

/**
 * The far end of a row's respawn, equal to the near end on a fixed schedule. A number rather than
 * an absent field, so nothing downstream asks whether a rare is windowed before doing arithmetic;
 * `respawn === respawnMax` is the one comparison that decides exactness.
 */
function ceilingOf(respawn, respawnMax) {
  if (Number.isFinite(respawnMax) && respawnMax > respawn) {
    return respawnMax;
  }
  return respawn;
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
 * Whether the roster has been walked once with anything in it. Keyed on there being something to
 * walk, since the first line runs at document-start and the roster lands later.
 */
let firstRoster = true;

/** Rows go across and then down: the sort is a ranking, which column-major would misread. */
const list = document.createElement('div');
list.className = 'woc-lw-list';
list.style.display = 'grid';
list.style.gridTemplateColumns = `repeat(auto-fill, minmax(${String(COLUMN_MIN)}px, 1fr))`;
list.style.gap = '3px 6px';

/**
 * Resizable WITH a height, which makes it scroll: a content-sized frame of every rare reaches down
 * the whole screen.
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
 * The zone id a point is in, or null. The game's own resolution: half-open, first match wins, no
 * clamping to a nearest band.
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
 * Seconds from a stamp to the two ends of the respawn it starts, going NEGATIVE past each so a row
 * that has run out can say so. The ends are equal on a fixed schedule.
 */
function boundsFrom(rare, stampMs) {
  const elapsed = since(stampMs);
  if (elapsed === null) {
    return null;
  }
  return { earliest: rare.respawn - elapsed, latest: rare.respawnMax - elapsed };
}

/** The bounds a kill this character watched gives, or null for a rare nobody watched die. */
function measuredFor(rare) {
  return boundsFrom(rare, watch.get(rare.id).killedAt);
}

/** A kill was watched AND the rare respawns on a fixed schedule, so the return is exact. */
function isExact(rare) {
  return measuredFor(rare) !== null && rare.respawn === rare.respawnMax;
}

/**
 * The window the return falls inside, or null when nothing bounds it.
 *
 * A watched kill beats a found body because it dates the death. `latest` is the ceiling the row
 * draws. `earliest` is null where nothing proves when the rare was last alive, as for a body found
 * cold, and means "any moment now". A watched kill of a WINDOWED rare lands here too, since the
 * game rolls its delay per death.
 */
function windowOf(rare) {
  const measured = measuredFor(rare);
  if (measured !== null) {
    return measured;
  }
  const row = watch.get(rare.id);
  const bounded = boundsFrom(rare, row.downAt);
  if (bounded === null) {
    return null;
  }
  const alive = boundsFrom(rare, row.aliveAt);
  if (alive === null) {
    return { latest: bounded.latest, earliest: null };
  }
  return { latest: bounded.latest, earliest: alive.earliest };
}

/** Seconds until it is back at the latest, measured where it can be and bounded where not. */
function leftFor(rare) {
  const bounds = windowOf(rare);
  if (bounds === null) {
    return null;
  }
  return bounds.latest;
}

/**
 * One of 'up', 'down', 'window', 'body', 'due' or 'unseen'. 'down' is a countdown to a moment;
 * 'window' is a stretch the rare turns up inside. A cold body and a watched kill of a windowed rare
 * both land in 'window', so 'down' asks `isExact` rather than whether a kill was watched, or the
 * countdown runs out early and sits on 'Due' unexplained.
 *
 * 'body' is where the arithmetic has run out and the corpse is still there, so the rare is provably
 * NOT back. It outranks 'due', because a body in scope is an observation and 'due' a deduction.
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
  if (left > 0 && !isExact(rare)) {
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
 * The right-hand figure: a countdown, or the word for a state with no clock. Bounded by one respawn
 * (at most six hours in `rares.json`), so it stops a tier under the days `sightingLine` reaches.
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
    return leftFor(rare) / rare.respawnMax;
  }
  return EMPTY;
}

/**
 * Whether a bounded rare could already be standing there. A window with no floor is NOT warm: the
 * rare could be back at any moment over the whole respawn, and a row warm for hours says nothing.
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
  // A body in scope proves it is not back, whatever the arithmetic says.
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
 * The tooltip's last line: when this character last saw it STANDING. A body is not a sighting,
 * since "last seen" beside a countdown reads as last up; the never-seen wording is narrowed where a
 * body was found so it does not contradict the line above. `seenAt` persists, so this is the one
 * figure that reaches `fmt.duration`'s day tier.
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
 * The window a bound gives, spelled out. With a floor it is a stretch the rare turns up inside;
 * without one the ceiling is all there is and it could already be up. The line also says where the
 * window came from: a death nobody watched, or a watched death whose return the game rolls.
 */
function windowLine(rare) {
  const bounds = windowOf(rare);
  const ceiling = `Back within ${woc.fmt.duration(Math.max(bounds.latest, 0), 'coarse')}`;
  const source = sourceOf(rare);
  if (bounds.earliest === null || bounds.earliest <= 0) {
    return { text: `${ceiling}, ${source}`, tone: 'muted' };
  }
  return {
    text: `${ceiling}, no sooner than ${woc.fmt.duration(bounds.earliest, 'coarse')}`,
    tone: 'muted',
  };
}

/** Why a window rather than a countdown: a rolled respawn, or a death nobody watched. */
function sourceOf(rare) {
  if (measuredFor(rare) !== null) {
    return 'and the game rolls this one';
  }
  return 'from finding its body';
}

/**
 * Where the figure beside the name came from, which a bounded row must say. Null for a rare
 * standing there and one never seen.
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

/**
 * The rare's own schedule. A range where the game authored one, since a single figure for a delay
 * rolled per death sends the player to an empty clearing.
 */
function scheduleLine(rare) {
  const earliest = woc.fmt.duration(rare.respawn, 'coarse');
  if (rare.respawn === rare.respawnMax) {
    return `Back ${earliest} after it dies`;
  }
  return `Back ${earliest} to ${woc.fmt.duration(rare.respawnMax, 'coarse')} after it dies`;
}

/** A function: the distance, the reading and the sighting all move. */
function rowTooltip(rare) {
  const lines = [
    `${zoneName(rare.zone)}, camp at ${String(rare.x)}, ${String(rare.z)}`,
    { text: scheduleLine(rare), tone: 'muted' },
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
 * Where a pin sits. While the rare stands, it follows the live position, the game's mutating object
 * read per frame. While dead, it sits on the authored camp centre at the player's own height, since
 * the camp table has no y.
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
 * One world pin: the portrait with the respawn sweeping over it. The name is passed only as the
 * tile's announced label, never drawn: names floating over a zone are a wall of text in the fight.
 * The list writes the name out.
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
 * Up first, then soonest back, with never-killed at the bottom. A bounded row ranks by its ceiling,
 * below a measured row due at the same time: what is known beats what is guessed.
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

/**
 * Recomputed per draw, so the zone filter follows the player over a border with nothing watching
 * it. The roster is small and fixed.
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

/**
 * The pins are world anchors rather than children of the frame, so hiding the frame does not take
 * them down.
 */
function redraw() {
  if (frame.visible) {
    sync(wanted());
  } else if (pins.size > 0) {
    pins.clear();
  }
}

/**
 * Write the stamps once the character is known. A per-character write REJECTS before world entry,
 * so the await is a guard. The entity id is left out: it is this session's only.
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

/**
 * Fills gaps and never overwrites: a death can land before the read settles, and this session's
 * observations are newer than disk.
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

/** A rare has come into range. Loud, because that is the point of the addon. */
function announce(rare) {
  if (firstRoster || !woc.settings.alert) {
    return;
  }
  woc.ui.banner(`${rare.name} is up`, { kind: 'info', detail: zoneName(rare.zone) });
  woc.sound.play(SIGHTING_CUE);
}

/**
 * Drop every reading a kill or body left behind. Called where the rare is demonstrably standing, so
 * both bounds go with the kill stamp, or an old body would keep bounding a rare that is back.
 */
function forgetDeath(row) {
  row.killedAt = null;
  row.downAt = null;
}

function arrived(entity, rare) {
  const row = watch.get(rare.id);
  row.seenAt = woc.wallClock();
  // Every pass, so a rare watched for an hour then found dead is floored an hour later. Kept apart
  // from `seenAt`, which answers the player's question, where this is an input a lock reading can
  // also move.
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
 * Raise the floor from the corpse's loot lock, armed at the kill and lapsing a minute later: still
 * held means the kill was inside that minute. Read off `world.corpses`, since the lock means
 * something only on a corpse that went through a loot roll. The loader takes an unreadable timer as
 * HELD, so nothing is concluded from a corpse the map does not carry.
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
 * Whether a body needs a bound written, i.e. THIS death is not the one the stamps describe. A spent
 * ceiling is the test: the rare came back and died again unwatched. A running bound is left alone,
 * since the first sighting of a body is the tightest ceiling.
 */
function needsBound(rare, row) {
  return row.downAt === null || boundsFrom(rare, row.downAt).latest <= 0;
}

/**
 * A body found. A kill stamp wins, being a measurement. The lock is read once, at the sighting that
 * writes the bound: tracking it every second would narrow the floor by at most a minute at the cost
 * of a storage write per second.
 */
function foundBody(entity, rare) {
  const row = watch.get(rare.id);
  const known = row.corpseId === entity.id;
  row.corpseId = entity.id;
  if (known || row.killedAt !== null || !needsBound(rare, row)) {
    return;
  }
  if (row.downAt !== null) {
    // Reached only for a SPENT bound, so whatever proved the rare alive was about a life that has
    // ended. Kept where the bound is new: watching a rare then finding its body makes that sighting
    // the floor.
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

// A rare walking into range changes the entity SET, the prompt signal for arrivals and departures.
// A rare dying in view keeps its id and place in the set, so that transition is caught by the
// once-a-second pass.
woc.world.on('entities', scan);

// The record carries only an entity id, so the template is read off the corpse, still in scope when
// the event lands.
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
  // A measurement, so the old bounds are spent and dropped.
  row.downAt = null;
  row.aliveAt = null;
  persist();
  redraw();
});

/**
 * The player became somebody else without a reload: the game swaps characters by cloning its HUD.
 * Left in place, the next kill would write the previous character's stamps under this one's key.
 *
 * NOT YET VERIFIED against a real switch: no suite reproduces the HUD clone. A live session must
 * confirm the key moves once, with no intermediate reading carrying no character.
 */
woc.world.on('characterKey', () => {
  // Replaced whole, so a stamp added later cannot be forgotten here and carried onto another
  // character's key.
  for (const id of [...watch.keys()]) {
    watch.set(id, blank());
  }
  firstRoster = true;
  load();
  redraw();
});

// Once a second, a full re-read: a rare dying or standing up in view is a field change on an entity
// already in the set, which `world.on('entities')` cannot see. The lag is up to a second on the
// zone filter and on pins leaving; the keybind answers at once.
woc.setInterval(scan, MS_PER_SECOND);

// Bound by hand because this key does two things: `toggleKey` only toggles the frame, the pins are
// world anchors nothing else takes down, and `FrameOpts` has no visibility callback.
woc.keys.bind('toggle', () => {
  frame.toggle();
  // Now rather than on the next tick, so a hidden panel's pins do not linger.
  redraw();
});

woc.onSettingsChange(() => {
  // Turning the countdowns back on mid-session re-offers the read. It fills only blanks, so it
  // cannot undo this session's readings.
  load();
  redraw();
});

/**
 * Every handler above is wired BEFORE this await, or it would miss what landed during it. `load()`
 * rather than `await restore()`, since a per-character read waits for the character and would hold
 * the first draw on the landing page.
 */
/**
 * The rank table, for whoever asks. Answered from what was read, and `null` until the read lands,
 * which `publish` requires; a follower that started first gets the announce. It lives here because
 * this addon already evaluates the game's `MOBS`, where a second copy elsewhere would be one more
 * thing to regenerate.
 */
let ranks = null;

/** A row is worth publishing only if it carries something an id cannot be turned into. */
function rankRow(row) {
  if (typeof row?.id !== 'string' || typeof row.name !== 'string') {
    return null;
  }
  const out = { id: row.id, name: row.name };
  if (row.rank === 'elite' || row.rank === 'boss') {
    out.rank = row.rank;
  }
  if (row.rare === true) {
    out.rare = true;
  }
  if (typeof row.requiresQuestId === 'string') {
    out.requiresQuestId = row.requiresQuestId;
  }
  return out;
}

/** The shipped file's shape, checked here for the same reason `readRoster` checks the roster's. */
function readRanks(table) {
  const listed = table?.mobs;
  if (!Array.isArray(listed)) {
    return null;
  }
  return listed.map(rankRow).filter((row) => row !== null);
}

/**
 * The rank table loads separately from the roster, so a failed rank read leaves other addons
 * undecorated without taking this addon's rare list down.
 */
async function serveRanks() {
  const table = readRanks(await woc.data(RANKS_FILE));
  if (table === null) {
    throw new Error(`${RANKS_FILE} carries no "mobs" array`);
  }
  ranks = table;
  publication.announce();
}

const publication = woc.bus.publish(RANKS_TOPIC, () => ranks);

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

serveRanks().catch((err) => {
  woc.warn('could not read the mob rank table, so nothing is published for other addons', err);
});
