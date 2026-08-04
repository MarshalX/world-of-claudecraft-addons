/// <reference types="@woc-addons/types" />

// Purelight: the effects in front of you that can actually be removed.
//
// Every tile on this strip is one a player could spend a global on and change something.
// Everything else is absent rather than dimmed or sorted lower, because the triage is
// the feature.
//
// Removability is the game's own rule and the loader publishes it, so nothing here works
// it out. `world.dispellable(aura, offensive)` is three clauses: the effect is not
// control an encounter owns, its school is not physical, and its polarity points the way
// the direction asks. The first is what separates a scripted mechanic's stun from an
// ordinary one, and skipping it costs a global.
//
// The direction is per unit, from `Entity.hostile`. On you, your pet and your group the
// question is which harmful effect can be lifted off; on a hostile target it is which
// benefit can be stripped away. Both are the same three clauses with the polarity
// reversed, so they share one strip and one set of tiles.
//
// Only an entity is read, never a party row. A row exists for a member on the far side
// of the map where an entity does not, and it carries no school and no
// `unbreakableControl`, which are the two clauses whose absence costs a global. So
// `world.partyAuras` is unused here and a member with no entity is left off, which costs
// nothing anybody could have acted on: such a member is out of interest scope entirely.
//
// Nothing is inferred from an aura's `value` or from a party row's `neg`. Both are
// magnitudes rather than polarities: a damage over time carries a positive figure per
// tick exactly as a heal over time does, and a root and a stun both carry 0.
//
// Nothing can be removed from here. The loader never sends, so this says what is worth a
// global and the player spends it.
//
// A tile draws the applying ability's art when a player applied it. Art is filed per
// player class and an aura carries no class of its own, so the caster's is the only
// route to it, and a control aura is the same ability with a tail on its id (see
// `AURA_SUFFIXES`, which the highest-ranked tiles are exactly the ones that need). An
// effect a mob applied has an icon in the game and no file anywhere, because the game
// composites those on a canvas no addon can reach, so those tiles carry the school's
// colour, the countdown and the stack count, with the name one hover away.
//
// The strip is resizable and its height is the tile size plus the caption band under it,
// which is the arrangement Cooldown Bars draws its own tile strip with. The width is
// only room to grow into: tiles sized to fill it would shrink as more effects landed.

/** How many tiles the strip shows before it stops, unless the player says otherwise. */
const DEFAULT_MAX_TILES = 6;
/** Below this many seconds left, an effect will be gone before a global lands. */
const DEFAULT_MIN_SECONDS = 1;
/**
 * The tile strip's starting square, which is also its floor. 40 is the tap-target floor
 * the game holds its own controls to, and a strip below it cannot be hit or read.
 */
const TILE_FLOOR = 40;
/**
 * The caption band under a square, which carries the name of whoever has the effect.
 * Stated rather than measured, because the strip's height is a square plus this and a
 * drag has to solve back for the square.
 */
const CAPTION_HEIGHT = 14;
const CAPTION_FONT = 11;
/** How wide the strip starts. Only room to grow into. */
const STRIP_WIDTH = 300;
const DECIMALS = 1;
/** Over this, a tile's countdown is drawn in minutes: 40 pixels does not fit "119". */
const SECONDS_PER_MINUTE = 60;

/**
 * The kinds that stop a player acting, which is the worst thing an effect can do.
 *
 * Every one is checked against `KnownHarmfulAuraKind` rather than written from what a
 * control effect is usually called: a fear is `incapacitate`, and `fear` is the name of
 * the diminishing-returns category it is filed under. Naming a kind that does not exist
 * is silent in both directions.
 *
 * `AuraKind` is a plain string in the published types, because the set is content and a
 * release adds to it, so a kind added later ranks as ordinary rather than being dropped.
 * Being wrong here costs one position in the order, which is why the ranking is allowed
 * to be a judgement while removability is not.
 */
const CONTROL_KINDS = ['stun', 'incapacitate', 'polymorph', 'silence', 'root'];
const CONTROL_RANK = 2;
const DAMAGE_RANK = 1;
const ORDINARY_RANK = 0;

/** Why a tile is here, in the direction the unit carrying it points. */
const DISPEL_REASON = 'Removable: harmful, not physical, and no encounter owns it.';
const PURGE_REASON = 'Removable: a benefit on a hostile unit, and not physical.';

/**
 * The tails the game appends when an ability's effect becomes a control aura.
 *
 * Read out of the game's own effect dispatch, and the same table Facemark carries: an
 * addon is one file with no imports, so a shared rule about the game is copied or it is
 * absent. A player's stun is `${ability.id}_stun`, a silence is `_silence`, a fear is
 * `_incap`; only a dot and a polymorph carry the bare ability id. Stripping one is
 * correct by construction, since the id was built by concatenation, and the spellbook is
 * asked first because five real ability ids end in what would look like a tail
 * (`brain_freeze`, `deep_freeze`, `dismiss_pet`, `mend_pet`, `revive_pet`).
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

/** One cell per aura. See `keyFor` for what makes an aura one rather than another. */
const cells = new Map();

