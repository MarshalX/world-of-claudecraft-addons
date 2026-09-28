# AGENTS.md

Working instructions for this repository. `CLAUDE.md` points here. This file and the area rules under `.claude/rules/` it lists are the single source of truth.

## What this is

A userscript addon platform for the browser game World of ClaudeCraft, plus the official addon marketplace. It is **fully external to the game**: no game source is modified and no build is forked.

Tampermonkey and Violentmonkey are first-class. Greasemonkey 4 is best-effort: it has no value-change listener, so cross-tab sync there runs over a BroadcastChannel fallback.

The loader has two halves in different JavaScript realms. The **host** runs in the userscript sandbox and owns GM storage, marketplace fetching, and the registry. The **runtime** is injected into the page realm and owns `window.__game`, the WebSocket hook, DOM, keybinds, audio, and the addon API. They talk over a Comlink-wrapped `MessageChannel`, and only storage, addon source, and registry state cross that boundary.

## Setup

```sh
corepack enable        # pins pnpm from package.json packageManager
pnpm install
```

Node 24 (`.nvmrc`). The tools import `.ts` modules directly and rely on Node's built-in type stripping, which is why every relative import carries an explicit `.ts` extension.

## Commands

| Command | What it does |
|---|---|
| `pnpm check` | **The gate.** Typecheck, typecheck the published package, lint, test, build the runtime, validate manifests. Run before calling anything done. The runtime build is included because `loader/build-runtime.mjs` is the only check on the stylesheet's invariants. |
| `pnpm check:ts` | `tsc --noEmit` only |
| `pnpm check:pkg` | Compiles `packages/types/index.d.ts` ALONE under `--ignoreConfig --strict`, as an addon author's machine would; `check:ts` can resolve declarations through this repository's paths and ambient `@types/node` that a consumer cannot. |
| `pnpm lint` | `biome check --error-on-warnings .` (lint plus format check, no writes) |
| `pnpm fix` | `biome check --write --error-on-warnings .` (applies lint fixes and formatting) |
| `pnpm test` | `vitest run`; `--watch` while iterating |
| `pnpm build` | Bundle the runtime, then build the userscript to `loader/dist/` |
| `pnpm build:runtime` | Runtime IIFE only |
| `pnpm build:runtime:debug` | Runtime IIFE with an inline source map, for debugging the page-realm half |
| `pnpm dev` | Watch build plus the dev server on :5180. Install the loader from `http://localhost:5180/woc-loader.user.js`; the same server is the local marketplace. |
| `pnpm serve` | The addon dev server alone, without the watch build. |
| `pnpm site` | Build the public site (woc.marshal.dev) into `site/dist/`. Reads the latest release for the install button; `--offline` skips that (CI on pull requests). |
| `pnpm site:dev` | Build the site offline, serve it on :5181, rebuild on change. |
| `pnpm run stage` | The addon stage on :5182 (**`run` is required**, see below). One addon mounted through the real loader over a scripted fake world, for screenshots of states not reachable by playing. `b` hides the chrome. `--host` picks the game `/ui/` and `/audio/` proxy to; default pbe. |
| `pnpm build:stage` | The stage bundle alone; `--watch` rebuilds under a running stage server. It binds NO port, so nothing stops it rewriting the bundle under a running capture. |
| `pnpm shots` | Capture every addon's `preview.png` from its stage scenario and write the `preview` block into its `addon.json`. By hand; committed; CI never regenerates it. Takes addon ids to narrow it and starts the stage server itself. `--host` defaults to LIVE, because a preview pictures what a player sees. It binds the stage port before bundling, so a second run, or a run while `pnpm run stage` is up, refuses. It does NOT guard the working tree it reads, so run it on a quiet tree. |
| `pnpm theme` | Regenerate `stage/theme.generated.css` from a deployed game: its `:root` custom properties and its rules for `panel`, `panel-title`, `x-btn`. By hand, after a palette change. `--host` default live. Warns when the loader reads a token WITHOUT a fallback that the game no longer declares. **Two steps: `pnpm theme` then `pnpm fix stage/theme.generated.css`**; the raw output fails formatting and buries the real diff. |
| `pnpm validate` | Validate every `addons/*/addon.json` |
| `pnpm index` | Regenerate `marketplace.json`. CI pins the stamp: `pnpm index -- --timestamp=$(git log -1 --pretty=%ct)` |
| `pnpm readme` | Regenerate the README addon section between its `<!-- addons:start -->` markers; `--check` reports drift. Never hand-edit inside the markers and do not bother running it: `.github/workflows/marketplace.yml` does. A README with no markers is a no-op, because third-party marketplaces copy that workflow; `tests/tools-readme.test.ts` keeps ours. |
| `pnpm cues` | Regenerate `packages/types/cues.generated.d.ts` from a deployed game's sound pack. By hand. `--host` default live. |
| `pnpm icons` | Regenerate `packages/types/icons.generated.d.ts` from the per-class skill-art manifests. By hand. `--host` default live. |
| `pnpm items` | Regenerate `packages/types/items.generated.d.ts` from the item-art manifest. By hand. `--host` default live. The manifest's `name` is the ART SOURCE name and is not generated into anything. |
| `pnpm aura-kinds` | From a game CHECKOUT, regenerate the aura classifier sets behind `world.harmful`, `world.dispellable` and `world.toggle`, into BOTH `packages/types/aura-kinds.generated.d.ts` and `loader/src/shared/aura-kinds.generated.ts` (the runtime needs the values; only the harmful kinds are published). `--game` REQUIRED, never defaulted; a missing file fails; the checkout version is stamped. It throws on a renamed declaration, on an unexpected `aura.id ===` comparison, and when a predicate stops consulting a set it declares. |
| `pnpm tables` | Run EVERY `addons/*/generate.mjs` against a game CHECKOUT (`--game` REQUIRED) and report per table: CONTENT (bump that addon's `version`), STAMP ONLY (do not bump), UNCHANGED. `--dry-run` restores the tables. Only a FAILED generator exits non-zero. By hand after a game release, because a stale table raises no error anywhere. |
| `pnpm changelog` | Regenerate `CHANGELOG.md` from commit titles through the same pinned git-cliff the release uses. Never hand-edit the file. |

**`stage` is written `pnpm run stage` throughout this file because the short form does not run it, and the `run` must not be tidied back out.** pnpm owns `stage` as a subcommand and answers `ERR_PNPM_STAGE_*` errors that read as a broken install. `test` also collides but is benign. Check `pnpm help -a` before adding a script.

**Formatting is Biome, not Prettier.** Run `pnpm fix` rather than fixing style by hand. Config is `biome.json`: 2-space, `lineWidth` 100, single quotes, semicolons, trailing commas.

**`pnpm fix`, `pnpm lint` and `pnpm test` take paths; scope them whenever more than one thing is editing the tree**, since a whole-tree write can land on a half-saved file. While writing one module use `pnpm exec vitest run addons/<id>`, `pnpm lint <path>` and `pnpm check:ts`, then run the whole gate before calling anything done.

**A full-tree test run is not atomic: re-run a red result taken while anything else is working before reporting it.** A real break is red twice.

A bare `pnpm index` stamps `generated` with the current time, so it produces a one-line diff even when nothing changed. That is expected.

## Lint and type strictness

**Read [STYLE.md](STYLE.md) before writing a module.** Most rules here ask for a real split rather than a formatting fix.

The linter runs Biome's **`preset: "all"`** with `--error-on-warnings`, and `tools/lint.mjs` also fails on info-level findings, where many rules here report. `pnpm lint <file>` is the fast check.

**Fix the violation, do not turn off the rule.** `GM_*` members are renamed to `legacy*` at the boundary; `import.meta.dirname` replaces `fileURLToPath`; `export *` becomes named re-exports; a long function is split.

Exemptions are last resort and need a stated reason in `biome.json`. The current set:

| Off | Where | Why it cannot be fixed |
|---|---|---|
| `useQwikValidLexicalScope` | everywhere | There is no Qwik here. |
| `noDefaultExport` | `vite.config.ts`, `vitest.config.ts`, `loader/src/raw.d.ts` | Config is resolved only from a default export; a `?raw` module declaration has only a default. |
| `noNodejsModules`, `noConsole` | `tools/**`, `loader/build-runtime.mjs`, `loader/build-stage.mjs`, `addons/*/generate.mjs` | Node builtins are the purpose and console is the output. |
| `noSecrets`, `noMagicNumbers`, `useTopLevelRegex`, `noMisplacedAssertion`, `noExcessiveLinesPerFile` | `tests/**`, `addons/*/*.test.ts`, `addons/*/stage.ts` | Key combos trip the entropy check, literals are fixtures, `.toThrow(/message/)` is natural, shared assertion helpers are the point, a suite is one subject per file. |
| `noExcessiveLinesPerFile` | `**/*.generated.d.ts` | One name per line so a change is a one-line diff; length is content. |
| `noExcessiveLinesPerFile`, `noHexColors` | `**/*.generated.css` | A transcription of the game's rules; rewriting colours would stop it matching. |
| `noExcessiveLinesPerFile` | `addons/**` | An addon is one file by definition. |
| `noReactSpecificProps`, `noSolidDestructuredProps`, `noJsxPropsBind`, `useSolidForComponent` | `**/*.tsx` | Solid rules with no Solid here; `noReactSpecificProps` contradicts `noUnknownAttribute`. React rules stay on. |

Configured rather than disabled: `useNamingConvention` with `strictCase: false` (`URL`, `ID`, `downloadURL`); `noExcessiveLinesPerFunction` at 200 in `tests/**`. That test block must stay AFTER the `addons/**` block in `biome.json`, so an addon's own suite gets the test relaxations.

The bar for a new exemption is that the rule is IMPOSSIBLE to satisfy there, not inconvenient.

A justified one-site suppression is an inline `biome-ignore` naming the rule, with a reason saying why the CODE is right. An unused suppression is an error: `new Function` is not flagged by `noGlobalEval` in Biome 2.5.5.

TypeScript runs `strict` plus `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters`, `noPropertyAccessFromIndexSignature`, `exactOptionalPropertyTypes`, `allowUnreachableCode: false`, and `allowUnusedLabels: false`.

## Layout

| Path | Role |
|---|---|
| `loader/src/shared/` | Pure, host-agnostic modules used by both realms and the tools. Where the unit tests point. |
| `loader/src/host/` | Userscript sandbox half: GM storage, marketplace fetching, the registry. Never touches the page's JS heap. |
| `loader/src/runtime/` | Page-realm half: `window.__game`, the WebSocket hook, DOM, keybinds, audio, the addon API. |
| `loader/src/runtime/ui/` | The `#woc-addons` root, the stylesheet, both in-game injection points. `anchors.ts` is the one table of game selectors. |
| `loader/src/runtime/ui/kit/` | Every widget the API hands an addon, deliberately large since a one-file addon should not carry its own. Shared widget logic goes in `readout.ts`. |
| `loader/src/runtime/ui/frame/` | Windows. `geometry.ts` is pure and holds every placement rule; `interactive.ts` is the thin interactjs consumer. |
| `loader/src/runtime/bus/` | The inter-addon bus, page realm only: the only way two addons cooperate. |
| `loader/src/runtime/ui/manager/` | The Addons manager, the only preact in the tree. Each `.tsx` is a pure render with state in a sibling `.ts` (`store.ts`, `geometry-store.ts`, `catalog-store.ts` shared by the three marketplace panes, `config.ts`). `fields.ts` renders the shapes `ui/kit/field-shape.ts` declares. |
| `packages/types/` | `@woc-addons/types`, the public `woc` API. One file per domain mirroring `runtime/api/`, split by subject where a domain passed 300 lines (`ui`, `ui-timers`, `ui-controls`; `events`, `events-combat`). No barrels. Published by `release.yml` when the tree's version is ahead of npm, versioned against `apiVersion`. |
| `addons/` | Official marketplace content. Plain JS, no build, not a pnpm workspace. Per addon: `addon.json`, `main.js`, `main.test.ts`, `stage.ts`, `preview.png`, optionally a declared `.json` data table and its `generate.mjs`. `cooldown-bars` is the example authors copy; `dev-harness` checks the loader against a live game. **A `name` may change; an `id` can only be renamed before it ships**: it is the storage namespace, keybind scope and half of every fqid. |
| `tools/` | Command-line entry points, importing the loader's own modules. `catalog.ts` is the ONE reading of `addons/` that anything published uses; `featured.ts` is the one editorial decision. |
| `tools/site/` | The site generator. `build.ts` owns decisions, `pages/` is one module per route, and all content is DERIVED (manifests, `shared/schema.ts`, `CHANGELOG.md`, `packages/types/`). |
| `site/` | Site inputs: `content/docs/*.md`, `content/examples/` (real files the docs include regions of), `assets/`, `static/`. `site/dist/` is generated and ignored. |
| `screenshots/` | The loader's PNGs of record for README and site; alt text and widths in `site/content/shots.json`; derivatives are never committed. Addon screenshots live in the addon's directory. |
| `tests/` | Vitest for the LOADER, Node environment by default. Addon suites live beside their addon. |
| `tests/fakes/` | Shared stand-ins (userscript managers, WebSocket, game DOM, diagnostics, shapes captured from a live client). `addon.ts` is where an addon suite starts. `stage/` deliberately reuses them so a scenario and its suite describe the same world. |
| `stage/` | The addon stage: `index.html`, `stage.css`, generated tokens, `src/` (`stage.ts` mount, `main.ts` page, `picker.ts` controls). `stage/stage.js` is generated and ignored; `stage/theme.generated.css` is generated and COMMITTED. |

## Rules that are load-bearing

### The two realms, the bridge and the bundle

- **zod and semver must never reach the runtime bundle.** Only `shared/schema.ts` imports zod and only `shared/gameversion.ts` and `shared/version.ts` import semver; the runtime uses `import type`, and `loader/build-runtime.mjs` fails otherwise. **A runtime constant the schema also uses gets its own module** (`shared/api-version.ts`, `shared/permissions.ts`), because a value import from a zod module drags in the library. Update rows are computed in the host for the same reason: a string compare sorts `1.10.0` before `1.9.0`.
- **Neither a host module nor a Node module may reach the runtime bundle.** GM globals and `@types/node` are ambient project-wide, so `readFileSync` in a runtime module typechecks; the build fails on any input under `loader/src/host/` or any Node builtin. Shared code goes in `loader/src/shared/`. `runtime/dom-timers.ts` exists because Node's types make `setTimeout` return a `Timeout`.
- **`host/globals.ts` is the only module that names a GM function.** Everything else goes through `host/gm.ts`, which feature-detects; the ambient types declare every GM function whatever the manager ships, so a direct call breaks Greasemonkey silently.
- **Nothing but the handshake touches the `window` message channel.** Both halves drop their window listener once the port is transferred, or a replayed hello gets a second port.
- **The runtime ships without a source map**: it would be inline, 8x the bundle, re-injected every page load. `pnpm build:runtime:debug` reads its flag from `argv`, never `process.env`.
- **Anything that returns a promise rejects rather than throwing.** The manager can hold the registry directly, bypassing Comlink's conversion, so a throwing stub is a real failure.

### Reading the game

- **The world types are a CLAIM about the game.** `runtime/world/game-types.ts` describes a repository this one must never depend on, so every read in `world/backend.ts` is an assertion; `world/shape.ts` checks the live player once. `tests/types-parity.test.ts` proves only that the loader and the published package agree with EACH OTHER.

  **A commit that adds an API SURFACE adds its parity assertions to that file**: the pair in both directions, plus a `wocCarries*` against `WocApi['<facet>']`. `wocSatisfiesPublished` reaches root members only. `SameFields` is the only thing that catches an OPTIONAL field added to one side, since a superset still assigns. **The gate is `tsc --noEmit`, never the runner**: oxc strips types, so vitest stays green on a broken pair.

  **A FALSE direction is not automatically drift.** `PaintOpts.frame` deliberately accepts less than the published `Frame`. Pin the direction that fails when the package over-promises, and comment why the other is absent.
- **A field is published only if it was found ON THE WIRE.** The client builds every entity with defaults (`src/net/blank_entity.ts`), so an unsent field is present, typed, and wrong all session, and `checkEntityShape` passes it. Verify against the send sites: `wireEntity`, `identityFields`, `dynamicFields` in the game's `server/game.ts`, and the helpers `identityFields` delegates to, `writePlayerIdentityWire` (`server/player_identity_wire.ts`: `spc`, `title`, `border`, the guild keys) and `equippedInstanceWire` (`server/equipped_instance_wire.ts`: the `eqi` members); for self-only fields `server/self_scalar_wire.ts` (`SELF_SCALAR_KEYS`) and `selfWireJson`. Never against `src/sim/types.ts`. `selfWireJson` spreads `wireEntity`, adds self-only stats and hands further self keys to emitters it calls (`emitSelfScalarKeys`, `emitGuildAndWeeklySelfKeys`, the quest snapshot emitters), so **read the function and follow its calls, do not grep it**. The catch-up skill re-checks all of this each game release.

  **Not on the wire, so not published:** `moveSpeed`, `onGround`, `jumping`, `stealthed`, `meleeHaste`, `rangedHaste`, `ccDr`, `ccDurationReduction`, `jailed`, `corpseHarvestState`, `craftedCollectionId`, `lootPartyTradeEligibility`, `evadeInPlace`, and the cast queue (`queuedCastAbility`, `queuedCastAim`, `queuedCastTargetId`). Traps among them:
  - The list follows SEND SITES, not declarations: `jailed` is declared like `cheaterMark`, and only `cheaterMark` is sent (`chm`). Server `jailed` references are the session's `JailState`.
  - `ccDr` is an empty Map on the client, so a diminishing-returns display tracks from observed applications (`site/content/docs/patterns.md` says so).
  - The melee `queuedOnSwing` IS sent (as `queued`); the cast queue is not. Finding `queued` and stopping publishes a display that is blank forever.
  - A field absent from `blank_entity.ts` reads `undefined`; one present there reads a plausible default. Never assume the first.
  - **`inCombat` is sent on the SELF record only**, as `cbt`; on every other entity it is permanently false. The decode is guarded and the default is false, so **read it positive-only**: a false is indistinguishable from silence. `world.combat` does so and reports `source: 'self'`; it is not published as `Entity.inCombat` (the parity test carries an `Omit`). `PartyMember.inCombat` IS sent, published, and feeds `world.combat`.

  **Sent and published, with a caveat each:** `castTargetId` (absent means not casting or untargeted); `cheaterMark`; `savedMana` (self only; "no form" and "empty parked pool" both read 0); `offhandWeapon` (self only; null is a real value, an empty offhand); `healPower`; `rangedPower` (every entity). `dualWielding` is not sent: ask `offhandWeapon !== null`. **Sent and deliberately unpublished:** `leaping`, alongside `climbing`, `climbProgress` and `riftSliding`; publishing the movement family is separate work.

  **Read the SEND SITE, and check that it is a send.** `maybe()` fields are delta-guarded, so one live session can make a sent field look unsent (`stats`, `weapon`). Conversely `captureBotDetectionSnapshot` and `liveSessions()` in `server/game.ts` read `inCombat`, `moveSpeed` and `onGround` into server-internal records that never become frames. Cite game code by file and symbol name, never by line.

  **`world.reaction` has no open-world PvP arm.** The game's verdict (`isPvpHostilePlayer` in `src/ui/pvp_hostile_core.ts`) pairs both players' `/pvp` flags with the zone policy under each (`worldPvpZonePolicyAt`), and that policy lives in the game's bundled content, which no frame carries and the loader cannot import, so a flagged stranger reads friendly. `Entity.pvpFlag` is published as who raised the flag, never as hostility.

  **`Entity.targetId` is set only for players and bots.** A mob's target rides `aggro` (`aggroTargetId`), so on mobs `targetId` is permanently null. `world.unit('targettarget')` hides the difference.
- **A decayed corpse stays an entity.** Once its loot window elapses the game refuses to open it and stops drawing it, but the entity keeps `lootable` and `loot`. `world.corpseLoot()` mirrors the decay as `CorpseView.decayed`. `corpseTimer` is a 0/1 sentinel online (sent as `cd`), read internally and not published; where unreadable the loader assumes the window is OPEN, since the client default of 0 would blank a live corpse.
- **Read the wire from the wire, not from the declarations.** The input ack rides `snap.self`; an Entity carries `maxHp`/`resource` where the snapshot said `mhp`/`res`. A wrong read finds nothing and looks like a value that never changes. `tests/fakes/frames.ts` holds shapes captured from a live client; add to it from a real session.
- **A fake must be the same KIND of thing the game hands over.** `__game.input.keybinds` is a class whose matchers read `this`, so `tests/fakes/game-keybinds.ts` is a class: an arrow-function fake passes while the real one throws. Game objects are called defensively, so a future throw costs a warning, not a dead screen. **A generated default must mean something in the domain**: `defaultFor` in `tests/fakes/entity.ts` answers null for `nullable` fields first (`ownerId` is `nullable: true` in `shape.ts`); fix such things in the fixture.
- **Nothing in the game's HUD exists until world entry.** `#ui`, `#options-menu` and the rail ship inside `<template id="game-ui-template">`, cloned into `document.body` at world entry; only `#game-version` is outside it. Injections wait through `ui/hud-mount.ts`, on a `childList`-only observer (a subtree one would run on every HUD mutation).
- **Every game selector goes in `runtime/ui/anchors.ts`**, so a moved selector is one edit; Diagnostics resolves the table live. **It also holds the CLASSES the loader's injections wear, which drift invisibly**: the rail plate lives on `.ui-icon-btn`, the menu entry is `btn ui-btn opt-btn`, and a stale list still renders, just wrongly. Tests compare against the game's markup exported from `tests/fakes/game-dom.ts`, never a literal.
- **Skill art has a SERVED manifest.** `/ui/skills/<class>/mapping.json` lists which ability ids ship a `.webp`; there is no index, so the class list is written out in `tools/icons-core.ts` (the `pet` folder is not a class). `runtime/ui/kit/skill-art.ts` reads it at run time; other ability icons are canvas-composited and have no URL. It carries no display name. **The manifest is the answer even when a file exists unlisted or the game lists an id in `ABILITY_ART_PENDING`**; never reconcile it against a directory listing. `pnpm icons` reads LIVE and **must not union channels**, which diverge both ways; the runtime reads the player's own host and the union is open, so narrowing costs only autocomplete.
- **Item art has a served manifest, and its `name` is provenance.** `/ui/items/mapping.json` is ONE file, read by `runtime/ui/kit/item-art.ts` optimistically until known. `entries` and `generatedBatches` together are exactly the files; `iconSize` is the shape check. `name` is the ART SOURCE name and drifts from display names: published labelled as `ui.icon.itemArtName`, never generated into types. **There is no `world.itemName` and there must not be**: only the game's bundled item table is right.

  Heroic weapon variants ship no file and reuse the base weapon's (`heroicVariantId`, a `heroic_` prefix; `heroic_mark` is not a variant). `itemImageUrl` checks `ITEM_ART_PENDING` (a union of per-content sets that refills when content lands ahead of art) and returns null on a hit. Currency pseudo-items resolve through `currencyImageUrl`, so `icon.item()` returns null for them, correctly. The manifest is not a subset of the item table (`backpack`), so joins must tolerate a miss.
- **Aura art has a served manifest that answers a URL.** `/ui/auras/mapping.json` has `assets` (under `/ui/auras`) and `externalAssets` (a `runtimeUrl` into another family's folder, accepted only as a same-origin absolute path), so `runtime/ui/kit/aura-art.ts` resolves whole URLs. `family` is the shape check. **It is NOT optimistic before the manifest lands**: the family is small and covers the complement of ability art, so guessing would 404 on most rows. `preloadAuras` makes the first row exact. Procedural aura icons never appear in any manifest.
- **A cue is not a file.** `/audio/sfx/runtime-pack.json` collapses numbered variants into one cue and carries each clip's gain, so take names and tuning from the pack. `packages/types/cues.generated.d.ts` stays an OPEN union (`KnownCue | (string & Record<never, never>)`) so a new cue never breaks a working addon. A cue leaving the pack makes `sound.play` on it silent; a mechanic leaving the game does not retire its cue. The `ui_aura_*` cues are the game's aura-alert sounds.
- **`world.dispellable` implements six of the game's seven clauses.** `isDispellableAura` (`src/sim/aura_classify.ts`) also refuses `encounterOwned` auras, and `wireAura` never sends that flag. Encounter-owned auras land on PLAYERS in the Nythraxis, Ignivar and Varkhul fights and the Buried Hoards rift boss rooms (`src/sim/rift/hoard_*.ts`, some ids finished with the boss's entity id, as in `hoard_ice_${boss.id}`), so there `world.dispellable` calls them removable; the published doc names them. No client can do better. `undispellable` also marks wanted buffs (flasks, Fate Threads), so it is not a penalty flag. The by-id clauses are generated by `pnpm aura-kinds`, never hand-written. **When the game's predicate is a named function, diff the WHOLE function against ours**, not just its fields.

  **`world.toggle` implements `isToggleAura` WHOLE**: whether an aura is a MODE (stance, form, stealth, a carried flag) whose long finite duration is fiction. It reads only `kind` and `id`, so it takes party-row auras too. The game's `isOwnAura` is not needed: viewer ids come from player entities and the sim allocates from 1.
- **Never modify the game repository** to make an addon feature easier. Work through the external surfaces (`window.__game`, `/ws`, HUD DOM ids, `/audio/sfx/*`). External-only is the project's whole premise.

### Combat records

- **A heal is attributed from `heal2`, never `heal`, and `cueOnly` is skipped by the FLAG**, not by `amount === 0`: a real heal lands at 0 on a full-health target.
- **A PET is the player for ATTRIBUTION, not for the ATTACK TABLE.** Its records carry the pet's `sourceId`, so match with `ownedByPlayer(id, player)` (a stranger's pet answers no), but keep its swings out of the player's miss, dodge, parry and block line, which it rolls on its own rating. **Read `damage.sourceOwnerId` first**, then the lookup: a pet despawns when its owner dies, exactly when the killing blow needs attributing. A pet row never draws art.
- **An ability's ID and its DISPLAY NAME diverge** (`arcane_shot` is "Fell Shot"): art is filed by id, events carry names. Exactly three ways across:
  1. **`world.abilities`**, your own spellbook, both directions.
  2. **`damage.abilityId`**, the PRIMARY direct hit, plus the few other hits the game names by passing an id to `dealDamage` (`src/sim/combat/damage.ts`): a player pet's ranged bolt (`petRangedAttack`), a guardian's strike, some named procs, and sourceless hazards. It reaches other players but never a mob-sourced hit, because no mob `dealDamage` call passes one.
  3. **`AuraEvent.abilityId`**, the only one that reaches a mob. Limits: application paths plus a few named removals (natural expiries and dispels are bare), aura-applying abilities only, an aura id on application but the casting ability's id on a stack bump, and all its new fields optional. `packages/types/events-combat.d.ts` has the full note.

  **Do not derive a mapping.** The i18n bundle is hashed minified JS per locale, and correlating `spellfx` with damage can mispair and draw the WRONG icon, which is worse than none. Deriving a label from an id stays the last resort. **A pet's ability is outside all three** (its ranged bolt carries the pet's own id, which has no art): name the pet in the tooltip. `/ui/skills/pet/mapping.json` holds pet-bar button ids that nothing on the wire carries, so `pet` is not in `ICON_CLASSES`. Items and mob templates split id and label too, so a generator writes the game's own label into its table; a derived label is disclosed on screen.
