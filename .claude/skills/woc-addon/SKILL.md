---
name: woc-addon
description: "Build a World of ClaudeCraft addon end to end: the manifest, the single-file source, and its own vitest suite, passing lint, tests and manifest validation. Use this whenever the user asks to build, scaffold, write, port or finish an addon, asks for a HUD overlay, meter, timer strip, nameplate, cooldown tracker, threat display, bag panel or anything that draws over the game, or says anything like 'make an addon that shows X'. Also use it when fixing or extending an existing addon, because the frame, storage and honesty rules here are where those bugs come from, and when the user asks whether an addon COULD read something, since it carries the list of what the game does not give you."
---

# Building a World of ClaudeCraft addon

An addon is ONE FILE. `entry` in the manifest names a single `main.js`, the loader evaluates it as a function body in strict mode with `woc` in scope, and there are no imports, no exports and no build step. Anything two addons both need comes from the loader's kit or over the bus. That constraint shapes every decision below: a line spent on scaffolding is a line the feature did not get.

If the repository has an `AGENTS.md` or `CLAUDE.md`, read it first and let it win over anything here.

## The four files

```
addons/<id>/
  addon.json      the manifest, validated by `pnpm validate`
  main.js         the addon, a function body
  main.test.ts    its own suite, the only TypeScript in the directory
  preview.png     a screenshot, needed only to publish
```

The suite lives beside the addon rather than in `tests/`, because `tests/` is about the loader and this suite travels with the directory a third-party marketplace would copy.

## Build with the kit, and write less

The single biggest difference between an addon that reads well and one that reads as a mess is how much of it is hand-rolled. Reach for the kit first, every time.

- **`ui.bar` and `ui.tile` are the two timer shapes and there is no third.** `ui.banner` is the centre-screen warning, `ui.toast` the transient note, `ui.alert` the modal, `ui.tooltip` the hover, `ui.field` a settings control, `ui.tabs` a tab strip, `ui.menu` a context menu, `ui.anchor3d` a world-anchored element. Reaching past these into `document.createElement` for something the kit already draws is the most common way an addon ends up twice the size it needed to be.
- **`.woc-btn` and `.woc-tab` inherit your frame's density.** Using those families is why reusing the kit beats restyling your own: an addon that draws its own buttons stops matching the game the first time the loader restyles.
- **50 lines per function body is a real gate**, and it is doing you a favour. A builder that outgrows it is usually holding two concerns; split it while writing rather than when the linter says so. Many small named functions is the shape these addons want.
- **Comments explain intent and non-obvious constraints, never what the code says.** A comment restating the next line is noise; a comment saying which reading is an inference is the most valuable line in the file.
- Every line spent on scaffolding is a line the feature did not get. That is the whole argument for all of the above.

## Start by establishing what you can actually read

`packages/types/*.d.ts` is the source of truth for what exists. Read it rather than guessing, and rather than trusting prose that may have drifted. `woc.apiMinor` is how an addon detects a feature at run time.

Then check your idea against **What the game does not give you** at the bottom of this file. Most addon ideas that fail, fail there, and finding out first is much cheaper than finding out after the display is built.

The id you choose is permanent. It is the storage namespace, the keybind scope and half of every fully-qualified id, so renaming a published addon orphans every player's settings, keybinds and window position, and shows up in Browse as a second addon installing beside the first.

## The manifest

An existing addon is the best template. What matters:

- `version` starts at `1.0.0`, never `0.x`. The marketplace compares with real semver and a player installing `0.9.0` over `1.0.0` is a bug report.
- `apiVersion` is `1`. `apiMinor` is the minor you ACTUALLY use. A speculative bump makes the addon incompatible with every released loader for no benefit, because the loader refuses anything declaring more than it implements.
- `tags` come from a closed vocabulary of ten: `combat`, `healing`, `pvp`, `raid`, `world`, `economy`, `progression`, `social`, `interface`, `development`. Browse renders one filter per distinct tag, so an invented eleventh is a filter nobody wants.
- `permissions` come from `net.read`, `world.read`, `ui`, `sound`, `keys`, `storage`. They are a DISCLOSURE, not a sandbox: addon code runs in the page realm regardless, and the install confirmation says so.
- Each `settings` entry needs `id`, `type`, `label`, `default`. A `select` also needs `options` and its default must be one of them; a `number` may carry `min` and `max`.
- `data` names JSON files beside `main.js` that `woc.data(name)` reads, fetched and cached by the host. Use it for anything past a few hundred bytes instead of pasting a table into the source.

