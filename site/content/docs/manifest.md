---
title: The manifest
order: 2
summary: Every field, what it is for, and the one that cannot change after you publish.
---

`addon.json` sits next to your entry file. The schema that validates it is the same module CI, the dev server, and the loader all use, so a manifest that passes `pnpm validate` cannot fail at install.

## A minimal manifest

Seven required fields. Everything else is optional.

```json addon.json
{
  "id": "my-addon",
  "name": "My Addon",
  "version": "1.0.0",
  "apiVersion": 1,
  "author": "you",
  "description": "What it does, in one line.",
  "entry": "main.js"
}
```

## Fields

<!-- generated: manifest-fields -->

## The id is the one you cannot take back

Everything else on that table is free to change between versions. The `id` is not, and it is worth understanding why rather than just obeying it.

The id is your storage namespace, your keybind scope, and half of every fully-qualified id the loader uses to tell your addon apart from someone else's with the same name. Renaming a published addon is therefore not a rename. Every player who installed it keeps their settings, keybinds and window position filed under the old name, where nothing will ever read them again, and the new name arrives in Browse looking like a different addon that installs alongside the old one.

`combat-meter` was called `dps-meter` until a healing tab made the name wrong. That rename was free, and it was free only because nothing had been released yet.

## permissions is a disclosure, not a boundary

This is the most important sentence on this page, and it is easy to read the field the wrong way round.

Addon code runs in the page realm with the page's globals in scope. A manifest that declares nothing is not thereby *prevented* from doing anything. The list you write is what you are telling the player your addon is for, and the loader shows it on the install confirmation next to a sentence saying exactly that.

So declare what you use and nothing more, because the value of the list is that it is honest. A permission list presented with nothing beside it reads as a sandbox, and there is not one.

## Settings and keybinds are rendered for you

Declare them and the manager builds the form, the keybind editor, and the conflict warnings. You never draw any of that.

```json
{
  "settings": [
    { "id": "max-rows", "type": "number", "label": "Rows to show", "default": 10, "min": 3, "max": 40 },
    { "id": "show-detail", "type": "boolean", "label": "Show per-hit detail", "default": true }
  ],
  "keybinds": [{ "id": "toggle", "label": "Show or hide the meter", "default": "Alt+KeyD" }]
}
```

Both are hydrated before your first line runs, so `woc.settings['max-rows']` is there immediately rather than arriving later. Changes reach you through `woc.onSettingsChange`, and a rebind moves your live binding for you.

You can only bind an id you declared. That is what makes the editor able to list your keys before your addon has run.

A `label` is read in two places, not one. The manager puts it beside the control, and an addon published through the official marketplace gets [its own page](/addons) on this site where every setting and every default binding is printed from this same declaration. So a label is player-facing text rather than a note to yourself: write it as the sentence a checkbox deserves, and the page and the pane cannot disagree about what the setting does.

## Shipping a table beside your code

An addon is one file, but an addon **directory** is not. `entry` names your code; `data` names JSON files next to it, and the loader fetches them at install and hands them back parsed.

```json
{
  "data": ["items.json", "zones.json"],
  "apiMinor": 2
}
```

```js
const items = await woc.data('items.json');
```

Up to eight files, each under half a megabyte, each ending in `.json` because `woc.data` parses what it reads. `pnpm validate` checks every declared file exists, parses, and fits, so a table that would fail a player's install fails CI instead.

Declare `apiMinor: 2` when you use it. An older loader drops a manifest key it has never heard of, so without that line it would install you happily and then run you with a `woc.data` that rejects.

## Naming an addon yours works better with

```json
{ "companions": ["lorebind"] }
```

Up to four bare addon ids. The manager draws each one under your description with what the player would do about it: installed and running, installed but switched off, available in Browse, or not offered by any source they have.

It is a **note and nothing else**. It gates nothing, installs nothing, orders nothing, and stops nothing from starting. Bare ids rather than fully-qualified ones, because the same addon installed from a fork is still the companion you meant. Nothing on the `woc` surface changes, so do not raise `apiMinor` for it, and nothing checks the id exists: a companion may legitimately live on a marketplace this repository has never heard of.

## Checking it

```sh
pnpm validate
```

Runs the real schema over every `addons/*/addon.json`. The dev server runs the same reader on every request, so a manifest saved mid-session is visible on the next refresh and the dev index cannot diverge from what CI would accept.