- **An event's `ability` is a display NAME.** `spellfx` carries an id; `castStart` carries an id or an ACTIVITY SENTINEL (gathering, fishing, crafting), a set that grows, so match the ones you want and let the rest fall through. `CastStartEvent.ability` is the ONE declaration listing them. **`damage.abilityId` is null except on a primary direct hit and the few named hits above** (autos, DoT ticks and echoes omit it so a cue fires once); fall back to `school`, and **test the value, not the key**, since every emit writes it. `heal2.abilityId` is a different promise: the applying AURA's id, absent from direct heals. Otherwise assume an id only where it is a map KEY (`cooldowns`, `abilityCharges`) or the emit says `.id`; where a name must become an id, slugify it and let failure be cosmetic.

### What an addon may do

- **`net` is read-only.** No send API, no synthetic input, no automation. The game's terms prohibit automating play and it runs a bot detector.
- **Never read `localStorage['woc_session']`.** It holds the account bearer token.
- **Outbound frames are redacted before any addon sees them.** Every socket's first frame carries the bearer token (`{t:'auth-world-N', token, clientSeed}`); `redactOutbound` in `runtime/net/frames.ts` blanks it by FIELD NAME, not frame type, so version bumps cost nothing and the catch-up skill checks the credential is still called `token`. Anything added to `net.onSend` goes through it. It is not airtight: `challengeResponse`'s weak `sig` makes `clientSeed` recoverable in principle, though never the bearer token.
- **A tap runs inside the game's own stack.** Every tap is guarded; a loader throw must never break the frame the game was sending.
- **Addon source is a function BODY, evaluated in strict mode**, with `woc` in scope and a `sourceURL` appended. Strict mode is forced because a sloppy typo would create a global on a shared page.
- **Shadowed globals are a guardrail and the message says so.** `runtime/shadow.ts` proxies `localStorage`, `sessionStorage`, `indexedDB`, `XMLHttpRequest`, `WebSocket` and `__game` to throw and name the sanctioned API. `document.cookie` is NOT shadowed: that needs a proxied `document`, which breaks DOM identity.
- **Declared permissions are a disclosure, not a boundary**, and the install confirmation says so beside the list.

