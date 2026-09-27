// Facemark on the stage. There is no panel, so the crop comes from the world anchors: see
// `drawnIn` in stage/src/sheet.ts.
//
// Every name, id and level is the game's own: an invented id title-cases into a label that looks
// real and hides the `?` that marks a derived name (`rift_thunderhead` is really "Thunderhead").
//
// The boss carries both aura id shapes (the ability's own id, and a control aura id with a tail
// that must come off to resolve art). The healer's aura was applied by a mob, so it has no art.
// The model heights differ by a factor of two, which is what `over: 'head'` is for.

import type { Scenario, Stage, WorldDraft } from '../../stage/src/stage.ts';

/** What the shared fixture fixes the local player at. */
const PLAYER_ID = 661;

/**
 * Real pools from the game's arithmetic, so the count and the share differ: a pool of 100 makes
 * them the same number. `rift_boss_storm` elite at 22 is `(740 + 64 * 21) * 2.3`.
 */
const BOSS_MAX_HP = 4793;
const BOSS_HP = 2780;
const PLAYER_MAX_HP = 462;
/** A caster's pool at that scale, 60 percent full. */
const BOSS_MAX_MANA = 2000;
const BOSS_MANA = 1200;

const BOSS = 900;
const HEALER = 903;
/** The battleground pane: two of theirs in scope, and one of yours who is not. */
const RIVAL = 905;
const ALLY = 906;
const CASTER = 907;
/** A real mage cast with art on every channel, as a fixture id must be (see `AGENTS.md`). */
const ENEMY_CAST = 'frostbolt';
const ENEMY_CAST_LEFT = 1.1;
/** The two teams, by the index the game gives each. */
const CRIMSON = 0;
const AZURE = 1;

/** First in the game's own mark index order. */
const STAR = 0;

/** The directory skill art is filed under. */
const CLASS_ID = 'hunter';

/** Both display under a name their id does not spell; art resolves because it is filed by id. */
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
    // Two above the player: the game's orange con band.
    level: 22,
    hp: BOSS_HP,
    maxHp: BOSS_MAX_HP,
    resourceType: 'mana',
    resource: BOSS_MANA,
    maxResource: BOSS_MAX_MANA,
    // Pointed at the player, which is what tones a cast bar.
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
  // Selected, for the larger name and white edge. No combo points: a hunter has none.
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
    // `aoe_slow` is shared by every template that has one, so it is not an ability id and has no
    // art. The shield is the lighter strip past the end of her health.
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
        // Scaled with the pool it is laid over, or it draws as a hairline.
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
 * In `run` rather than `world`, against the usual advice: units already present fire no
 * `entities` handler, so the plates would wait for the 100ms sampler, after the scenario's frame.
 */
function aPull(stage: Stage): void {
  addBoss(stage);
  addHealer(stage);
  stage.poll();
  stage.frame();
}

/**
 * Both enemy players carry `hostile: false`, as the game sends them, so red comes from the
 * roster alone. Setting `hostile: true` would hide a broken roster read.
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
        // In the roster but not in scope, as a distant teammate is: nothing draws her.
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

/** An enemy player casting at you: only a player's cast resolves art, which is filed by class. */
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
    // Looks identical to the addon switched off, which is why the toggle toasts.
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
