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
// WHICH SIDE SOMEBODY IS ON is not a field, and it is not worked out here either.
// `entity.hostile` is written when the game builds a mob and nowhere else, so it is false
// on every player in the world, including the five trying to kill you in a battleground.
// `world.reaction` is the loader's answer, folding the duel, the arena, the battleground
// and a pet's owner into one reading, and it is asked ONCE per unit per pass and carried
// from there. This addon used to rebuild that roster itself; the loader publishing it is
// what let a hundred lines of it go.
//
// WHAT A PLAYER LOSES BY SWITCHING THE GAME'S OWN PLATES OFF is the measure this is
// built against, because that is what installing this addon usually means. So the con
// bands on the level, the raid mark as the game paints it, the emphasis on the current
// target, the combo pips, the stealth translucency, the dead-player plates and the
// declutter stack are all here to be a REPLACEMENT rather than an ornament. Where this
// plate deliberately says less: no guild tag, no deed title or border, no community role
// and no account badges, all of which are cosmetics on a 132px row, and no quest markers,
// which need a table the wire has nothing to build from.
//
// WHAT THE GAME WILL NOT STOP DRAWING IS NOT DRAWN HERE, which is the rule that decides
// which units get a plate at all. There are exactly three toggles: `V` (Toggle Nameplates,
// rebindable, session only) hides LIVING MOBS, and Show Player Nameplates and Show My
// Nameplate are options. Nothing covers an NPC, and nothing covers a LOOTABLE CORPSE,
// whose plate and `$` the game draws whatever the player does. A plate under either is the
// same fact twice in the same square inch, for every player, permanently, which is the
// same reason the overhead emote is left alone below.
//
// RANK AND RARITY ARE TWO FLAGS, which is the thing to get right rather than the thing to
// simplify: `elite`, `boss` and `rare` are three independent booleans on the game's own
// template, so a rare elite is ordinary and FOUR of the game's rares carry no rank at all.
// Rank goes on the level and the bar's edge; rarity is a word on the tag row, because a
// plain rare with rank alone drawn is a level 12 troll that reads exactly like the two
// ordinary trolls standing beside it. Neither is on the game's own plate.
//
// RANK IS NOT ON THE WIRE EITHER, and it does not have to be worked out here. `longwatch`
// carries the table the game's own `MOBS` is the source of and publishes it on the bus, so
// this follows the topic and decorates from what arrives. It is complete rather than a
// roster somebody typed, which is what makes a rank worth drawing at all: the failure to
// avoid is decorating a few bosses and silently missing the rest. Everything here works
// with nothing published, because a companion is a note rather than a dependency.
//
// WHAT A PLAYER IS DOING rides the head row in one word, because in a fight it is a
// decision rather than a detail: `<AFK>` prefixes the name the way the game's own plate
// writes it, `mounted` says somebody is leaving rather than fighting, and `resting` says
// they have to stand up first. That last one is the game's `sitting` field, which is
// wider than its name: the wire folds sitting, eating and drinking into one bit and there
// is no way to tell them apart for anybody else, so one honest word covers all three. `AI`
// is beside them and is not one of them, being a disclosure about the account rather than
// about the moment.
//
// THE OVERHEAD EMOTE IS DELIBERATELY NOT DRAWN, though it is published and readable. The
// game paints its own bubble over that player's head, on its own canvas, whether or not
// this addon is running, so a copy on the plate underneath would be the same fact twice
// in the same square inch of screen. The guild tag is left out for the narrower reason
// that a 132px row spends its width on a name that is already ellipsised.
//
// WHAT NEITHER PLATE SAYS is the other half, and it is a higher bar than parity: a row
// this narrow earns nothing by saying more. Four things clear it, and each is a decision
// rather than a detail. A shield laid over the health bar, because a unit at 40 percent
// with 30 percent of absorb on it is not a unit at 40 percent and every bar in the game
// says it is. Somebody else's TAP, because without it a plate offers you a fight whose
// reward is not yours. A caster mob's POOL, three pixels of it, because the question about
// a thing that is about to cast is whether it can afford to. And a cast pointed AT YOU,
// which is also the only thing that ever justified a tone on the cast bar: on every mob
// cast a tone marks the whole world urgent and says nothing.
//
// Three things a plate cannot say. An effect a mob applied has no art anywhere, since the
// game composites aura icons at run time; a player's resolves through the caster's class.
// A cast bar cannot be tinted, because the wire carries no school for a cast. And a mob
// ability's name is worked out from its id, as is an ACTIVITY sentinel like crafting, so
// both end in a question mark.
//
// Two loops. Every frame: health, the cast bar, and the one projection per plate that the
// fade and the declutter stack share. Ten times a second: which units have a plate, the
// effect strip, the threat edge, the mark, the tags and the pips, none of which any watch
// key reports. `world.on('entities')` reports membership only, which is why the sampler is
// under it. The projection moved to the frame loop because both things it feeds are about
// where the CAMERA is pointing, and at 10 Hz a stack lagged a turn by a tenth of a second.
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
/**
 * Health as a COUNT as well as a share, because the two answer different questions.
 *
 * A share says how much of a fight is left and a count says whether your next hit
 * finishes it, and a plate that only ever said 12% cannot answer the second for a
 * boss and a critter in the same glance. Compacted, since a five-figure boss pool
 * would take the whole row: the figure a player acts on is the leading digits.
 *
 * It goes in the bar's LABEL, on the left, which was empty: the share keeps the
 * right where it has always been, so nothing moves and nothing competes.
 */
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

