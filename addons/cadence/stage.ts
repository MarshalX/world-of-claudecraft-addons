// Cadence on the stage: the two halves of the strip, which no one session shows.
//
// This is `main.test.ts`'s `start()` with the assertions taken out, for the reason every
// scenario file here is: the suite's fixture is the only description of this addon's world
// anybody has checked, so a scenario inventing its own would be a second one, drifting.
//
// Two panels, and the game decides it rather than a setting. The strip's two distinctive rows
// are a cast with a latency band across its last stretch and a resource with combo points as
// pips, and no single character can be photographed showing both: the points belong to the
// rogue and the rogue on this panel is not casting.
//
// Every name, resource and weapon speed here is the game's own, read off the class and item
// tables the deployed client ships. `aimed_shot` is displayed everywhere as "Long Draw", and
// that divergence is exactly what `world.abilities` exists to close.
//
// The hunter is on mana. The game's `ResourceType` is exactly `rage | mana | energy`, and a
// hunter is on mana like every class without a bar of its own.
//
// The rogue's cast row is empty on purpose. A row with nothing to say keeps its place rather
// than being removed, because the strip is read by muscle memory at a fixed spot, and that is a
// state a player looks at far more often than a full strip.

import type { Scenario, Stage, WorldDraft } from '../../stage/src/stage.ts';

/** The hunter's, and every class the game gives no bar of its own. */
const MANA = 'mana';
/** The rogue's, which is the only one the game draws a combo row for. */
const ENERGY = 'energy';

const HUNTER = 'hunter';
const ROGUE = 'rogue';

/**
 * Zealotsbane Blade, in the shape the self record carries a mainhand. A weapon the hunter can
 * actually hold: `mistcallers_edge` is `requiredClass: WAR`, so a panel using it pictures a
 * hunter swinging a warrior's sword. This one lists hunter among its classes and carries the
 * same 2.3, so the swing row is measured against the same period.
 */
const HUNTER_WEAPON = { min: 18, max: 29, speed: 2.3 };
/** Duskfang Dirk. The speed is what seeds the swing row until it sees a reset. */
const ROGUE_WEAPON = { min: 13, max: 21, speed: 1.7, dagger: true };

/**
 * The box a rogue's strip is photographed at: the addon's own width, five lines.
 *
 * The frame opens sized for the rows, so the first combo point of a session is a fifth line that
 * has to come out of the same box and every row goes down to 10px to make room. That is the
 * addon behaving correctly and the wrong picture: beside a panel whose rows are 14px it reads as
 * two different addons. A rogue drags the strip a line taller on their first fight, and this is
 * that drag, seeded the way the loader stores it.
 */
const ROGUE_BOX = { box: { x: 40, y: 60, w: 190, h: 78 }, visible: true };

/**
 * The round trip behind the band, in milliseconds. Stated rather than driven: the loader
 * measures latency by pairing an outbound input frame's sequence number against a later
 * snapshot's acknowledgement, and only the inbound tap is wired here.
 */
const ROUND_TRIP_MS = 180;

/**
 * The hunter's spellbook, in the game's own shape. One entry, because one is all this addon
 * reads: the cast row looks the casting ability up for its display name and its school, and
 * takes the length off the entity.
 */
const HUNTER_KNOWN = Object.freeze([
  {
    def: { id: 'aimed_shot', name: 'Long Draw', school: 'physical', requiresTarget: true },
    rank: 2,
    cost: 65,
    castTime: 2,
    cooldown: 180,
  },
]);

/** A hunter at the level cap, mid-pull: mana, a melee swing, and a spellbook. */
function aHunter(draft: WorldDraft): void {
  draft.set(draft.player, 'templateId', HUNTER);
  draft.set(draft.player, 'resourceType', MANA);
  draft.set(draft.player, 'resource', 62);
  draft.set(draft.player, 'maxResource', 100);
  draft.set(draft.player, 'weapon', HUNTER_WEAPON);
  draft.set(draft.player, 'autoAttack', true);
  draft.set(draft.world, 'known', HUNTER_KNOWN);
}

/**
 * A rogue mid-fight: energy, a dagger, and no spellbook. Nothing is casting on this panel, so
 * there is nothing for the cast row to look up. What the panel is about is the pips, which come
 * off the self record alone.
 */
