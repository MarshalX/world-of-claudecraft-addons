/// <reference types="@woc-addons/types" />

// Purelight: the effects in front of you that can actually be removed.
//
// Everything else is absent rather than dimmed or sorted lower, because the triage is
// the feature. Nothing can be removed FROM here: the loader never sends, so this says
// what is worth a global and the player spends it.
//
// Removability is the game's own rule, published as `world.dispellable(aura, offensive)`
// and never worked out here: not permanent, not unbreakable control, not an undispellable
// penalty, not the physical school, and the polarity the direction asks for. The direction
// is per unit, from `Entity.hostile`, so one strip covers lifting a debuff off a friend
// and stripping a buff off an enemy.
//
// THAT RULE HAS A HOLE THE GAME OPENED AT 0.41.0 AND NO CLIENT CAN CLOSE. Its classifier
// refuses an `encounterOwned` aura ahead of every clause above, and `wireAura` does not
// send the flag (`perm`, `ub`, `und` and `bt` and nothing else), so `dispellable` answers
// true for most of what the Ignivar and Varkhul fights put on a raid. `refused.json` is
// every aura id the game refuses for a reason the wire cannot carry, read out of a checkout
// by `generate.mjs`, and those are held back rather than drawn.
//
// The holding is SAID, on a held tile naming the game version the table was read at: a
// strip that quietly went empty mid-fight would read as a measurement of zero, and a list
// read at one version cannot cover a mechanic added after it.
//
// Only an ENTITY is read, never a party row: a row exists for a member across the map
// where an entity does not, and it carries neither school nor `unbreakableControl`,
// which are the two clauses whose absence costs a global. Nothing is inferred from an
// aura's `value` or a row's `neg` either, since both are magnitudes rather than
// polarities: a dot carries a positive figure per tick exactly as a hot does.
//
// A tile draws the applying ability's art only where a PLAYER applied it: art is filed
// per player class and an aura carries none, so the caster is the only route, and a
// control aura is that ability with a tail on its id (see `AURA_SUFFIXES`). A mob's
// aura is composited on a canvas no addon can reach, so those tiles carry the mob's own
// PORTRAIT instead, which is the case a raid is made of: nearly everything dispellable
// off a group came from a mob, and without it a PvE strip is squares of school colour.
// Whose face it is, is said in the tooltip and in the accessible name.
//
// The strip's width is only room to grow into: tiles sized to fill it would shrink as
// more effects landed.

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

/**
 * The kinds that stop a player acting. Every one is checked against
 * `KnownHarmfulAuraKind` rather than written from what a control effect is usually
 * called, since naming a kind that does not exist is silent in both directions: a fear
 * is `incapacitate`, and `fear` is the diminishing-returns category it files under.
 *
 * A kind added by a later release ranks as ordinary rather than being dropped, which
 * costs one position in the order. That is why the ranking may be a judgement while
 * removability may not.
 */
const CONTROL_KINDS = ['stun', 'incapacitate', 'polymorph', 'silence', 'root'];
const CONTROL_RANK = 2;
const DAMAGE_RANK = 1;
const ORDINARY_RANK = 0;

/** Why a tile is here, in the direction the unit carrying it points. */
const DISPEL_REASON = 'Removable: harmful, not physical, and nothing known holds it.';
const PURGE_REASON = 'Removable: a benefit on a hostile unit, and not physical.';

/** The table of ids the game refuses for a reason the wire does not carry. */
const REFUSED_TABLE = 'refused.json';
/** What the held tile is captioned, in the band a name goes in on every other cell. */
const HELD_CAPTION = 'held';

/**
 * The tails the game appends when an ability's effect becomes a control aura, read out of
 * its own effect dispatch. Copied rather than shared, since an addon is one file with no
 * imports; Facemark carries the same table.
 *
 * Stripping one is correct by construction, since the id was built by concatenation, but
 * the spellbook is asked FIRST because five real ability ids end in what looks like a
 * tail (`brain_freeze`, `deep_freeze`, `dismiss_pet`, `mend_pet`, `revive_pet`).
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

/**
 * Whether a cue has news yet. The first reading of a live world is everything already up,
 * so without this an addon enabled mid-fight chimes once per effect on the group.
 */
let primed = false;

/** Whether this reading built a cell. Set from `createCell`, which is what knows. */
let arrived = false;

/**
 * The ids the game refuses whatever `world.dispellable` says, and the game version they were
 * read at. Empty until the table lands, which is before any player is in front of anything.
 */
const refused = new Set();
let refusedAt = null;

