// Every read `woc.world` answers. The entity and its parts are in `entity.d.ts`.

import type { AbilityIndex } from './abilities.js';
import type { Unsubscribe } from './addon.js';
import type { ArenaStandings } from './arena.js';
import type { BattlegroundStandings } from './battleground.js';
import type { CharacterInfo, ProfessionInfo, TalentInfo } from './character.js';
import type { CivicService, Recipe, Station } from './content.js';
import type { MailState, MarketState } from './economy.js';
import type { BankState, VaultState } from './economy-storage.js';
import type { Aura, Entity, EquipSlot, ItemInstance, Vec3 } from './entity.js';
import type { FinderInfo, FinderListingRow } from './finder.js';
import type { EncounterInfo, GroupInfo, ThreatTable } from './group.js';
import type { MatchInfo } from './match.js';
import type { PartyAuraQuery, PartyInfo, PartyMemberAura } from './party.js';
import type { CorpseView, DeathZone, Hazard } from './world-ground.js';
import type { HeldSlot, InvSlot } from './world-items.js';
import type { WorldKey, WorldValues } from './world-watch.js';

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
 * Read this rather than `net.onEvent('castStart')`, which never fires for a mob.
 */
export interface EntityCast {
  /**
   * An ability ID, or an ACTIVITY SENTINEL.
   *
   * `CastStartEvent.ability` lists the sentinels. A mob's ability is never in
   * `world.abilities`.
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
 * `self` is the server's own flag for you, `party` and `threat` are the server's
 * view of the fight, `pvp` is a server-filled attacker, and `recent` is a five
 * second timer over damage involving you. Ignore it unless you only act on
 * certain readings.
 *
 * `self` was added in API minor 11; an older server never reports it.
 */
export type CombatSource = 'self' | 'party' | 'threat' | 'pvp' | 'recent' | 'none';

/**
 * Whether you are fighting.
 *
 * The server's own flag for you answers first (`source: 'self'`), but only a
 * true can be trusted, so a ladder answers underneath: your party row, a mob's
 * hate table, a PvP attacker, then recent damage. Never read a raw `inCombat`
 * off an entity: on every unit but you it is permanently false.
 */
export interface CombatState {
  active: boolean;
  source: CombatSource;
}

/**
 * How a unit stands toward you, from `world.reaction`.
 *
 * `neutral` is a real answer (a wild boar nobody has pulled). An id nothing in
 * scope holds gives null.
 */
export type Reaction = 'hostile' | 'friendly' | 'neutral';

/**
 * A unit you can name.
 *
 * `partyN` counts the OTHER members, 1-based. `raidN` counts every member
 * including you, in roster order.
 *
 * Both resolve to an ENTITY, so both are null for someone too far away, even
 * while `world.party` lists them. A raid display reads the party rows.
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
   * Two players can put the same debuff on one target, so a dot tracker needs
   * this.
   */
  mine?: boolean;
}

export interface WorldApi {
  /**
   * Resolves once the game is readable.
   *
   * Every read below answers null until then. It never times out.
   */
  readonly ready: Promise<void>;

  readonly player: Entity | null;
  readonly target: Entity | null;

  /**
   * Everything in interest scope.
   *
   * A read-only view of the game's live roster: set, delete and clear throw. The
   * entities are the game's own live objects, so do not mutate them.
   */
  readonly entities: ReadonlyMap<number, Entity>;

  readonly party: PartyInfo | null;
  readonly inventory: readonly HeldSlot[] | null;

  /**
   * Worn gear by slot, item ids only. A slot with nothing in it is absent.
   *
   * An item id does not resolve to a name, a quality or stats; only to an icon,
   * through `ui.icon.item`.
   */
  readonly equipment: Partial<Record<EquipSlot, string>> | null;

  /**
   * What is ON your worn gear: enchants, masterwork and rift rolls, signers.
   *
   * Sparse: an absent slot means nothing is on it, not that nothing is worn. The
   * untrimmed payload, unlike `world.player.equippedInstances`.
   *
   * A change can take a couple of seconds to land. Added in API minor 2.
   */
  readonly equipmentInstances: Partial<Record<EquipSlot, ItemInstance>> | null;

  /** The bag sockets: an item id per equipped bag, null for an empty socket. */
  readonly bags: readonly (string | null)[] | null;

  /**
   * Total slots across the backpack and every equipped bag.
   *
   * Derived from `bags`, which is the key to watch. Used slots is
   * `inventory.length`.
   */
  readonly bagCapacity: number | null;

