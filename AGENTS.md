# AGENTS.md

Working instructions for this repository. `CLAUDE.md` points here; this file is the single source of truth.

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
| `pnpm check` | **The gate.** Typecheck, lint, test, validate manifests. Run before calling anything done. |
| `pnpm check:ts` | `tsc --noEmit` only |
| `pnpm lint` | `biome check --error-on-warnings .` (lint plus format check, no writes) |
| `pnpm fix` | `biome check --write --error-on-warnings .` (applies lint fixes and formatting) |
| `pnpm test` | `vitest run` |
| `pnpm test --watch` | Watch mode while iterating |
| `pnpm build` | Bundle the runtime, then build the userscript to `loader/dist/` |
| `pnpm build:runtime` | Runtime IIFE only |
| `pnpm build:runtime:debug` | Runtime IIFE with an inline source map, for debugging the page-realm half |
| `pnpm dev` | Vite dev mode with live userscript reload |
| `pnpm validate` | Validate every `addons/*/addon.json` |
| `pnpm index` | Regenerate `marketplace.json`. CI pins the stamp: `pnpm index -- --timestamp=$(git log -1 --pretty=%ct)` |

**Formatting is Biome, not Prettier.** Run `pnpm fix` rather than fixing style by hand. Config is `biome.json`: 2-space, `lineWidth` 100, single quotes, semicolons, trailing commas.

A bare `pnpm index` stamps `generated` with the current time, so it produces a one-line diff even when no addon changed. That is expected; CI stamps from the commit instead, so re-running on the same commit is byte-identical.

## Lint and type strictness

**Read [STYLE.md](STYLE.md) before writing a module.** It is the list of rules that actually fire in this repo, with the idiom that satisfies each, plus the two places Biome and TypeScript want opposite things. Writing rule-aware code costs a few seconds; discovering the same violations at the end of a change costs a restructuring pass, because most of these rules are asking for a real split rather than a formatting fix.

The linter runs Biome's **`preset: "all"`**, every rule it ships, with `--error-on-warnings`. The tree is also clean at `--diagnostic-level=info`, and `pnpm lint` FAILS on an info finding: `tools/lint.mjs` reads Biome's JSON summary and treats errors, warnings, and infos alike. It exists because `--diagnostic-level` controls what Biome displays rather than what it fails on, and most of the rules that bite here report at info, so before the gate they accumulated unnoticed until someone read the output. It takes paths, so `pnpm lint <file>` is the fast check while writing one.

**Fix the violation, do not turn off the rule.** This is the standing rule for this repo. Almost everything the strict preset flags has a real fix, and reaching for the config first hides work rather than doing it. Worked examples from the initial pass: `GM_*` interface members were renamed to `legacy*` and mapped at the boundary rather than exempting `useNamingConvention`; `import.meta.dirname` replaced `fileURLToPath` rather than exempting `noNodejsModules`; the build script dropped its dev flag entirely rather than exempting `noProcessEnv`; `export *` became explicit named re-exports rather than exempting `noReExportAll`; long functions were split rather than raising a threshold.

Exemptions are last resort and need a stated reason in `biome.json`. The current set is all structural, plus the rule configurations below it:

| Off | Where | Why it cannot be fixed |
|---|---|---|
| `useQwikValidLexicalScope` | everywhere | Demands closures be wrapped in Qwik's `$()`. There is no Qwik here. |
| `noDefaultExport` | `vite.config.ts`, `vitest.config.ts` | Both tools resolve config only from a default export. |
| `noNodejsModules`, `noConsole` | `tools/**`, `loader/build-runtime.mjs` | Node builtins are the purpose and console is the output channel. |
| `noSecrets`, `noMagicNumbers`, `useTopLevelRegex`, `noMisplacedAssertion`, `noExcessiveLinesPerFile` | `tests/**` | Combos like `'Ctrl+Alt+Shift+Meta+KeyD'` trip the entropy heuristic and literal values are the fixtures; `.toThrow(/message/)` is the natural assertion; an assertion inside a shared helper is the point of the helper; and a suite is one subject per file, which splitting by line count would scatter. |
| `noExcessiveLinesPerFile` | `addons/**` | An addon is one file BY DEFINITION: the manifest names a single `entry` and the loader evaluates it with `new Function`. There is nothing to split into. |
| `noReactSpecificProps`, `noSolidDestructuredProps`, `noJsxPropsBind`, `useSolidForComponent` | `**/*.tsx` | The Solid rule family, and there is no Solid here. `noReactSpecificProps` wants `class` where `noUnknownAttribute` wants `className`, so under `preset: "all"` the two contradict on the same attribute; the rest encode Solid's reactivity model, which preact does not share. The React-family rules stay on, so JSX is still linted. |

