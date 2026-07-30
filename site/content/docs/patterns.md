---
title: Patterns
order: 4
summary: The four things nobody derives from the API surface, each learned the expensive way.
---

Everything on this page is invisible in a signature. Three of the four shipped as bugs first.

## Subscribe for the set, animate from the read

`world.on('cooldowns')` tells you **which** cooldowns are running. It deliberately does not fire as a number counts down, because at frame rate that would be a handler call per ability per frame reporting something nobody acts on.

So the subscription decides which bars exist, and a frame loop decides how full each one is:

<!-- include: addons/cooldown-bars/main.js#subscribe-and-animate -->

An addon written the other way round has one of two bugs. Redraw only in the handler and the bar sits perfectly still for the whole cooldown. Drive the fill from the handler's own timer and it restarts every time the set changes.

The same shape applies to anything that animates: subscribe for the change, animate from the read.

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

## Reuse the kit before styling your own

Give a button `class="woc-btn"` or a tab `class="woc-tab"` and it is drawn at your frame's density with the loader's hover and focus treatment, rather than an imitation of it.

Do not hand-roll a timer row either. `woc.ui.bar` is one: an icon, a name that truncates, a fill behind both, and a right-aligned figure in tabular figures so the digits do not shuffle as they count down.

<!-- include: addons/cooldown-bars/main.js#bar -->

The combat meter hand-rolled inline button styles first, and the two addons ended up drawing the same row two slightly different ways. That is what the kit exists to prevent.

## A fifth, for anything reading combat events

An event's `ability` field is a display **name**, not an ability id. Every `damage` and `heal2` emit fills it from `ability.name`; only `castStart` and `spellfx` carry `ability.id`. The declared type is `string | null` for both, so nothing tells you which you have.

This shipped a bug: the meter built an icon URL from the field and asked the game for `Measured Shot.webp`. An id is only safe to assume where the field is a map **key**, as in `cooldowns` and `abilityCharges`, or where the emit site says `.id`.

Healing has its own version of the same trap:

<!-- include: addons/combat-meter/main.js#heal-attribution -->
