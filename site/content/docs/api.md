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

`world.entities` is how you find anything you did not already have a reference to: every visible unit keyed by entity id, yours included.

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
```

`world.equipmentInstances` is keyed the same way `equipment` is and is sparse: a plain piece has no key at all, so an absent slot means nothing is on it rather than nothing is worn. It is the untrimmed payload for your OWN gear. The same read off another player's entity, `entity.equippedInstances`, is the public projection the server sends about them: the signer, the enchant and the roll, and nothing else.

Another player's gear is readable too, off the entity rather than off `world`: `equippedItems`, `equippedInstances`, `mainhandItemId`, `offhandItemId`, `weaponSkinId` and `mountKey`. All six are sent for a PLAYER only, so check `entity.kind === 'player'` before reading one: on a mob they exist and hold an inert default. `mainhandItemId` is not `equippedItems.mainhand`, and the difference is real: the server fills it only when the equipped mainhand is a weapon, so read one for what is held and the other for what is worn.

`world.characterKey` is the same identity `woc.storage.character` files its keys under, published so two addons keeping their own per-character records cannot disagree about whose they are. It is OPAQUE: do not parse it. Watch it, because a character switch inside one page load is real.

An item id does not resolve to a **name**, a quality, or any stats. That content ships inside the client bundle and is reachable from nothing the loader can see, so what an id gets you is its icon through `ui.icon.item`, and the ability to tell one item from another. Names arrive only where an event carries one.

`world.zone` is localized display text rather than an id, for the same class of reason: the zone table is content behind a pure function of your position, so the loader reads the game's own minimap label instead. Show it or watch it change; comparing it against a hardcoded string only works for players running your language. Underground it names the delve, because that is what the game puts there. There is no subzone: the game announces a landmark once when you walk into one and never clears it when you leave, so a reading taken from it would name somewhere you left an hour ago.

`bagCapacity` derives from `bags` and has no key of its own, so watch `bags`.

Position comes off the entity rather than the zone, and every entity has it, not just you:

```js
const { x, y, z } = woc.world.player.pos;   // yards: x east-west, z north-south, y height
woc.world.player.facing;                    // radians, 0 is +z
woc.world.player.prevPos;                   // last tick, which the game interpolates from
```

Those are the same numbers the game's own coordinate readout floors for display. `prevPos` is there because the client renders between ticks: comparing it against `pos` tells you which way something is actually moving, which a single sample cannot.

### Your character sheet

```js
woc.world.character       // xp, rested, honor, renown, title, deeds
woc.world.talents         // your build and your saved loadouts
woc.world.professions     // skill counters, your crafting identity, your station
```

All three ride your own self payload, so they exist for **you and nobody else**: there is no way to read another player's sheet, and that is the game's decision rather than an omission here.

`character` carries `xp`, `lifetimeXp` (which keeps rising past the cap), `restedXp`, `prestigeRank`, `honor`, `lifetimeHonor`, `renown`, `milestones`, the `deeds` you have earned with the day each landed, and a `deedStats` block of lifetime counters. `activeTitle` is a **deed id**, never display text, so it identifies your title rather than spelling it: the deed table is content an addon cannot reach.

A counter at 0 in `deedStats` genuinely means it never happened. That is worth saying because it is unusual on this API, where a zero often means a field nobody writes. Here the client fills the whole set from defaults and the server sends every counter it keeps.

`talents` gives you the build itself: `rows` maps a row level to the option chosen on it, so counting its entries is how many points are spent.

`professions` carries the two skill counter maps, your crafting `identity`, and the `mobileStation` you have placed. **Read `identity.synced` before anything else on it.** The client seeds `craftSkills` and the whole identity with defaults and replaces them only when the server's first crafting value lands, so until that flag flips an all-zero reading is "nothing has arrived yet" rather than "this character has no craft skill", and the two are otherwise identical. `identity.knownRecipes` is what you LEARNED from a source, which is not the set you can craft: a recipe whose `acquisition` list is empty is grandfathered, known to everyone, and absent from that list for that reason.

One member of the game's own professions facet is still left out. Its state view is marked as a stub in its own source with work still in flight, so its shape is the least settled thing an addon could build on.

`level` is not here, and not because it was left out: the game writes it on the entity record rather than on the self payload, so it is `world.player.level`. That is worth more than a copy here would be, because it means every entity carries one and you can read a mob's level or another player's the same way.

### The group, the run, and threat

```js
woc.world.group           // loot rolls you owe an answer, master loot, lockouts
woc.world.encounter       // the instanced run you are inside, and your clears
woc.world.threat(id)      // one mob's hate table, measured against you
```

`threat` is the server's own threat model rather than anything derived on the client, so a pull warning built on it agrees with the decision the mob is about to make:

```js
const table = woc.world.threat(woc.world.target.id);
if (table.share !== null && table.share > 0.9) warn('about to pull');
```

The table is capped at its top eight rows, so it tells you who is about to pull and cannot tell you where the twentieth person in a raid stands. It exists only for a **mob in combat**, so an empty reading means "not fighting" or "not a mob", never "everyone is at zero". Being absent from a table is not the same as being at zero on it, so `mine` is `null` in the first case.

**The two kinds of time on this API meet here**, and the difference is not cosmetic. A loot roll's `remaining` is seconds, like every other timer: the game sends a deadline on its own sim clock, which nothing hands an addon, so the loader tracks that clock off the snapshot and does the subtraction for you. It is `null` only in the window between your addon starting and the first snapshot arriving. A raid lockout is the opposite: an absolute epoch millisecond stamp, published exactly as sent, because that form survives a reconnect and compares directly against `Date.now()`.

A loot roll is also one of the few places an item id arrives with a readable `itemName` beside it.

`encounter` is deliberately narrow: which run, how far through, and whether it is over. The game's own run record also carries module lists, objective state, affixes and rite state, and that is content moving faster than anything else this API reads, so an addon written against the wide shape would break on an update to a corner of it nobody was using. `world.raw` is there if you need the rest.

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

The ground, and what died on it:

```js
woc.world.deathZones      // lethal rings on a rift boss floor
woc.world.corpses         // ReadonlyMap<entityId, CorpseView>, everything lootable near you
woc.world.corpseLoot(id)  // one corpse, filtered to what YOU could take
woc.world.nodeCooldowns   // gathering node id to seconds until you can harvest again
woc.world.corpse          // where your own body lies while your spirit is a ghost
```

`world.deathZones` is deliberately not a `Hazard`. A hazard's geometry rides the snapshot and is complete for everything near you; a death zone is mirrored from a spawn event and counted down on your own client, so a zone placed before you came into range is missing and stays missing. The game's own rings have the same hole.

`world.corpses` is what to watch for a corpse becoming lootable, because that is a field change on an entity that already existed and so is invisible to `world.on('entities')`. Use `world.corpseLoot(id)` rather than `entity.loot` for anything you draw: the wire carries a corpse's whole contents to every player in range, personal slots included, and the game's own loot window filters on read. The unfiltered list shows people things they cannot have.

`world.nodeCooldowns` is per player rather than shared, so a node another player just took is still yours to take. A node with no entry is ready.

Competitive play and the group finder:

```js
woc.world.match           // the bout you are in, discriminated on `format`
woc.world.arena           // your standings, your queue, the live ladders
woc.world.finder          // your dungeon finder state
woc.world.finderBoard     // the realm's open premade listings
```

`world.match` is one union over every format, a duel included, so you ask what kind of bout this is rather than reading two unrelated members. Everything but a duel is UP TO TEN SECONDS OLD: the arena key is gated to 0.1 Hz on the server, which is the game's own cadence. A Fiesta ring drawn from it agrees with the ring the game draws; a Yumi health bar does not, and the type says which events carry the live figures.

`world.arena` is present for every character whether or not they have ever played, so a non-null reading says nothing on its own. Only the two ranked brackets mean anything: the unranked three carry a copy of the 2v2 record and an empty ladder.

`world.finder` and `world.finderBoard` are reads and nothing more. Neither can join a queue, answer a proposal, create a listing or accept an applicant.

The counters you walk up to, and the two badges that outlive them:

```js
woc.world.market          // the Merchant's book, one browsed page
woc.world.mail            // the Ravenpost mailbox
woc.world.bank            // the deposit box
woc.world.marketCollectPending  // gold or goods waiting at the Merchant
woc.world.mailUnread      // delivered letters you have not read
woc.world.buyback         // what you sold to a vendor and can still take back
```

The first three exist only while you are STANDING at the counter, so they answer a status rather than a value:

```js
const market = woc.world.market;
if (market.status !== 'near') return;      // 'away', or 'unknown' before entry
for (const row of market.info.listings) { /* ... */ }
```

That shape exists because the obvious alternative is a bug. On a nullable value the reading everyone writes is `world.market?.listings ?? []`, which answers the empty array BOTH when the filter matched nothing and when you are nowhere near a Merchant. Those are opposite facts, and an addon that confuses them reports an empty market to a player standing in a town. On the closed arms there is no `listings` to reach for, so the wrong reading cannot be written.

`world.marketCollectPending` and `world.mailUnread` are deliberately not inside them: a badge exists for the moment you are NOT at the counter, so both stream everywhere. `world.mail` carries its own `unread` over the same letters, which is the mailbox pane's figure; do not derive either from the other. `world.buyback` is ungated too, most recent first, because standing at a vendor is what lets you use the ring rather than what lets you see it.

There is no price history anywhere and there never was: the server keeps no record of a completed sale and offers no query for one. A price series is something your addon builds, by recording each page its player browses.

`world.abilities` is how you get between an ability's id and its display name, which have diverged: skill art is filed under `arcane_shot`, while a combat event names it `Fell Shot`. Without this you can hold one and never reach the other.

```js
// an event gave you a name; get the id, and then the art
const info = woc.world.abilities.byName(event.ability);
const url = info && woc.ui.icon.ability(info.id, woc.world.player.templateId);

