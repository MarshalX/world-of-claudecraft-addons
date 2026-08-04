/// <reference types="@woc-addons/types" />

// Longwatch: the rare spawns, where they live, and when they are due back.
//
// The roster is carried by the addon because nothing on the wire says a mob is rare: an
// entity record holds a kind, a template id, a name and a level, while the elite, rare
// and boss flags live in the client's own bundled content. So matching is on
// `templateId` against a table the addon brought with it.
//
// The respawn length is in that table for the same reason. `src/sim/respawn_policy.ts`
// gives a self-scheduled mob a base of 25 seconds times its own multiplier, and
// `rare: true` with no multiplier defaults to 4, so the shipped range is 100 seconds to
// six hours. That is why the countdown has to survive a logout.
//
// The roster is a generated file: `rares.json`, declared as `data` in the manifest,
// fetched by the loader at install, read back through `woc.data` and rebuilt by
// `generate.mjs` beside it from a game checkout. Never hand-edit it. What each field
// means and where the generator read it from is on `readRare`, beside the code that
// checks it, since `woc.data` hands back `unknown`.
//
// Five of the game's 24 rare templates are absent, for two reasons. Four have no camp
// and so nowhere to be waited for: `fallen_captain_aldren`, `corrupted_priest_malric`
// and `deathstalker_voss` are summoned by the Nythraxis crypt encounter, and
// `wildheart_beastmaster` is a miniboss inside a dungeon instance, so a countdown for
// any of them would be a number with nothing behind it. The fifth, `drakemaw_broodlord`,
// stands outside the four zones below: it holds four separate camps in The Drakelands,
// which is one rare with four points and an x-bounded zone, and neither is a shape this
// addon has. A player standing there resolves to no zone at all.
//
// Nothing names the five anywhere: `CAMPS` says which rares have a home and `ZONES` says
// which of those this addon can place, so the roster follows a content change with no
// edit here, and `generate.mjs` prints what it left out and why on every run.
//
// The zone match is done from position, never from `world.zone`, which is localized
// display text rather than an id: comparing it against a string in this file would work
// on an English client and match nothing on any other. `zoneAt` resolves a point against
// rectangles the way the game does.
//
// Four things report the set changing: `world.on('entities')` for a rare walking into
// interest scope, `net.onEvent('death')` for one being killed, `world.on('characterKey')`
// for the player becoming somebody else, and a settings change for the filter moving.
// The countdowns move on a once-a-second timer that stands down while the panel is
// hidden.
//
// Every stamp is `woc.wallClock()` rather than `woc.now()`. The monotonic clock is right
// for measuring an interval inside one session and wrong for a stamp that has to mean
// the same thing after a reload: it restarts from near zero on every page load, so a
// kill stamped with it reads as having happened in the future on the next session.

/**
 * The panel's opening box, and how far the player may take it in. Wide enough for two
 * columns and short enough that nineteen rows do not reach the bottom of the screen: the
 * roster is a reference list read a line at a time. The minimums are well under both,
 * because the opening size is otherwise the floor as well.
 */
const FRAME_WIDTH = 460;
const FRAME_HEIGHT = 300;
const MIN_WIDTH = 210;
const MIN_HEIGHT = 110;

/**
 * The narrowest a column may get before there is one fewer of them. `auto-fill` rather
 * than a fixed two, because a fixed count answers a drag by squeezing: at the minimum
 * width two columns would be 100px each, which is a name and no room for the countdown.
 */
const COLUMN_MIN = 205;

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
/** Under this much left, a row goes warm: the rare is about to be back. */
const NEARLY_BACK = 60;
/** How far a world pin floats above its point, in screen pixels. */
const PIN_LIFT = 28;
/** A pin's side, which is the tap-target floor the game holds its own controls to. */
const PIN_SIZE = 40;
/** The game's own "something rare turned up" chime. */
const SIGHTING_CUE = 'ui_gather_rare';
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

/** The `sort` setting's answers. */
const SOONEST = 'Soonest back';
const BY_NAME = 'Name';
const BY_DISTANCE = 'Distance';

