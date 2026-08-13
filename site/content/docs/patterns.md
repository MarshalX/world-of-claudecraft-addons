---
title: Patterns
order: 4
summary: The things nobody derives from the API surface, each learned the expensive way.
---

Everything on this page is invisible in a signature. Most of it shipped as a bug first.

## Subscribe for the set, animate from the read

`world.on('cooldowns')` tells you **which** cooldowns are running. It deliberately does not fire as a number counts down, because at frame rate that would be a handler call per ability per frame reporting something nobody acts on.

So the subscription decides which bars exist, and a frame loop decides how full each one is:

<!-- include: addons/cooldown-bars/main.js#subscribe-and-animate -->

An addon written the other way round has one of two bugs. Redraw only in the handler and the bar sits perfectly still for the whole cooldown. Drive the fill from the handler's own timer and it restarts every time the set changes.

The same shape applies to anything that animates: subscribe for the change, animate from the read.

## The guard you are about to write around a setting cannot fire

This one is measured rather than argued. Fifteen of the sixteen addons in this marketplace shipped a helper like this, and between them called it 64 times:

```js
// Dead code. Every one of the 64 call sites resolved to the manifest default.
function settingNumber(id, fallback) {
  const value = woc.settings[id];
  return typeof value === 'number' ? value : fallback;
}
```

Not one of those fallbacks could ever be reached. The loader hydrates `woc.settings` from your manifest before your first line runs and the result is total over what you declared: present, of the declared type, finite if it is a number, clamped into your declared range, and one of the options a `select` still offers, with your own default standing in wherever storage held something that was none of those. So `woc.settings['max-rows']` is a number you can divide by.

Fifteen authors wrote it anyway, which is the interesting part: nothing on the surface says the coercion happened, and defensive code around an unknown-shaped read is the correct instinct everywhere else on this API. It is wrong here, and only here, because this is the one input the loader has already validated against a schema you wrote.

Read the setting. The case actually worth a check is the opposite one, an id your manifest does not declare, which reads `undefined` and is a bug in the manifest rather than a value to defend against.

## A field can be declared, readable, and never sent

The game builds every entity with defaults and fills in whatever the snapshot carried. A field the server never sends is therefore **present, of the right type, and holding that default for the entire session**. Nothing throws. Nothing warns.

`inCombat` is the worked example. It is on the entity, it is a boolean, and it is never on the wire, so it reads `false` forever. The first version of the combat meter used it to decide a fight had ended, concluded that every fight had ended, and reset the total on every hit.

The published types mark which fields ride the self record and omit the ones that are never sent, but the types are a claim about another repository rather than a derivation from it. When a value matters, check it against a live session before you build on it.

## You never write cleanup, but you do write `woc.onDispose`

Everything the API creates goes into a disposal bag: frames, subscriptions, key bindings, timers, sounds, tooltips. Disabling an addon drains it.

What is not covered is anything you made yourself. Enable and disable are fully hot, with no page reload, so a bare `setInterval` keeps running against DOM the loader has already removed.

```js
const observer = new MutationObserver(update);
observer.observe(target, { childList: true });
woc.onDispose(() => observer.disconnect());
```

Use `woc.setTimeout` and `woc.requestAnimationFrame` rather than the page's, and register anything else with `woc.onDispose`.

## A position is a live object, not a reading

The game mutates an entity's `pos` in place rather than replacing it. So this does not do what it looks like:

```js
const start = woc.world.player.pos;        // NOT where you are now
// ... later ...
const moved = Math.hypot(woc.world.player.pos.x - start.x, woc.world.player.pos.z - start.z);
```

`start` is the same object `woc.world.player.pos` is, so it moves with you and `moved` is always 0. Copy the components when you want a point to keep meaning that point:

```js
const start = { x: pos.x, y: pos.y, z: pos.z };
```

The same holds for anything else you keep out of the world: `prevPos`, an aura list, a party row. Reading is a plain read of the client's own objects, which is what makes the API cheap, and the price is that a reference is a subscription rather than a snapshot.

## Redrawing a list moves every row in it

`appendChild` on an element that is already in the document does not leave it where it is. It removes it and inserts it again. So the obvious way to redraw a sorted list moves every row on every repaint, including the ones that did not move:

```js
// Removes and re-inserts all forty rows to correct the order of two of them.
for (const row of sorted) parent.appendChild(row.el);
```

