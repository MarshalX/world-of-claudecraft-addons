// The world around the entity: the group, the bags, the quest log, the ground,
// and every read `woc.world` answers.
//
// The entity and its parts live in `entity.d.ts` and are re-exported through
// `index.d.ts` alongside these, so an addon author sees one surface either way.

import type { AbilityIndex } from './abilities.js';
import type { Unsubscribe } from './addon.js';
import type { ArenaStandings } from './arena.js';
import type { CharacterInfo, ProfessionInfo, TalentInfo } from './character.js';
import type { Recipe, Station } from './content.js';
import type { BankState, MailState, MarketState } from './economy.js';
import type { Aura, Entity, EquipSlot, ItemInstance, Vec3 } from './entity.js';
import type { FinderInfo, FinderListingRow } from './finder.js';
import type { EncounterInfo, GroupInfo, ThreatTable } from './group.js';
import type { MatchInfo } from './match.js';
import type { PartyAuraQuery, PartyInfo, PartyMemberAura } from './party.js';
import type { CorpseView, DeathZone, Hazard } from './world-ground.js';
import type { HeldSlot, InvSlot } from './world-items.js';

export interface QuestProgress {
  questId: string;
  /** One count per objective, in the quest's own order. */
  counts: number[];
  state: 'active' | 'ready' | 'done';
  /** The reward or branch the player chose, for a quest that offers one. */
  selection?: string;
}

export interface WorldQuests {
  /** Quest id to its live progress. */
  readonly log: ReadonlyMap<string, QuestProgress> | null;
  /** The ids of finished quests. */
  readonly done: ReadonlySet<string> | null;
}

/**
 * What a cast bar says, on any entity rather than only on you.
 *
 * Read this rather than listening for a cast event. `net.onEvent('castStart')`
 * fires for a PLAYER cast, a pet's cast, and the timed ACTIVITIES the game runs
 * through the same machinery, and never for a mob: a mob's mechanic sets its cast
 * state directly, so a boss mod built on the event receives silence and has no way
 * to tell that from a boss that never casts. `world.casts` and
 * `world.on('casts', ...)` are the surface that closes that gap.
 */
export interface EntityCast {
  /**
   * An ability ID, or an ACTIVITY SENTINEL.
   *
   * The sentinel is a fixed marker naming a timed activity rather than any
   * ability, and the set grows with the game, so match the ones you care about
   * by name and let anything else fall through as an ability id.
   * `CastStartEvent.ability` carries the full note and the current members.
   *
   * Neither resolves in `world.abilities` here, and for two different reasons: a
   * sentinel is not an ability at all, and the casts worth watching on this
   * surface are mobs', whose abilities are never in your spellbook.
   */
  ability: string;
  /** Seconds left, against `total`. */
  remaining: number;
  total: number;
  /** Whether it is a channel, which drains rather than completes. */
  channeling: boolean;
}

/**
 * Which signal answered a combat reading.
 *
 * It travels with the answer because the branches are not equally trustworthy.
 * `party` and `threat` are the server's own opinion, `pvp` is a field the server
 * fills, and `recent` is a five second timer over damage that involved you. An
 * addon that only acts on a certain reading can check; one that does not care
 * can ignore this entirely.
 */
export type CombatSource = 'party' | 'threat' | 'pvp' | 'recent' | 'none';

/**
 * Whether you are fighting.
 *
 * Derived, and it has to be: the server sends no combat flag for you. There IS
 * an `inCombat` on the client entity and the server never writes it, so it reads
 * false for an entire session, which is how an early version of the shipped
 * meter concluded that every fight had ended on every hit.
 */
export interface CombatState {
  active: boolean;
  source: CombatSource;
}

/**
 * A unit you can name.
 *
 * `partyN` counts the OTHER members, 1-based, so `party1` is the first person
 * who is not you and the tokens line up with how a party display is laid out.
 * `raidN` counts every member including you, in the roster's own order.
 *
 * Both resolve to an ENTITY, so both answer null for someone too far away to
 * have one, even while `world.party` still lists them. For a raid display read
 * the party rows, which are complete, and reach for an entity only when you need
 * something a row does not carry.
 */
