/// <reference types="@woc-addons/types" />

// Facemark: the nameplate the game does not draw.
//
// Plates sit on `ui.anchor3d({ unit, over: 'head' })`, which folds in model height, mount lift
// and scale, none of which is on the wire, so there must be no offset setting. That point
// resolves to nothing past about eighty yards, so the draw distance caps below that.
//
// Side comes from `world.reaction`, asked once per unit per pass. `entity.hostile` is set only
// on mobs, so it is false on every player, battleground enemies included.
//
// No plate where the game always draws its own: an NPC and a lootable corpse get the game's
// plate whatever the player's toggles say (`V` hides living mobs; player plates are options).
//
// Rank (`elite`, `boss`) and rarity (`rare`) are independent flags, so a rare can carry no rank.
// Neither is on the wire: `longwatch` publishes the game's mob table on the bus, and everything
// here works with nothing published, because a companion is not a dependency.
//
// Deliberately omitted: guild tag, deed title, community role and account badges (cosmetics on
// a 132px row), quest markers (nothing on the wire to build them from), and the overhead emote
// (the game paints its own bubble over the head regardless).
//
// A mob's aura has no art, since the game composites aura icons at run time. A cast carries no
// school, so its bar cannot be tinted. A mob ability's name and an activity sentinel are derived
// from the id, so both end in a question mark.
//
// Two loops. Every frame: health, the cast bar, and the one projection the fade and declutter
// share, since both follow the camera. Every 100 ms: which units have a plate, auras, threat,
// mark, tags and pips, none of which a watch key reports (`world.on('entities')` is membership).
//
// The cap is by distance from the player, never by depth from the camera: depth would change
// which units get a plate as the player turned.

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
/** Health count goes in the bar's label on the left, compacted; the share keeps the right. */
const THOUSAND = 1000;
const MILLION = 1_000_000;
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
 * The game builds a control aura's id as `${ability.id}_slow`, so art under the whole id 404s.
 * Real ability ids end in some of these (`brain_freeze`, `dismiss_pet`, `revive_pet`), so the
 * spellbook is asked before any tail comes off.
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

/** The game's own team tokens, so a carrier tag matches the colours its battleground HUD uses. */
const TEAM_RED = 'var(--color-team-red)';
const TEAM_BLUE = 'var(--color-team-blue)';
/** Short, because it sits on a row that already holds a name and a level. */
const CARRY_LABEL = 'Flag';

/** The game's own away prefix, in the game's own position: before the name. */
const AFK_TAG = '<AFK>';
/** One word each, for the same reason the carrier tag is one: the row is 132px wide. */
const MOUNTED_NOTE = 'mounted';
const RESTING_NOTE = 'resting';
const AI_TAG = 'AI';
/** The operators' Cheater tag, spelled as the game draws it on its own plate and target frame. */
const CHEATER_TAG = '< Cheater >';
/** The one colour here that is not the game's: its tag colour is not a token. */
const CHEATER_COLOUR = '#ff6b6b';

/** The topic `longwatch` publishes its mob table on. `follow` derives `mobs:ask` from it. */
const RANKS_TOPIC = 'mobs';
/**
 * What a rank puts after the level. The game writes an elite as `{level}+` and marks a boss
 * by its frame alone, so `++` is ours: the two ranks must not read identically.
 */
const RANK_SUFFIX = { elite: '+', boss: '++' };

/** The game's threat red, then the kit's warn and calm, so an edge and a bar share a vocabulary. */
const EDGE_NONE = 'transparent';
const EDGE_TOP = 'rgb(192 57 43)';
const EDGE_CLOSE = 'rgb(200 168 56)';
const EDGE_CALM = 'rgb(120 160 255 / 60%)';

/** The game's own index order. The name is what a screen reader gets; the glyph is what is drawn. */
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
/** The game's own outline, under every mark's fill. */
const MARK_INK = '#0d0d12';
const MARK_PX = 13;
/** The three the generic stroke-and-fill path cannot draw, by their index in the game's order. */
const MARK_MOON = 4;
const MARK_CROSS = 6;
const MARK_SKULL = 7;
/** The game draws these in a 100 unit box centred on the origin, which is what the paths are in. */
const MARK_BOX = '-50 -50 100 100';
const MARK_STROKE = 9;
/**
 * The eight marks as paths, transcribed from the game's canvas geometry: mark art is
 * composited at run time, so there is no file to fetch.
 *
 * Draw with `paint-order: stroke`. Canvas strokes then fills; SVG's default fill-first
 * doubles the outline's visible weight and shrinks every mark inside it.
 */
const MARK_PATHS = [
  'M 0,-42 L 10,-13.8 L 39.9,-13 L 16.2,5.3 L 24.7,34 L 0,17 L -24.7,34 L -16.2,5.3 ' +
    'L -39.9,-13 L -10,-13.8 Z',
  'M -37,0 A 37,37 0 1 1 37,0 A 37,37 0 1 1 -37,0 Z',
  'M 0,-42 L 38,0 L 0,42 L -38,0 Z',
  'M 0,-40 L 38,32 L -38,32 Z',
  '',
  'M -34,-34 H 34 V 34 H -34 Z',
  '',
  'M -30,-10 A 30,30 0 0 1 30,-10 L 30,6 Q 30,20 16,23 L 13,35 Q 0,41 -13,35 L -16,23 ' +
    'Q -30,20 -30,6 Z',
];
/** The crescent is a circle with a bite out of it, which is one path under `evenodd`. */
const MOON_DARK =
  'M -44,0 A 40,40 0 1 1 36,0 A 40,40 0 1 1 -44,0 Z M -20,0 A 40,40 0 1 1 60,0 A 40,40 0 1 1 -20,0 Z';