The churn is the smaller cost. The one that bites is that **a browser drops an element's hover state when it is removed, and fires no leave event for it**. Anything attached to that row on hover is then stranded: as far as the browser is concerned the pointer was never over it, so moving away produces nothing.

`woc.ui.list` is the answer, and this is the failure it was built out of. Eleven addons had each written the same reconcile pass by hand, and the part every one of them wrote identically was the lifecycle: destroy what left, build what arrived, paint everything, and move a row only when it is not already in that slot. Describe one row, hand `sync` the whole set in the order you want it, and a sync that changes nothing writes nothing to the document at all.

Two things about it are judgement rather than API, which is why they are here as well as on [the API page](/docs/api).

**Key on the thing, never on where it sits.** `key: (item) => item.id` is what lets a row survive a reorder. Keying on the array index recreates every row that moved, which is the bug above wearing a different hat.

**Hold more than you draw, with `shown`, rather than slicing before you sync.** A cooldown display keeps every running cooldown and draws the ten soonest ready. Slice first and the eleventh row is destroyed, so when it comes back it is a new row with nothing measured: an addon that learned a cooldown's real length by watching it now has to baseline from the middle of the cooldown it is already in, and it draws a fill that is confidently wrong. Pass everything to `sync` and answer false from `shown` instead, and the row stays alive off screen with what it measured. That is the difference between a missing row and a wrong one.

Cooldown Bars does both, and its whole list is now the declaration:

<!-- include: addons/cooldown-bars/main.js#list -->

`sync` then takes every running cooldown, soonest ready first, and `shown` decides how many of them are on screen.

The loader now takes a tooltip down when the pointer moves anywhere its anchor is not, so the stranded tooltip above is handled for you. The fact underneath it has not changed: an element you move is an element that loses whatever the browser was tracking about it, and the cheapest move is the one you do not make.

## Reuse the kit before styling your own

Give a button `class="woc-btn"` or a tab `class="woc-tab"` and it is drawn at your frame's density with the loader's hover and focus treatment, rather than an imitation of it.

Do not hand-roll a timer row either. `woc.ui.bar` is one: an icon, a name that truncates, a fill behind both, and a right-aligned figure in tabular figures so the digits do not shuffle as they count down.

<!-- include: addons/cooldown-bars/main.js#bar -->

The combat meter hand-rolled inline button styles first, and the two addons ended up drawing the same row two slightly different ways. That is what the kit exists to prevent.

## An event's ability is a name, not an id

An event's `ability` field is a display **name**, not an ability id. Every `damage` and `heal2` emit fills it from `ability.name`. `spellfx` carries an id, and `castStart` carries an id **or an activity sentinel**: a fixed marker naming a timed activity rather than any ability, such as `gathering` or `crafting`. The set grows with the game, so match the sentinels you care about by name and let anything you do not recognise fall through as an ability id, rather than enumerating them and assuming your list is complete. A sentinel never resolves in `world.abilities` and never has icon art. The declared type is `string | null` for both, so nothing tells you which you have.

This shipped a bug: the meter built an icon URL from the field and asked the game for `Measured Shot.webp`. An id is only safe to assume where the field is a map **key**, as in `cooldowns` and `abilityCharges`, or where the emit site says `.id`.

Healing has its own version of the same trap:

<!-- include: addons/combat-meter/main.js#heal-attribution -->

## An item's art name is not the item's name

`woc.ui.icon.itemArtName(id)` answers the name the item's icon FILE was filed under. That is provenance metadata for the art, and the game gates it on being non-empty and on nothing else, so it drifts every time content is renamed and the art is not. Measured against game 0.33.0: of the 303 items whose art carried a name, 281 agreed with the game's own display name and 21 did not. `baked_bread` was filed as "Freshly Baked Bread" while the game called it "Cottage Loaf".

It now answers for far less. The manifest keeps a name only for a curated entry, and game 0.36.0 moved the catalogue into unnamed generated batches, taking 307 named entries down to 39 reagents and bags. All 39 agree with the game today. That is not a reason to promote it: nothing in the game compares the two, so the next content rename can put them back out of step with nothing to announce it.

So it is a labelled fallback and never the item's name. Showing it beside the game's own tooltip is worse than showing nothing, because it looks like an answer. Nothing on this API can give you an item's real name: the item table is bundled into the game's own chunk and is not served. The one authoritative spelling that reaches a client is `itemName` on a loot roll.

