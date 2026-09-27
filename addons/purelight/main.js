/// <reference types="@woc-addons/types" />

// Purelight: the effects in front of you that can actually be removed.
//
// Everything else is absent, because the triage is the feature. Nothing is removed from here: the
// loader never sends, so this says what is worth a global and the player spends it.
//
// Removability is the game's own rule, `world.dispellable(aura, offensive)`, never worked out here.
// The direction is per unit, from `Entity.hostile`, so one strip covers a debuff on a friend and a
// buff on an enemy.
//
// The game also refuses an `encounterOwned` aura, and that flag is not on the wire, so
// `dispellable` answers true for encounter effects the game will not remove. `refused.json`,
// written by `generate.mjs` from a checkout, lists every id refused for a reason the wire cannot
// carry; those are held back, and a held tile says so and names the game version the table was read
// at, so a strip that empties mid-fight does not read as zero.
//
// Only an ENTITY is read, never a party row: a row carries neither school nor `unbreakableControl`,
// the two clauses whose absence costs a global. An aura's `value` and a row's `neg` are magnitudes
// rather than polarities, so nothing is inferred from them.
//
// A player-applied tile draws the ability's art (see `AURA_SUFFIXES`); a mob-applied one draws the
// mob's portrait, since mob aura art is composited on a canvas no addon can reach. The tooltip and
// accessible name say whose face it is.

/** The tile strip's starting square and its floor: the game's 40px tap-target floor. */
const TILE_FLOOR = 40;
/**
 * The caption band under a square. Stated rather than measured, because a drag solves the strip's
 * height back for the square.
 */
const CAPTION_HEIGHT = 14;
const CAPTION_FONT = 11;
/**
 * How wide the strip starts; only room to grow into, since tiles sized to fill it would shrink as
 * effects landed.
 */
const STRIP_WIDTH = 300;
const DECIMALS = 1;

/**
 * The kinds that stop a player acting, each checked against `KnownHarmfulAuraKind`: a wrong kind
 * name is silent. A fear is `incapacitate`; `fear` is only its diminishing-returns category.
 *
 * A kind a later release adds ranks as ordinary, which costs one position; that is why the ranking
 * may be a judgement while removability may not.
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
 * The tails the game appends when an ability's effect becomes a control aura. Copied, since an
 * addon has no imports; Facemark carries the same table.
 *
 * The spellbook is asked FIRST because real ability ids end in what looks like a tail
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

/**
 * Whether a cue has news yet. The first reading is everything already up, so without this an addon
 * enabled mid-fight chimes once per effect.
 */
let primed = false;

/** Whether this reading built a cell. Set from `createCell`. */
let arrived = false;

/**
 * The ids the game refuses whatever `world.dispellable` says, and the game version they were read
 * at. Empty until the table lands.
 */
const refused = new Set();
let refusedAt = null;

/**
 * Take the table in. A malformed one is logged and the strip goes back to offering encounter
 * effects, with no held tile.
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
 * The row the tiles sit in. The held tile is a sibling of `list`, since the kit owns and reorders
 * `list`'s children; `display: contents` keeps one row.
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
 * One cell per aura for the whole reading, with `shown` cutting it to the tile budget: a dropped
 * cell would lose its tooltip and decoded art and come back whenever the order moved. See `keyFor`.
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

/** The square the strip is drawing at now: its height less the caption. */
let tileSize = TILE_FLOOR;

/**
 * Bare, because the tiles are the display. The title is the accessible name and the label shown
 * while frames are unlocked.
 */
const frame = woc.ui.frame({
  id: 'strip',
  title: 'Purelight',
  width: STRIP_WIDTH,
  // Stated, because a frame with no height opens at the kit's fallback and leaves an invisible drag
  // area. A content-sized frame is also never given a box, so it could not be dragged.
  height: stripHeight(TILE_FLOOR),
  density: 'bare',
  save: true,
  toggleKey: 'toggle',
  // Resizable, because how big a square must be to read at a glance is the player's call.
  resizable: true,
  // Both stated, or the frame takes its opening size as its floor. Constants, so the floor is the
  // tap-target square whatever the tile budget.
  minWidth: TILE_FLOOR,
  minHeight: stripHeight(TILE_FLOOR),
  onMove: (box) => {
    resize(box.h);
  },
});
frame.body.appendChild(strip);

/**
 * Follow the strip's height, one square plus the caption. The box comes from the loader, because
 * measuring the element forces a layout on every pointer move. The floor is applied here too, since
 * the box can come from a restore or a viewport clamp. `sizeCell` carries the answer to the cells
 * on the next reading.
 */
