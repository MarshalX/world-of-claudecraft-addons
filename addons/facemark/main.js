/// <reference types="@woc-addons/types" />

// Facemark: the nameplate the game does not draw.
//
// One plate per unit near you: its name, its level, a health bar, a cast bar, the
// effects on it, a threat edge and its raid mark. The game draws its own plates, and
// this one carries everything after the health bar.
//
// The plate is placed over the model rather than at a height this file picked.
// `ui.anchor3d({ unit, over: 'head' })` is the point the game's own nameplate uses, and
// the loader takes it off the renderer's view of that unit: the model's height, the lift
// a mount adds, and the scale actually applied. None of the three is on the wire, so a
// fixed offset above `entity.pos` would be right for one creature size only. There is no
// offset setting and there must not be one, since its correct value is always zero.
//
// The head point resolves to nothing for a unit the game is drawing no model for, which
// is anything past roughly eighty yards, so a plate hides where the game would draw no
// nameplate. The draw distance setting caps below that rather than above it: asking for
// ninety yards would not reach further, only make the setting stop meaning anything past
// its own middle.
//
// The plates are the display, so nothing else owns their on and off state. It is this
// file's own and is stored account-wide, since it is a preference about the player
// rather than a layout belonging to one character. The keybind is the whole control, and
// turning the plates off toasts the chord that brings them back, because a world overlay
// that has just gone leaves nothing on screen to find again.
//
// Four things a plate cannot say, all limits of the wire or of the client:
//
//  - An effect a mob applied has no icon anywhere. Every aura icon in the game is
//    composited on a canvas at run time from a bundled table and no aura art is served.
//    A player's is recoverable: the applying ability id is the aura's own id and the
//    caster's class is on their entity, so `ui.icon.ability(aura.id, caster.templateId)`
//    resolves. A control aura is the same ability with a tail on the id (`_slow`,
//    `_stun`, `_root`: see `AURA_SUFFIXES`), so the tail comes off and those resolve
//    too. Everything else gets its school colour and a countdown.
//  - A cast bar cannot be tinted. The entity wire writes the ability, the two times and
//    the channel flag and nothing else, and the school lives only in a bundled table.
//    Guessing one from the ability id would claim a damage type nothing sent.
//  - A mob ability's name is worked out from its id. `world.abilities` bridges an id to
//    the game's own name for your spellbook and nothing else, so `flame_pillar` reads as
//    Flame Pillar, which is wrong wherever the game's name has moved away from the id. A
//    label worked out that way ends in a question mark.
//  - Nothing says a mob is rare, elite or a boss. An entity record carries kind, template
//    id, name and level, and the client resolves the rest from a bundled table that does
//    not travel. So no plate decorates one, rather than decorating the few a roster of
//    template ids would cover and silently missing the rest.
//
// Neutral is the one inference in the styling. The wire carries one boolean, `hostile`,
// so hostile and friendly are facts and neutral is what is left. The colours are the
// game's own, and its plates say nothing special about a neutral either.
//
// Two loops, split by how fast the reading moves. Every anchor already shares one loop
// with every `woc.onFrame` handler and writes nothing unless its point moved on screen,
// so the placement of forty plates is bounded whatever this file does.
//
//  - Every frame: health and the cast bar, off the entity the loader already holds. Both
//    are continuous and neither allocates, since the kit drops a write that repeats what
//    a row already says.
//  - Ten times a second: which units have a plate at all, the effect strip, the threat
//    edge, the raid mark and the distance fade. None of these is watchable, because
//    `world.on('entities')` reports membership: an effect landing on a mob that was
//    already nearby, a mark being placed on it, or its threat moving fires no handler.
//    The entity subscription is still worth having, since it is what makes a unit
//    walking into range get a plate at once.
//
// The cap is by distance from the player rather than by depth from the camera. Depth is
// the right sort for deciding which of two overlapping things is in front and the wrong
// one for deciding which twelve of forty units get a plate, since the answer would
// change as the camera turned. `ui.project` is still read once per drawn plate, for the
// distance fade and for whether the point can be drawn at all; null means do not draw,
// including for a point closer than the near plane, which a raw projection reports as
// finite nonsense.

