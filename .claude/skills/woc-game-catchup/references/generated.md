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

The network five default to `https://worldofclaudecraft.com` and take `--host`. They default to LIVE because a committed artifact describes what a PLAYER is running, and players are on live; live does not reliably lead. The channels diverge in both directions and a version string does not tell you which content each has.

**A channel that answers nothing is unmeasured.** Record the absence in the report; never assume it matches another channel or last cycle's reading, and never let a run of silences harden into "that channel is gone".

**So establish first whether the checkout tag is what live is serving.** If live has not deployed the audited tag, the network five cannot produce its content, and running them writes the OLD content over your artifacts while reporting success. Regenerate them when live catches up, and list them in the report as owed.

## One by one

### `pnpm cues`

Reads `/audio/sfx/runtime-pack.json`. Writes `packages/types/cues.generated.d.ts`.

A cue is not a file: the pack collapses a numbered family into one cue with variants and carries the gain each clip was normalised to, so there are far fewer cues than files. The union stays OPEN (`KnownCue | (string & Record<never, never>)`) because the set is content and a game release adds to it before these types catch up. A published type must not be able to break a working addon.

### `pnpm icons`

Reads `/ui/skills/<class>/mapping.json`, nine files, one per class, with no index over them, so the class list is written out in `tools/icons-core.ts`. Writes `packages/types/icons.generated.d.ts`.

**Only nine of the folders under `skills/` are classes.** The other is `pet`, and its eight ids are the game's own pet-BAR buttons, which `src/ui/pet_action_icons.ts` calls "deliberately NOT ability ids". Nothing on the wire carries one, so an addon cannot obtain one and `pet` is deliberately absent from `ICON_CLASSES`. Do not add a folder to that list because it appeared; check what an addon could do with the ids in it.

Do not union the channels. Narrowing costs autocomplete and nothing else, because the runtime reads the manifest from whichever host the player is on and the published union is open where it is used. Read a count going DOWN as art moving rather than art landing, and check nothing in the tree names a retired id as an id.

### `pnpm items`

Reads `/ui/items/mapping.json`, one file. Writes `packages/types/items.generated.d.ts`.

The manifest's `name` is the ART SOURCE name and drifts from the game's display name, which is why it is published as `ui.icon.itemArtName`, labelled, and deliberately not generated into the types. The manifest is not a subset of the item table either: `backpack` is in it and is not an item.

### `pnpm theme`

Starts from `play.html`, follows the `<link rel="stylesheet">` it finds because the sheet is content-hashed, and transcribes the `:root` custom properties plus the game's own rules for `panel`, `panel-title` and `x-btn`. Writes `stage/theme.generated.css`.

**It is TWO steps.** `pnpm theme` then `pnpm fix stage/theme.generated.css`. It transcribes minified CSS and runs no formatter of its own, so the raw output fails the gate on formatting and, worse, the unformatted diff rewrites all seven borrowed-class rules as noise and hides the real change. Formatted, the borrowed rules come back byte-identical and the diff is exactly what moved.

It warns when the loader's own sheet reads a token WITHOUT a fallback that the game no longer declares. Read that warning: it is a rule that has silently stopped applying.

### `pnpm aura-kinds`

Reads `src/sim/aura_classify.ts` and `src/sim/persistent_aura.ts` from a checkout. Writes BOTH `packages/types/aura-kinds.generated.d.ts` and `loader/src/shared/aura-kinds.generated.ts`, because there is no endpoint to re-read at run time so the runtime carries the value as well as the types.

It carries TWO rules: the harmful kinds and refused ids behind `world.harmful`/`world.dispellable`, and the toggle rule behind `world.toggle`. Each set's parse is guarded by a check that the game's own predicate still CONSULTS it, so declarations surviving a rewritten predicate fail the run instead of mirroring a rule the game stopped applying.

**The generated file's layout is formatter-sensitive and the fix is in the renderer.** Biome collapses a short array onto one line and keeps one carrying a comment expanded, so a set that shrinks enough would silently change shape and break the round-trip test that proves the file is what the generator writes. Each toggle set body therefore opens with a comment line, deliberately. Do not remove one to tidy it.

**Its flag is space separated: `--game <path>`.** It is `process.argv.indexOf('--game')`. `--game=<path>` trips the required-argument error, which reads as a missing flag rather than a wrong one. `--game` is required and never defaulted, a missing source file is a failure rather than a warning, and the checkout's version is stamped into both headers.

### `addons/*/generate.mjs`

`emberwatch/rules.json`, `ledgerline/floors.json`, `longwatch/mobs.json`, `longwatch/rares.json`, `lorebind/items.json` (with `items-2.json` and on: the generator splits it into parts under the per-file cap and checks the manifest declares them), `purelight/refused.json`, `satchel/bags.json`, `tocsin/bosses.json`, `trailmark/quests.json`, `veinsight/nodes.json`, `wayfarer/atlas.json`. The list goes stale when an addon lands; `ls addons/*/generate.mjs` and the outputs `pnpm tables` names are the authority.