/**
 * Take the table in. A malformed one is logged and the strip goes back to offering encounter
 * effects, with the held tile never appearing to imply otherwise.
 */
function readRefused(table) {
  const rows = table?.auras;
  if (!Array.isArray(rows)) {
    woc.error(`${REFUSED_TABLE} carries no aura list; effects an encounter owns will be offered`);
    return;
  }
  for (const row of rows) {
    if (typeof row?.id === 'string') {
      refused.add(row.id);
    }
  }
  if (typeof table.gameVersion === 'string') {
    refusedAt = table.gameVersion;
  }
}

woc.data(REFUSED_TABLE).then(readRefused, (err) => {
  woc.error(`could not read ${REFUSED_TABLE}: ${String(err)}`);
});

/**
 * The row the tiles sit in. The held tile is a sibling of `list` rather than a child, since the
 * kit owns `list`'s children and would reorder a foreign one; `display: contents` keeps one row.
 */
const strip = document.createElement('div');
strip.className = 'woc-pl-strip';
strip.style.display = 'flex';
strip.style.gap = '4px';

const list = document.createElement('div');
list.className = 'woc-pl-list';
list.style.display = 'contents';
strip.appendChild(list);

/**
 * One cell per aura, the whole reading held and `shown` cutting it to the tile budget: a
 * cell dropped off the end would take its tooltip and its decoded art with it and land
 * back a moment later whenever the ordering moved. See `keyFor` for what makes an aura
 * one rather than another.
 */
const cells = woc.ui.list({
  parent: list,
  key: (effect) => effect.key,
  create: createCell,
  update: paintCell,
  shown: (_effect, index) => index < woc.settings['max-tiles'],
  element: (cell) => cell.el,
});

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
  toggleKey: 'toggle',
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
frame.body.appendChild(strip);

/**
 * Follow the strip's height, which is one square and the caption under it. The box comes
 * from the loader; measuring the element would force a synchronous layout on every
 * pointer move. The floor is applied here as well as stated on the frame, since the
 * arithmetic has to hold for a box from anywhere: a restored one, a viewport clamp, or a
 * height a future bound lets through.
 *
 * It records the answer and nothing else; `sizeCell` carries it to the cells already up
 * on the next reading, one frame away.
 */
function resize(height) {
  // One unit under a fixed band, which is what `extra` is for: the caption is space the
  // square never gets, and the floor holds for a box from anywhere.
  tileSize = woc.ui.units(height, { extra: CAPTION_HEIGHT, min: TILE_FLOOR });
}

/**
 * Put one cell at the size the strip is at now. The cell is the square's width, so the
 * caption truncates against the art rather than against a column that stayed 40 wide.
 * The tile is updated rather than rebuilt, or every pointer move would throw away art
 * the browser has decoded.
 *
 * The size it last wrote is held on the cell, since this runs on every reading. The kit
 * drops the tile half; the WIDTH is this addon's own div and nothing defends it, so
 * without the guard a strip nobody is dragging writes a style attribute per cell per
 * frame to say it has not moved.
 */
