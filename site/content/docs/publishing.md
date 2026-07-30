---
title: Publishing
order: 5
summary: A pull request here, or your own marketplace repository, and what a pin does.
---

A marketplace is a GitHub repository with an `addons/` directory and a generated `marketplace.json` at its root. That is the whole format.

## Through the official marketplace

Open a pull request adding your directory. It is reviewed, and once merged it ships to every player, because the official marketplace is built into the loader and cannot be removed.

That is also why review is the limit: the official marketplace is the trust anchor, and the only thing that makes it one is that somebody read the code.

Addons contributed here are under the repository's MIT licence.

## Running your own

Copy `.github/workflows/marketplace.yml`. It regenerates the index from the `addon.json` files on every push, so the index and the manifests cannot drift.

Never hand-edit `marketplace.json`.

```sh
pnpm index
```

Players add your source by owner and repository. The loader warns them plainly at that moment that they are trusting you with their account, because they are.

## Pin to a tag

A source can point at a branch or a tag. Point yours at a tag if you want installs to be reproducible: a branch means the code can change under an installed player without any version moving.

## What an FQID is

Every installed addon is identified by its marketplace id plus its addon id. That pair is the storage namespace, so the same addon id published from two different sources is two different addons with two different sets of settings, which is what stops one marketplace from reading another's data.

Moving a source to a different tag never changes its id, so everything installed from it keeps its settings, keybinds and data.

## Updates, and pins

The loader compares your published version against what a player has and offers an update. It never installs one by itself. There is no auto-update to switch on, for any marketplace including the official one: an update is always a player pressing a button.

A player can **pin** an addon, which means "stop offering", not "install that instead". A marketplace serves one version per ref, so there is no older body to go back to. The row stays visible carrying its pin, because the only thing a pin needs a UI for is saying that an update exists and the player's own decision is holding it back.