/**
 * The four zone rectangles that hold a rare, from `ZONES` in `src/sim/data.ts`.
 *
 * Half-open on both axes, which is the game's own test: `zMin <= z < zMax` and
 * `xMin <= x < xMax`. None of these four declares an x range, so all four take the world
 * strip's default of -180 to 180. That default is load-bearing: Farshore Isle shares
 * Eastbrook's z band and sits at x 180 to 540, so a test on z alone would report a player
 * standing on Farshore as standing in Eastbrook Vale.
 *
 * Only four of the game's fourteen zones are here. A position in any of the other ten
 * resolves to null, which is the true answer to the question this table is asked.
 *
 * `name` is this addon's own label for its own table, and is never compared against
 * `world.zone`.
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

/**
 * The roster, empty until the data file lands. An addon's first line runs at
 * document-start and `woc.data` is a promise, so every session begins without one.
 * Nothing is special-cased for it: no template id matches an empty map, so the world and
 * death handlers are no-ops and a draw with no rows draws nothing.
 */
let rares = [];

/** The roster by template id, which is the shape every lookup here wants. */
let byTemplate = new Map();

/**
 * What this character knows about each rare, filled in as the roster lands. `entityId` is
 * in-session only, since an entity id is reissued between sessions. `seenAt` and
 * `killedAt` are wall-clock stamps and are persisted, because they are the two things a
 * countdown cannot be rebuilt without.
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

/**
 * Take the roster on, dropping any row that did not check out. A bad row is skipped with
 * a warning naming its position rather than treated as a reason to throw the rest of the
 * file away: eighteen rares and one named gap beats a blank panel.
 */
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
    watch.set(rare.id, { seenAt: null, killedAt: null, entityId: null });
  }
}

/** Template id to the kit row drawing it, for the rows currently in the list. */
const rows = new Map();
/** Template id to its world pin, for the rares in the zone the player is standing in. */
const pins = new Map();

/**
 * Whether the roster has been walked once with anything in it.
 *
 * The first walk that finds a populated roster is world entry, or the moment the player
 * enabled this addon, and every rare already in range arrives in that one walk. Keyed on
 * there being something to walk and something to match against rather than on the first
 * call, since an addon's first line runs at document-start with no world and the roster
 * arrives later still.
 */
let firstRoster = true;

/**
 * The grid. Built once, because nothing here can change its shape. Rows go across and
 * then down, which is what a grid does with DOM order and is the order `place` writes:
 * the sort is a ranking, and column-major would put second place under first.
 */
const list = document.createElement('div');
list.className = 'woc-lw-list';
list.style.display = 'grid';
list.style.gridTemplateColumns = `repeat(auto-fill, minmax(${String(COLUMN_MIN)}px, 1fr))`;
list.style.gap = '3px 6px';