const MOON_LIT =
  'M -38,0 A 34,34 0 1 1 30,0 A 34,34 0 1 1 -38,0 Z M -17,0 A 40,40 0 1 1 63,0 A 40,40 0 1 1 -17,0 Z';
/** Two round-capped bars, a wide dark pass and a narrow coloured one over it. */
const CROSS_PATH = 'M -28,-28 L 28,28 M 28,-28 L -28,28';
const CROSS_INK_WIDTH = 28;
const CROSS_FILL_WIDTH = 16;
/** Both eyes and the nose, cut back out of the skull in the outline colour. */
const SKULL_FEATURES =
  'M -20,-7 A 8,9 0 1 1 -4,-7 A 8,9 0 1 1 -20,-7 Z M 4,-7 A 8,9 0 1 1 20,-7 A 8,9 0 1 1 4,-7 Z ' +
  'M 0,3 L 5,14 L -5,14 Z';

/**
 * The game's nameplate con bands (`mobNameColor`), NOT its tooltip's (`mobTooltipConColor`),
 * which spread differently. A corpse is grey at any level; a friendly pet takes friendly green.
 */
const CON_RED = 'rgb(255 68 68)';
const CON_ORANGE = 'rgb(255 170 51)';
const CON_YELLOW = 'rgb(255 233 122)';
const CON_GREEN = 'rgb(127 220 79)';
const CON_GREY = 'rgb(157 157 157)';
const CON_FRIENDLY = 'rgb(159 220 127)';
const CON_DEAD = 'rgb(153 153 153)';
const CON_RED_FROM = 3;
const CON_ORANGE_FROM = 1;
const CON_YELLOW_FROM = -2;
const CON_GREEN_FROM = -5;

/**
 * The health bar's edge carries rank and the current target, in the game's precedence: boss,
 * then elite, then target. Rank is not on the level because the level carries con.
 */
const STROKE_BOSS = 'rgb(255 85 85)';
const STROKE_ELITE = 'rgb(242 200 75)';
const STROKE_TARGET = 'rgb(255 255 255 / 67%)';
const STROKE_BOSS_PX = 2;
const STROKE_THIN_PX = 1;

/** Combo points cap at five in the game, and a pip row with none lit is not drawn at all. */
const COMBO_MAX = 5;
const PIP_PX = 5;
/** A spent pip stays visible: the row says five, of which this many are yours. */
const PIP_ON = 'rgb(255 226 58)';
const PIP_OFF = 'rgb(255 255 255 / 22%)';

/** The game's own translucency for a stealthed unit, multiplied into the distance fade. */
const STEALTH_FADE = 0.55;
/** One step over the plate's own size, which is the step the game's own name row takes. */
const TARGET_FONT = '13px';

/** A shield over the bar past the health: the game's own `.bar-absorb` hatch, transcribed. */
const ABSORB_FILL =
  'repeating-linear-gradient(115deg, rgb(255 255 255 / 42%) 0 5px, rgb(190 225 255 / 16%) 5px 10px)';

/** A resource strip, drawn only where the entity has a resource (players and caster mobs). */
const POWER_PX = 3;
/**
 * The game's own resource tokens, so the strip follows its theme picker. `ResourceType` is an
 * open set the game grows, so the fallback is a real case.
 */
const POWER_COLOURS = {
  mana: 'var(--color-mana)',
  rage: 'var(--color-rage)',
  energy: 'var(--color-energy)',
  focus: 'var(--color-focus)',
};
const POWER_FALLBACK = 'rgb(150 150 150)';

/** Somebody else's kill: the classic grey that says the loot is not yours. */
const TAPPED_NAME = 'rgb(150 150 150)';

/** A cast pointed at YOU, which nothing in the game says anywhere. */
const AT_YOU = 'at you';
/**
 * Rarity, a flag separate from rank. A word rather than a mark, because the mark slot means
 * somebody chose it.
 */
const RARE_TAG = 'rare';
const RARE_COLOUR = 'rgb(214 220 235)';

/** A taunt holding a mob on you, and how long is left of it. */
const TAUNT_TAG = 'taunt';
/** Control an encounter owns, which no trinket breaks. */
const UNBREAKABLE = 'unbreakable';

/** The game's own corpse grey, which reads as past tense whoever it was. */
const CORPSE_NAME = 'rgb(187 187 187)';

/**
 * The game's declutter thresholds, in screen pixels. Plates within this box are one stack,
 * spread around its own mean so nothing jumps when a third joins. The plate count is capped by
 * a setting, so a pairwise pass is enough and the game's spatial hash is not needed.
 */
const DECLUTTER_X = 80;
const DECLUTTER_Y = 18;
const STACK_PX = 20;

const plates = new Map();

/** Reused rather than returned, so a pass over forty entities allocates nothing. */
const wanted = [];

/** Where each plate landed this frame, and one cluster of them being spread apart. */
const spots = [];
const cluster = [];

