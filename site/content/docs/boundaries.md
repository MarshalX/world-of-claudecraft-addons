---
title: Boundaries
order: 6
summary: Read-only, why it is not a temporary state, and what is fair game.
---

The loader is read-only against the game by design. There is no send API, no synthetic input, and no action automation, and none of that is a missing feature.

## Why

The game's terms prohibit automating play, and it runs a bot detector whose heuristics are not public. An addon platform that could act would put every one of its users at risk of a ban they did not choose, for a capability nobody asked for.

Staying strictly read-only is the only defensible position, and it is also the one that keeps the platform welcome. There is no version of this project that ships a send API.

## What is fair game

Everything that reformats, aggregates, or re-presents information the player already has.

- Reading the wire, the world, and the game's own art and audio.
- Drawing anything you like inside the game, with the loader's kit or your own DOM.
- Storing whatever you need, keyed to the character it belongs to.
- Binding keys, and seeing a key press before the game does.

The combat meter is the model: everything it shows was already on the socket, and its whole value is arranging it into a question the game does not answer.

## Where the boundary actually sits

Worth being precise, because the API is an ergonomic surface rather than a security one.

Addon code runs in the page realm with the page's globals in scope. It could reach the socket directly. The loader shadows `localStorage`, `WebSocket`, `XMLHttpRequest` and `__game` with proxies that throw and name the sanctioned API, but those are **guardrails against accident, not a sandbox**, and the error messages say so.

So the read-only boundary is a rule the platform holds itself to and reviews for, not a wall the runtime enforces. An addon that broke it would be removed from the official marketplace; nothing stops a third-party source from shipping one, which is exactly why adding a third-party marketplace is presented as a trust decision.

## Two things the loader will not do either

**It never reads `localStorage['woc_session']`**, which holds the account bearer token.

**It redacts outbound frames before any addon sees them.** The client's first frame on every socket carries that same token, and the redaction matches on the field name rather than the frame type, so a game update or a new frame cannot slip one past.
