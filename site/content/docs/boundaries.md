---
title: Boundaries
order: 6
summary: Read-only, why it is not a temporary state, and what is fair game.
---

The loader is read-only against the game by design. There is no send API, no synthetic input, and no action automation.

## Why

The game's terms prohibit automating play, and it runs a bot detector whose heuristics are not public. An addon platform that could act would put every one of its users at risk of a ban they did not choose, for a capability nobody asked for.

There is no version of this project that ships a send API.

## What is fair game

Everything that reformats, aggregates, or re-presents information the player already has.

- Reading the wire, the world, and the game's own art and audio.
- Drawing anything you like inside the game, with the loader's kit or your own DOM.
- Storing whatever you need, keyed to the character it belongs to.
- Binding keys, and seeing a key press before the game does.

The combat meter is the model: everything it shows was already on the socket, and its whole value is arranging it into a question the game does not answer.

## Where the boundary actually sits

The API is an ergonomic surface, not a security one. Addon code runs in the page realm with the page's globals in scope. It could reach the socket directly. The loader shadows `localStorage`, `WebSocket`, `XMLHttpRequest` and `__game` with proxies that throw and name the sanctioned API, but those are **guardrails against accident, not a sandbox**, and the error messages say so.

So the read-only boundary is a rule the platform holds itself to and reviews for, not a wall the runtime enforces. An addon that broke it would be removed from the official marketplace; nothing stops a third-party source from shipping one, which is exactly why adding a third-party marketplace is presented as a trust decision.

## Two things the loader will not do either

**It never reads `localStorage['woc_session']`**, which holds the account bearer token.

**It redacts outbound frames before any addon sees them.** The client's first frame on every socket carries that same token, and the redaction matches on the field name rather than the frame type, so a game update or a new frame cannot slip one past.

## Two things nobody can build, and why they are not on a roadmap

These come up most often and have no answer on any sanctioned surface: the information is not in the client in a form anything can reach, or not in the client at all.

### The height of the ground at a point

There is no way to ask how high the terrain is at an arbitrary x and z, and no amount of API design changes that.

The game computes terrain height from a module-scope function that is not reachable from `window.__game`, and there is no served heightmap. Nor does the wire carry one. A ground effect arrives as `{ x, z, radius }` with **no y at all**, so the server does not know a height to send either.

`renderer.groundPoint` looks like the answer and is not. It intersects a horizontal plane at a height **you supply**, which is what click-to-move needs, so it takes the number you were hoping to get out of it.

What to do instead, in the order they are worth trying:

1. **Sample a nearby entity.** Mobs, npcs and players stand on the ground, so the `pos.y` of the nearest entity within a few yards of your point is a better estimate than your own position, and `world.entities` is already a live scatter of points known to be on the floor. Fall back to the player's `y` when nothing is near.
2. **Capture the height once, do not track it.** Take it when the effect is first seen and hold it. Tracking live slides a ring up a ramp and drops it through the floor when the player jumps.
3. **Draw something that survives being slightly wrong.** A ring at one height over sloping ground is approximate by construction. A marker with a vertical pillar or a fading column reads correctly when it is off by a yard; a flat ring reads as a bug.

The related question, how many pixels a 30 yard radius covers on screen, IS answerable: project the centre and a point one radius away and measure the distance between them. `ui.project` documents that idiom. There is no single scale figure because under perspective a ground radius covers a different number of pixels across the screen than up it, so a published scalar would be right along one axis and wrong along the other.

### An icon for every aura

There are **two** routes to an aura's picture, they cover different auras, and many auras are reached by neither.

`ui.icon.aura(id)` reads the game's aura art manifest, `/ui/auras/mapping.json`. The family it covers is the auras **no ability id names**: a mob's, an encounter mechanic's, a battleground rune's, a set bonus's, resurrection sickness. It is a closed set of a few hundred rather than everything the game can apply.

`ui.icon.ability(id, cls)` still answers an aura a **player** applied, where the applying ability id is usually the aura's own id and the caster's class is on their entity.

[Patterns](/docs/patterns) shows how to ask them in the order the game's own resolver uses.

Everything outside those two is composited on a canvas at runtime from a bundled table, with no file to point at. Mob-applied auras are full of ids no ability answers to (`<ability>_lockout` for an interrupt lockout, and a long tail of encounter-specific stuns), and `sourceId` is 0 when the game did not say. Both dead ends come back as null rather than as a broken image, and a blank slot is not a bug you can fix: draw the aura's name, or a shape keyed to its kind.