/** Whoever is holding a flag right now. Empty outside a battleground. */
const carriers = new Set();

/**
 * Template id to what `longwatch` says about it. Empty is the ordinary state (companion absent,
 * off or not ready), and everything keyed on it degrades to an undecorated plate.
 */
const ranks = new Map();

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

/** A player's class for the bar tint; `templateId` is a mob template id on anything else. */
function unitClassOf(entity) {
  if (entity.kind !== 'player') {
    return null;
  }
  return entity.templateId;
}

/** Leading digits only: `1.3K` rather than `1347`. */
function compact(count) {
  const whole = Math.round(count);
  if (!Number.isFinite(whole) || whole < 0) {
    return '';
  }
  if (whole >= MILLION) {
    return `${(whole / MILLION).toFixed(DECIMALS)}M`;
  }
  if (whole >= THOUSAND) {
    return `${(whole / THOUSAND).toFixed(DECIMALS)}K`;
  }
  return String(whole);
}

/** The count, or nothing for a corpse, whose label is the word beside it. */
function healthCount(entity) {
  if (entity.dead === true) {
    return '';
  }
  const hp = Number(entity.hp);
  if (!Number.isFinite(hp)) {
    return '';
  }
  return compact(hp);
}

/** Flag carriers only; side comes from `world.reaction`. */
function fillCarriers() {
  carriers.clear();
  const { match } = woc.world;
  if (match === null || match.format !== 'battleground') {
    return;
  }
  for (const flag of match.flags) {
    if (flag.carrierPid !== null) {
      carriers.add(flag.carrierPid);
    }
  }
}

/**
 * Which side a unit is on, asked once a pass. Never `entity.hostile`, which is false on every
 * player. Null (no roster entry) reads as neutral, the cheapest wrong answer.
 */
function standing(entity) {
  return woc.world.reaction(entity.id) ?? 'neutral';
}

function nameColourFor(side) {
  if (side === 'hostile') {
    return HOSTILE_NAME;
  }
  if (side === 'friendly') {
    return FRIENDLY_NAME;
  }
  return NEUTRAL_NAME;
}

function bareName(entity) {
  const { name } = entity;
  if (typeof name === 'string' && name !== '') {
    return name;
  }
  return `Unit ${String(entity.id)}`;
}

/** The player-only fields (afk, mount, sitting, account marks) hold inert defaults elsewhere. */
function isPlayer(entity) {
  return entity.kind === 'player';
}

/** The game's own away prefix, before the name as the game writes it. */
function nameOf(entity) {
  if (isPlayer(entity) && entity.afk === true) {
    return `${AFK_TAG} ${bareName(entity)}`;
  }
  return bareName(entity);
}

/**
 * What a player is doing, in one word, or nothing. `sitting` folds sitting, eating and drinking
 * into one bit on the wire, so `resting` is the label for all three.
 */
function stateNote(entity) {
  if (!isPlayer(entity)) {
    return '';
  }
  if (typeof entity.mountKey === 'string' && entity.mountKey !== '') {
    return MOUNTED_NOTE;
  }
  if (entity.sitting === true) {
    return RESTING_NOTE;
  }
  return '';
}

/** The operator-set AI-account mark: its own tag, since it is about the account, not the moment. */
function aiNote(entity) {
  if (isPlayer(entity) && entity.aiAccount === true) {
    return AI_TAG;
  }
  return '';
}

/**
 * The operator-applied Cheater mark, player-gated as the game gates it. Label only: no tone,
 * sort or filter, because the game keeps the mark power-neutral.
 */
function cheaterNote(entity) {
  if (isPlayer(entity) && entity.cheaterMark === true) {
    return CHEATER_TAG;
  }
  return '';
}

/** What the rank service says about this template, or null when nothing does. */
function rankOf(entity) {
  return ranks.get(entity.templateId) ?? null;
}

/** Rarity is its own flag, so a rare elite says both and a plain rare still says one. */
function rareNote(entity) {
  if (rankOf(entity)?.rare === true) {
    return RARE_TAG;
  }
  return '';
}

function levelText(entity) {
  const level = Number(entity.level);
  if (!Number.isFinite(level) || level <= 0) {
    return '';
  }
  const rank = rankOf(entity);
  if (rank === null || rank.rank === undefined) {
    return String(level);
  }
  return `${String(level)}${RANK_SUFFIX[rank.rank] ?? ''}`;
}

/** The level's con colour, mobs only: the game con-colours no player's level. */
function conColour(entity, side, player) {
  if (entity.kind !== 'mob') {
    return '';
  }
  if (entity.dead === true) {
    return CON_DEAD;
  }
  if (side === 'friendly') {
    return CON_FRIENDLY;
  }
  const gap = Number(entity.level) - Number(player.level);
  if (!Number.isFinite(gap)) {
    return '';
  }
  return conBand(gap);
}

function conBand(gap) {
  if (gap >= CON_RED_FROM) {
    return CON_RED;
  }
  if (gap >= CON_ORANGE_FROM) {
    return CON_ORANGE;
  }
  if (gap >= CON_YELLOW_FROM) {
    return CON_YELLOW;
  }
  if (gap >= CON_GREEN_FROM) {
    return CON_GREEN;
  }
  return CON_GREY;
}

