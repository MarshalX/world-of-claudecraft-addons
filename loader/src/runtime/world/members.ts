// Whether the game still carries each world member under the name the loader reads.
//
// `fieldValue` answers null both for a missing member and a null one, so a renamed member reads
// as permanently empty; the gated economy reads would say `away` all session and look right.
//
// Presence only. Add every new read off the world object here.

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
 * Which world members the game no longer carries under the name the loader reads. Uses `in`,
 * which finds prototype getters too and separates "absent" from "present and null".
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