  /** Money, in copper. */
  readonly copper: number | null;

  /**
   * The zone name the game is displaying, or null before the HUD exists.
   *
   * Localized DISPLAY TEXT from the minimap label, never an id (underground, the
   * delve name). Show it or watch it change; comparing it against a hardcoded
   * string works only in your language. There is no subzone.
   */
  readonly zone: string | null;

  /**
   * Who is playing, as the key per-character state is filed under.
   *
   * The identity `woc.storage.character` files under. OPAQUE: do not parse it.
   * Null before world entry and WHILE SPECTATING.
   *
   * Watch it: a character switch happens without a page reload. Added in API
   * minor 2.
   */
  readonly characterKey: string | null;

  /**
   * The character this session is watching, or null when it is watching itself.
   *
   * While a moderator spectates, `world.player` and everything derived from it
   * describe the watched character. Most addons can ignore that; one filing
   * anything under an identity must not, and `woc.storage.character` already
   * refuses writes while this is non-null.
   *
   * Null in offline play. Added in API minor 10.
   */
  readonly spectating: string | null;

  /**
   * How fast you are actually moving, as a multiplier the SERVER computed with
   * every slow, snare, haste, mount and form effect folded in. Do not re-derive
   * it from the auras you can see; that misses effects applied without an aura.
   *
   * 1 IS A REAL READING and means nothing is affecting you. NULL is "no answer":
   * before the world is up, in offline play, while SPECTATING, and on a session
   * that negotiated the older movement wire. Guard with `mult === null`, never a
   * falsy test, and never substitute 1 for an unknown.
   *
   * Yours only; no entity carries a move speed. Added in API minor 10.
   */
  readonly moveSpeedMult: number | null;

  /**
   * Your progression, deeds and title. Null before world entry.
   *
   * Yours only: nothing here can be read about another player.
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
   * One union over all seven formats, discriminated on `format`.
   *
   * THE CADENCE IS PER FORMAT: a duel every tick, a battleground at 1 Hz and on
   * every transition, and the four arena formats UP TO TEN SECONDS OLD. The Yumi
   * type names the events carrying live figures. Added in API minor 2, the
   * battleground member in 6.
   */
  readonly match: MatchInfo | null;

  /**
   * Your competitive standings, your queue and the live ladders.
   *
   * Present for every character. Only the two ranked brackets mean anything. Added
   * in API minor 2.
   */
  readonly arena: ArenaStandings | null;

  /**
   * Your battleground record, your queue and the live ladder.
   *
   * Present for every character. The match itself is the `format: 'battleground'`
   * member of `world.match`. Added in API minor 6.
   */
  readonly battleground: BattlegroundStandings | null;

  /** Your dungeon finder state. Present whether or not you are queued. Added in API minor 2. */
  readonly finder: FinderInfo | null;

  /**
   * The realm's open premade listings, or null before the first sync.
   *
   * Realm-shared and capped by the server, so not necessarily every listing.
   * Added in API minor 2.
   */
  readonly finderBoard: readonly FinderListingRow[] | null;

  /**
   * One mob's hate table, sorted and measured against you.
   *
   * The server's own threat numbers. Empty for anything that is not a mob in
   * combat.
   *
   * A row vanishes when its attacker leaves the fight: past 100 yards from an
   * open-world mob, or on leaving an instance mob's room (distance never counts
   * inside one). Read a disappearance as "no longer in this fight", not a wipe.
   *
   * ```js
   * const table = woc.world.threat(woc.world.target.id);
   * if (table.share !== null && table.share > 0.9) warn('about to pull');
   * ```
   */
  threat: (entityId: number) => ThreatTable;

  /**
   * Which side one unit is on, or null for an id nothing in scope holds.
   *
   * READ THIS RATHER THAN `entity.hostile`, which is set only on mobs and is
   * false on every player, enemies in a duel, arena or battleground included.
   *
   * For a player the answer comes from the bout, as the game's nameplates do;
   * outside a bout every player reads friendly, INCLUDING an open-world PvP
   * opponent the game paints red: its verdict pairs both players' /pvp flags with
   * the zone rules under each, and those rules are not on the wire. A PET answers
   * as its OWNER.
   *
   * ```js
   * if (woc.world.reaction(entity.id) === 'hostile') paintRed(entity);
   * ```
   *
   * Added in API minor 6.
   */
  reaction: (entityId: number) => Reaction | null;