export type UnitToken =
  | 'player'
  | 'target'
  | 'targettarget'
  | 'pet'
  | `party${number}`
  | `raid${number}`;

/** Which effects to keep. An empty query keeps all of them. */
export interface AuraQuery {
  /** The applying ability's id. */
  id?: string;
  /** What the effect does, e.g. 'dot' or 'stun'. */
  kind?: string;
  /**
   * Only effects YOU applied.
   *
   * The filter a dot tracker needs and the one most likely to be forgotten: two
   * players can carry the same debuff on one target, and without this a display
   * shows a full timer while your own dot quietly expires.
   */
  mine?: boolean;
}

/** What each read returns, and what the matching `world.on` key reports. */
export interface WorldValues {
  player: Entity | null;
  target: Entity | null;
  entities: ReadonlyMap<number, Entity>;
  party: PartyInfo | null;
  inventory: readonly HeldSlot[] | null;
  equipment: Partial<Record<EquipSlot, string>> | null;
  /** What is on the worn gear. Sparse: a plain piece has no key. Added in API minor 2. */
  equipmentInstances: Partial<Record<EquipSlot, ItemInstance>> | null;
  bags: readonly (string | null)[] | null;
  copper: number | null;
  zone: string | null;
  /** Who is playing, as the key per-character state is filed under. Added in API minor 2. */
  characterKey: string | null;
  character: CharacterInfo | null;
  talents: TalentInfo | null;
  professions: ProfessionInfo | null;
  group: GroupInfo | null;
  encounter: EncounterInfo | null;
  /** The competitive bout in progress. Added in API minor 2. */
  match: MatchInfo | null;
  /** Your standings and queue. Added in API minor 2. */
  arena: ArenaStandings | null;
  /** Your dungeon finder state. Added in API minor 2. */
  finder: FinderInfo | null;
  /** The realm's open premade listings. Added in API minor 2. */
  finderBoard: readonly FinderListingRow[] | null;
  quests: WorldQuests | null;
  cooldowns: ReadonlyMap<string, number> | null;
  auras: readonly Aura[] | null;
  casts: ReadonlyMap<number, EntityCast>;
  targetAuras: readonly Aura[] | null;
  hazards: readonly Hazard[] | null;
  markers: ReadonlyMap<number, number> | null;
  /** Lethal rings on a rift boss floor. Added in API minor 2. */
  deathZones: readonly DeathZone[] | null;
  /** Every lootable corpse in scope. Never null, like `casts`. Added in API minor 2. */
  corpses: ReadonlyMap<number, CorpseView>;
  /** Gathering node id to seconds until you can harvest it. Added in API minor 2. */
  nodeCooldowns: ReadonlyMap<string, number> | null;
  /** Where your own body lies while your spirit is a ghost. Added in API minor 2. */
  corpse: Vec3 | null;
  abilities: AbilityIndex;
  combat: CombatState;
  /** The Merchant's book, or why there is not one. Never null. Added in API minor 2. */
  market: MarketState;
  /** Whether gold or goods wait at the Merchant. Added in API minor 2. */
  marketCollectPending: boolean | null;
  /** The mailbox, or why there is not one. Never null. Added in API minor 2. */
  mail: MailState;
  /** Delivered and unread letters. Added in API minor 2. */
  mailUnread: number | null;
  /** The deposit box, or why there is not one. Never null. Added in API minor 2. */
  bank: BankState;
  /** The buyback ring, most recent first. Added in API minor 2. */
  buyback: readonly InvSlot[] | null;
}

/** The state keys `world.on` can watch. Anything else throws. */
export type WorldKey = keyof WorldValues;

export interface WorldApi {
  /**
   * Resolves once the game is readable.
   *
   * Every read below answers null until then, so an addon can hold `woc.world`
   * from its first line and await this separately. It never times out: a player
   * may sit on the login screen for as long as they like.
   */
  readonly ready: Promise<void>;

  readonly player: Entity | null;
  readonly target: Entity | null;