### The addon API: lifecycle, storage and data

- **Installing an addon enables it.** The body is cached at install and the player has already agreed to trust it; the registry write reaches the supervisor through `runtime/host-events.ts`, like a toggle from another tab.
- **A failed addon stays enabled**, with `failed` and the reason recorded, so a not-ready-yet failure recovers on reload.
- **Everything an addon creates goes in its disposal bag, and a pending promise resolves rather than hangs.** Disable is hot. A modal or key capture torn down resolves with a dismissal value; a rejection would run the addon's catch when it can no longer create anything.
- **`addEventListener` capture uses the OBJECT form.** Node's `EventTarget` ignores the boolean on remove, so the teardown silently does nothing.
- **`woc.settings` is TOTAL over what the manifest declares.** `runtime/settings/values.ts` coerces, clamps into `min`/`max`, drops withdrawn `select` options and falls back to the default, so read settings directly with no fallback or `settingNumber`-style helper. Check a `DEFAULT_*` constant is not also an arithmetic floor before deleting it. An undeclared id reads `undefined`, which is a manifest bug. The schema refuses an out-of-bounds default.
- **Storage namespaces split on TWO axes, ownership and scope.** `addon:<fqid>` (addon, account-wide), `char:<fqid>` (addon, one character), `config:<fqid>` (loader: settings, keybinds), `ui:<fqid>` (loader, per-character frame state). Ownership keeps loader data out of `storage.keys()`; scope keeps characters apart. Check any fifth against both axes.
- **Per-character state is keyed on realm plus character name, never `pid`**, which is reissued every session. `perCharacterKey` in `shared/storage-keys.ts` is the one derivation.
- **A per-character READ waits for the character; a WRITE refuses to.** A read resolves late, so it can wait for world entry. A write's value was computed before the character was known, so `woc.storage.character` rejects it and names `world.ready`. `kit/frame-state.ts` drops such writes instead, which is right only because frames are hidden before world entry.
- **The bus refuses self-delivery and makes a subscriber name its publisher** (`on(from, topic, handler)`, or `bus.anySender`), which prevents squatting without every subscriber checking. `from` is stamped in the hub and the message is frozen.
- **A synchronous emit is capped by `MAX_DEPTH`**, decremented in a `finally`, because A to B to A would hang the tab. There is no request-response: awaiting an addon that may be absent is a hang.
- **Game CONTENT ships as a committed table.** A `.json` beside `main.js`, declared in the manifest's `data`, read with `woc.data(name)`; the declaration makes undeclared reads refusable. `.json` only (it returns parsed values), at most eight files of 512 kB (`DATA_MAX_BYTES` in `shared/addon-data.ts`, enforced at install and in CI). Tables are written by `addons/<id>/generate.mjs` from a CHECKOUT (`--game` required, never defaulted, missing source fails, version stamped); regenerate, never hand-edit. `dev-harness/data.json` is hand-written to exercise `woc.data`. The `--game` spellings differ per generator; `.claude/skills/woc-game-catchup/references/generated.md` lists them.

  **A stale table raises nothing**: a player walks to a marker and finds an empty field. The version stamp is the only record of age; regenerate on every game release (`pnpm tables`). **Pin content rules in the addon's suite by ID, in BOTH directions, never by count**, and have generators write `false` rather than drop an absent flag, or a rule leaving the game looks like a field never extracted.

  **A generator must hard-stop on a missing export** (`fail()` in `objectAfter` and siblings); never add a fallback, which would write a stale table under a green run. Point generators at the file that DECLARES an object, not at a re-export.

