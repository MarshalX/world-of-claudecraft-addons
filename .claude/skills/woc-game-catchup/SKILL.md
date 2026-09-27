---
name: woc-game-catchup
description: "Catch this project up to a new World of ClaudeCraft release: audit the game checkout between two tags, verify the loader still resolves everything it depends on, regenerate every generated artifact (skill and item art unions, sound cues, aura kinds, the stage theme, and the per-addon data tables), publish what the game now sends but no addon can read, and fix or extend the addons whose behaviour the release changed. Use this whenever the user says a game version landed or shipped, names a game tag or version number, asks what a game release broke, asks whether the loader still works against the new game, asks to regenerate the tables or the art unions or the theme, asks what new the game gives addons, or says anything like 'the game updated', 'catch up to 0.38', 'audit the game diff' or 'did anything break'. Also use it when an addon is reported showing wrong or missing game content, since a silently stale data table is the usual cause and this is the pass that finds it."
---

# Catching the project up to a game release

The game ships releases this project does not control and cannot compile against. This pass is the only thing that re-reads the game and checks whether what this repository claims about it is still true.

**Everything this pass looks for fails silently.** A data table pinning gather nodes the game re-sited raises no error and fails no test; the player walks to a marker and finds an empty field. A comment stating something the release made false goes on being read as fact. A field the game starts sending is never published. Nothing in `pnpm check` looks at any of this, so running the generators and stopping does the easy tenth of the pass.

Read `AGENTS.md` first and let it win over anything here.

## The two inputs

A **game checkout path** and a **tag range**. Ask for whichever is missing rather than guessing; the checkout is not inside this repository.

Establish, before reading anything:

```sh
git -C <checkout> describe --tags        # what is actually checked out
git -C <checkout> status --porcelain     # must be clean, or the diff is not the release
git -C <checkout> tag --list 'v*' | tail # the tag before the new one is the old one
```

**Never modify the game repository.** Read-only git there (`diff`, `show`, `log`, `grep`) and nothing else. A change made there does not exist for any player.

**Run no git write command in this repository either.** No `add`, `commit`, `checkout`, `stash` or branch operation. Leave the work in the working tree and report a diffstat; committing is the user's.

## Phase 0: establish the picture before doing any work

**How big is this release.** `git -C <checkout> diff <old> <new> --stat | tail -1`. A release touching a few dozen files is read end to end. One touching thousands is read through the checklist, because the diff will be mostly content and asset churn.

**What are the channels actually serving.** Five of the generators read a DEPLOYED game over the network, so they can only produce the tag live is serving. Read all three:

```sh
for h in worldofclaudecraft.com pbe.worldofclaudecraft.com pbe2.worldofclaudecraft.com; do
  printf '%s ' "$h"; curl -s "https://$h/" | grep -o 'v[0-9]\+\.[0-9]\+\.[0-9]\+' | head -1
done
```

The channels diverge in both directions and a version string does not say which content each carries, so measure every cycle and assume nothing. Read live again immediately before running the network generators: live can deploy mid-pass, and an artifact whose header names one tag and whose content is another is the result. The readings go in the report, never in `AGENTS.md`.

Then reconcile the checkout against them:

- **The checkout is BEHIND live.** Stop and ask the user to fetch and check out the new tag; updating the game repository is theirs. Auditing the older range produces a report about a release players are already past.
- **The checkout is AHEAD of live.** The five network generators cannot produce that tag's content, and running them writes the deployed content over your artifacts while reporting success. Do the reading and the checkout-fed regeneration now, and list the network five in the report as owed.

Say what you found before proceeding either way.

## Phase 1: read the diff

`references/surfaces.md` is the checklist. It has four groups: is the loader still working, what has to be regenerated, what new surface an addon could read, and what looks readable but is not. Work them in that order and read group D before proposing anything from group C.

**Cite what you read.** A claim here becomes a comment, a published type or a decision not to build something, and the citation is the only way to re-check it later. In the report, cite file and line. In anything committed (`AGENTS.md`, comments, types, docs), cite the game file and the symbol name, never a line number: line numbers move every release and a stale one costs the next reader the whole reading.

**A declaration is not a promise.** `src/sim/types.ts` says what a shape can hold; the server's send site says what is actually sent. The client builds every entity with defaults, so a field the server never sends is present, correctly typed, and holds that default for the whole session. The send-site procedure is group C of the checklist, and the trap where a server write is not a send is in it too.