`woc.ui.icon.item(id)` is a different matter and is exact. The game serves a manifest of which item ids ship a file, so the builder returns null once it knows there is none rather than handing you a URL that 404s. Weapons used to be permanently absent from it and are not any more: game 0.36.0 gave every authored weapon its own painting, and at that release every item in the game ships a file. Still write the null branch. Art is commissioned behind content, so an item can ship before its picture does, and the gap empties and refills with every release. A heroic weapon variant is the one case that looks like a gap and is not: it ships no file of its own and the loader answers with its base weapon's painting, which is what the game draws for it too.

Until the manifest has been read the answer stays optimistic, so the first grid you draw is never worse off than it was before the manifest existed. `await woc.ui.icon.preloadItems()` first when a flash of broken images on the first paint would be worse than a frame's delay. It is one request for every item in the game.

## Progress past the level cap is on a different field

`character.xp` is progress within the CURRENT level, and it is frozen at 0 once you hit the cap. The game returns before touching that bar for a capped character and zeroes the remainder on the award that dings you to the cap, so a capped character reads 0 there for the rest of the character's life. It is the obvious field to reach for and it is the wrong one.

`character.lifetimeXp` is the counter that carries post-cap progression. It is credited on every award including at the cap, which is what makes virtual levels work, and it is monotonic across the whole life of the character. A post-cap display reads that and computes its own virtual level from it.

`character.restedXp` is sent every snapshot, so you can watch the pool rise and infer that the player is resting. Two honest limits: at low level the accrual is slow enough that the integer sits still for twenty seconds at a time, so a still counter is not proof of anything; and at the cap the pool is frozen outright, so it is not readable at all for exactly the players a post-cap addon is drawing. There is no resting FLAG on any surface, and there is no way to derive one: it needs the player's combat state and the game's own inn footprints, and neither is reachable.

## Two clocks, and only one of them survives a reload

`woc.now()` is monotonic milliseconds, the same clock `performance.now` reads. It starts at zero when the page loads, it never jumps, and it is the right clock for anything measuring an interval: a cast bar, a swing timer, a rate.

`woc.wallClock()` is epoch milliseconds, the same clock `Date.now` reads. It is the right clock for exactly two things, and both of them cross a page load: a timestamp you are going to store, and a comparison against a value the server sent as an absolute stamp. `GroupInfo.lockouts` is the second kind, and its own documentation says to compare it against `Date.now()`.

Storing a `woc.now()` reading is the trap. It is a number of milliseconds since **this** page load, so on the next one it is a stamp in the future by however long the last session ran, and nothing raises. Three addons written in one batch each worked this out separately, which is why it is written here.

## A subscriber that waits hears nothing

An addon that reads another addon's bus topic has to work with no publisher at all, because the publisher may not be installed, may be switched off, or may simply not have anything to say yet. There is no request-response on the bus and there never will be, so there is nothing to await and no timeout anyone chose.

The convention that works: emit `<topic>:ask` once, render immediately without an answer, upgrade the display if answers arrive, and never treat silence as an error. A publisher answers an ask by emitting its topic as usual.

`woc.bus.publish` and `woc.bus.follow` are those two halves with the parts named, and they are what to reach for rather than writing the dance again. `follow` emits the ask for you, once, and `publish` answers it by calling your `produce`. Everything below is what those two put on the wire, which is also what an addon written before they existed is already speaking.

Subscribe with `woc.bus.anySender` unless you genuinely mean one specific installation. Naming `official/lorebind` is correct only on the official marketplace: the same addon installed from a fork publishes under a different fqid, and a subscriber that hardcoded the source silently stops working for everyone not on it.

If you want to say in your manifest that you work better with another addon, that is `companions`. It is a note the manager draws, not a dependency: it gates nothing and waits for nothing.

## The topics addons already publish

There is no namespace on the bus and no registry the loader enforces. A topic is a bare string, so two addons picking the same name with different payloads is a collision nobody is warned about, and the only defence is writing down what the shipped ones use. This is that list. Read it before naming a topic, and treat a name on it as taken.

`from` is stamped by the loader from the publisher's own fqid and the message is frozen, so a sender cannot claim to be somebody else. What it can do is publish a payload that is not the shape below, so validate before you use it: every consumer here drops a bad row rather than throwing, because one malformed entry in a batch must not cost the other eight hundred.

