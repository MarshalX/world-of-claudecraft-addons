// Facemark on the stage: two plates, one hostile and one friendly.
//
// There is no panel to photograph, so the crop is taken from the world anchors themselves: see
// `drawnIn` in stage/src/sheet.ts.
//
// Every name, id and level is the game's own. An invented id title-cases into a label that looks
// exactly like a real name, which would make this addon's own limit read as a rounding error:
// `rift_thunderhead` is what the entity really carries, the game displays it as "Thunderhead",
// and the plate can only reach the id, so "Rift Thunderhead?" is the question mark doing real work.
//
// The two units are one of each side, since the name colours are the game's own and telling a mob
// from a party member at a glance is most of what a nameplate is for. The boss carries the two
// shapes an aura id comes in, a dot under the ability's own id and a control aura under the id
// with a tail, so both resolve art and the second only because the tail comes off. The healer
// carries the unresolvable half: a mob applied it, so there is no art file anywhere.
//
// The Star rather than the Skull, because a mark is written as a name in the game's colour for it
// and the game's Skull is near-white.
//
// The model heights differ by a factor of two, which is what `over: 'head'` is for.

import type { Scenario, Stage, WorldDraft } from '../../stage/src/stage.ts';

/** What the shared fixture fixes the local player at. */
const PLAYER_ID = 661;

/**
 * Real pools, because a bar out of 100 pictures nothing.
 *
 * Every unit here used to carry `maxHp: 100`, which made the count and the share
 * the same number and the plate look like it said one thing twice. These are the
 * game's own arithmetic: `rift_boss_storm` is `hpBase: 740, hpPerLevel: 64` and
 * elite, so `(740 + 64 * 21) * 2.3` is 4793 at level 22, and a level 20 priest is
 * `38 + 11 * 19` plus its stamina, which lands near 460. The shares are unchanged,
 * so the picture and its alt text still describe the same fight.
 */
const BOSS_MAX_HP = 4793;
const BOSS_HP = 2780;
const PLAYER_MAX_HP = 462;
/** A caster's pool at that scale, kept at the same 60 percent the strip drew before. */
const BOSS_MAX_MANA = 2000;
const BOSS_MANA = 1200;

const BOSS = 900;
const HEALER = 903;
/** The battleground pane: two of theirs in scope, and one of yours who is not. */
const RIVAL = 905;
const ALLY = 906;
const CASTER = 907;
/**
 * A real mage cast, checked on BOTH channels before it went in a fixture.
 *
 * The rule is `AGENTS.md`'s: a preview is one committed file with nothing in it
 * recording which game it was taken from, so an id that ships art on live and not
 * on pbe photographs differently depending on who runs the capture. Measured
 * 2026-08-14: live and both pbe channels carry 69 mage ids and `frostbolt` is in
 * all of them. It is also one of the few things an enemy PLAYER can be caught
 * doing on a cast bar at all, since no rogue ability in the whole class table has
 * a cast time.
 */
const ENEMY_CAST = 'frostbolt';
const ENEMY_CAST_LEFT = 1.1;
/** The two teams, by the index the game gives each. */
const CRIMSON = 0;
const AZURE = 1;

/** First in the game's own mark index order. */
const STAR = 0;

/** The directory skill art is filed under. */
const CLASS_ID = 'hunter';

/**
 * Both of these display under a name their id does not spell (`serpent_sting` is "Venom Barb"),
 * which is why a worked-out name is a guess and why art still resolves: art is filed under the id.
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

/** The shape the client decodes onto an entity. */
function aura(over: Record<string, unknown>): Record<string, unknown> {
  return { kind: 'dot', remaining: 6, duration: 12, value: 40, school: 'nature', ...over };
}

/** A cast lives on the entity and nowhere else. */
function casting(draft: WorldDraft, unit: Record<string, unknown>, id: string, left: number): void {
  draft.set(unit, 'castingAbility', id);
  draft.set(unit, 'castRemaining', left);
  draft.set(unit, 'castTotal', 3.5);
  draft.set(unit, 'channeling', false);
}

