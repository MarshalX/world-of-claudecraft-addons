/// <reference types="@woc-addons/types" />

// Foretell: a bar for every cast in the fight, including the ones nothing announces.
//
// The reason this addon exists is one gap. `net.onEvent('castStart')` fires for a
// player cast, a pet, gathering and fishing, and for NOTHING else: a mob's mechanic
// assigns its cast state directly on the entity, so a display built on the event is
// silent for every mob in the game and cannot tell that from a boss that never casts.
// `world.casts` is built from that entity state instead, which is why it is the only
// source read here and why the "done when" for this addon is a scripted boss cast
// drawing a bar.
//
// The map is rebuilt on every read from live entity fields, so there is nothing to
// hold: `castsNow` reads it again rather than keeping the one the last handler was
// handed, which would be the cast that was running last frame.
//
// The split is the one the whole project is written to. `world.on('casts')` reports a
// cast STARTING, ending, or being replaced, and deliberately says nothing as the bar
// moves; the numbers come from a frame handler that reads the map again. So the
// subscription decides which rows exist and the frame decides how full each one is.
// That handler is `woc.onFrame`, the loader's ONE loop, rather than a
// `requestAnimationFrame` of this addon's own, and it returns immediately while
// nothing is up, because reading the map walks every entity in interest scope. The
// loader positions every anchor AFTER the handler, so a bar this file moves is
// followed in the same frame rather than one behind the camera.
//
// `EntityCast.ability` is an ID, unlike the display NAME a damage record carries.
// `world.abilities` turns one into the other for your own kit and for nothing else, so
// anything else falls back to a title-cased id: `shadow_bolt` reads as "Shadow Bolt"
// where the game itself calls it "Gloom Bolt", which is the divergence this fallback
// gets wrong and is still better than showing the raw id.
//
// A NAME WORKED OUT THAT WAY ENDS IN A QUESTION MARK, because a hedge the player can
// see beats a claim they have to learn not to trust. It is on the label rather than in
// a footnote under the list, and that is the whole of what this display says about its
// own limits: a standing sentence of caveat is chrome on an overlay whose bare density
// exists to have none, it is read once and then never again, and it cannot follow a bar
// into the anchored layout, where there is no panel to put it under and no pointer
// events to hover. The mark goes wherever the row goes. The row's own tooltip carries
// the long version in the list, for the player who hovers it to find out.
//
// THE SCHOOL IS OFTEN UNKNOWN AND IS LEFT UNKNOWN. `ui.bar` tints a fill by school
// from the game's own palette, and an `EntityCast` carries no school at all. The only
// place to recover one is your spellbook, which covers your own kit, so a mob's cast
// passes null and is drawn untinted. Guessing from the ability id would put a colour
// on a row that claims a damage type nothing said. That is the same row the mark is
// already on, which is why it needs no second caveat of its own: the plain fill and the
// question mark have one cause between them.
//
// Two layouts, and the setting picks between them. The list is a borderless column
// sorted by time remaining, which is what a raid frame is read as: the next thing to
// land is at the top. The anchored layout puts the same bar over the caster's head
// through `ui.anchor3d`, which is worth having when WHO is casting matters more than
// the order, and drops the caster's name from the row because the bar is already
// floating over them.
//
// THE LIST IS RESIZABLE, AND ITS HEIGHT IS THE ROW BUDGET. Both halves of that are
// load-bearing and neither works alone: a bare frame with no `resizable` has no handles
// to grab, and a resizable one with no floor can be dragged under what it draws, which
// since the loader's bare body CLIPS rather than scrolls means a bar disappearing
// rather than a scrollbar appearing.
//
// The height is ROOM rather than a size, which is the one place this differs from the
// tile strips: a square's size can be solved back out of a strip's height because the
// squares are what the strip is made of, and a cast bar's height is its text. So the
// box says how many bars fit and `rowCap` counts them, which turns a drag into the
// answer the clipping rule names ("fewer rows, or smaller ones") instead of leaving
// the bottom bar half drawn. It cannot be solved the OTHER way, by dividing the height
// between the rows that are up: this list gains and loses rows every few seconds, so
// every bar would change height whenever anything started or stopped casting, which is
// exactly when they are being read.
//
// The floor is ONE bar, never the current row count. A frame's bounds are stated when
// it is created and cannot be restated, so a floor at what is on screen now would leave
// a player who watched five casts this pull unable to shrink the display for the next
// one.
//
// An anchored bar is placed by UNIT rather than by a point plus a guessed lift. The
// loader's 'head' point is read off the renderer's own view of that unit, model height
// and mount and applied scale included, so a bar over a boar and a bar over a dragon
// each clear the model. Nothing on the wire carries a model height, so a fixed pixel
// offset is right for one creature size and wrong for every other. It also hides itself
// for a unit the game is not drawing, which is where the game draws no nameplate
// either.
//
// Two anchored bars over two casters standing together would land on top of each
// other, and `ui.project` is what sorts that out without measuring anything: it gives
// a screen position and a DEPTH for a point, with no element and no layout. The
// nearest caster keeps its true place and anything colliding with it is LIFTED clear.
// Deliberately not hidden, which is the other way to declutter: this addon exists to
// show casts nothing else announces, so dropping one to tidy the screen would throw
// away the thing it is for. A lifted bar is no longer over its caster, so it takes the
// caster's name back as a second line and stops claiming to be positional.
//
// The anchored layout is the one that can say the least: an anchor is
// `pointer-events: none`, so no row tooltip is reachable there. Everything a row has to
// hedge is therefore drawn INTO it, and the question mark on a worked-out name is the
// whole of that.

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
 * What one NAMED bar and the gap under it occupy, in pixels.
 *
 * A bar carrying a caster's name is two lines: the head at 19 and the detail at 13,
 * inside the kit's 2px padding, which is 36, and the column sets 3 between rows. Both
 * things that measure in this are measuring a bar with a name under it, which is why
 * it is one constant: how much of the list's height one row takes, where every row is
 * named, and how far one step of the anchored declutter lifts a bar, where the bar
 * being lifted takes its caster's name back on the way and so grows the second line
 * exactly as it moves.
 *
 * A constant rather than a measurement on purpose: `offsetHeight` on a row is a
 * synchronous layout, and paying for one per row per frame is exactly the cost
 * `ui.project` exists to avoid, and it is the same cost a resize would pay on every
 * pointer move. The price of that is that a wrong figure here is silent in both
 * directions: too small and the loader's bare body clips the bottom row off the list,
 * too large and every lifted bar floats further from its caster than it has to.
 */