// a cooldown map gave you an id; get something worth showing a player
const label = woc.world.abilities.byId(id)?.name ?? id;
```

It covers YOUR OWN known kit, so an ability a mob casts is not in it and `byName` answers null. It is empty rather than absent before world entry, and its `cost`, `castTime` and `cooldown` are resolved after your talents rather than the ability's base figures.

`world.combat` is the one reading here the game does not send. There is no combat flag for you on the wire, so the loader answers from the best signal available and tells you which one it used:

```js
woc.world.on('combat', ({ active, source }) => {
  if (active) meter.begin();
});
```

`source` is `party` when you are grouped, since the server sets a combat flag per member; `threat` when a nearby mob's hate table has you on it, which is server state too; `pvp` when a hostile player has you selected; and `recent` when none of those answered and damage involving you landed in the last five seconds. Only that last one is a guess. Most addons can ignore the source entirely; read it when acting on a false positive would be worse than acting late.

There IS an `inCombat` field on the entity and it is never written, so it reads false forever. That is not an oversight in this API, it is the reason this reading exists.

### Naming a unit

```js
woc.world.unit('target');        // the same Entity world.target gives you
woc.world.unit('targettarget');  // what your target is fighting
woc.world.unit('pet');           // your companion
woc.world.unit('party1');        // the first group member who is not you
```

`world.unit` resolves a unit the way an addon thinks about one, and `targettarget` is the reason to use it rather than writing the lookup yourself. A mob does not carry `targetId`: the server fills that field from a SELECTION, and a mob does not select, so on every mob it is present, correctly typed, and permanently null. What a mob is fighting rides `aggroTargetId` instead. The resolver reads whichever field the target's kind actually fills, so a target-of-target display works on the units it is usually pointed at.

`partyN` counts the other members, so `party1` is the first person who is not you; `raidN` counts everyone including you. Both resolve to an **entity**, which means both answer null for a member too far away to have one even while `world.party` still lists them. For a raid display read the party rows, which are complete, and reach for an entity only when you need something a row does not carry.

### Filtering auras

```js
const mine = woc.world.aurasOn('target', { mine: true, kind: 'dot' });
const debuffs = woc.world.partyAuras(pid, { debuff: true });
woc.world.harmful(aura);            // is this working against whoever carries it
woc.world.dispellable(aura);        // can you remove it off an ally
woc.world.dispellable(aura, true);  // ...or strip it off an enemy
```

`mine` is the filter a dot tracker needs and the one most often forgotten. Two players can carry the same debuff on one target, and without it a display shows a full timer while your own effect quietly expires.

`world.harmful` and `world.dispellable` are functions rather than fields on the aura, and that is worth knowing rather than working around: the loader hands you the game's own aura objects rather than copies, so a field could only exist by writing onto state the game's HUD reads from the same array, or by copying every aura on every read, which would break the object identity you use to track one effect across frames. `world.harmful` accepts a party row as well as a full aura. `world.dispellable` refuses a row, because a row carries neither a school nor the encounter-control flag and those are the two clauses whose absence costs a player a global cooldown.

Crafting content, which is authored rather than live:

```js
woc.world.recipes         // the game's own recipe table, copied and frozen
woc.world.stations        // the authored crafting stations
```

Both are copies, because the game renders its own crafting window from the originals. Neither is a watch key and neither will become one: content cannot change during a session, so a subscription would walk the whole table on every snapshot to report that nothing moved. What actually changes is on `world.professions`, including which of these recipes you have learned.

`partyAuras` is separate because a party row's auras are a smaller shape than an entity's: an id, a kind, whole seconds, and a debuff flag, with no source. That is also why `PartyAuraQuery` has no `mine`, rather than one that silently matches nothing.

```js
woc.world.on('cooldowns', rebuild);
await woc.world.ready;
```

`world.on` subscribes to a key changing. `world.ready` resolves at world entry; before it the world is empty rather than absent, so an addon can subscribe and prepare at document-start and simply see nothing yet.

Subscriptions report a **set changing**, never a number moving. That distinction is the first item in [Patterns](/docs/patterns) and it is the one thing most likely to make an addon look broken.

`world.game` is version and realm information about the deployment you are on.

## ui

Windows, and the pieces that go in them.

<!-- include: addons/cooldown-bars/main.js#frame -->

`ui.frame` is a light HUD panel and `ui.window` is a full one with a body that fills. Both take `density: 'comfortable' | 'compact' | 'bare'`. Comfortable is the default and is the scale the game draws its own windows at on a desktop: 13px tabs and buttons under a 15px panel title. Compact is tighter still, for a dense readout you glance at rather than operate.

Neither gives up the tap-target floor. The loader restores 16px type on a 40px target under `@media (pointer: coarse)`, whichever density you picked, which is where the game keeps its own floor too. The one thing that defeats it is writing a `font-size` or `min-height` onto a kit control yourself: an inline style beats every stylesheet rule, so hand-sizing a control opts it out of that floor on a phone. Change the padding instead.

`bare` removes the chrome altogether: no panel behind your content, no padding, no title bar. Reach for it when the thing on screen IS your content, a row of timers floating on the HUD rather than a panel holding them.

```js
const overlay = woc.ui.frame({ id: 'timers', title: 'Timers', density: 'bare', save: true });
```

Two things follow from having no title bar, and both are deliberate. The frame is dragged by **its own content** instead, with buttons and fields inside it left clickable, so bare suits a readout rather than a form. And `ui.window` ignores it and stays comfortable: a window's close button lives in the title bar, and a panel the player cannot dismiss is worse than one drawn more heavily than it asked for.

Keep the `title` even so. It is not drawn, but it is the frame's accessible name, and it is the label the loader shows while frames are unlocked.

**A bare frame can be invisible, and that is what the unlock mode is for.** An overlay whose content is a list of timers has no pixels at all while nothing is running, which is exactly when a player wants to position it. Pressing `Alt+U`, or flipping "Unlock frames" at the top of the manager's Installed pane, outlines and labels every addon frame, gives an empty one a minimum size, and makes the whole outline draggable. Turning it off puts everything back.

You get that for free: it is one mode on the loader's root, so any frame you create takes part without asking. It is also why you should not build your own idle placeholder before trying it.

### What your frame takes away from the player

Your frame is over a world the player is still playing, and the game binds the world's `mousedown` and `wheel` to its canvas. An element on top of that does not merely cover a click: it takes the whole gesture, so selecting a target, holding right to turn the camera and scrolling to zoom all stop working inside your frame's box, and nothing can hand them on afterwards. The size of your frame is the size of the hole you have made in the controls.

`pointer` is how you shrink it, and it defaults to the right thing: `'content'` on a bare frame, `'auto'` everywhere else.

```js
const strip = woc.ui.frame({ id: 'timers', density: 'bare', pointer: 'content' });
```

- `'auto'` is the whole box, chrome, padding and empty space included. Right for a panel the player operates, and for anything with a form in it.
- `'content'` makes the box transparent and leaves what you DREW taking the pointer. The gaps between your rows, the padding, and the dead width beside a short row all fall through to the world; your rows keep their hover, their tooltip and their clicks.
- `'none'` is inert. Nothing in the frame can be hovered or clicked, which also means no tooltips: the browser has no way to watch a pointer that is passing through.

The one thing to hold on to is how you then grab it. With `'content'` you grab the frame by something it drew, so a drag over a row moves it and a drag over empty space goes to the game; with `'none'` there is nothing to grab at all. The unlock mode is the way in for both, and hands the whole frame back to the pointer for as long as it is on, which is what it is for.

### Where your frame sits

Frames are drawn UNDER the game's own windows and over the world. Opening the game menu, the bags, the map or the spellbook covers your frame, and that is deliberate: a frame is HUD furniture, and a window the player just opened should be in front of it. The price is that the game's chat and action bars cover it too.

What the loader draws ON TOP of everything is what the player opened or what it raised itself: the manager, a `ui.menu`, a `ui.toast`, a `ui.alert`, a `ui.banner`, and the tooltip on your own row. So a warning that has to be seen belongs in a banner or a toast rather than in a frame you hope is not covered.

### Laying out against your own frame

`resizable: true` puts the box in the player's hands, and `onMove` tells you where it ended up. The loader owns that box: it writes the position, and the size of a resizable frame, and it re-clamps both when the viewport changes and when a saved box is restored, so this is the only account of it you can trust.

```js
woc.ui.frame({ id: 'strip', resizable: true, height: 40, onMove: (box) => scaleTo(box.h) });
```

Use it rather than measuring `frame.el`. A measurement forces a synchronous layout, and a display that scales with its frame would pay for one on every frame it draws. It fires on a drag, on a resize at pointer rate, on the async restore of a saved box, and when the window is resized under you, but never for the initial placement, which is the size you asked for and therefore already hold. A throw inside it is caught and written to your addon's log rather than breaking the gesture the player is in the middle of.

A frame that is NOT resizable, which is every frame unless you ask, is held to the `width` you declared and its height is whatever it is holding. That is the shape a HUD readout wants, since its text changes and a fixed height would leave it padded out one moment and clipped the next.

The width is a width in both directions, and the second one is the reason. Without it the panel is sized by its content, so it moves whenever the content does: a header that gains a clause steps the whole frame out and pulls it back when the clause goes, rows reflowing, exactly while the player is doing the thing that changed the text. A long note wraps inside your column instead, and a short one leaves the box where it was. Omitting `width` does not opt out of this; it takes the default.

**By default a frame cannot be dragged smaller than the size it was created at.** That catches people out, so it is worth stating plainly: `width: 400` is also a floor of 400 unless you say otherwise. Say otherwise with `minWidth` and `minHeight`, and cap the other end with `maxWidth` and `maxHeight`.

```js
woc.ui.frame({ id: 'strip', resizable: true, width: 400, height: 40, minWidth: 120, maxHeight: 96 });
```

Where the four disagree, the order is fixed: a frame is never taken below the size at which it could no longer be grabbed, the viewport beats your minimum so a frame asking to be wider than the screen can still fit one, and your minimum beats your maximum. State only the axis you mean; the other is left alone.

Cooldown Bars uses the pair for its tile strip: the frame's height is the icon size, and every tile follows it through `size` on `tile.update`. The width is deliberately only room to grow into. Icons sized to fill the width would have to shrink as more cooldowns started, so they would change size in the middle of a fight, which is exactly when a player is picking one out by shape.

`ui.bar` is the loader's timer row, and `ui.tooltip` attaches a description to any element you own:

<!-- include: addons/cooldown-bars/main.js#bar -->

A bar's fill can be tinted by damage school, which is a separate axis from `tone`. Tone is urgency; a school is what kind of damage a row is made of. Where both are set, tone wins.

### Items, and the colour a player reads them by

A row or a square that is an ITEM takes a third axis, `quality`, and it is the one a player picks an item out of a grid by before reading a word of it. A bar colours its label and a tile colours its border, which is what the game does with an item's name and an item's icon, down to the two palettes it keeps for the two of them and the soft glow it gives epic and legendary.

```js
row.update({ label: 'Ashstalker Cowl', quality: 'epic', icon: woc.ui.icon.item('ashstalker_cowl') });
cell.update({ icon: woc.ui.icon.item('ashstalker_cowl'), quality: 'epic' });
```

There is no way to pass a colour, for the reason there is none for a school: two addons drawing an epic should draw the same purple, and it should be the purple in the player's own bags. For an element you drew yourself, a chip or a heading or a name in a panel of your own, the same six colours are on the class `woc-quality-<tier>`, which you may put on anything you own, exactly as you may reuse `woc-btn` and `woc-tab`.

Nothing in the loader knows an item's quality: the game's item table is bundled into its own chunk and is served nowhere. So a tier is something you got from somewhere, which today means a `LootRoll` off `world.group`, a record another addon published on the bus, or a table your own addon ships. Null, and anything outside the six tiers, colours nothing, which is the honest answer for the 96 items the game ranks at no tier at all and for an id you have not looked up.

### Money

Every amount the game sends is counted in copper. Give a bar's `value` an amount instead of a string and it is drawn the way the game draws money: a coin per unit, empty units left out, and the whole figure announced in words to a screen reader, which the discs alone would not be. `prefix` is for a figure that has to say what it is, since a bare amount at the end of a row reads as the price.

```js
row.update({ label: 'Copper Ore', value: { copper: 4400, prefix: 'low' } });
```

`woc.ui.money(copper)` is the same split as text, for a tooltip line or anywhere else that takes no markup: `7s 80c`, with the empty units left out. Use it rather than dividing by 100 twice in your own file, so that a price in your addon is spelled like a price in everyone else's.

<!-- include: addons/combat-meter/main.js#school-tint -->

### What a hovered row says

`ui.tooltip` takes a string, which is what it always took, or the whole tooltip: a title, an icon from `ui.icon`, and lines that each carry a tone.

<!-- include: addons/cooldown-bars/main.js#tooltip -->

You never write dismissal. The loader takes a tooltip down on leave, on blur, when its anchor is removed from the document, and when the pointer moves anywhere the anchor is not. The last two exist because the first two do not fire in cases addons hit constantly, which [Patterns](/docs/patterns) covers.

**Pass a function when the answer changes.** It is called at the moment the tooltip is shown, so a row reports the numbers under the pointer rather than the numbers it was built with, and the content is assembled for the one row being hovered instead of for every row on screen. Both shipped addons do this: the meter's rows carry their full breakdown, and a cooldown says how much is left and whether it even knows the ability's full length.

The tones are `default`, `muted`, `good`, `warn` and `danger`, and they say what a line MEANS rather than how loud it is. They are not a bar's tones: a fill can only express urgency, while a line can be flavour text, a cost, or a requirement you do not meet.

Everything is written as text and never as markup, because an ability name and a player name both reach you from the wire.

### Timers as squares

`ui.tile` is the same timer in the other shape: the game's art with a radial sweep over it, a countdown on top, and a stack count in the corner.

<!-- include: addons/cooldown-bars/main.js#tile -->

Pick between the two by what carries the meaning. A bar has room for a name, so it suits a list you read; a tile has none, so the art is the label and it suits a strip you glance at, which is what an aura display and a cooldown row are. There is no linear sweep on a tile, because that is `ui.bar`.

`fraction` is what is LEFT, the same as a bar's, and the wedge gives the art back as it runs down. Neither one animates itself: subscribe for the set changing and move `fraction` from a frame loop, which is the pattern the whole world API is built around.

A tile's border takes the same `school`, `tone` and `quality` axes a bar has, with the same order between them: a tone or a school wins the border over a tier. Its square defaults to 40px, the tap-target floor the game holds its own controls to, and `size` gives that up deliberately for a dense strip.

`label` is never drawn. It is how the tile is announced, as one image named for everything it says, since there is nowhere to put a name on a square that is all art. A tile without one is hidden from assistive technology rather than announced as a bare number.

Cooldown Bars offers both under a `layout` setting, which is worth reading as the worked example: the two widgets take the same `{el, update, destroy}`, so everything between the builder and the screen is written once and only two things branch. A charge count goes in a bar's figure and in a tile's corner, and a tile's countdown loses its decimal because 40 pixels will not hold "119.4s".

### Your own settings pane

`ui.field` is the four labelled controls the manager's own forms are drawn with, and `ui.tabs` is its tab strip. Reuse them and a form inside your frame answers to that frame's density and matches the game, with no palette copied into your addon.

`ui.field.select` is NOT a native `<select>`, and that is worth knowing because it is the one control where the browser's own version is unusable here: a select's popup is drawn by the operating system, outside the document, in the system font and beyond styling, so it opens as a white system list in the middle of a dark fantasy HUD. What you get instead is a button and the loader's own menu, with the chosen row in the game's accent. The game replaced its own selects for the same reason. Nothing about the API changed: the same `{label, value, options, onChange}` in, the same `{el, value, set, destroy}` out.

```js
const window_ = woc.ui.field.slider({ label: 'Rolling window', value: 5, min: 1, max: 60,
  onChange: (next) => woc.storage.set('window', next) });