  /**
   * Everything in interest scope.
   *
   * A read-only view of the game's live roster: reads pass through, and set,
   * delete, and clear throw. The entities themselves are the game's own live
   * objects, so this stops a slip rather than being a boundary.
   */
  readonly entities: ReadonlyMap<number, Entity>;

  readonly party: PartyInfo | null;
  readonly inventory: readonly HeldSlot[] | null;

  /**
   * Worn gear by slot, item ids only. A slot with nothing in it is absent.
   *
   * An item id does not resolve to a NAME, a quality or any stats: that content
   * ships inside the client bundle and is reachable from nothing the loader can
   * see. What you can do with an id is show its icon, through `ui.icon.item`,
   * and tell one from another.
   */
  readonly equipment: Partial<Record<EquipSlot, string>> | null;

  /**
   * What is ON your worn gear: enchants, masterwork and rift rolls, signers.
   *
   * Keyed like `equipment` and sparse: a plain piece has no key, so an absent
   * slot means nothing is on it rather than nothing is worn. This is the
   * untrimmed payload, unlike `world.player.equippedInstances`, which is the
   * public projection the server sends about you to everybody else.
   *
   * It rides the heavy half of your own payload, so a change lands within a
   * couple of seconds rather than on the next tick. Added in API minor 2.
   */
  readonly equipmentInstances: Partial<Record<EquipSlot, ItemInstance>> | null;

  /** The bag sockets: an item id per equipped bag, null for an empty socket. */
  readonly bags: readonly (string | null)[] | null;

  /**
   * Total slots across the backpack and every equipped bag.
   *
   * Derived from `bags`, so watch `bags` rather than this: there is no separate
   * key for it. Used slots is `inventory.length`.
   */
  readonly bagCapacity: number | null;

  /** Money, in copper. */
  readonly copper: number | null;

  /**
   * The zone name the game is displaying, or null before the HUD exists.
   *
   * Localized DISPLAY TEXT, never an id, and that limit is not an oversight: the
   * zone table is content inside the client bundle behind a pure function of
   * your position, and nothing the loader can reach exposes either the table or
   * the id. This is read off the game's own minimap label, so it is what the game
   * says you are looking at, which underground is the delve rather than a zone.
   *
   * Show it, or watch it change. Comparing it against a hardcoded string works
   * only for players running your language.
   *
   * There is no subzone here. The game announces a landmark once as a banner
   * when you walk into one and never clears it when you leave, so a reading
   * taken from it would name somewhere you left an hour ago.
   */
  readonly zone: string | null;

  /**
   * Who is playing, as the key per-character state is filed under.
   *
   * The value `woc.storage.character` derives its keys from, published so two
   * addons keeping their own per-character records cannot disagree about whose
   * they are. OPAQUE: do not parse it. Null before world entry.
   *
   * Watchable, because a character SWITCH inside one page load is real: the game
   * clones and removes its HUD rather than reloading, so an addon holding a
   * per-character view has to be told when it is looking at somebody else. Added
   * in API minor 2.
   */
  readonly characterKey: string | null;

  /**
   * Your progression, deeds and title. Null before world entry.
   *
   * All of it rides your own self payload, so there is no equivalent for another
   * player: nothing here can be read about anyone else.
   */
  readonly character: CharacterInfo | null;

  /** Your build, your saved loadouts, and how many points you have spent. */
  readonly talents: TalentInfo | null;

  /** Your profession skill counters. See `ProfessionInfo` for what is left out. */
  readonly professions: ProfessionInfo | null;

  /** Loot rolls you have been asked to answer, master loot, and raid lockouts. */
  readonly group: GroupInfo | null;

  /** The instanced run you are inside, or null out in the world. */
  readonly encounter: EncounterInfo | null;

  /**
   * The competitive bout you are in, or null.
   *
   * One union over all six formats, discriminated on `format`, so a display asks
   * what kind of bout this is rather than reading two unrelated members. A duel
   * is a member of it.
   *
   * Everything but a duel is UP TO TEN SECONDS OLD, because the arena key is
   * gated to 0.1 Hz on the server. That is the game's own cadence, so a Fiesta
   * ring drawn from this agrees with the ring the game draws; a Yumi health bar
   * does not, and the type says which events carry the live figures. Added in
   * API minor 2.
   */
  readonly match: MatchInfo | null;