/** The topic `longwatch` publishes its mob table on. `follow` derives `mobs:ask` from it. */
const RANKS_TOPIC = 'mobs';
/**
 * What a rank puts after the level, in the game's own spelling.
 *
 * The game writes an elite's level as `{level}+` and draws a boss with a heavier
 * FRAME rather than a suffix, so the second `+` is ours: two ranks that read
 * identically would be worse than one nobody can tell from a normal mob. The
 * colour that used to be here has gone to the health bar's edge, which is where
 * the game puts rank and which is what gave the level back to con.
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
 * The eight marks as paths, transcribed from the game's own canvas geometry.
 *
 * Written out rather than worked out, because the source is a `switch` of canvas
 * calls and there is no file to fetch: mark art is composited at run time, so a
 * URL for one does not exist. The star's ten points are radius 42 and 17
 * alternating from straight up, and every other shape is the game's own numbers.
 *
 * `paint-order: stroke` is what makes these match rather than merely resemble.
 * Canvas strokes and then fills, so the fill covers the inner half of the
 * outline; SVG fills first by default, which would double the outline's visible
 * weight and shrink every mark inside it.
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
 * The game's own nameplate con bands, which are NOT its tooltip's.
 *
 * `mobNameColor` and `mobTooltipConColor` sit next to each other in the game's own
 * `reaction.ts` with deliberately different spreads, and the plate wants the first:
 * red at 3 levels above you and up, orange 1 to 2 above, yellow down to 2 below,
 * green to 5 below, grey once it is trivial. A corpse is grey whatever its level,
 * and a friendly pet takes the friendly green rather than any band.
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
 * The health bar's edge, which is where the game puts rank and the current target.
 *
 * One axis in the game's own precedence: a boss beats an elite beats whatever you
 * have selected. Rank is here rather than on the level because the level already
 * carries con, and the game makes the same split for the same reason.
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

/**
 * A shield, over the part of the bar the health does not reach.
 *
 * The game's own hatch, transcribed from `.bar-absorb` in its stylesheet, for the
 * reason the con bands are transcribed: a player already reads this pattern as a
 * shield on their own unit frames, and a flat wash of my own choosing would be a
 * second vocabulary for one thing.
 */
const ABSORB_FILL =
  'repeating-linear-gradient(115deg, rgb(255 255 255 / 42%) 0 5px, rgb(190 225 255 / 16%) 5px 10px)';

/**
 * A caster mob's pool, in the game's own colours for the four resources.
 *
 * `rtype`, `res` and `mres` ride any entity the server gives a resource, which is
 * players and caster mobs, and no nameplate in the game draws them. Three pixels,
 * and only where there is one: the question it answers is whether the thing about
 * to cast can afford to.
 */
