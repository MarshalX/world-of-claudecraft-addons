---
title: Patterns
order: 4
summary: The things nobody derives from the API surface.
---

Everything on this page is invisible in a signature.

## Subscribe for the set, animate from the read

`world.on('cooldowns')` tells you **which** cooldowns are running. It deliberately does not fire as a number counts down, because at frame rate that would be a handler call per ability per frame reporting something nobody acts on.

So the subscription decides which bars exist, and a frame loop decides how full each one is:

<!-- include: addons/cooldown-bars/main.js#subscribe-and-animate -->

An addon written the other way round has one of two bugs. Redraw only in the handler and the bar sits perfectly still for the whole cooldown. Drive the fill from the handler's own timer and it restarts every time the set changes.

The same shape applies to anything that animates: subscribe for the change, animate from the read.

## The guard you are about to write around a setting cannot fire

```js
// Dead code: this always returns the setting, never the fallback.
function settingNumber(id, fallback) {
  const value = woc.settings[id];
  return typeof value === 'number' ? value : fallback;
}
```

The fallback can never be reached. The loader hydrates `woc.settings` from your manifest before your first line runs and the result is total over what you declared: present, of the declared type, finite if it is a number, clamped into your declared range, and one of the options a `select` still offers, with your own default standing in wherever storage held something that was none of those. So `woc.settings['max-rows']` is a number you can divide by.

Defensive code around an unknown-shaped read is the right instinct everywhere else on this API. It is wrong here because this is the one input the loader has already validated against a schema you wrote.

Read the setting. The case actually worth a check is the opposite one, an id your manifest does not declare, which reads `undefined` and is a bug in the manifest rather than a value to defend against.

## A field can be declared, readable, and never sent

The game builds every entity with defaults and fills in whatever the snapshot carried. A field the server never sends is therefore **present, of the right type, and holding that default for the entire session**. Nothing throws. Nothing warns.

`inCombat` is the worked example. It is sent **for your own record only**, so it is correct on exactly one entity and permanently `false` on every mob, npc and other player. A reading that works while you test it on yourself is silently wrong the moment you point it at a target: an addon that used it to decide a fight had ended would conclude every fight had ended. `world.combat` is the published answer for your own state, and it reports `source: 'self'` when the server's flag is what replied.

The published types mark which fields ride the self record and omit the ones that are never sent, but the types are a claim about another repository rather than a derivation from it. When a value matters, check it against a live session before you build on it.

Others that are never sent, so never build on them:

- `corpseHarvestState` and `craftedCollectionId`.
- `evadeInPlace`, the seconds a mob that cannot reach you in a dungeon or raid room has been held in place. It reads `undefined` on every mob, so a pinned-mob timer built on it never fires. The evade records the mob emits for refused hits are the same `kind: 'evade'` a mob walking home emits, with nothing to tell them apart.
- `lootPartyTradeEligibility`, a raid drop's trade group. It reads `undefined`; nothing about who could have traded a drop is reachable from the corpse.
- The CAST queue (`queuedCastAbility`, `queuedCastAim`, `queuedCastTargetId`). The melee on-next-swing queue IS sent, so "the queue is on the wire" is true of the wrong queue, and a next-cast display built on the cast one stays blank forever.

## A field that IS sent can still lie by being there

The trap above is a field that is never sent. The sharper one is a field that is sent honestly and whose PRESENCE means less than it looks like it means, because nothing removes it when what it describes stops being true.

`instance.partyTrade` on a stack in your own bags is the worked example. A soulbound copy won from party boss loot carries a two-hour window in which it can still be traded to the players who shared the drop, and the marker is real, sent, and correct. What the game does not do is take it off when the window closes: an expired marker is retired only when the character loads or saves, deliberately never on a tick, so a window that lapsed an hour ago is still sitting on the copy in exactly the shape a live one has. An addon that lights a "tradeable" badge off `slot.instance?.partyTrade` lights it forever.

Read the value:

```js
const trade = slot.instance?.partyTrade;
const left = trade ? trade.untilMs - Date.now() : 0;
if (left > 0) {
  // still tradeable, and this is how long for
}
```

`untilMs` is a real epoch deadline, so `Date.now()` is the right clock. The general form is worth carrying past this one field: **whenever a payload field encodes a deadline, a countdown or a claim about the present, ask what removes it.** If the answer is "a boundary the player may not cross for hours", the key is not the answer and the value is.

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

`woc.ui.list` is the answer. It owns the lifecycle: destroy what left, build what arrived, paint everything, and move a row only when it is not already in that slot. Describe one row, hand `sync` the whole set in the order you want it, and a sync that changes nothing writes nothing to the document at all.

Two things about it are judgement rather than API, which is why they are here as well as on [the API page](/docs/api).

**Key on the thing, never on where it sits.** `key: (item) => item.id` is what lets a row survive a reorder. Keying on the array index recreates every row that moved, which is the bug above wearing a different hat.

**Hold more than you draw, with `shown`, rather than slicing before you sync.** A cooldown display keeps every running cooldown and draws the ten soonest ready. Slice first and the eleventh row is destroyed, so when it comes back it is a new row with nothing measured: an addon that learned a cooldown's real length by watching it now has to baseline from the middle of the cooldown it is already in, and it draws a fill that is confidently wrong. Pass everything to `sync` and answer false from `shown` instead, and the row stays alive off screen with what it measured. That is the difference between a missing row and a wrong one.

Cooldown Bars does both:

<!-- include: addons/cooldown-bars/main.js#list -->

`sync` then takes every running cooldown, soonest ready first, and `shown` decides how many of them are on screen.

The loader takes a kit tooltip down when the pointer leaves its anchor, so that case is handled for you. Anything else the browser tracks about an element (hover, focus, a running transition) is still lost when you move it.

## Reuse the kit before styling your own

Give a button `class="woc-btn"` or a tab `class="woc-tab"` and it is drawn at your frame's density with the loader's hover and focus treatment, rather than an imitation of it.

Do not hand-roll a timer row either. `woc.ui.bar` is one: an icon, a name that truncates, a fill behind both, and a right-aligned figure in tabular figures so the digits do not shuffle as they count down.

<!-- include: addons/cooldown-bars/main.js#bar -->

Hand-rolled styles drift: two addons end up drawing the same row two slightly different ways.

## An event's ability is a name, not an id

An event's `ability` field is a display **name**, not an ability id. Every `damage` and `heal2` emit fills it from a name. `spellfx` carries an id, and `castStart` carries an id **or an activity sentinel**: a fixed marker naming a timed activity rather than any ability, such as `gathering` or `crafting`. The set grows with the game, so match the sentinels you care about by name and let anything you do not recognise fall through as an ability id, rather than enumerating them and assuming your list is complete. A sentinel never resolves in `world.abilities` and never has icon art. The declared type is `string | null` for both, so nothing tells you which you have.

Building an icon URL from it asks the game for a file like `Measured Shot.webp`. An id is only safe to assume where the field is a map **key**, as in `cooldowns` and `abilityCharges`, or where the emit site says `.id`.

Healing has its own version of the same trap:

<!-- include: addons/combat-meter/main.js#heal-attribution -->

## An item's art name is not the item's name

`woc.ui.icon.itemArtName(id)` answers the name the item's icon FILE was filed under. That is provenance metadata for the art, and nothing in the game compares it with the display name, so a content rename leaves it out of step with nothing to announce it. It answers only for a small curated set (mostly reagents and bags) and is null for everything else.

So it is a labelled fallback and never the item's name. Showing it beside the game's own tooltip is worse than showing nothing, because it looks like an answer. Nothing on this API can give you an item's real name: the item table is bundled into the game's own chunk and is not served. The one authoritative spelling that reaches a client is `itemName` on a loot roll.

