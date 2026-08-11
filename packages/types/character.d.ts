// Your character sheet: progression, deeds, talents and profession skills.
//
// Split from `world.d.ts`, which describes the world around you. These are all
// reads about YOU: they ride the self payload, so they exist for your character
// and for nobody else's. There is no way to read another player's sheet.
//
// Every field here was confirmed arriving in a recorded session before it was
// published, which is the standing rule: a field earns a place because it was
// found on the wire, never because it is readable on some object.

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

/**
 * Your build.
 */
export interface TalentInfo {
  spec: string | null;
  role: TalentRole | null;
  /** Row level to the option chosen on it. A row not yet picked is absent. */
  rows: Readonly<Partial<Record<TalentRowLevel, string>>>;
  loadouts: readonly SavedLoadout[];
  /**
   * Index into `loadouts`, or -1 when none is active.
   */
  activeLoadout: number;
}

export interface DeedStats {
  /**
   * Lifetime counters, e.g. `kills`, `deaths`, `craftsPerformed`.
   *
   * A counter at 0 genuinely means it never happened, unlike most zero-valued
   * fields on this API: the client fills the whole set from defaults and the
   * server sends every counter it keeps, so nothing here is a field that is
   * merely never written.
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
   * Not a running total, and not a post-cap counter: the game returns before
   * touching this bar for a capped character, and zeroes the remainder on the
   * award that dings you to the cap. So a capped character reads 0 here forever
   * and it is not a field that failed to arrive.
   *
   * A post-cap progression display therefore reads `lifetimeXp`, which is the one
   * that keeps moving. This is the obvious field to reach for and it is the wrong
   * one, which is why it says so here.
   */
  xp: number;
  /**
   * Total ever earned, which keeps rising past the level cap.
   *
   * Monotonic across the whole life of the character: it is credited on every
   * award including at the cap, which is what makes post-cap progression work and
   * what makes it the only field a virtual-level display can be built on.
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
   * Null when untitled. Turning it into something readable needs the game's own
   * deed table, which an addon cannot reach, so this identifies the title rather
   * than spelling it.
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
 * The server sends this as ONE value on purpose, so a client never evaluates a
 * recipe against a pair from one tick and skills from another. Ids throughout:
 * nothing here is display text.
 *
 * READ `synced` FIRST. Every other field, and `craftSkills` beside it, is a
 * client-side default until the server's first crafting delta lands, and a
 * default is indistinguishable from a real answer without this flag. An addon
 * that draws a crafting panel before it flips is drawing zeroes it made up.
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
   * Not the set you can craft. A recipe whose `acquisition` list is empty is
   * grandfathered: known to everyone, and absent from here for that reason rather
   * than because it has not been learned. Cross-reference `world.recipes`.
   */
  knownRecipes: readonly string[];
  /** Work orders inside their cooldown window, sorted. Empty on an older server. */
  cadenceBlockedQuests: readonly string[];
}

/**
 * One gathering tool's slotted effect.
 *
 * A charm crafted onto a tool, which is the difference between owning a tool and
 * what that tool actually does when it swings. Read it to say why a yield came
 * out better than the tool alone explains.
 */
export interface ToolEffectSlot {
  /** The gathering profession whose tool carries it. Never localized text. */
  professionId: string;
  /** The effect's content id. */
  effectId: string;
  /**
   * Charges left.
   *
   * 0 means slotted but SPENT, which is different from unslotted: the bonus
   * stops, the base tool is untouched, and a recharge can restore it. A row at 0
   * is still a row.
   */
  charges: number;
  /**
   * The slot's ceiling, and a real server value rather than a client default.
   *
   * Worth stating because `AbilityCharges.maxCharges` is the opposite case and is
   * deliberately unpublished: the server keeps that one to itself and the client
   * zero-fills it. This one rides the wire.
   */
  maxCharges: number;
  /** `'prompt'` spends a charge only on an explicit per-use confirmation. */
  confirmMode: string;
  /**
   * Whether YOU crafted the charm sitting in this slot.
   *
   * A boolean and never a name: another player's identity does not leave the
   * server, so there is no crafter to display and this is the whole of what can
   * be known about provenance.
   */
  selfCrafted: boolean;
}

/**
 * Your profession standing: two skill counter maps, your crafting identity, and
 * the mobile station you have placed.
 *
 * One member of the game's own professions facet is still left out. Its state
 * view is marked as a stub in the game's own source with a trail of in-flight
 * work behind it, so its shape is the least settled thing an addon could depend
 * on. Everything here is settled.
 */
export interface ProfessionInfo {
  /**
   * Craft id to skill. Independent and additive: gaining one never moves another.
   *
   * All zeroes until `identity.synced`, and that is a client-side default rather
   * than a character with no craft skill. The two look identical; the flag is the
   * only thing that tells them apart.
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
   * EMPTY is the ordinary case and means "nothing slotted", not "not known yet":
   * the game elides the key entirely for a player who has never slotted an
   * effect, which is most of them. So an addon must not start disclosing a
   * limitation to everybody on the strength of an empty list.
   *
   * Published from `apiMinor` 5. An older loader answers an empty array here for
   * the same reason a fresh character does, which is why an addon that READS it
   * has to declare 5 rather than infer support from the value.
   */
  toolEffectSlots: readonly ToolEffectSlot[];
}