const ROW_PITCH = 39;
/** How many steps a bar may be lifted before it is left where it belongs. */
const MAX_LIFT_STEPS = 4;
/** What a worked-out ability name is marked with. See the header. */
const GUESS_MARK = '?';
/**
 * The narrowest the list may be dragged.
 *
 * The addon's own floor rather than the loader's, which keeps a structural one
 * underneath it so a frame always has something left to grab. This one is about
 * READING a row: the countdown on the right never shrinks and the ability name is the
 * only part that can, so under roughly this every row is a timer with nothing left to
 * say which mechanic it is counting.
 */
const MIN_FRAME_WIDTH = 120;

/** Entity id to the row drawing its cast: the kit widget, its anchor, its ability. */
const rows = new Map();

/**
 * The column, which outlives the frame.
 *
 * A layout change rebuilds the frame, and keeping the list means the rebuild is one
 * append rather than a re-creation of everything inside it.
 */
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

/** What that many rows measure, which is the whole of the list's height. */
function listHeight(count) {
  return count * ROW_PITCH;
}

/**
 * The height the loader last gave the frame.
 *
 * Held rather than measured, which is what `onMove` is for: the loader owns the box,
 * writes it on a drag, on a viewport change and on a restore, and reading it back off
 * the element would force a synchronous layout on every pointer move of a display that
 * already writes styles every frame. It is seeded with the opening height because
 * `onMove` deliberately does not fire for the initial placement.
 */