const POWER_PX = 3;
/**
 * The game's own tokens rather than four colours picked to look right.
 *
 * It publishes one per resource for its own bars, so a strip drawn from them is
 * the blue the player already reads as mana on their own frame, and it follows
 * the game's theme picker for free. `ResourceType` is exactly these four today
 * and grew by one at game 0.36.0, so the fallback is a real case rather than a
 * defensive one.
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
 * A rare spawn, which is a SEPARATE flag from rank and mostly not an elite.
 *
 * `MobTemplate.elite`, `.boss` and `.rare` are three independent booleans and the
 * table publishes them that way, so four of the game's rares carry no rank at all
 * and read exactly like any other mob: Grubjaw the Glutton is a level 12 troll
 * with nothing to say it is worth crossing a marsh for. The game's own plate does
 * not decorate one either, which makes this something only an addon can say.
 *
 * A WORD rather than a mark, because the mark slot means somebody chose it and
 * the level already carries rank. Silver, which is the colour every client that
 * has ever drawn a rare has drawn it in.
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
 * The game's own declutter thresholds, in screen pixels.
 *
 * Two plates within this box of each other are one stack, and a stack is spread
 * around its own mean so nothing jumps when a third joins. The spatial hash the
 * game uses is deliberately not copied: it exists for forty-odd plates a frame and
 * this addon draws at most forty by its own setting, twelve by default, so the
 * pairwise pass is a dozen comparisons.
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
 * Template id to what `longwatch` says about it, empty until it answers.
 *
 * Empty is the ordinary state rather than a failure: the companion may not be installed,
 * may be switched off, or may not have read its table yet. Everything keyed on this
 * degrades to an undecorated plate, which is what the addon drew before.
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

/**
 * A player's class, for the bar to tint itself by, and null for everything else.
 *
 * `templateId` is the class id on a PLAYER and a mob template id on anything else, so
 * this is the guard that keeps `boss_wolf` out of a field whose union is nine classes.
 * The kit refuses an unknown value anyway and tints nothing, which is the safe way
 * round, but handing it one would be relying on that rather than saying what is true.
 */
function unitClassOf(entity) {
  if (entity.kind !== 'player') {
    return null;
  }
  return entity.templateId;
}

/** Leading digits only: `1.3K` is what a player acts on, and `1347` is four characters wasted. */
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

/** The count, or nothing for a corpse: a dead unit's zero is the word beside it, not a figure. */
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

/** Only the carriers now: which side somebody is on is `world.reaction`, which folds all three bouts. */
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
 * Which side a unit is on, asked ONCE a pass and carried from there.
 *
 * `world.reaction` is the loader's, and it is the answer to a question no field
 * holds: `entity.hostile` is written when the game builds a mob and nowhere else,
 * so a plate reading it paints every duel, arena and battleground opponent
 * friendly-blue. It also folds a pet through its owner, so an enemy's pet reads
 * hostile and yours never reads as a wild mob.
 *
 * Null is a unit the loader has no roster entry for, which cannot happen for
 * anything with a plate, and neutral is the reading that costs least if it does.
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

/**
 * All four of these are PLAYER fields, so a mob is never asked.
 *
 * Each exists on every entity and holds an inert default on anything that is not a player,
 * which is the trap the published types spend a paragraph on: readable, correctly typed,
 * and written by nobody. The guard is one question rather than four.
 */
function isPlayer(entity) {
  return entity.kind === 'player';
}

/** The game's own prefix, in the game's own place, so a plate reads like the one under it. */
function nameOf(entity) {
  if (isPlayer(entity) && entity.afk === true) {
    return `${AFK_TAG} ${bareName(entity)}`;
  }
  return bareName(entity);
}

/**
 * What a player is DOING, in one word, or nothing.
 *
 * Both are PvP readings before they are anything else: a mounted player is leaving rather
 * than fighting, and a resting one is a player who has to stand up first. Neither is on
 * the game's own plate.
 *
 * `sitting` is the game's field NAME and is wider than the word: the wire folds sitting,
 * eating and drinking into one bit and there is no way to tell them apart for somebody
 * else, so `resting` is the honest label for all three. Mounted wins where both are set,
 * which the game does not allow anyway.
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

/**
 * The operator-set mark on an AI-operated account.
 *
 * A disclosure about WHO is playing rather than a state, which is why it is its own tag
 * beside the state note rather than another word inside it: it does not change, and it is
 * true of an account whatever that account is doing.
 */