Configured rather than disabled: `useNamingConvention` runs with `strictCase: false`, since `URL` and `ID` are ordinary JS naming and vite-plugin-monkey's `downloadURL` is not ours to rename; `noExcessiveLinesPerFunction` allows 200 lines in `tests/**`, since a suite is a file's worth of cases rather than a function body.

The standard for adding to that table is that the rule is IMPOSSIBLE to satisfy in that location, not that satisfying it is inconvenient. "I would have to restructure this" is the rule working.

When a suppression really is right at one site, use an inline `biome-ignore` naming the rule and giving a reason that says why the CODE is right, rather than widening the config. Note that an unused suppression is itself an error (`suppressions/unused`), so a speculative one fails the check: `new Function` is not flagged by `noGlobalEval` in Biome 2.5.5, and a suppression added for it had to come back out.

TypeScript runs `strict` plus `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters`, `noPropertyAccessFromIndexSignature`, `exactOptionalPropertyTypes`, `allowUnreachableCode: false`, and `allowUnusedLabels: false`.

## Layout

| Path | Role |
|---|---|
| `loader/src/shared/` | Pure, host-agnostic modules used by both realms and by the tools. Where the unit tests point. |
| `loader/src/host/` | Userscript sandbox half. Owns GM storage, marketplace fetching, the registry. Never touches the page's JS heap. |
| `loader/src/runtime/` | Page-realm half. Owns `window.__game`, the WebSocket hook, DOM, keybinds, audio, and the addon API. |
| `loader/src/runtime/ui/` | The loader's own UI: the `#woc-addons` root, the stylesheet, and both in-game injection points. `anchors.ts` is the one table of game selectors. |
| `loader/src/runtime/ui/frame/` | Movable and resizable windows. `geometry.ts` is pure and holds every placement rule; `interactive.ts` is the thin interactjs consumer. |
| `loader/src/runtime/ui/manager/` | The Addons manager, the only preact in the tree. Loading lives in `store.ts` and window position in `geometry-store.ts`, so the components stay pure renders. |
| `packages/types/` | `@woc-addons/types`, the public `woc` API surface for addon authors. One file per API domain, mirroring `runtime/api/`. |
| `addons/` | The official marketplace content. Plain JS, no build step, deliberately not a pnpm workspace. |
| `tools/` | `validate.mjs` and `index.mjs`, both importing the same schema the loader uses. |
| `tests/` | Vitest. Node environment by default. |
| `tests/fakes/` | Shared stand-ins: the userscript managers, the page's WebSocket, the game DOM the loader injects into, the diagnostic-channel capture, and frame and entity shapes captured from a live client. Not a suite; the glob only picks up `*.test.ts` and `*.test.tsx`. |

## Rules that are load-bearing

