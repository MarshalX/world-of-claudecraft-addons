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

The full API surface is typed in [`packages/types/index.d.ts`](packages/types/index.d.ts), and the manifest schema is [`loader/src/shared/schema.ts`](loader/src/shared/schema.ts).

### What addons may not do

The loader is read-only against the game by design. There is no send API, no synthetic input, and no action automation. The game's terms prohibit automating play, and it runs a bot detector whose heuristics are not public, so staying strictly read-only is the only defensible position. Reformatting, aggregating, and re-presenting information the player already has is entirely fair.

## Development

```sh
corepack enable
pnpm install
pnpm check      # typecheck, lint, test, validate manifests
pnpm build      # emits loader/dist/woc-loader.user.js
pnpm dev        # live-reloading userscript
```

Develop against `pbe` or `pbe2`. They run ahead of live, so game drift shows up there first.

Working instructions are in [AGENTS.md](AGENTS.md).

## License

MIT. Not affiliated with or endorsed by the World of ClaudeCraft project.
