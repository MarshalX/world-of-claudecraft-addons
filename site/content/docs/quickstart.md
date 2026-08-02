---
title: Quickstart
order: 1
summary: A running addon in about five minutes, without a build step, reloading on every save.
---

An addon is a directory with a manifest and one plain JavaScript file. There is no bundler, no framework, and no toolchain. The loader fetches your file, evaluates it, and hands it a `woc` object.

## Make the directory

Two files, next to each other. The directory name and the `id` have to match.

```json addons/hello-world/addon.json
{
  "id": "hello-world",
  "name": "Hello World",
  "version": "1.0.0",
  "apiVersion": 1,
  "author": "you",
  "description": "A window that counts the damage you take.",
  "entry": "main.js",
  "permissions": ["net.read", "ui", "keys", "sound"],
  "keybinds": [{ "id": "toggle", "label": "Show or hide", "default": "Alt+KeyH" }]
}
```

## Write the addon

<!-- include: site/content/examples/minimal.js#whole -->

That is the whole file. Note what is **not** in it: no export, no registration call, no import of `woc`, and no cleanup. The file is evaluated as a function body with `woc` already in scope, and everything the API creates is torn down for you when the addon is disabled.

## Run it

```sh
pnpm dev
```

That starts the watch build and a local marketplace on port 5180. In the game, open **Addons**, go to the **Dev** tab, and turn the local dev server on. Your addon appears in **Browse**; install it and enable it.

Turn the reload switch on as well, and a save is a reload: the loader polls each running local addon and re-evaluates only the ones whose file actually changed. There is no page refresh.

Nothing about that path is special-cased. Your addon is fetched, validated, evaluated and disposed exactly the way one from a published marketplace is, so an addon that works against the dev server works once it is published.

## What to read next

[The manifest](/docs/manifest) is every field and which one you cannot change later. [Patterns](/docs/patterns) is the four things nobody derives from the API surface, and it is the page worth reading before you write anything substantial.

Every addon in [the catalog](/addons) is a real example, and none of them is a demonstration: each one is a single file a player installs to use. `cooldown-bars` is the one to read first, because it is small enough to read in a sitting and it teaches the one thing that is not obvious. `combat-meter` is deliberately bigger. `dev-harness` is the odd one out and is worth knowing about while you work: it exercises every API surface against a live game and reports what it found, which is how a loader change gets checked in the game rather than only in a test.
