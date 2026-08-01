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
woc.world.bags            // the bag sockets, an item id or null each
woc.world.bagCapacity     // total slots; used slots is inventory.length
woc.world.copper          // money
woc.world.zone            // the zone name the game is displaying
```

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
woc.world.professions     // craft and gathering skill counters
```

All three ride your own self payload, so they exist for **you and nobody else**: there is no way to read another player's sheet, and that is the game's decision rather than an omission here.

`character` carries `xp`, `lifetimeXp` (which keeps rising past the cap), `restedXp`, `prestigeRank`, `honor`, `lifetimeHonor`, `renown`, `milestones`, the `deeds` you have earned with the day each landed, and a `deedStats` block of lifetime counters. `activeTitle` is a **deed id**, never display text, so it identifies your title rather than spelling it: the deed table is content an addon cannot reach.

A counter at 0 in `deedStats` genuinely means it never happened. That is worth saying because it is unusual on this API, where a zero often means a field nobody writes. Here the client fills the whole set from defaults and the server sends every counter it keeps.

`talents` gives you the build itself: `rows` maps a row level to the option chosen on it, so counting its entries is how many points are spent.

`professions` is deliberately just the two skill counter maps. The game's professions facet also carries a state view and a crafting identity block, both marked as stubs in its own source with work still in flight, so their shape is the least settled thing an addon could build on.

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
```

`mine` is the filter a dot tracker needs and the one most often forgotten. Two players can carry the same debuff on one target, and without it a display shows a full timer while your own effect quietly expires.

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

`ui.frame` is a light HUD panel and `ui.window` is a full one with a body that fills. Both take `density: 'comfortable' | 'compact' | 'bare'`. Comfortable is the default: 16px labels on a 40px minimum, the tap-target floor the game itself holds to. Compact gives that floor up deliberately, for a dense readout you glance at rather than operate.

`bare` removes the chrome altogether: no panel behind your content, no padding, no title bar. Reach for it when the thing on screen IS your content, a row of timers floating on the HUD rather than a panel holding them.

```js
const overlay = woc.ui.frame({ id: 'timers', title: 'Timers', density: 'bare', save: true });
```

Two things follow from having no title bar, and both are deliberate. The frame is dragged by **its own content** instead, with buttons and fields inside it left clickable, so bare suits a readout rather than a form. And `ui.window` ignores it and stays comfortable: a window's close button lives in the title bar, and a panel the player cannot dismiss is worse than one drawn more heavily than it asked for.

Keep the `title` even so. It is not drawn, but it is the frame's accessible name, and it is the label the loader shows while frames are unlocked.

**A bare frame can be invisible, and that is what the unlock mode is for.** An overlay whose content is a list of timers has no pixels at all while nothing is running, which is exactly when a player wants to position it. Pressing `Alt+U`, or flipping "Unlock frames" at the top of the manager's Installed pane, outlines and labels every addon frame, gives an empty one a minimum size, and makes the whole outline draggable. Turning it off puts everything back.

You get that for free: it is one mode on the loader's root, so any frame you create takes part without asking. It is also why you should not build your own idle placeholder before trying it.

### Laying out against your own frame

`resizable: true` puts the box in the player's hands, and `onMove` tells you where it ended up. The loader owns that box: it writes the position, and the size of a resizable frame, and it re-clamps both when the viewport changes and when a saved box is restored, so this is the only account of it you can trust.

```js
woc.ui.frame({ id: 'strip', resizable: true, height: 40, onMove: (box) => scaleTo(box.h) });
```

Use it rather than measuring `frame.el`. A measurement forces a synchronous layout, and a display that scales with its frame would pay for one on every frame it draws. It fires on a drag, on a resize at pointer rate, on the async restore of a saved box, and when the window is resized under you, but never for the initial placement, which is the size you asked for and therefore already hold. A throw inside it is caught and written to your addon's log rather than breaking the gesture the player is in the middle of.

**A frame cannot be dragged smaller than the size it was created at.** So create it at the smallest you want to allow, and let the player grow it from there.

Cooldown Bars uses the pair for its tile strip: the frame's height is the icon size, and every tile follows it through `size` on `tile.update`. The width is deliberately only room to grow into. Icons sized to fill the width would have to shrink as more cooldowns started, so they would change size in the middle of a fight, which is exactly when a player is picking one out by shape.

`ui.bar` is the loader's timer row, and `ui.tooltip` attaches a description to any element you own:

<!-- include: addons/cooldown-bars/main.js#bar -->

A bar's fill can be tinted by damage school, which is a separate axis from `tone`. Tone is urgency; a school is what kind of damage a row is made of. Where both are set, tone wins.

<!-- include: addons/combat-meter/main.js#school-tint -->

### Timers as squares

`ui.tile` is the same timer in the other shape: the game's art with a radial sweep over it, a countdown on top, and a stack count in the corner.

<!-- include: addons/cooldown-bars/main.js#tile -->

Pick between the two by what carries the meaning. A bar has room for a name, so it suits a list you read; a tile has none, so the art is the label and it suits a strip you glance at, which is what an aura display and a cooldown row are. There is no linear sweep on a tile, because that is `ui.bar`.

`fraction` is what is LEFT, the same as a bar's, and the wedge gives the art back as it runs down. Neither one animates itself: subscribe for the set changing and move `fraction` from a frame loop, which is the pattern the whole world API is built around.

A tile's border takes the same `school` and `tone` axes a bar's fill does. Its square defaults to 40px, the tap-target floor the game holds its own controls to, and `size` gives that up deliberately for a dense strip.

`label` is never drawn. It is how the tile is announced, as one image named for everything it says, since there is nowhere to put a name on a square that is all art. A tile without one is hidden from assistive technology rather than announced as a bare number.

Cooldown Bars offers both under a `layout` setting, which is worth reading as the worked example: the two widgets take the same `{el, update, destroy}`, so everything between the builder and the screen is written once and only two things branch. A charge count goes in a bar's figure and in a tile's corner, and a tile's countdown loses its decimal because 40 pixels will not hold "119.4s".

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

Per-character state is keyed on realm plus character name rather than on the session's entity id, which is reissued every login.

## The rest of woc

```js
woc.settings['max-rows']        // your declared settings, hydrated before line one
woc.onSettingsChange(rebuild);
woc.onDispose(() => observer.disconnect());
woc.addon                       // your own id, name and version
woc.game                        // channel and version of the deployment
```

`woc.addon` is how an addon reports its own version in its UI without repeating it from the manifest. `woc.game` tells you which deployment you are on, for the rare feature that differs between live and pbe.

`woc.setTimeout`, `woc.setInterval` and `woc.requestAnimationFrame` are the timer half, and their cancel functions pair with them as you would expect. Use them rather than the page's: [Patterns](/docs/patterns) covers why, and what `woc.onDispose` is for.
