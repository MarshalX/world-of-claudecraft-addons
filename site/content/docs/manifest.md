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

## Checking it

```sh
pnpm validate
```

Runs the real schema over every `addons/*/addon.json`. The dev server runs the same reader on every request, so a manifest saved mid-session is visible on the next refresh and the dev index cannot diverge from what CI would accept.