- **zod must never reach the runtime bundle, and neither must semver.** `loader/src/shared/schema.ts` is the only zod dependant and `shared/gameversion.ts` and `shared/version.ts` are the only semver ones. The runtime imports their types with `import type`, which `verbatimModuleSyntax` erases. `loader/build-runtime.mjs` fails the build if either resolves there, and that guard has earned its place TWICE: M5's `API_VERSION` and M6's `PERMISSIONS` were each imported as a VALUE from `schema.ts` and each pulled zod and its fifty locale files into the page bundle. Both now live alone, in `shared/api-version.ts` and `shared/permissions.ts`. **The rule, not the two incidents: a runtime module that needs a CONSTANT the schema also uses gets its own module for that constant.** A value import of anything in a zod module drags the library; a type import costs nothing. The same reasoning is why update rows are computed in the host and carried over the bridge rather than derived in the manager: the comparison needs semver, and the case a hand-rolled one gets wrong is silent, since `1.10.0` sorts before `1.9.0` as a string.
- **`net` is read-only.** No send API, no synthetic input, no automation. The game's terms prohibit automating play and it runs a bot detector whose heuristics are not public.
- **Never read `localStorage['woc_session']`.** It holds the account bearer token.
- **Outbound frames are redacted before any addon sees them.** The client's first frame on every socket, including every reconnect, carries that same bearer token as `{t:'auth-world-N', token, clientSeed}`. `redactOutbound` in `runtime/net/frames.ts` blanks it, matched on the field name rather than the frame type so a version bump or a new frame cannot slip past. Anything added to `net.onSend` goes through it.
- **A tap runs inside the game's own stack.** The socket hook's `send` override is synchronous in the game's call, so every tap is guarded. A throw in loader code must never break the frame the game was sending.
- **A fake must be the same KIND of thing the game hands over, not merely the same shape.** `__game.input.keybinds` is a class instance whose matchers read `this`, and a fake built from arrow functions closing over local Maps has no `this` to lose. That fake passed 947 tests while the loader threw on the first real conflict lookup and blanked the manager pane, because the manager reads conflicts during render. `tests/fakes/game-keybinds.ts` is a class for that reason. Anything reached through a game object is also called defensively: a future update can leave something callable in place that throws when called, and the cost of that has to be a missing warning rather than a dead screen.
- **Read the wire from the wire, not from the declarations.** They disagree silently and both directions have already bitten: the input ack rides `snap.self`, not the snapshot head, and an Entity carries `maxHp`/`resource` where the snapshot that delivered it said `mhp`/`res`. Reading the wrong one finds nothing, raises nothing, and looks exactly like a value that never changes. `tests/fakes/frames.ts` holds shapes captured from a live client; add to it from a real session rather than from `src/sim/types.ts`.
- **The official marketplace cannot be removed.** `canRemoveMarketplace` is called in the host, not the UI, so a hand-crafted call from the runtime still fails.
- **No host module may reach the runtime bundle.** The GM globals are declared ambient project-wide so the sandbox half can reference them, which removes the compiler's protection against the page half doing the same. `loader/build-runtime.mjs` inspects the esbuild module graph and fails on any input under `loader/src/host/`. Shared code goes in `loader/src/shared/`.
- **No Node module may reach it either.** `@types/node` is ambient project-wide because `tools/*.ts` needs it, so the compiler will accept `readFileSync` in a runtime module. `loader/build-runtime.mjs` fails the build on any `node:` or bare builtin import, the same way it does for host modules. The same ambience is why `runtime/dom-timers.ts` exists: `setTimeout` returns a `Timeout` under Node's types and a number in a browser, and the runtime only ever runs in a browser.
- **The local dev source is a build-time constant, not user input.** `LOCAL_ORIGIN` in `shared/marketplace.ts` is what puts `localhost` in the userscript's `@connect` list, and `normalizeMarketplaceUrl` rejects it like any other non-GitHub host. The set of origins the loader can reach is therefore still fixed at build time. `MarketplaceSource` is a union rather than an optional field so a caller building a URL has to say which kind of source it is looking at.
- **A marketplace id is re-derived on read, never trusted from storage.** Only the owner, repo, and ref a user actually chose are persisted; `fromStored` re-runs the same validation that accepting them did. The id is the storage namespace of every addon installed from that source, so a stored id a player could edit would be a way to point one source's addon at another's settings and data.
- **Installing an addon enables it, and the registry write is what starts it.** The body is cached at install so that enabling is never a network call, which means by the time the row exists the code is already on disk and there is nothing left for a separate enable step to defer. The player has already accepted a confirmation saying to install only what they would trust as a browser extension; not running it is a second decision they did not ask to make. `registry.changed` is what reaches the supervisor, through `runtime/host-events.ts`, so the start is the same path a toggle in another tab takes rather than a special case at the install site.
- **A failed addon stays enabled.** The supervisor records `failed` with the reason and leaves the registry alone. Auto-disabling would throw away what the player asked for to record something the loader already knows, and a failure caused by the game not being ready yet would then need a manual re-enable to recover from. Reload is what tries again.
- **Addon source is a function BODY, evaluated in strict mode.** No export, no registration call, `woc` in scope, and a `sourceURL` comment appended so traces name the addon rather than `<anonymous>`. Strict mode is prepended rather than left to the author: a sloppy-mode body turns an undeclared assignment into a property of the page's global object, which is one addon's typo becoming another addon's mystery variable, on a page shared with the game.
- **Shadowed globals are a guardrail and the message says so.** `runtime/shadow.ts` hands each addon proxies for `localStorage`, `sessionStorage`, `indexedDB`, `XMLHttpRequest`, `WebSocket`, and `__game` that throw and name the sanctioned API. `document.cookie` is on the design's list and is deliberately NOT shadowed: it would mean handing addons a proxied `document`, which breaks every identity comparison in the DOM. A guardrail that subtly breaks correct DOM code is worse than the gap it closes.
- **The dev watcher polls BODIES, never the index.** A new addon directory or an edited manifest needs an explicit refresh. Index polling would emit a `market.changed` on every tick and repaint the manager continuously to report that nothing moved.
- **The dev server's index is generated per request and its `generated` stamp is an mtime, not a clock.** The ETag is taken over the response body, so a timestamp in it would make every index request a fresh body and the conditional GET would never answer 304.
- **`host/globals.ts` is the only module that names a GM function.** Everything else goes through `host/gm.ts`, which feature-detects on the shape `readGmSource()` returns. The ambient tampermonkey types declare the full surface, so they say nothing about what a given manager ships: a direct call is what breaks Greasemonkey, and the failure only shows up on a browser nobody tested.
- **Nothing but the handshake touches the `window` message channel.** Both halves drop their window listener the moment the port is transferred, and everything after that is on the port. A listener left behind would hand a second port to anything that replays the hello.
- **Never hand-edit `marketplace.json`.** It is generated by `pnpm index`. The dev server does not read it at all: `tools/serve-core.ts` builds its own index from `addons/*/addon.json` on every request, through the same reader `pnpm validate` uses, so a manifest saved mid-session is visible on the next refresh and the dev index cannot diverge from what CI would accept.
- **The runtime ships without a source map.** Inline is the only form that could work, since the host injects the bundle as `<script>` textContent and an external `.map` has no URL to resolve against, but that is a reason it must be inline rather than a reason to have it. It is 8x the bundle (149 kB to 1.18 MB) and the host re-injects the whole string on every page load, so it is a per-visit cost rather than a download-once one. `pnpm build:runtime:debug` turns it on. The flag is read from `argv`, never `process.env`, which this script deliberately has no dependency on.
- **A window's placement rules are pure, and its gestures are not.** Everything a player can notice (a window cannot be dragged somewhere it can never be dragged back from, a restored position survives a smaller monitor, a persisted box is validated before it reaches a style property) lives in `ui/frame/geometry.ts` with a Node test. interactjs handles pointer capture, touch, and edge hit areas, and nothing else. A NaN reaching a style property drops the declaration silently rather than raising, which is why the persisted box is parsed rather than trusted.
- **Nothing in the game's HUD exists until world entry.** `#ui`, `#options-menu`, the micro-button rail and everything in it ship inside `<template id="game-ui-template">` and are cloned into `document.body` only when the player enters the world; `#game-version` is the sole anchor outside it. A one-time lookup at DOMContentLoaded finds none of them and fails silently, which is exactly what happened. Injections wait through `ui/hud-mount.ts`, on a `childList`-only observer: the clone is one fragment insert of direct body children, and a subtree observer would run a selector against every HUD mutation for the rest of the session. Reading `index.html` for this is a trap, since grepping an id shows the element but not the `<template>` that encloses it.
- **Every game selector goes in `runtime/ui/anchors.ts`.** They are the external surface the whole project rests on and the game owes us nothing for any of them, so a game update that moves one has to be a single edit. The manager's Diagnostics pane resolves the table live, which is what makes drift visible before an addon author reports it as a bug.
- **The addon root is a sibling of `#ui`, and its stylesheet is unlayered.** The HUD rebuilds its own subtree, so a root inside it would be swept away with whatever re-rendered. Every game rule lives inside `@layer base` or `@layer components`, and an unlayered rule outranks any layered one whatever the specificity, so addon styling survives a game update that adds a layer or reorders the ones it has. The flip side is that these rules also outrank the game's, so they stay scoped to loader-owned elements.
- **The manager has three independent ways in, and one of them is not in the game.** The game-menu entry and the rail button both live in game DOM and can be taken away by a game update; `GM_registerMenuCommand` is host-side and cannot. That command is registered whether or not the runtime ever connects, and a failed bridge handshake costs the registry rather than the UI, because the manager is how a player finds out the loader is broken.
- **Anything that returns a promise rejects rather than throwing.** Comlink turns a synchronous throw into a rejection, so the bridge hides the difference and a direct caller does not. The manager holds the registry directly when it can, so a `pending()` stub that throws is a real failure mode the bridge tests cannot see.
- **The keydown listener claims a key ONLY when a bind matched.** The loader's dispatcher runs in the capture phase, ahead of the game's own handler, so `stopImmediatePropagation` is a decision about whether the game gets to act at all. Calling it eagerly quietly degrades the controls of a game the player is still playing, and nothing reports it. The editable-element guard is deliberately WIDER than the game's, which checks only input and textarea: declining where the game would act costs one keystroke, acting where the game declines eats a character out of something the player is typing.
- **Conflict detection reads the game's LIVE keybind profile, not localStorage.** `__game.input.keybinds` carries the game's own matchers and every DEFAULT binding. The stored blob holds only what the player explicitly saved, so on an account that never opened Key Bindings it is empty and every key reads as free. Storage is the fallback, and the reading carries a `source` so the manager can say the answer is incomplete rather than presenting it as clean. Held actions (movement) match the bare code with modifiers ignored while edge actions match the whole chord, and the stored string does not say which it is, so the fallback over-reports on purpose.
- **A cue is not a file.** The game serves `/audio/sfx/runtime-pack.json`, which collapses a numbered family into one cue with variants: 432 files are 220 cues, and it also carries the gain the game normalized each clip to. Take cue names and tuning from the pack. A directory listing would offer addon authors 212 names that do not resolve, and would play every cue untuned.
- **`addEventListener` capture uses the OBJECT form, never the boolean shorthand.** Node's `EventTarget` accepts a boolean on add and then ignores it on remove, so the shorthand leaves the listener attached and the teardown silently does nothing. Browsers honour both, which is exactly what makes the shorthand the version that looks fine until it is not.
- **The three storage namespaces are split by ownership.** `addon:<fqid>` is the addon's own KV and only addon code writes there; `config:<fqid>` is loader-owned settings and keybind overrides; `ui:<fqid>` is per-character frame state. Merging them would let an addon calling `storage.set('values', ...)` become the addon whose settings never persist, and would make `storage.keys()` report loader data as the addon's own.
- **Per-character state is keyed on realm plus character name, never on `pid`.** The pid from the `hello` frame is the sim's entity id for one session and is reissued on the next, so anything keyed on it scatters across a new set of storage keys every login and reads to the player as nothing ever having been saved.
- **Everything an addon creates goes in its disposal bag, and a pending promise resolves rather than hangs.** Disable is hot, with no page reload, so a bare `setInterval` runs forever against DOM the loader has already removed. An open modal or a key-capture prompt torn down at disable resolves with a dismissal value: a rejection would run the addon's catch at exactly the moment it can no longer safely create anything.
- **Nothing the manager reads on open goes to the network.** `market.list`, `registry.list` and `registry.updates` all answer from what the host already holds, and Refresh is the only control that fetches. An update badge that decided to fetch would put a request per marketplace in front of every open of the window, which is the version of the feature that gets switched off. The three marketplace panes share one `catalog-store.ts` for the same class of reason: three copies of "the source list plus the installed set" would go out of date independently, and Browse would offer an Install for a source the Marketplaces pane had already removed.
- **A pin means "stop offering", never "install that instead".** A marketplace serves one version per ref, so there is no older body to go back to. `registry.setPin` fetches nothing; it takes the addon out of the update list and out of "update all". The row stays visible carrying its pin, because the only thing a pin needs a UI for is saying that an update exists and that the player's own decision is holding it back.
- **The contents-API fallback is reached only on a 404, and only for a repository.** A 403 is the unauthenticated rate limit, and answering it with one request per addon would spend what is left of the hour discovering there is no quota. A repository whose `addons/` listing 404s too is one the loader cannot see at all, so the error reported is the one about the index the player was looking for. A repository with more directories than fit in the quota is REFUSED rather than truncated: reading the first forty and presenting them as the source's contents would be a silent lie about what it offers.
- **`MarketApi.setRef` moves where a source reads from and never its id.** The id is derived from owner and repo, so everything installed from that source keeps its fqid and therefore its settings, keybinds, and data. The cached rows are dropped on the way, or a failed read of the new tag would leave the previous tag's addons on screen under the new tag's name.
- **Declared permissions are a disclosure, not a boundary, and the pane says so.** Addon code runs in the page realm with the page's globals in scope, so a manifest that declares nothing is not thereby prevented from doing anything. The install confirmation shows the declared list next to that sentence: a permission list with nothing beside it reads as a sandbox, and there is not one.
- **Never modify the game repository** to make an addon feature easier. Work through the external surfaces (`window.__game`, `/ws`, HUD DOM ids, `/audio/sfx/*`). External-only is the project's whole premise.

