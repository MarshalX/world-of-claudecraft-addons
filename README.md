# World of ClaudeCraft Addon Loader

An addon platform for [World of ClaudeCraft](https://worldofclaudecraft.com), running as a userscript. This repository is both the loader source and the official addon marketplace.

Fully external to the game: no game source is modified and no build is forked.

Works on all three deployments:

| Channel | Origin |
|---|---|
| live | `https://worldofclaudecraft.com` |
| pbe | `https://pbe.worldofclaudecraft.com` |
| pbe2 | `https://pbe2.worldofclaudecraft.com` |

> **Status: in development.** The shared core is implemented but the loader is not yet usable. There is nothing to install.

## For players

Once released: install a userscript manager, then install the loader userscript. Open the game, press Escape, and choose **Addons** to browse and enable them.

| Manager | Support |
|---|---|
| [Tampermonkey](https://www.tampermonkey.net/) | Full |
| [Violentmonkey](https://violentmonkey.github.io/) | Full |
| Greasemonkey 4+ | Best-effort. Settings still sync between tabs, over a BroadcastChannel rather than the manager. |

The official marketplace is built in and cannot be removed. You can add other marketplaces, but read the trust note below first.

### Trust

**Installing an addon is equivalent in trust to installing a browser extension.** Addon code runs in the game page and can read anything the page can, including your session token. The `woc` API is an ergonomic surface, not a security boundary.

The official marketplace is the trust anchor: it ships with the loader and its contents are reviewed. Adding a third-party marketplace means trusting whoever maintains it with your account. The loader warns you at that point and shows what each addon declares before you enable it.

## For addon authors

An addon is a folder with a manifest and a plain JavaScript file. No build step.

```
addons/my-addon/
  addon.json
  main.js
```

```js
/// <reference types="@woc-addons/types" />

const win = woc.ui.frame({ id: 'main', title: 'My Addon', save: true });

woc.net.onEvent('damage', (e) => {
  win.body.textContent = String(e.amount);
});

woc.keys.bind('toggle', () => {
  win.toggle();
  woc.sound.play('ui_click');
});
```

No registration call and no cleanup code. Everything the API creates is torn down automatically when the addon is disabled.

### Read these

| Addon | What it is |
|---|---|
| [`addons/cooldown-bars`](addons/cooldown-bars) | **The example to copy.** Small enough to read in a sitting, and it teaches the one thing that is not obvious from the API: `world.on` says WHICH cooldowns are running, and a frame loop draws how full each bar is. Subscribe for the change, animate from the read. |
| [`addons/combat-meter`](addons/combat-meter) | **A real addon**, and the argument for the platform. The game has its own meter, so this does not compete on party totals or threat; it answers what nothing in the game answers, which is what your damage and healing are made of. Per-ability rows with crit rate, average and biggest, your real miss and dodge rates, and what is hitting you. Bigger than an example, and worth reading second. |
| [`addons/dev-harness`](addons/dev-harness) | Every surface at once. It runs a check against each part of the API and reports what it found, which is also how the loader gets checked against a live game. |

The full surface is typed in [`packages/types`](packages/types), published as [`@woc-addons/types`](packages/types/README.md).

One thing worth internalising from the meter's history: a field can be declared on the game's entity, be readable, and never be sent. `inCombat` is one, and it holds `false` for a whole session. Check what you read against the wire, not against a type.

### The manifest

`addon.json` sits next to your entry file. The schema that validates it is [`loader/src/shared/schema.ts`](loader/src/shared/schema.ts), which is the same module CI, the dev server, and the loader all use, so a manifest that passes `pnpm validate` cannot fail at install.

```json
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

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Lower-case kebab-case. It is your storage namespace and your keybind scope, so it cannot change once published: a rename orphans every installed player's settings, keybinds and window position, and reads in Browse as a different addon that installs alongside the old one. Get it right before anyone has it. |
| `name`, `author`, `description` | yes | The description is what Browse shows and what the install confirmation repeats. |
| `version` | yes | Semver. The marketplace serves one version, so this is what an update compares against. |
| `apiVersion` | yes | `1`. A loader that cannot honour it marks the addon incompatible and never evaluates it. |
| `entry` | yes | A relative path inside your directory. |
| `permissions` | no | What you use, out of `net.read`, `world.read`, `ui`, `sound`, `keys`, `storage`. Shown one line each on the install confirmation, so ask for what you use and nothing else. |
| `keybinds` | no | `{ id, label, default }`. You can only bind an id you declared. |
| `settings` | no | `boolean`, `number` (with optional `min`/`max`), `string`, or `select` (with `options`). The manager renders the form; you read `woc.settings`. |
| `tags` | no | Up to six, kebab-case. They become Browse's filters. |
| `gameVersion` | no | A semver range, e.g. `">=0.31.0"`. Outside it, the addon is incompatible rather than broken. |
| `channels` | no | Restrict to `live`, `pbe`, or `pbe2`. |
| `icon`, `homepage` | no | |

Settings and keybinds are hydrated before your first line runs, so `woc.settings.window` is there immediately. Changes arrive through `woc.onSettingsChange`, and a rebind moves your live binding for you.

### Density

`woc.ui.frame` and `woc.ui.window` take `density: 'comfortable' | 'compact'`.

Comfortable is the default: 16px labels on a 40px minimum, the tap-target floor the game itself holds to. Use it for anything a player operates. Compact is for a dense readout they glance at, where that floor makes the title bar and close button the loudest things in the panel; it gives the floor up, so pick it for a desktop readout rather than a form.

It reaches your own controls too. Give a button `class="woc-btn"` or a tab `class="woc-tab"` and it is drawn at the frame's density, with the loader's hover and focus treatment, instead of an imitation of it. `addons/combat-meter` does exactly that.

### Bars, warnings and icons

Do not hand-roll a timer row. `woc.ui.bar` is one: an icon, a name that truncates, a fill behind both, an optional second line, and a right-aligned figure in tabular figures so the digits do not shuffle as they count down. Append `bar.el` where you want it and call `bar.update()` as the numbers move.

```js
const bar = woc.ui.bar({ label: 'Aimed Shot', icon: woc.ui.icon.ability('aimed_shot', 'hunter') });
frame.body.appendChild(bar.el);
bar.update({ fraction: remaining / total, value: `${remaining.toFixed(1)}s` });
```

A bar's fill can be tinted by damage school: `bar.update({ school: event.school })`. The colours are the game's own, the ones it tints debuff borders with, so a row matches what the player already reads for that school on an aura icon. It is a separate axis from `tone`, which is urgency, and where both are set tone wins. `damage` events carry `school`; `heal2` does not, so pass null there rather than borrowing one. `addons/combat-meter` colours this way because it cannot show ability art, for a reason worth reading in its header.

`woc.ui.icon` builds paths into the game's own art: `ability(id, cls)`, `mob(templateId)`, `item(itemId)`. Use it rather than writing a path, so a game update that moves a directory is one edit in the loader instead of a silent break in every addon. The class an ability is filed under is `world.player.templateId` for anything you cast.

Not every ability has an icon file. The game composites one on a canvas for the rest, from a module no addon can reach, so those have no URL at all. The loader reads the manifest the game serves per class and `ability()` returns null once it knows there is none; before that manifest lands the answer is optimistic and the image decides, which is why a bar hides its own icon slot when the load fails. `await woc.ui.icon.preload(cls)` if a blank slot on your first row would be worse than a frame's delay.

`woc.ui.banner` is the centre-screen warning, for the one thing a player must read within a second. It is not a toast: it lands in the middle of the view, carries its own dark scrim so it is legible over terrain of any colour, and is announced assertively, which interrupts a screen reader. There is one slot for the whole loader and a new banner replaces whatever is up, including another addon's, because stacking these would cover the fight the warning is about. Anything a player reads at their own pace belongs in a frame.

```js
woc.ui.banner('Deathless Rage', { kind: 'danger', size: 'large', detail: 'interrupt it' });
```

`size` is `'normal'` or `'large'`, and it moves the weight and both lines with it. There is deliberately no separate weight option: the game's display face has no lowercase and only loads 400 to 700, so a huge light setting of it reads worse than a medium heavy one, and the two axes are not independent. Reach for `large` when missing the warning ends the pull rather than for every warning, because if everything is large then nothing is. The detail line is set in the UI face rather than the display one, so it has real lowercase at a size a display serif would render as tiny caps.

### What you never write

The loader tracks everything the API creates in a disposal bag, and drains it when the addon is disabled: frames are removed, subscriptions released, keys unbound, timers cleared, sounds stopped. Use `woc.setTimeout` and friends rather than the page's, and register `woc.onDispose(fn)` for anything the API did not create.

Enable and disable are fully hot. There is no reload for any addon operation, so a disabled addon has to leave nothing behind, and one that throws is disabled and badged rather than left to spam.

### Writing one

Run the dev server, install your addon from it once, and from then on a save is a reload.

```sh
pnpm dev        # watch build, plus the addon dev server on :5180
```

In the game, open **Addons**, go to the **Dev** tab, and turn the local dev server on. It serves `addons/` from this repository and lists whatever is in there; install yours and enable it. Turn the reload switch on as well and the loader picks up each save without a page refresh: it polls each running local addon and re-evaluates only the ones whose file actually changed.

Nothing about that path is special-cased. Your addon is fetched, validated, evaluated, and disposed exactly the way one from a published marketplace is, so an addon that works against the dev server works once it is published.

### Publishing one

A marketplace is a GitHub repository with an `addons/` directory and a generated `marketplace.json` at its root. To publish through this one, open a pull request adding your directory; to run your own, copy [`.github/workflows/marketplace.yml`](.github/workflows/marketplace.yml), which regenerates the index from the `addon.json` files on every push so the two cannot drift.

Players add a third-party marketplace by owner and repository, and the loader warns them plainly at that point. Pin yours to a tag rather than a branch if you want installs to be reproducible.

### What addons may not do

The loader is read-only against the game by design. There is no send API, no synthetic input, and no action automation. The game's terms prohibit automating play, and it runs a bot detector whose heuristics are not public, so staying strictly read-only is the only defensible position. Reformatting, aggregating, and re-presenting information the player already has is entirely fair.

## Development

```sh
corepack enable
pnpm install
pnpm check      # typecheck, lint, test, validate manifests
pnpm build      # emits loader/dist/woc-loader.user.js
pnpm dev        # watch build, plus the addon dev server on :5180
pnpm serve      # the addon dev server on its own
pnpm index      # regenerate marketplace.json from the addon.json files
pnpm cues       # regenerate the sound-cue union from a deployed game's pack
pnpm icons      # regenerate the skill-icon union from its per-class art manifests
```

`packages/types` is published by hand, from that directory: `npm publish`. It is versioned against the loader's `apiVersion` rather than against the loader, so it only needs a release when the addon API surface changes.

Develop against `pbe` or `pbe2`. They run ahead of live, so game drift shows up there first.

Working instructions are in [AGENTS.md](AGENTS.md), and the lint and type rules worth knowing before you write a module are in [STYLE.md](STYLE.md).

## License

MIT. Not affiliated with or endorsed by the World of ClaudeCraft project.