/**
 * Whether a cue has any news to report yet. The first reading of a live world is
 * everything already up, so without this an addon enabled mid-fight opens with a chime
 * per effect on the group.
 */
let primed = false;

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

const list = document.createElement('div');
list.className = 'woc-pl-list';
list.style.display = 'flex';
list.style.gap = '4px';

function stripHeight(size) {
  return size + CAPTION_HEIGHT;
}

/** The square the strip is drawing at now, which is its height less the caption. */
let tileSize = TILE_FLOOR;

/**
 * The overlay. Bare, because the tiles are the display. The title is kept as the frame's
 * accessible name and the label the loader shows while frames are unlocked, which is how
 * this gets positioned while nothing removable is in front of the player.
 */
const frame = woc.ui.frame({
  id: 'strip',
  title: 'Purelight',
  width: STRIP_WIDTH,
  // Stated, because a frame with no height opens at the kit's own fallback, which for a
  // row of 40 pixel squares leaves an invisible drag area over the game. It is also what
  // makes the frame draggable at all: a content-sized frame is never given a box.
  height: stripHeight(TILE_FLOOR),
  density: 'bare',
  save: true,
  // A frame is content-sized and therefore not resizable by default, which is wrong for
  // a strip of art: how big a square has to be to be recognised at a glance is a matter
  // of eyesight and of how much screen a player will give this.
  resizable: true,
  // Both are stated, because a frame that states neither takes the size it opened at as
  // its floor. Constants either way, so the floor is the tap-target square whatever the
  // tile budget is set to.
  minWidth: TILE_FLOOR,
  minHeight: stripHeight(TILE_FLOOR),
  onMove: (box) => {
    resize(box.h);
  },
});
frame.body.appendChild(list);

/**
 * Follow the strip's height, which is one square and the caption under it. The box comes
 * from the loader; measuring the element instead would force a synchronous layout on
 * every pointer move. Called at pointer rate, so it does nothing when the square has not
 * moved. The floor is applied here as well as stated on the frame, since the arithmetic
 * has to hold for a box from anywhere: a restored one, a viewport clamp, or a height a
 * future bound lets through.
 */
function resize(height) {
  const next = Math.max(Math.round(height - CAPTION_HEIGHT), TILE_FLOOR);
  if (next === tileSize) {
    return;
  }
  tileSize = next;
  for (const cell of cells.values()) {
    sizeCell(cell);
  }
}

/**
 * Put one cell at the size the strip is at now. The cell is the square's width, so the
 * caption truncates against the art rather than against a column that stayed 40 wide.
 * The tile is updated rather than rebuilt, or every pointer move would throw away art
 * the browser has decoded.
 */
function sizeCell(cell) {
  cell.el.style.width = `${String(tileSize)}px`;
  cell.ui.update({ size: tileSize });
}

/**
 * Whether there is a world to read at all. An addon runs from document-start, so the
 * readings before world entry happen on the landing page and see nobody. See `primed`.
 */
function live() {
  return woc.world.player !== null;
}

/**
 * Every unit this display answers for, once each.
 *
 * Collected by entity id rather than by token, since the same entity reaches the list by
 * more than one route: your target is very often a member of your own group, and one
 * shared between two routes would be drawn twice.
 *
 * A party member is looked up by pid rather than through a `partyN` token, which is the
 * same lookup with the loader's 1-based numbering of the other members in between. That
 * numbering shifts the moment the player is left out of the walk, and a shift captions
 * one member's effects with another's name.
 */
function units() {
  const found = new Map();
  const add = (entity) => {
    if (entity !== null && entity !== undefined && !found.has(entity.id)) {
      found.set(entity.id, entity);
    }
  };
  const mine = woc.world.player?.id ?? null;
  if (settingFlag('include-player', true)) {
    add(woc.world.player);
    add(woc.world.unit('pet'));
  }
  for (const member of woc.world.party?.members ?? []) {
    if (member.pid !== mine) {
      add(woc.world.entities.get(member.pid));
    }
  }
  if (settingFlag('include-target', true)) {
    add(woc.world.target);
  }
  return [...found.values()];
}

/**
 * The ability an effect was applied by, which is what art is filed under. The aura's own
 * id wherever the game names one, since an id it can name is an ability id by
 * definition. Otherwise the tail comes off: see `AURA_SUFFIXES`.
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
 * The applying ability's art, or null when there is no file to point at. Only a
 * player-applied aura resolves: art is filed per player class, and a mob has no class
 * directory to look under.
 */