Then present what you found: what moved, what it costs, and the work list in the order you intend to do it. Shared files first, because `packages/types/` and `loader/src/runtime/world/` will be touched by several items. Stop for the user only where a call is genuinely contentious, typically a new capability worth building or a shape decision with more than one defensible answer. Do not ask permission for the mechanical parts.

## Phase 2: regenerate

`references/generated.md` has each generator, what it reads, and how it goes wrong. The decisions that shape the pass:

**Settle the data tables by regenerating and diffing the output, never by reading source diffs.** A changed source file often regenerates byte-identical apart from the stamp. Run:

```sh
pnpm tables --game <checkout>
```

It runs every addon generator, handles the two `--game` spellings, and classifies each table as unchanged, stamp only, or content moved. `--dry-run` restores the tables afterwards.

**A stamp is not an observable change.** Regenerating for the stamp is fine. Bumping an addon's version for it ships a download that tells the player nothing changed. Only content moving earns a bump.

**`pnpm theme` is two steps**: `pnpm theme`, then `pnpm fix stage/theme.generated.css`. Unformatted, the diff rewrites all seven borrowed-class rules as noise and hides the line that moved. Read its warning about tokens the loader reads without a fallback that the game no longer declares: each is a rule that has stopped applying.

**`pnpm aura-kinds` takes `--game <path>` space separated.** Most addon generators take `--game=<path>`, and the wrong form reads as a missing flag.

**A count going down is art moving**, and it is the case worth stopping for. Check that nothing in the tree names a retired id AS an id; the same string is often an ordinary English word in prose.

## Phase 3: publish what the game now sends

Publishing has five parts. Skipping any one produces a member that looks published and is not.

1. **The runtime and the published declaration**, in `loader/src/runtime/world/` (or `net/`) and the matching `packages/types/*.d.ts`. Say what is TRUE: which surfaces carry the field honestly, which cannot, and why. Where the game's own allowlist means a field can never appear on a public shape, narrow the shape and name the allowlist in the doc line.
2. **The parity assertions, which are three lines.** A pair in both directions plus a `SameFields` key-set assertion in `tests/types-parity.test.ts`, and for a new FACET a `wocCarries*` against `WocApi['<facet>']`. Both directions, because dropping a field from one side leaves the other a superset and only one direction fails; `SameFields` because it is the only check that catches an OPTIONAL field added to one side alone. A facet with no assertion is silence.
3. **The signature, if a watcher should see it change.** A published field absent from the relevant `loader/src/runtime/world/signature-*.ts` mark arrives correctly and never fires its `world.on`. Write that test red first.
4. **`API_MINOR`, only if the current number has shipped.** `git tag --contains <the commit that set it>`; empty means every additive merge keeps riding the current number. Widening a union an addon can only READ is additive, since nothing an addon writes produces one. A member changing shape or leaving moves the major, whatever the release state.
5. **`packages/types` version**, which tracks `apiVersion`. Set it in the change that moves the surface, because the release run compares that number against the registry to decide whether to publish: left unbumped, the surface ships in a loader addon authors have no types for.

The parity assertions are type-level: they fail `tsc --noEmit` and never the runner. Verify one by breaking it, reading the typecheck output, and restoring.

## Phase 4: the addons

Three kinds of work; only the first is obligatory.

**Repair what the release made wrong.** A table that moved, a read that no longer matches, a comment or header line the release made false. Add the failing test first and see it red. Correct false prose wherever it appears, including this repository's own documentation.

**Extend where the release gives an addon something real to show.** This half grows scope, so name what you are adding and why before building it. Recording new state is usually the load-bearing part, because what a player cannot check for themselves is what an addon is for.

**Never invent an action.** `net` is read-only and there is no send API. A new game write command is a line in the report and nothing else.

Every addon change carries its own suite (`addons/<id>/main.test.ts`, starting from `tests/fakes/addon.ts`) and, where the panel changed, its stage scenario. Update the `alt` text on the scenario, not on the manifest. If the addon uses `woc.paint`, its scenario must call `stage.frame()` or the capture photographs a blank panel and nothing warns.

### Verify the previews for every addon by capturing

Run `pnpm shots` over the whole catalogue once the addon work is final, and diff what comes out. Never limit it to the addons you touched or decide it from reading diffs.

**A preview photographs the GAME's art as well as the addon's DOM, and only the DOM is in your diff.** A game release that re-encodes its portraits moves every preview drawing one, with no addon code changed. Layout moves the same way from additions that look invisible: an always-present empty `<span>` in a flex row is still a flex item and adds a gap. The capture sees both.