function aiNote(entity) {
  if (isPlayer(entity) && entity.aiAccount === true) {
    return AI_TAG;
  }
  return '';
}

/** What the rank service says about this template, or null when nothing does. */
function rankOf(entity) {
  return ranks.get(entity.templateId) ?? null;
}

/** A rare and an elite are two flags, so a rare elite says both and a plain rare still says one. */
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

/**
 * The one number a player reads before deciding to pull, in the game's own bands.
 *
 * A LEVEL rather than a rank, which used to be here: rank moved to the bar's edge,
 * where the game draws it, precisely so this could have the level back. The bands
 * are `mobNameColor`'s and not `mobTooltipConColor`'s, which sits beside it with a
 * wider spread for the mouseover.
 *
 * Mobs only. The game con-colours no player's level, and it should not: a player
 * three levels above you is not a harder pull, they are a person.
 */
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
 * The game hides a quest-gated mob outright for a player who is not on its quest, so the
 * clutch reads as inert scenery. Drawing over it gives away a designed moment.
 *
 * Hidden only when the table ANSWERED for this template, so with no rank service installed
 * nothing is hidden. The quest log is null before world entry, which is also not on the
 * quest.
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

/** An unrecognised mode falls back to hostiles, which costs least on a setting from a future manifest. */
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
 * A dead PLAYER keeps a plate. A dead mob does not, and the reason is the toggle.
 *
 * In a battleground `dead` is match-wide by design, so a grey plate on the far
 * five is the "four of them are down" reading, drawn on the people rather than in
 * a panel, and a player who has switched Show Player Nameplates off has no other
 * way to see it.
 *
 * A LOOTABLE MOB is the case that looks identical and is not. The game draws that
 * corpse's plate with its own `$` and NOTHING TURNS IT OFF: `showNameplates`
 * hides `kind === 'mob' && !dead` only, so the V key leaves every corpse on
 * screen. A plate here would be the same fact twice in the same square inch, for
 * every player, permanently. See the rule at the top of this file.
 */
function corpseWorthDrawing(entity) {
  return entity.kind === 'player';
}

/**
 * The one plate the game keeps whatever the player does, and the setting for it.
 *
 * Show Player Nameplates hides every other player EXCEPT the one you have selected, so a
 * clicked player stays readable: `e.id !== player.targetId` is the last term of the
 * game's own hidden rule. That exception is the only place a player who switched the
 * game's plates off still gets two, and it follows them around, since it is whatever they
 * are pointed at rather than a fixed unit.
 *
 * ON by default, and the reason is that this is the one case where hiding cannot leave a
 * hole. A player you have selected ALWAYS has a game plate: either Show Player Nameplates
 * is on and everybody has one, or it is off and the target exception spares exactly this
 * unit. So the addon's plate there is always the second one on the same head. Turn it off
 * to have the health count, the class-tinted bar, the effect strip and the cast warning
 * back on the unit you are pointed at, and accept reading two plates over it.
 *
 * PLAYERS ONLY, and that is the whole of why this is not simply "hide the target". The
 * mob rule has no target exception at all, so with mob nameplates off your mob target has
 * no game plate to double, and hiding this addon's would leave the unit you are fighting
 * with nothing over it whatsoever.
 */
function doubledOnTarget(entity, player) {
  if (entity.kind !== 'player' || entity.id !== player.targetId) {
    return false;
  }
  return woc.settings['hide-selected-player'] === true;
}

/**
 * An object is out because it has no health, and an NPC because the game will not stop.
 *
 * There is no toggle for an npc plate anywhere in the game: `showNameplates` is
 * mobs, `showPlayerNameplates` is other players, `showOwnNameplate` is you, and
 * an npc is none of the three. So a quest giver wears the game's plate whatever
 * the player does, and a second one under it is noise nobody asked for.
 */
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
 *
 * The side is resolved ONCE per unit and carried on the entry, because it is a
 * lookup rather than a field and four things downstream ask it.
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