### Keybinds

- **The keydown listener claims a key ONLY when a bind matched.** It runs in the capture phase before the game, so an eager `stopImmediatePropagation` silently degrades the game's controls. Its editable-element guard is deliberately wider than the game's.
- **Conflict detection reads the game's LIVE keybind profile** (`__game.input.keybinds`), which includes defaults the stored blob lacks. Storage is a fallback that reports its `source` and over-reports on purpose, since it cannot tell held from edge actions.

### Area rules

Rules that apply to one area live in `.claude/rules/`, each scoped by the `paths` in its frontmatter. Claude Code loads one when it reads a matching file; any other agent reads the file before touching those paths. Each rule lives in exactly one place, here or there.

| File | Covers |
|---|---|
| `.claude/rules/ui-kit.md` | The kit, frames, windows, stacking, density, tooltips, and what addon UI may size itself. |
| `.claude/rules/marketplace.md` | Marketplace sources, the dev server, the manager, and the bot-owned generated files. |
| `.claude/rules/release.md` | `@name`, `API_MINOR`, addon `version` bumps, the release workflow, npm publishing, the changelog. |
| `.claude/rules/stage.md` | Stage scenarios, `woc.paint` adoption, preview capture and cropping. |

## Dependencies

Ask before adding one, and install the **latest** version. Do not pick an older major to dodge a peer conflict; move the related stack forward together (vite, vite-plugin-monkey, and vitest majors track each other).

