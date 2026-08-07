/// <reference types="@woc-addons/types" />

// Facemark: the nameplate the game does not draw.
//
// Plates sit on `ui.anchor3d({ unit, over: 'head' })`, the renderer's own point for that
// unit, which folds in model height, mount lift and scale. None of the three is on the
// wire, so a fixed offset above `entity.pos` would be right for one creature size only and
// there must be no offset setting. That point resolves to nothing past roughly eighty
// yards, where the game draws no model, so the draw distance caps below that rather than
// above it.
//
// Four things a plate cannot say. An effect a mob applied has no art anywhere, since the
// game composites aura icons at run time; a player's resolves through the caster's class.
// A cast bar cannot be tinted, because the wire carries no school for a cast. A mob
// ability's name is worked out from its id, as is an ACTIVITY sentinel like crafting, so
// both end in a question mark. And nothing on the wire says a mob is rare, elite or a
// boss: a roster of template ids would decorate a few and silently miss the rest.
//
// Two loops. Every frame: health and the cast bar. Ten times a second: which units have a
// plate, the effect strip, the threat edge, the mark and the fade, none of which any watch
// key reports. `world.on('entities')` reports membership only, which is why the sampler is
// under it.
//
// The cap is by distance from the player, never by depth from the camera: depth would
// change which twelve of forty units get a plate as the player turned.

const SLOW_MS = 100;
/** Effects on one plate. More than four and the strip becomes the plate. */
const MAX_AURAS = 4;
const PLATE_WIDTH = 132;
const PLATE_FONT = 12;
/** Four of these plus gaps make the plate's width. Under 30 the kit's 14px countdown clips. */
const TILE_PX = 30;
/** Without a gap a cast bar under a health bar reads as one two-tone block. */
const ROW_GAP = 3;
/** The kit draws no track, and a plate has no panel, so an untracked bar's empty part is terrain. */
const BAR_BACKDROP = 'rgb(6 6 10 / 55%)';
const PERCENT = 100;
const DECIMALS = 1;
/** Above this a tile's countdown drops its decimal: "12.4" is wider than the tile. */
const TILE_WHOLE_FROM = 10;
/** Where the game stops drawing a model, and therefore where a head point stops. */
const MODEL_RANGE_YARDS = 80;
/** Nothing fades nearer than this. */
const FADE_FROM_YARDS = 25;
/** Not zero: a faded plate is still a reading. */
const MIN_FADE = 0.35;
/** A share of the top row's, so 1 means you ARE the top row. */
const THREAT_TOP = 1;
const THREAT_CLOSE = 0.8;
/**
 * The game builds a control aura's id as `${ability.id}_slow`, so art under the whole id
 * can only 404. Three real ability ids end in one of these (`brain_freeze`, `dismiss_pet`,
 * `revive_pet`), which is why the spellbook is asked before any tail comes off.
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
const GUESS_MARK = '?';
/** Account-wide: a preference about the player, not a layout belonging to a character. */
const SHOWN_KEY = 'shown';
/** Long enough to read a chord off the toast. */
const TOAST_MS = 6000;
const CODE_PREFIX = /^(?:Key|Digit|Arrow)/;

/** The game's own, so a plate reads like the one under it. It has no neutral colour either. */
const HOSTILE_NAME = 'rgb(255 85 85)';
const FRIENDLY_NAME = 'rgb(127 184 255)';
const NEUTRAL_NAME = 'rgb(230 230 230)';

/** The game's threat red, then the kit's warn and calm, so an edge and a bar share a vocabulary. */
const EDGE_NONE = 'transparent';
const EDGE_TOP = 'rgb(192 57 43)';
const EDGE_CLOSE = 'rgb(200 168 56)';
const EDGE_CALM = 'rgb(120 160 255 / 60%)';

/** The game's own index order. Written rather than drawn: mark art is composited, so there is no file. */
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

/** Reused rather than returned, so a pass over forty entities allocates nothing. */
const wanted = [];

/** True until storage says otherwise: nothing draws before world entry, so there is no flash. */
let shown = true;

function drawDistance() {
  return woc.settings['draw-distance'];
}

function plateScale() {
  return woc.settings.scale;
}

/** Inline styles because an addon ships no stylesheet. */
function box(tag, className, styles) {
  const el = document.createElement(tag);
  el.className = className;
  Object.assign(el.style, styles);
  return el;
}

function percent(fraction) {
  return `${String(Math.round(fraction * PERCENT))}%`;
}

function seconds(left) {
  return `${Math.max(left, 0).toFixed(DECIMALS)}s`;
}

/** No unit suffix: that character is the width a stack count needs. */
function tileClock(left) {
  const safe = Math.max(left, 0);
  if (safe >= TILE_WHOLE_FROM) {
    return String(Math.round(safe));
  }
  return safe.toFixed(DECIMALS);
}

/** Null rather than NaN: a non-finite fraction reaches a style property as a bar stuck where it was. */
function healthFraction(entity) {
  const max = Number(entity.maxHp);
  const hp = Number(entity.hp);
  if (!(Number.isFinite(max) && Number.isFinite(hp)) || max <= 0) {
    return null;
  }
  return Math.min(Math.max(hp / max, 0), 1);
}

/** `dead` stays true through both halves of dying, so only `ghost` tells a corpse from a release. */
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

/** The wire carries one boolean, so neutral is what is left rather than a fact. */
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