function addBoss(draft: WorldDraft): void {
  const boss = draft.mob(BOSS, {
    name: 'Tempest Vharok',
    templateId: 'rift_boss_storm',
    // Two above the player, which is the game's own orange con band. A level that read
    // white said nothing about whether this was worth pulling.
    level: 22,
    hp: BOSS_HP,
    maxHp: BOSS_MAX_HP,
    // A caster's pool, which rides any entity the server gives one and which no plate in
    // the game draws. Three pixels under the health bar.
    resourceType: 'mana',
    resource: BOSS_MANA,
    maxResource: BOSS_MAX_MANA,
    // The cast underneath is pointed at the player, which is the one thing that tones a
    // cast bar here: on every mob cast a tone would mark the whole world urgent.
    castTargetId: PLAYER_ID,
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
  // Selected, so the picture carries what the game's own plate does for a target: the
  // name a step larger and a white edge around its health bar.
  //
  // No combo points, deliberately. The player here is a HUNTER and a hunter has none, so
  // a lit pip row would be a photograph of a game nobody is running, which is the same
  // reason `createPlayer` empties the shared fixture's cooldown map.
  draft.set(draft.player, 'targetId', BOSS);
}

function addHealer(draft: WorldDraft): void {
  draft.mob(HEALER, {
    name: 'Anserra',
    kind: 'player',
    hostile: false,
    templateId: 'priest',
    level: 20,
    hp: 305,
    maxHp: PLAYER_MAX_HP,
    pos: { x: -2.2, y: 0, z: -11.5 },
    // A bare `aoe_slow`, shared by every template that has one, so it is not an ability id and
    // could not resolve art even if a mob's were served. Beside it a shield she put on
    // herself, which is what the lighter strip past the end of her health is: the game
    // draws that on its unit frames and on no nameplate anywhere.
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
      aura({
        id: 'power_word_shield',
        name: 'Warding Word',
        kind: 'absorb',
        school: 'holy',
        remaining: 8,
        duration: 15,
        // Scaled with the pool it is laid over: 22 of a real 462 would be a hairline.
        value: 102,
        sourceId: HEALER,
      }),
    ],
    threat: new Map<number, number>(),
  });
  draft.model(HEALER, { height: 1.8 });
}

/** Everything the addon reads before a plate exists. */
function aHunter(draft: WorldDraft): void {
  draft.set(draft.player, 'templateId', CLASS_ID);
  draft.set(draft.player, 'pos', { x: 0, y: 0, z: 0 });
  draft.set(draft.world, 'known', KNOWN);
}

/**
 * In `run` rather than `world`, against the usual advice: `world.on('entities')` reports
 * membership, so units already present fire no handler and the plates would wait for the addon's
 * own 100ms sampler, which lands after the one frame a scenario drives.
 */
function aPull(stage: Stage): void {
  addBoss(stage);
  addHealer(stage);
  stage.poll();
  stage.frame();
}

/**
 * THE PAIR IS ONE ROW, at one depth and 3.4 apart, and both numbers are the picture.
 *
 * At the stage camera's scale a world unit is about fifty screen pixels, so 3.4 puts a
 * clear gap between plates that are 132 wide, and stays well over the 80px the declutter
 * stack fires under. Equal `z` lands their head points on one line, which is what makes
 * two plates read as one fight rather than as two accidents.
 */

/**
 * A battleground, which is the one place a plate's colours cannot come off the entity.
 *
 * BOTH PLAYERS HERE CARRY `hostile: false`, because that is what the game sends: the flag is
 * written when it builds a mob and nowhere else. So the red plate is red because the bout's
 * roster says that pid is on the other team, and for no other reason. A scenario that set
 * `hostile: true` on the enemy would picture a game nobody is running and would go on looking
 * right after the roster read was deleted.
 */
function aBattleground(draft: WorldDraft): void {
  aHunter(draft);
  draft.set(draft.world, 'bgInfo', {
    match: {
      state: 'active',
      myTeam: CRIMSON,
      capsToWin: 3,
      scores: [1, 2],
      flags: [
        { state: 'home', carrierPid: null, carrierName: null, carrierTeam: null },
        {
          state: 'carried',
          carrierPid: RIVAL,
          carrierName: 'Dravin',
          carrierTeam: AZURE,
        },
      ],
      players: [
        { pid: PLAYER_ID, name: 'Marshal', cls: 'hunter', team: CRIMSON },
        // In the roster and NOT in scope, which is the ordinary state of a teammate in a
        // battleground: the roster is match-wide and an entity only exists inside the
        // interest radius. Nothing draws her, and `myTeam` still has somebody on it.
        { pid: ALLY, name: 'Anserra', cls: 'priest', team: CRIMSON },
        { pid: RIVAL, name: 'Dravin', cls: 'rogue', team: AZURE, carrying: true },
        { pid: CASTER, name: 'Sylve', cls: 'mage', team: AZURE },
      ],
      countdown: 0,
      timeLeft: 252,
      waveIn: [9, 4],
      respawnIn: 0,
      winner: null,
    },
  });
}

function aFight(stage: Stage): void {
  stage.mob(RIVAL, {
    name: 'Dravin',
    kind: 'player',
    hostile: false,
    templateId: 'rogue',
    level: 20,
    hp: 328,
    maxHp: PLAYER_MAX_HP,
    pos: { x: -1.7, y: 0, z: -11.5 },
    auras: [],
    threat: new Map<number, number>(),
  });
  stage.model(RIVAL, { height: 1.8 });
  addCaster(stage);
  stage.poll();
  stage.frame();
}

/**
 * The other half of a battleground: the one who is about to hit you.
 *
 * A PLAYER's cast is the only one whose art resolves, because skill art is filed
 * per class and a player's `templateId` IS their class, so this is where the icon
 * on a cast bar can be pictured at all. It is pointed at the player, which is the
 * one thing that tones a cast bar and the one thing no plate in the game says.
 */
function addCaster(stage: Stage): void {
  const caster = stage.mob(CASTER, {
    name: 'Sylve',
    kind: 'player',
    hostile: false,
    templateId: 'mage',
    level: 20,
    hp: 291,
    maxHp: PLAYER_MAX_HP,
    resourceType: 'mana',
    resource: 640,
    maxResource: 1180,
    castTargetId: PLAYER_ID,
    pos: { x: 1.7, y: 0, z: -11.5 },
    auras: [],
    threat: new Map<number, number>(),
  });
  stage.model(CASTER, { height: 1.8 });
  casting(stage, caster, ENEMY_CAST, ENEMY_CAST_LEFT);
}

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'pull',
    label: 'A mob and a party member',
    preview: true,
    caption: 'A pull',
    settings: { show: 'players' },
    alt: 'two nameplates over the units they belong to, each with a name, a level and a health bar. The hostile one is the current target: a drawn star marks it, its level is orange for being two above the player, its health bar is edged in white and carries a thin blue mana strip under it, and under its cast bar a red tag says the cast is coming at you. The friendly one shows a lighter shield laid over the end of its health bar and an effect tile.',
    world: aHunter,
    run: aPull,
  },
  {
    id: 'battleground',
    label: 'A battleground',
    preview: true,
    caption: 'A battleground',
    settings: { show: 'everything' },
    alt: "two player nameplates in a battleground, side by side, both named in red for the other side. Each health bar is tinted with that player's class colour, olive for the rogue and cyan for the mage. The rogue is marked as carrying a flag; the mage's cast bar shows the frostbolt icon beside its name, with a red tag under it saying the cast is coming at you and a thin blue mana strip over it.",
    world: aBattleground,
    run: aFight,
  },
  {
    // Nothing around, which an addon switched off looks identical to. That is why the toggle toasts.
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