In use: `playwright` (`pnpm shots`, dev only; run `pnpm exec playwright install chromium` once), `sharp` (site derivatives and the `pnpm shots` crop, dev only), `zod` (schemas, host and tools only), `semver` (gameVersion ranges), `comlink` (bridge RPC), `preact` (manager UI only, never exposed to addons), `interactjs` (frame drag and resize), `happy-dom` (DOM tests), `esbuild` (runtime and stage bundles, called directly from `loader/build-runtime.mjs` and `loader/build-stage.mjs`), `markdown-it` and `shiki` (site docs and highlighting, dev only), `vite-plugin-monkey` (userscript build), `@types/node` (types for `tools/*.ts`), `git-cliff` (changelog, dev only, pinned EXACTLY to match `release.yml`).

The preact JSX transform is configured in **three** places that must agree: `tsconfig.json`, `loader/build-runtime.mjs`, and `oxc.jsx` in `vitest.config.ts`. Vitest transforms with oxc, so an `esbuild` key there is silently ignored and JSX compiles against react.

## Testing

Pure modules in `shared/` and `runtime/disposal.ts` are unit tested. DOM-touching modules opt into happy-dom per file:

```ts
// @vitest-environment happy-dom
```

`addons/dev-harness` is the other half of the suite: an ordinary addon fetched over the marketplace path with only the published `woc` in scope. Its `main.test.ts` runs it through the real loader and requires every check to pass, catching surfaces never wired to `woc` and addons written against an API that moved.

