<div align="center">

<img src="screenshots/banner.png" width="880" alt="ClaudeCraft Addons: an addon platform for World of ClaudeCraft, running as a userscript. External to the game, read-only, MIT." />

[**woc.marshal.dev**](https://woc.marshal.dev)

One install adds an **Addons** entry to the game menu: browse a built-in marketplace,
install an addon, configure it, all inside the game.

<img src="screenshots/addons-installed.png" width="880" alt="The Addons window inside the game, on the Installed tab, listing Combat Meter, Cooldown Bars and Dev Harness as running, each with a Configure button and an Enabled checkbox." />

</div>

## What it is

**Fully external to the game.** No game source is modified and no build is forked. The loader reaches the game only through surfaces a browser already gets: the `window.__game` global, the WebSocket, HUD DOM ids, and the audio pack. That constraint is the whole design, and it is why this can exist at all without the game's cooperation.

It is also **read-only by design**. No send API, no synthetic input, no automation of play. Addons reformat, aggregate and re-present information the player already has.

Works on all three deployments:

| Channel | Origin |
|---|---|
| live | `https://worldofclaudecraft.com` |
| pbe | `https://pbe.worldofclaudecraft.com` |
| pbe2 | `https://pbe2.worldofclaudecraft.com` |

## Install

1. Install [Violentmonkey](https://violentmonkey.github.io/) or [Tampermonkey](https://www.tampermonkey.net/).
2. On Chromium, turn on **Allow User Scripts** for that extension. This is the step that fails silently.
3. **[Install woc-loader.user.js →](https://github.com/MarshalX/world-of-claudecraft-addons/releases/latest/download/woc-loader.user.js)** Your manager intercepts the link, shows you the source and the permissions it asks for, and waits for you to confirm.
4. Open the game, press <kbd>Esc</kbd>, and look for **Addons** at the bottom of the Game Menu.

**[Full instructions, per browser →](https://woc.marshal.dev/install)**

The per-browser procedure lives on the site rather than here, because two copies of a fiddly set of steps means one of them is wrong.

## What ships with it

<!-- addons:start -->

**14 addons ship with the loader**, reviewed and installed from inside the game. Five of them:

**[Combat Meter](addons/combat-meter)** — What your damage and healing are made of: a row per ability with crit rate, average and biggest hit, plus your real miss and dodge rates and what is hitting you.

<img src="addons/combat-meter/preview.png" width="388" alt="The Combat Meter panel on its Damage tab, reading 5,088 damage in 30s. Six ability rows (Aimed Shot 1,596, Fell Shot 1,334, Volley 827, Auto Shot 643, Serpent Sting 364, Raptor Strike 324) each show total, share and damage per second, over a second line of hits, crit rate, average and biggest hit. The fill behind each row is tinted by damage school, red for physical, blue for arcane and green for nature, and every row but Auto Shot carries the art the game ships for that ability. A summary line reads hit 89%, miss 5%, dodge 5%." />

**[Satchel](addons/satchel)** — One list of everything you own, across every character. Bags, bank and mailbox are recorded as they are read, so an item is one row with a total however many stacks and characters hold it, and hovering says who has how many and where. What a vendor would pay for a bag, a bank and the whole account.

<img src="addons/satchel/preview.png" width="440" alt="On the left, Everything you own, the Items tab of a panel headed Satchel (2 unread), over a search field reading every character, every store. Nine rows, one per item rather than one per stack, each with the game&#39;s own art, a total on the right and a faint line under it naming who holds them: Bristly Boar Hide 16, Marshal 9, Bruk 7; Chime Dust 35, Marshal 4, Sena 31; Chime Essence 6, Sena 6; Chunk Of Ore 6, Marshal 6; Copper Ore 181, Marshal 87, Bruk 54, +1 more; Game Meat 30, Marshal 18, Bruk 12; Ghostly Essence 6, Marshal 4, Sena 2; Glyphsteel Bar 9, Marshal 6, Sena 3; and Goldleaf Herb 66, Marshal 46, Sena 20, the last of them cut off by the scrolling list. Each row is washed to a width that is its share of the largest pile, so Copper Ore fills its row and Chime Essence is a stub. Marshal&#39;s 87 copper ore is three stacks in the bags and one in the bank counted as one figure, and Sena and Bruk are not logged in: their rows come from what was recorded the last time they were played. A footer reads KINDS 26, COPIES 747. On the right, One character, live, the Bags tab of the same panel, showing the character who is logged in. A selector reads Marshal (here), a slot bar reads 24 / 52 with 28 free, and a strip under it reads Live, MARKED 3 split 1 worn, SOCKETS 4 / 4, over a Carrying row drawn in the game&#39;s own coins: 1462 gold, 38 silver, 4 copper. Below that a grid of 52 squares eleven across, 24 of them holding the game&#39;s item art with a stack count in the corner (three of copper ore at 20, 20 and 7, two of iron ore at 20 and 16, hides, potions, herbs, cloth and meat) and the remaining 28 drawn as faint dashed outlines. Four squares are outlined warm: the three copper ore stacks, which are one item split over more than one cell, and a spare of the vest the character is wearing." />

**[Facemark](addons/facemark)** — A nameplate over every unit near you: its name, its level, a health bar, a cast bar, the harmful effects on it, a threat edge and its raid mark.

<img src="addons/facemark/preview.png" width="391" alt="two nameplates floating over the units they belong to. Tempest Vharok, level 22, the name in hostile red beside a yellow Star raid mark, a health bar at 58 percent, a cast bar reading Rift Thunderhead? because only the ability id reaches an addon and the name was worked out from it, and two effect tiles under it, Venom Barb and Rattling Shot, each carrying the art the game files under that ability. A red edge runs down its left, saying the player is top of its hate table. Beside it the friendly player Anserra at level 20 and 66 percent health, the name in player blue, no threat edge at all because a player keeps no hate table, and one effect on them, the boss snare Static Field, drawn as a bordered countdown with no picture because an effect a mob applied has none anywhere in the game." />

**[Trailmark](addons/trailmark)** — Where the thing your quest wants actually is: the zone, the distance, the way to turn and a world pin for every objective in your log, and who takes each quest that is ready.

<img src="addons/trailmark/preview.png" width="440" alt="a panel headed Trailmark listing five outstanding quest objectives as filling bars, with two pins hanging over the world below it. Every row carries a zone, a distance in yards and an arrow for the way to turn to reach it. The first row is a quest with nothing left to do, Pelts for the Causeway, its bar full and reading Ready, with Hand in to Provisioner Hale as its heading and Mirefen Marsh, 213 yd down and to the left underneath; it carries no picture, because the game ships no portrait for that NPC and the empty slot is closed up rather than left blank. Then Bristly Boar Hide at 3 of 5, in Eastbrook Vale 105 yards straight ahead, carrying the game art for the hide; Mirefen Widow slain at 4 of 10 behind that widow&#39;s own portrait, and Widow Venom Sac at 2 of 6, both 180 yards straight back in Mirefen Marsh, a zone this character has never entered and where nothing at all is in scope. The venom sac row is drawn in a warm amber and its figure carries a plus, which is this addon saying the count is the shipped definition and therefore a lower bound, until the server says otherwise. The last row, The Codfather at 0 of 1, reads Nowhere on the map where the others name a zone, a distance and a direction: the Codfather is a fish, and fishing has no world node anywhere in the game to point at, so no mob drops it, no crate holds it and the honest answer is that there is nowhere to send you. The row still carries the fish&#39;s own art, which is the shape of the whole limit: the game knows exactly what the thing looks like and cannot say where it is. Below the panel, two square pins carrying the boar hide art stand over the two camps that drop it, the nearer one hanging lower in the view than the one another forty yards beyond it." />

**[Ledgerline](addons/ledgerline)** — A price history for a market that keeps none: every page you read at the Merchant is written down, and your own listings are checked against it for undercuts.

<img src="addons/ledgerline/preview.png" width="440" alt="On the left, The ledger, the Prices tab of a panel headed Ledgerline (to collect), with a strip over the list reading at the Merchant, page 1 of 1, a 5 percent cut, 6 of 12 listing slots used and 62 silver and 2 items waiting to be collected. Under a search field, six item rows fenced off by a rule at each end, each carrying the game&#39;s own art, its price as coins (a disc per unit, gold, silver or copper, with the empty units left out) and a chart across the bottom of the row: Copper Ore, low 44 copper over a median of 48 and 3 visits; Ghostly Essence, low 7 silver 80; Healing Potion, low 2 silver 45; Iron Ore, low 1 silver 5; Pristine Hide, low 14 silver; and Rough Hide, low 84 copper, its chart cut off by the scrolling list. Every figure is one vote per visit to the counter rather than one per listing, and each chart has one point per visit: copper ore falls across the three days and iron ore and pristine hide climb. A footer reads 9 items recorded, keeping 30 days. On the right, Your listings, the Yours tab of the same panel, with the same strip over six listings of the player&#39;s own, each asking a price in the game&#39;s own coins. Copper Ore asking 9 silver and Spider Silk asking 6 silver 20 are washed red and read undercut, because a cheaper listing of each leads its block on the page that was read. Goldleaf Herb asking 17 silver reads not on this page, which is the panel refusing to call it uncontested: nobody else was selling any, and an item missing from a page is not an item nobody is selling. Iron Ore at 26 silver, Pristine Hide at 15 silver and Rough Hide at 8 silver 60 read cheapest on this page. Every row also gives the price per item, carries that item&#39;s own price chart across the bottom of it, and says the listing was first seen by you 6 hours ago, which is this addon&#39;s own record rather than an expiry, since no listing on the wire carries one. Under a rule, a footer reads that the verdicts are judged from the page you are reading now, which is not the whole market." />

### The other 9

- **[Cadence](addons/cadence)** — The four timings a rotation is played against, on one thin strip: your swing, the global cooldown, your cast with a latency band, and your resource with combo points as pips.
- **[Cooldown Bars](addons/cooldown-bars)** — A draining bar for every ability you have on cooldown, soonest ready first, measured against the real length of anything in your own spellbook.
- **[Emberwatch](addons/emberwatch)** — A rules engine for effects and procs: name an effect on a unit and get a tile, a cue and a banner when it lands, stacks up or runs out.
- **[Foretell](addons/foretell)** — A cast bar for everything casting near you, soonest to land first, as a borderless column or floating over each caster.
- **[Longwatch](addons/longwatch)** — The rare spawns, where they live and when they are due back.
- **[Lorebind](addons/lorebind)** — A browser for every item in the game, and the name service every other addon subscribes to.
- **[Purelight](addons/purelight)** — Every effect in front of you that can actually be removed, worst first: on you, your pet, your group and your target, each tile naming who carries it.
- **[Veinsight](addons/veinsight)** — Every ore vein, wood stand and herb patch in the world, pinned where it stands and listed nearest first with a distance, a bearing and your own respawn timer.
- **[Wayline](addons/wayline)** — How far the next level is in time rather than in numbers: experience per hour over a rolling window, the kills and the time left to reach it, and a derived virtual level past the cap.

[The full catalog, with a screenshot of each →](https://woc.marshal.dev/addons)

Shipped for people writing addons rather than playing with them, installed from **Addons → Browse** like anything else, and deliberately not in the list above:

- **[Dev Harness](addons/dev-harness)** — Exercises every part of the addon API and reports what worked, repainting as the world moves, so a loader change can be checked in the game rather than only in a test.

<!-- addons:end -->

## For addon authors

An addon is a directory with a manifest and one plain JavaScript file. No bundler, no framework, no build step.

```
addons/my-addon/
  addon.json
  main.js
```

```js
/// <reference types="@woc-addons/types" />

const win = woc.ui.frame({ id: 'main', title: 'My Addon', save: true });

woc.net.onEvent('damage', (event) => {
  win.body.textContent = String(event.amount);
});

woc.keys.bind('toggle', () => {
  win.toggle();
  woc.sound.play('ui_click');
});
```

No export, no registration call, and no cleanup: the file is evaluated as a function body with `woc` already in scope, and everything the API creates is torn down when the addon is disabled.

**[Authoring docs →](https://woc.marshal.dev/docs/)** covers the manifest, the whole `woc` surface, publishing, and the patterns nobody derives from a signature. The full type surface is published as [`@woc-addons/types`](packages/types).

One worth internalising before you start: a field can be declared on the game's entity, be readable, and never be sent. `inCombat` is one, and it holds `false` for a whole session. Check what you read against the wire, not against a type.

## Trust

**Installing an addon is equivalent in trust to installing a browser extension.** Addon code runs in the game page and can read anything the page can, including your session token. The `woc` API is an ergonomic surface, not a security boundary.

The official marketplace is the trust anchor: it ships with the loader, cannot be removed, and its contents are reviewed. Adding a third-party marketplace means trusting whoever maintains it with your account. The loader says so at that moment, and shows what each addon declares before it runs.

## Development

```sh
corepack enable
pnpm install
pnpm check      # typecheck, lint, test, validate manifests
pnpm build      # emits loader/dist/woc-loader.user.js
pnpm dev        # watch build, plus the addon dev server on :5180
pnpm serve      # the addon dev server on its own
pnpm site       # build the site into site/dist
pnpm site:dev   # build the site, serve it on :5181, rebuild on change
pnpm index      # regenerate marketplace.json from the addon.json files
pnpm readme     # regenerate the addon section of this file from the manifests
pnpm changelog  # regenerate CHANGELOG.md from commit titles
pnpm cues       # regenerate the sound-cue union from a deployed game's pack
pnpm icons      # regenerate the skill-icon union from its per-class art manifests
```

Develop against `pbe` or `pbe2`. They run ahead of live, so game drift shows up there first.

`packages/types` is published by hand, from that directory: `npm publish`. It is versioned against the loader's `apiVersion` rather than against the loader, so it only needs a release when the addon API surface changes.

Working instructions are in [AGENTS.md](AGENTS.md), and the lint and type rules worth knowing before you write a module are in [STYLE.md](STYLE.md).

## License

MIT. Not affiliated with or endorsed by the World of ClaudeCraft project.
