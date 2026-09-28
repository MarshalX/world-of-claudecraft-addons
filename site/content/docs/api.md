---
title: The API
order: 3
summary: The woc object, one section per domain, with every member you can call and where the real usage lives.
---

Your addon is handed one global, `woc`. There is no constructor and nothing to register with. Every domain below is a property on it.

Install [`@woc-addons/types`](/docs/types) and add one reference comment for autocomplete on all of it.

## net

Read-only access to the game's WebSocket. There is no send, and there never will be: see [Boundaries](/docs/boundaries).

```js
woc.net.onEvent('damage', (event) => { /* event.amount, event.school, event.crit */ });
woc.net.on('snapshot', (frame) => { /* one decoded frame type */ });
woc.net.onAnyEvent((event) => { /* every event, whatever its kind */ });
```

`net.onEvent` is the one you want almost always: combat events by kind. `net.on` subscribes to a whole frame type, and `net.onAnyEvent` to every event at once, which is useful for a logger and wasteful for anything else.

`net.onRaw` is below the decoder, handing you frames before they are parsed. Reach for it only when you are looking at something the decoder does not model yet.

The `error` event is every refused action, and `text` is the only part of one that is always there. A refusal the SERVER wrote can also carry `code`, a stable identity to branch on where the prose is not, `channel` where it is about chat, and `retryAfterSeconds` where it is a rate limit rather than a rejection. All three are optional and most refusals carry none of them, so display `text` and treat the rest as a bonus. `reason` is a different field, the sim's own coarse label.

The `chat` event carries a `textKey` when the line was GENERATED rather than typed, and that is the field to branch on: `text` is English prose that a locale or a rewording changes under you, and the key does not. Presence is also how you tell the game speaking from somebody in your party. The `/pull` raid countdown, for example, arrives on the `raidWarning` channel as `hudChrome.pullTimer.start` with `textValues.seconds`, then `hudChrome.pullTimer.countdown` at 5, 4, 3, 2 and 1, then `hudChrome.pullTimer.pull`, or `hudChrome.pullTimer.cancel` if the leader called it off. Read `textValues.seconds`, which is a number in every language. A line from an older server carries neither field.

`net.onSend` sees outbound frames, **after redaction**. The client's first frame on every socket carries your account bearer token, and it is blanked by field name rather than by frame type, so a version bump cannot slip one past.

```js
const hello = await woc.net.waitFor('hello', { timeout: 5000 });
if (woc.net.state.connected) { /* ... */ }
```

`net.waitFor` resolves on the next frame of a type, which is how you wait for a handshake without holding a subscription open. `net.state` is the live connection: whether it is connected, and the counters behind the Diagnostics pane.

Every subscriber takes an optional `{ throttle }`, and every one returns an unsubscribe function you almost never need, because disable tears them all down.

An `ability` on a combat event is a display name, not an id. [Patterns](/docs/patterns) says why that matters.

## world

The live world as the client knows it. Everything is a plain read.

```js
woc.world.player          // your Entity, or null before world entry
woc.world.target          // your current target, or null
woc.world.entities        // ReadonlyMap<number, Entity>, everything nearby
```

`world.entities` is every visible unit keyed by entity id, yours included.

```js
woc.world.party           // PartyInfo: members, leader, raid groups
woc.world.inventory       // your bags, slot by slot
woc.world.quests          // the log, and each quest's progress
```

What you own, and where you are:

```js
woc.world.equipment       // worn gear by slot: { mainhand: 'redbrook_blade', ... }
woc.world.equipmentInstances // what is ON that gear: enchants, rolls, signers
woc.world.bags            // the bag sockets, an item id or null each
woc.world.bagCapacity     // total slots; used slots is inventory.length
woc.world.copper          // money
woc.world.zone            // the zone name the game is displaying
woc.world.characterKey    // who is playing, as an opaque per-character key
woc.world.spectating      // the character being watched, or null
woc.world.moveSpeedMult   // how fast you are actually moving, or null
```

`world.equipmentInstances` is keyed the same way `equipment` is and is sparse: a plain piece has no key at all, so an absent slot means nothing is on it rather than nothing is worn. It is the untrimmed payload for your OWN gear. The same read off another player's entity, `entity.equippedInstances`, is the public projection the server sends about them: the signer, the enchant and the roll, and nothing else.

Another player's gear is readable too, off the entity rather than off `world`: `equippedItems`, `equippedInstances`, `mainhandItemId`, `offhandItemId`, `weaponSkinId` and `mountKey`. All six are sent for a PLAYER only, so check `entity.kind === 'player'` before reading one: on a mob they exist and hold an inert default. `mainhandItemId` is not `equippedItems.mainhand`: the server fills it only when the equipped mainhand is a weapon, so read one for what is held and the other for what is worn.

`entity.autoAttack` and `entity.swingTimer` ride EVERY entity's record, so a target's swing bar is possible; against an older server both hold their inert default on everybody but you. The server omits the swing field for an entity that is not attacking and the client reads that as `autoAttack: false`, so false is an answer rather than a gap. **`weapon.speed` is not the period, on anybody, including you.** The game resets the clock to the weapon speed multiplied by every haste effect on the swinger, and melee haste is not on the wire, so a bar seeded from the raw speed on a hasted character is wrong by exactly the haste and looks like a working bar. Learn the period from the reset edge: when the value jumps upward, the height of the jump is the period, and the weapon speed is at most a first-frame seed.

`entity.offhandSwingTimer` is self-only. **Read it only while `autoAttack` is true**: the game drains this clock before checking whether you are attacking, so with auto-attack off it sits at 0 and reads as a swing about to land. Its period is unreadable for the same reason the mainhand's is; measure the edge.

Ask `offhandWeapon !== null` for whether there is an offhand swing at all, which is what the game derives `dualWielding` from. **Not `offhandItemId`**: the game fills that for a shield and for a held-only item too, so gating on it draws a swing bar for a shield.

`world.characterKey` is the same identity `woc.storage.character` files its keys under, so two addons keeping per-character records agree about whose they are. It is OPAQUE: do not parse it. Watch it, because a character can switch inside one page load.

`world.spectating` is the one thing that makes `world.player` somebody else. A moderator spectate repoints the game's own player at the character being watched, so while it runs `player`, the class on it and everything derived from either describe the watched character rather than the person at the keyboard. Most addons can ignore that. For an addon filing something under an identity, `characterKey` is null for the whole spectate and `woc.storage.character` refuses to write, so the loader's per-character storage already handles it. Read `spectating` when you keep your own records and want to say WHY you have stopped.

`world.moveSpeedMult` is the server's own movement multiplier, every slow, haste, mount and form effect folded into one number, so a display built on it agrees with what your character does; re-deriving it from visible auras misses anything applied without one. Self-only.

1 means nothing is affecting you and null means nobody said. Null arrives four ways and they are handled as one: before the world is up, offline where the field does not exist, while spectating, and on a session that negotiated the older movement wire, where the value would otherwise sit at a permanent 1 and lie about a snared player. Guard with `mult === null`, never a falsy test, and substitute no default.

An item id does not resolve to a **name**, a quality, or any stats. That content ships inside the client bundle and is reachable from nothing the loader can see, so what an id gets you is its icon through `ui.icon.item`, and the ability to tell one item from another. Names arrive only where an event carries one.

`world.zone` is localized display text rather than an id, for the same class of reason: the zone table is content behind a pure function of your position, so the loader reads the game's own minimap label instead. Show it or watch it change; comparing it against a hardcoded string only works for players running your language. Underground it names the delve, because that is what the game puts there. There is no subzone: the game announces a landmark once when you walk into one and never clears it when you leave, so a reading taken from it would name somewhere you left an hour ago.

`bagCapacity` derives from `bags` and has no key of its own, so watch `bags`.

A stack in `world.inventory` or `world.bank` is a `HeldSlot`, which is an `InvSlot` plus two fields the shared shape cannot promise. Both are absent, and unreachable rather than merely missing, everywhere else a stack appears: the server projects a payload down to a fixed allowlist before it sends a market row, a letter attachment or a guild bank row, so `undefined` there means "not sent" rather than "no". Read `PublicItemInstance` for what that allowlist currently holds.

The first is `instance.locked`, the safety mark the owner sets in the game's own bag window. A locked copy refuses salvage, consumption as a craft reagent, and a vendor sale until it is unlocked. You cannot set one: an addon reports a lock and never performs one.

