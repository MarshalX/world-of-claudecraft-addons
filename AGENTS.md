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
| `pnpm dev` | Vite dev mode with live userscript reload |
| `pnpm validate` | Validate every `addons/*/addon.json` |
| `pnpm index` | Regenerate `marketplace.json`. CI pins the stamp: `pnpm index -- --timestamp=$(git log -1 --pretty=%ct)` |

**Formatting is Biome, not Prettier.** Run `pnpm fix` rather than fixing style by hand. Config is `biome.json`: 2-space, `lineWidth` 100, single quotes, semicolons, trailing commas.

A bare `pnpm index` stamps `generated` with the current time, so it produces a one-line diff even when no addon changed. That is expected; CI stamps from the commit instead, so re-running on the same commit is byte-identical.

## Lint and type strictness

The linter runs Biome's **`preset: "all"`**, every rule it ships, with `--error-on-warnings`. The tree is also clean at `--diagnostic-level=info`, so a new info-level finding is a regression even though it does not fail the build by itself. Check with `npx biome check --error-on-warnings --diagnostic-level=info .`.

**Fix the violation, do not turn off the rule.** This is the standing rule for this repo. Almost everything the strict preset flags has a real fix, and reaching for the config first hides work rather than doing it. Worked examples from the initial pass: `GM_*` interface members were renamed to `legacy*` and mapped at the boundary rather than exempting `useNamingConvention`; `import.meta.dirname` replaced `fileURLToPath` rather than exempting `noNodejsModules`; the build script dropped its dev flag entirely rather than exempting `noProcessEnv`; `export *` became explicit named re-exports rather than exempting `noReExportAll`; long functions were split rather than raising a threshold.

Exemptions are last resort and need a stated reason in `biome.json`. The current set is four, all structural, plus two rule configurations:

| Off | Where | Why it cannot be fixed |
|---|---|---|
| `useQwikValidLexicalScope` | everywhere | Demands closures be wrapped in Qwik's `$()`. There is no Qwik here. |
| `noDefaultExport` | `vite.config.ts`, `vitest.config.ts` | Both tools resolve config only from a default export. |
| `noNodejsModules`, `noConsole` | `tools/**`, `loader/build-runtime.mjs` | Node builtins are the purpose and console is the output channel. |
| `noSecrets`, `noMagicNumbers` | `tests/**` | Combos like `'Ctrl+Alt+Shift+Meta+KeyD'` trip the entropy heuristic, and literal values are the fixtures. |

Configured rather than disabled: `useNamingConvention` runs with `strictCase: false`, since `URL` and `ID` are ordinary JS naming and vite-plugin-monkey's `downloadURL` is not ours to rename; `noExcessiveLinesPerFunction` allows 200 lines in `tests/**`, since a suite is a file's worth of cases rather than a function body.

When a suppression really is right at one site, use an inline `biome-ignore` with a reason rather than widening the config. There are two, both in place: the deliberate non-`Error` throw in `tests/disposal.test.ts`, and the `boolean` annotation in `runtime/disposal.ts` that stops `noUnnecessaryConditions` reading a mutated field as dead code.

TypeScript runs `strict` plus `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters`, `noPropertyAccessFromIndexSignature`, `exactOptionalPropertyTypes`, `allowUnreachableCode: false`, and `allowUnusedLabels: false`.

## Layout

| Path | Role |
|---|---|
| `loader/src/shared/` | Pure, host-agnostic modules used by both realms and by the tools. Where the unit tests point. |
| `loader/src/host/` | Userscript sandbox half. Owns GM storage, marketplace fetching, the registry. Never touches the page's JS heap. |
| `loader/src/runtime/` | Page-realm half. Owns `window.__game`, the WebSocket hook, DOM, keybinds, audio, and the addon API. |
| `packages/types/` | `@woc-addons/types`, the public `woc` API surface for addon authors. One file per API domain, mirroring `runtime/api/`. |
| `addons/` | The official marketplace content. Plain JS, no build step, deliberately not a pnpm workspace. |
| `tools/` | `validate.mjs` and `index.mjs`, both importing the same schema the loader uses. |
| `tests/` | Vitest. Node environment by default. |
| `tests/fakes/` | Shared stand-ins: the userscript managers, the page's WebSocket, and frame and entity shapes captured from a live client. Not a suite; the glob only picks up `*.test.ts`. |

## Rules that are load-bearing