/**
 * A square whose whole face is art has no room for a name, so this is what announces it.
 *
 * `unbreakableControl` is said in WORDS rather than drawn, because the tile's only
 * free channel is its border and that already carries the school. It is worth
 * saying at all because it is the difference between a stun a trinket clears and
 * one an encounter owns, which is a decision rather than a detail.
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

/** The mark stays ours: this label also reaches an accessible name, where a glued-on `?` reads as part of it. */
function describe(abilityId) {
  const found = woc.world.abilities.describe(abilityId);
  if (found.known) {
    return { label: found.name, guessed: false };
  }
  return { label: `${found.name}${GUESS_MARK}`, guessed: true };
}

/**
 * One mark, as the game paints it rather than as a word.
 *
 * "Skull" written out is the weakest thing that was ever on this plate and the
 * widest: the glyph is 13px where the word was five characters of a 132px row,
 * which is most of what pays for the rest of what a plate now says. The NAME
 * stays as the accessible name, because a path cannot be read aloud.
 */
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
  // The children are appended in `createPlate`, once the tag group exists: the tags
  // ride the tail of this row and building them here would put a second concern in it.
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
 * Two tag groups, each against the thing it is about, and each collapsing when empty.
 *
 * One row at the bottom of the plate was the first shape and it was wrong twice
 * over. It DRIFTED: a word under the health bar moved down the plate as a cast bar
 * and an effect strip appeared and went under it, so where it sat meant nothing.
 * And it read as a CAPTION of whatever it happened to be under, which for
 * `resting` was the health bar, a row it has nothing to do with.
 *
 * So who somebody IS rides the END OF THE HEAD ROW, after the level, where the
 * rest of their identity already is and where it costs no height at all: these
 * are one short word each and the name ellipsises, which it was already doing.
 * What is ABOUT TO HAPPEN keeps its own row under the cast bar, beside the cast it
 * is about, because that one is urgent and a name should not be able to push it
 * off the plate.
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
  const rare = box('span', 'woc-fm-rare', { color: RARE_COLOUR, fontWeight: '700' });
  const carry = box('span', 'woc-fm-carry', { fontWeight: '700' });
  carry.textContent = CARRY_LABEL;
  tags.append(rare, note, ai, carry);

  const alerts = tagRow('woc-fm-alerts');
  const atYou = box('span', 'woc-fm-atyou', { color: HOSTILE_NAME, fontWeight: '700' });
  const taunt = box('span', 'woc-fm-taunt', { color: EDGE_CLOSE });
  alerts.append(atYou, taunt);

  return { tags, alerts, rare, note, ai, atYou, taunt, carry };
}

/**
 * Five pips, drawn over your CURRENT TARGET and nowhere else.
 *
 * They are the player's own points rather than anything about the unit, which is
 * why they sit under the health bar rather than in the head row: the row says who
 * this is, and this says what you have saved up to spend on them.
 */
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
  // Top to bottom, and the order is the reading: who this is and what state they are in,
  // how hurt they are, what they are casting, what that cast means for you, what is on
  // them. The identity tags ride the head row's tail and the alert row collapses, so a
  // plain mob's plate is still a name, a bar and its effects.
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

/**
 * The health bar, its shield overlay, a caster's pool, and the cast bar.
 *
 * The shield is positioned against the health bar's own box, which is what the
 * wrapper is for: the kit owns the fill inside it and this owns the strip laid
 * over the top, and neither has to know about the other.
 */
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
 * What each plate remembers about itself.
 *
 * Every one of these is the last thing WRITTEN rather than the last thing read,
 * so a repaint that would change nothing writes nothing: a style property is a
 * repaint even when the value is identical, and half of these run per frame per
 * plate. The impossible starting values are deliberate, so the first pass always
 * writes.
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

/** Name, art and school are written only when the slot changes hands: resolving art is the expensive half. */
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