/** How often the readings nothing reports a change for are re-taken. */
const SLOW_MS = 100;
/** Effects on one plate. Four is what fits under a plate without becoming the plate. */
const MAX_AURAS = 4;
const DEFAULT_MAX_PLATES = 12;
/** Every default here is the manifest's own: the loader hydrates from that record, so a
 * fallback that disagreed would be read only when the setting was unreadable, and would
 * then draw a different display from the one the player configured. */
const DEFAULT_DISTANCE = 60;
const DEFAULT_SCALE = 1;
const PLATE_WIDTH = 132;
const PLATE_FONT = 12;
/**
 * One effect tile, in pixels. Four of these plus their gaps are the plate's own width,
 * which is what makes the strip read as belonging to the plate over it. It is also the
 * floor the kit's countdown is legible at: the figure is 14px whatever the tile, and the
 * tile clips, so a 20px tile draws "9.4s" with both ends cut off.
 */
const TILE_PX = 30;
/**
 * The gap between the rows of a plate. Without it a cast bar sits flush under a health
 * bar and the pair reads as one two-tone block, while the thing a player has to do
 * mid-fight is tell "how much is left" from "what is about to land". Small enough that
 * the plate is still one object, which is why it is here rather than a margin per row.
 */
const ROW_GAP = 3;
/**
 * What the bars are drawn on. The kit draws a bar's fill and no track, which is right
 * inside a panel, since the panel is the track. A plate has no panel, so the empty part
 * of a health bar would be whatever terrain is behind it. Dark and translucent, so a
 * plate is still something you see the world through.
 */
const BAR_BACKDROP = 'rgb(6 6 10 / 55%)';
const PERCENT = 100;
const DECIMALS = 1;
/** Above this a tile's countdown drops its decimal. Seconds are enough that far out. */
const TILE_WHOLE_FROM = 10;
/** Where the game stops drawing a model, and therefore where a head point stops. */
const MODEL_RANGE_YARDS = 80;
/** Nothing fades nearer than this. Past it a plate dims toward MIN_FADE. */
const FADE_FROM_YARDS = 25;
/** How faint the furthest plate is drawn. Not zero: a faded plate is still a reading. */
const MIN_FADE = 0.35;
/** Your threat as a share of the top row's. 1 means you ARE the top row. */
const THREAT_TOP = 1;
const THREAT_CLOSE = 0.8;
/**
 * What the game appends to an ability id when an effect is not the ability itself.
 *
 * A dot's aura is its ability's id, which is what makes its art resolvable. Every control
 * or modifier aura is not: the game builds those as `${ability.id}_slow`, `_stun`,
 * `_root` and thirteen more, so asking for art under the whole thing can only 404. Read
 * off the game's own emit sites in `sim/combat/effect_dispatch.ts`.
 *
 * Stripping one is correct by construction rather than by heuristic, since the id was
 * built by concatenation. Three real ability ids nonetheless end in one of these
 * (`brain_freeze`, `dismiss_pet`, `revive_pet`), which is why the spellbook is asked
 * first: an id the game itself names is an ability id and is left alone.
 */
const AURA_SUFFIXES = [
  '_absorb',
  '_silence',
  '_lockout',
  '_freeze',
  '_incap',
  '_crit',
  '_stun',
  '_root',
  '_slow',
  '_daze',
  '_dmg',
  '_pet',
  '_dr',
  '_hp',
  '_ap',
  '_as',
];
/** What a worked-out ability name is marked with. See the header. */
const GUESS_MARK = '?';
/** Where the on and off state is kept, account-wide. A preference, not a layout. */
const SHOWN_KEY = 'shown';
/** How long the toggle's confirmation stays up: long enough to read a chord off it. */
const TOAST_MS = 6000;
/** The readable part of a KeyboardEvent code, so 'KeyF' reads as 'F'. */
const CODE_PREFIX = /^(?:Key|Digit|Arrow)/;