`woc.ui.icon.item(id)` is a different matter and is exact. The game serves a manifest of which item ids ship a file, so the builder returns null once it knows there is none rather than handing you a URL that 404s. Write the null branch: art is commissioned behind content, so an item can ship before its picture does. A heroic weapon variant is the one case that looks like a gap and is not: it ships no file of its own and the loader answers with its base weapon's painting, which is what the game draws for it too.

Until the manifest has been read the answer stays optimistic. `await woc.ui.icon.preloadItems()` first when a flash of broken images on the first paint would be worse than a frame's delay. It is one request for every item in the game.

## Progress past the level cap is on a different field

`character.xp` is progress within the CURRENT level, and it reads 0 for the rest of a character's life once it reaches the cap. It is the obvious field to reach for and it is the wrong one.

`character.lifetimeXp` is the counter that carries post-cap progression. It is credited on every award including at the cap, which is what makes virtual levels work, and it is monotonic across the whole life of the character. A post-cap display reads that and computes its own virtual level from it.

`character.restedXp` is sent every snapshot, so you can watch the pool rise and infer that the player is resting. Two honest limits: at low level the accrual is slow enough that the integer sits still for twenty seconds at a time, so a still counter is not proof of anything; and at the cap the pool is frozen outright, so it is not readable at all for exactly the players a post-cap addon is drawing. There is no resting FLAG on any surface, and there is no way to derive one: it needs the player's combat state and the game's own inn footprints, and neither is reachable.

## Two clocks, and only one of them survives a reload

`woc.now()` is monotonic milliseconds, the same clock `performance.now` reads. It starts at zero when the page loads, it never jumps, and it is the right clock for anything measuring an interval: a cast bar, a swing timer, a rate.

`woc.wallClock()` is epoch milliseconds, the same clock `Date.now` reads. It is the right clock for exactly two things, and both of them cross a page load: a timestamp you are going to store, and a comparison against a value the server sent as an absolute stamp. `GroupInfo.lockouts` is the second kind, and its own documentation says to compare it against `Date.now()`.

Storing a `woc.now()` reading is the trap. It is a number of milliseconds since **this** page load, so on the next one it is a stamp in the future by however long the last session ran, and nothing raises.

## A subscriber that waits hears nothing

An addon that reads another addon's bus topic has to work with no publisher at all, because the publisher may not be installed, may be switched off, or may simply not have anything to say yet. There is no request-response on the bus and there never will be, so there is nothing to await and no timeout anyone chose.

The convention that works: emit `<topic>:ask` once, render immediately without an answer, upgrade the display if answers arrive, and never treat silence as an error. A publisher answers an ask by emitting its topic as usual.

`woc.bus.publish` and `woc.bus.follow` are those two halves: `follow` emits the ask for you, once, and `publish` answers it by calling your `produce`. Use them rather than writing the exchange by hand.

Subscribe with `woc.bus.anySender` unless you genuinely mean one specific installation. Naming `official/lorebind` is correct only on the official marketplace: the same addon installed from a fork publishes under a different fqid, and a subscriber that hardcoded the source silently stops working for everyone not on it.

If you want to say in your manifest that you work better with another addon, that is `companions`. It is a note the manager draws, not a dependency: it gates nothing and waits for nothing.

## The topics addons already publish

There is no namespace on the bus and no registry the loader enforces, so two addons picking one topic name with different payloads collide with no warning. This list is the registry: read it before naming a topic, and treat a name on it as taken.

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
| `mobs` | `longwatch` | the mob rank table, every flagged template at once |
| `mobs:ask` | anyone | nothing |

**`zone`** is one shape in every state, never an object-or-null. `place` is `'zone'`, `'instance'`, `'nowhere'` or `'unknown'`, and `id`, `name` and `levelRange` are all null unless it is `'zone'`. The four are worth telling apart: `'instance'` means the player is in a dungeon, an arena or a delve, where a zone filter has nothing to say; `'nowhere'` means a point the publisher's rectangles do not cover; `'unknown'` means it cannot answer yet, which is every session's first seconds and is not a fact about where anybody is standing. A consumer that reads only `typeof payload.id === 'string'` and ignores the rest is correct and will stay correct. `levelRange` is `{ min, max }`.