/**
 * The panel.
 *
 * Compact rather than comfortable: this is a readout glanced at between pulls, where the
 * tap-target floor would make the title bar the loudest thing on it. Not bare, because a
 * roster of nineteen rows is a panel, and a player has to be able to find it while every
 * row says "Unseen".
 *
 * Resizable with a height, which is the pair that makes it scroll. A frame with no height
 * is sized by its content, and nineteen rows is a column down the whole screen with no
 * way to shorten it; an explicit height leaves the loader's own body element to shrink,
 * and that element already carries `overflow: auto`.
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

function settingText(id, fallback) {
  const value = woc.settings[id];
  if (typeof value === 'string' && value.length > 0) {
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

/** Whether the countdowns are worth writing down. */
function keepsTimers() {
  return settingFlag('keep-timers', true);
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

/** Yards from the player to a rare's camp, or null before world entry. */
function distanceTo(rare) {
  const { player } = woc.world;
  if (player === null || player === undefined) {
    return null;
  }
  return Math.hypot(player.pos.x - rare.x, player.pos.z - rare.z);
}

/**
 * Seconds until a rare is due back, or null when nothing this character saw says. It goes
 * negative once the respawn window has passed, and the display names that rather than
 * clamping it: "due back now" and "still counting" are different answers.
 */
function remainingFor(rare) {
  const row = watch.get(rare.id);
  if (row.killedAt === null) {
    return null;
  }
  return rare.respawn - (woc.wallClock() - row.killedAt) / MS_PER_SECOND;
}

/** One of 'up', 'down', 'due' or 'unseen'. Everything drawn is derived from this. */
function stateOf(rare) {
  if (watch.get(rare.id).entityId !== null) {
    return 'up';
  }
  const left = remainingFor(rare);
  if (left === null) {
    return 'unseen';
  }
  if (left > 0) {
    return 'down';
  }
  return 'due';
}

/** `6h 0m`, `4m 30s`, `45s`. Rounded up, so nothing reads 0 while it is still counting. */
function countdown(seconds) {
  const whole = Math.ceil(seconds);
  if (whole >= SECONDS_PER_HOUR) {
    const hours = Math.floor(whole / SECONDS_PER_HOUR);
    const minutes = Math.floor((whole % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
    return `${String(hours)}h ${String(minutes)}m`;
  }
  if (whole >= SECONDS_PER_MINUTE) {
    const minutes = Math.floor(whole / SECONDS_PER_MINUTE);
    return `${String(minutes)}m ${String(whole % SECONDS_PER_MINUTE)}s`;
  }
  return `${String(whole)}s`;
}

/** The right-hand figure: a countdown, or the word for a state that has no clock. */
function figure(rare) {
  const state = stateOf(rare);
  if (state === 'up') {
    return 'Up';
  }
  if (state === 'due') {
    return 'Due';
  }
  if (state === 'unseen') {
    return 'Unseen';
  }
  return countdown(remainingFor(rare));
}

/**
 * How full the row is. A rare standing there is drawn full, which is the opposite sense
 * to a timer and is deliberate: a loud full bar means "go now", and the only other row
 * that reaches full is one whose respawn has just started.
 */
function fillOf(rare) {
  const state = stateOf(rare);
  if (state === 'up') {
    return FULL;
  }
  if (state === 'down') {
    return remainingFor(rare) / rare.respawn;
  }
  return EMPTY;
}

/** Loudest for a rare that is up, warm for one that is back or nearly back. */
function toneFor(rare) {
  const state = stateOf(rare);
  if (state === 'up') {
    return 'danger';
  }
  if (state === 'due') {
    return 'warn';
  }
  if (state === 'down' && remainingFor(rare) <= NEARLY_BACK) {
    return 'warn';
  }
  return 'default';
}

/** The quieter second line: where it lives, and how far off it is. */
function detailOf(rare) {
  const away = distanceTo(rare);
  if (away === null) {
    return zoneName(rare.zone);
  }
  return `${zoneName(rare.zone)}, ${String(Math.round(away))} yd`;
}

/** How long ago a stamp was, in seconds, or null for a stamp there is none of. */
function since(stampMs) {
  if (stampMs === null) {
    return null;
  }
  return (woc.wallClock() - stampMs) / MS_PER_SECOND;
}

/** The tooltip's last line: when this character last laid eyes on it. */
function sightingLine(rare) {
  const elapsed = since(watch.get(rare.id).seenAt);
  if (elapsed === null) {
    return { text: 'You have never seen this one', tone: 'muted' };
  }
  return { text: `Last seen ${countdown(elapsed)} ago`, tone: 'muted' };
}

/**
 * What a row says under the pointer. A function rather than a string, since the distance
 * changes as the player rides and the sighting line changes every second.
 */
function rowTooltip(rare) {
  const lines = [
    `${zoneName(rare.zone)}, camp at ${String(rare.x)}, ${String(rare.z)}`,
    { text: `Back ${countdown(rare.respawn)} after it dies`, tone: 'muted' },
    sightingLine(rare),
  ];
  return { title: rare.name, icon: woc.ui.icon.mob(rare.id), lines };
}

/**
 * One row. `ui.icon.mob` rather than `ui.icon.ability`: this is a mob template id and the
 * portrait directory is keyed by exactly that, while skill art is filed under a class. A
 * rare with no painted portrait leaves the slot hidden, which the kit does on its own.
 */
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
  return { tile, anchor };
}

function dropPin(id, pin) {
  pin.tile.destroy();
  pin.anchor.destroy();
  pins.delete(id);
}

function clearPins() {
  for (const [id, pin] of pins) {
    dropPin(id, pin);
  }
}

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

/** Up first, then soonest back, with the ones nobody has killed at the bottom. */
function dueRank(rare) {
  const state = stateOf(rare);
  if (state === 'up') {
    return RANK_UP;
  }
  if (state === 'due') {
    return RANK_DUE;
  }
  const left = remainingFor(rare);
  if (left === null) {
    return Number.POSITIVE_INFINITY;
  }
  return left;
}

function order(entries, choice) {
  if (choice === BY_NAME) {
    return [...entries].sort((a, b) => a.name.localeCompare(b.name));
  }
  if (choice === BY_DISTANCE) {
    return [...entries].sort((a, b) => (distanceTo(a) ?? 0) - (distanceTo(b) ?? 0));
  }
  return [...entries].sort((a, b) => dueRank(a) - dueRank(b));
}

/**
 * Every rare worth a row right now, in the order the player asked for. Recomputed on
 * every frame the panel is up, which is affordable because this roster is a fixed
 * nineteen and cannot grow. What it buys is the zone filter following the player across a
 * border with nothing having to watch the border.
 */
function wanted() {
  const choice = settingText('zones', EVERY_ZONE);
  const here = currentZone();
  const shown = rares.filter((rare) => passes(rare, choice, here));
  return order(shown, settingText('sort', SOONEST));
}

/** Put a row at its position, and only when it is not already there. */
function place(el, at) {
  if (list.children[at] !== el) {
    list.insertBefore(el, list.children[at] ?? null);
  }
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

function syncPins(entries) {
  const shown = new Set(pinnable(entries).map((rare) => rare.id));
  for (const [id, pin] of pins) {
    if (!shown.has(id)) {
      dropPin(id, pin);
    }
  }
  for (const id of shown) {
    if (!pins.has(id)) {
      pins.set(id, createPin(byTemplate.get(id)));
    }
  }
}

function paint(entries) {
  for (const [at, rare] of entries.entries()) {
    const bar = rows.get(rare.id);
    bar.update({
      fraction: fillOf(rare),
      value: figure(rare),
      detail: detailOf(rare),
      tone: toneFor(rare),
    });
    place(bar.el, at);
  }
  for (const [id, pin] of pins) {
    const rare = byTemplate.get(id);
    pin.tile.update({ fraction: fillOf(rare), value: figure(rare), tone: toneFor(rare) });
  }
}

/** Bring the rows and the pins in line with what should be shown, and draw them. */
function sync(entries) {
  const shown = new Set(entries.map((rare) => rare.id));
  for (const [id, bar] of rows) {
    if (!shown.has(id)) {
      bar.destroy();
      rows.delete(id);
    }
  }
  for (const rare of entries) {
    if (!rows.has(rare.id)) {
      rows.set(rare.id, createRow(rare));
    }
  }
  syncPins(entries);
  paint(entries);
}

/**
 * Draw the panel, or take the pins out of the world when it is not up. The pins are
 * anchors the loader holds over the world rather than children of the frame, so hiding
 * the frame does not hide them and nothing else would.
 */
function redraw() {
  if (frame.visible) {
    sync(wanted());
  } else if (pins.size > 0) {
    clearPins();
  }
}

/**
 * Write the stamps down, once the character they belong to is known.
 *
 * A per-character write rejects before world entry, because its value was decided when it
 * was called: held instead, it would store something computed before anyone knew whose it
 * was against whichever character the player then picked. Nothing here can produce a
 * stamp before world entry anyway, so the await is a guard rather than a delay.
 *
 * The entity id is left out: it is this session's id for the thing standing there.
 */
async function save() {
  if (!keepsTimers()) {
    return;
  }
  await woc.world.ready;
  const pairs = [];
  for (const [id, row] of watch) {
    if (row.seenAt !== null || row.killedAt !== null) {
      pairs.push([id, { seenAt: row.seenAt, killedAt: row.killedAt }]);
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
 * Take one stored record back, and only over a rare nothing has been learned about. A
 * per-character read waits for the character, so it settles at world entry, which is when
 * a death event could already have landed. What this session observed is newer than
 * anything on disk, so the restore fills gaps and never overwrites one.
 */
function reclaim(id, record) {
  const row = watch.get(id);
  if (row === undefined || row.seenAt !== null || row.killedAt !== null) {
    return;
  }
  if (typeof record !== 'object' || record === null) {
    return;
  }
  row.seenAt = stampOf(record.seenAt);
  row.killedAt = stampOf(record.killedAt);
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
  if (firstRoster || !settingFlag('alert', true)) {
    return;
  }
  woc.ui.banner(`${rare.name} is up`, { kind: 'info', detail: zoneName(rare.zone) });
  woc.sound.play(SIGHTING_CUE);
}

/**
 * A rare is standing in interest scope. The kill stamp is cleared, because whatever the
 * arithmetic said, the rare is demonstrably there.
 */
function arrived(entity, rare) {
  const row = watch.get(rare.id);
  row.seenAt = woc.wallClock();
  if (row.entityId === entity.id) {
    return;
  }
  row.entityId = entity.id;
  row.killedAt = null;
  announce(rare);
  persist();
}

/**
 * Walk interest scope for anything on the roster. A corpse is skipped: an entity that has
 * died stays in the roster for a while and is not a rare that is up. The kill itself is
 * heard on the death event, which is what stamps the moment.
 */
function scan() {
  const present = new Set();
  const { entities } = woc.world;
  for (const entity of entities.values()) {
    const rare = byTemplate.get(entity.templateId);
    if (rare !== undefined && entity.dead !== true) {
      present.add(rare.id);
      arrived(entity, rare);
    }
  }
  for (const [id, row] of watch) {
    if (row.entityId !== null && !present.has(id)) {
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

// The set of things in interest scope changes here, which is the only signal a rare
// walking into range produces. The countdowns move on the timer below.
woc.world.on('entities', scan);

// The one event that starts a countdown. The record carries an entity id and nothing
// else identifying, so the template is read off the entity while the corpse is still in
// the roster, which it is at the moment the event lands.
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
  persist();
  redraw();
});

/**
 * The player has become somebody else without the page reloading.
 *
 * The game clones and removes its HUD on a character switch rather than reloading, so
 * nothing an addon can see forces it to start again. Everything in `watch` belongs to
 * whoever was playing a moment ago: left in place it would draw the previous character's
 * countdowns, and the next kill would write that character's stamps back out under this
 * one's key, which is the only failure here that outlives the session.
 *
 * `firstRoster` goes back up with it, since everything already in the new character's
 * interest scope arrives in one walk they did not ride up to.
 *
 * Not yet verified against a real switch. No suite reproduces the game cloning and
 * removing its HUD, so the tests behind this drive `world.characterKey` by renaming the
 * player and prove only that a change of key clears what memory held. A live session
 * still has to confirm that a switch moves that key once rather than through an
 * intermediate reading with no character in it.
 */
woc.world.on('characterKey', () => {
  for (const row of watch.values()) {
    row.seenAt = null;
    row.killedAt = null;
    row.entityId = null;
  }
  firstRoster = true;
  load();
  redraw();
});

// Once a second. Every figure on this panel moves at most once a second: a countdown is
// written in whole seconds, a fill over a six hour respawn moves a pixel a minute, and
// the pins position themselves, since `ui.anchor3d` rides the loader's own frame loop.
// What it costs is up to a second of lag on the zone filter following the player over a
// border, and on the pins leaving the world when the panel does; the keybind below
// answers the second one on the path a player takes most.
woc.setInterval(redraw, MS_PER_SECOND);

woc.keys.bind('toggle', () => {
  frame.toggle();
  // Now, rather than up to a second from now: somebody who just hid the panel should not
  // watch its pins hang over the world waiting for the next tick.
  redraw();
});

woc.onSettingsChange(() => {
  // A filter or a sort change is answered by the next draw. Turning the countdowns back
  // on part-way through a session is not, so the read is offered again: it fills only
  // what is still blank, so it cannot undo anything this session has learned.
  load();
  redraw();
});

/**
 * Read the roster in, then do the two things that needed one: the stored stamps are
 * reclaimed onto rows that exist, and the first walk of interest scope happens with
 * something to match against. Both are no-ops before the roster lands, which is what makes
 * it safe for every handler above to be wired first, and that order matters: subscribing
 * after an await would miss whatever arrived during it.
 *
 * `load()` rather than `await restore()`, since a per-character read waits for the
 * character and would hold the first draw on the landing page until somebody logged in.
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
