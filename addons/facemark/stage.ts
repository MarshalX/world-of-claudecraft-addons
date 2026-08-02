// Facemark on the stage: two plates, one hostile and one friendly.
//
// There is no panel to photograph. The plates ARE the display, so the picture is
// world anchors over a flat background and the crop is taken from them: see
// `drawnIn` in stage/src/sheet.ts, which counts an anchor as drawing.
//
// EVERY NAME, ID AND LEVEL HERE IS THE GAME'S OWN, read out of its content files
// rather than invented. That is not decoration: an invented id title-cases into a
// label that looks exactly like the real name, so a made-up `flame_pillar` reading
// as "Flame Pillar?" made the addon's own limit look like a rounding error. The real
// one does not. `rift_thunderhead` is what the entity carries while Tempest Vharok
// casts (`mob.castingAbility = bigCast.castId`), the game shows that cast as
// "Thunderhead", and this addon can only reach the id, so the plate says
// "Rift Thunderhead?" and the question mark is doing real work.
//
// The levels are the game's too. A player caps at 20, so Anserra is 20 and so are
// you; the rift bosses run to 23 and Tempest Vharok is one of them.
//
// TWO UNITS, ONE OF EACH SIDE, and the pairing is the whole composition. A first
// version put three hostiles in the shot, which drew three red names and said
// nothing about the half of the display that is not red: the name colours are the
// GAME's own, and telling a mob from a party member at a glance is most of what a
// nameplate is for. So the shot is a mob and a healer, and every other difference
// between the two rides along for free:
//
//  - THE BOSS is casting something no spellbook names, so its label is title-cased
//    from the id and carries the question mark that says so. Its two effects are
//    both yours and are the two SHAPES an aura id comes in: `serpent_sting` is a
//    dot, whose aura id is the ability's own, and `concussive_shot_slow` is a
//    control aura, which is the ability id with a tail the game appended. Both
//    resolve art, and the second only because this addon takes the tail off. It is
//    marked with the STAR, and that is the reason it is
//    not the Skull: mark art is painted on a canvas at run time, so a mark is
//    written as a NAME in the game's own colour for it, and the game's Skull is
//    near-white. The first version of this scenario picked exactly the one mark in
//    eight that shows nothing about the colouring, which read as a mark that had
//    not been coloured at all. The player is top of its hate table, so its edge is
//    the game's own threat red.
//  - THE HEALER is a friendly player: a blue name, no threat edge at all because a
//    player keeps no hate table, and one harmful effect, which is what the strip
//    means on a friendly. It is what is being DONE to them, and it is the same rule
//    as on the boss rather than a second one for allies. That effect is the boss's
//    own snare, `aoe_slow`, and it is the unresolvable half of the icon limit: a
//    MOB applied it, the game paints its icon on a canvas at run time, and there is
//    no file anywhere to point at. It draws as its school and its countdown.
//
// `show: 'players'` rather than the default, because the default draws hostiles
// only and half this picture is a friendly. It is a setting a player who wants
// party plates would choose, not a state the addon cannot otherwise reach.
//
// The model heights are stated because they are the reason `over: 'head'` exists:
// the boss is drawn twice the healer's height, and the two plates clear their own
// models rather than sitting at one offset that suits neither.

import type { Scenario, Stage, WorldDraft } from '../../stage/src/stage.ts';

/** The local player's own entity id, which the shared fixture fixes at 661. */
const PLAYER_ID = 661;

const BOSS = 900;
const HEALER = 903;

/** The Star, which is the first mark in the game's own index order. */
const STAR = 0;

/** The class the player is, which is the directory skill art is filed under. */
const CLASS_ID = 'hunter';

/**
 * This hunter's spellbook, in the game's own shape and with its own names.
 *
 * Both of these are displayed under a name their id does not spell: `serpent_sting`
 * is "Venom Barb" and `concussive_shot` is "Rattling Shot". That divergence is the
 * whole reason a name worked out from an id is a guess rather than a near miss, and
 * it is also what makes these two safe to draw art for: art is filed under the ID,
 * and the aura carries the id whatever the game calls it on screen.
 */
const KNOWN = Object.freeze([
  {
    def: { id: 'serpent_sting', name: 'Venom Barb', school: 'nature', requiresTarget: true },
    rank: 3,
    cost: 15,
    castTime: 0,
    cooldown: 0,
  },
  {
    def: { id: 'concussive_shot', name: 'Rattling Shot', school: 'physical', requiresTarget: true },
    rank: 2,
    cost: 20,
    castTime: 0,
    cooldown: 12,
  },
]);

/** One effect in the shape the client decodes onto the entity. */
function aura(over: Record<string, unknown>): Record<string, unknown> {
  return { kind: 'dot', remaining: 6, duration: 12, value: 40, school: 'nature', ...over };
}