| Topic | Published by | Payload |
|---|---|---|
| `zone` | `wayfarer` | `{ place, id, name, levelRange }` |
| `zone:ask` | anyone | nothing |
| `item` | `lorebind` | one item record |
| `items` | `lorebind` | an array of them, the whole table at once |
| `items:ask` | anyone | nothing |
| `item:ask` | anyone | nothing, and see below: this is the older spelling |
| `alert` | `emberwatch` | `{ ruleId, unit, auraId, state }` |

**`zone`** is one shape in every state, never an object-or-null. `place` is `'zone'`, `'instance'`, `'nowhere'` or `'unknown'`, and `id`, `name` and `levelRange` are all null unless it is `'zone'`. The four are worth telling apart: `'instance'` means the player is in a dungeon, an arena or a delve, where a zone filter has nothing to say; `'nowhere'` means a point the publisher's rectangles do not cover; `'unknown'` means it cannot answer yet, which is every session's first seconds and is not a fact about where anybody is standing. A consumer that reads only `typeof payload.id === 'string'` and ignores the rest is correct and will stay correct. `levelRange` is `{ min, max }`.

**`item`** carries `{ id, name, source }` plus whichever of `quality`, `kind`, `slot`, `sellValue`, `itemLevel` and `requiredLevel` the publisher actually knows. Fields are absent rather than null when unknown, because an item table is learned a piece at a time. **`items`** is the batch form and is what an ask is answered with: a publisher holding a whole table sends it as one message rather than one emit per row. Subscribe to both. A consumer subscribed to `item` alone hears its own catch-up answered and takes nothing out of it, which looks exactly like a publisher that is not installed.

**The item protocol has two ask names for one release, and this is the only place that says so.** It was written before `publish` and `follow` existed and it named its ask `item:ask` while what an ask actually triggers is a re-emit of `items`. `follow('items', ...)` derives `items:ask` from the topic, so the two names now both mean the same request. `lorebind` answers both: `items:ask` because that is what `publish` listens for, and `item:ask` with one extra line, kept so that an addon speaking the shipped protocol does not go quiet on the release that migrated it. Use `items:ask`. Do not build anything new on `item:ask`, and expect it to go one release later.

The incremental `item` topic has no ask half at all and never did. It is a push, one row at a time as the publisher learns them, so `follow` is the wrong tool for it and a plain `on` with `bus.anySender` is the right one.

**`alert`** fires on an aura rule matching. `state` is `'active'` when the rule is met and `'cleared'` when it stops being met, so a consumer can pair them; `unit` is a unit key rather than an entity id.

If you are adding a topic, prefer a noun for the fact and let `publish` and `follow` name the ask, publish one shape in every state rather than a payload that vanishes, and add the row here in the same change. The loader ships no topic constants and will not: these names are content, and a loader that owned them would own a protocol it has no way to keep true. This table is the registry, and it is editorial rather than enforced.

## The global cooldown's length is computable, and the obvious version is wrong

`player.gcdRemaining` counts down. It does not say what it counted down **from**, and a bar needs the length to draw a fill.

Every input is published, so you can compute it exactly. Three things the version most people write gets wrong, and each of them is visible on screen:

- **A rogue's base is 1.0 seconds, not 1.5.** Getting this wrong is a denominator that is a third too large on every rogue in the game.
- **There is a 0.75 second floor.** Without it a well-hasted caster's bar reports a global shorter than any the game will ever give them.
- **Haste auras add on top of the `spellHaste` stat, and the divisor is `1 + haste`.** Dividing by `spellHaste` itself is wrong in form as well as in the aura term.

```js
// The global cooldown's LENGTH, which `player.gcdRemaining` counts down from.
function gcdLength(player, cls) {
  let haste = player.spellHaste;
  for (const aura of player.auras) {
    if (aura.kind === 'buff_spellhaste') haste += aura.value;
  }
  const base = cls === 'rogue' ? 1.0 : 1.5;
  return Math.max(0.75, base / (1 + Math.max(0, haste)));
}
```

There is no subscription for this and there should not be: it is four published fields and one expression, and an addon that wants it wants the number rather than an event.

## The swing timer cannot be computed, only observed

The melee swing period looks like the same kind of arithmetic and is not. It divides by `meleeHaste`, which is a third stat that is **not on the wire**, and `spellHaste` cannot stand in for it.