/**
 * A raid mark if somebody set one, and nothing otherwise.
 *
 * The elite diamond and the lootable `$` the game also draws in this slot are
 * both deliberately absent: rank is already on the level and on the bar's edge,
 * and the game's own corpse plate cannot be switched off, so a `$` here could
 * only ever be a second one.
 *
 * The markup is rebuilt only when the mark CHANGES: parsing an SVG is the
 * expensive half and the slow pass runs ten times a second.
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

/** The classic "there is money on this one", in the game's own character. */
function clearMark(entry) {
  entry.mark.style.display = 'none';
  entry.mark.innerHTML = '';
  entry.mark.removeAttribute('aria-label');
  entry.markAt = -1;
}

/**
 * The one mark worth the width in a capture-the-flag match.
 *
 * Coloured by the side the carrier is on rather than by the flag they took,
 * because the question a player answers with it is chase or escort. It is the
 * only thing on the plate that says anything a battleground scoreboard cannot,
 * since it is drawn ON the person to chase.
 */
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

/** Row two exists only while something is in it, so an ordinary mob costs no height. */
/**
 * The words for a cast pointed at you, which are NOT on the cast bar.
 *
 * They were, and the preview is what said otherwise: a 132px bar holds an
 * ability name and a countdown, so "at you" was ellipsised off the end of every
 * label long enough to matter, which is most of them. The bar keeps the tone,
 * since a colour costs no width, and the words go on the row that exists for
 * short true things. Nothing in the suite could see this.
 */
function atYouNote(entity, player) {
  if (castAtYou(entity, player) && entity.castingAbility !== null) {
    return AT_YOU;
  }
  return '';
}

