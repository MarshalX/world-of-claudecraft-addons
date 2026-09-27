---
title: Types
order: 7
summary: What @woc-addons/types is, what it is not, and how it is checked.
---

The full `woc` surface is typed and published to npm, so an addon written in a plain `.js` file gets autocomplete and errors with no build step.

## Using them

```sh
npm install --save-dev @woc-addons/types
```

Then one comment at the top of your entry file:

```js
/// <reference types="@woc-addons/types" />
```

That is all. There is nothing to import, because `woc` is a global in your addon's scope rather than a module.

## What version to use

The package is versioned against the loader's `apiVersion`, so its major is the number your manifest declares. It is released only when the addon API surface changes.

## What the types are not

They are a **claim about another repository**. The loader cannot compile against the game, so every type describing the game's state is this project's best understanding of a shape it does not own. Two things follow.

**A field can be typed, readable, and never sent.** The types mark which fields ride the self record and omit ones known never to appear, but a field the server stops sending would go on type-checking exactly as before. [Patterns](/docs/patterns) has the worked example.

**The runtime checks what the types cannot.** At world entry the loader walks the live player once and reports every field that is missing or of the wrong kind in the manager's **Diagnostics** pane.

## Cues and icons

Two of the unions are generated from what the game actually serves: sound cues from its runtime pack, and skill-art ids from its per-class manifests.

Both stay **open** unions, because a game release adds to them before the published types catch up. An unknown cue name still type-checks and still plays.