  readonly quests: WorldQuests | null;
  /** Your ability cooldowns: ability id to seconds remaining. */
  readonly cooldowns: ReadonlyMap<string, number> | null;
  /** The effects on you. For anyone else, read `entity.auras`. */
  readonly auras: readonly Aura[] | null;

  /**
   * Entity id to what it is casting, for everything near you.
   *
   * Built fresh on each read: read it again rather than keeping the map.
   */
  readonly casts: ReadonlyMap<number, EntityCast>;

  /**
   * The effects on your current target, or null when nothing is targeted.
   *
   * Watch this key, not `target`, for the debuffs on a boss.
   */
  readonly targetAuras: readonly Aura[] | null;

  /**
   * Ground effects near you, or null on a game carrying none of the lists.
   *
   * Empty is clean ground. An entry missing from a later reading is gone. Read
   * `Hazard` for the ground effects this does not cover.
   */
  readonly hazards: readonly Hazard[] | null;

  /**
   * Lethal rings on a rift boss floor, or null outside one.
   *
   * Not complete like `hazards`: see `DeathZone`. Added in API minor 2.
   */
  readonly deathZones: readonly DeathZone[] | null;

  /**
   * Every lootable corpse in scope, with what you could take off each.
   *
   * Never null. Watch this, not `entities`, for a corpse becoming lootable. Added
   * in API minor 2.
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
   * Yours only. Added in API minor 2.
   */
  readonly corpse: Vec3 | null;

  /**
   * One corpse's contents, filtered to what YOU could take.
   *
   * Applies the game's own loot filter; `Entity.loot` is unfiltered. Added in API
   * minor 2.
   */
  corpseLoot: (entityId: number) => CorpseView | null;

  /**
   * The Merchant's book, one browsed page at a time, or why there is not one.
   *
   * Never null: read `status` first. Only `'near'` carries `info`. Added in API
   * minor 2.
   */
  readonly market: MarketState;

  /**
   * Whether gold or goods wait at the Merchant.
   *
   * Readable anywhere: the badge, where `market` is the pane. Added in API minor
   * 2.
   */
  readonly marketCollectPending: boolean | null;

  /** The mailbox, or why there is not one. Read `status` first. Added in API minor 2. */
  readonly mail: MailState;

  /**
   * Delivered letters you have not read.
   *
   * Readable anywhere: the badge. `world.mail.info.unread` is the pane's figure;
   * do not derive either from the other. Added in API minor 2.
   */
  readonly mailUnread: number | null;

  /** The deposit box, or why there is not one. Read `status` first. Added in API minor 2. */
  readonly bank: BankState;

  /**
   * The Materials Vault, or why there is not one. Read `status` first.
   * Banker-gated like `world.bank`, on a separate gate. Added in API minor 10.
   */
  readonly vault: VaultState;

  /**
   * What crafting may draw FROM the vault where you are standing, or null where
   * it may draw nothing.
   *
   * EMPTY means the draw is allowed and the vault holds nothing; NULL means it is
   * refused where you are (a battleground, arena, delve, dungeon, raid or rift),
   * and also before the first snapshot: gate on `world.ready` if that matters.
   *
   * Live everywhere in the open world, no banker needed. Key order means nothing;
   * a material that is not a key is held at zero. Added in API minor 10.
   */
  readonly craftVaultStock: Readonly<Record<string, number>> | null;

  /**
   * The buyback ring: what you have sold to a vendor and can still take back.
   *
   * MOST RECENT FIRST. Readable anywhere. Added in API minor 2.
   */
  readonly buyback: readonly InvSlot[] | null;

  /**
   * Your spellbook, and the one way to turn an ability id into its display name
   * or a display name back into an id.
   *
   * Never null; empty before world entry. Covers your OWN kit only. See
   * `AbilityIndex`.
   */
  readonly abilities: AbilityIndex;

  /**
   * Whether you are fighting, and which signal said so.
   *
   * Never null; inactive before world entry. `world.on('combat', ...)` also fires
   * when the SOURCE changes mid-fight.
   */
  readonly combat: CombatState;

  /**
   * The entity a token names, or null when there is nothing there.
   *
   * `targettarget` reads `targetId` or `aggroTargetId` by the target's kind; a
   * mob's `targetId` is always null.
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
   * Empty, never null, when the unit resolves to nothing.
   *
   * ```js
   * const mine = woc.world.aurasOn('target', { mine: true, kind: 'dot' });
   * ```
   */
  aurasOn: (token: UnitToken, query?: AuraQuery) => readonly Aura[];

