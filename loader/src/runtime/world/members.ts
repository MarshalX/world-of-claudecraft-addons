// Whether the game still carries each world member under the name the loader reads.
//
// A presence check, and a separate concern from `shape.ts`, which asks whether a
// live entity's FIELDS are the kinds the published types promise. This one asks a
// question that check cannot: `fieldValue` answers null for a member that is
// missing and for one that is genuinely null, so a game release that RENAMES a
// member leaves a reading that is present, correctly typed and permanently empty.
//
// That is the `inCombat` failure with a new face, and the proximity-gated economy
// reads are its worst case: `market`, `mail` and `bank` would all report `away`
// for an entire session. Unlike a value that never moves, that answer is CORRECT
// whenever the player is genuinely not standing at the counter, so nothing about
// it looks wrong from the outside and no amount of watching finds it.
//
// This list is a CLAIM, exactly as `ENTITY_SHAPE` is, and it goes stale the same
// way: a new read off the world object belongs here too. It is presence only,
// because the kinds are asserted at each read site and there is no useful way to
// type-check a member nothing has asked for yet.

/** Every member the loader reads off `__game.world`. */
const WORLD_MEMBERS: readonly string[] = [
  'activeLoadout',
  'activeMobileStationCraft',
  'activeTitle',
  'arenaInfo',
  'bagCapacity',
  'bags',
  'bankInfo',
  'bgInfo',
  'copper',
  'craftingIdentity',
  'craftSkills',
  'craftVaultStock',
  'deedsEarned',
  'deedStats',
  'delveClears',
  'delveRun',
  'duelInfo',
  'dungeonFinderBoard',
  'dungeonFinderInfo',
  'entities',
  'equipment',
  'equipmentInstances',
  'gatheringProficiency',
  'honor',
  'inventory',
  'known',
  'lifetimeHonor',
  'lifetimeXp',
  'loadouts',
  'lootRollGroupStatus',
  'lootRollPrompts',
  'mailInfo',
  'mailUnread',
  'markers',
  'marketCollectPending',
  'marketInfo',
  'nodeCooldowns',
  'partyInfo',
  'player',
  'prestigeRank',
  'questLog',
  'questsDone',
  'renown',
  'restedXp',
  'selfLockouts',
  'talentRole',
  'talents',
  'talentSpec',
  'unlockedMilestones',
  'vaultInfo',
  'vendorBuyback',
  'xp',
];

/**
 * Which world members the game no longer carries under the name the loader reads.
 *
 * `in` rather than a value read, deliberately: it walks the prototype chain, so it
 * finds the online client's plain fields and the offline sim's getters alike, and
 * it separates "absent" from "present and null", which is the whole point.
 */
function checkWorldMembers(value: unknown): readonly string[] {
  if (typeof value !== 'object' || value === null) {
    return ['expected a world object'];
  }
  const source = value as Record<string, unknown>;
  return WORLD_MEMBERS.filter((member) => !(member in source)).map(
    (member) => `${member} is not on the world object`,
  );
}

export { checkWorldMembers, WORLD_MEMBERS };
