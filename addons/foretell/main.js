/// <reference types="@woc-addons/types" />

// Foretell: a bar for every cast in the fight, including the ones nothing announces.
//
// `net.onEvent('castStart')` fires for a player's cast, a pet's cast and the timed
// activities the game runs through the same cast machinery, and for no mob at all: a
// mob's mechanic assigns its cast state directly on the entity, so an event-driven
// display is silent for every mob in the game and cannot tell that from a boss that
// never casts. `world.casts` is built from that entity state instead, and is the only
// source read here.
//
// The map is rebuilt on every read from live entity fields, so there is nothing to hold:
// `castsNow` reads it again rather than keeping the one the last handler was handed.
//
// `world.on('casts')` reports a cast starting, ending or being replaced and says nothing
// as the bar moves, so the subscription decides which rows exist and a frame handler
// decides how full each one is. That handler is `woc.onFrame` and it returns immediately
// while nothing is up, since reading the map walks every entity in interest scope. The
// loader positions anchors after the handler, so a bar this file moves is followed in
// the same frame rather than one behind the camera.
//
// `EntityCast.ability` is an id rather than the display name a damage record carries, or
// it is an activity sentinel: a fixed marker naming what the unit is DOING rather than
// any ability, from a set that grows with the game, so a nearby player crafting or
// fishing gets a bar as well. `world.abilities` turns an id into a name for your own kit
// only and a sentinel resolves there for nobody, so anything else falls back to a
// title-cased id and is marked with a question mark. A bar over a crafter is the honest
// answer rather than a gap to filter: the unit is casting, and an exclusion list of
// sentinels would need editing every time the game adds one. The mark is on the label
// rather than in a footnote, because it has to survive the anchored layout, where an
// anchor takes no pointer events and there is nothing to hover. The row's tooltip carries
// the long version in the list.
//
// The school is usually unknown and is left unknown. An `EntityCast` carries none and
// the only place to recover one is your spellbook, so a mob's cast is drawn untinted
// rather than tinted from a guess about its damage type.
//
// Two layouts, picked by a setting. The list is a borderless column sorted by time
// remaining, so the next thing to land is at the top. The anchored layout puts the same
// bar over the caster's head through `ui.anchor3d`, which is worth having when who is
// casting matters more than the order, and drops the caster's name from the row.
//
// The list is resizable and its height is the row budget. A bare frame with no
// `resizable` has no handles to grab, and a resizable one with no floor can be dragged
// under what it draws, which with a clipping body loses a bar rather than gaining a
// scrollbar. The height is room rather than a size, so the box says how many bars fit
// and `rowCap` counts them; dividing the height between the rows that are up instead
// would change every bar's height whenever anything started or stopped casting. The
// floor is one bar, never the current row count, since bounds cannot be restated after
// the frame is built.
//
// An anchored bar is placed by unit rather than by a point plus a guessed lift. The
// loader's 'head' point is read off the renderer's own view of that unit, model height
// and mount and scale included, so a bar over a boar and a bar over a dragon each clear
// the model; nothing on the wire carries a model height. Two bars over casters standing
// together are separated with `ui.project`, which gives a screen position and a depth
// for a point with no element and no layout. The nearest caster keeps its place and
// anything colliding with it is lifted clear rather than hidden, since dropping a cast
// to tidy the screen would throw away what this addon is for. A lifted bar takes the
// caster's name back as a second line and stops claiming to be positional.

const DECIMALS = 1;
const FRAME_WIDTH = 240;
const DEFAULT_MAX_BARS = 5;
/** Show every cast by default: the shortest one is usually the one that matters. */
const DEFAULT_MIN_CAST = 0;
/** Under this much left the row goes danger: the mechanic is landing now. */
const IMPACT_SECONDS = 1;
/** An anchored bar has no column to be sized by, so it carries its own width. */
const ANCHOR_WIDTH = 180;
/**
 * What one named bar and the gap under it occupy, in pixels.
 *
 * A bar carrying a caster's name is two lines: the head at 19 and the detail at 13,
 * inside the kit's 2px padding, which is 36, and the column sets 3 between rows. It is
 * one constant because both things measured against it are measuring a named bar: how
 * much of the list's height one row takes, and how far one step of the anchored
 * declutter lifts a bar, where the lifted bar takes its caster's name back on the way.
 *
 * A constant rather than a measurement, since `offsetHeight` per row per frame is a
 * synchronous layout, which is the cost `ui.project` exists to avoid. A wrong figure is
 * silent in both directions: too small clips the bottom row, too large floats every
 * lifted bar further from its caster than it has to be.
 */
const ROW_PITCH = 39;
/** How many steps a bar may be lifted before it is left where it belongs. */
const MAX_LIFT_STEPS = 4;
/** What a worked-out ability name is marked with. See the header. */
const GUESS_MARK = '?';
/**
 * The narrowest the list may be dragged. The addon's own floor, above the loader's
 * structural one, and it is about reading a row: the countdown on the right never
 * shrinks and the ability name is the only part that can.
 */
