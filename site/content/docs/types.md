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

The package is versioned against the loader's `apiVersion` rather than against the loader, so its major is the number your manifest declares. It only gets a release when the addon API surface changes, which is why its version does not track the loader's.

## What the types are not

They are a **claim about another repository**, and it is worth holding them that loosely.

The game is not a dependency of this project, cannot be one, and the loader cannot compile against it. So every read of the game's own state is an assertion rather than a derivation, and the type describing it is this project's best understanding of a shape it does not own.

Two things follow.

**A field can be typed, readable, and never sent.** The types mark which fields ride the self record and omit ones known never to appear, but a field the server stops sending would go on type-checking exactly as before. [Patterns](/docs/patterns) has the worked example.

**The runtime checks what the types cannot.** At world entry the loader walks the live player once and reports every field that is missing or of the wrong kind, which is how drift surfaces as a warning rather than as an addon quietly reading a default forever. The manager's **Diagnostics** pane shows what it found.

## Cues and icons

Two of the unions are generated from what the game actually serves: sound cues from its runtime pack, and skill-art ids from its per-class manifests.

Both stay **open** unions. The set is content, a game release adds to it before the published types catch up, and a published type must never be able to break a working addon. So an unknown cue name still type-checks and still plays.