The game's own comment says set-bonus haste is one stat, so the two are equal. That is true of the shared term and false of the total: two melee specs carry a 10 percent `meleeHastePct` that never reaches `spellHaste`. So substituting is exactly 10 percent low on the specs whose swing bar matters most, which is a bar that finishes early on every single swing. Ranged is worse: it divides by `rangedHaste`, a third stat again.

What works is to seed and then correct:

```js
// Seed from what IS published: the weapon's cadence, times every slow on you.
function seedPeriod(player) {
  let period = player.weapon?.speed ?? 2.0;
  for (const aura of player.auras) {
    if (aura.kind === 'attackspeed' || aura.kind === 'sanguine') period *= aura.value;
  }
  return period;
}
```

Then watch the remaining time. A remaining that goes **up** is the swing landing and re-arming, and the interval between two of those is the real period, exact from the second swing onward. The seed is what you draw until then, and folding the slow auras in makes it right in the one case a bare `weapon.speed` is visibly wrong.

## Some numbers are not on the surface at all, and guessing one is worse than saying so

The combo point maximum is the clearest case. It is an inline literal in the award path, it is not a named constant, not on a content table, not class-conditional, and not sent. The game's current cap is 5 and its own interface draws a fixed strip rather than reading a maximum from anywhere.

So do not hardcode 5. Size a strip to the largest count you have **seen this session** and say in the tooltip that that is what you are doing. A hardcoded number reads as authoritative and is silently wrong the release it changes; a learned one is right by construction and admits what it is.

## Ranking effects is your addon's judgement, not a fact you can look up

`world.harmful(aura)` answers the one part of "how bad is this" that is a fact: whether the effect works against the unit carrying it. It runs the game's own classification, over a full aura or a party row, so a dot with a positive per-tick figure and a root carrying zero both answer true.

Severity is not a fact and there is no API for it. The game itself ranks effects three different ways for three different surfaces, and one of those rankings is keyed on ability **id** rather than kind, because two abilities can share a kind and belong in different tiers: a major defensive cooldown and a passive maintenance buff both arrive as `buff_dodge`, and only the id separates them. Any severity attached to a kind puts those two in the same tier by construction.

A healer triaging under pressure wants control ranked above damage. A damage-taken display wants the reverse, and is also right. Keep your ranking short, local, and yours:

```js
const PRIORITY = { stun: 0, silence: 1, root: 2, dot: 3 };

function rank(aura) {
  return PRIORITY[aura.kind] ?? 9;
}
```

## Diminishing returns are anchored when the control lands

If you track a diminishing-returns ladder, the reset window starts when the effect is **applied**, not when it fades. The game stamps `landTime + reset` at the moment it resolves the control, and a fresh application re-stamps it from the new land time.

Anchoring at fade puts the expiry a whole duration late: a 10 second polymorph on a 60 second window reads as still diminishing for 10 seconds after the game has cleared it, so a player who trusts the display holds a cast they could have landed at full length.

Four more things a ladder display has to know, all of them the game's own rules:

- **Roots and interrupt lockouts** run 100 / 50 / 25 percent on an 18 second window and then become **immune**. An immune application produces no aura at all, so there is nothing to observe: keep counting the stage you can no longer see.
- **Polymorph** runs absolute seconds, 10 / 5 / 1 on a 60 second window, and **never** becomes immune. It is the only absolute ladder, and it can afford to be: exactly one ability rides it, so the 10 second first rung reads as a deliberate cap on a longer value rather than as a number that fits one ability and no other.
- **Fear** runs 100 / 50 / 25 / 12.5 percent of the ability's own duration, on the same 60 second window, and never becomes immune either. Read it as a multiplier and never as a table of seconds: five abilities across three classes share this ladder, so seconds can only ever be right for one of them. Before game 0.37.1 the game itself had that bug, and every fear in the game lasted 8 seconds on first application whatever its tooltip said.
- **Stuns do not diminish at all**, and do not even stamp a window.
- **It is player versus player only.** A mob never diminishes and is never diminished.
- **An item set can shorten any of them**, on top of whatever the ladder decided and including the stuns the ladder skips. So a duration you compute is what the ability asks for rather than what the target will get, and the target's own reduction is not on the wire.

The ladder's own state is not readable. The entity carries a `ccDr` map and the client builds it empty and is never sent one, which is the trap two sections up wearing different clothes: it is present, it is a Map, and it stays empty for the whole session. A ladder display is therefore something your addon TRACKS from the applications it watches, and it can be wrong in one direction it cannot detect, since an immune application produces no aura to observe.