  /**
   * Your competitive standings, your queue and the live ladders.
   *
   * Present for every character, so this being non-null says nothing about
   * whether you have ever played. Only the two ranked brackets mean anything:
   * the unranked three carry a copy of the 2v2 record and an empty ladder. Added
   * in API minor 2.
   */
  readonly arena: ArenaStandings | null;

  /** Your dungeon finder state. Present whether or not you are queued. Added in API minor 2. */
  readonly finder: FinderInfo | null;

  /**
   * The realm's open premade listings, or null before the first sync.
   *
   * Realm-shared and capped by the server, so it is what is offered rather than
   * everything that exists. Added in API minor 2.
   */
  readonly finderBoard: readonly FinderListingRow[] | null;

  /**
   * One mob's hate table, sorted and measured against you.
   *
   * The server's own threat model, so a pull warning built on it agrees with the
   * decision the mob is about to make. Empty for anything that is not a mob in
   * combat.
   *
   * ```js
   * const table = woc.world.threat(woc.world.target.id);
   * if (table.share !== null && table.share > 0.9) warn('about to pull');
   * ```
   */
  threat: (entityId: number) => ThreatTable;

  readonly quests: WorldQuests | null;
  /** Your ability cooldowns: ability id to seconds remaining. */
  readonly cooldowns: ReadonlyMap<string, number> | null;
  /** The effects on you. For anyone else, read `entity.auras`. */
  readonly auras: readonly Aura[] | null;

  /**
   * Entity id to what it is casting, for everything near you.
   *
   * Built on each read from live entity state, so it is never stale and there is
   * nothing to hold on to: read it again rather than keeping the map.
   */
  readonly casts: ReadonlyMap<number, EntityCast>;

  /**
   * The effects on your current target, or null when nothing is targeted.
   *
   * `world.on('target', ...)` reports which entity is selected and nothing else,
   * so watching a debuff you applied to a boss means watching this key.
   */
  readonly targetAuras: readonly Aura[] | null;

  readonly hazards: readonly Hazard[] | null;

  /**
   * Lethal rings on a rift boss floor, or null outside one.
   *
   * NOT `hazards`, and the difference is worth knowing before you draw either. A
   * hazard's geometry rides the snapshot and is complete for everything near
   * you. A death zone is mirrored from a spawn event and counted down on your
   * own client, so a zone placed before you came into range is missing and stays
   * missing. The game's own rings have the same hole. Added in API minor 2.
   */
  readonly deathZones: readonly DeathZone[] | null;

  /**
   * Every lootable corpse in scope, with what you could take off each.
   *
   * Never null, like `casts`: it is a reading the loader assembles rather than a
   * value the game hands over. Watch this rather than `entities` for a corpse
   * becoming lootable, which is a field change on an entity that already existed
   * and so is invisible to the entity set. Added in API minor 2.
   */
  readonly corpses: ReadonlyMap<number, CorpseView>;

  /**
   * Gathering node id to seconds until YOU can harvest it again.
   *
   * Per player, so a node another player just took is still yours. A node with
   * no entry is ready. Added in API minor 2.
   */
  readonly nodeCooldowns: ReadonlyMap<string, number> | null;

  /**
   * Where your own body lies while your spirit is a ghost, or null.
   *
   * Yours alone: the server sends it to you and to nobody else, so there is no
   * way to ask where another player's corpse is. Added in API minor 2.
   */
  readonly corpse: Vec3 | null;

  /**
   * One corpse's contents, filtered to what YOU could take.
   *
   * The wire carries a corpse's whole contents to every player in range,
   * personal slots included, and the game's own loot window filters on read.
   * This applies the same filter, so it is what a loot display should use;
   * `Entity.loot` is the unfiltered list and shows people things they cannot
   * have. Added in API minor 2.
   */
  corpseLoot: (entityId: number) => CorpseView | null;