const MIN_FRAME_WIDTH = 120;

/** Entity id to the row drawing its cast: the kit widget, its anchor, its ability. */
const rows = new Map();

/** The column, which outlives the frame, so a layout change is one append. */
const list = document.createElement('div');
list.className = 'woc-ft-list';
list.style.display = 'flex';
list.style.flexDirection = 'column';
list.style.gap = '3px';

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

/** Whether the bars float over the casters. Anything unrecognised is the list. */
function drawsAnchors() {
  return woc.settings.layout === 'anchors';
}

/** The most bars the player asked for, which is the ceiling the box works under. */
function barBudget() {
  return Math.max(settingNumber('max-bars', DEFAULT_MAX_BARS), 1);
}

function listHeight(count) {
  return count * ROW_PITCH;
}

/**
 * The height the loader last gave the frame. Held rather than measured, which is what
 * `onMove` is for: reading it back off the element would force a synchronous layout on
 * every pointer move. Seeded with the opening height, since `onMove` deliberately does
 * not fire for the initial placement.
 */
let boxHeight = 0;

/**
 * The overlay, or null when the bars are anchored in the world.
 *
 * Bare, because the rows are the display and nothing is casting most of the time. At any
 * chromed density the empty state is a small titled box parked on the HUD saying
 * nothing, and that state is what a session mostly looks at. The trade is that an empty
 * frame has no pixels to drag, which is what the loader's unlock mode answers.
 *
 * `closable` goes with the title bar that would have held the button, so the ways back
 * are the toggle keybind and the rail menu's frame list. The title stays as the frame's
 * accessible name and the label that menu row carries.
 *
 * Resizable, with both bounds stated: a bare frame with no `resizable` has no handles,
 * and one that states no bounds takes the size it opened at as its floor. It opens at
 * room for the row budget the player has set. The floor is one row, since bounds cannot
 * be restated after the frame is built.
 */
function buildFrame() {
  if (drawsAnchors()) {
    return null;
  }
  const built = woc.ui.frame({
    id: 'casts',
    title: 'Casts',
    width: FRAME_WIDTH,
    height: listHeight(barBudget()),
    density: 'bare',
    save: true,
    resizable: true,
    minWidth: MIN_FRAME_WIDTH,
    minHeight: listHeight(1),
    onMove: (box) => {
      boxHeight = box.h;
    },
  });
  // The opening height, which `onMove` deliberately does not report. A restored box
  // overwrites it through that callback a moment later.
  boxHeight = listHeight(barBudget());
  built.body.append(list);
  return built;
}

let frame = buildFrame();

/**
 * Whether the anchored layout is showing. In-session only: a frame remembers its own
 * visibility per character, a set of anchors has no frame to remember it in, and
 * per-character storage cannot be written before world entry.
 */
let anchorsShown = true;

function visible() {
  if (frame === null) {
    return anchorsShown;
  }
  return frame.visible;
}