The second is `instance.partyTrade`, the bind-on-pickup window a soulbound copy won from party boss loot carries: for two hours it may still be traded, but only to the players who were loot-eligible at the instant it dropped. **Read `untilMs`, never the field's presence.** It is a real epoch deadline, so compare it against `Date.now()`, and the marker is retired only when a character loads or saves rather than on a tick, so a window that lapsed an hour ago is still sitting on the copy looking exactly like a live one. `eligible` is the snapshot taken at the drop and not the party as it stands now, and `eligibleIds` holds stable character ids, which are not entity ids and must never be compared against one. Trading is the only channel the window opens; mail, market, vendor and guild bank stay blocked throughout, and equipping the copy strips the field for good, which is why a worn `ItemInstance` never carries it.

```js
const left = slot.instance?.partyTrade
  ? slot.instance.partyTrade.untilMs - Date.now()
  : 0;
if (left > 0) woc.log(`${Math.round(left / 60000)} minutes to pass this on`);
```

Nothing wakes for the deadline passing, because nothing in the payload moves when it does. Every transition you can actually observe (the drop arriving, the copy traded away or received) moves the stack's count and wakes an inventory watcher already, so drive a countdown off `woc.every` or `woc.paint` rather than waiting for a `world.on`.

Position comes off the entity rather than the zone, and every entity has it, not just you:

```js
const { x, y, z } = woc.world.player.pos;   // yards: x east-west, z north-south, y height
woc.world.player.facing;                    // radians, 0 is +z
woc.world.player.prevPos;                   // last tick, which the game interpolates from
```

Those are the same numbers the game's own coordinate readout floors for display. `prevPos` is there because the client renders between ticks: comparing it against `pos` tells you which way something is actually moving, which a single sample cannot.

### How far, and which way

```js
const away = woc.world.distanceTo(node);   // yards from the player, or null
const turn = woc.world.bearingTo(node);    // degrees to turn, or null
const arrow = woc.fmt.compass(turn);       // one of the eight arrows
```