/**
 * The name colours, which are the game's own, so a plate from this addon reads the same
 * way as the one under it. There is no third colour because the game has no third
 * colour: a neutral mob is drawn plain.
 */
const HOSTILE_NAME = 'rgb(255 85 85)';
const FRIENDLY_NAME = 'rgb(127 184 255)';
const NEUTRAL_NAME = 'rgb(230 230 230)';

/**
 * The threat edge, drawn down the left of a plate. The top colour is the game's own
 * threat-plate red; the other two are the kit's warn and calm, so an edge and a bar in
 * the same display are the same vocabulary.
 */
const EDGE_NONE = 'transparent';
const EDGE_TOP = 'rgb(192 57 43)';
const EDGE_CLOSE = 'rgb(200 168 56)';
const EDGE_CALM = 'rgb(120 160 255 / 60%)';

/**
 * The eight raid marks, in the game's own index order and its own colours. Written
 * rather than drawn, which is the same limit an aura icon has: the mark art is
 * composited on a canvas from the client's own recipe, so there is no file to point at.
 */
const MARK_NAMES = ['Star', 'Circle', 'Diamond', 'Triangle', 'Moon', 'Square', 'Cross', 'Skull'];
const MARK_COLOURS = [
  'rgb(255 226 58)',
  'rgb(255 138 42)',
  'rgb(210 75 255)',
  'rgb(55 215 44)',
  'rgb(207 230 255)',
  'rgb(35 181 255)',
  'rgb(255 59 48)',
  'rgb(244 244 244)',
];

const plates = new Map();

/**
 * The units that should have a plate right now, rebuilt by the slow pass. Module scope
 * and reused rather than returned, so a pass over forty entities ten times a second
 * allocates nothing.
 */
const wanted = [];

/**
 * Whether the plates are drawn at all. True until storage says otherwise, which settles
 * a microtask later: nothing is drawn before world entry, so there is no flash to avoid
 * by holding the first pass behind a read.
 */
let shown = true;

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

function settingText(id, fallback) {
  const value = woc.settings[id];
  if (typeof value === 'string' && value !== '') {
    return value;
  }
  return fallback;
}

/** How far a unit may be and still get a plate. See the header for the ceiling. */
function drawDistance() {
  return settingNumber('draw-distance', DEFAULT_DISTANCE);
}

function plateScale() {
  return settingNumber('scale', DEFAULT_SCALE);
}

/** An element with its inline styles, since an addon ships no stylesheet. */
function box(tag, className, styles) {
  const el = document.createElement(tag);
  el.className = className;
  Object.assign(el.style, styles);
  return el;
}

function percent(fraction) {
  return `${String(Math.round(fraction * PERCENT))}%`;
}

/** '4.2s'. One decimal, which is what a countdown a player reads mid-fight wants. */
function seconds(left) {
  return `${Math.max(left, 0).toFixed(DECIMALS)}s`;
}

/**
 * The same countdown for a tile, which has a thirtieth of the room a bar has. No unit,
 * since a countdown on an effect icon is seconds and nothing else, and the suffix is a
 * character wide that a stack count needs. A figure of ten or more loses its decimal,
 * because "12.4" is a character wider than the tile can hold.
 */
function tileClock(left) {
  const safe = Math.max(left, 0);
  if (safe >= TILE_WHOLE_FROM) {
    return String(Math.round(safe));
  }
  return safe.toFixed(DECIMALS);
}

