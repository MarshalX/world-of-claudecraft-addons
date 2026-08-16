# The generated artifacts

Everything in this repository that is written by a tool rather than by hand, what it reads, and how it goes wrong.

## The split that decides the whole cycle

**Five generators read a DEPLOYED GAME over the network. Two read a local CHECKOUT.** Getting this backwards is the most expensive mistake available in this pass, because it produces a committed artifact that is a plausible picture of a game nobody is running.

| Reads a deployed host | Reads a checkout (`--game`) |
|---|---|
| `pnpm cues` | `pnpm aura-kinds` |
| `pnpm icons` | `pnpm tables` (every `addons/*/generate.mjs`) |
| `pnpm items` | |
| `pnpm theme` | |
| `pnpm shots` | |

The network five default to `https://worldofclaudecraft.com` and take `--host`. They default to LIVE because a committed artifact describes what a PLAYER is running, and players are on live. That is not a claim that live leads. Measured 2026-08-13, live was on v0.37.1 and both pbe channels on v0.35.0, two releases behind; measured 2026-08-04, pbe carried content live did not while reporting an older version. The channels diverge in both directions and a version string does not tell you which content each has.

**So the first thing this pass establishes is whether the checkout tag is what live is serving.** If you are auditing a tag live has not deployed yet, the network five physically cannot produce that tag's content, and running them writes the OLD content over your artifacts while reporting success. Regenerate them when live catches up, and say so in the report rather than leaving it implied.

## One by one

### `pnpm cues`

Reads `/audio/sfx/runtime-pack.json`. Writes `packages/types/cues.generated.d.ts`.

A cue is not a file: the pack collapses a numbered family into one cue with variants and carries the gain each clip was normalised to, so 432 files are 220 cues. The union stays OPEN (`KnownCue | (string & Record<never, never>)`) because the set is content and a game release adds to it before these types catch up. A published type must not be able to break a working addon.

### `pnpm icons`

Reads `/ui/skills/<class>/mapping.json`, nine files, one per class, with no index over them, so the class list is written out in `tools/icons-core.ts`. Writes `packages/types/icons.generated.d.ts`.

Do not union the channels. Narrowing costs autocomplete and nothing else, because the runtime reads the manifest from whichever host the player is on and the published union is open where it is used. Read a count going DOWN as art moving rather than art landing, and check nothing in the tree names a retired id as an id.

### `pnpm items`

Reads `/ui/items/mapping.json`, one file. Writes `packages/types/items.generated.d.ts`.

The manifest's `name` is the ART SOURCE name and drifts from the game's display name, which is why it is published as `ui.icon.itemArtName`, labelled, and deliberately not generated into the types. The manifest is not a subset of the item table either: `backpack` is in it and is not an item.

### `pnpm theme`

Starts from `play.html`, follows the `<link rel="stylesheet">` it finds because the sheet is content-hashed, and transcribes the `:root` custom properties plus the game's own rules for `panel`, `panel-title` and `x-btn`. Writes `stage/theme.generated.css`.

**It is TWO steps.** `pnpm theme` then `pnpm fix stage/theme.generated.css`. It transcribes minified CSS and runs no formatter of its own, so the raw output fails the gate on formatting and, worse, the unformatted diff rewrites all seven borrowed-class rules as noise and hides the real change. Formatted, the borrowed rules come back byte-identical and the diff is exactly what moved.

It warns when the loader's own sheet reads a token WITHOUT a fallback that the game no longer declares. Read that warning: it is a rule that has silently stopped applying.

### `pnpm aura-kinds`

Reads `src/sim/aura_classify.ts` from a checkout. Writes BOTH `packages/types/aura-kinds.generated.d.ts` and `loader/src/shared/aura-kinds.generated.ts`, because there is no endpoint to re-read at run time so the runtime carries the value as well as the types.

**Its flag is space separated: `--game <path>`.** It is `process.argv.indexOf('--game')`. `--game=<path>` trips the required-argument error, which reads as a missing flag rather than a wrong one. `--game` is required and never defaulted, a missing source file is a failure rather than a warning, and the checkout's version is stamped into both headers.

### `addons/*/generate.mjs`

Nine tables across eight addons: `emberwatch/rules.json`, `ledgerline/floors.json`, `longwatch/mobs.json`, `longwatch/rares.json`, `lorebind/items.json`, `tocsin/bosses.json`, `trailmark/quests.json`, `veinsight/nodes.json`, `wayfarer/atlas.json`.

**The flag forms disagree.** Most take `--game=<path>` only; `emberwatch`, `ledgerline`, `tocsin` and `wayfarer` accept both forms. Passing the wrong one trips the required-argument error. `pnpm tables --game <checkout>` tries both spellings per generator and classifies every table, which is why it should be what runs them rather than eight invocations by hand.

Zone layouts, gather nodes, rare spawns and quest text are in the game's own bundle and nothing serves them, so a table is the only alternative to hand-typing one or doing without. The data is fetched where the addon body is fetched and cached beside it, `.json` only, at most eight files at 512 kB each.

**A stale table is the failure this whole pass exists to make fixable, and it does not look like anything.** Game 0.35.0 re-sited 18 gather nodes in one editorial pass. Nothing on the wire says a node moved, no 404 reports it, no test can catch it. The player walks to a marker and finds an empty field. The stamp in each table's header is the only thing on disk that says how old its claims are.

### `pnpm shots`

Reads a deployed host, defaults to live, which is correct and must not be pointed elsewhere: a preview pictures what a PLAYER reads in Browse.

Only re-capture an addon whose panel VISIBLY changed. A preview is a committed artifact and a re-capture with no visible change is churn. It binds the stage port before it bundles, so a second run refuses and so does one started while `pnpm run stage` is up. It bundles fifteen scenario files and rewrites fifteen manifests, so run it on a quiet tree.

If an addon uses `woc.paint`, its stage scenario must call `stage.frame()` or the capture photographs a blank panel, writes it into `addon.json`, and nothing warns.

### The two the bot owns

`marketplace.json` and the README's addon section are regenerated on main by `.github/workflows/marketplace.yml` in one commit. Do not run `pnpm index` or `pnpm readme` as part of this pass and do not hand-edit either. Neither has a freshness test, deliberately.

## Version bumps: what a regeneration owes a player

Every table stamps the checkout version it read. That stamp moving is bookkeeping.

- **Content moved**: bump that addon's `version` in `addon.json`. An addon changed without a bump is an addon changed for nobody, because `host/updates.ts` only offers a row where the available version is newer. The marketplace will cheerfully serve the new body to fresh installs while every existing player stays on the old one, and a corrected data table is exactly the kind of repair a player can never discover for themselves.
- **Stamp only**: do NOT bump. A bump there is a download that says nothing changed.
- The judgement is about the SET of changes across the branch, not any one file, and it is visible only to whoever looks across the whole branch. Every author verifies their own work correctly and the omission still exists.

## The gate

`pnpm check` covers typecheck, the published-package typecheck, lint, tests, the runtime build and manifest validation. Run it whole before calling anything done.

While iterating, scope: `pnpm lint <path>`, `pnpm exec vitest run addons/<id>`, `pnpm check:ts`. Scoping matters because a whole-tree write can land on a file something else is halfway through saving. For the same reason, a full-tree test run taken while anything else is working has to be re-run before a red result is reported.