**The flag forms disagree.** Five take `--game=<path>` only (`longwatch`, `lorebind`, `trailmark`, `veinsight`, `wayfarer`); five accept both (`emberwatch`, `ledgerline`, `purelight`, `satchel`, `tocsin`). The wrong one trips the required-argument error. Classify a generator by RUNNING it both ways, never by reading its source: the parsers do not share an idiom (`emberwatch` matches the inline form with a regex) and the refusal wording differs per generator, so grepping for one phrase misclassifies the rest.

`pnpm tables --game <checkout>` tries both spellings per generator and classifies every table, so use it rather than invoking each by hand. **It reports a generator that broke for ANY reason as a flag error**, because it retries both spellings and surfaces the last failure, which is the argument-form one. Run the generator directly before believing the flag.

Zone layouts, gather nodes, rare spawns and quest text are in the game's own bundle and nothing serves them, so a table is the only alternative to hand-typing one or doing without. The data is fetched where the addon body is fetched and cached beside it, `.json` only, at most eight files at 512 kB each.

**A stale table is the failure this whole pass exists to make fixable, and it does not look like anything.** Nothing on the wire says a gather node moved, no 404 reports it, no test can catch it. The player walks to a marker and finds an empty field. The stamp in each table's header is the only thing on disk that says how old its claims are.

### `pnpm shots`

Reads a deployed host, defaults to live, which is correct and must not be pointed elsewhere: a preview pictures what a PLAYER reads in Browse.

**Capture EVERY addon, diff the result, and keep every preview whose bytes changed.** A preview photographs the game's ART as well as the addon's DOM, so an addon nobody edited can still be picturing something stale when the game re-encodes its portraits. Deciding what to capture by reading addon diffs cannot see that, and restoring a capture because the change looked too small to notice puts the file back to a picture of an older game and leaves the same decision for the next pass.

Decide with numbers, in two steps. **First re-capture anything whose bytes moved, because a capture is not always reproducible.** Most are, so an unchanged checksum is a real all-clear. `emberwatch` is not: its width varies between runs from one tree with no value to converge on, so two runs agreeing is luck. Re-capture it several times, and restore it unless something in the picture other than its width moved. Only a diff that reproduces is worth measuring, and for `emberwatch` that means a stable size across several runs.

**Then measure it, to know what you are committing rather than to decide whether to.** Take the max per-channel delta and the count of pixels above about 32. A webp re-encode of the game's art peaks around 40 to 50 with a handful of pixels over 32 and no bounding box; keep it. A tight box with large deltas is a layout shift and is usually your own change. Where the diff SITS names the cause: scattered across icons is the game's art, a localized rectangle is your own change, and text-wide speckle under about 20 is capture noise between Chromium builds.

It binds the stage port before it bundles, so a second run refuses and so does one started while `pnpm run stage` is up. It bundles every scenario file and rewrites the `preview` block of every manifest it captures, so run it on a quiet tree and check afterwards that the only manifest changes left are the version bumps you meant. An addon with no `preview` block is not capturable, which is not a gap: `dev-harness` ships without one.

If an addon uses `woc.paint`, its stage scenario must call `stage.frame()` or the capture photographs a blank panel, writes it into `addon.json`, and nothing warns.

### The two the bot owns

`marketplace.json` and the README's addon section are regenerated on main by `.github/workflows/marketplace.yml` in one commit. Do not run `pnpm index` or `pnpm readme` as part of this pass and do not hand-edit either. Neither has a freshness test, deliberately.

## Version bumps: what a regeneration owes a player

Every table stamps the checkout version it read. That stamp moving is bookkeeping.

- **Content moved**: bump that addon's `version` in `addon.json`. An addon changed without a bump reaches nobody, because `host/updates.ts` only offers a row where the available version is newer: fresh installs get the new body while every existing player stays on the old one, and a player can never discover a corrected data table for themselves.
- **Stamp only**: do NOT bump. A bump there is a download that says nothing changed.
- Judge the SET of changes across the branch. Every author can verify their own work correctly and the omission still exists, visible only to whoever looks across the whole branch.

## The gate

`pnpm check` covers typecheck, the published-package typecheck, lint, tests, the runtime build and manifest validation. Run it whole before calling anything done.

While iterating, scope: `pnpm lint <path>`, `pnpm exec vitest run addons/<id>`, `pnpm check:ts`, because a whole-tree write can land on a file something else is halfway through saving. For the same reason, re-run a red full-tree test result taken while anything else is working before reporting it.
