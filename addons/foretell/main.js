/// <reference types="@woc-addons/types" />

// Foretell: a bar for every cast in the fight, including the ones nothing announces.
//
// `net.onEvent('castStart')` never fires for a mob, whose mechanic assigns cast state
// directly on the entity, so `world.casts` is the only source read here. That map is
// rebuilt on every read, so `castsNow` re-reads it rather than holding one.
//
// `world.on('casts')` decides which rows EXIST and the frame handler decides how full each
// one is; the handler returns at once while nothing is up, since reading the map walks
// every entity in interest scope.
//
// `EntityCast.ability` is an ability id OR an activity sentinel naming what a unit is
// doing, from a set that grows with the game, so a crafter gets a bar too. Do not filter
// on a list of sentinels; anything `world.abilities` cannot name falls back to a
// title-cased id and carries the mark. The mark is on the LABEL rather than in a tooltip,
// because an anchor takes no pointer events and there is nothing to hover.
//
// A school is left unknown rather than guessed: an `EntityCast` carries none.
//
// Two layouts, picked by a setting: a borderless column sorted by time remaining, or the
// same bar over each caster's head. The frame's bounds cannot be restated after it is
// built, so its floor is one row and never the current row count.
//
// An anchored bar is placed by UNIT, not by a point plus a guessed lift, since only the
// renderer knows a model's height. Collisions are lifted clear rather than hidden, and a
// lifted bar takes its caster's name back because it is no longer over them.

const DECIMALS = 1;
const FRAME_WIDTH = 240;
/** Under this much left the row goes danger: the mechanic is landing now. */
const IMPACT_SECONDS = 1;
/** An anchored bar has no column to be sized by, so it carries its own width. */
const ANCHOR_WIDTH = 180;
/**
 * What one NAMED bar and the gap under it occupy: 19 and 13 inside 2px of padding, plus
 * the column's 3. One constant, because the row height and the declutter step both measure
 * a named bar. A constant rather than `offsetHeight`, which is a synchronous layout per
 * row per frame, and it fails silently either way: too small clips, too large floats.
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

/** The column, which outlives the frame, so a layout change is one append. */
const list = document.createElement('div');
list.className = 'woc-ft-list';
list.style.display = 'flex';
list.style.flexDirection = 'column';
list.style.gap = '3px';

/** Whether the bars float over the casters. Anything unrecognised is the list. */
function drawsAnchors() {
  return woc.settings.layout === 'anchors';
}

/** The most bars the player asked for, which is the ceiling the box works under. */
function barBudget() {
  return Math.max(woc.settings['max-bars'], 1);
}

function listHeight(count) {
  return count * ROW_PITCH;
}

/**
 * The height the loader last gave the frame. Held rather than measured, or every pointer
 * move costs a layout. Seeded, because `onMove` does not fire for the initial placement.
 */
let boxHeight = 0;

/**
 * The overlay, or null when the bars are anchored in the world.
 *
 * Bare, because nothing is casting most of the time and the empty state is what a session
 * mostly looks at; the cost is that an empty frame has no pixels to drag, which the unlock
 * mode answers. A bare frame has no title bar, so no close button and no `closable`: the
 * ways back are the keybind and the rail menu. Both bounds are stated because a resizable
 * frame with none takes its opening size as its floor.
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

/**
 * What to call this ability, what to tint it, and whether both were worked out.
 *
 * One lookup answering all three, since they have one source: `world.abilities` covers
 * your own kit, so a friendly caster using something you also know is named and tinted
 * properly, and every mob mechanic comes back marked as a guess with no school. The mark
 * is the addon's: `describe` reports `known: false` as a fact and leaves the presentation
 * here, since the same string also reaches an accessible name. It goes on the label, which
 * is the one form of hedge that survives the anchored layout.
 */
function describe(abilityId) {
  const found = woc.world.abilities.describe(abilityId);
  if (!found.known) {
    return { label: `${found.name}${GUESS_MARK}`, school: null, guessed: true };
  }
  return { label: found.name, school: found.school, guessed: false };
}

/**
 * The long version of the hedge the label already carries, and only on a listed row: an
 * anchor takes no pointer events, so an anchored bar has nothing to hover. Nothing at
 * all for a name that came out of your spellbook.
 */
function guessLines(id) {
  const row = bars.get(String(id));
  if (row === undefined || !row.guessed) {
    return '';
  }
  return {
    title: `${woc.fmt.titleCase(row.ability)}${GUESS_MARK}`,
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
  return woc.settings.friendly;
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
  if (cast.channeling && !woc.settings.channels) {
    return false;
  }
  return cast.total >= woc.settings['min-cast'];
}

/**
 * The setting held inside the box, or the setting alone when anchored, since that layout
 * has no frame. Dropping the surplus rather than clipping is what makes the drag a control,
 * and the soonest-first order is what makes it safe to drop from the end.
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
  const row = {
    bar,
    anchor: null,
    ability: '',
    guessed: false,
    lift: 0,
    // Read rather than captured, so one teardown covers both layouts.
    destroy: () => {
      bar.destroy();
      row.anchor?.destroy();
    },
  };
  if (drawsAnchors()) {
    row.anchor = woc.ui.anchor3d({ unit: entry.id, over: 'head' }, { className: 'woc-ft-anchor' });
    row.anchor.el.style.width = `${ANCHOR_WIDTH}px`;
    row.anchor.el.appendChild(bar.el);
  } else {
    woc.ui.tooltip(bar.el, () => guessLines(entry.id));
  }
  return row;
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

/**
 * The parent IS the layout and is fixed when the list is built, so a layout change rebuilds
 * the list. An anchored row carries its own anchor, so it is given no parent and is not ordered.
 */
function buildList() {
  const opts = {
    key: (entry) => String(entry.id),
    create: createRow,
    update: (row, entry) => {
      name(row, entry);
      paint(row, entry.cast);
    },
    element: (row) => row.bar.el,
  };
  if (!drawsAnchors()) {
    opts.parent = list;
  }
  return woc.ui.list(opts);
}

let bars = buildList();

/**
 * Where every anchored bar is on screen, nearest caster first. The same point the anchor
 * itself is placed from, so the two cannot disagree. A null is left out rather than
 * defaulted, since the loader has already hidden that anchor.
 */
function onScreen(entries) {
  const found = [];
  for (const entry of entries) {
    const row = bars.get(String(entry.id));
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
    bars.sync(castsNow());
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
    bars.clear();
    return;
  }
  if (!appeared && bars.size === 0) {
    return;
  }
  const entries = castsNow();
  bars.sync(entries);
  if (drawsAnchors()) {
    stack(entries);
  }
});

// Not `toggleKey`: the anchored layout has no frame, so the key flips a flag instead.
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
  // Destroyed rather than cleared: `parent` is fixed at build, and the layout decides it.
  bars.destroy();
  const previous = frame;
  frame = buildFrame();
  previous?.destroy();
  bars = buildList();
  // So the next frame counts as an appearance and repopulates from the world.
  wasVisible = false;
}

woc.onSettingsChange(rebuild);