  /**
   * The same over one party row's compact strip.
   *
   * A row exists for a member who is nowhere near you.
   */
  partyAuras: (pid: number, query?: PartyAuraQuery) => readonly PartyMemberAura[];

  /**
   * Whether an effect is working AGAINST the unit carrying it.
   *
   * The game's own rule: a kind in the harmful set, or a `buff_*` kind with a
   * negative magnitude (a drain). `value` alone cannot answer it: a
   * damage-over-time tick is positive too.
   *
   * Accepts either aura shape, with the same answer. A kind newer than these
   * types reads as not harmful. Added in API minor 2.
   */
  harmful: (aura: Aura | PartyMemberAura) => boolean;

  /**
   * Whether an effect can be removed, and in which direction.
   *
   * The game's rule, minus one clause: not one of the auras it refuses BY ID (a
   * paladin's Divine Ascension charges, a shaman's Stormsurge window), not
   * permanent, not unbreakable control, not undispellable, not physical, and the
   * polarity asked for. `offensive` strips a BENEFIT off an enemy; the default
   * strips a harmful effect off an ally.
   *
   * IT ANSWERS TRUE FOR BOSS MECHANICS THE GAME WILL REFUSE: the game's
   * `encounterOwned` flag is not on the wire. In the Ignivar, Varkhul and
   * Nythraxis fights and the Buried Hoards rift boss rooms a true means "nothing
   * the client can see forbids it", and some of those auras are player debuffs a
   * healer will reach for (Nythraxis's Soul Rend, Ignivar's forge chains, a hoard
   * boss's frost slows).
   *
   * A party ROW is refused: it carries neither a school nor the flags. Use
   * `world.aurasOn('partyN')` for a member near enough to have an entity. Added in
   * API minor 2; the permanent and undispellable clauses in minor 10.
   */
  dispellable: (aura: Aura, offensive?: boolean) => boolean;

  /**
   * Whether an effect is a MODE rather than a timed one, so its clock is fiction.
   *
   * A stance, a druid form, stealth, Ghost Wolf, Beacon of Light, the carried
   * battleground flag, a spec's rotation banks. The game gives each a long fake
   * duration (3600 seconds, or a whole match) that `remaining` counts down, so a
   * timer drawn from it is wrong. ASK THIS BEFORE DRAWING A TIMER, and draw none
   * where it answers true.
   *
   * The game's WHOLE rule: it needs only the id and kind, so it takes either aura
   * shape, a party row included. Greater Invisibility shares stealth's kind but
   * is a real 20 second buff, and answers false. A mode newer than these types
   * answers false.
   *
   * Added in API minor 12.
   */
  toggle: (aura: Pick<Aura, 'id' | 'kind'>) => boolean;

  /**
   * Flat distance from the player to a point, in yards, IGNORING HEIGHT.
   *
   * What the game's own range checks measure. Null before the world is up. Added
   * in API minor 4.
   */
  distanceTo: (at: { x: number; z: number }) => number | null;

  /**
   * Which way to turn to face a point: degrees CLOCKWISE from where you are
   * looking, with -180 <= turn < 180. 0 is straight ahead, 90 is to your right.
   *
   * Null before the world is up and for a non-finite facing. `fmt.compass` takes
   * this convention and this null:
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
   * Static for the session, so not a watch key; which you have learned is on
   * `world.professions`. Empty, never null, before world entry. Added in API minor
   * 2.
   */
  readonly recipes: readonly Recipe[];

  /**
   * The authored crafting stations, copied and frozen.
   *
   * Static, like `recipes`. Turns a recipe's `stationType` into a place. Added in
   * API minor 2.
   */
  readonly stations: readonly Station[];

  /**
   * The authored mailboxes and noticeboards, copied and frozen.
   *
   * Static, like `recipes`. Where a counter IS; whether you stand at one is
   * `world.mail`. Empty before world entry and on a client too old to carry the
   * list. Added in API minor 7.
   */
  readonly civicServices: readonly CivicService[];

  /**
   * Entity id to raid target marker, 0 through 7.
   *
   * Empty when you are not in a party, which looks the same as a group that has
   * marked nothing; check `world.party`. An addon cannot set a marker.
   */
  readonly markers: ReadonlyMap<number, number> | null;

  /**
   * Watch a key for change, sampled once per animation frame.
   *
   * Fires on a change worth acting on, never on a countdown: `auras` on one
   * arriving or leaving, `cooldowns` on one starting or ending, `casts` on a cast
   * starting, ending or being replaced. Count down yourself to draw it.
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