/** 'flame_pillar' reads as 'Flame Pillar'. The FALLBACK, not the name: see the header. */
function readable(abilityId) {
  return abilityId
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * How much health is left, or null when there is nothing to divide by. `maxHp` is 0 on
 * anything that does not have health, and a fraction that is not a real number reaches a
 * style property as a dropped declaration, which reads as a bar stuck where it was.
 */
function healthFraction(entity) {
  const max = Number(entity.maxHp);
  const hp = Number(entity.hp);
  if (!(Number.isFinite(max) && Number.isFinite(hp)) || max <= 0) {
    return null;
  }
  return Math.min(Math.max(hp / max, 0), 1);
}

/**
 * What a dead unit's figure says. `dead` stays true through both halves of dying, so
 * without `ghost` a player lying where they fell and one who has released read
 * identically, and only one of the two can be picked up.
 */
function deadWord(entity) {
  if (entity.ghost === true) {
    return 'ghost';
  }
  return 'dead';
}

function healthText(entity, fraction) {
  if (entity.dead === true) {
    return deadWord(entity);
  }
  if (fraction === null) {
    return '';
  }
  return percent(fraction);
}

/** Hostile and friendly are read; neutral is what is left, since the wire carries one
 * boolean. */
function standing(entity) {
  if (entity.hostile === true) {
    return 'hostile';
  }
  if (entity.kind === 'player' || entity.kind === 'npc') {
    return 'friendly';
  }
  return 'neutral';
}

function nameColour(entity) {
  const side = standing(entity);
  if (side === 'hostile') {
    return HOSTILE_NAME;
  }
  if (side === 'friendly') {
    return FRIENDLY_NAME;
  }
  return NEUTRAL_NAME;
}

/** A name for anything, including something the server sent without one. */
function nameOf(entity) {
  const { name } = entity;
  if (typeof name === 'string' && name !== '') {
    return name;
  }
  return `Unit ${String(entity.id)}`;
}

function levelText(entity) {
  const level = Number(entity.level);
  if (!Number.isFinite(level) || level <= 0) {
    return '';
  }
  return String(level);
}

/** Flat distance between two positions, in yards. Height is in it: a plate is a plate. */
function distanceBetween(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Whether the player asked to see this kind of unit. Anything unrecognised is the hostile
 * set, which costs least when a setting arrives from a future manifest.
 */
function askedFor(entity) {
  const mode = settingText('show', 'hostile');
  if (mode === 'everything') {
    return true;
  }
  if (entity.hostile === true) {
    return true;
  }
  if (mode === 'players') {
    return entity.kind === 'player';
  }
  return false;
}

function castOf(casts, id) {
  return casts.get(id) ?? null;
}

/**
 * Whether a full-health unit is quiet enough to hide. The setting is about clutter, and
 * a boss winding up a mechanic at full health is not clutter, so a cast keeps its plate.
 */
function quiet(entity, cast) {
  if (cast !== null) {
    return false;
  }
  const fraction = healthFraction(entity);
  return fraction !== null && fraction >= 1;
}

/**
 * The unconditional half of the filter: a thing with health, in range, that is not you.
 * A corpse is left out, since a plate over one says nothing a player can act on and the
 * game already draws its own prompt there. An object has no health to draw.
 */
function platable(entity, player, range) {
  if (entity.id === player.id || entity.kind === 'object' || entity.dead === true) {
    return false;
  }
  if (healthFraction(entity) === null) {
    return false;
  }
  return distanceBetween(entity.pos, player.pos) <= range;
}

/**
 * Every unit that should have a plate, nearest first, capped. Nothing is projected here:
 * the set must not depend on where the camera is pointing.
 */
function collect(player, casts) {
  wanted.length = 0;
  const range = drawDistance();
  const hideFull = settingFlag('hide-full', false);
  for (const [id, entity] of woc.world.entities) {
    if (platable(entity, player, range) && askedFor(entity)) {
      const cast = castOf(casts, id);
      if (!(hideFull && quiet(entity, cast))) {
        wanted.push({ id, entity, away: distanceBetween(entity.pos, player.pos) });
      }
    }
  }
  wanted.sort((a, b) => a.away - b.away);
  const cap = Math.round(settingNumber('max-plates', DEFAULT_MAX_PLATES));
  wanted.length = Math.min(wanted.length, cap);
}

/**
 * The ability an effect was applied by, which is what art is filed under. The aura's own
 * id wherever the game names one, since an id it can name is an ability id by definition.
 * Otherwise the tail comes off: see `AURA_SUFFIXES`.
 */
function artId(auraId) {
  if (woc.world.abilities.byId(auraId) !== null) {
    return auraId;
  }
  const suffix = AURA_SUFFIXES.find((one) => auraId.endsWith(one));
  if (suffix === undefined) {
    return auraId;
  }
  const base = auraId.slice(0, -suffix.length);
  if (base === '') {
    return auraId;
  }
  return base;
}

/**
 * Skill art for one effect, or null. An aura carries the id of the ability that applied
 * it, so a player's aura resolves through their class and a mob's resolves through
 * nothing. `sourceId` is 0 when the game did not say, which finds no caster and answers
 * null like any other miss.
 */
function auraIcon(aura) {
  if (typeof aura.id !== 'string') {
    return null;
  }
  const caster = woc.world.entities.get(aura.sourceId);
  if (caster === undefined || caster.kind !== 'player') {
    return null;
  }
  return woc.ui.icon.ability(artId(aura.id), caster.templateId);
}

/** Whether you applied this one, which is what puts it at the front of the strip. */
function appliedByPlayer(aura) {
  const { player } = woc.world;
  return player !== null && aura.sourceId === player.id;
}

/** Yours first, then whatever is going away soonest. */
function beforeAura(a, b) {
  const mine = appliedByPlayer(a);
  if (mine !== appliedByPlayer(b)) {
    return mine;
  }
  return a.remaining < b.remaining;
}

/**
 * Put one effect in its place in the strip, or drop it. Written in place rather than
 * through sort or splice: this runs per effect per plate ten times a second, and a strip
 * capped at four is small enough that an insertion costs less than a sort's array.
 */
function insertAura(out, aura) {
  let at = out.length;
  while (at > 0 && beforeAura(aura, out[at - 1])) {
    at -= 1;
  }
  if (at >= MAX_AURAS) {
    return;
  }
  out.length = Math.min(out.length + 1, MAX_AURAS);
  for (let slot = out.length - 1; slot > at; slot -= 1) {
    out[slot] = out[slot - 1];
  }
  out[at] = aura;
}

/**
 * The effects worth a tile, into the array the plate already owns.
 *
 * Harmful only, which is one rule for every unit: on a hostile it is what you and your
 * group have put on it, and on a friendly it is what is being done to them.
 * `world.harmful` is the game's own rule, and an aura's `value` cannot stand in for it
 * because a damage-over-time's per-tick figure is positive exactly as a heal's is.
 */
function selectAuras(entity, out) {
  out.length = 0;
  const { auras } = entity;
  if (!Array.isArray(auras)) {
    return;
  }
  for (const aura of auras) {
    if (woc.world.harmful(aura)) {
      insertAura(out, aura);
    }
  }
}

/** How much of an effect is left, or 0 when nothing said how long it was. */
function auraFraction(aura) {
  if (!(Number.isFinite(aura.duration) && aura.duration > 0)) {
    return 0;
  }
  return aura.remaining / aura.duration;
}

/** A tile is announced by this, since a square whose whole face is art has no room. */
function auraLabel(aura) {
  if (typeof aura.name === 'string' && aura.name !== '') {
    return aura.name;
  }
  return readable(String(aura.id));
}

/**
 * What to call an ability, and whether the name had to be worked out. One lookup
 * answering both, since they have one source: `world.abilities` covers your spellbook, so
 * every mob mechanic comes back marked.
 */
function describe(abilityId) {
  const known = woc.world.abilities.byId(abilityId) ?? null;
  if (known === null) {
    return { label: `${readable(abilityId)}${GUESS_MARK}`, guessed: true };
  }
  return { label: known.name, guessed: false };
}

function buildHead() {
  const head = box('div', 'woc-fm-head', {
    display: 'flex',
    alignItems: 'baseline',
    gap: '4px',
    justifyContent: 'center',
  });
  const mark = box('span', 'woc-fm-mark', { fontWeight: '700', display: 'none' });
  const name = box('span', 'woc-fm-name', {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: '600',
  });
  const level = box('span', 'woc-fm-level', { opacity: '0.75', fontSize: '11px' });
  head.append(mark, name, level);
  return { head, mark, name, level };
}

/**
 * One plate: an anchor the loader keeps over the unit, and everything inside it. The
 * anchor centres its content on the point, so the plate needs no placement of its own.
 * The scale is on the inner element, because the anchor's own transform is the loader's
 * and writing over it would move every plate half its width. The origin is the bottom,
 * so a bigger plate grows up off the model rather than down into it.
 */
function createPlate(entity) {
  const anchor = woc.ui.anchor3d({ unit: entity.id, over: 'head' }, { className: 'woc-fm-anchor' });
  const plate = box('div', 'woc-fm-plate', {
    display: 'flex',
    flexDirection: 'column',
    gap: `${String(ROW_GAP)}px`,
    width: `${String(PLATE_WIDTH)}px`,
    fontSize: `${String(PLATE_FONT)}px`,
    lineHeight: '1.25',
    textShadow: '0 1px 2px rgb(0 0 0 / 90%)',
    borderLeft: `3px solid ${EDGE_NONE}`,
    paddingLeft: '4px',
    transformOrigin: '50% 100%',
  });
  plate.dataset.unit = String(entity.id);
  const parts = buildHead();
  const health = woc.ui.bar({ className: 'woc-fm-health' });
  health.el.style.background = BAR_BACKDROP;
  const cast = woc.ui.bar({ className: 'woc-fm-cast' });
  cast.el.style.background = BAR_BACKDROP;
  cast.el.style.display = 'none';
  const strip = box('div', 'woc-fm-strip', { display: 'flex', gap: '2px' });
  plate.append(parts.head, health.el, cast.el, strip);
  anchor.el.appendChild(plate);
  return {
    anchor,
    plate,
    mark: parts.mark,
    name: parts.name,
    level: parts.level,
    health,
    cast,
    strip,
    tiles: [],
    auras: [],
    slots: [],
    ability: '',
    edge: '',
    scale: 0,
  };
}

function dropPlate(id, entry) {
  entry.anchor.destroy();
  plates.delete(id);
}

function clearPlates() {
  for (const [id, entry] of plates) {
    dropPlate(id, entry);
  }
}

/** One tile, built the first time the strip needs that many. */
function tileAt(entry, at) {
  const held = entry.tiles[at];
  if (held !== undefined) {
    return held;
  }
  const tile = woc.ui.tile({ className: 'woc-fm-tile', size: TILE_PX });
  entry.tiles.push(tile);
  entry.slots.push('');
  entry.strip.appendChild(tile.el);
  return tile;
}

/**
 * Draw one effect in one slot. The identity half (the name, the art, the school) is
 * written only when the slot changes hands, since building an icon URL and reaching for
 * the caster is the expensive part.
 */
function paintTile(entry, at, aura) {
  const tile = tileAt(entry, at);
  if (entry.slots[at] !== aura.id) {
    entry.slots[at] = aura.id;
    tile.update({ label: auraLabel(aura), icon: auraIcon(aura), school: aura.school });
  }
  tile.update({
    fraction: auraFraction(aura),
    value: tileClock(aura.remaining),
    count: aura.stacks ?? null,
  });
  tile.el.style.display = '';
}

/** A slot with nothing in it goes back to being unnamed, or it goes on announcing. */
function hideTile(entry, at) {
  const tile = entry.tiles[at];
  if (tile === undefined) {
    return;
  }
  entry.slots[at] = '';
  tile.update({ label: null });
  tile.el.style.display = 'none';
}

function paintStrip(entry, entity) {
  if (settingFlag('auras', true)) {
    selectAuras(entity, entry.auras);
  } else {
    entry.auras.length = 0;
  }
  for (const [at, aura] of entry.auras.entries()) {
    paintTile(entry, at, aura);
  }
  for (let at = entry.auras.length; at < entry.tiles.length; at += 1) {
    hideTile(entry, at);
  }
}

/**
 * Your share of this mob's hate table, or null. A mob only, because that is the only
 * thing that keeps one: on a player the table is empty, and an edge drawn from it would
 * be a permanent nothing dressed as a reading.
 */
function threatShare(entity) {
  if (entity.hostile !== true) {
    return null;
  }
  return woc.world.threat(entity.id).share;
}

function edgeColour(share) {
  if (share === null) {
    return EDGE_NONE;
  }
  if (share >= THREAT_TOP) {
    return EDGE_TOP;
  }
  if (share >= THREAT_CLOSE) {
    return EDGE_CLOSE;
  }
  return EDGE_CALM;
}

function paintEdge(entry, entity) {
  const colour = edgeColour(threatShare(entity));
  if (entry.edge === colour) {
    return;
  }
  entry.edge = colour;
  entry.plate.style.borderLeftColor = colour;
}

function paintMark(entry, id, markers) {
  const at = markers?.get(id) ?? null;
  if (at === null) {
    entry.mark.style.display = 'none';
    entry.mark.textContent = '';
    return;
  }
  entry.mark.textContent = MARK_NAMES[at] ?? `Mark ${String(at + 1)}`;
  entry.mark.style.color = MARK_COLOURS[at] ?? NEUTRAL_NAME;
  entry.mark.style.display = '';
}

/**
 * How faint a plate is, from the camera's own distance. `ui.project` is the only thing
 * that can answer this: depth is yards along the direction the camera is looking, so it
 * stays right while the player swings it. Null means the point cannot be drawn, and the
 * loader has already hidden the anchor for it.
 */
function fadeFor(id) {
  const at = woc.ui.project({ unit: id, over: 'head' });
  if (at === null) {
    return 0;
  }
  if (at.depth <= FADE_FROM_YARDS) {
    return 1;
  }
  const past = (at.depth - FADE_FROM_YARDS) / (MODEL_RANGE_YARDS - FADE_FROM_YARDS);
  return Math.max(1 - past * (1 - MIN_FADE), MIN_FADE);
}

/** Size the plate, and only when the setting moved: a transform write is a repaint. */
function paintScale(entry) {
  const scale = plateScale();
  if (entry.scale === scale) {
    return;
  }
  entry.scale = scale;
  entry.plate.style.transform = `scale(${String(scale)})`;
}

/** Everything on a plate that no watch key reports. Ten times a second. */
function paintSlow(entry, entity, markers) {
  entry.name.textContent = nameOf(entity);
  entry.name.style.color = nameColour(entity);
  entry.level.textContent = levelText(entity);
  paintMark(entry, entity.id, markers);
  paintEdge(entry, entity);
  paintStrip(entry, entity);
  paintScale(entry);
  entry.plate.style.opacity = String(fadeFor(entity.id));
}

/** The health bar: a fill, and a figure that says dead rather than nothing. */
function paintHealth(entry, entity) {
  const fraction = healthFraction(entity);
  entry.health.update({
    fraction: fraction ?? 0,
    value: healthText(entity, fraction),
    tone: 'default',
  });
}

/** How much of the cast is LEFT, which is the sense the kit draws a fill in. */
function castFraction(cast) {
  if (!(Number.isFinite(cast.total) && cast.total > 0)) {
    return 0;
  }
  return cast.remaining / cast.total;
}

/**
 * The cast bar, drawn in the plain fill whatever it is. No school and no tone: nothing
 * on the wire says a cast's school, and a tone would put urgency on every mob mechanic in
 * the fight at once. The label is written only when the ability changes.
 */
function paintCast(entry, cast) {
  if (cast === null || !settingFlag('casts', true)) {
    entry.cast.el.style.display = 'none';
    entry.ability = '';
    return;
  }
  if (entry.ability !== cast.ability) {
    entry.ability = cast.ability;
    entry.cast.update({ label: describe(cast.ability).label, school: null });
  }
  entry.cast.update({ fraction: castFraction(cast), value: seconds(cast.remaining) });
  entry.cast.el.style.display = '';
}

/**
 * Bring the plates in line with what is around you, and draw everything slow.
 * `world.markers` is read once here rather than once per plate, since the loader builds
 * that map on every read.
 */
function slowPass() {
  const { player } = woc.world;
  if (player === null || !shown) {
    clearPlates();
    return;
  }
  collect(player, woc.world.casts);
  const live = new Set(wanted.map((entry) => entry.id));
  for (const [id, entry] of plates) {
    if (!live.has(id)) {
      dropPlate(id, entry);
    }
  }
  const { markers } = woc.world;
  for (const found of wanted) {
    let entry = plates.get(found.id);
    if (entry === undefined) {
      entry = createPlate(found.entity);
      plates.set(found.id, entry);
    }
    paintSlow(entry, found.entity, markers);
  }
}

/**
 * The two figures that move continuously, off the entity the loader already holds. A
 * plate whose unit has left interest scope is hidden rather than destroyed here: the slow
 * pass owns which plates exist.
 */
function fastPass() {
  const { casts } = woc.world;
  for (const [id, entry] of plates) {
    const entity = woc.world.entities.get(id);
    if (entity === undefined) {
      entry.plate.style.opacity = '0';
    } else {
      paintHealth(entry, entity);
      paintCast(entry, castOf(casts, id));
    }
  }
}

/** 'Alt+Shift+KeyF' reads as 'Alt+Shift+F', which is what a player's keyboard says. */
function comboLabel(combo) {
  const at = combo.lastIndexOf('+');
  return `${combo.slice(0, at + 1)}${combo.slice(at + 1).replace(CODE_PREFIX, '')}`;
}

/** The sentence naming the chord, or nothing at all when there is no chord to name. */
function wayBack() {
  const combo = woc.keys.combo('toggle');
  if (combo === null) {
    return '';
  }
  return ` Press ${comboLabel(combo)} to bring them back.`;
}

/**
 * Say what just happened, and for the off case say how to undo it. The two are not
 * symmetrical because the states are not: plates coming back are their own confirmation,
 * and plates going away leave a screen that looks like an addon that has stopped
 * working. The chord is read live, so a player who rebound it is told their own key.
 */
function announce() {
  if (shown) {
    woc.ui.toast('Facemark: plates on.', { timeout: TOAST_MS });
    return;
  }
  woc.ui.toast(`Facemark: plates off.${wayBack()}`, { timeout: TOAST_MS });
}

function remember() {
  woc.storage.set(SHOWN_KEY, shown).catch((err) => {
    woc.warn('could not write whether the plates are shown', err);
  });
}

/**
 * Take the stored answer back. Account-wide, so it settles without waiting for a
 * character, and a value of the wrong kind is left alone rather than coerced: a stored
 * answer nobody can read is not a request to turn the display off.
 */
async function restore() {
  const stored = await woc.storage.get(SHOWN_KEY, true);
  if (typeof stored === 'boolean') {
    shown = stored;
    slowPass();
  }
}

// The set of units in scope is the one thing here a key reports, and it is what makes a
// unit walking round a corner get a plate at once rather than a tenth of a second later.
// Everything the key does not report is why there is a sampler underneath it.
woc.world.on('entities', () => {
  slowPass();
});

woc.setInterval(slowPass, SLOW_MS);

woc.onFrame(() => {
  if (plates.size > 0) {
    fastPass();
  }
});

woc.keys.bind('toggle', () => {
  shown = !shown;
  remember();
  announce();
  slowPass();
});

restore().catch((err) => {
  woc.warn('could not read whether the plates are shown', err);
});

/**
 * Take every plate down and let the next pass build them again. A plate's shape is
 * decided when it is built and the filters decide which units have one at all, so a
 * settings change is a different display rather than a repaint of this one.
 */
woc.onSettingsChange(() => {
  clearPlates();
  slowPass();
});