**`item`** carries `{ id, name, source }` plus whichever of `quality`, `kind`, `slot`, `sellValue`, `itemLevel` and `requiredLevel` the publisher actually knows. Fields are absent rather than null when unknown, because an item table is learned a piece at a time. **`items`** is the batch form and is what an ask is answered with: a publisher holding a whole table sends it as one message rather than one emit per row. Subscribe to both. A consumer subscribed to `item` alone hears its own catch-up answered and takes nothing out of it, which looks exactly like a publisher that is not installed.

**Use `items:ask`, never `item:ask`.** Both trigger a re-emit of `items` and `lorebind` answers both, but `item:ask` is a deprecated spelling that will be removed.

The incremental `item` topic has no ask half. It is a push, one row at a time as the publisher learns them, so subscribe with a plain `on` and `bus.anySender`, not `follow`.

**`mobs`** answers a question the wire never does: which mob templates the game counts as **elite**, as **bosses**, and as **rare**, plus the gate that hides a template from anybody not on its quest. It comes from a table `longwatch` generates from the game's own content; subscribe instead of shipping a second copy.

A row is `{ id, name }` plus whichever of `rank` (`'elite'` or `'boss'`), `rare` (`true`) and `requiresQuestId` applies. Three things to know. **Absence means false here**, not unknown as it does for `item`: the table is read from the whole of `MOBS`, so an id you do not find in it is an ordinary mob rather than one nobody has looked up. **`rank` and `rare` are separate** because the game's flags are independent and a rare elite is an ordinary thing to be. And **`name` rides every row** because a mob's id and its display name diverge, so title-casing an id prints a name no player will ever see.

**`alert`** fires on an aura rule matching. `state` is `'active'` when the rule is met and `'cleared'` when it stops being met, so a consumer can pair them; `unit` is a unit key rather than an entity id.

If you are adding a topic, prefer a noun for the fact and let `publish` and `follow` name the ask, publish one shape in every state rather than a payload that vanishes, and add the row here in the same change. The loader ships no topic constants.

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

Two melee specs carry a 10 percent melee haste that never reaches `spellHaste`, so substituting finishes the bar early on every swing for exactly the specs whose swing bar matters most. Ranged divides by `rangedHaste`, which is not on the wire either.

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

The combo point maximum is the clearest case. It is an inline literal in the game's award path and is not sent. The game's own interface draws a fixed strip of 5.

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

What else a ladder display has to know, all of it the game's own rules:

- **Roots and interrupt lockouts** run 100 / 50 / 25 percent on an 18 second window and then become **immune**. An immune application produces no aura at all, so there is nothing to observe: keep counting the stage you can no longer see.
- **Polymorph** runs absolute seconds, 10 / 5 / 1 on a 60 second window, and **never** becomes immune. It is the only absolute ladder.
- **Fear** runs 100 / 50 / 25 / 12.5 percent of the ability's own duration, on the same 60 second window, and never becomes immune either. Read it as a multiplier, never as a table of seconds: several abilities across classes share this ladder.
- **Stuns do not diminish at all**, and do not even stamp a window.
- **It is player versus player only.** A mob never diminishes and is never diminished.
- **An item set can shorten any of them**, on top of whatever the ladder decided and including the stuns the ladder skips. So a duration you compute is what the ability asks for rather than what the target will get, and the target's own reduction is not on the wire.

The ladder's own state is not readable. The entity carries a `ccDr` map that is never sent, so it is present, a Map, and empty for the whole session. A ladder display is therefore something your addon TRACKS from the applications it watches, and it can be wrong in one direction it cannot detect, since an immune application produces no aura to observe.

And death clears the whole ladder, as does an arena or match reset. Drop everything you are tracking for a target when that target dies, or you will report a target as immune to a root that is about to land at full duration.