Both take any `{ x, z }` (a node out of a table, a quest objective, another entity's `pos`) and measure from the player.

`world.distanceTo` ignores height on purpose. It is the distance you would WALK, and it is what the game's own gates measure, so a node on a ledge above you is as far away as its footprint is. `world.bearingTo` is what you have to TURN, clockwise, from where you are facing: 0 is straight ahead and 90 is to your right, in the range -180 up to but not including 180. That is the convention `fmt.compass` renders, so the two compose without a sign fix in between.

Both answer null before world entry, and `bearingTo` also answers null when the player's facing is not a finite number. Draw nothing then: an arrow drawn from a facing nobody has is confidently wrong.

### Your character sheet

```js
woc.world.character       // xp, rested, honor, renown, title, deeds
woc.world.talents         // your build and your saved loadouts
woc.world.professions     // skill counters, your crafting identity, your station
```

All three ride your own self payload, so they exist for **you and nobody else**: there is no way to read another player's sheet.

`character` carries `xp`, `lifetimeXp` (which keeps rising past the cap), `restedXp`, `prestigeRank`, `honor`, `lifetimeHonor`, `renown`, `milestones`, the `deeds` you have earned with the day each landed, and a `deedStats` block of lifetime counters. `activeTitle` is a **deed id**, never display text, so it identifies your title rather than spelling it: the deed table is content an addon cannot reach.

A counter at 0 in `deedStats` genuinely means it never happened, unusually for this API: the server sends every counter it keeps.

`talents` gives you the build itself: `rows` maps a row level to the option chosen on it, so counting its entries is how many points are spent.

`professions` carries the two skill counter maps, your crafting `identity`, and the `mobileStation` you have placed. **Read `identity.synced` before anything else on it.** The client seeds `craftSkills` and the whole identity with defaults and replaces them only when the server's first crafting value lands, so until that flag flips an all-zero reading is "nothing has arrived yet" rather than "this character has no craft skill", and the two are otherwise identical. `identity.knownRecipes` is what you LEARNED from a source, which is not the set you can craft: a recipe whose `acquisition` list is empty is grandfathered, known to everyone, and absent from that list for that reason.

`level` is not here: it is on the entity record, as `world.player.level`, so you read a mob's level or another player's the same way.

### The group, the run, and threat

```js
woc.world.group           // loot rolls you owe an answer, master loot, lockouts
woc.world.encounter       // the instanced run you are inside, and your clears
woc.world.threat(id)      // one mob's hate table, measured against you
```

`threat` is the server's own threat model, so a pull warning built on it agrees with the decision the mob is about to make:

```js
const table = woc.world.threat(woc.world.target.id);
if (table.share !== null && table.share > 0.9) warn('about to pull');
```

The table is capped at its top eight rows, so it tells you who is about to pull and cannot tell you where the twentieth person in a raid stands. It exists only for a **mob in combat**, so an empty reading means "not fighting" or "not a mob", never "everyone is at zero". Being absent from a table is not the same as being at zero on it, so `mine` is `null` in the first case.

**The two kinds of time on this API meet here.** A loot roll's `remaining` is seconds, like every other timer: the loader tracks the game's sim clock off the snapshot and does the subtraction for you. It is `null` only between your addon starting and the first snapshot. A raid lockout is an absolute epoch millisecond stamp, published as sent, which survives a reconnect and compares directly against `Date.now()`.

A loot roll is also one of the few places an item id arrives with a readable `itemName` beside it.

`encounter` is deliberately narrow: which run, how far through, and whether it is over. The rest of the game's run record changes faster than anything else this API reads; `world.raw` is there if you need it.

Combat state, all of it read-per-frame rather than pushed:

```js
woc.world.cooldowns       // ReadonlyMap<abilityId, secondsRemaining>
woc.world.auras           // buffs and debuffs on you
woc.world.targetAuras     // and on your target
woc.world.casts           // ReadonlyMap<entityId, EntityCast> for anything casting
woc.world.hazards         // ground effects, with radius and kind
woc.world.markers         // raid markers, by entity
woc.world.abilities       // your spellbook, with lookups by id and by name
woc.world.combat          // { active, source }: whether you are fighting
```

`world.cooldowns` is keyed by real ability id, which makes it one of the few places an id is safe to assume. `world.hazards` and `world.markers` are what a positional addon reads.

`world.hazards` is the ONE list of ground effects whose geometry the wire carries, so its `kind` is a closed union: a kind exists only once the loader reads the list behind it. `HazardKind` lists the kinds, and names the reason for each family the game draws that is deliberately absent. Every other ground AoE announces itself once as a `spellfxAt` event and then lives only in the renderer, so tracking one means keeping your own list from the events.

The ground, and what died on it:

```js
woc.world.deathZones      // lethal rings on a rift boss floor
woc.world.corpses         // ReadonlyMap<entityId, CorpseView>, everything lootable near you
woc.world.corpseLoot(id)  // one corpse, filtered to what YOU could take
woc.world.nodeCooldowns   // gathering node id to seconds until you can harvest again
woc.world.corpse          // where your own body lies while your spirit is a ghost
```

`world.deathZones` is deliberately not a `Hazard`. A hazard's geometry rides the snapshot and is complete for everything near you; a death zone is mirrored from a spawn event and counted down on your own client, so a zone placed before you came into range is missing and stays missing. The game's own rings have the same hole.

`world.corpses` is what to watch for a corpse becoming lootable, a field change on an existing entity that `world.on('entities')` cannot see. Use `world.corpseLoot(id)` rather than `entity.loot` for anything you draw: the wire carries a corpse's whole contents, personal slots included, to every player in range, and the unfiltered list shows people things they cannot have.

A corpse stops being openable before it stops being an entity, and `decayed` is the only thing that says so. When the loot window elapses the game refuses the corpse to everyone, but the entity stays in `world.entities` carrying its whole `loot` record. `mine` is empty and `copper` is 0 on a decayed corpse, so a display built on those is already right; one built on `all` has to check the flag, or it goes on listing bodies that are no longer there to loot.

`world.nodeCooldowns` is per player rather than shared, so a node another player just took is still yours to take. A node with no entry is ready.

Competitive play and the group finder:

```js
woc.world.match           // the bout you are in, discriminated on `format`
woc.world.arena           // your standings, your queue, the live ladders
woc.world.battleground    // your battleground record, queue and ladder
woc.world.finder          // your dungeon finder state
woc.world.finderBoard     // the realm's open premade listings
```

`world.match` is one union over every format, a duel and a battleground included, discriminated on `format`. The cadence is per format: a duel rides every tick, a battleground rides at 1 Hz and is forced fresh on every transition worth acting on, and the four arena formats are UP TO TEN SECONDS OLD, gated to 0.1 Hz on the server. A Fiesta ring drawn from it agrees with the game's; a Yumi health bar does not, and the type says which events carry the live figures.

`world.arena` is present for every character whether or not they have ever played, so a non-null reading says nothing on its own. Only the two ranked brackets mean anything: the unranked three carry a copy of the 2v2 record and an empty ladder.

`world.battleground` is the same shape of reading for Thornhollow Fields: present for everybody, a record and a queue and the live ladder, with the match itself on `world.match` as the `format: 'battleground'` member.

**An enemy PLAYER is identified from this roster and from no field.** A player entity never carries `hostile`, which the server sets on mobs alone, so a nameplate that colours from that flag paints every opponent in the game friendly-blue. Compare each `fighters[]` entry's `team` against `myTeam`, and the same applies in a duel and an arena, where the roster is on `world.match` too. `world.reaction` folds all three together and handles pets, so reach for it unless you need the roster itself. It has no open-world arm: the game makes two players with `/pvp` raised hostile depending on the zone rules under each, which are not on the wire, so such an opponent reads friendly.

**Paint from the key, announce from the events.** The key carries the score, both flags, the roster and the clocks, and it survives a reload. `bgFlag`, `bgKill`, `bgTimeWarning` and `bgEnd` are the moment. An addon that keeps its own score by adding up events drifts the first time one is missed; one that polls the key for a capture announces it up to a second late. `bgEnd` is the only place a rating DELTA and the reason a match ended are readable.

**What is missing is enforced by the server.** An enemy fighter's position, health, auras and casts never reach your client past the ordinary interest radii, and the roster deliberately carries no health at all. `dead` is the one piece of enemy state that is match-wide, because the respawn wave clock already tells both sides the same thing. There is no way to build an enemy tracker or an enemy health readout, and nothing that appears to do so is reading real data. The queue offer is the same shape of limit from the other direction: `battleground.proposal` says an offer is open and counts its seconds, and accepting it is a send, so the Accept stays in the game's own prompt.

`world.finder` and `world.finderBoard` are reads and nothing more. Neither can join a queue, answer a proposal, create a listing or accept an applicant.

The counters you walk up to, and the two badges that outlive them:

```js
woc.world.market          // the Merchant's book, one browsed page
woc.world.mail            // the Ravenpost mailbox
woc.world.bank            // the deposit box
woc.world.vault           // the Materials Vault beside it
woc.world.marketCollectPending  // gold or goods waiting at the Merchant
woc.world.mailUnread      // delivered letters you have not read
woc.world.craftVaultStock // what crafting may draw from the vault HERE
woc.world.buyback         // what you sold to a vendor and can still take back
```

The first four exist only while you are STANDING at the counter, so they answer a status rather than a value:

```js
const market = woc.world.market;
if (market.status !== 'near') return;      // 'away', or 'unknown' before entry
for (const row of market.info.listings) { /* ... */ }
```

On a nullable value the reading everyone writes is `world.market?.listings ?? []`, which answers the empty array BOTH when the filter matched nothing and when you are nowhere near a Merchant. On the closed arms there is no `listings` to reach for, so that mistake cannot be written.

`world.marketCollectPending` and `world.mailUnread` are deliberately not inside them: a badge exists for the moment you are NOT at the counter, so both stream everywhere. `world.mail` carries its own `unread` over the same letters, which is the mailbox pane's figure; do not derive either from the other. `world.buyback` is ungated too, most recent first.

`world.bank.info.capacity` is a display total, never a fit answer. The bank's budget is split into a general pool and a materials pool, so a deposit can be refused while the other pool has room; use `generalCapacity - generalUsed` for what a non-material stack can go into, floored at 0, because unsocketing a bag shrinks a pool without destroying anything and a `used / capacity` meter has to survive a fraction over 1. Two invariants hold, since the game's decoder rejects a snapshot without them: `generalCapacity + materialsCapacity === capacity` and `generalUsed + materialsUsed === slots.length`.

Four bag sockets sit above the copper slot ladder and `world.on('bank', ...)` fires on all of it. Unlocking a socket adds no slots, so `capacity` does not move and `socketsUnlocked` is the only thing that reports the purchase; swapping one bag for another of the same size moves only `socketBags`. `nextRungClaudiumPrice` is ABSENT rather than null when there is none; test it against `undefined`.

`world.vault` is the Materials Vault, banker-gated like the bank and read the same way. There is no slot budget and no cell: every material has its own count against one shared `perMaterialCap`, and a full vault is a sentence about one material. Check `upgrades > 0` before dividing by that cap, because a locked vault reports 0 for both. Sort `stock` before rendering: the record round-trips through the server's database online and comes back re-ordered, so an unsorted list shuffles between sessions. A material that is not a key is held at zero. `special` is the rows that carry an identity and cannot collapse into a count; `craftedRecipeId` on a `HeldSlot` tells two of the same item id apart.

`world.craftVaultStock` is what crafting may draw from the vault where the player is standing. It is not banker-gated and has three states: a record means the draw is allowed, an empty record means allowed and empty, and `null` means refused here, which is inside a battleground, arena, delve, dungeon, raid or rift. A "you have no reagents" message built on emptiness is therefore wrong for a player in a dungeon. It is also null before the first snapshot, so gate on `world.ready` if the difference matters.

There is no price history: the server keeps no record of a completed sale. A price series is something your addon builds, by recording each page its player browses.

`market.info.sellLowestPrice` is the cheapest live listing of whatever the player has staged on the Sell tab, filled by a request only the game's own window sends. It is real while a player is part-way through listing something and null the rest of the time. Read `market.info.sellPriceItemId` first and compare it against the item you think is staged: the answer arrives a round trip after the question, so a snapshot taken across an item switch carries the previous item's price under the new item's form.

It counts every active listing of the item, the Merchant's own stock and the player's own rows included, because a buyer can take either instead: it is the price nothing resells above, and it is not the cheapest rival, so an unguarded "undercut this" can be telling a player to undercut themselves. And it is a stack's price divided by the stack and rounded up, so it sits at or just above the true per-unit figure and never below it, which is the direction that makes an ask one copper under it genuinely under the real one.

**Read `market.info.collapseLowest` before you read depth off a page.** With it on, the server has collapsed the matched book to one row per item id, cheapest first, and it has done that before cutting the page and before counting: `totalCount` and `pageCount` are both over collapsed rows, so nothing on the wire says how many listings stand behind a floor and depth cannot be read off that page at all. What you get instead is the strongest single reading Browse offers. The filter is a function of the item id alone, so all of an item's listings match or none do, which makes a row the cheapest listing of that item in the whole book rather than on the page. Your own listings collapse with everyone else's, so one of yours on the page is one nobody has undercut, and one that is missing has been undercut by the row standing in its place. Instanced copies stay distinct, since no two of them are the same goods.

**Read `market.info.sort` before you fold two pages together.** Browse has two orders, an axis of its own beside the five filters: `'name'` is the classic one, the book grouped by display name and then by price, and `'price'` is the whole matched book cheapest first. It reorders and never narrows, so the same query under the two produces the same rows in a different arrangement, and the arrangement is what a partial reading samples. Under `'price'` page 0 is the cheapest rows in the market, which is the strongest thing either order can tell you about an item, and every page after it can hide a cheaper copy of anything: an item's listings are contiguous only under `'name'`. Record which order a reading came from, or a median over your own browsing becomes a median over whichever end of the book the player was looking at.

`world.abilities` is how you get between an ability's id and its display name, which have diverged: skill art is filed under `arcane_shot`, while a combat event names it `Fell Shot`.

```js
// an event gave you a name; get the id, and then the art
const info = woc.world.abilities.byName(event.ability);
const url = info && woc.ui.icon.ability(info.id, woc.world.player.templateId);

// a cooldown map gave you an id; get something worth showing a player
const said = woc.world.abilities.describe(id);
label.textContent = said.known ? said.name : `${said.name}?`;
```

It covers YOUR OWN known kit, so an ability a mob casts is not in it and `byName` answers null. It is empty rather than absent before world entry, and its `cost`, `castTime` and `cooldown` are resolved after your talents rather than the ability's base figures.

Three fields on an `AbilityInfo` come off the ability's own definition and are untouched by talents. `channel` is the length and tick count of a channel, absent when the ability is not one; its duration is pre-haste, and a channelled ability's `castTime` is 0, so it reads as instant unless you look here. `offGcd` marks an ability that costs no global cooldown, absent rather than false. `empowerStages` is the stage count of a hold-to-charge spell; the stage itself is on no wire, and the game derives it from the cast clock:

```js
// Both guards are the game's own. Keep both.
function empowerStage(entity, stages) {
  if (stages <= 1) return 1;                                  // the game's floor
  if (entity.castTotal <= 0) return stages;                   // no clock: fully charged
  const done = (entity.castTotal - entity.castRemaining) / entity.castTotal;
  const progress = Math.max(0, Math.min(1, done));
  return Math.min(stages, Math.floor(progress * stages) + 1);
}

const info = woc.world.abilities.byId(entity.castingAbility);
const stage = info?.empowerStages ? empowerStage(entity, info.empowerStages) : null;
```

**The `castTotal` guard has to come before the division, and the clamp does not replace it.** `castTotal` is zero-filled by the client, so a record can carry a `castingAbility` with no total; divide by it and NaN survives `Math.max(0, Math.min(1, NaN))`, and a NaN written to a style property drops the declaration silently, so the bar looks stuck.

Both inputs ride every entity record, so this works for any caster in interest range. The limit is the spellbook: there is no other route to the divisor for an ability you have not learned.

**Nothing on the wire marks a cast as empowered.** A cast with no stage count may be an empowered one whose ability you do not know, so build two appearances, a staged cast and a cast, and no "stage unknown" state. `Aura.empowerAbilities` is the scope of a next-cast empowerment buff, not a charge stage.

`abilities.describe` answers for an id that is not yours too, where `byId` returns null: `known: false` means the name was DERIVED from the id rather than looked up, which is often wrong (`arcane_shot` derives to "Arcane Shot" for the ability the game calls Fell Shot). It never returns null and never throws, including on the landing page, where everything comes back derived.

The mark is deliberately not baked into the name. Append your own `?` where a player reads it and pass the bare `name` to an `aria-label` or a tooltip title, where a mark glued to a name reads as part of the name. `school` is null for the same reason `known` is false: nothing but your own spellbook carries one.

`world.combat` answers from the best signal available and tells you which one it used:

```js
woc.world.on('combat', ({ active, source }) => {
  if (active) meter.begin();
});
```

`source` is `self` when the server's own combat flag for you says you are fighting; `party` when you are grouped, since the server sets a combat flag per member; `threat` when a nearby mob's hate table has you on it, which is server state too; `pvp` when a player the bout puts on the other side has you selected, which is the same reading `world.reaction` answers with; and `recent` when none of those answered and damage involving you landed in the last five seconds. Only that last one is a guess. Most addons can ignore the source entirely; read it when acting on a false positive would be worse than acting late.

The `self` branch is read only when it says true: the client defaults that flag to false, so a false cannot be told apart from a server that never sent one. The server holds a whole group in combat while a boss is engaged, and drops an attacker from an open-world mob's table past 100 yards (inside a dungeon or raid room, only leaving the room does), so `world.combat` and `world.threat` go quiet when you leave a fight.

Do not read `inCombat` off an entity. It is written for your own record only; on every mob, npc and other player it reads false forever. `world.combat` is the reading, and `source === 'self'` is how you tell the server itself answered.

### Naming a unit

```js
woc.world.unit('target');        // the same Entity world.target gives you
woc.world.unit('targettarget');  // what your target is fighting
woc.world.unit('pet');           // your companion
woc.world.unit('party1');        // the first group member who is not you
```

`world.unit` resolves a unit token, and `targettarget` is the reason to use it rather than writing the lookup yourself. On every mob `targetId` is present, correctly typed, and permanently null, because the server fills it from a player's SELECTION; what a mob is fighting rides `aggroTargetId`. The resolver reads whichever field the target's kind fills.

`partyN` counts the other members, so `party1` is the first person who is not you; `raidN` counts everyone including you. Both resolve to an **entity**, which means both answer null for a member too far away to have one even while `world.party` still lists them. For a raid display read the party rows, which are complete, and reach for an entity only when you need something a row does not carry.

### Which side a unit is on

```js
woc.world.reaction(entity.id);   // 'hostile' | 'friendly' | 'neutral', or null
```

**Read this rather than `entity.hostile`.** That flag is set on mobs only, so it is false on every player for the whole session, and a nameplate coloured from it paints every duel, arena and battleground opponent friendly-blue with nothing reporting a problem.

The answer comes from the bout instead, the same three sources the game's own nameplates use: the duel's other player, the arena's enemy list, and a battleground fighter whose `team` is not your `myTeam`. Outside a bout every player reads friendly, which is what the game draws. A **pet** is asked about its owner, one level deep, so an enemy player's pet reads hostile and your own never reads as a wild mob. `null` is a unit nothing in scope holds, which is a different answer from `neutral`.

`neutral` is a real reading rather than a failure: a wild boar is on nobody's side until somebody makes it.

### Filtering auras

```js
const mine = woc.world.aurasOn('target', { mine: true, kind: 'dot' });
const debuffs = woc.world.partyAuras(pid, { debuff: true });
woc.world.harmful(aura);            // is this working against whoever carries it
woc.world.dispellable(aura);        // can you remove it off an ally
woc.world.dispellable(aura, true);  // ...or strip it off an enemy
woc.world.toggle(aura);             // is this a MODE, with a clock that means nothing
```

`mine` is the filter a dot tracker needs and the one most often forgotten. Two players can carry the same debuff on one target, and without it a display shows a full timer while your own effect quietly expires.

`world.harmful` and `world.dispellable` are functions rather than fields because the auras are the game's own objects, not copies, which keeps the object identity you use to track one effect across frames. `world.harmful` accepts a party row as well as a full aura. `world.dispellable` refuses a row, because a row carries neither a school nor the encounter-control flag and those are the two clauses whose absence costs a player a global cooldown.

`world.dispellable` refuses two auras BY ID that nothing visible on the aura would tell you about: a paladin's Divine Ascension charges and a shaman's Stormsurge proc window, states the game draws as auras rather than effects anything can transfer. One clause no client can run: `encounterOwned` is checked by the game first and never sent, and it is set across all three raids and the Buried Hoards rift boss rooms, so inside those fights `true` means "nothing a client can see forbids it" rather than "this will work". That includes player debuffs a healer would reach for, such as Nythraxis's Soul Rend, Ignivar's forge chains and a hoard boss's frost slows. There is no heuristic worth substituting.

**Ask `world.toggle` before you draw a timer.** A stance, a druid form, stealth, Ghost Wolf, Beacon of Light, the battleground carried flag and the rotation banks a spec fills and spends are MODES: the game backs each with a long finite duration, 3600 seconds or a whole match, purely so the sim has a JSON-safe number, and `remaining` counts down through it like any other aura. Without this a bar under a Cat Form drains over an hour and a label under a Battle Stance reads `59:59`. Unlike `dispellable` this is the game's whole rule, reading only an id and a kind, so it accepts a party row. Greater Invisibility is the case that stops it being a kind check: it reuses the rogue stealth machinery and IS a fixed 20 second buff, so it answers `false`.

Authored content, which ships in the client rather than arriving on the wire:

```js
woc.world.recipes         // the game's own recipe table, copied and frozen
woc.world.stations        // the authored crafting stations
woc.world.civicServices   // the authored mailboxes and noticeboards
```

All three are frozen copies and none is a watch key: content cannot change during a session. What changes is on `world.professions`, including which of these recipes you have learned.

`world.civicServices` answers where a counter IS, which is a different question from `world.mail`: that one is proximity-gated and tells you whether the player is standing at a mailbox now. A row is a `kind` and a position. The kind is an open string (`'mailbox'` and `'noticeboard'` today), so match the kinds you draw and let an unknown one fall through.

`partyAuras` is separate because a party row's auras are a smaller shape than an entity's: an id, a kind, whole seconds, and a debuff flag, with no source. That is also why `PartyAuraQuery` has no `mine`.

```js
woc.world.on('cooldowns', rebuild);
await woc.world.ready;
```

`world.on` subscribes to a key changing. `world.ready` resolves at world entry; before it the world is empty rather than absent, so an addon can subscribe and prepare at document-start and simply see nothing yet.

Subscriptions report a **set changing**, never a number moving. That is the first item in [Patterns](/docs/patterns), and the thing most likely to make an addon look broken.

`world.game` is version and realm information about the deployment you are on.

## ui

Windows, and the pieces that go in them.

<!-- include: addons/cooldown-bars/main.js#frame -->

`ui.frame` is a light HUD panel and `ui.window` is a full one with a body that fills. Both take `density: 'comfortable' | 'compact' | 'bare'`. Comfortable is the default, the game's own desktop window scale. Compact is tighter, for a dense readout you glance at rather than operate.

Neither gives up the tap-target floor. The loader restores 16px type on a 40px target under `@media (pointer: coarse)`, whichever density you picked. The one thing that defeats it is writing a `font-size` or `min-height` onto a kit control yourself: an inline style beats every stylesheet rule, so hand-sizing a control opts it out of that floor on a phone. Change the padding instead.

`bare` removes the chrome altogether: no panel behind your content, no padding, no title bar. Reach for it when the thing on screen IS your content, a row of timers floating on the HUD rather than a panel holding them.

```js
const overlay = woc.ui.frame({ id: 'timers', title: 'Timers', density: 'bare', save: true });
```

With no title bar, the frame is dragged by **its own content** instead, with buttons and fields inside it left clickable, so bare suits a readout rather than a form. And `ui.window` ignores it and stays comfortable: a window's close button lives in the title bar, and a panel the player cannot dismiss is worse than one drawn more heavily than it asked for.

Keep the `title` even so. It is not drawn, but it is the frame's accessible name, and it is the label the loader shows while frames are unlocked.

**A bare frame can be invisible, and that is what the unlock mode is for.** An overlay whose content is a list of timers has no pixels at all while nothing is running, which is exactly when a player wants to position it. Pressing `Alt+U`, or flipping "Unlock frames" at the top of the manager's Installed pane, outlines and labels every addon frame, gives an empty one a minimum size, and makes the whole outline draggable. Turning it off puts everything back.

Every frame takes part without asking, so do not build your own idle placeholder.

### The key that shows and hides it

`toggleKey` names a keybind from your manifest that toggles the frame:

```js
const panel = woc.ui.frame({ id: 'main', title: 'Meter', toggleKey: 'toggle' });
```

The id has to be one you declared; otherwise the loader warns through your log, binds nothing, and still builds the frame. The bind is released when the frame is DESTROYED as well as when your addon is disabled, so throwing one frame away and building another under the same key leaves exactly one binding, in either order.

Bind it yourself with `woc.keys.bind` when the key does more than toggle, when one key should reach several frames, or when there may be no frame at all: **showing a panel is often also a redraw, and `toggleKey` has nowhere to hang one.** A panel that stops drawing while hidden (see `woc.paint`) or world pins refreshed on a timer both want a redraw on show.

### What your frame takes away from the player

The game binds the world's `mousedown` and `wheel` to its canvas, so an element over it takes the whole gesture: selecting a target, holding right to turn the camera and scrolling to zoom all stop working inside your frame's box, and nothing can hand them on. The size of your frame is the size of the hole in the controls.

`pointer` is how you shrink it, and it defaults to the right thing: `'content'` on a bare frame, `'auto'` everywhere else.

```js
const strip = woc.ui.frame({ id: 'timers', density: 'bare', pointer: 'content' });
```

- `'auto'` is the whole box, chrome, padding and empty space included. Right for a panel the player operates, and for anything with a form in it.
- `'content'` makes the box transparent and leaves what you DREW taking the pointer. The gaps between your rows, the padding, and the dead width beside a short row all fall through to the world; your rows keep their hover, their tooltip and their clicks.
- `'none'` is inert. Nothing in the frame can be hovered or clicked, which also means no tooltips: the browser has no way to watch a pointer that is passing through.

With `'content'` you grab the frame by something it drew; with `'none'` there is nothing to grab. The unlock mode hands the whole frame back to the pointer for as long as it is on.

### Where your frame sits

Frames are drawn UNDER the game's own windows and over the world. Opening the game menu, the bags, the map or the spellbook covers your frame, deliberately: a frame is HUD furniture. The game's chat and action bars cover it too.

What the loader draws ON TOP of everything is what the player opened or what it raised itself: the manager, a `ui.menu`, a `ui.toast`, a `ui.alert`, a `ui.banner`, and the tooltip on your own row. So a warning that has to be seen belongs in a banner or a toast rather than in a frame you hope is not covered.

### Laying out against your own frame

`resizable: true` puts the box in the player's hands, and `onMove` tells you where it ended up. The loader owns that box: it writes the position, and the size of a resizable frame, and it re-clamps both when the viewport changes and when a saved box is restored, so this is the only account of it you can trust.

```js
woc.ui.frame({ id: 'strip', resizable: true, height: 40, onMove: (box) => scaleTo(box.h) });
```

Use it rather than measuring `frame.el`, which forces a synchronous layout. It fires on a drag, on a resize at pointer rate, on the async restore of a saved box, and when the window is resized under you, but never for the initial placement, which is the size you asked for and therefore already hold. A throw inside it is caught and written to your addon's log rather than breaking the gesture the player is in the middle of.

**A `bare` frame is moved and resized only while the arrange mode is on.** Its whole content is its drag handle, so otherwise any press that travelled a few pixels over a row would move it. Every refused drag says so. Everything else is untouched: your clicks, your tooltips, your own controls, the toggle keybind, and every write the loader makes, so a bare frame is still restored to where the player left it and still pulled back on screen when the viewport shrinks. A frame with chrome keeps both gestures at all times, because a title bar and a visible border are targets nobody hits by accident.

`resizable: 'width'` and `resizable: 'height'` hand over ONE axis and leave the other following your content. That suits most HUD lists, whose row count is a setting rather than a function of the box.

```js
woc.ui.frame({ id: 'nodes', width: 300, resizable: 'width', minWidth: 180 });
```

`frame.box()` is the same box `onMove` reports, readable whenever you want it. It costs no layout, and it answers right after you built the frame, when `onMove` has not fired.

```js
// Eight rows and their gaps, out of whatever height the player dragged.
const row = woc.ui.units(frame.box().h, { count: 8, gap: 3, min: 23, max: 69 });
rows.forEach((bar) => bar.update({ size: row }));
```

`woc.ui.units` is the arithmetic that goes with it: the gaps come out of the box BEFORE the division, and the share is FLOORED, since a share rounded up pushes the last row past the bottom of a frame that clips. `extra` is space the units never get, which is how a strip of art with a caption band under it solves back for the square.

A frame that is NOT resizable, which is every frame unless you ask, is held to exactly the `width` you declared and its height is whatever it is holding. A fixed width keeps the panel from stepping in and out as its text changes: a long note wraps inside your column. Omitting `width` takes the default.

**By default a frame cannot be dragged smaller than the size it was created at**, so `width: 400` is also a floor of 400 unless you say otherwise. Say otherwise with `minWidth` and `minHeight`, and cap the other end with `maxWidth` and `maxHeight`.

```js
woc.ui.frame({ id: 'strip', resizable: true, width: 400, height: 40, minWidth: 120, maxHeight: 96 });
```

Where the four disagree, the order is fixed: a frame is never taken below the size at which it could no longer be grabbed, the viewport beats your minimum so a frame asking to be wider than the screen can still fit one, and your minimum beats your maximum. State only the axis you mean; the other is left alone.

Cooldown Bars uses the pair for its tile strip: the frame's height is the icon size, and the width is only room to grow into, so icons never shrink mid-fight as more cooldowns start.

`ui.bar` is the loader's timer row, and `ui.tooltip` attaches a description to any element you own:

<!-- include: addons/cooldown-bars/main.js#bar -->

A bar's fill can be tinted by damage school, which is a separate axis from `tone`. Tone is urgency; a school is what kind of damage a row is made of. Where both are set, tone wins.

`size` makes a row as tall as you say, art and text with it. Left alone, a row is as tall as its own line box, in the game's text size.

```js
bar.update({ size: woc.ui.units(frame.box().h, { count: 8, gap: 3, min: 23 }) });
```

Reach for it rather than writing a height or a font size onto the row yourself: an inline style beats every rule in the loader's sheet, including the 40px tap-target floor it restores on a touch screen. `ui.tile` means the same thing by `size`: one number sizes the square, its art, its sweep and its figures together.

### Items, and the colour a player reads them by

A row or a square that is an ITEM takes a third axis, `quality`. A bar colours its label and a tile colours its border, with the game's own two palettes for an item's name and its icon.

```js
row.update({ label: 'Ashstalker Cowl', quality: 'epic', icon: woc.ui.icon.item('ashstalker_cowl') });
cell.update({ icon: woc.ui.icon.item('ashstalker_cowl'), quality: 'epic' });
```

There is no way to pass a colour: two addons drawing an epic should draw the purple in the player's own bags. For an element you drew yourself, a chip or a heading or a name in a panel of your own, the same six colours are on the class `woc-quality-<tier>`, which you may put on anything you own, exactly as you may reuse `woc-btn` and `woc-tab`.

Nothing in the loader knows an item's quality: the game's item table is bundled into its own chunk and is served nowhere. So a tier comes from a `LootRoll` off `world.group`, a record another addon published on the bus, or a table your own addon ships. Null, and anything outside the six tiers, colours nothing, which is right for an item the game ranks at no tier and for an id you have not looked up.

`woc.ui.itemCell` is how big to draw one: the game lays every grid of items out at `minmax(42px, 1fr)` over a 4px gap and serves that number nowhere.

```js
const cell = woc.ui.itemCell;
grid.style.gridTemplateColumns = `repeat(auto-fill, ${cell}px)`;
grid.style.gap = '4px';
const square = woc.ui.tile({ size: cell, quality: 'epic' });
```

Use a fixed track rather than `1fr`, which stretches the square as the player drags the frame. Do not pick a denser figure: this one keeps every cell above the 40px tap target, and the loader's coarse-pointer sheet cannot restore a tile's inline size.

### People, and the colour a player reads THEM by

A bar takes a fourth axis, `unitClass`, which tints the FILL, where a tier tints the label.

```js
row.update({ label: 'Anserra', fraction: 0.66, unitClass: 'priest' });
```

A `school` tint and a `tone` both win over it. The nine colours are the game's own and there is no way to pass one. `woc-class-<id>` carries the same colours as text, for a name in a roster or a chip in a scoreboard you drew yourself.

**Check the kind before you pass it.** The id you hold is an entity's `templateId`, which is a class on a player and a mob template everywhere else, so `'boss_wolf'` reaches this field as readily as `'mage'` does. Anything outside the nine tints nothing, but pass null for a mob. A tile has no `unitClass`.

### Money

Every amount the game sends is counted in copper. Give a bar's `value` an amount instead of a string and it is drawn the way the game draws money: a coin per unit, empty units left out, and the whole figure announced in words to a screen reader, which the discs alone would not be. `prefix` is for a figure that has to say what it is, since a bare amount at the end of a row reads as the price.

```js
row.update({ label: 'Copper Ore', value: { copper: 4400, prefix: 'low' } });
```

`woc.ui.money(copper)` is the same split as text, for a tooltip line or anywhere else that takes no markup: `7s 80c`, with the empty units left out.

<!-- include: addons/combat-meter/main.js#school-tint -->

### What a hovered row says

`ui.tooltip` takes a string, or the whole tooltip: a title, an icon from `ui.icon`, and lines that each carry a tone.

<!-- include: addons/cooldown-bars/main.js#tooltip -->

You never write dismissal. The loader takes a tooltip down on leave, on blur, when its anchor is removed from the document, and when the pointer moves anywhere the anchor is not. [Patterns](/docs/patterns) covers why the last two are needed.

**Pass a function when the answer changes.** It is called at the moment the tooltip is shown, so a row reports the numbers under the pointer rather than the numbers it was built with, and the content is assembled for the one row being hovered instead of for every row on screen.

The tones are `default`, `muted`, `good`, `warn` and `danger`, and they say what a line MEANS rather than how loud it is. They are not a bar's tones: a fill can only express urgency, while a line can be flavour text, a cost, or a requirement you do not meet.

Everything is written as text and never as markup, because an ability name and a player name both reach you from the wire.

### Timers as squares

`ui.tile` is the same timer in the other shape: the game's art with a radial sweep over it, a countdown on top, and a stack count in the corner.

<!-- include: addons/cooldown-bars/main.js#tile -->

A bar has room for a name, so it suits a list you read; a tile's art is its label, so it suits a strip you glance at.

`fraction` is what is LEFT, the same as a bar's, and the wedge gives the art back as it runs down. Neither one animates itself: subscribe for the set changing and move `fraction` from a frame loop.

A tile's border takes the same `school`, `tone` and `quality` axes a bar has, with the same order between them: a tone or a school wins the border over a tier. Its square defaults to 40px, the tap-target floor the game holds its own controls to, and `size` gives that up deliberately for a dense strip.

`label` is never drawn. It is how the tile is announced, as one image named for everything it says, since there is nowhere to put a name on a square that is all art. A tile without one is hidden from assistive technology rather than announced as a bare number.

Both return the same `{el, update, destroy}`; Cooldown Bars offers both under a `layout` setting as the worked example.

### The boxes a panel is made of

`ui.column`, `ui.row` and `ui.line` are the three boxes a panel is assembled from, and `ui.show` is the one way to hide any of them.

```js
const pane = woc.ui.column({ parent: frame.body, gap: 4 });
const strip = woc.ui.row({ parent: pane, wrap: true, align: 'baseline' });
const note = woc.ui.line({ parent: pane, tone: 'muted' });

woc.ui.show(note, rows.size === 0);
```

Each returns a plain `HTMLElement` you fill yourself, so this is a shorthand for the box rather than a widget with a lifecycle: there is nothing to destroy, and `className` puts your own class alongside the kit's so your CSS still reaches it. The kit's own classes are `woc-layout-column`, `woc-layout-row` and `woc-layout-line`.

**They write a class rather than a style attribute.** An inline style outranks every selector a stylesheet can spell, so a panel laid out in style writes silently opts out of the loader's rules, the tap-target floor on a phone included. **Change the padding, never the font size or the height.** `gap` is the one number these take, and even it is written as the `--woc-gap` custom property rather than as `el.style.gap`, so the declaration stays in the loader's sheet where a later rule can still reach it. They also carry `flex-shrink: 0`, so a screenful of rows in a scrolling frame scrolls rather than squeezing every row until it clips its own second line.

`gap` defaults to the spacing of the density the element is drawn in, so a column in a comfortable frame and the same column in a compact one are spaced like the frames around them. `align` defaults to `center`; reach for `baseline` where a small label sits beside a bigger figure. `tone: 'muted'` on a line is the smaller, dimmer note a panel puts under its figures, in the game's own secondary colour at the size the game writes its own captions at.

`ui.show` does two things and both are needed. It toggles the class the loader's sheet hides, and it sets the `hidden` attribute, without which an element taken off the screen stays in the accessibility tree announcing figures nobody can see. A class rather than a `display` write, so nothing has to remember the element's previous display. It takes anything, including elements of your own.

### A set of rows that changes

`ui.list` is a keyed reconciler: it destroys rows that left, builds rows that arrived, paints all of them, and moves each to its place, writing nothing when a row is already there.

<!-- include: site/content/examples/list.js#list -->

You describe one row and hand it the whole set on every change. `key` is what makes two items across two syncs the same item, so it decides what the player sees hold still: key on the thing itself, never on its position in the array, or every reorder throws away the row that moved and builds a new one where it landed. `create` returns whatever you want to hold, which is usually the widget and sometimes an object with the widget and whatever you measured, and `update` is handed that back for every item on every sync, new rows included. A new row is drawn by the same code that redraws an old one.

`sync` takes the set you want KEPT, in the order you want it, and a sync that changes nothing writes nothing, so calling it from a frame loop or a repaint is the intended use.

**`shown` is how you hold more than you draw; reach for it rather than slicing.** Pass the whole set to `sync` and answer false for the rows that should not be on screen: the element comes out of the parent and the row stays alive with everything it had measured. A sliced-off row is rebuilt from nothing when it returns, and a learned value such as a cooldown's real length is lost.

The two indices differ. The index `update` and `shown` are given is the item's position in the array you passed. The place a shown row is drawn at is its rank among the shown rows alone, so hiding the third of five leaves the fourth drawn third, with no gap where the hidden one was.

Omit `parent` and nothing is inserted and nothing is ordered, which is what a world pin needs: each one carries its own `ui.anchor3d` and the loader is already putting it where it goes. `element` is for when what `create` returned is not itself an element and does not carry an `el`. `get`, `size` and `clear` are there for the moments in between, and `destroy` is done for you when your addon is disabled.

### Your own settings pane

`ui.field` is the four labelled controls the manager's own forms are drawn with, and `ui.tabs` is its tab strip. A form built from them answers to your frame's density and matches the game.

`ui.field.select` is NOT a native `<select>`, whose popup the operating system draws outside the document and beyond styling. It is a button and the loader's own menu, with the chosen row in the game's accent: `{label, value, options, onChange}` in, `{el, value, set, destroy}` out.

```js
const window_ = woc.ui.field.slider({ label: 'Rolling window', value: 5, min: 1, max: 60,
  onChange: (next) => woc.storage.set('window', next) });
pane.appendChild(window_.el);
```

Every field hands back the same four things: `el` to place, `value()` to read, `set()` to move it, and `destroy()`. **`set` does not call your handler back**: it is what a reset button and a reload use, and a setter that reported itself would write the value straight back to storage.

The four are `checkbox`, `select`, `slider` and `text`. A checkbox puts its label beside the box and the other three put it above. A slider shows its number. A text field reports as you type rather than on blur, so a value abandoned by closing the window is not lost.

`ui.tabs` is navigation rather than a value. The loader owns the strip; which pane it reveals is yours.

```js
const strip = woc.ui.tabs({ tabs: [{ id: 'damage', label: 'Damage' }, { id: 'healing', label: 'Healing' }],
  onSelect: (id) => show(id) });
```

### Per-row actions

`ui.menu` opens a context menu at an element or at a point, which is how an addon offers actions without spending frame space on a button per row.

```js
row.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  woc.ui.menu({ x: event.clientX, y: event.clientY }, [
    { label: 'Reset this ability', onSelect: () => reset(id) },
    { label: 'Hide it', onSelect: () => hide(id), separator: true },
  ]);
});
```

The loader owns the **dismissal**: on select, on Escape, on a click anywhere else including one a game control swallows, and when your addon is disabled with it open.

There is one menu for the whole loader and opening a second closes the first. An item can be `disabled`, and `separator` draws a rule above it, ignored on the first item where it would draw a lid on the menu instead.

`checked` marks the item currently chosen: drawn in the game's accent and announced as a radio rather than as a command. Put it on EVERY item of such a menu, true or false, or a reader is told about one radio button and a list of commands. `ui.field.select` is built on it.

### Over a point in the world

`ui.anchor3d` hands you an element the loader keeps positioned over a world point: nameplates, ground markers, a target arrow, a pin on a gathering node.

```js
const plate = woc.ui.anchor3d(() => woc.world.target?.pos ?? null, { offset: { y: -40 } });
plate.el.className = 'my-nameplate';
plate.el.textContent = 'Bog Bloat';
```

Pass a fixed point for something that does not move, or a **function** for something that does, and the anchor follows it without your addon running a loop. Returning null hides it, for a unit that has despawned.

It hides itself when the point is behind the camera, when it is off screen by more than `margin`, and whenever the game cannot be asked at all, which includes every moment before world entry. Your element is centred on the point, so `margin` defaults to 64 rather than 0: an element centred on a point that has just left the edge is still half on screen.

It reads the game's **renderer**, which an addon cannot. Every anchor shares one frame loop, and a frame in which nothing moved on screen writes nothing.

### Saying something

```js
woc.ui.toast('Ready to pull');
woc.ui.banner('Deathless Rage', { kind: 'danger', size: 'large', detail: 'interrupt it' });
const choice = await woc.ui.alert({ title: 'Reset?', buttons: ['Reset', 'Cancel'] });
```

Three weights. `ui.toast` is a passing line at the top of the screen for something that happened. `ui.banner` is the centre-screen warning, for the one thing a player must read within a second: there is one slot for the whole loader and a new banner replaces whatever is up, including another addon's, because stacking warnings would cover the fight the warning is about. `ui.alert` is a modal that asks a question and resolves to the button pressed, or to null if the addon is disabled while it is open.

Anything read at the player's own pace belongs in a frame instead.

### Getting into the game's own chrome

```js
woc.ui.microButton({ label: 'Meter', icon: '...', onClick: () => panel.toggle() });
woc.ui.menuEntry({ label: 'My Addon', onClick: () => panel.show() });
```

`ui.microButton` adds a button to the game's micro rail, next to the menu button. `ui.menuEntry` adds a row to the Game Menu itself. Both return an unsubscribe, and both survive the HUD rebuilding itself.

### Art

`ui.icon` builds paths into the game's own art: `ability(id, cls)`, `mob(templateId)`, `item(itemId)`. An ability with no painted art has no URL, so `ability()` returns null once the loader knows. A bar hides its own icon slot when an image fails to load, so passing a possibly-absent URL needs no guard.

## keys

```js
woc.keys.bind('toggle', () => frame.toggle());
```

You can only bind an id your manifest declared. The loader's dispatcher runs ahead of the game's own handler and claims a key **only when a bind matched**, so an unmatched press reaches the game untouched.

The rest is for an addon that wants to offer rebinding in its own UI rather than through the manager:

```js
woc.keys.combo('toggle');                 // 'Alt+KeyD', or null if unbound
const pressed = await woc.keys.capture(); // wait for the player to press a chord
const report = woc.keys.conflicts(pressed);
await woc.keys.set('toggle', pressed);
```

`keys.capture` resolves to the next chord the player presses, or to null if your addon is disabled while it is waiting. `keys.conflicts` asks what else already uses a chord, reading the game's own live keybind profile rather than a stored blob, and says whether the answer is complete.

## sound

```js
woc.sound.play('ui_click');
woc.sound.alert();
```

`sound.alert` is the generic attention cue, for when you want a sound and do not care which. `sound.play` takes a cue name from the pack the game serves, which collapses numbered families into one cue and carries the gain each clip was normalized to.

```js
woc.sound.cues();                         // every cue name this deployment serves
await woc.sound.preload(['boss_pull']);   // fetch before you need it
```

`sound.cues` is the live list; check against it rather than the published union, which a game release adds to first. `sound.preload` matters when the first play has to be on time.

## storage

Your addon's own key-value store, namespaced to your id and separate from the loader's settings and window state.

```js
await woc.storage.set('history', rows);
const rows = await woc.storage.get('history', []);
await woc.storage.delete('history');
const saved = await woc.storage.keys();
```

`storage.get` takes a fallback, so a first run needs no special case. `storage.keys` lists what you have stored, for a "clear my data" control.

### One character at a time

`storage.character` is the same four calls, scoped to whoever is logged in. Use it for anything a player would be surprised to find shared between their tank and their alt: a layout, a threshold, a list of what this character has seen. Keep `woc.storage` for a preference that is really about the player.

```js
await woc.world.ready;
await woc.storage.character.set('layout', { x: 20, y: 40 });
```

It is its own store rather than a view over the other one, so `layout` here and `layout` above are two different values and `keys()` on either answers only about itself. The key is derived from the realm and the character name, never from the session's entity id, which is reissued every login.

**A read waits for the character. A write refuses to.** Your first line runs at document-start, on the landing page, where nobody has logged in yet. A read called there settles at world entry with the data of whoever logged in. A write's value was decided when you called it, so holding it would store it against whichever character the player then picked. It rejects instead, and the error says to await `world.ready` first.

## bus

Publish and subscribe between addons, inside this page. An addon is one file with no imports and no shared libraries, so this is the only way two of them cooperate.

```js
// in the meter
woc.bus.emit('totals', { top: 'Fell Shot', dps: 812 });

// in the display, a different addon
woc.bus.on('official/combat-meter', 'totals', ({ payload }) => draw(payload));
```

**You name the publisher you are listening to, not just a topic.** Two addons can both publish `totals` without being confused for each other, and nobody can take a name by publishing under it first. Pass `bus.anySender` when any publisher will do, and read `message.from` to see who it was. The loader stamps that field from the sending addon's id, so a sender cannot forge it.

You never receive your own messages, because self-delivery is how a loop starts. Delivery is synchronous, inside your `emit` call, so keep handlers cheap and never assume one ran: nobody may be listening, and the addon you are talking to may not be installed. There is no request-response, deliberately: awaiting a reply from an addon that may not be installed or may not answer is a hang. Publish both ways instead.

A throw in your handler is logged against your addon and does not stop the message reaching anyone else. Everything you publish stays in this page and never reaches the network, but treat it as readable by every other installed addon.

### A value one addon holds and another wants

`emit` and `on` are a push that reaches whoever is listening at the moment you send, which is the wrong shape for a table: the addon that wants it usually starts second. `publish` and `follow` add an ask.

```js
// the publisher
const prices = woc.bus.publish('prices', () => table ?? null);
prices.announce();                          // when your own value moves

// the follower, in another addon
woc.bus.follow('prices', (payload, from) => {
  if (Array.isArray(payload)) draw(payload, from);
});
```

`publish` answers `prices:ask` from any sender by emitting `prices` with whatever `produce` returns, and hands you `announce` for the other direction. `produce` runs once per ask rather than once per listener, so a publisher with nothing to say yet returns null instead of tracking whether it is ready. `follow` subscribes to the topic from any sender and emits the ask once, so a publisher that started first still reaches you.

**Silence is the ordinary case.** Nobody may be publishing, and there is no timeout that would tell you the difference between "not installed" and "not ready". Render without an answer, upgrade if one arrives, and never treat quiet as an error. Say `companions` in your manifest if you want the manager to point a player at the addon that would fill it in.

`follow` listens to ANY sender deliberately: the same addon installed from another marketplace publishes under another fqid. Read `from` if you want to say who answered.

The loader ships no topic names. The names the addons here agree on are listed in [Patterns](/docs/patterns); read that list before inventing a name, and treat one on it as taken.

## data

A JSON file shipped in your own addon directory, for a table that has no business being pasted into your source.

```json
{ "data": ["items.json"] }
```

```js
const items = await woc.data('items.json');
```

Declare the file in `addon.json` and the loader fetches it when the player installs you, caches it beside your code, and hands you the parsed value here. Enabling your addon is never a network call, and a marketplace that goes offline does not take your table with it.

Up to eight files, each under half a megabyte, each a `.json` beside your `main.js`. It needs `apiMinor` 2, because an older loader drops the manifest field it has never heard of and would then run you with a `woc.data` that rejects.

There is deliberately **no base URL**: the name you pass is checked against the list you declared, never joined onto a URL. A name you did not declare rejects, and the message names the ones you did.

The value is `unknown`, for the same reason `storage.get` is: nothing validates the shape. The loader checks the file parses as JSON at install and nothing more. You get the **same object** on every call, so treat it as read-only.

## fmt

Pure formatting functions that draw nothing, safe to call from a frame handler and from your first line alike.

```js
woc.fmt.duration(94);             // '2m', the single-unit form a bar's corner holds
woc.fmt.duration(94, 'coarse');   // '1m 34s', the two-unit form a list row wants
woc.fmt.titleCase('aimed_shot');  // 'Aimed Shot'
woc.fmt.count(4, 'item');         // '4 items', and '1 item' for one
woc.fmt.compass(-90);             // the arrow for a turn to your left
```

**`fmt.duration` always rounds up**, so a countdown never reads 0 while the thing is still running: 0.2 seconds left reads as `1`. `59.5` reads as `60` rather than `1m`, because the minute branch is chosen on the raw value before rounding. A negative is not clamped, so `duration(-5)` is `-5`; clamp it yourself if you want a floor.

`timer` is the default: one unit, no decimal, and no unit mark under a minute, which is what a row of counting figures reads best as. `coarse` is the two-unit form, `2d 3h` through `1h 4m` and `4m 12s` down to `45s`.

**Before you swap your own duration formatting for this one, work out the largest value your input can reach.** `coarse` carries four tiers, so it reads `3d 0h` where a body with no day tier reads `72h 0m`, and they differ only above the ceiling the smaller body was written for. A persisted timestamp has no ceiling, and a duration from game content has whatever ceiling a release gives it. If the wider shape is wrong for you, keep your own formatting rather than clamping the input.

**`fmt.titleCase` is a last resort and belongs on screen as one.** Ids and display names have diverged across abilities, items and mob templates, so it answers "Arcane Shot" for the ability the game calls Fell Shot. Reach for it only after every route to a carried name has come back empty, and say on screen that you did.

**For an ABILITY id, do not call it at all.** `world.abilities.describe` is the route: it looks the id up in your spellbook, falls back to this same derivation only when that comes back empty, and tells you in `known` which of the two you got. `titleCase` is for everything with no index behind it: a gathering node, a quest objective, a key out of a table your own addon ships.

`fmt.count` takes `plural` for an irregular noun. `fmt.compass` is eight arrows in eight 45-degree sectors with the forward arrow straight ahead, in the same convention `world.bearingTo` answers in, so the two compose. A bearing from outside the range is normalised rather than refused, and anything that is not a finite number answers the forward arrow rather than putting `undefined` in a text node.

## The rest of woc

```js
woc.settings['max-rows']        // your declared settings, hydrated before line one
woc.onSettingsChange(rebuild);
woc.onDispose(() => observer.disconnect());
woc.paint(draw, { frame })      // returns the function you call to ask for a redraw
woc.addon                       // your own id, name and version
woc.game                        // channel and version of the deployment
woc.now()                       // monotonic ms, for measuring an interval
woc.wallClock()                 // epoch ms, for anything you store
```

`woc.addon` reports your own version without repeating it from the manifest. `woc.game` tells you which deployment you are on.

There are two clocks and picking the wrong one fails silently. `woc.now` is monotonic milliseconds, counted from this page load, and is right for a cast bar, a swing timer or a rate. `woc.wallClock` is epoch milliseconds, the same reading `Date.now` gives, and is right for the two things that cross a page load: a timestamp you are going to store, and a comparison against a stamp the server sent absolute, such as `GroupInfo.lockouts`. [Patterns](/docs/patterns) has the trap in full.

`woc.setTimeout`, `woc.setInterval` and `woc.requestAnimationFrame` are the timers, with their matching cancel functions. Use them rather than the page's: [Patterns](/docs/patterns) covers why, and what `woc.onDispose` is for.

### Your settings are already the type you declared

`woc.settings` is hydrated before your first line runs and is total over what your manifest declares. Every declared setting is present, of its declared type, finite if it is a number, clamped into the `min` and `max` you gave it, and one of the options a `select` still offers. A stored value that is none of those falls back to your declared default, and so does a missing one.

So `woc.settings['max-rows']` is a number you can do arithmetic with, and this is dead code:

```js
// Every line of this is unreachable. Delete it.
const rows = typeof woc.settings['max-rows'] === 'number' ? woc.settings['max-rows'] : 10;
```

Read the setting and use it. An id you did NOT declare reads as `undefined`: that is a bug in your manifest, and the fix is to declare it. `woc.onSettingsChange` hands you the same object again after the player changes anything, with the same guarantees.

Keep `default` inside your own `min` and `max`: the validator refuses a manifest whose default is out of range.

Brackets always work, and a hyphenated id cannot be dotted at all. The addons in this marketplace dot a one-word id (`woc.settings.layout`) only because this repository's linter, Biome's `useLiteralKeys`, demands it.

### Redrawing when something changed

`woc.paint` is a repaint that runs at most once a frame however many times you ask for it. It returns the function you call to ask.

```js
const repaint = woc.paint(draw, { frame });

woc.world.on('inventory', repaint);
woc.net.onEvent('damage', repaint);
```

Anything that changes what a panel says calls it, and the panel is drawn once on the next frame however many things changed.

**Pass your `frame` and a hidden panel stops drawing.** A request made while that frame is hidden is held rather than performed: nothing is drawn while nobody is looking, and one repaint runs on the first frame after the panel comes back, so it returns current rather than stale. However many requests arrived while it was away, that is still one repaint. It costs one boolean read per frame while a repaint is owed, since a frame publishes `visible` and no change event.

**`{ frame }` is only safe when your handler ONLY paints.** A handler that also does bookkeeping stops doing it while the panel is closed, which is most of a session, and nothing reports it. Split the bookkeeping out and give this the drawing, or leave the frame out and let the repaint run.

It rides the loader's own loop and stops when your addon is disabled; asking after that does nothing. While the loader is frozen nothing is drawn and requests coalesce exactly as they do behind a hidden frame, so one repaint runs when it resumes.

It is not the answer for a figure that moves on its own. A countdown wants `woc.setInterval`, and a bar animating every frame wants `woc.onFrame`. This is for a panel that changes when something happens.