function distanceBetween(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** An unrecognised mode falls back to hostiles, which costs least on a setting from a future manifest. */
function askedFor(entity) {
  const mode = woc.settings.show;
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

/** A boss winding up at full health is not clutter, so a cast keeps its plate. */
function quiet(entity, cast) {
  if (cast !== null) {
    return false;
  }
  const fraction = healthFraction(entity);
  return fraction !== null && fraction >= 1;
}

/** A corpse is out because the game draws its own prompt there, and an object has no health. */
function platable(entity, player, range) {
  if (entity.id === player.id || entity.kind === 'object' || entity.dead === true) {
    return false;
  }
  if (healthFraction(entity) === null) {
    return false;
  }
  return distanceBetween(entity.pos, player.pos) <= range;
}

/** Nothing is projected here: which units get a plate must not depend on where the camera points. */
function collect(player, casts) {
  wanted.length = 0;
  const range = drawDistance();
  const hideFull = woc.settings['hide-full'];
  for (const [id, entity] of woc.world.entities) {
    if (platable(entity, player, range) && askedFor(entity)) {
      const cast = castOf(casts, id);
      if (!(hideFull && quiet(entity, cast))) {
        wanted.push({ id, entity, away: distanceBetween(entity.pos, player.pos) });
      }
    }
  }
  wanted.sort((a, b) => a.away - b.away);
  const cap = Math.round(woc.settings['max-plates']);
  wanted.length = Math.min(wanted.length, cap);
}

/** Art is filed under the applying ability. An id the spellbook names is one already. */
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

/** Art is filed per player class, so a mob's aura resolves through nothing. `sourceId` is 0 for unsaid. */
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

function appliedByPlayer(aura) {
  const { player } = woc.world;
  return player !== null && aura.sourceId === player.id;
}

function beforeAura(a, b) {
  const mine = appliedByPlayer(a);
  if (mine !== appliedByPlayer(b)) {
    return mine;
  }
  return a.remaining < b.remaining;
}

/** In place rather than a sort: this runs per effect per plate ten times a second. */
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

/** `world.harmful` is the game's own rule; `value` cannot stand in, since a dot's tick is positive too. */
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

function auraFraction(aura) {
  if (!(Number.isFinite(aura.duration) && aura.duration > 0)) {
    return 0;
  }
  return aura.remaining / aura.duration;
}

/** A square whose whole face is art has no room for a name, so this is what announces it. */
function auraLabel(aura) {
  if (typeof aura.name === 'string' && aura.name !== '') {
    return aura.name;
  }
  return woc.fmt.titleCase(String(aura.id));
}

/** The mark stays ours: this label also reaches an accessible name, where a glued-on `?` reads as part of it. */
function describe(abilityId) {
  const found = woc.world.abilities.describe(abilityId);
  if (found.known) {
    return { label: found.name, guessed: false };
  }
  return { label: `${found.name}${GUESS_MARK}`, guessed: true };
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
 * The scale goes on the inner element: the anchor's transform is the loader's, and writing
 * over it moves the plate off its point. Bottom origin, so a bigger plate grows off the model.
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

/** Name, art and school are written only when the slot changes hands: resolving art is the expensive half. */
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

/** Unnamed again, or the slot goes on announcing an effect that has gone. */
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
  if (woc.settings.auras) {
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

/** A mob only: a player keeps no hate table, so an edge from it would be a permanent nothing. */
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

/** Depth, not distance, so the fade holds while the camera swings. Null means the point cannot be drawn. */
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

/** Only when the setting moved: a transform write is a repaint. */
function paintScale(entry) {
  const scale = plateScale();
  if (entry.scale === scale) {
    return;
  }
  entry.scale = scale;
  entry.plate.style.transform = `scale(${String(scale)})`;
}

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

function paintHealth(entry, entity) {
  const fraction = healthFraction(entity);
  entry.health.update({
    fraction: fraction ?? 0,
    value: healthText(entity, fraction),
    tone: 'default',
  });
}

/** LEFT rather than elapsed, which is the sense the kit draws a fill in. */
function castFraction(cast) {
  if (!(Number.isFinite(cast.total) && cast.total > 0)) {
    return 0;
  }
  return cast.remaining / cast.total;
}

/** No school, since nothing on the wire says one, and no tone, which would mark every mob cast urgent. */
function paintCast(entry, cast) {
  if (cast === null || !woc.settings.casts) {
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

/** `world.markers` is read once rather than per plate: the loader builds that map on every read. */
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

/** A plate whose unit has gone is hidden rather than destroyed: the slow pass owns which plates exist. */
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

function comboLabel(combo) {
  const at = combo.lastIndexOf('+');
  return `${combo.slice(0, at + 1)}${combo.slice(at + 1).replace(CODE_PREFIX, '')}`;
}

function wayBack() {
  const combo = woc.keys.combo('toggle');
  if (combo === null) {
    return '';
  }
  return ` Press ${comboLabel(combo)} to bring them back.`;
}

/** Only the off case names the chord: plates going away leave nothing on screen to find again. */
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

/** A stored value of the wrong kind is left alone: it is not a request to turn the display off. */
async function restore() {
  const stored = await woc.storage.get(SHOWN_KEY, true);
  if (typeof stored === 'boolean') {
    shown = stored;
    slowPass();
  }
}

// Membership is the one thing a key reports, so a unit walking into range gets a plate at once.
woc.world.on('entities', () => {
  slowPass();
});

woc.setInterval(slowPass, SLOW_MS);

woc.onFrame(() => {
  if (plates.size > 0) {
    fastPass();
  }
});

// Not `toggleKey`: there is no frame, and this chord also writes the setting and toasts.
woc.keys.bind('toggle', () => {
  shown = !shown;
  remember();
  announce();
  slowPass();
});

restore().catch((err) => {
  woc.warn('could not read whether the plates are shown', err);
});

/** A plate's shape is fixed when it is built, so a settings change is a rebuild rather than a repaint. */
woc.onSettingsChange(() => {
  clearPlates();
  slowPass();
});