## Frames: the decisions that produce most bug reports

**`ui.frame`, not `ui.window`, unless the player OPENS the surface to read it and dismisses it with the mouse.** The difference is the ARIA role: a window is `role="dialog"`, a thing the player opened; a frame is `role="group"`, HUD furniture. A close button is `closable` and works on either, so wanting one is not a reason to reach for a window.

**Pick a `density` deliberately.** `comfortable` keeps the game's 40px tap-target floor and is the default so an addon that has not thought about it stays accessible. `compact` gives that floor up for a readout glanced at mid-fight. `bare` drops the panel, padding and title bar, for an overlay that IS its content.

**Resizable and a floor come as a pair. Either alone is a bug.**

- `resizable: true` if and only if your content reflows with the box. Take the box from `onMove` and lay out against it. If your content ignores the box, a handle either does nothing or clips it, and a size SETTING is the honest control instead.
- Set `minWidth` and `minHeight`, derived from your own size setting rather than a constant, so a player who makes rows bigger gets a floor that grows with them. Without them your floor is whatever the first paint happened to need.
- Floor at ONE row, never the current count. Bounds cannot be restated after the frame is built, so a floor set while three rows show traps the player who later has one.

**Never measure your own elements to lay out.** `onMove` hands you the box precisely so you do not force a synchronous layout every frame.

**A `bare` frame clips rather than scrolling.** A scrollbar is chrome and chrome is what that density removes. Needing to scroll means you picked the wrong density.

**Frame ids are stable strings.** They are the persistence key, so renaming one loses the player's saved position.

## Say what you do not know

This separates an addon worth installing from one that quietly lies, and it is what real play sends back more than anything else.

- An empty grid reads as a MEASUREMENT OF ZERO, which is the one thing it never means. Either say why it is empty ("Out of combat.") or do not be on screen.
- Put limits on screen, not in a comment. If the data is capped at eight rows, draw no rank number rather than one that looks complete.
- Do not draw a bar when the comparison is not valid. A bar's width means a share of something; if two rows are not comparable, use text.
- An observed maximum is honest and improves as the session goes on. A guessed one is wrong quietly. Say what you measured against.
- Absent and zero are different answers. Publish no value rather than a `0` that reads as a measurement.
- A stale reading that says it is stale is useful. One that looks live is worse than nothing.

## Reading the game

- **Read live, do not cache a resolver.** A pet, a target and a party member all come and go.
- **Call anything reached through a game object defensively.** A future game update can leave something callable in place that throws, and the cost of that has to be a missing reading rather than a dead screen.
- **Subscribe for the SET, animate from the READ.** `world.on` fires when a set changes, never as a number counts down. The subscription decides which rows exist; a frame loop decides how full each one is.
- **An ability id and its display name have diverged.** A combat record's `ability` is a display NAME; a cooldown map's key is an id. `world.abilities` closes the join both ways for YOUR OWN spellbook and nothing closes it for anything a mob casts, so a title-cased id there is a guess and should be marked as one.
- **`world.raw` is unstable by definition** and the manager flags an addon that reaches for it. Never call `world.raw.drainEvents()`: it empties the queue the game's own HUD consumes, which silently eats the player's combat log and loot toasts.

## Storage and clocks

- `woc.now()` is monotonic and right for measuring an interval. `woc.wallClock()` is epoch and right for anything you STORE or compare against a server timestamp. A stored monotonic stamp reads as being in the future on the next page load, silently.
- A per-character READ waits for the character; a per-character WRITE refuses before world entry. The asymmetry is deliberate: a write's value was decided before anyone knew whose it was.
- `storage.character` is scoped to the character in play and cannot read another one. For a cross-character view, key account-wide `storage` on `world.characterKey` rather than inventing a second derivation of who this is.
- A proximity-gated read is a three-state value: `near` carries the payload, `away` means the player is not at the counter, `unknown` means nothing has decoded yet. **Record only on `near`.** Writing on `away` erases what you stored the moment the player walks away.
- Clone before an async write. Handing a live object to `storage.set` while you mutate it every paint stores a reading that quietly agrees with itself.

## Lifecycle