function resize(height) {
  // The caption is space the square never gets, which is what `extra` is for.
  tileSize = woc.ui.units(height, { extra: CAPTION_HEIGHT, min: TILE_FLOOR });
}

/**
 * Put one cell at the strip's current size. The cell is the square's width, so the caption
 * truncates against the art. The tile is updated rather than rebuilt, or every pointer move would
 * throw away decoded art.
 *
 * The last size is held on the cell because the kit guards the tile but nothing guards this div's
 * width, which would otherwise be written per cell per frame.
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
 * Whether there is a world to read. The addon runs from document-start, where the landing page has
 * nobody. See `primed`.
 */
function live() {
  return woc.world.player !== null;
}

/**
 * Every unit this answers for, once each, keyed by entity id since your target is often in your own
 * group.
 *
 * A member is looked up by pid rather than a `partyN` token: that numbering shifts when the player
 * is left out of the walk, which would caption one member's effects with another's name.
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
 * What art is filed under: the aura's own id wherever the spellbook names one, otherwise the id
 * with its tail removed.
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
 * Ability art is filed per player class, so only a player-applied aura resolves to it. A mob's
 * effect is pictured by the mob's portrait, which is most of a raid. An npc is left out: the game
 * draws a crest for one, so `/ui/mobs/` would 404.
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
 * Keyed by caster as well as id, or two players' copies of one debuff collapse into one tile. The
 * ordinal covers `sourceId` 0, which is what the game sends when it did not say who applied
 * something.
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
 * The game's own classifier, then the one answer it cannot give. The duration floor applies HERE so
 * an effect too short to draw is not counted as held.
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
 * Worst first, and within a rank the LONGEST left: an effect about to fall off on its own is not
 * worth a global.
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
 * A duration of zero is permanent or unstated, and a full tile is right for both; an empty one
 * reads as expired.
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
 * A function, so it answers with what is left NOW. The caster is named where known, which tells two
 * tiles of one debuff apart.
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
 * How a square is announced. A tile's face is art, and a portrait is the caster rather than the
 * effect, so whose face it is has to be said.
 */
function labelFor(effect) {
  const said = `${effect.who}: ${effect.name}`;
  if (!effect.portrait || effect.from === null) {
    return said;
  }
  return `${said}, from ${effect.from}`;
}

/**
 * A square with a caption band under it. The kit draws no caption (`label` is only announced), and
 * a healer needs to read who carries the effect. Shared with the held tile because the drag solves
 * back for the band's height.
 */
function createColumn(tile, className) {
  const cell = document.createElement('div');
  cell.className = className;
  cell.style.display = 'flex';
  cell.style.flexDirection = 'column';
  cell.style.alignItems = 'center';
  // A flex item shrinks by default, which would squash the squares when the strip is narrower than
  // its content.
  cell.style.flexShrink = '0';
  const name = document.createElement('span');
  name.className = 'woc-pl-name';
  name.style.overflow = 'hidden';
  name.style.textOverflow = 'ellipsis';
  name.style.whiteSpace = 'nowrap';
  name.style.maxWidth = '100%';
  name.style.fontSize = `${String(CAPTION_FONT)}px`;
  // Stated both ways, because the drag solves back for the square.
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
  // Sized at the strip's current size here as well as on every reading, because a cell built while
  // the strip is hidden is never painted and would open at the kit's default.
  sizeCell(built);
  woc.ui.tooltip(built.el, () => tooltipFor(effect.key));
  arrived = true;
  return built;
}

/**
 * Update one cell. The label and art are rewritten too, because a cell outlives a reading and the
 * caster's art resolves only once the class manifest is read.
 *
 * Only the DRAWING stands down while the strip is hidden; the reading and the cue still run.
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
 * What the held tile says on hover. It says "the game refuses" rather than "an encounter owns"
 * because the table carries a second kind of refusal.
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

/** What the last reading held, so the tooltip matches the strip as drawn. */
let lastHeld = 0;

/**
 * The held count. No art and no school, so it cannot be misread as something to act on; the count
 * goes in `value` because `count` is the small stacks corner.
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
 * Apply one reading. A cell already up is kept, so a tile keeps its hover and tooltip. The whole
 * reading goes in, past the tile budget; see `cells`.
 *
 * The held count is NOT chimed: the cue means something worth a global landed.
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

// Read on every frame rather than on `world.on('party')`: that reports only group members, while
// this also answers for the target and the pet, and the countdowns need the frame anyway. It keeps
// running while the strip is hidden, because the cue still works.
woc.onFrame(resync);

// Every setting only changes the next reading, one frame away, so there is nothing to subscribe to.