## Dependencies

Ask before adding one, and install the **latest** version. Do not pick an older major to dodge a peer conflict; move the related stack forward together (vite, vite-plugin-monkey, and vitest majors track each other).

In use: `zod` (schemas, host and tools only), `semver` (gameVersion ranges), `comlink` (bridge RPC), `preact` (manager UI only, never exposed to addons), `interactjs` (frame drag and resize), `happy-dom` (DOM tests), `vite-plugin-monkey` (userscript build), `@types/node` (types only, for `tools/*.ts`).

The preact JSX transform is configured in **three** places and they have to agree: `jsx`/`jsxImportSource` in `tsconfig.json`, `jsx`/`jsxImportSource` in `loader/build-runtime.mjs`, and `oxc.jsx` in `vitest.config.ts`. Vitest 4 transforms with oxc, so an `esbuild` key there is accepted and then silently ignored, which shows up as JSX compiling against react.

## Testing

Pure modules in `shared/` and `runtime/disposal.ts` are unit tested. DOM-touching modules opt into happy-dom per file:

```ts
// @vitest-environment happy-dom
```

`addons/dev-harness` is the other half of the suite: an ordinary addon, fetched over the marketplace path and evaluated with only the published `woc` object in scope. `tests/addons-dev-harness.test.ts` runs it through the real loader and requires every check to pass, which catches the two failures a unit suite cannot see: a surface that was never wired to the object an addon is handed, and an addon written against an API that has since moved. It found one on the day it was written, and it was real: before world entry `woc.world.entities` was a bare Map shared by every addon, so the published "set, delete, and clear throw" contract did not hold and one addon's write would have landed in what every other addon read.