- Everything you create goes in the disposal bag. Disable is hot with no page reload, so a bare `setInterval` runs forever against DOM that is already gone. Prefer `woc.setTimeout`, `woc.setInterval` and `woc.onFrame`, which are cleared for you.
- Your first line runs BEFORE world entry, on the landing page. Subscribe and prepare there; do not assume a player exists.
- Join `woc.onFrame` only if you animate. A panel whose figures move once a second wants `woc.setInterval`, not sixty rewrites a second of the same six strings.

## The bus, if two addons cooperate

- Subscribe with `bus.anySender` and read `message.from`. A hardcoded `official/<id>` stops working for anyone who installed from a fork.
- A consumer never waits: emit `<topic>:ask`, render immediately without the answer, and upgrade if one arrives.
- Silence is an ordinary state, not an error. The publisher may not be installed, may be disabled, or may have emitted before you subscribed.

## The suite

Start from `tests/fakes/addon.ts`. `mountAddon` parses the REAL `addon.json` through the schema CI uses, seeds settings and data files BEFORE evaluating the body, and hands back one `dispose`.

```ts
// @vitest-environment happy-dom
import MANIFEST_TEXT from './addon.json?raw';
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model, and an addon file is a function BODY with no exports at all.
import SOURCE from './main.js?raw';

const harness = await mountAddon({
  manifest: MANIFEST_TEXT,
  source: SOURCE,
  settings: { 'max-rows': 5 },
  data: { 'table.json': TABLE_TEXT },
  game: Promise.resolve({ world }),
});
```

Read a neighbouring addon's suite before writing one. What makes these worth having:

- **Test the decision the addon exists for**, not the rendering. If it decides what can be dispelled, the cases are about that decision.
- **Break the implementation to prove the test bites.** Swap the field, invert the guard, run, confirm exactly the right cases fail, then restore. A guard test nobody has seen fail is a guess.
- **Build fixtures from your shipped data file**, not a stub, so a case about a bad row stays a case about the real table.
- **Assert on the STORE for a write path**, not the screen. The screen can be right while nothing was saved.
- **Build "every setting on" from the manifest** so a future setting is covered the day it is added rather than the day someone remembers.
- CSS text is unreadable from a suite: every `.css` import resolves to `''`. Assert the class or inline style your code writes, never a rule a stylesheet declares.

## Gates

Run these scoped to what you touched, in case anything else is in flight:

```sh
pnpm lint addons/<id>/main.js addons/<id>/main.test.ts
pnpm test addons/<id>
pnpm validate
```

`pnpm lint` fails on INFO-level findings, deliberately. Fix the violation rather than disabling the rule. To format one file, `pnpm fix addons/<id>/main.js` scopes; a bare `pnpm fix` rewrites the tree.

## Style

- No em dashes, no en dashes, no emoji, anywhere.
- Private declarations first, exported surface last.
- The header comment should say what the addon is FOR, and which of its readings are inferences rather than facts. That second half is what a player needs and what a future author will otherwise get wrong.

## What the game does not give you

Check here before designing. Each of these is a limit of the wire or the client, not a gap in the loader, so no amount of API reading will find a way round it. `references/limits.md` has the full list with the reasoning and the mitigation for each; these are the ones that most often kill an idea outright:

- **There is no send API and there never will be.** Every addon is a DISPLAY. Nothing can accept a roll, join a queue, buy a listing, place a marker or cast anything. A feature description that reads as an action is wrong before it is written.
- **Combat events reach you only for yourself and your group**, within a radius. A meter measures the group it is in. It must never present a total as realm-wide.
- **A pet's damage is never delivered.** The server filters on player ids and a pet has an entity id, so pet output cannot be metered at all, even though the pet is visible and nameable.
- **Overhealing is never reported.** A healing meter reports EFFECTIVE healing and says so; the overheal cannot be reconstructed from health deltas.
- **Item names, stats and stack maximums are bundled and unreachable.** Some names come from a served art manifest and are unreliable; the rest an addon learns from loot rolls or embeds itself.
- **Enemy and ally cooldowns are not sent.** Only your own. Anything about another player's cooldown is an inference from an observed cast and must be presented as one.
- **Encounter internals are server-side**, and a boss mechanic's timer runs on melee contact rather than on engage, so a first prediction cannot be reliable. Anchor on a sighting and project forward.
- **There is no terrain height and no world-to-screen scale.** A ground marker is anchored at a guessed height.
- **A mob's aura has no icon.** The game composites aura art on a canvas from a bundled table, so there is nothing to point at.

If the thing you need is not on that list and not in `packages/types/`, look at the game's own behaviour before concluding it is impossible, and write down what you find.