/** Rank goes on the bar's edge, in the game's own precedence: a boss beats an elite. */
function strokeFor(entity, isTarget) {
  const rank = rankOf(entity);
  if (rank?.rank === 'boss') {
    return { colour: STROKE_BOSS, width: STROKE_BOSS_PX };
  }
  if (rank?.rank === 'elite') {
    return { colour: STROKE_ELITE, width: STROKE_THIN_PX };
  }
  if (isTarget) {
    return { colour: STROKE_TARGET, width: STROKE_THIN_PX };
  }
  return { colour: 'transparent', width: STROKE_THIN_PX };
}

/**
 * The game hides a quest-gated mob from a player not on its quest, so this does too. Only when
 * the table answered for the template; a null quest log (before world entry) is not on it.
 */
function questGated(entity) {
  const rank = rankOf(entity);
  if (rank === null || rank.requiresQuestId === undefined) {
    return false;
  }
  const progress = woc.world.quests?.log?.get(rank.requiresQuestId) ?? null;
  return progress === null || (progress.state !== 'active' && progress.state !== 'ready');
}

function distanceBetween(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** An unrecognised mode falls back to hostiles only. */
function askedFor(entity, side) {
  const mode = woc.settings.show;
  if (mode === 'everything') {
    return true;
  }
  if (side === 'hostile') {
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

/**
 * A dead player keeps a plate; a dead mob does not, because the game's corpse plate cannot be
 * turned off (`showNameplates` hides living mobs only).
 */
function corpseWorthDrawing(entity) {
  return entity.kind === 'player';
}

/**
 * A selected player always has a game plate (Show Player Nameplates exempts the target), so
 * this one would be a second. Players only: the game's mob rule has no target exception, so a
 * mob target may have no other plate at all.
 */
function doubledOnTarget(entity, player) {
  if (entity.kind !== 'player' || entity.id !== player.targetId) {
    return false;
  }
  return woc.settings['hide-selected-player'] === true;
}

/** No object (no health) and no NPC: no game toggle hides an NPC's own plate. */
function platable(entity, player, range) {
  if (entity.id === player.id || entity.kind === 'object' || entity.kind === 'npc') {
    return false;
  }
  if (entity.dead === true && !corpseWorthDrawing(entity)) {
    return false;
  }
  if (doubledOnTarget(entity, player)) {
    return false;
  }
  if (questGated(entity)) {
    return false;
  }
  if (healthFraction(entity) === null) {
    return false;
  }
  return distanceBetween(entity.pos, player.pos) <= range;
}

/**
 * Nothing is projected here: which units get a plate must not depend on where the camera points.
 * The side is a lookup, so it is resolved once and carried on the entry.
 */
function collect(player, casts) {
  wanted.length = 0;
  const range = drawDistance();
  const hideFull = woc.settings['hide-full'];
  for (const [id, entity] of woc.world.entities) {
    if (platable(entity, player, range)) {
      const side = standing(entity);
      const cast = castOf(casts, id);
      if (askedFor(entity, side) && !(hideFull && quiet(entity, cast))) {
        wanted.push({ id, entity, side, away: distanceBetween(entity.pos, player.pos) });
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

/** Art is filed per player class, so a mob's aura has none. `sourceId` is 0 when unknown. */
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

/**
 * The tile's accessible name. `unbreakableControl` is said in words because the tile's only
 * free channel, its border, already carries the school.
 */
function auraLabel(aura) {
  let named = woc.fmt.titleCase(String(aura.id));
  if (typeof aura.name === 'string' && aura.name !== '') {
    named = aura.name;
  }
  if (aura.unbreakableControl === true) {
    return `${named}, ${UNBREAKABLE}`;
  }
  return named;
}

/** Urgency beats what it is made of, which is the tile's own precedence. */
function auraTone(aura) {
  if (aura.unbreakableControl === true) {
    return 'danger';
  }
  return 'default';
}

/** The `?` is appended here, not by the kit, because the label also becomes an accessible name. */
function describe(abilityId) {
  const found = woc.world.abilities.describe(abilityId);
  if (found.known) {
    return { label: found.name, guessed: false };
  }
  return { label: `${found.name}${GUESS_MARK}`, guessed: true };
}

/** One mark as the game paints it. The caller sets the name as the accessible label. */
function markMarkup(at) {
  const fill = MARK_COLOURS[at] ?? NEUTRAL_NAME;
  const open =
    `<svg viewBox="${MARK_BOX}" width="${String(MARK_PX)}" height="${String(MARK_PX)}" ` +
    `aria-hidden="true" focusable="false" style="display:block">`;
  if (at === MARK_MOON) {
    return `${open}<path d="${MOON_DARK}" fill="${MARK_INK}" fill-rule="evenodd"/>
      <path d="${MOON_LIT}" fill="${fill}" fill-rule="evenodd"/></svg>`;
  }
  if (at === MARK_CROSS) {
    return `${open}<path d="${CROSS_PATH}" fill="none" stroke="${MARK_INK}" stroke-linecap="round"
      stroke-width="${String(CROSS_INK_WIDTH)}"/><path d="${CROSS_PATH}" fill="none"
      stroke="${fill}" stroke-linecap="round" stroke-width="${String(CROSS_FILL_WIDTH)}"/></svg>`;
  }
  const body =
    `<path d="${MARK_PATHS[at] ?? ''}" fill="${fill}" stroke="${MARK_INK}" ` +
    `stroke-width="${String(MARK_STROKE)}" stroke-linejoin="round" paint-order="stroke"/>`;
  if (at === MARK_SKULL) {
    return `${open}${body}<path d="${SKULL_FEATURES}" fill="${MARK_INK}" fill-rule="evenodd"/></svg>`;
  }
  return `${open}${body}</svg>`;
}

function buildHead() {
  // Children are appended in `createPlate`, once the tag group that rides this row exists.
  const head = box('div', 'woc-fm-head', {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    justifyContent: 'center',
  });
  const mark = box('span', 'woc-fm-mark', { display: 'none', lineHeight: '0' });
  const name = box('span', 'woc-fm-name', {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: '600',
  });
  const level = box('span', 'woc-fm-level', { opacity: '0.85', fontSize: '11px' });
  return { head, mark, name, level };
}

/**
 * Two tag groups, each collapsing when empty. Identity tags ride the end of the head row;
 * alerts get their own row under the cast bar, so a long name cannot push them off the plate.
 * A single row at the bottom would drift as the cast bar and strip come and go.
 */
function tagRow(className) {
  return box('div', className, {
    display: 'none',
    gap: '5px',
    justifyContent: 'center',
    fontSize: '11px',
    opacity: '0.75',
  });
}

function buildTags() {
  const tags = tagRow('woc-fm-tags');
  const note = box('span', 'woc-fm-note', {});
  const ai = box('span', 'woc-fm-ai', {});
  const cheater = box('span', 'woc-fm-cheater', {
    display: 'none',
    color: CHEATER_COLOUR,
    fontWeight: '700',
  });
  const rare = box('span', 'woc-fm-rare', { color: RARE_COLOUR, fontWeight: '700' });
  const carry = box('span', 'woc-fm-carry', { fontWeight: '700' });
  carry.textContent = CARRY_LABEL;
  tags.append(rare, note, ai, cheater, carry);

  const alerts = tagRow('woc-fm-alerts');
  const atYou = box('span', 'woc-fm-atyou', { color: HOSTILE_NAME, fontWeight: '700' });
  const taunt = box('span', 'woc-fm-taunt', { color: EDGE_CLOSE });
  alerts.append(atYou, taunt);

  return { tags, alerts, rare, note, ai, cheater, atYou, taunt, carry };
}

/** Five combo pips, drawn over your current target only. */
function buildPips() {
  const pips = box('div', 'woc-fm-pips', { display: 'none', gap: '3px', justifyContent: 'center' });
  const dots = [];
  for (let at = 0; at < COMBO_MAX; at += 1) {
    const dot = box('span', 'woc-fm-pip', {
      width: `${String(PIP_PX)}px`,
      height: `${String(PIP_PX)}px`,
      borderRadius: '50%',
      background: PIP_OFF,
    });
    dots.push(dot);
    pips.appendChild(dot);
  }
  return { pips, dots };
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
  const tagged = buildTags();
  const pipped = buildPips();
  const bars = buildBars();
  const strip = box('div', 'woc-fm-strip', { display: 'flex', gap: '2px' });
  // Top to bottom is the reading order: identity, health, cast, what it means for you, effects.
  parts.head.append(parts.mark, parts.name, parts.level, tagged.tags);
  plate.append(
    parts.head,
    bars.health.el,
    bars.power,
    pipped.pips,
    bars.cast.el,
    tagged.alerts,
    strip,
  );
  anchor.el.appendChild(plate);
  return { anchor, plate, strip, ...parts, ...tagged, ...pipped, ...bars, ...freshState() };
}

/** The health bar with its shield overlay (positioned against the bar), the pool, the cast bar. */
function buildBars() {
  const health = woc.ui.bar({ className: 'woc-fm-health' });
  health.el.style.background = BAR_BACKDROP;
  health.el.style.position = 'relative';
  const absorb = box('div', 'woc-fm-absorb', {
    position: 'absolute',
    top: '0',
    bottom: '0',
    display: 'none',
    background: ABSORB_FILL,
    pointerEvents: 'none',
  });
  health.el.appendChild(absorb);
  const power = box('div', 'woc-fm-power', {
    display: 'none',
    height: `${String(POWER_PX)}px`,
    background: BAR_BACKDROP,
  });
  const powerFill = box('div', 'woc-fm-power-fill', { height: '100%', width: '0%' });
  power.appendChild(powerFill);
  const cast = woc.ui.bar({ className: 'woc-fm-cast' });
  cast.el.style.background = BAR_BACKDROP;
  cast.el.style.display = 'none';
  return { health, absorb, power, powerFill, cast };
}

/**
 * The last value WRITTEN per plate, so an unchanged repaint writes nothing: a style write is a
 * repaint even when identical. The impossible starting values make the first pass write.
 */
function freshState() {
  return {
    tiles: [],
    auras: [],
    slots: [],
    ability: '',
    edge: '',
    markAt: -1,
    stroke: '',
    lit: -1,
    scale: 0,
    shift: 0,
    dim: -1,
    stealth: false,
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

/** Name, art and school are written only when the slot changes hands: resolving art is costly. */
function paintTile(entry, at, aura) {
  const tile = tileAt(entry, at);
  if (entry.slots[at] !== aura.id) {
    entry.slots[at] = aura.id;
    tile.update({
      label: auraLabel(aura),
      icon: auraIcon(aura),
      school: aura.school,
      tone: auraTone(aura),
    });
  }
  tile.update({
    fraction: auraFraction(aura),
    value: tileClock(aura.remaining),
    count: aura.stacks ?? null,
  });
  tile.el.style.display = '';
}

/** Clear the label too, or the hidden slot goes on announcing an effect that has gone. */
function hideTile(entry, at) {
  const tile = entry.tiles[at];
  if (tile === undefined) {
    return;
  }
  entry.slots[at] = '';
  tile.update({ label: null });
  tile.el.style.display = 'none';
}

function paintStrip(entry, entity, hide = false) {
  if (woc.settings.auras && !hide) {
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

/** Mobs only: a player keeps no hate table. */
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

/**
 * A raid mark if somebody set one. The game's elite diamond and `$` are deliberately absent:
 * rank is on the level and edge, and the game's corpse plate already shows `$`. The markup is
 * rebuilt only when the mark changes, since parsing SVG is the costly half.
 */
function paintMark(entry, entity, markers) {
  const at = markers?.get(entity.id) ?? null;
  if (at === null) {
    clearMark(entry);
    return;
  }
  if (entry.markAt !== at) {
    entry.markAt = at;
    entry.mark.innerHTML = markMarkup(at);
    entry.mark.setAttribute('aria-label', MARK_NAMES[at] ?? `Mark ${String(at + 1)}`);
    entry.mark.style.color = '';
  }
  entry.mark.style.display = '';
}

function clearMark(entry) {
  entry.mark.style.display = 'none';
  entry.mark.innerHTML = '';
  entry.mark.removeAttribute('aria-label');
  entry.markAt = -1;
}

/** The flag carrier tag, coloured by the carrier's side rather than the flag's: chase or escort. */
function paintCarry(entry, entity, side) {
  if (!carriers.has(entity.id)) {
    entry.carry.style.display = 'none';
    return;
  }
  entry.carry.style.color = TEAM_BLUE;
  if (side === 'hostile') {
    entry.carry.style.color = TEAM_RED;
  }
  entry.carry.style.display = '';
}

/**
 * "at you" goes on the alert row, not the cast bar: a 132px bar ellipsises it off the end of
 * most labels. The bar keeps the tone, which costs no width.
 */
function atYouNote(entity, player) {
  if (castAtYou(entity, player) && entity.castingAbility !== null) {
    return AT_YOU;
  }
  return '';
}

/** A tag that leaves the flow when it says nothing, so its gap goes with it. */
function showTag(tag) {
  tag.style.display = 'none';
  if (tag.textContent !== '') {
    tag.style.display = '';
  }
}

function paintTags(entry, entity, side, player) {
  entry.rare.textContent = rareNote(entity);
  entry.note.textContent = stateNote(entity);
  entry.ai.textContent = aiNote(entity);
  entry.cheater.textContent = cheaterNote(entity);
  showTag(entry.cheater);
  entry.atYou.textContent = atYouNote(entity, player);
  entry.taunt.textContent = tauntNote(entity, player);
  paintCarry(entry, entity, side);
  const named =
    entry.rare.textContent !== '' ||
    entry.note.textContent !== '' ||
    entry.ai.textContent !== '' ||
    entry.cheater.textContent !== '' ||
    carriers.has(entity.id);
  const warned = entry.atYou.textContent !== '' || entry.taunt.textContent !== '';
  showRow(entry.tags, named);
  showRow(entry.alerts, warned);
}

function showRow(row, holds) {
  row.style.display = 'none';
  if (holds) {
    row.style.display = 'flex';
  }
}

/** The game's rule: your current target only, never on a dead one, at most five. */
function comboPips(entity, player) {
  if (player.targetId !== entity.id || entity.dead === true) {
    return 0;
  }
  const held = Number(player.comboPoints);
  if (!Number.isFinite(held)) {
    return 0;
  }
  return Math.max(0, Math.min(COMBO_MAX, Math.round(held)));
}

function paintPips(entry, lit) {
  if (entry.lit === lit) {
    return;
  }
  entry.lit = lit;
  entry.pips.style.display = 'none';
  if (lit > 0) {
    entry.pips.style.display = 'flex';
  }
  for (const [at, dot] of entry.dots.entries()) {
    dot.style.background = PIP_OFF;
    if (at < lit) {
      dot.style.background = PIP_ON;
    }
  }
}

/** Rank and the current target share one edge, so one write settles both. */
function paintStroke(entry, entity, isTarget) {
  const { colour, width } = strokeFor(entity, isTarget);
  const key = `${colour}|${String(width)}`;
  if (entry.stroke === key) {
    return;
  }
  entry.stroke = key;
  entry.health.el.style.outline = '';
  if (colour !== 'transparent') {
    entry.health.el.style.outline = `${String(width)}px solid ${colour}`;
  }
}

/** The game's own translucency, folded into the distance fade rather than replacing it. */
function stealthed(entity) {
  const { auras } = entity;
  if (!Array.isArray(auras)) {
    return false;
  }
  return auras.some((aura) => aura.kind === 'stealth');
}

/**
 * Whether somebody outside your party tapped the mob and owns its loot. `tappedById` is null
 * for nobody; test for a number, since 0 would be a real entity id.
 */
function tappedByAnother(entity, player) {
  const owner = entity.tappedById;
  if (typeof owner !== 'number' || owner === player.id) {
    return false;
  }
  return !inParty(owner);
}

function inParty(pid) {
  const { party } = woc.world;
  if (party === null) {
    return false;
  }
  return party.members.some((member) => member.pid === pid);
}

/** A corpse is grey whoever it was, as in the game. */
function headColour(entity, side, player) {
  if (entity.dead === true) {
    return CORPSE_NAME;
  }
  if (tappedByAnother(entity, player)) {
    return TAPPED_NAME;
  }
  return nameColourFor(side);
}

/** Test `resourceType`, not `maxResource`, which a resource-less mob omits along with the rest. */
function paintPower(entry, entity) {
  const kind = entity.resourceType;
  const max = Number(entity.maxResource);
  if (typeof kind !== 'string' || kind === '' || !(max > 0) || entity.dead === true) {
    entry.power.style.display = 'none';
    return;
  }
  entry.power.style.display = '';
  entry.powerFill.style.background = POWER_COLOURS[kind] ?? POWER_FALLBACK;
  entry.powerFill.style.width = percent(Math.min(Math.max(Number(entity.resource) / max, 0), 1));
}

/** A taunt holding this mob on you. Positive only: absence of the field is not evidence. */
function tauntNote(entity, player) {
  if (entity.forcedTargetId !== player.id) {
    return '';
  }
  const left = Number(entity.forcedTargetTimer);
  if (!Number.isFinite(left) || left <= 0) {
    return TAUNT_TAG;
  }
  return `${TAUNT_TAG} ${seconds(left)}`;
}

/** The game steps its name row up one size for your selection. */
function nameSize(isTarget) {
  if (isTarget) {
    return TARGET_FONT;
  }
  return '';
}

function paintSlow(entry, found, markers, player) {
  const { entity, side } = found;
  const isTarget = player.targetId === entity.id;
  entry.name.textContent = nameOf(entity);
  entry.name.style.color = headColour(entity, side, player);
  entry.name.style.fontSize = nameSize(isTarget);
  entry.level.textContent = levelText(entity);
  entry.level.style.color = conColour(entity, side, player);
  paintTags(entry, entity, side, player);
  paintMark(entry, entity, markers);
  paintEdge(entry, entity);
  paintStrip(entry, entity, entity.dead === true);
  paintStroke(entry, entity, isTarget);
  paintPips(entry, comboPips(entity, player));
  paintPower(entry, entity);
  entry.stealth = stealthed(entity);
}

/** A corpse keeps its bar, which carries `dead` or `ghost` since this cannot rename the unit. */
function paintHealth(entry, entity) {
  const fraction = healthFraction(entity);
  entry.health.update({
    fraction: fraction ?? 0,
    label: healthCount(entity),
    value: healthText(entity, fraction),
    tone: 'default',
    unitClass: unitClassOf(entity),
  });
  paintAbsorb(entry, entity, fraction);
}

/** The sum of every absorb on a unit. */
function absorbTotal(entity) {
  const { auras } = entity;
  if (!Array.isArray(auras)) {
    return 0;
  }
  let total = 0;
  for (const aura of auras) {
    if (aura.kind === 'absorb') {
      total += Math.max(Number(aura.value) || 0, 0);
    }
  }
  return total;
}

/** The shield, laid over the health bar past where health ends. The kit's bar has one fill. */
function paintAbsorb(entry, entity, fraction) {
  const max = Number(entity.maxHp);
  const total = absorbTotal(entity);
  if (fraction === null || total <= 0 || !(max > 0)) {
    entry.absorb.style.display = 'none';
    return;
  }
  const share = Math.min(total / max, 1 - fraction);
  entry.absorb.style.display = '';
  entry.absorb.style.left = percent(fraction);
  entry.absorb.style.width = percent(Math.max(share, 0));
}

/** Remaining rather than elapsed, the sense the kit draws a fill in. */
function castFraction(cast) {
  if (!(Number.isFinite(cast.total) && cast.total > 0)) {
    return 0;
  }
  return cast.remaining / cast.total;
}

/**
 * Whether this cast is pointed at you. Positive only: an absent `castTargetId` means not
 * casting or untargeted, never "not at you".
 */
function castAtYou(entity, player) {
  return entity !== undefined && entity.castTargetId === player.id;
}

/** No school (the wire has none). A tone only on a cast at you: on every cast it says nothing. */
function paintCast(entry, cast, entity, player) {
  if (cast === null || !woc.settings.casts) {
    entry.cast.el.style.display = 'none';
    entry.ability = '';
    return;
  }
  const mine = castAtYou(entity, player);
  const key = `${cast.ability}|${String(mine)}`;
  if (entry.ability !== key) {
    entry.ability = key;
    entry.cast.update({
      label: describe(cast.ability).label,
      icon: castIcon(cast, entity),
      school: null,
      tone: castTone(mine),
    });
  }
  entry.cast.update({ fraction: castFraction(cast), value: seconds(cast.remaining) });
  entry.cast.el.style.display = '';
}

function castTone(mine) {
  if (mine) {
    return 'danger';
  }
  return 'default';
}

/**
 * Cast art resolves for a player only: art is filed per class and only a player's `templateId`
 * is a class. An activity sentinel simply misses, which needs no special case.
 */
function castIcon(cast, entity) {
  if (entity === undefined || entity.kind !== 'player') {
    return null;
  }
  return woc.ui.icon.ability(cast.ability, entity.templateId);
}

/** Read `world.markers` once per pass: the loader builds that map on every read. */
function slowPass() {
  const { player } = woc.world;
  if (player === null || !shown) {
    clearPlates();
    return;
  }
  fillCarriers();
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
    paintSlow(entry, found, markers, player);
  }
}

/** Depth, not distance, so the fade holds while the camera swings. */
function fadeAt(depth, entry) {
  let fade = 1;
  if (depth > FADE_FROM_YARDS) {
    const past = (depth - FADE_FROM_YARDS) / (MODEL_RANGE_YARDS - FADE_FROM_YARDS);
    fade = Math.max(1 - past * (1 - MIN_FADE), MIN_FADE);
  }
  if (entry.stealth) {
    return fade * STEALTH_FADE;
  }
  return fade;
}

/**
 * One projection per plate feeds both the fade (depth) and the declutter (point). A unit the
 * camera cannot resolve is hidden and skipped, rather than frozen where it last was.
 */
function projectAll() {
  spots.length = 0;
  for (const [id, entry] of plates) {
    const at = woc.ui.project({ unit: id, over: 'head' });
    if (at === null) {
      writeDim(entry, 0);
    } else {
      writeDim(entry, fadeAt(at.depth, entry));
      spots.push({ id, x: at.x, y: at.y, entry, shift: 0 });
    }
  }
}

function writeDim(entry, dim) {
  if (entry.dim === dim) {
    return;
  }
  entry.dim = dim;
  entry.plate.style.opacity = String(dim);
}

function overlapping(a, b) {
  return Math.abs(a.x - b.x) <= DECLUTTER_X && Math.abs(a.y - b.y) <= DECLUTTER_Y;
}

/**
 * Nudge apart plates that would sit on top of each other, as the game does: ascending id order
 * so a stack does not reshuffle as the camera moves, spread around the cluster's mean.
 */
function declutter() {
  spots.sort((a, b) => a.id - b.id);
  const taken = new Set();
  for (const [at, spot] of spots.entries()) {
    if (!taken.has(at)) {
      gather(at, spot, taken);
      spreadCluster();
    }
  }
}

/** Everything this plate reaches, transitively: a chain of three overlaps is one stack. */
function gather(at, spot, taken) {
  cluster.length = 0;
  cluster.push(spot);
  taken.add(at);
  for (let other = at + 1; other < spots.length; other += 1) {
    if (!taken.has(other) && cluster.some((held) => overlapping(held, spots[other]))) {
      cluster.push(spots[other]);
      taken.add(other);
    }
  }
}

function spreadCluster() {
  if (cluster.length < 2) {
    return;
  }
  let sum = 0;
  for (const member of cluster) {
    sum += member.y;
  }
  const base = sum / cluster.length;
  const middle = (cluster.length - 1) / 2;
  for (const [at, member] of cluster.entries()) {
    member.shift = base + (at - middle) * STACK_PX - member.y;
  }
}

/**
 * Scale and stack share the one `transform`. Scale must come after the translation, or it
 * multiplies the stack offset.
 */
function paintTransform(entry, shift) {
  const scale = plateScale();
  if (entry.scale === scale && entry.shift === shift) {
    return;
  }
  entry.scale = scale;
  entry.shift = shift;
  entry.plate.style.transform = `translateY(${String(Math.round(shift))}px) scale(${String(scale)})`;
}

/** A plate whose unit has gone is hidden, not destroyed: the slow pass owns which plates exist. */
function fastPass() {
  const { casts, player } = woc.world;
  if (player === null) {
    return;
  }
  for (const [id, entry] of plates) {
    const entity = woc.world.entities.get(id);
    if (entity === undefined) {
      writeDim(entry, 0);
    } else {
      paintHealth(entry, entity);
      paintCast(entry, castOf(casts, id), entity, player);
    }
  }
  projectAll();
  declutter();
  for (const spot of spots) {
    paintTransform(spot.entry, spot.shift);
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

/** Only the off case names the chord: with plates gone, nothing on screen leads back. */
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

/** A stored value of the wrong kind is ignored rather than read as off. */
async function restore() {
  const stored = await woc.storage.get(SHOWN_KEY, true);
  if (typeof stored === 'boolean') {
    shown = stored;
    slowPass();
  }
}

/**
 * Take the rank table from any sender (`follow`): `official/longwatch` from a fork publishes
 * under another name. A malformed row is dropped; silence and a null payload mean no rank.
 */
function adoptRanks(payload) {
  if (!Array.isArray(payload)) {
    return;
  }
  ranks.clear();
  for (const row of payload) {
    if (typeof row?.id === 'string') {
      ranks.set(row.id, row);
    }
  }
  slowPass();
}

woc.bus.follow(RANKS_TOPIC, (payload) => {
  adoptRanks(payload);
});

// Membership is the one change a key reports, so a unit entering range gets a plate at once.
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

/** A plate's shape is fixed when built, so a settings change rebuilds rather than repaints. */
woc.onSettingsChange(() => {
  clearPlates();
  slowPass();
});