  /**
   * The Merchant's book, one browsed page at a time, or why there is not one.
   *
   * Never null: read `status` first. `'near'` carries `info`; `'away'` and
   * `'unknown'` carry null and no page to reach for. The distinction is the
   * point of the shape, because "the filter matched nothing" and "you are not at
   * the Merchant" are opposite facts that a nullable value collapses into one.
   * Added in API minor 2.
   */
  readonly market: MarketState;

  /**
   * Whether gold or goods wait at the Merchant.
   *
   * Ungated, so it is readable anywhere in the world. This is the badge; the
   * page above is the pane. Added in API minor 2.
   */
  readonly marketCollectPending: boolean | null;

  /** The mailbox, or why there is not one. Read `status` first. Added in API minor 2. */
  readonly mail: MailState;

  /**
   * Delivered letters you have not read.
   *
   * Ungated, so it is readable anywhere in the world. `world.mail` carries its
   * own `unread` over the same letters; that one is the mailbox pane's figure
   * and this one is the badge. Do not derive either from the other. Added in API
   * minor 2.
   */
  readonly mailUnread: number | null;

  /** The deposit box, or why there is not one. Read `status` first. Added in API minor 2. */
  readonly bank: BankState;

  /**
   * The buyback ring: what you have sold to a vendor and can still take back.
   *
   * MOST RECENT FIRST. Ungated, unlike the three above: standing at a vendor is
   * what lets you USE the ring, not what lets you see it. Added in API minor 2.
   */
  readonly buyback: readonly InvSlot[] | null;

  /**
   * Your spellbook, and the one way to turn an ability id into its display name
   * or a display name back into an id.
   *
   * Never null, unlike most reads here: it is a lookup, so an empty one answers
   * the same questions a populated one does and you need no guard before asking.
   * Covers your OWN kit only. See `AbilityIndex`.
   */
  readonly abilities: AbilityIndex;

  /**
   * Whether you are fighting, and which signal said so.
   *
   * Never null: it is derived rather than handed over, so before world entry it
   * is simply inactive. Watch it with `world.on('combat', ...)`, which reports a
   * fight starting and ending, and also reports the SOURCE changing while a
   * fight continues, so an addon that acts only on a certain reading hears the
   * moment it becomes one.
   */
  readonly combat: CombatState;

  /**
   * The entity a token names, or null when there is nothing there.
   *
   * Worth using rather than open-coding, because one of these is a trap:
   * `targettarget` reads whichever field the target's kind actually fills. A
   * mob never carries `targetId`, so the obvious lookup gives you a
   * target-of-target that works on players and is blank on every mob.
   *
   * ```js
   * const boss = woc.world.unit('target');
   * const tank = woc.world.unit('targettarget');
   * ```
   */
  unit: (token: UnitToken) => Entity | null;

  /**
   * The effects on a unit that match, in the game's own order.
   *
   * Empty rather than null when the unit resolves to nothing, so a display can
   * render the answer without a guard first.
   *
   * ```js
   * const mine = woc.world.aurasOn('target', { mine: true, kind: 'dot' });
   * ```
   */
  aurasOn: (token: UnitToken, query?: AuraQuery) => readonly Aura[];

  /**
   * The same over one party row's compact strip.
   *
   * Separate because a row's auras are a different, smaller shape than an
   * entity's, and because a row exists for a member who is nowhere near you.
   */
  partyAuras: (pid: number, query?: PartyAuraQuery) => readonly PartyMemberAura[];

  /**
   * Whether an effect is working AGAINST the unit carrying it.
   *
   * The game's own rule, not a heuristic: a kind in the harmful set, or a
   * `buff_*` kind whose magnitude went negative, because a drain reuses the buff
   * kind and flips the sign. Nothing on the wire answers this, and `value`
   * cannot stand in for it: a damage-over-time's per-tick figure is positive
   * exactly as a heal-over-time's is.
   *
   * A FUNCTION rather than a field on the aura, and that is not a style choice.
   * The loader hands you the game's own aura objects rather than copies, so a
   * field could only exist by mutating state the game's own HUD reads or by
   * copying every aura on every read, which would break the object identity you
   * use to track one effect across frames.
   *
   * Accepts either aura shape. A party row carries no `value`, and its `neg`
   * flag is the server's own sign test on that value, so the answer for a row is
   * the same function rather than an approximation of it.
   *
   * The harmful kind set is game CONTENT, so a kind added by a release these
   * types predate reads as not harmful. That is the conservative direction: an
   * unknown effect is not offered as something to remove. Added in API minor 2.
   */
  harmful: (aura: Aura | PartyMemberAura) => boolean;