**An addon's screenshot is declared by its manifest**: `preview: { file, alt }`, a PNG beside `main.js`, read by the manager (Browse thumbnail, install confirmation), the site (its own AVIF and WebP) and the README. The manager loads it as a cross-origin `<img>`, which works because **the game sets no Content-Security-Policy**; if one lands, fetch it in the host instead. Previews are excluded from the site's undersize report, since a fixed-size panel cannot be captured wider. `pnpm validate` checks it exists, is a PNG by signature, and is under half a megabyte, since a player downloads it inside the game.

**An addon's suite lives beside it as `main.test.ts`**, named by the globs in `vitest.config.ts`, `tsconfig.json` and `biome.json`; `tests/addons-suites.test.ts` fails if any addon has none. Start from `mountAddon` in `tests/fakes/addon.ts`: it parses the REAL manifest through the CI schema, seeds settings BEFORE evaluating, and returns one `dispose`.

**Anything that touches the game's wire or live state is verified by hand against a running PBE client before it is called done.** Mocks test the mock, and wire mistakes fail silently. Use a throwaway userscript that imports the real modules, then turn what it observed into a fixture.

Write tests that fail on regression, not tests that restate the implementation. When fixing a bug, add the failing test first.

## Style

The mechanical rules are in [STYLE.md](STYLE.md), which is the one to read before writing code. What follows is this project's taste rather than the linter's.