function aRogue(draft: WorldDraft): void {
  draft.set(draft.player, 'templateId', ROGUE);
  draft.set(draft.player, 'resourceType', ENERGY);
  draft.set(draft.player, 'resource', 45);
  draft.set(draft.player, 'maxResource', 100);
  draft.set(draft.player, 'weapon', ROGUE_WEAPON);
  draft.set(draft.player, 'autoAttack', true);
}

/**
 * The cast in flight, with everything else on the strip running under it.
 *
 * The global cooldown is 0.9 of a hunter's unhasted 1.5, and the swing 1.4 of the weapon's own
 * 2.3: both are the arithmetic the addon does rather than numbers chosen to look busy.
 *
 * EVERY scenario here needs the settle before the frame: the loop stands down while the frame
 * is hidden, and a saved frame comes up hidden until its stored visibility lands.
 */
async function midCast(stage: Stage): Promise<void> {
  const { player } = stage;
  stage.netState({ latencyMs: ROUND_TRIP_MS });
  stage.set(player, 'swingTimer', 1.4);
  stage.set(player, 'gcdRemaining', 0.9);
  stage.set(player, 'castingAbility', 'aimed_shot');
  stage.set(player, 'castRemaining', 0.8);
  stage.set(player, 'castTotal', 2);
  stage.poll();
  await stage.settle();
  stage.frame();
}

/**
 * Three points of the five this fight has already shown. Two frames, because the strip is as
 * wide as the most points seen this session and there is no maximum on the wire to widen it any
 * other way. A rogue who spent a finisher at five and has rebuilt to three is the only state in
 * which a lit pip and a spent one are both on screen.
 */
async function comboPoints(stage: Stage): Promise<void> {
  const { player } = stage;
  stage.set(player, 'swingTimer', 0.6);
  stage.set(player, 'gcdRemaining', 0.4);
  stage.set(player, 'comboPoints', 5);
  stage.poll();
  await stage.settle();
  stage.frame();
  stage.set(player, 'comboPoints', 3);
  stage.frame();
}

/** Ratcatcher Shiv. A different speed from the mainhand, or the two bars photograph in step. */
const ROGUE_OFFHAND = { min: 9, max: 15, speed: 1.2, dagger: true };
const ROGUE_OFFHAND_ITEM = 'ratcatcher_shiv';

/** A rogue dual-wielding, the only state the offhand row draws in. */
function aDualWieldRogue(draft: WorldDraft): void {
  aRogue(draft);
  draft.set(draft.player, 'offhandWeapon', ROGUE_OFFHAND);
  draft.set(draft.player, 'offhandItemId', ROGUE_OFFHAND_ITEM);
}

/**
 * The two hands out of step. The offhand is watched through its own reset, since the
 * published `offhandWeapon.speed` is an unhasted base: 1.2 seeded, 1.0 observed.
 */
async function bothHands(stage: Stage): Promise<void> {
  const { player } = stage;
  stage.set(player, 'swingTimer', 1.9);
  stage.set(player, 'gcdRemaining', 0.6);
  stage.set(player, 'offhandSwingTimer', 0.2);
  stage.poll();
  await stage.settle();
  stage.frame();
  stage.set(player, 'offhandSwingTimer', 1);
  stage.frame();
  stage.set(player, 'swingTimer', 1.4);
  stage.set(player, 'offhandSwingTimer', 0.7);
  stage.frame();
}

const BOSS_ID = 4101;
const BOSS_NAME = 'Ignivar';
/** The first frame's guess, and what the reset teaches. */
const BOSS_FIRST_SEEN = 2.9;
const BOSS_PERIOD = 3.6;

/**
 * A hunter with a boss selected. The mob must be auto-attacking: the server sends a swing
 * only for an entity that is swinging, so a boss standing still photographs as 'off'.
 */
function aBossFight(draft: WorldDraft): void {
  aHunter(draft);
  draft.mob(BOSS_ID, {
    name: BOSS_NAME,
    level: 62,
    autoAttack: true,
    swingTimer: BOSS_FIRST_SEEN,
  });
  draft.set(draft.player, 'targetId', BOSS_ID);
}

/**
 * The boss's swing through one reset: the guess, the swing landing, and the corrected bar
 * draining against the length it just learned.
 */
async function bossSwing(stage: Stage): Promise<void> {
  const { player } = stage;
  const boss = stage.entities.get(BOSS_ID) as Record<string, unknown>;
  stage.set(player, 'swingTimer', 0.7);
  stage.set(player, 'gcdRemaining', 0.5);
  stage.poll();
  await stage.settle();
  stage.frame();
  stage.set(boss, 'swingTimer', BOSS_PERIOD);
  stage.frame();
  stage.set(boss, 'swingTimer', BOSS_PERIOD / 2);
  stage.set(player, 'swingTimer', 1.9);
  stage.frame();
}