function artOf(aura, caster) {
  if (caster === null || caster.kind !== 'player') {
    return null;
  }
  return woc.ui.icon.ability(artId(aura.id), caster.templateId);
}

/**
 * What makes one aura a different aura from another on the same unit.
 *
 * Not the ability id on its own. Two players can carry the same debuff on one target,
 * and keying on the id alone collapses the pair into one tile whose stack count is one
 * of the two auras' rather than the pair's, so the caster is in the key.
 *
 * The ordinal covers what the caster cannot: `sourceId` is 0 when the game did not say
 * who applied something, so two effects the world itself put on one unit would still
 * collide. It counts within a single reading, in the game's own aura order.
 */
function keyFor(unit, aura, seen) {
  const base = `${String(unit.id)}:${aura.id}:${String(aura.sourceId)}`;
  const nth = (seen.get(base) ?? 0) + 1;
  seen.set(base, nth);
  if (nth === 1) {
    return base;
  }
  return `${base}#${String(nth)}`;
}

/** One effect, with everything a tile and its tooltip need already resolved. */
function effectFrom(unit, aura, key) {
  const caster = woc.world.entities.get(aura.sourceId) ?? null;
  return {
    key,
    who: unit.name,
    offensive: unit.hostile,
    from: caster?.name ?? null,
    name: aura.name,
    kind: aura.kind,
    school: aura.school,
    icon: artOf(aura, caster),
    remaining: aura.remaining,
    duration: aura.duration,
    stacks: aura.stacks ?? 0,
  };
}

/**
 * What can be removed from one unit, in that unit's own direction. One filter and no
 * join: the whole rule is `world.dispellable`, which is the game's own classifier rather
 * than a copy that would go stale on the release that adds a kind.
 */
function removableOn(unit) {
  const seen = new Map();
  const found = [];
  for (const aura of unit.auras ?? []) {
    if (woc.world.dispellable(aura, unit.hostile)) {
      found.push(effectFrom(unit, aura, keyFor(unit, aura, seen)));
    }
  }
  return found;
}

/** Control first, then damage, then everything else. See `CONTROL_KINDS`. */
function severity(effect) {
  if (CONTROL_KINDS.includes(effect.kind)) {
    return CONTROL_RANK;
  }
  if (effect.kind === 'dot') {
    return DAMAGE_RANK;
  }
  return ORDINARY_RANK;
}

/**
 * Worst first, and within a rank the one with longest left. Longest rather than
 * shortest, which is the opposite of a cooldown list: an effect about to fall off on its
 * own is the one not worth a global.
 */
function worstFirst(a, b) {
  const rank = severity(b) - severity(a);
  if (rank !== 0) {
    return rank;
  }
  return b.remaining - a.remaining;
}

/** Everything removable in front of you right now, worst first. */
function reading() {
  const floor = settingNumber('min-seconds', DEFAULT_MIN_SECONDS);
  const found = [];
  for (const unit of units()) {
    for (const effect of removableOn(unit)) {
      if (effect.remaining >= floor) {
        found.push(effect);
      }
    }
  }
  return found.sort(worstFirst);
}

/** `8`, or `2m` for anything a 40 pixel square has no room to spell out. */
function countdown(remaining) {
  if (remaining >= SECONDS_PER_MINUTE) {
    return `${String(Math.ceil(remaining / SECONDS_PER_MINUTE))}m`;
  }
  return String(Math.ceil(remaining));
}

/** Stacks in the corner, or nothing at all for the ordinary single application. */
function stackCount(effect) {
  if (effect.stacks > 1) {
    return effect.stacks;
  }
  return null;
}

/**
 * How much of the effect is left. A duration of zero is a permanent effect or one the
 * game did not state, and a full tile is right for both: an empty one reads as expired.
 */
function fractionOf(effect) {
  if (effect.duration > 0) {
    return Math.min(effect.remaining / effect.duration, 1);
  }
  return 1;
}

function reasonFor(effect) {
  if (effect.offensive) {
    return PURGE_REASON;
  }
  return DISPEL_REASON;
}

/**
 * What one tile says under the pointer. A function, so it answers with what is left now
 * rather than with what was left when the tile was built, and so it can say why the
 * effect is on the strip at all. The caster is named when the game said who it was,
 * which is what tells two tiles of the same debuff on one unit apart.
 */
function tooltipFor(key) {
  const effect = reading().find((row) => row.key === key);
  if (effect === undefined) {
    return 'This effect has gone.';
  }
  const lines = [
    `On ${effect.who}`,
    `${effect.kind}, ${effect.school}`,
    `${effect.remaining.toFixed(DECIMALS)}s left`,
  ];
  if (effect.from !== null) {
    lines.push(`Applied by ${effect.from}`);
  }
  lines.push({ text: reasonFor(effect), tone: 'good' });
  return { title: effect.name, lines };
}