**A preview whose bytes changed and reproduces is KEPT and committed.** The committed PNG is the current picture of the current game. Restoring one because the change looked small puts back a picture of an older game and hands the next pass the same decision. The measurement below is for understanding and reporting, not for deciding whether to keep.

- **An unchanged checksum is an all-clear; a changed one is not yet a finding.** Capture anything whose bytes moved a SECOND time first; only a diff that reproduces is worth measuring. `emberwatch` is the known unstable capture: see `references/generated.md`.
- **A cold run flakes at the top.** The first addon captured can exceed the 15s `READY_MS` while the 6.7 MB bundle is served for the first time, and it reports as a `waitForSelector` timeout that reads like a broken scenario. Re-run before believing one.
- **Measure what moved.** Decode both PNGs and take the max per-channel delta, the count of pixels above about 32, and their bounding box. A max near 40 with a handful of such pixels and no tight box is the game re-encoding its art. A tight box with large deltas is a layout shift, and is usually yours.
- **Where the diff sits names the cause.** Scattered over every icon is the game's art. A localized rectangle is your own change. Text-wide speckle under a max of about 20 is capture noise between Chromium builds.
- **Save the committed bytes before running**, because a capture can fail and you need the original to diff against and fall back to. Copy files; nothing in this pass runs a git write.
- **Then check the manifests.** `pnpm shots` rewrites the `preview` block of every addon it captures. What is left should be the version bumps you intended plus the preview blocks that genuinely moved.
- An addon with no `preview` block (`dev-harness`) is not capturable and is not a gap.

Then sweep the whole branch for version bumps, a judgement about the SET of changes that nobody working item by item can see. Every addon a player can OBSERVE a change in needs its `version` bumped and `apiMinor` set to the smallest minor carrying every member it reads. An addon changed without a bump reaches nobody: no badge, no update row, no error, and fresh installs silently get a different body from every existing player.

## Phase 5: the documentation this pass owns

`AGENTS.md` states facts about the game that only this pass re-checks. Keep it a description of the current state:

- **Correct the statement in place when the fact changed.** Rewrite the sentence so it is true now; do not add a new one beside it.
- **Never add a dated or per-release entry**, never record that something did NOT change, and never record a channel reading, a regeneration no-op or a count that merely held.
- **Cite the game by file and symbol name, never by line number.**
- **Keep a lesson as a present-tense instruction** when the release showed a rule was wrong, and delete the story of how it was found.

Re-check at minimum:

- The channel guidance (what the network generators read and why).
- The three combat-record id exceptions and the `world.dispellable` gap.
- The item-art pending mechanism and whatever is currently pending.
- The not-on-the-wire field list, in both directions: a field can LEAVE it when a send site appears.
- Any claim the release made false.

Everything about the cycle itself (channel readings, what held, what was re-verified, line citations) goes in the report.

`site/content/docs/` describes what an addon can read, so a newly published member or a newly false claim belongs there too. `patterns.md` holds the material about reading the send site.

## Phase 6: the gate and the report

`pnpm check` whole before calling anything done. While iterating, scope to what you touched (`pnpm lint <path>`, `pnpm exec vitest run addons/<id>`, `pnpm check:ts`), because a whole-tree write can land on a file something else is halfway through saving, and a red full-tree run taken while anything else is working has to be re-run before it is reported.

Report, in this order:

- **What moved**, by surface, with file and line citations, and the channel readings.
- **What was regenerated**, including the no-ops. A verified no-op is the difference between "the art did not change" and "nobody looked."
- **What the preview capture found**, over the whole catalogue: which came back byte-identical, which differed, and for each that differed whether it was committed or restored and the numbers behind it.
- **What was published** and what `API_MINOR` did, with the `git tag --contains` reading behind the decision.
- **Which addons changed**, with their version bumps, and which deliberately did not bump and why.
- **What was refused**, with the reason: a reworked mechanic whose state is never sent, a new write command, a field honest only on some surfaces. This is what stops the same idea being re-proposed next cycle.
- **What is still owed.** Anything read off the wire is verified BY HAND against a running client before it is trusted, and if the audited tag is only on live the session has to be live. Mocking it verifies the mock, and the failures it would catch are silent: a field read at the wrong nesting level, or under the wire's name instead of the entity's, never matches and never complains.

Nothing is committed. Leave the tree for the user.