pane.appendChild(window_.el);
```

Every field hands back the same four things: `el` to place, `value()` to read, `set()` to move it, and `destroy()`. **`set` does not call your handler back** — it is what a reset button and a reload use, and a setter that reported itself would write the value it was just given straight back to storage.

The four are `checkbox`, `select`, `slider` and `text`. A checkbox puts its label beside the box and the other three put it above, which is not a style choice: a checkbox reads as a sentence with a box in front of it. A slider shows its number, because a range input on its own says nothing about where it is. A text field reports as you type rather than on blur, so a value abandoned by closing the window is not silently lost.

`ui.tabs` is separate from the family because tabs are navigation rather than a value the player is setting, and only one of those is worth persisting. The loader owns the strip; which pane it reveals is yours.

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

The reason this is in the loader rather than in your addon is the **dismissal**. A menu has to close on select, on Escape, on a click anywhere else including one a game control swallows, and when your addon is disabled with it open. Every one of those listens to something you do not own, and hand-rolling it gets three of the four right.

There is one menu for the whole loader and opening a second closes the first. An item can be `disabled`, and `separator` draws a rule above it, ignored on the first item where it would draw a lid on the menu instead.

`checked` says an item is the one currently chosen: it is drawn in the game's accent and announced as a radio rather than as a command, which is what turns a menu of actions into a menu of choices. Put it on EVERY item of such a menu rather than only on the chosen one, or a reader is told about one radio button and a list of commands. `ui.field.select` is built on exactly that.

### Over a point in the world

`ui.anchor3d` hands you an element the loader keeps positioned over a world point: nameplates, ground markers, a target arrow, a pin on a gathering node.

```js
const plate = woc.ui.anchor3d(() => woc.world.target?.pos ?? null, { offset: { y: -40 } });
plate.el.className = 'my-nameplate';
plate.el.textContent = 'Bog Bloat';
```

Pass a fixed point for something that does not move, or a **function** for something that does, and the anchor follows it without your addon running a loop. Returning null hides it, which is the honest answer for a unit that has despawned.

It hides itself when the point is behind the camera, when it is off screen by more than `margin`, and whenever the game cannot be asked at all, which includes every moment before world entry. Your element is centred on the point, so `margin` defaults to 64 rather than 0: an element centred on a point that has just left the edge is still half on screen.

This is the only surface here that reads the game's **renderer** rather than its world model, and it is the reason it cannot be written in an addon. Every anchor shares one frame loop, and a frame in which nothing moved on screen writes nothing at all, so a camera nobody is turning costs you nothing.

### Saying something

```js
woc.ui.toast('Ready to pull');
woc.ui.banner('Deathless Rage', { kind: 'danger', size: 'large', detail: 'interrupt it' });
const choice = await woc.ui.alert({ title: 'Reset?', buttons: ['Reset', 'Cancel'] });
```

Three weights, and picking the wrong one is the usual mistake. `ui.toast` is a passing line at the top of the screen for something that happened. `ui.banner` is the centre-screen warning, for the one thing a player must read within a second: there is one slot for the whole loader and a new banner replaces whatever is up, including another addon's, because stacking warnings would cover the fight the warning is about. `ui.alert` is a modal that asks a question and resolves to the button pressed, or to null if the addon is disabled while it is open.

Anything read at the player's own pace belongs in a frame instead.

### Getting into the game's own chrome

```js
woc.ui.microButton({ label: 'Meter', icon: '...', onClick: () => panel.toggle() });
woc.ui.menuEntry({ label: 'My Addon', onClick: () => panel.show() });
```

`ui.microButton` adds a button to the game's micro rail, next to the menu button. `ui.menuEntry` adds a row to the Game Menu itself. Both return an unsubscribe, and both survive the HUD rebuilding itself.

### Art

`ui.icon` builds paths into the game's own art: `ability(id, cls)`, `mob(templateId)`, `item(itemId)`. Not every ability ships painted art, and the ones that do not have no URL at all, so `ability()` returns null once the loader knows. A bar hides its own icon slot when an image fails to load, which makes passing a possibly-absent URL the intended usage rather than something to guard.

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

`sound.cues` is the live list, which is what to check against rather than the published union: the union is generated from a deployment and stays open precisely because a game release adds to it first. `sound.preload` matters when the first play has to be on time.

## storage

Your addon's own key-value store, namespaced to your id and separate from the loader's settings and window state.

```js
await woc.storage.set('history', rows);
const rows = await woc.storage.get('history', []);
await woc.storage.delete('history');
const saved = await woc.storage.keys();
```

`storage.get` takes a fallback, so a first run needs no special case. `storage.keys` lists what you have stored, which is what an addon offering its own "clear my data" control needs.

### One character at a time

`storage.character` is the same four calls, scoped to whoever is logged in. Use it for anything a player would be surprised to find shared between their tank and their alt: a layout, a threshold, a list of what this character has seen. Keep `woc.storage` for a preference that is really about the player.

```js
await woc.world.ready;
await woc.storage.character.set('layout', { x: 20, y: 40 });
```

It is its own store rather than a view over the other one, so `layout` here and `layout` above are two different values and `keys()` on either answers only about itself. The key is derived from the realm and the character name, never from the session's entity id, which is reissued every login: keyed on that, everything would scatter across a fresh set of keys each time and read to the player as nothing ever having been saved.

**A read waits for the character. A write refuses to.** Your first line runs at document-start, on the landing page, where nobody has logged in yet. A read called there simply settles later, at world entry, with the data of whoever actually logged in, which is the answer you wanted whichever character that turns out to be. A write cannot do that, because its value was decided when you called it: held until world entry, it would store something computed before anyone knew whose it was against whichever character the player then picked. So it rejects, and the error says to await `world.ready` first.

## bus

Publish and subscribe between addons, inside this page. An addon is one file with no imports and no shared libraries, so this is the only way two of them cooperate.

```js
// in the meter
woc.bus.emit('totals', { top: 'Fell Shot', dps: 812 });

