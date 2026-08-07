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

const BOSS = 900;
const HEALER = 903;

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
    // A bare `aoe_slow`, shared by every template that has one, so it is not an ability id and
    // could not resolve art even if a mob's were served.
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

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'pull',
    label: 'A mob and a party member',
    preview: true,
    settings: { show: 'players' },
    alt: 'two nameplates over the units they belong to, each with a name, a level, a health bar and effect tiles. The hostile one adds a raid mark, a cast bar and a red threat edge.',
    world: aHunter,
    run: aPull,
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
