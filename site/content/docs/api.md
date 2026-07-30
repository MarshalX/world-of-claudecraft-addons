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

Combat state, all of it read-per-frame rather than pushed:

```js
woc.world.cooldowns       // ReadonlyMap<abilityId, secondsRemaining>
woc.world.auras           // buffs and debuffs on you
woc.world.targetAuras     // and on your target
woc.world.casts           // ReadonlyMap<entityId, EntityCast> for anything casting
woc.world.hazards         // ground effects, with radius and kind
woc.world.markers         // raid markers, by entity
```

`world.cooldowns` is keyed by real ability id, which makes it one of the few places an id is safe to assume. `world.hazards` and `world.markers` are what a positional addon reads.

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

`ui.frame` is a light HUD panel and `ui.window` is a full one with a body that fills. Both take `density: 'comfortable' | 'compact'`. Comfortable is the default: 16px labels on a 40px minimum, the tap-target floor the game itself holds to. Compact gives that floor up deliberately, for a dense readout you glance at rather than operate.

`ui.bar` is the loader's timer row, and `ui.tooltip` attaches a description to any element you own:

<!-- include: addons/cooldown-bars/main.js#bar -->

A bar's fill can be tinted by damage school, which is a separate axis from `tone`. Tone is urgency; a school is what kind of damage a row is made of. Where both are set, tone wins.

<!-- include: addons/combat-meter/main.js#school-tint -->

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