  /**
   * Whether an effect can be removed, and in which direction.
   *
   * Three clauses, all from the game: not encounter-owned control, not the
   * physical school, and the polarity the direction asks for. `offensive` strips
   * a BENEFIT off an enemy; the default, false, strips a harmful effect off an
   * ally.
   *
   * A party ROW cannot answer this and is refused rather than guessed at: a row
   * carries neither a school nor `unbreakableControl`, and those are the two
   * clauses that cost a player a global cooldown when skipped. Read the member's
   * entity through `world.aurasOn('partyN')` for a member near enough to have
   * one. Added in API minor 2.
   */
  dispellable: (aura: Aura, offensive?: boolean) => boolean;

  /**
   * Flat distance from the player to a point, in yards, IGNORING HEIGHT.
   *
   * The distance you would walk, which is what the game's own range gates
   * measure. Null before the world is up, where your first line runs. Added in
   * API minor 4.
   */
  distanceTo: (at: { x: number; z: number }) => number | null;

  /**
   * Which way to turn to face a point: degrees CLOCKWISE from where you are
   * looking, with -180 <= turn < 180. 0 is straight ahead, 90 is to your right.
   *
   * Null before the world is up, and null for a facing that is not finite, which
   * is a real state rather than a defensive one. `fmt.compass` takes this
   * convention and this null, so the two compose:
   *
   * ```js
   * const arrow = woc.fmt.compass(woc.world.bearingTo(node));
   * ```
   *
   * Added in API minor 4.
   */
  bearingTo: (at: { x: number; z: number }) => number | null;

  /**
   * The game's own recipe table, copied and frozen.
   *
   * A COPY: the game renders its own crafting window from the original, so a
   * `.sort()` on the real array would reorder what the game draws.
   *
   * Static content, which is why there is no `world.on('recipes')` and never
   * will be: a signature over the table would walk every recipe on every
   * snapshot to report that nothing moved. What changes is on
   * `world.professions`, including which of these you have learned. Empty rather
   * than null before world entry. Added in API minor 2.
   */
  readonly recipes: readonly Recipe[];

  /**
   * The authored crafting stations, copied and frozen.
   *
   * Static, like `recipes`, and not a watch key for the same reason. Most
   * recipes name a `stationType`; this is what turns that into a place. Added in
   * API minor 2.
   */
  readonly stations: readonly Station[];

  /**
   * Entity id to raid target marker, 0 through 7.
   *
   * Empty when you are not in a party, because the game sends markers only to a
   * grouped player. That is indistinguishable from a group that has marked
   * nothing, so read `world.party` if the difference matters. There is no way to
   * SET one: placing a marker is a command, and the loader never sends.
   */
  readonly markers: ReadonlyMap<number, number> | null;

  /**
   * Watch a key for change, sampled once per animation frame.
   *
   * Fires on change rather than on every sample, and only for a change worth
   * acting on: `auras` reports one arriving or falling off, not its remaining
   * time ticking down, `cooldowns` reports one starting or ending rather than
   * counting down, and `casts` reports a cast starting, ending or being replaced
   * rather than its bar moving. Count down yourself if you need to draw it.
   *
   * The handler's argument is typed from the key, so `world.on('party', ...)`
   * receives a `PartyInfo` without narrowing.
   */
  on: <K extends WorldKey>(key: K, handler: (value: WorldValues[K]) => void) => Unsubscribe;

  /**
   * The game's own objects. Unstable: the game makes no compatibility promise
   * about them, and the manager flags addons that reach for them.
   */
  readonly raw: unknown;
  readonly game: unknown;
}