function sizeCell(cell) {
  if (cell.size === tileSize) {
    return;
  }
  cell.size = tileSize;
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
 * Every unit this answers for, once each. Collected by entity id rather than by token,
 * since your target is very often in your own group and would be drawn twice.
 *
 * A member is looked up by pid rather than through a `partyN` token: that numbering
 * shifts the moment the player is left out of the walk, and a shift captions one member's
 * effects with another's name.
 */
function units() {
  const found = new Map();
  const add = (entity) => {
    if (entity !== null && entity !== undefined && !found.has(entity.id)) {
      found.set(entity.id, entity);
    }
  };
  const mine = woc.world.player?.id ?? null;
  if (woc.settings['include-player']) {
    add(woc.world.player);
    add(woc.world.unit('pet'));
  }
  for (const member of woc.world.party?.members ?? []) {
    if (member.pid !== mine) {
      add(woc.world.entities.get(member.pid));
    }
  }
  if (woc.settings['include-target']) {
    add(woc.world.target);
  }
  return [...found.values()];
}

/**
 * What art is filed under: the aura's own id wherever the spellbook names one, since an
 * id it can name is an ability id by definition. Otherwise the tail comes off.
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
 * The picture for a tile, and whether it is the caster's face rather than the effect's own.
 *
 * Only a player-applied aura resolves to ability art: it is filed per player class, and a mob has
 * no class directory to look under. A mob's PORTRAIT is a file, though, and every catalogued
 * template ships one, so its effect is pictured by the thing that applied it. That case is most of
 * a raid rather than a corner: nearly everything dispellable off a group came from a mob, so
 * without it the strip a PvE player reads is squares of school colour.
 *
 * An npc is deliberately left out. The game draws a crest for one rather than a portrait, so
 * `/ui/mobs/` would 404 and the square would come back empty by a longer route.
 */
function artOf(aura, caster) {
  if (caster === null) {
    return { icon: null, portrait: false };
  }
  if (caster.kind === 'player') {
    return { icon: woc.ui.icon.ability(artId(aura.id), caster.templateId), portrait: false };
  }
  if (caster.kind !== 'mob') {
    return { icon: null, portrait: false };
  }
  return { icon: woc.ui.icon.mob(caster.templateId), portrait: true };
}

/**
 * Not the ability id on its own: two players can carry the same debuff on one target, and
 * keying on the id alone collapses the pair into one tile counting one of them. So the
 * caster is in the key, and an ordinal covers what the caster cannot, since `sourceId` is
 * 0 wherever the game did not say who applied something.
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
    ...artOf(aura, caster),
    remaining: aura.remaining,
    duration: aura.duration,
    stacks: aura.stacks ?? 0,
  };
}

/**
 * The game's own classifier, then the one answer it cannot give. The floor is applied HERE so
 * an effect too short to have been drawn is not counted as held either.
 */
function removableOn(unit, floor, tally) {
  const seen = new Map();
  const found = [];
  for (const aura of unit.auras ?? []) {
    if (woc.world.dispellable(aura, unit.hostile) && aura.remaining >= floor) {
      if (refused.has(aura.id)) {
        tally.held += 1;
      } else {
        found.push(effectFrom(unit, aura, keyFor(unit, aura, seen)));
      }
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
 * Worst first, and within a rank the LONGEST left, which is the opposite of a cooldown
 * list: an effect about to fall off on its own is the one not worth a global.
 */
function worstFirst(a, b) {
  const rank = severity(b) - severity(a);
  if (rank !== 0) {
    return rank;
  }
  return b.remaining - a.remaining;
}

/** Everything removable in front of you right now, worst first, and how much was held back. */
function reading() {
  const floor = woc.settings['min-seconds'];
  const tally = { held: 0 };
  const found = [];
  for (const unit of units()) {
    found.push(...removableOn(unit, floor, tally));
  }
  return { effects: found.sort(worstFirst), held: tally.held };
}

/** Stacks in the corner, or nothing at all for the ordinary single application. */
function stackCount(effect) {
  if (effect.stacks > 1) {
    return effect.stacks;
  }
  return null;
}

/**
 * A duration of zero is a permanent effect or one the game did not state, and a full tile
 * is right for both: an empty one reads as expired.
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
 * A function, so it answers with what is left NOW rather than when the tile was built.
 * The caster is named where the game said who it was, which is what tells two tiles of
 * the same debuff on one unit apart.
 */
function tooltipFor(key) {
  const effect = reading().effects.find((row) => row.key === key);
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
  if (effect.portrait) {
    lines.push({
      text: 'Pictured: the mob that applied it. Its effect has no icon of its own.',
      tone: 'muted',
    });
  }
  lines.push({ text: reasonFor(effect), tone: 'good' });
  return { title: effect.name, lines };
}

/**
 * How a square is announced. A tile's whole face is art, so a screen reader gets none of it, and
 * a portrait is the caster rather than the effect: whose face it is has to be said rather than
 * looked at.
 */
function labelFor(effect) {
  const said = `${effect.who}: ${effect.name}`;
  if (!effect.portrait || effect.from === null) {
    return said;
  }
  return `${said}, from ${effect.from}`;
}

/**
 * A square with a caption band under it, which is the one column shape on the strip. The
 * caption is not something the kit draws, since a tile's whole face is art and `label` is
 * only how it is announced, and a healer needs to read who is carrying the effect by eye.
 * Shared with the held tile because the band's height is what the drag solves back for.
 */
function createColumn(tile, className) {
  const cell = document.createElement('div');
  cell.className = className;
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
  cell.append(tile.el, name);
  return { ui: tile, el: cell, name, size: 0, destroy: tile.destroy };
}

function createCell(effect) {
  const tile = woc.ui.tile({
    label: labelFor(effect),
    icon: effect.icon,
    school: effect.school,
    className: 'woc-pl-tile',
  });
  const built = createColumn(tile, 'woc-pl-cell');
  built.el.dataset.effect = effect.key;
  built.name.textContent = effect.who;
  // Whatever the strip is at now, so a tile appearing mid-fight matches its neighbours.
  // It is sized here as well as on every reading, because a cell built while the strip is
  // hidden is never painted and would otherwise open at the kit's own default.
  sizeCell(built);
  woc.ui.tooltip(built.el, () => tooltipFor(effect.key));
  arrived = true;
  return built;
}

/**
 * Tell one cell where its effect has got to. The label and the art are rewritten as well
 * as the figures, because a cell outlives one reading: the caster's art resolves only
 * once the class manifest has been read, so a tile built before that would keep an empty
 * icon slot for the life of the effect.
 *
 * Only the DRAWING stands down while the strip is hidden: the reading and the cue are the
 * half of this display that works when nobody is looking.
 */
function paintCell(cell, effect) {
  if (!frame.visible) {
    return;
  }
  sizeCell(cell);
  cell.name.textContent = effect.who;
  cell.ui.update({
    label: labelFor(effect),
    icon: effect.icon,
    fraction: fractionOf(effect),
    value: woc.fmt.duration(effect.remaining),
    count: stackCount(effect),
    school: effect.school,
  });
}

/**
 * What the held tile says on hover. It names the game version rather than describing it, and
 * says "the game refuses" rather than "an encounter owns" because the table carries a second
 * kind of refusal as well.
 */
function heldTooltip(count) {
  let read = 'an unknown game version';
  if (refusedAt !== null) {
    read = `game ${refusedAt}`;
  }
  return {
    title: `${effectsSaid(count)} held back`,
    lines: [
      'The game refuses these, so no dispel of any kind will take them off. Most are mechanics a raid encounter owns.',
      {
        text: `Nothing on the wire says which effects those are, so this is a list of ids read at ${read}. Anything the game has added since is still offered above.`,
        tone: 'muted',
      },
    ],
  };
}

/** "1 effect" or "3 effects". */
function effectsSaid(count) {
  if (count === 1) {
    return '1 effect';
  }
  return `${String(count)} effects`;
}

/** What the last reading held, so the tooltip answers for the strip as it is drawn. */
let lastHeld = 0;

/**
 * The one column that is not an effect: how many were held back. No art and no school, so it
 * cannot be misread as something to act on; the count goes in `value` rather than `count`,
 * which is the stacks corner and badge-sized.
 */
const heldCell = createColumn(
  woc.ui.tile({ label: null, className: 'woc-pl-held' }),
  'woc-pl-cell woc-pl-held-cell',
);
heldCell.name.textContent = HELD_CAPTION;
heldCell.el.dataset.held = HELD_CAPTION;
heldCell.el.style.display = 'none';
heldCell.el.style.opacity = '0.75';
woc.ui.tooltip(heldCell.el, () => heldTooltip(lastHeld));
strip.appendChild(heldCell.el);

/** Put the held tile where the reading left it, or take it off the strip entirely. */
function paintHeld(count) {
  lastHeld = count;
  if (count === 0) {
    heldCell.el.style.display = 'none';
    return;
  }
  heldCell.el.style.display = 'flex';
  if (!frame.visible) {
    return;
  }
  sizeCell(heldCell);
  heldCell.ui.update({
    label: `${effectsSaid(count)} held back, which no dispel will remove`,
    value: String(count),
  });
}

/** One chime for a reading that brought news, however many effects landed in it. */
function chime() {
  if (primed && woc.settings.cue) {
    woc.sound.alert();
  }
}

/**
 * Apply one reading. A cell already up is kept rather than rebuilt, so a tile does not
 * lose a hover or a tooltip every time anything else in front of the player changes. The
 * whole reading goes in, past the tile budget included; see `cells`.
 *
 * The held count is deliberately NOT chimed: the cue means something worth a global landed.
 */
function resync() {
  arrived = false;
  const now = reading();
  cells.sync(now.effects);
  paintHeld(now.held);
  if (arrived) {
    chime();
  }
  primed = live();
}

// One handler on the loop the loader already runs. It reads on every frame rather than
// waking on `world.on('party')`: a subscription reports an effect arriving on a group
// member, while this display also answers for the target and the pet, and it says
// nothing as an effect ticks down, so the countdowns need the frame anyway.
//
// It does not stand down while the strip is hidden, because the cue is the half of this
// display that works when nobody is looking. Only the drawing is skipped.
woc.onFrame(resync);

// Every setting moves what the next reading contains or how much of it is drawn, and
// the next reading is one frame away, so there is nothing to subscribe to.