## The loader runs one frame loop, and you should not always join it

`woc.onFrame(handler)` puts your handler on the animation-frame loop the loader is running anyway. It is one browser callback for the whole loader instead of one per addon, it is dropped rather than queued while the loader is frozen, and it is unsubscribed when your addon is disabled without you writing that. Prefer it over `woc.requestAnimationFrame` re-armed from inside its own handler.

`dt` is milliseconds since the previous frame, 0 on the first, and clamped at 250 so a tab returning from the background does not hand you half a minute to multiply by.

**Join it for anything that has to move smoothly**: a sweep, a bar's fill, a decay curve, an anchor following a point. The loader positions every `ui.anchor3d` after your handler has run, so a point you move here is followed in the same frame rather than the next one.

**Do not join it for a panel whose figures change once a second.** Use `woc.setInterval` there: a 60Hz loop would rewrite identical strings sixty times a second. `woc.paint` is wrong there too, since nothing HAPPENS to ask for a repaint; the figures move with the clock.

**Keep it running while your frames are hidden**, unless you have a reason not to. `onFrame` does not stand down when your UI is not on screen, which is deliberate: a timer whose window is closed still has to know how much of an 18 second window has elapsed when the window opens again. If your handler is expensive, check whether the frame is visible inside it rather than unsubscribing.

## A panel that changes when something happens is not an animation

The panels above are the minority. Most addon UI does not move on its own at all: it changes when a bag changed, when a fight ended, when a price came in over the bus. Joining the frame loop for that means asking every frame whether anything happened, and the answer is no sixty times a second.

`woc.paint` is the other shape. It hands you a function to CALL when something changed, and draws once on the next frame however many times it was called:

```js
const repaint = woc.paint(draw, { frame });
woc.world.on('inventory', repaint);
woc.bus.follow('prices', (payload) => { prices = payload; repaint(); });
```

With `{ frame }`, a request made while that frame is hidden is held, and one repaint runs on the first frame after the panel comes back, so a hidden panel stops drawing and is still correct the instant it returns. The cost: a repaint owed to a hidden panel checks visibility once a frame until the panel returns, which for a panel never reopened is the rest of the session.

The three primitives are not interchangeable, and the wrong one is invisible in review. Something moving continuously is `woc.onFrame`. A figure that moves on its own clock, like a countdown, is `woc.setInterval`. A panel that changes when the world does is `woc.paint`.

**And `{ frame }` is a fourth decision, about the HANDLER rather than the panel.** Pass it only when the handler does nothing but draw. If it also records something the addon needs whether or not anybody is looking, a closed panel records nothing for the rest of the session and nothing anywhere says so: no throw, no warning, just a table that turns out to be empty when something reads it. Split the recording out and give `paint` the drawing.

## An aura's icon comes from its own family, then from the caster's class, then from nowhere

`ui.icon.aura` reads the game's aura art manifest. Ask the two builders in the order the game's own resolver does.

```js
// The effect's own painting, for the auras no ability id names: a mob's, an
// encounter mechanic's, a battleground rune's, a set bonus's.
const own = woc.ui.icon.aura(aura.id);

// Failing that, the ability art, which answers for an aura a PLAYER applied.
const caster = woc.world.entities.get(aura.sourceId);
const art = own ?? abilityArtFor(aura, caster);

function abilityArtFor(aura, caster) {
  if (caster?.kind !== 'player') {
    return null;
  }
  return woc.ui.icon.ability(aura.id, caster.templateId);
}
```

`ui.icon.aura` answers null until its manifest has been read, unlike `ability` and `item`, which hand back an optimistic URL. Call `await woc.ui.icon.preloadAuras()` once at start; a row drawn before that lands keeps whatever fallback you gave it and is not redrawn for the icon alone.

Plenty of auras are in neither family and still resolve through nothing, so keep the null branch. See [Boundaries](/docs/boundaries) for what is left behind that line and why.
