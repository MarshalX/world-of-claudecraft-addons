# Style

Biome runs with `preset: "all"` and `--error-on-warnings`, and the TypeScript config turns on every strictness flag that exists. Both are deliberate. The cost is that a lot of ordinary-looking code is rejected, and finding that out at the end of a change is expensive: the fix is usually a real restructuring, not a formatting pass.

This file is the list of rules that actually fire here, with the idiom that satisfies each. It is written from the violations a real milestone produced, not from Biome's rule index. Read it before writing a module, not after.

`pnpm fix` formats and applies the safe fixes. Everything below is what it cannot fix for you.

## Numbers to design against

| Limit | Value | Where |
|---|---|---|
| Line width | 100 | everywhere |
| Lines per function body | **50** | everywhere except `tests/**` (200) |
| Lines per file | **300** | everywhere except `tests/**` and `addons/**` (off) |
| Cognitive complexity | **15** | everywhere |
| Parameters | **4** | everywhere |

The two that shape the code most are the function and file limits. A `createX` factory that closes over state and returns an object hits 50 lines fast. Plan for it: when a factory needs more than about three closures, the state it holds is usually two concerns rather than one, and splitting it is the fix Biome is asking for. `runtime/supervisor.ts` is the worked example, split into a status board, a running set, a queue, and the coordinator over them.

## Module shape

**Exports go last** (`useExportsLast`). Declare everything as a plain `function`/`const`/`interface`, then one export block at the bottom.

```ts
function helper(): void {}
interface Thing {}

export type { Thing };
export { helper };
```

**Do not re-export what you imported** (`noExportedImports`). If module A imports `X` from B to use it, A must not also `export { X }`. Consumers import from B.

**Do not end a file with a run of re-exports** (`noBarrelFile`). A tail of `export { a } from './a'; export { b } from './b';` makes the file a barrel and is rejected. Barrels are only for a directory's `index.ts` public surface.

Both of these bite the same way: you split a module, tests import a constant from the old path, and the tempting fix is a re-export. Update the test's import instead.

## Control flow

| Rejected | Write instead |
|---|---|
| `cond ? a : b` (`noTernary`) | a named helper returning `a` or `b`, or `if`/`return` |
| `continue` (`noContinue`) | invert the condition and nest the body |
| `void promise` (`noVoid`) | `promise.catch(() => undefined)` in a named `(): void` helper |
| `await` inside a loop (`noAwaitInLoops`) | `Promise.all`, or `inSeries` from `shared/sequence.ts` when the sequencing is deliberate |
| `a & b`, `x \| 0` (`noBitwiseOperators`) | arithmetic, or a different approach entirely |

`noTernary` is the single most frequent violation. In JSX it is worse, because the conditional-render idiom is a ternary. The shape that works:

```tsx
function StatusBadge(props: { status: StatusView | null }) {
  if (props.status === null) {
    return null;
  }
  return <span className={`woc-badge woc-badge-${props.status.tone}`}>{props.status.label}</span>;
}
```

A small named component per conditional branch, rather than `{x ? <A /> : <B />}` inline. It reads better anyway; treat the rule as a prompt to name the thing.

For `noAwaitInLoops`, be honest about which you mean. `Promise.all` when the work is independent; `inSeries` when order or one-at-a-time matters and you can say why (rate limits, claim order, a single-process server). Writing `inSeries` is a claim that the serialization is intentional.

## Values and names

**No magic numbers** (`noMagicNumbers`). Every literal number outside a `const` is rejected, including in an array literal. Name it, with a comment saying what it means:

```ts
const MS_PER_SECOND = 1000;
/** iOS Safari auto-zooms a page when a focused field is under 16px. */
const MIN_FIELD_FONT_PX = 16;
```

**Object keys follow `useNamingConvention` too.** This catches you whenever the keys are not yours: game cue names (`ui_ready_check`), DOM globals (`XMLHttpRequest`), manifest ids (`open-on-load`), key codes (`KeyW`). The fix is entry pairs, never an exemption, and it documents the ownership:

```ts
// Entry pairs because every key here is a name the PAGE owns, not one this
// project chose.
const SHADOW_PAIRS = Object.freeze([
  ['localStorage', 'woc.storage'],
  ['XMLHttpRequest', 'fetch'],
] as const);

const ALTERNATIVES: Record<string, string> = Object.fromEntries(SHADOW_PAIRS);
```

**`let x;` is rejected** (`noEvolvingTypes`, `noImplicitAnyLet`). Annotate it: `let entries: Dirent[];`.

**An empty block is rejected** (`noEmptyBlockStatements`). An empty `catch` needs a comment inside saying why swallowing is correct; an empty function body needs a `return` of something meaningful.

## Where Biome and TypeScript disagree

These are the subtle ones. Both tools are configured strictly and in two places they want opposite things.

**`useLiteralKeys` vs `noPropertyAccessFromIndexSignature`.** Biome wants `headers.etag` rather than `headers['etag']`. TypeScript forbids dotting into an index signature. Neither is wrong; the resolution is a helper that does the computed access, so the call site has no literal key at all:

```ts
function header(headers: Record<string, string>, name: string): string | undefined {
  return headers[name];
}
```

The same idiom is `fieldValue` in `runtime/net/frames.ts` and `field` in `runtime/sound/pack.ts`. Reach for it whenever you index a `Record<string, T>` with a constant.

**`exactOptionalPropertyTypes` forbids assigning `undefined`.** So `{ ...opts, glyph: opts.glyph }` fails when `glyph` is optional and absent. Build the object then assign conditionally:

```ts
const spec: InjectionSpec = { kind: 'micro', id, label };
if (opts.glyph !== undefined) {
  spec.glyph = opts.glyph;
}
```

**`noUncheckedIndexedAccess` makes every index read `T | undefined`.** `arr[0]`, `map.get(k)`, and `record[key]` all need a guard, a `??`, or an `as` with a reason. Regex capture groups are the common case: `match[1] as string` is fine directly after a truthiness check on `match`.

**`noUnnecessaryConditions` reads a `let` initializer as its literal type.** `let flag = true` narrows to `true`, so a later `if (flag)` is "always truthy" even though something reassigns it. Annotate, or use a cell:

```ts
const server: { issuesEtags: boolean } = { issuesEtags: true };
```

**`verbatimModuleSyntax` means `import type` is load-bearing, not cosmetic.** A value import is emitted; a type import is erased. That is what keeps zod out of the page bundle, and it is what let a single `API_VERSION` value import drag the whole library in during M5. If you only need the type, say `import type`.

## Errors and async

**`useErrorCause`.** When you catch and rethrow, carry the original:

```ts
throw new Error(`${url} did not return JSON: ${String(err)}`, { cause: err });
```

**Anything returning a promise rejects rather than throwing synchronously.** This is a repo rule, not a Biome one, and it is in AGENTS.md: Comlink turns a synchronous throw into a rejection, so the bridge hides the difference and a direct caller does not.

## Regex

**`useTopLevelRegex`.** A regex literal inside a function is recompiled per call. Hoist every one to module scope with a name:

```ts
const HEADER_LINE_RE = /^([^:]+):\s*(.*)$/;
```

This fires constantly in tests, where `.toThrow(/some message/)` is the natural thing to write. `tests/**` has the rule off for exactly that reason; in `loader/src` and `tools`, hoist.

## Imports

Biome sorts imports, and it sorts by the **local** name, so a renamed import moves: `import { LOCAL_ID, fqid as makeFqid }` is ordered on `makeFqid`, not on `fqid`. The exact ordering beyond that is Biome's and is not worth reproducing by hand. Run `pnpm fix` and take what it gives you rather than arguing with it in review.

## What is relaxed, and why

Three relaxations exist in `biome.json`. Each is a rule that is structurally impossible to satisfy in that location, not one that was inconvenient.

In `addons/**`, `noExcessiveLinesPerFile` is off. An addon is one file by definition: the manifest names a single `entry` and the loader evaluates it with `new Function`. There is nothing to split into.

In `tests/**`, `noExcessiveLinesPerFile` is off, `noExcessiveLinesPerFunction` is raised to 200, and `useTopLevelRegex`, `noMisplacedAssertion`, `noMagicNumbers` and `noSecrets` are off. A suite is one subject per file and splitting it by line count would scatter it; `.toThrow(/message/)` is the natural assertion; an assertion inside a shared helper is the point of the helper; fixture values are literals on purpose.

In `loader/src/host/**`, the GM globals are declared. `host/globals.ts` is the only module allowed to name one.

Adding a fourth needs the same standard: the rule has to be impossible there, not merely annoying. "I would have to restructure this" is the rule working.

## Suppressions

A `biome-ignore` needs the rule name and a reason that says why the code is right, not that the rule is wrong:

```ts
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model, and an addon file is a function BODY with no exports at all.
import SOURCE from '../addons/dev-harness/main.js?raw';
```

**An unused suppression is itself an error** (`suppressions/unused`). Do not add one speculatively. In particular, `new Function` is not flagged by `noGlobalEval` in Biome 2.5.5, so a suppression for it is dead weight that fails the check.

## Before you run Biome

A quick pass over a new module catches most of it:

1. Is every function body under 50 lines, and the file under 300?
2. Are all the exports at the bottom, in one block?
3. Any ternaries? Any `continue`? Any `void`?
4. Any bare number outside a `const`?
5. Any regex literal inside a function?
6. Any `let x;` without a type?
7. Any object key that belongs to the game, the DOM, or a manifest rather than to us?
8. Any `await` in a `for` loop?
9. More than four parameters anywhere?

Then:

```sh
pnpm fix                              # formatting and the safe fixes
pnpm lint loader/src/host/fetcher.ts  # one file, while you are still in it
pnpm lint                             # the whole tree, before you call it done
```

`pnpm lint` fails on info-level findings, not just errors. That is the point of `tools/lint.mjs` existing rather than calling Biome directly: `--diagnostic-level` controls what Biome DISPLAYS, not what it fails on, and most of the rules above report at info. Without the gate they accumulate silently until someone reads the output, which is exactly the expensive-at-the-end problem this file exists to prevent.