/** 'shadow_bolt' reads as 'Shadow Bolt'. Unmarked: `describe` adds the hedge. */
function readable(abilityId) {
  return abilityId
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * What to call this ability, what to tint it, and whether both were worked out.
 *
 * One lookup answering all three, since they have one source: `world.abilities` covers
 * your own kit, so a friendly caster using something you also know is named and tinted
 * properly, and every mob mechanic comes back marked as a guess with no school. The mark
 * is on the label, which is why this is the only place a row's name is built: it is the
 * one form of hedge that survives the anchored layout.
 */
function describe(abilityId) {
  const known = woc.world.abilities.byId(abilityId) ?? null;
  if (known === null) {
    return { label: `${readable(abilityId)}${GUESS_MARK}`, school: null, guessed: true };
  }
  return { label: known.name, school: known.school, guessed: false };
}

/**
 * The long version of the hedge the label already carries, and only on a listed row: an
 * anchor takes no pointer events, so an anchored bar has nothing to hover. Nothing at
 * all for a name that came out of your spellbook.
 */
function guessLines(id) {
  const row = rows.get(id);
  if (row === undefined || !row.guessed) {
    return '';
  }
  return {
    title: `${readable(row.ability)}${GUESS_MARK}`,
    lines: [
      {
        text: `Worked out from the cast id \`${row.ability}\`. The game publishes an ability's own name only for your own spellbook, and a cast that names an activity such as crafting or fishing names no ability at all, so this is a guess and is wrong wherever a name has moved away from its id.`,
        tone: 'muted',
      },
      {
        text: 'Untinted for the same reason: nothing on the wire says what school a cast is, so no colour here claims one.',
        tone: 'muted',
      },
    ],
  };
}

/**
 * Skill art for the ability, or null. The game files art under a class, and `templateId`
 * is the class only on a player: on a mob it is the mob template, so a URL built from
 * one would ask for a file that cannot exist.
 */
function iconFor(entity, abilityId) {
  if (entity.kind !== 'player') {
    return null;
  }
  return woc.ui.icon.ability(abilityId, entity.templateId);
}

/** Your own cast bar is the game's to draw, and it already draws it. */
function isSelf(entity) {
  return entity.id === woc.world.player?.id;
}

/** A friendly caster counts only when the player asked for them. */
function inScope(entity) {
  if (entity.hostile) {
    return true;
  }
  return settingFlag('friendly', false);
}

/**
 * Whether this cast is one the player asked to see. The length is measured against the
 * cast's total rather than what is left, or every bar would drop off the display in its
 * final second, which is the second the display exists for.
 */
function wanted(entity, cast) {
  if (isSelf(entity)) {
    return false;
  }
  if (!inScope(entity)) {
    return false;
  }
  if (cast.channeling && !settingFlag('channels', true)) {
    return false;
  }
  return cast.total >= settingNumber('min-cast', DEFAULT_MIN_CAST);
}

/**
 * How many bars there is room for, which is the setting held inside the box. The
 * anchored layout has no frame and therefore no box, so there the budget is the whole
 * answer. Dropping the surplus rather than letting it clip is what makes the drag a
 * control, and the order is what makes it safe: rows are sorted soonest-to-land first,
 * so what a shorter box gives up is the cast with the most time left on it.
 */
function rowCap() {
  const budget = barBudget();
  if (frame === null) {
    return budget;
  }
  const fits = Math.floor(boxHeight / ROW_PITCH);
  return Math.max(Math.min(budget, fits), 1);
}

/** Every cast worth a bar right now, soonest to land first. */
function castsNow() {
  const { entities } = woc.world;
  const found = [];
  for (const [id, cast] of woc.world.casts) {
    const entity = entities.get(id);
    if (entity !== undefined && wanted(entity, cast)) {
      found.push({ id, cast, entity });
    }
  }
  found.sort((a, b) => a.cast.remaining - b.cast.remaining);
  return found.slice(0, rowCap());
}

/**
 * One cast bar, wherever the layout puts it. The anchor is given the unit rather than a
 * point: `over: 'head'` is the point the game's own nameplate uses, off the renderer's
 * view of that model, and a fixed lift would be right for one creature size only.
 */
function createRow(entry) {
  const bar = woc.ui.bar({ className: 'woc-ft-bar' });
  bar.el.dataset.caster = String(entry.id);
  const row = { bar, anchor: null, ability: '', guessed: false, lift: 0 };
  if (drawsAnchors()) {
    row.anchor = woc.ui.anchor3d({ unit: entry.id, over: 'head' }, { className: 'woc-ft-anchor' });
    row.anchor.el.style.width = `${ANCHOR_WIDTH}px`;
    row.anchor.el.appendChild(bar.el);
  } else {
    woc.ui.tooltip(bar.el, () => guessLines(entry.id));
  }
  return row;
}

function dropRow(id, row) {
  row.bar.destroy();
  row.anchor?.destroy();
  rows.delete(id);
}

function clearRows() {
  for (const [id, row] of rows) {
    dropRow(id, row);
  }
}

/**
 * Name the row, and only when the ability it is drawing changed. A caster that finishes
 * one mechanic and starts another keeps its row, so the label, the art and the school
 * have to follow it. The kit drops a write that repeats what a slot already holds, so
 * doing this every frame would cost a spellbook lookup and a URL per row per frame to
 * arrive at the string already there.
 */
function name(row, entry) {
  if (row.ability === entry.cast.ability) {
    return;
  }
  row.ability = entry.cast.ability;
  const known = describe(entry.cast.ability);
  row.guessed = known.guessed;
  const next = {
    label: known.label,
    icon: iconFor(entry.entity, entry.cast.ability),
    school: known.school,
  };
  // An anchored bar is already over whoever is casting, so the name is a second line
  // saying what the player can see. A LIFTED one is not, and takes it back.
  if (row.anchor === null) {
    next.detail = entry.entity.name;
  }
  row.bar.update(next);
}

/**
 * Danger in the last second and nothing before it. Tone wins over school in the kit, so
 * a warn step earlier would take the school colour off most of every bar.
 */
function toneFor(remaining) {
  if (remaining <= IMPACT_SECONDS) {
    return 'danger';
  }
  return 'default';
}

/**
 * Where the cast has got to. The kit's fraction is how much is left, so the fill drains
 * toward the moment of impact rather than filling up to it.
 */
function paint(row, cast) {
  row.bar.update({
    fraction: cast.remaining / cast.total,
    value: `${cast.remaining.toFixed(DECIMALS)}s`,
    tone: toneFor(cast.remaining),
  });
}

/** Put a row at its position, and only when it is not already there. */
function place(el, at) {
  if (list.children[at] !== el) {
    list.insertBefore(el, list.children[at] ?? null);
  }
}

function apply(entries) {
  const casting = new Set(entries.map((entry) => entry.id));
  for (const [id, row] of rows) {
    if (!casting.has(id)) {
      dropRow(id, row);
    }
  }
  for (const [at, entry] of entries.entries()) {
    let row = rows.get(entry.id);
    if (row === undefined) {
      row = createRow(entry);
      rows.set(entry.id, row);
    }
    name(row, entry);
    paint(row, entry.cast);
    if (row.anchor === null) {
      place(row.bar.el, at);
    }
  }
}

/**
 * Where every anchored bar is on screen, nearest caster first. The same point the anchor
 * itself is placed from, so the two cannot disagree. A null is left out rather than
 * defaulted, since the loader has already hidden that anchor.
 */
function onScreen(entries) {
  const found = [];
  for (const entry of entries) {
    const row = rows.get(entry.id);
    if (row !== undefined && row.anchor !== null) {
      const at = woc.ui.project({ unit: entry.id, over: 'head' });
      if (at !== null) {
        found.push({ row, entry, at });
      }
    }
  }
  found.sort((a, b) => a.at.depth - b.at.depth);
  return found;
}

/** Whether two bars of this width and pitch would be drawn over each other. */
function collides(a, b) {
  return Math.abs(a.x - b.x) < ANCHOR_WIDTH && Math.abs(a.y - b.y) < ROW_PITCH;
}

/**
 * The first lift at which this bar clears everything already placed, in pixels, or zero
 * when nothing clears it. A bar that cannot be fitted is left where it belongs rather
 * than pushed off the top of the screen.
 */
function liftFor(at, taken) {
  for (let step = 0; step <= MAX_LIFT_STEPS; step += 1) {
    const lift = step * ROW_PITCH;
    const box = { x: at.x, y: at.y - lift };
    if (!taken.some((one) => collides(one, box))) {
      return lift;
    }
  }
  return 0;
}

function liftStyle(lift) {
  if (lift === 0) {
    return '';
  }
  return `translateY(${String(-lift)}px)`;
}

/** A bar over its caster needs no name. One that has moved off them does. */
function liftDetail(entry, lift) {
  if (lift === 0) {
    return '';
  }
  return entry.entity.name;
}

/**
 * Lift the bar, and say whose it is once it has stopped being over them. The transform
 * is on the bar rather than on the anchor: the anchor's own transform is the loader's
 * and is what centres the element on the point.
 */
function setLift(row, entry, lift) {
  if (row.lift === lift) {
    return;
  }
  row.lift = lift;
  row.bar.el.style.transform = liftStyle(lift);
  row.bar.update({ detail: liftDetail(entry, lift) });
}

/**
 * Take the anchored bars off each other, nearest first, so the caster in your face keeps
 * the place it earned. Depth is what makes that ordering possible: it is a real distance
 * from the camera, so it survives a camera the player is swinging.
 */
function stack(entries) {
  const taken = [];
  for (const { row, entry, at } of onScreen(entries)) {
    const lift = liftFor(at, taken);
    taken.push({ x: at.x, y: at.y - lift });
    setLift(row, entry, lift);
  }
}

// The set of casts changes here; the numbers move in the frame handler below. Sampling
// the map every frame would walk every entity in interest scope to find out nothing.
woc.world.on('casts', () => {
  if (visible()) {
    apply(castsNow());
  }
});

/** Redraw while anything is casting, and do nothing at all when nothing is. */
let wasVisible = false;

woc.onFrame(() => {
  const shown = visible();
  const appeared = shown && !wasVisible;
  wasVisible = shown;
  if (!shown) {
    // A hidden display holds no rows, which is what takes the anchors out of the
    // world: they are not inside a frame and nothing else would hide them.
    clearRows();
    return;
  }
  if (!appeared && rows.size === 0) {
    return;
  }
  const entries = castsNow();
  apply(entries);
  if (drawsAnchors()) {
    stack(entries);
  }
});

woc.keys.bind('toggle', () => {
  if (frame === null) {
    anchorsShown = !anchorsShown;
    return;
  }
  frame.toggle();
});

/**
 * Throw the rows away and build the layout again. A row's shape is decided when it is
 * built: an anchored bar lives in an anchor the loader positions and a listed one lives
 * in the column, and neither can become the other.
 */
function rebuild() {
  clearRows();
  const previous = frame;
  frame = buildFrame();
  previous?.destroy();
  // So the next frame counts as an appearance and repopulates from the world.
  wasVisible = false;
}

woc.onSettingsChange(rebuild);