And death clears the whole ladder, as does an arena or match reset. Drop everything you are tracking for a target when that target dies, or you will report a target as immune to a root that is about to land at full duration.

## The loader runs one frame loop, and you should not always join it

`woc.onFrame(handler)` puts your handler on the animation-frame loop the loader is running anyway. It is one browser callback for the whole loader instead of one per addon, it is dropped rather than queued while the loader is frozen, and it is unsubscribed when your addon is disabled without you writing that. Prefer it over `woc.requestAnimationFrame` re-armed from inside its own handler.

`dt` is milliseconds since the previous frame, 0 on the first, and clamped at 250 so a tab returning from the background does not hand you half a minute to multiply by.

**Join it for anything that has to move smoothly**: a sweep, a bar's fill, a decay curve, an anchor following a point. The loader positions every `ui.anchor3d` after your handler has run, so a point you move here is followed in the same frame rather than the next one.

**Do not join it for a panel whose figures change once a second.** Wayline is the worked example, and it is deliberately on a one-second `woc.setInterval` calling its own draw function: every figure on that panel moves at most once a second, so joining a 60Hz loop would rewrite six identical strings sixty times a second to display nothing new. `woc.paint` would be the wrong answer there too, for the opposite reason: nothing HAPPENS to ask it for a repaint, the figures simply move with the clock. "The loader runs one loop" is not an instruction to put everything in it.

**Keep it running while your frames are hidden**, unless you have a reason not to. `onFrame` does not stand down when your UI is not on screen, which is deliberate: a timer whose window is closed still has to know how much of an 18 second window has elapsed when the window opens again. If your handler is expensive, check whether the frame is visible inside it rather than unsubscribing.

## A panel that changes when something happens is not an animation

The panels above are the minority. Most addon UI does not move on its own at all: it changes when a bag changed, when a fight ended, when a price came in over the bus. Joining the frame loop for that means asking every frame whether anything happened, and the answer is no sixty times a second.

`woc.paint` is the other shape. It hands you a function to CALL when something changed, and draws once on the next frame however many times it was called:

```js
const repaint = woc.paint(draw, { frame });
woc.world.on('inventory', repaint);
woc.bus.follow('prices', (payload) => { prices = payload; repaint(); });
```

Three addons wrote this by hand before it existed, byte for byte: a boolean, a `requestAnimationFrame` armed only when the boolean was clear, and the boolean cleared inside the callback. What none of them wrote is the half that `{ frame }` buys, and one of them wrote a piece of it: a request made while that frame is hidden is held rather than performed, and one repaint runs on the first frame after the panel comes back. So a hidden panel stops drawing and is still correct the instant it returns.

That is not free, and the cost is worth knowing rather than assuming: a repaint owed to a hidden panel keeps a seat on the loader's loop, because a frame publishes `visible` and no change event, so the only way to notice the panel returning is to look once a frame. It is a boolean read, and a panel with nothing owed keeps no seat at all, but a panel closed and never reopened holds one for the rest of the session.

The distinction is worth holding on to, because the three primitives are not interchangeable and the wrong one is invisible in review. Something moving continuously is `woc.onFrame`. A figure that moves on its own clock, like a countdown, is `woc.setInterval`. A panel that changes when the world does is `woc.paint`.

**And `{ frame }` is a fourth decision, about the HANDLER rather than the panel.** Pass it only when the handler does nothing but draw. If it also records something the addon needs whether or not anybody is looking, a closed panel records nothing for the rest of the session and nothing anywhere says so: no throw, no warning, just a table that turns out to be empty when something reads it. Split the recording out and give `paint` the drawing. [The API page](/docs/api) has the two shipped addons that decided this opposite ways and were both right.

## An aura's icon comes from the caster's class, or from nowhere

The game composites every aura icon on a canvas rather than serving files, so there is no `ui.icon.aura`. For an aura a player applied you can usually resolve the ability art instead:

```js
const caster = woc.world.entities.get(aura.sourceId);
const art = caster?.kind === 'player' ? woc.ui.icon.ability(aura.id, caster.templateId) : null;
```

For an aura a mob applied there is nothing to point at, and no version of this API will change that. See [Boundaries](/docs/boundaries) for why.