**Anything that touches the game's wire or its live state is verified by hand against a running PBE client before it is called done.** Mocking those would test the mock, and the failures they produce are silent: a field read at the wrong nesting level, or under the wire's name instead of the entity's, simply never matches and never complains. Build a throwaway userscript that imports the real modules, run it against a live session, and turn what it observed into a fixture. That is how the bootstrap handshake, the `__game` probe, the socket hook, and the `world.on` signatures were each checked.

Write tests that fail on regression, not tests that restate the implementation. When fixing a bug, add the failing test first.

## Style

The mechanical rules are in [STYLE.md](STYLE.md), which is the one to read before writing code. What follows is the part that is this project's taste rather than the linter's.

- TypeScript strict, ESM, explicit `.ts` extensions on relative imports.
- Private declarations come first in a file, the exported surface last. `useExportsLast` enforces it.
- Module size is a design constraint, not a cleanup task: 50 lines per function body and 300 per file. A factory that outgrows 50 lines is usually holding two concerns; split it while writing it rather than when the linter says so.
- Markdown is not hard-wrapped. One line per paragraph or bullet, however long.
- No em dashes, en dashes, or emoji anywhere: code, comments, docs, or commits. Use commas, colons, parentheses, or "to" for ranges.
- Commit titles are a capitalized imperative verb phrase, with no type prefix, no scope parentheses, and no colon: `Scaffold the addon loader workspace`, not `chore(loader): scaffold workspace`. Every commit carries a body explaining what changed and why.
- Comments explain intent and non-obvious constraints, not what the code says. No separator comments; if a file needs sections, split it.

## Development target

Develop against `https://pbe.worldofclaudecraft.com` or `pbe2`. PBE runs ahead of live, so game drift shows up there first and the per-host probe gets exercised by real change rather than staying speculative.