let boxHeight = 0;

/**
 * The overlay, or null when the bars are anchored in the world.
 *
 * BARE, because the rows are the display and nothing is casting most of the time. At
 * any chromed density the empty state is a small titled box parked on the HUD saying
 * nothing, and that state is what a session mostly looks at. With no panel, no padding
 * and no title bar an empty display is nothing at all on screen, and a busy one is the
 * bars and nothing else, which is everything it had to say anyway.
 *
 * The trade is the one every bare overlay makes and the loader already answers: a
 * frame with no rows has no pixels, so there is nothing to drag. The unlock mode
 * outlines every frame, empty ones included, and that is where this is positioned.
 *
 * `closable` goes with the title bar that would have held the button, so the ways
 * back are the toggle keybind and the rail menu's frame list. The title stays even
 * though nothing draws it: it is the frame's accessible name and what that menu row
 * is called, and those are the only two things naming it.
 *
 * It is RESIZABLE and it states BOTH size bounds, and the pair is one decision rather
 * than two. A bare frame with no `resizable` has no handles at all; a resizable one
 * that states no bounds takes the size it opened at as its floor and can never be
 * dragged smaller than its first paint, and since the bare body clips rather than
 * scrolls, a frame dragged under what it draws loses a bar rather than gaining a
 * scrollbar.
 *
 * It opens at room for the row budget the player has set, so out of the box the space
 * reserved is exactly the space the display will use and nothing is capped by a box
 * nobody chose. The floor is ONE row: bounds cannot be restated after the frame is
 * built, so flooring at the current row count would leave a player who watched five
 * casts unable to shrink the display for the next pull.
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
  // The opening height, which `onMove` deliberately does not report: it is the size
  // the addon asked for and therefore already holds. A restored box overwrites it
  // through that callback a moment later.
  boxHeight = listHeight(barBudget());
  built.body.append(list);
  return built;
}

let frame = buildFrame();

/**
 * Whether the anchored layout is showing. In-session only.
 *
 * A frame remembers its own visibility per character; a set of anchors has no frame
 * to remember it in, and per-character storage cannot be written before world entry.
 * So the anchored layout comes back up on every reload, which is the honest state for
 * a display whose whole content is transient anyway.
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
 * One lookup answering all three, because they have one source: `world.abilities` is
 * the only bridge from an ability id to anything the game says about it, and it covers
 * YOUR kit. So a friendly caster using something you also know is named and tinted
 * properly, and every mob mechanic, which is most of what this addon draws, comes back
 * marked as a guess with no school at all.
 *
 * The mark is ON THE LABEL, which is why this is the only place a row's name is built.
 * A hedge the player can see beats a claim they have to learn not to trust, and it is
 * the one form of that which survives the anchored layout, where an anchor takes no
 * pointer events and there is nothing to hover.
 */
function describe(abilityId) {
  const known = woc.world.abilities.byId(abilityId) ?? null;
  if (known === null) {
    return { label: `${readable(abilityId)}${GUESS_MARK}`, school: null, guessed: true };
  }
  return { label: known.name, school: known.school, guessed: false };
}