- **zod must never reach the runtime bundle.** `loader/src/shared/schema.ts` is the only zod dependant. The runtime imports its types with `import type`, which `verbatimModuleSyntax` erases. `loader/build-runtime.mjs` fails the build if zod resolves there.
- **`net` is read-only.** No send API, no synthetic input, no automation. The game's terms prohibit automating play and it runs a bot detector whose heuristics are not public.
- **Never read `localStorage['woc_session']`.** It holds the account bearer token.
- **Outbound frames are redacted before any addon sees them.** The client's first frame on every socket, including every reconnect, carries that same bearer token as `{t:'auth-world-N', token, clientSeed}`. `redactOutbound` in `runtime/net/frames.ts` blanks it, matched on the field name rather than the frame type so a version bump or a new frame cannot slip past. Anything added to `net.onSend` goes through it.
- **A tap runs inside the game's own stack.** The socket hook's `send` override is synchronous in the game's call, so every tap is guarded. A throw in loader code must never break the frame the game was sending.
- **Read the wire from the wire, not from the declarations.** They disagree silently and both directions have already bitten: the input ack rides `snap.self`, not the snapshot head, and an Entity carries `maxHp`/`resource` where the snapshot that delivered it said `mhp`/`res`. Reading the wrong one finds nothing, raises nothing, and looks exactly like a value that never changes. `tests/fakes/frames.ts` holds shapes captured from a live client; add to it from a real session rather than from `src/sim/types.ts`.
- **The official marketplace cannot be removed.** `canRemoveMarketplace` is called in the host, not the UI, so a hand-crafted call from the runtime still fails.
- **No host module may reach the runtime bundle.** The GM globals are declared ambient project-wide so the sandbox half can reference them, which removes the compiler's protection against the page half doing the same. `loader/build-runtime.mjs` inspects the esbuild module graph and fails on any input under `loader/src/host/`. Shared code goes in `loader/src/shared/`.
- **`host/globals.ts` is the only module that names a GM function.** Everything else goes through `host/gm.ts`, which feature-detects on the shape `readGmSource()` returns. The ambient tampermonkey types declare the full surface, so they say nothing about what a given manager ships: a direct call is what breaks Greasemonkey, and the failure only shows up on a browser nobody tested.
- **Nothing but the handshake touches the `window` message channel.** Both halves drop their window listener the moment the port is transferred, and everything after that is on the port. A listener left behind would hand a second port to anything that replays the hello.
- **Never hand-edit `marketplace.json`.** It is generated by `pnpm index`.
- **Never modify the game repository** to make an addon feature easier. Work through the external surfaces (`window.__game`, `/ws`, HUD DOM ids, `/audio/sfx/*.mp3`). External-only is the project's whole premise.

## Dependencies

Ask before adding one, and install the **latest** version. Do not pick an older major to dodge a peer conflict; move the related stack forward together (vite, vite-plugin-monkey, and vitest majors track each other).

In use: `zod` (schemas, host and tools only), `semver` (gameVersion ranges), `comlink` (bridge RPC), `preact` (manager UI only, never exposed to addons), `interactjs` (frame drag and resize), `happy-dom` (DOM tests), `vite-plugin-monkey` (userscript build).

## Testing

Pure modules in `shared/` and `runtime/disposal.ts` are unit tested. DOM-touching modules opt into happy-dom per file:

```ts
// @vitest-environment happy-dom
```

**Anything that touches the game's wire or its live state is verified by hand against a running PBE client before it is called done.** Mocking those would test the mock, and the failures they produce are silent: a field read at the wrong nesting level, or under the wire's name instead of the entity's, simply never matches and never complains. Build a throwaway userscript that imports the real modules, run it against a live session, and turn what it observed into a fixture. That is how the bootstrap handshake, the `__game` probe, the socket hook, and the `world.on` signatures were each checked.

Write tests that fail on regression, not tests that restate the implementation. When fixing a bug, add the failing test first.

## Style

- TypeScript strict, ESM, explicit `.ts` extensions on relative imports.
- Private declarations come first in a file, the exported surface last. `useExportsLast` enforces it.
- Markdown is not hard-wrapped. One line per paragraph or bullet, however long.
- No em dashes, en dashes, or emoji anywhere: code, comments, docs, or commits. Use commas, colons, parentheses, or "to" for ranges.
- Commit titles are a capitalized imperative verb phrase, with no type prefix, no scope parentheses, and no colon: `Scaffold the addon loader workspace`, not `chore(loader): scaffold workspace`. Every commit carries a body explaining what changed and why.
- Comments explain intent and non-obvious constraints, not what the code says. No separator comments; if a file needs sections, split it.

## Development target

Develop against `https://pbe.worldofclaudecraft.com` or `pbe2`. PBE runs ahead of live, so game drift shows up there first and the per-host probe gets exercised by real change rather than staying speculative.
