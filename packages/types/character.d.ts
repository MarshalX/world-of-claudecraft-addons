// Your character sheet: progression, deeds, talents and profession skills.
//
// All reads about YOU, from the self payload. There is no way to read another
// player's sheet.

/** The levels a talent build has rows on. */
export type TalentRowLevel = 5 | 8 | 11 | 14 | 17 | 20;

export type TalentRole = 'tank' | 'healer' | 'dps';

/** One saved build, with the action bar that went with it. */
export interface SavedLoadout {
  name: string;
  spec: string | null;
  /** Row level to the option chosen on it. A row not yet picked is absent. */
  rows: Readonly<Partial<Record<TalentRowLevel, string>>>;
  /** Null in a slot left empty. */
  bar: readonly (string | null)[];
}

/** Your build. */
export interface TalentInfo {
  spec: string | null;
  role: TalentRole | null;
  /** Row level to the option chosen on it. A row not yet picked is absent. */
  rows: Readonly<Partial<Record<TalentRowLevel, string>>>;
  loadouts: readonly SavedLoadout[];
  /** Index into `loadouts`, or -1 when none is active. */
  activeLoadout: number;
}

export interface DeedStats {
  /**
   * Lifetime counters, e.g. `kills`, `deaths`, `craftsPerformed`.
   *
   * A counter at 0 genuinely means it never happened: the server sends every
   * counter it keeps.
   */
  counters: Readonly<Record<string, number>>;
  itemsDiscovered: ReadonlySet<string>;
  visited: ReadonlySet<string>;
  /** Dungeon id to final-boss clears. A heroic clear is keyed `<id>:heroic`. */
  dungeonClears: Readonly<Record<string, number>>;
}

export interface CharacterInfo {
  /**
   * Progress within the CURRENT level, and FROZEN AT 0 once you hit the cap.
   *
   * A capped character reads 0 here forever. A post-cap progression display reads
   * `lifetimeXp`, which keeps moving.
   */
  xp: number;
  /**
   * Total ever earned, which keeps rising past the level cap.
   *
   * Monotonic for the life of the character, credited on every award including
   * at the cap, so it is the field a virtual-level display is built on.
   */
  lifetimeXp: number;
  /** The rested pool, 0 when not rested. */
  restedXp: number;
  prestigeRank: number;
  honor: number;
  lifetimeHonor: number;
  renown: number;
  /**
   * Your displayed title as a DEED ID, never display text.
   *
   * Null when untitled. Nothing on this API resolves it to readable text.
   */
  activeTitle: string | null;
  milestones: readonly string[];
  /** Deed id to the day it was earned, or '' where the host set no calendar. */
  deeds: ReadonlyMap<string, string>;
  deedStats: DeedStats;
}

/**
 * Your crafting archetype, your pairs, and what you have learned.
 *
 * Sent as ONE value, so the fields are always consistent with each other. Ids
 * throughout, never display text.
 *
 * READ `synced` FIRST. Until it flips, every other field, and `craftSkills`
 * beside it, is a client-side default that looks like a real answer.
 */
export interface CraftingIdentity {
  /** False until the game has received its first crafting value this session. */
  synced: boolean;
  /** The active archetype id, or null before attunement. An id, never a title. */
  archetype: string | null;
  pairedMajor: string | null;
  hobbyCraft: string | null;
  /** Canonical pair ids, sorted by the server. */
  attunedPairs: readonly string[];
  switchCount: number;
  amendsProgress: number;
  amendsRequired: number;
  /**
   * Recipe ids you LEARNED from a source, sorted.
   *
   * Not the set you can craft: a recipe with an empty `acquisition` list is known
   * to everyone and absent from here. Cross-reference `world.recipes`.
   */
  knownRecipes: readonly string[];
  /** Work orders inside their cooldown window, sorted. Empty on an older server. */
  cadenceBlockedQuests: readonly string[];
}

/**
 * One gathering tool's slotted effect.
 *
 * A charm crafted onto a tool, which explains a yield better than the tool alone
 * gives.
 */
export interface ToolEffectSlot {
  /** The gathering profession whose tool carries it. Never localized text. */
  professionId: string;
  /** The effect's content id. */
  effectId: string;
  /**
   * Charges left.
   *
   * 0 means slotted but SPENT, not unslotted: the bonus stops until a recharge.
   * A row at 0 is still a row.
   */
  charges: number;
  /**
   * The slot's ceiling. A real server value, not a client default.
   */
  maxCharges: number;
  /** `'prompt'` spends a charge only on an explicit per-use confirmation. */
  confirmMode: string;
  /**
   * Whether YOU crafted the charm sitting in this slot.
   *
   * A boolean, never a name: another player's identity does not leave the
   * server.
   */
  selfCrafted: boolean;
}

/**
 * Your profession standing: two skill counter maps, your crafting identity, and
 * the mobile station you have placed.
 *
 * One member of the game's professions state is deliberately left out until its
 * shape settles.
 */
export interface ProfessionInfo {
  /**
   * Craft id to skill. Independent and additive: gaining one never moves another.
   *
   * All zeroes until `identity.synced`, a client-side default that looks exactly
   * like a character with no craft skill.
   */
  craftSkills: Readonly<Record<string, number>>;
  /** Gathering profession id to proficiency, the same kind of counter. */
  gathering: Readonly<Record<string, number>>;
  /** Archetype, pairs, and what has been learned. Read `identity.synced` first. */
  identity: CraftingIdentity;
  /**
   * The craft id of the mobile station you have placed, or null when none is.
   *
   * A recipe naming a `stationType` can be crafted beside a mobile station whose
   * craft maps to that type, as well as at an authored one in `world.stations`.
   */
  mobileStation: string | null;
  /**
   * Your slotted tool effects, one row per gathering profession that has one,
   * sorted by `professionId`.
   *
   * EMPTY is the ordinary case and means "nothing slotted", not "not known yet".
   *
   * Published from `apiMinor` 5. An older loader answers an empty array too, so an
   * addon that READS it declares 5 rather than inferring support from the value.
   */
  toolEffectSlots: readonly ToolEffectSlot[];
}