function paintTags(entry, entity, side, player) {
  entry.rare.textContent = rareNote(entity);
  entry.note.textContent = stateNote(entity);
  entry.ai.textContent = aiNote(entity);
  entry.atYou.textContent = atYouNote(entity, player);
  entry.taunt.textContent = tauntNote(entity, player);
  paintCarry(entry, entity, side);
  const named =
    entry.rare.textContent !== '' ||
    entry.note.textContent !== '' ||
    entry.ai.textContent !== '' ||
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

/**
 * Your own combo points, over the unit they would be spent on.
 *
 * The game's own rule: nothing unless this is your current target, nothing on a
 * dead one, and never more than five. A class that has no combo points reads zero
 * forever, which draws no row at all.
 */
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
 * Whether somebody else got there first, and the loot is theirs.
 *
 * `tappedById` is the first player to damage a mob and it owns the mob's shared
 * loot. Null is nobody, and a 0 would be a real entity id rather than a nobody,
 * which is the trap this reads around. Your own party counts as you: a group's
 * tap is the group's.
 *
 * The game has no equivalent of this ANYWHERE, which is what makes it worth the
 * one colour: without it a plate offers you a fight whose reward is somebody
 * else's.
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

/** A corpse is grey whoever it was, which is the game's own rule and reads as past tense. */
function headColour(entity, side, player) {
  if (entity.dead === true) {
    return CORPSE_NAME;
  }
  if (tappedByAnother(entity, player)) {
    return TAPPED_NAME;
  }
  return nameColourFor(side);
}

/**
 * A caster mob's pool, which only exists where the server sent one.
 *
 * `resourceType` is the honest test rather than `maxResource`: a resource-less
 * wolf omits all three fields and a zero maximum would read the same as a caster
 * drained to nothing.
 */
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

/**
 * A taunt holding this mob on you, while it lasts.
 *
 * Present as a positive only: the field is absence-is-not-evidence, so a plate
 * that said "no taunt" would be claiming something nobody sent. Yours alone, since
 * a taunt on somebody else is their business and this row is 132px wide.
 */
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

/** The game steps its own name row up for whatever you have selected. This is that step. */
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

/**
 * A corpse keeps its bar, which is where the game and this plate part company.
 *
 * The game hides its own and renames the unit "Corpse of X"; this cannot rename
 * anybody, since the name is the entity's. So the bar stays and carries the word
 * instead, which also keeps the one distinction that matters in a fight: `dead`
 * is true through both halves of dying and only `ghost` says they have released.
 */
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

/** Every shield on a unit, which is damage the health bar alone says is not there. */
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

/**
 * The shield, laid over the health bar past where health ends.
 *
 * The game draws this on its own unit frames and on NO nameplate, which is the
 * whole reason it is worth the pixels: a unit at 40 percent with a shield worth
 * another 30 is not a unit at 40 percent, and every plate in the game says it is.
 *
 * Drawn by this addon rather than by the kit, because a bar has one fill by
 * design: a second one is this display's problem and not every addon's.
 */
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

/** LEFT rather than elapsed, which is the sense the kit draws a fill in. */
function castFraction(cast) {
  if (!(Number.isFinite(cast.total) && cast.total > 0)) {
    return 0;
  }
  return cast.remaining / cast.total;
}

/**
 * Whether this cast is pointed at YOU.
 *
 * `castTargetId` is filled inside the game's own casting guard, so its absence
 * means "not casting, or casting something untargeted" and never "not at you".
 * Read as a positive only, which is the same rule the taunt tag follows.
 */
function castAtYou(entity, player) {
  return entity !== undefined && entity.castTargetId === player.id;
}

/**
 * No school, since nothing on the wire says one.
 *
 * The TONE is the one thing here that had to wait for a reason to exist. A tone on
 * every mob cast marks the whole world urgent and says nothing; a tone on the cast
 * that is coming at YOU is the plate saying the one thing about a cast bar that
 * changes what a player does, and the game says it nowhere at all.
 */
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
 * The art for what is being cast, which resolves for a PLAYER and never for a mob.
 *
 * `castingAbility` is a real ability id rather than a display name, so the join is
 * exact where art exists at all. It is filed per class, and the only class an
 * entity carries is a player's `templateId`, so a boss winding up its signature
 * move has no file anywhere and the kit hides the slot rather than drawing a gap.
 * Same resolution the effect tiles make, for the same reason.
 *
 * An ACTIVITY sentinel (gathering, fishing, the crafting family) is an id for
 * nothing and simply misses, which is the right answer rather than a special case.
 */
function castIcon(cast, entity) {
  if (entity === undefined || entity.kind !== 'player') {
    return null;
  }
  return woc.ui.icon.ability(cast.ability, entity.templateId);
}

/** `world.markers` is read once rather than per plate: the loader builds that map on every read. */
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
 * Where each plate landed this frame, for the fade and the stack.
 *
 * ONE projection per plate rather than two: the fade wants the depth and the
 * declutter wants the point, and asking twice for one answer is the kind of thing
 * that is invisible until a crowd. A unit the camera cannot resolve is hidden here
 * and skipped by everything after, which is the honest reading of a point that
 * does not exist rather than a plate frozen where it last was.
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
 * Nudge apart the plates that would otherwise sit on top of each other.
 *
 * Two mobs standing together project to one point, and until this the second plate
 * was drawn exactly over the first: not a crowded reading but a missing one. The
 * game's own thresholds, its own ascending-id order so a stack does not reshuffle
 * as the camera moves, and its own spread around the cluster's mean rather than
 * from the top, so a third joining pushes both neighbours half a step instead of
 * moving everybody down.
 *
 * Pairwise, over at most a dozen plates. The game reaches for a spatial hash
 * because it draws forty of these a frame; this is a dozen comparisons.
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
 * Scale and stack in ONE transform, written only when either moved.
 *
 * They cannot be two properties: `transform` is one, so a second write would
 * discard the first, and the scale has to come after the translation or the stack
 * offset is multiplied by it and a scaled-down plate stacks too tightly.
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

/** A plate whose unit has gone is hidden rather than destroyed: the slow pass owns which plates exist. */
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

/**
 * Take the rank table from whoever is publishing one.
 *
 * `anySender`, which is what `follow` does, because naming `official/longwatch` would be
 * right only on the official marketplace: the same addon installed from a fork publishes
 * under another name. A row that is not the shape below is dropped rather than throwing,
 * so one bad entry cannot cost the other hundred.
 *
 * Silence and a null payload are both ordinary. The first means nobody is publishing and
 * the second a publisher that has not read its table yet, and neither is an error worth
 * putting in front of a player: the plate simply carries no rank.
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