// in the display, a different addon
woc.bus.on('official/combat-meter', 'totals', ({ payload }) => draw(payload));
```

That is the case it exists for: a meter that publishes its totals lets somebody else write the display without forking the meter, and a boss addon that publishes a phase lets three cosmetic addons react to it.

**You name the publisher you are listening to, not just a topic.** Two addons can both publish `totals` without being confused for each other, and nobody can take a name by publishing under it first. Pass `bus.anySender` when any publisher will do, and read `message.from` to see who it was. That field is stamped by the loader from the sending addon's id: a sender cannot set it, change it, or claim to be someone else, which is what makes it worth deciding anything on.

Three more things shape what you can build on it. You never receive your own messages, because self-delivery is how a loop starts. Delivery is synchronous, inside your `emit` call, so keep handlers cheap and never assume one ran: nobody may be listening, and the addon you are talking to may not be installed. And there is no request-response, deliberately: awaiting a reply from an addon that may be disabled, may never have been installed, or may simply not answer is a hang with no timeout anyone chose. Publish both ways instead.

A throw in your handler is logged against your addon and does not stop the message reaching anyone else. Everything you publish stays in this page and never reaches the network, but treat it as readable by every other installed addon.

## data

A JSON file shipped in your own addon directory, for a table that has no business being pasted into your source.

```json
{ "data": ["items.json"] }
```

```js
const items = await woc.data('items.json');
```

Declare the file in `addon.json` and the loader fetches it when the player installs you, caches it beside your code, and hands you the parsed value here. Enabling your addon is never a network call, a marketplace that goes offline does not take your table with it, and a file you regenerate is a file in your diff rather than a region rewritten inside `main.js`.

Up to eight files, each under half a megabyte, each a `.json` beside your `main.js`. It needs `apiMinor` 2, because an older loader drops the manifest field it has never heard of and would then run you with a `woc.data` that rejects.

There is deliberately **no base URL**. Nothing in your addon performs the request, so there is nothing to point somewhere it should not go: the name you pass is checked against the list you declared, never joined onto a URL. A name you did not declare rejects, and the message names the ones you did.

The value is `unknown`, for the same reason `storage.get` is: nothing validates the shape. The loader checks the file parses as JSON at install and nothing more. You get the **same object** on every call, so treat it as read-only.

## The rest of woc

```js
woc.settings['max-rows']        // your declared settings, hydrated before line one
woc.onSettingsChange(rebuild);
woc.onDispose(() => observer.disconnect());
woc.addon                       // your own id, name and version
woc.game                        // channel and version of the deployment
woc.now()                       // monotonic ms, for measuring an interval
woc.wallClock()                 // epoch ms, for anything you store
```

`woc.addon` is how an addon reports its own version in its UI without repeating it from the manifest. `woc.game` tells you which deployment you are on, for the rare feature that differs between live and pbe.

There are two clocks and picking the wrong one fails silently. `woc.now` is monotonic milliseconds, counted from this page load, and is right for a cast bar, a swing timer or a rate. `woc.wallClock` is epoch milliseconds, the same reading `Date.now` gives, and is right for the two things that cross a page load: a timestamp you are going to store, and a comparison against a stamp the server sent absolute, such as `GroupInfo.lockouts`. [Patterns](/docs/patterns) has the trap in full.

`woc.setTimeout`, `woc.setInterval` and `woc.requestAnimationFrame` are the timer half, and their cancel functions pair with them as you would expect. Use them rather than the page's: [Patterns](/docs/patterns) covers why, and what `woc.onDispose` is for.