/**
 * What the mark on a row's name means, for the player who hovers it to find out.
 *
 * The long version of the hedge the label already carries, and only on a listed row:
 * an anchor takes no pointer events, so an anchored bar has nothing to hover, which is
 * exactly why the mark itself is in the label rather than in here. Nothing at all for a
 * row whose name came out of your spellbook, because that one is the game's own name
 * and needs no defending.
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
        text: `Worked out from the ability id \`${row.ability}\`. The game publishes an ability's own name only for your own spellbook, so this is a guess and is wrong wherever the two have diverged.`,
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
 * Skill art for the ability, or null.
 *
 * The game files art under a CLASS, and `templateId` is the class only on a player: on
 * a mob it is the mob template, so building a URL from one would ask for a file that
 * cannot exist. A missing icon is a hidden slot; a wrong one is a request per row.
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
 * Whether this cast is one the player asked to see.
 *
 * The length is measured against the cast's TOTAL rather than what is left, or every
 * bar would drop off the display in its final second, which is the second the whole
 * display exists for.
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
 * How many bars there is room for, which is the setting held inside the box.
 *
 * The anchored layout has no frame and therefore no box, so there the budget is the
 * whole answer: an anchor is placed over its own caster and takes no room from any
 * other.
 *
 * Dropping the surplus rather than letting it clip is what makes the drag a control
 * instead of a way to break the display, and the order is what makes it safe: rows are
 * sorted soonest-to-land first, so what a shorter box gives up is always the cast with
 * the most time left on it.
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
 * One cast bar, wherever the layout puts it.
 *
 * The anchor is given the UNIT rather than a point. `over: 'head'` is the point the
 * game's own nameplate uses, off the renderer's view of that model, and it is not a
 * number an addon can arrive at: nothing on the wire carries a model height, so a
 * fixed lift is right for one creature size and wrong for every other.
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
 * Name the row, and only when the ability it is drawing changed.
 *
 * A caster that finishes one mechanic and starts another keeps its row, so the label,
 * the art and the school have to follow it rather than being written once. The kit
 * drops a write that repeats what a slot already holds, so doing this every frame
 * would not reach the DOM; what it would cost is a spellbook lookup and a URL built
 * per row per frame to arrive at the string that is already there.
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
 * Danger in the last second and nothing before it.
 *
 * Tone WINS over school in the kit, so a warn step earlier would take the school
 * colour off most of every bar. It is spent where urgency is worth more than the
 * school, which is the moment the cast lands.
 */
function toneFor(remaining) {
  if (remaining <= IMPACT_SECONDS) {
    return 'danger';
  }
  return 'default';
}

/**
 * Where the cast has got to.
 *
 * The kit's fraction is how much is LEFT, so the fill drains toward the moment of
 * impact rather than filling up to it, and a channel drains too, which is what a
 * channel does.
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

/** Bring the rows in line with what is being cast, and draw them. */
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
 * Where every anchored bar is on screen, nearest caster first.
 *
 * The same point the anchor itself is placed from, so the two cannot disagree about
 * where a bar is. A null is left out rather than defaulted: the loader has already
 * hidden that anchor, so there is nothing on screen to move out of anything's way.
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
 * The first lift at which this bar clears everything already placed, in pixels.
 *
 * Zero when nothing clears it. A bar that cannot be fitted is left where it belongs
 * rather than pushed off the top of the screen: two bars sharing a place is a display
 * a player can still read, and a bar floating over nothing is one they cannot.
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

/** The shift itself, which is nothing at all for the bar that kept its place. */
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
 * Lift the bar, and say whose it is once it has stopped being over them.
 *
 * The transform is on the BAR rather than on the anchor: the anchor's own transform is
 * the loader's, it is what centres the element on the point, and writing over it would
 * move every bar half its width.
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
 * Take the anchored bars off each other.
 *
 * Nearest first, so the caster in your face keeps the place it earned and the ones
 * behind it move. Depth is what makes that ordering possible at all: it is a real
 * distance from the camera, so it survives a camera the player is swinging, which
 * sorting by screen y would not.
 */
function stack(entries) {
  const taken = [];
  for (const { row, entry, at } of onScreen(entries)) {
    const lift = liftFor(at, taken);
    taken.push({ x: at.x, y: at.y - lift });
    setLift(row, entry, lift);
  }
}

// The set of casts changes here; the numbers move in the frame handler below.
// Sampling the map every frame instead would walk every entity in interest scope to
// find out that nobody started casting.
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
 * Throw the rows away and build the layout again.
 *
 * A row's SHAPE is decided when it is built: an anchored bar lives in an anchor the
 * loader positions and a listed one lives in the column, and neither can become the
 * other. Everything else a settings change can move is answered by the next draw.
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