/** A cast where the game writes one, which is on the entity and nowhere else. */
function casting(draft: WorldDraft, unit: Record<string, unknown>, id: string, left: number): void {
  draft.set(unit, 'castingAbility', id);
  draft.set(unit, 'castRemaining', left);
  draft.set(unit, 'castTotal', 3.5);
  draft.set(unit, 'channeling', false);
}

/** The boss: everything this display can say about one unit, on one plate. */
function addBoss(draft: WorldDraft): void {
  const boss = draft.mob(BOSS, {
    name: 'Tempest Vharok',
    templateId: 'rift_boss_storm',
    level: 22,
    hp: 58,
    maxHp: 100,
    pos: { x: 1.5, y: 0, z: -14 },
    auras: [
      aura({
        id: 'serpent_sting',
        name: 'Venom Barb',
        remaining: 9.4,
        duration: 15,
        sourceId: PLAYER_ID,
      }),
      aura({
        id: 'concussive_shot_slow',
        name: 'Rattling Shot',
        kind: 'slow',
        school: 'physical',
        remaining: 4.2,
        duration: 6,
        value: 0.6,
        sourceId: PLAYER_ID,
      }),
    ],
    threat: new Map<number, number>([[PLAYER_ID, 9400]]),
  });
  draft.model(BOSS, { height: 3.6 });
  casting(draft, boss, 'rift_thunderhead', 2.1);
  draft.set(draft.world, 'markers', { [String(BOSS)]: STAR });
}

/** The healer: the other side, which is the half a hostile-only shot never shows. */
function addHealer(draft: WorldDraft): void {
  draft.mob(HEALER, {
    name: 'Anserra',
    kind: 'player',
    hostile: false,
    templateId: 'priest',
    level: 20,
    hp: 66,
    maxHp: 100,
    pos: { x: -3, y: 0, z: -10 },
    // The boss's own anti-kite snare, in the shape its emit site builds: a bare
    // `aoe_slow` id shared by every template that has one, so it is not an ability
    // id and could not resolve art even if a mob's art were served.
    auras: [
      aura({
        id: 'aoe_slow',
        name: 'Static Field',
        kind: 'slow',
        remaining: 3.4,
        duration: 4,
        value: 0.55,
        sourceId: BOSS,
      }),
    ],
    threat: new Map<number, number>(),
  });
  draft.model(HEALER, { height: 1.8 });
}

/** Who you are, which is everything the addon reads before a plate exists. */
function aHunter(draft: WorldDraft): void {
  draft.set(draft.player, 'templateId', CLASS_ID);
  draft.set(draft.player, 'pos', { x: 0, y: 0, z: 0 });
  draft.set(draft.world, 'known', KNOWN);
}

/**
 * The pull walking into range, which is the only way a plate is ever built.
 *
 * In `run` rather than in `world`, and this is the one place the stage's usual
 * advice does not apply. `world.on('entities')` reports MEMBERSHIP, so a unit that
 * was already there when the addon started is a set that never changed and no
 * handler fires: the plates would then appear on the addon's own 100ms sampler,
 * which is after the single frame a scenario drives, and every anchor would be
 * captured still hidden. Stated here, the poll below is a real change and the frame
 * after it places them.
 */
function aPull(stage: Stage): void {
  addBoss(stage);
  addHealer(stage);
  stage.poll();
  stage.frame();
}

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'pull',
    label: 'A mob and a party member',
    preview: true,
    settings: { show: 'players' },
    alt: 'two nameplates floating over the units they belong to. Tempest Vharok, level 22, the name in hostile red beside a yellow Star raid mark, a health bar at 58 percent, a cast bar reading Rift Thunderhead? because only the ability id reaches an addon and the name was worked out from it, and two effect tiles under it, Venom Barb and Rattling Shot, each carrying the art the game files under that ability. A red edge runs down its left, saying the player is top of its hate table. Beside it the friendly player Anserra at level 20 and 66 percent health, the name in player blue, no threat edge at all because a player keeps no hate table, and one effect on them, the boss snare Static Field, drawn as a bordered countdown with no picture because an effect a mob applied has none anywhere in the game.',
    world: aHunter,
    run: aPull,
  },
  {
    // What the display looks like with nothing around, which is most of a session
    // and the state nobody thinks to photograph. It is also the case the toggle
    // has to be told apart from: an empty screen and a switched-off addon look
    // identical, which is why turning them off toasts the way back.
    id: 'alone',
    label: 'Nothing nearby',
    world: aHunter,
    run: (stage) => {
      stage.poll();
      stage.frame();
    },
  },
];

export { SCENARIOS };