/**
 * One square, with the name of whoever is carrying it under it. The caption is not
 * something the kit draws, because a tile's whole face is art: `label` is how a tile is
 * announced, and this strip has to be readable by eye as well, since the first thing a
 * healer needs is who is carrying the effect.
 */
function createCell(effect) {
  const tile = woc.ui.tile({
    label: `${effect.who}: ${effect.name}`,
    icon: effect.icon,
    school: effect.school,
    className: 'woc-pl-tile',
  });
  const cell = document.createElement('div');
  cell.className = 'woc-pl-cell';
  cell.dataset.effect = effect.key;
  cell.style.display = 'flex';
  cell.style.flexDirection = 'column';
  cell.style.alignItems = 'center';
  // A flex item shrinks by default, so a strip narrowed to less than its content would
  // squash the squares out of true rather than running past the edge.
  cell.style.flexShrink = '0';
  const name = document.createElement('span');
  name.className = 'woc-pl-name';
  name.style.overflow = 'hidden';
  name.style.textOverflow = 'ellipsis';
  name.style.whiteSpace = 'nowrap';
  name.style.maxWidth = '100%';
  name.style.fontSize = `${String(CAPTION_FONT)}px`;
  // Stated in both directions, because the strip's height is a square plus exactly this
  // and the drag solves back for the square.
  name.style.height = `${String(CAPTION_HEIGHT)}px`;
  name.style.lineHeight = `${String(CAPTION_HEIGHT)}px`;
  name.textContent = effect.who;
  cell.append(tile.el, name);
  const built = { ui: tile, el: cell, name };
  // Whatever the strip is at now, so a tile appearing mid-fight matches its neighbours.
  sizeCell(built);
  woc.ui.tooltip(cell, () => tooltipFor(effect.key));
  return built;
}

/**
 * Tell one cell where its effect has got to. The label and the art are rewritten as well
 * as the figures, because a cell outlives one reading: the caster's art resolves only
 * once the class manifest has been read, so a tile built before that would keep an empty
 * icon slot for the life of the effect.
 */
function paint(cell, effect) {
  cell.name.textContent = effect.who;
  cell.ui.update({
    label: `${effect.who}: ${effect.name}`,
    icon: effect.icon,
    fraction: fractionOf(effect),
    value: countdown(effect.remaining),
    count: stackCount(effect),
    school: effect.school,
  });
}

/** Put a cell at its position, and only if it is not there already. */
function place(el, at) {
  if (list.children[at] !== el) {
    list.insertBefore(el, list.children[at] ?? null);
  }
}

function shownOrder(effects) {
  return effects
    .filter((effect) => cells.has(effect.key))
    .slice(0, settingNumber('max-tiles', DEFAULT_MAX_TILES));
}

function draw(effects) {
  const order = shownOrder(effects);
  const shown = new Set(order.map((effect) => effect.key));
  for (const [key, cell] of cells) {
    if (!shown.has(key)) {
      cell.el.remove();
    }
  }
  for (const [at, effect] of order.entries()) {
    const cell = cells.get(effect.key);
    paint(cell, effect);
    place(cell.el, at);
  }
}

/** One chime for a reading that brought news, however many effects landed in it. */
function chime() {
  if (primed && settingFlag('cue', true)) {
    woc.sound.alert();
  }
}

/**
 * Rebuild the set of tiles from what is removable. A cell already up is kept rather than
 * rebuilt, so a tile does not lose a hover or a tooltip every time anything else in
 * front of the player changes.
 */
function sync(effects) {
  const seen = new Set(effects.map((effect) => effect.key));
  for (const [key, cell] of cells) {
    if (!seen.has(key)) {
      cell.ui.destroy();
      cell.el.remove();
      cells.delete(key);
    }
  }
  let arrived = false;
  for (const effect of effects) {
    if (!cells.has(effect.key)) {
      cells.set(effect.key, createCell(effect));
      arrived = true;
    }
  }
  if (arrived) {
    chime();
  }
  primed = live();
}

function resync() {
  const effects = reading();
  sync(effects);
  if (frame.visible) {
    draw(effects);
  }
}

// One handler on the loop the loader already runs. It reads on every frame rather than
// waking on `world.on('party')`: a subscription reports an effect arriving on a group
// member, while this display also answers for the target and the pet, and it says
// nothing as an effect ticks down, so the countdowns need the frame anyway.
//
// It does not stand down while the strip is hidden, because the cue is the half of this
// display that works when nobody is looking. Only the drawing is skipped.
woc.onFrame(resync);

woc.keys.bind('toggle', () => {
  frame.toggle();
});

// Every setting moves what the next reading contains or how much of it is drawn, and
// the next reading is one frame away, so there is nothing to subscribe to.