- TypeScript strict, ESM, explicit `.ts` extensions on relative imports.
- Private declarations come first in a file, the exported surface last. `useExportsLast` enforces it.
- Module size is a design constraint, not a cleanup task: 50 lines per function body and 300 per file. A factory that outgrows 50 lines is usually holding two concerns; split it while writing it.
- Markdown is not hard-wrapped. One line per paragraph or bullet, however long.
- No em dashes, en dashes, or emoji anywhere: code, comments, docs, or commits. Use commas, colons, parentheses, or "to" for ranges.
- Commit titles are a capitalized imperative verb phrase, with no type prefix, no scope parentheses, and no colon: `Scaffold the addon loader workspace`, not `chore(loader): scaffold workspace`. Every commit carries a body explaining what changed and why.
- Comments explain intent and non-obvious constraints, not what the code says, and never history. No separator comments; if a file needs sections, split it.

## Development target

Develop against `https://pbe.worldofclaudecraft.com` or `pbe2`, where game drift shows up first.

**Channels are not ordered.** Live and the pbe channels diverge in BOTH directions, and a version string does not say which content a channel carries. Read the channel before generating from it; the catch-up skill has the procedure.

Generators that write a COMMITTED artifact (`pnpm cues`, `icons`, `items`, `theme`, `shots`) read LIVE by default and take `--host`, because committed artifacts describe what players run. `pnpm run stage` and `pnpm dev` keep pbe, to show the drift.

**A STAGE FIXTURE must use ids present on BOTH channels.** A preview records no channel, so a live-only id draws on one machine and not another, and the alt text becomes true or false by who ran the capture.