/**
 * The movement multiplier as a live v2 session carries it. All three fields: the loader
 * answers null unless the session negotiated movement wire 2 and is not spectating.
 */
function statedSpeed(draft: WorldDraft, mult: number): void {
  draft.set(draft.world, 'spectating', null);
  draft.set(draft.world, 'movementWireVersion', 2);
  draft.set(draft.world, 'reconMoveSpeedMult', mult);
}

/** A hunter kited at 40% speed. */
function aSnaredHunter(draft: WorldDraft): void {
  aHunter(draft);
  statedSpeed(draft, 0.4);
}

/**
 * A rogue in Stealth, which the row must NOT draw: the game folds stealth into the same
 * `Math.min` as a snare and a rogue's Stealth is value 0.5, so the number cannot tell them apart.
 */
function aStealthedRogue(draft: WorldDraft): void {
  aRogue(draft);
  statedSpeed(draft, 0.5);
  draft.set(draft.player, 'auras', [
    { id: 'stealth', kind: 'stealth', value: 0.5, remaining: 3600 },
  ]);
}

/** The rows running under whichever speed the world was drafted with. */
async function moving(stage: Stage): Promise<void> {
  const { player } = stage;
  stage.set(player, 'swingTimer', 1.6);
  stage.set(player, 'gcdRemaining', 0.7);
  stage.poll();
  await stage.settle();
  stage.frame();
}

const CAST_ALT = 'four thin bars on a bare strip: swing, global cooldown, cast, resource.';

const COMBO_ALT = 'the same four on a rogue, over a row of combo pips.';

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'cast',
    label: 'A hunter mid-cast',
    preview: true,
    caption: 'Casting',
    alt: CAST_ALT,
    world: aHunter,
    run: midCast,
  },
  {
    id: 'combo',
    label: 'A rogue holding combo points',
    preview: true,
    caption: 'Combo points',
    alt: COMBO_ALT,
    frames: { strip: ROGUE_BOX },
    world: aRogue,
    run: comboPoints,
  },
  {
    // NOT a preview panel, nor any below: the committed picture and its alt describe four bars.
    id: 'snared',
    label: 'A hunter kited',
    settings: { 'show-speed': true },
    world: aSnaredHunter,
    run: moving,
  },
  {
    // The same 0.5 a hard snare gives, on a rogue in Stealth: the row draws nothing.
    id: 'stealthed',
    label: 'A rogue stealthed, which is not a snare',
    settings: { 'show-speed': true },
    world: aStealthedRogue,
    run: moving,
  },
  {
    id: 'offhand',
    label: 'A rogue weaving two weapons',
    settings: { 'show-offhand-swing': true },
    world: aDualWieldRogue,
    run: bothHands,
  },
  {
    // The setting on and nothing in the offhand: the row takes no line.
    id: 'offhand-empty',
    label: 'The offhand row with no offhand held',
    settings: { 'show-offhand-swing': true },
    world: aHunter,
    run: async (stage) => {
      stage.set(stage.player, 'swingTimer', 1.4);
      stage.set(stage.player, 'gcdRemaining', 0.6);
      stage.poll();
      await stage.settle();
      stage.frame();
    },
  },
  {
    id: 'target',
    label: 'A boss to watch',
    settings: { 'show-target-swing': true },
    world: aBossFight,
    run: bossSwing,
  },
  {
    // Nothing selected: the row reads 'no target' rather than an empty bar, which would mean
    // a swing of zero.
    id: 'no-target',
    label: 'The target row with nothing selected',
    settings: { 'show-target-swing': true },
    world: aHunter,
    run: async (stage) => {
      stage.set(stage.player, 'swingTimer', 1.4);
      stage.poll();
      await stage.settle();
      stage.frame();
    },
  },
  {
    // Standing about, which is most of a session. Every row has nothing to say and every row is
    // still there: the swing reads 'off', the global cooldown is empty because empty means the
    // next press goes through, and the cast row is named after nothing.
    id: 'idle',
    label: 'Nothing running',
    world: (draft) => {
      aHunter(draft);
      draft.set(draft.player, 'autoAttack', false);
      draft.set(draft.player, 'resource', 100);
    },
    run: async (stage) => {
      stage.poll();
      await stage.settle();
      stage.frame();
    },
  },
];

export { SCENARIOS };
