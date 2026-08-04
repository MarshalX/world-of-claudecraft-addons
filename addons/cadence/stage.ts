// Cadence on the stage: the two halves of the strip, which no one session shows.
//
// This is `main.test.ts`'s `start()` with the assertions taken out, for the reason
// every scenario file here is: the suite's fixture is the only description of this
// addon's world anybody has checked, so a scenario inventing its own would be a
// second one, drifting, with a screenshot as the only place the difference showed.
//
// TWO PANELS, AND THE GAME DECIDES IT RATHER THAN A SETTING. The strip's two
// distinctive rows are a cast with a latency band across its last stretch and a
// resource with combo points as pips, and no single character can be photographed
// showing both: the points belong to the rogue and the rogue on this panel is not
// casting. So a picture of either alone is a picture of half the addon, which is
// the same reason `cooldown-bars` ships a sheet.
//
// EVERY NAME, RESOURCE AND WEAPON SPEED HERE IS THE GAME'S OWN, read off the class
// and item tables the deployed client ships rather than invented. `aimed_shot` is
// displayed everywhere as "Long Draw", and that divergence is exactly what
// `world.abilities` exists to close: a label worked out from the id would read
// "Aimed Shot", which is a name the game does not use anywhere.
//
// THE HUNTER IS ON MANA, and that is worth stating because this scenario used to
// put it on `focus`. There is no such resource: the game's `ResourceType` is
// exactly `rage | mana | energy` and a hunter is on mana like every class without
// a bar of its own. The addon carried a matching "Focus" label, this picture
// showed it, and nothing in either was reachable from a running game.
//
// THE ROGUE'S CAST ROW IS EMPTY ON PURPOSE. A row with nothing to say keeps its
// place rather than being removed, because the strip is read by muscle memory at a
// fixed spot, and that is a state a player looks at far more often than a full
// strip. Photographing it beside a running cast is what says the row was always
// there.

import type { Scenario, Stage, WorldDraft } from '../../stage/src/stage.ts';

/** The hunter's, and every class the game gives no bar of its own. */
const MANA = 'mana';
/** The rogue's, which is the only one the game draws a combo row for. */
const ENERGY = 'energy';

const HUNTER = 'hunter';
const ROGUE = 'rogue';

/**
 * Zealotsbane Blade, in the shape the self record carries a mainhand.
 *
 * A weapon the hunter can actually hold, which the one before it was not:
 * `mistcallers_edge` ("Fogbinder's Edge") is `requiredClass: WAR`, so the panel
 * pictured a hunter swinging a warrior's sword at the right speed. This one lists
 * hunter among its classes and happens to carry the same 2.3, so the swing row is
 * measured against the same period it always was.
 */
const HUNTER_WEAPON = { min: 18, max: 29, speed: 2.3 };
/** Duskfang Dirk. The speed is what seeds the swing row until it sees a reset. */
const ROGUE_WEAPON = { min: 13, max: 21, speed: 1.7, dagger: true };

/**
 * The box a rogue's strip is photographed at: the addon's own width, five lines.
 *
 * The frame opens sized for the ROWS, so the first combo point of a session is a
 * fifth line that has to come out of the same box and every row goes down to 10px
 * to make room. That is the addon behaving correctly and the wrong picture: beside
 * a panel whose rows are 14px it reads as two different addons rather than as one
 * class carrying a line the other has not got. A rogue drags the strip a line
 * taller on their first fight, and this is that drag, seeded the way the loader
 * stores it.
 */
const ROGUE_BOX = { box: { x: 40, y: 60, w: 190, h: 78 }, visible: true };

/**
 * The round trip behind the band, in milliseconds.
 *
 * Stated rather than driven, and it is the one thing on the strip that has to be:
 * the loader measures latency by pairing an outbound input frame's sequence number
 * against a later snapshot's acknowledgement, and only the inbound tap is wired
 * here. The suite states one for the same reason.
 */
const ROUND_TRIP_MS = 180;

/**
 * The hunter's spellbook, in the game's own shape.
 *
 * One entry, because one is all this addon reads: the cast row looks the casting
 * ability up for its display NAME and its school, and takes the length off the
 * entity. `cooldown` rides along as part of the shape and is read by nobody here.
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
 * A rogue mid-fight: energy, a dagger, and no spellbook.
 *
 * Nothing is casting on this panel, so there is nothing for the cast row to look
 * up and a spellbook here would be a fixture no row reads. What the panel is
 * about is the pips, which come off the self record alone.
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
 * The global cooldown is 0.9 of a hunter's unhasted 1.5, and the swing 1.4 of the
 * weapon's own 2.3: both are the arithmetic the addon does rather than numbers
 * chosen to look busy, so what is on screen is what those inputs actually draw.
 *
 * The settle before the frame is not a formality, and every scenario here needs
 * it. This addon's loop stands down while its frame is hidden, and a saved frame
 * comes up hidden until its stored visibility arrives, so a tick before that
 * lands paints nothing at all: the rows are built and every countdown is blank,
 * which photographs as an addon that draws labels and no numbers.
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
 * Three points of the five this fight has already shown.
 *
 * Two frames, because the strip is as wide as the most points seen this SESSION
 * and there is no maximum on the wire to widen it any other way. A rogue who
 * spent a finisher at five and has rebuilt to three is what that looks like, and
 * it is the only state in which a lit pip and a spent one are both on screen.
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

const CAST_ALT =
  'four thin rows. Swing at 1.4s of the 2.3 second weapon it learned from, GCD at 0.9s, a cast row named Long Draw with 0.8s left, and a Mana bar at 62 of 100. A pale band lies across the last stretch of the cast, covering the 180ms round trip the loader measured, and it is a measurement rather than a promise that a press inside it queues. There are no pips: a hunter has no combo points.';

const COMBO_ALT =
  'the same four rows on a rogue. Swing at 0.6s of a 1.7 second dagger, GCD at 0.4s against the one second base the game gives this class alone, an empty Cast row keeping its place rather than appearing when a cast starts, and an Energy bar at 45 of 100. Under it a strip of five pips with three lit, five being the most points this session has shown rather than a maximum anything on the wire states.';

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
    // Standing about, which is most of a session and the state nobody thinks to
    // photograph. Every row has nothing to say and every row is still there: the
    // swing reads 'off' rather than counting to a swing that is not coming, the
    // global cooldown is empty because empty means the next press goes through,
    // and the cast row is named after nothing.
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
