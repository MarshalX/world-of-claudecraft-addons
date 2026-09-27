# @woc-addons/types

TypeScript definitions for the [World of ClaudeCraft](https://worldofclaudecraft.com) addon API: the `woc` global your addon is handed.

You do not need this to write an addon. Addons are plain JavaScript with no build step, and the loader neither reads nor cares about types. This package exists so your editor can tell you what `woc.world.player` is before the game does.

## Install

```sh
npm install --save-dev @woc-addons/types
```

Then one line at the top of your addon:

```js
/// <reference types="@woc-addons/types" />
```

That is the whole setup. `woc` is declared as a global, so nothing is imported and your file stays a plain script the loader can evaluate.

## What you get

```js
/// <reference types="@woc-addons/types" />

woc.net.onEvent('damage', (event) => {
  // event is the game's damage event
});

woc.world.on('cooldowns', (cooldowns) => {
  // cooldowns is a ReadonlyMap<string, number>, typed from the key
});

const player = woc.world.player; // Entity | null, null before world entry
```

`net.onEvent('castStart')` fires for a PLAYER cast, a pet's cast and the timed activities the game runs through the same machinery, and never for a mob: a mob's mechanic sets its cast state directly, so a boss mod built on that event receives silence and cannot tell it from a boss that never casts. `world.casts` and `world.on('casts', ...)` are what to read instead.

The world types describe a game this package cannot compile against, so they are a claim about it; the loader checks them against the running game once per session and reports anything that has moved. What is declared is narrower than what the game carries, because most entity fields are server-internal and never reach a client. Anything left out is still reachable through `world.raw`, which is `unknown` because the game promises nothing about it.

Sound cues are generated from the deployed game's own pack, so `woc.sound.play` autocompletes the real names. The union stays open, because a game release adds cues before these types catch up.

## Versioning

The major tracks the loader's `apiVersion`, the compatibility contract the loader enforces: an addon declaring `"apiVersion": 1` runs on any loader that speaks API 1, and `@woc-addons/types@1.x` is what describes it. A breaking change to the addon API is an `apiVersion` bump and a major here, together.

Minors add surface. Patches fix a declaration that was wrong about the loader.

## Links

- [Repository and addon guide](https://github.com/MarshalX/world-of-claudecraft-addons)
- [The full surface](https://github.com/MarshalX/world-of-claudecraft-addons/blob/main/packages/types/index.d.ts)
