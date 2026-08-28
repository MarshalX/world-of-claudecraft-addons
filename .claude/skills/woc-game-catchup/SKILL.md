---
name: woc-game-catchup
description: "Catch this project up to a new World of ClaudeCraft release: audit the game checkout between two tags, verify the loader still resolves everything it depends on, regenerate every generated artifact (skill and item art unions, sound cues, aura kinds, the stage theme, and the per-addon data tables), publish what the game now sends but no addon can read, and fix or extend the addons whose behaviour the release changed. Use this whenever the user says a game version landed or shipped, names a game tag or version number, asks what a game release broke, asks whether the loader still works against the new game, asks to regenerate the tables or the art unions or the theme, asks what new the game gives addons, or says anything like 'the game updated', 'catch up to 0.38', 'audit the game diff' or 'did anything break'. Also use it when an addon is reported showing wrong or missing game content, since a silently stale data table is the usual cause and this is the pass that finds it."
---

# Catching the project up to a game release

The game ships releases this project does not control and cannot compile against. This pass is the only thing that ever re-reads the game and asks whether what this repository claims about it is still true.

**Everything this pass looks for fails silently.** A data table pinning gather nodes the game re-sited raises no error, serves no 404 and fails no test; the player walks to a marker and finds an empty field. A comment stating that weapons have no art goes on being read as fact for a year after it stops being one. A field the game starts sending is simply never published, and the addon that would have used it is never written. Nothing in `pnpm check` looks at any of this. So the value of the pass is entirely in how carefully the reading is done, and a pass that runs the generators and stops has done the easy tenth of it.

Read `AGENTS.md` first and let it win over anything here.

## The two inputs

A **game checkout path** and a **tag range**. Ask for whichever is missing rather than guessing; the checkout is not inside this repository and its location is the user's.

Establish, before reading anything:

```sh
git -C <checkout> describe --tags        # what is actually checked out
git -C <checkout> status --porcelain     # must be clean, or the diff is not the release
git -C <checkout> tag --list 'v*' | tail # the tag before the new one is the old one
```

**Never modify the game repository.** Read-only git there (`diff`, `show`, `log`, `grep`) and nothing else. Working externally to the game is this project's whole premise, and a change made there to make something easier here is a change that does not exist for any player.

**Run no git write command in this repository either.** No `add`, `commit`, `checkout`, `stash` or branch operation. Leave the work in the working tree and report a diffstat; committing is the user's.

## Phase 0: establish the picture before doing any work

Two readings, both cheap, and both change what the rest of the pass is allowed to do.

**How big is this release.** `git -C <checkout> diff <old> <new> --stat | tail -1`. A release touching a few dozen files is read end to end. One touching thousands is read through the checklist rather than through the diff, because the diff will be mostly content and asset churn.

**What are the channels actually serving.** Five of the generators read a DEPLOYED game over the network rather than the checkout, so the checkout tag being newer than what live serves means those five cannot produce the tag you are auditing. Read all three:

```sh
for h in worldofclaudecraft.com pbe.worldofclaudecraft.com pbe2.worldofclaudecraft.com; do
  printf '%s ' "$h"; curl -s "https://$h/" | grep -o 'v[0-9]\+\.[0-9]\+\.[0-9]\+' | head -1
done
```

The channels diverge in BOTH directions and a version string does not say which content each carries. Live has been two releases ahead of both pbe channels; pbe has also carried content live did not while reporting an older version. There is no standing relationship to remember, which is why this is measured every cycle rather than assumed.

Then reconcile the checkout against them, because it can be on the wrong side in either direction and each costs something different:

- **The checkout is BEHIND live.** You cannot audit a tag you do not have. Stop and ask the user to fetch and check out the new tag, since updating the game repository is theirs to do and not yours. Auditing the older range anyway produces a report about a release players are already past.
- **The checkout is AHEAD of live.** The five network generators physically cannot produce that tag's content, and running them writes the currently deployed content over your artifacts while reporting success. Do the reading and the checkout-fed regeneration now, leave the network five, and put them in the report as owed rather than leaving it implied.

Say what you found before proceeding either way.

## Phase 1: read the diff

`references/surfaces.md` is the checklist. It has four groups, ordered so the cheap alarming one comes first: is the loader still working, what has to be regenerated, what new surface an addon could read, and what looks readable but is not. Work them in that order and read group D before proposing anything from group C.

Two rules about how findings are recorded.

**Cite the file and line you read it from.** A claim in this pass becomes a comment, a published type or a decision not to build something, and six months later the only way to re-check it is the citation. An uncited claim is indistinguishable from a guess.

**A declaration is not a promise.** `src/sim/types.ts` says what a shape can hold; `server/game.ts` says what is actually sent. The client builds every entity with defaults and fills in what the snapshot carried, so a field the server never sends is present, correctly typed, and holds that default for the whole session. Reading such a field concludes something false and never complains. The send-site procedure is in group C of the checklist, and the trap where a server write is not a send is in it too.

Then present what you found: what moved, what it costs, and the work list in the order you intend to do it. Shared files first, because `packages/types/` and `loader/src/runtime/world/` will be touched by several items at once. Stop for the user only where a call is genuinely contentious, typically a new capability worth building or a shape decision with more than one defensible answer. Do not stop to ask permission to do the mechanical parts.

## Phase 2: regenerate

`references/generated.md` has each generator, what it reads, and how it goes wrong. The decisions worth putting in the body here:

**The data tables are settled by regenerating and diffing the output, never by reading source diffs.** A changed source file does not mean a stale table. `v0.36.0..v0.37.1` touched two content files feeding four tables and all four came out identical apart from the stamp. Run:

```sh
pnpm tables --game <checkout>
```

It runs every addon generator, handles the two disagreeing `--game` spellings, and classifies each table as unchanged, stamp only, or content moved. `--dry-run` restores the tables afterwards if you want the reading without touching the tree.

**A stamp is not an observable change.** Regenerating for the stamp alone is fine as bookkeeping. Bumping an addon's version for it is not: that ships a download telling the player nothing changed. Only content moving earns a bump.

**`pnpm theme` is two steps.** `pnpm theme` then `pnpm fix stage/theme.generated.css`. Unformatted, the diff rewrites all seven borrowed-class rules as noise and hides the one line that actually moved. Read its warning about tokens the loader reads without a fallback that the game no longer declares; that is a rule that has silently stopped applying.

**`pnpm aura-kinds` takes `--game <path>` space separated.** Most addon generators take `--game=<path>`. The wrong form trips the required-argument error, which reads as a missing flag rather than a wrong one.

**A count going down is art moving, not art landing**, and it is the case worth stopping for. Five paladin skill ids were retired at 0.36.0. Check that nothing in the tree names a retired id AS an id, remembering that the same string is usually also an ordinary English word in prose.

## Phase 3: publish what the game now sends

An addon that cannot read what the game now sends is the gap this pass closes, and closing it has five parts. Skipping any one of them produces a member that looks published and is not.

1. **The runtime and the published declaration**, in `loader/src/runtime/world/` (or `net/`) and the matching `packages/types/*.d.ts`. Say what is TRUE rather than what the shape suggests: which surfaces carry the field honestly, which cannot, and why. Where the game's own allowlist means a field can never appear on a public shape, narrow the shape rather than widening the public one, and name the allowlist in the doc line.
2. **The parity assertions, which are three lines and not one.** A pair in both directions plus a `SameFields` key-set assertion in `tests/types-parity.test.ts`, and for a new FACET a `wocCarries*` against `WocApi['<facet>']`. Both directions, because dropping a field from one side leaves the other a superset and only one direction fails; `SameFields` because it is the only thing that catches an OPTIONAL field added to one side alone, which is how every field the game has added to an existing event has arrived. A facet with no assertion is silence, not a passing test.
3. **The signature, if a watcher should see it change.** A published field absent from the relevant `loader/src/runtime/world/signature-*.ts` mark arrives correctly and never fires its `world.on`. Write that test red first.
4. **`API_MINOR`, only if the current number has shipped.** `git tag --contains <the commit that set it>`; empty means no released loader claims it, so every additive merge keeps riding the current number. Widening a union an addon can only READ is additive, not a major: nothing an addon writes produces one, so every existing comparison still compiles. A member changing shape or leaving is the major, whatever the release state.
5. **`packages/types` version**, which tracks `apiVersion` rather than the loader. Set it HERE, in the commit that moves the surface, because that number is what the release run compares against the registry to decide whether to publish at all: left unbumped, the surface ships in a loader that addon authors have no types for.

The parity assertions are type-level: they fail `tsc --noEmit` and never the runner. Verifying one means breaking it deliberately, reading the typecheck output, and restoring.

## Phase 4: the addons

Three kinds of work, and they are worth keeping distinct because only the first is obligatory.

**Repair what the release made wrong.** A table that moved, a read that no longer matches, a comment or header line stating something the release made false. Add the failing test first and see it red; a guard test nobody has watched fail is a guess. Correct false prose wherever it appears, including in this repository's own documentation, because a confident sentence is what the next author will build on.

**Extend where the release gives an addon something real to show.** This is the discretionary half and the half that grows scope, so name what you are adding and why before building it. Recording new state is usually the load-bearing part rather than drawing it, because the thing a player cannot check for themselves is what an addon is for.

**Never invent an action.** `net` is read-only, there is no send API, and a new game write command is a line in the report and nothing else. An addon reports state; the player acts in the game's own UI.

Every addon change carries its own suite (`addons/<id>/main.test.ts`, starting from `tests/fakes/addon.ts`) and, where the panel changed, its stage scenario. Update the `alt` text on the scenario rather than on the manifest. If the addon uses `woc.paint`, its scenario must call `stage.frame()` or the capture photographs a blank panel and nothing warns.

### Verify the previews, for EVERY addon, by capturing rather than by reasoning

Run `pnpm shots` over the whole catalogue once the addon work is final, and diff what comes out. Not only the addons you touched, and never a judgement made from reading diffs.

**The reason is that a preview photographs the GAME's art as well as the addon's DOM, and only one of those is in your diff.** Game 0.38.2 re-encoded 229 files under `public/ui/mobs/`, which moved every mob portrait in every preview that draws one, on a branch where no addon's drawing code had changed at all. No amount of reading addon source finds that. The other half is the same lesson pointing the other way: an addition that looks invisible can still move layout, and a cheater tag added as an always-present empty `<span>` cost a fourth 5px gap on every facemark plate, because the tag row is a flex container and an empty child is still a flex item. The capture is what sees both.

**A preview whose bytes changed is KEPT and committed with the rest of the catch-up.** Not judged against whether a player would notice: the committed PNG is meant to be the current picture of the current game, and the whole reason this step exists is that its inputs move without anything in the diff saying so. Restoring one because the change looked too small to matter puts the file back to a picture of an older game and hands the next pass the same decision again, forever. The measurement below is for UNDERSTANDING and reporting what moved, not for deciding whether to keep it.

- **An unchanged checksum is a real all-clear; a changed one is not yet a finding.** Most captures are byte-stable, so the thirteen that come back identical need no further thought. **Not all of them are, and the exception is invisible until you look for it:** on 0.38.2 `emberwatch` photographed 2342px wide and then 2348px wide from the same tree, so its preview would have been rewritten by every catch-up forever, each time looking like a real change. Any addon whose bytes moved gets captured a SECOND time first, and only a diff that reproduces is worth measuring.
- **A cold run flakes at the top.** The first addon captured can blow the 15s `READY_MS` while the 6.7 MB bundle is served for the first time, and it reports as a `waitForSelector` timeout that reads exactly like a broken scenario. Re-run before believing one: `cadence` failed twice that way and then captured clean, reaching ready in 600ms at every scale.
- **Measure what moved, so the report can say what it was.** Decode both PNGs and take the max per-channel delta, the count of pixels above ~32, and the bounding box of those. A max near 40 with a handful of such pixels and no tight box is the game re-encoding its own art, which is what `longwatch` and `trailmark` were at 0.38.2. A tight box with large deltas is a layout shift, and that one is worth stopping on because it is usually YOURS: it is how the cheater tag's always-present empty `<span>` would have surfaced.
- **Read WHERE the diff is, because it names the cause.** Scattered over every icon is the game's art moving. A localized rectangle is your own change. Text-wide speckle under a max of about 20 is capture noise between Chromium builds.
- **Save the committed bytes before running anyway.** Not to restore churn, but because a capture can fail and a scenario can turn out unstable, and you need the original both to diff against and to fall back to. Copy files; nothing in this pass runs a git write.
- **Then check the manifests.** `pnpm shots` rewrites the `preview` block of every addon it captures. Confirm what is left is the version bumps you intended plus the preview blocks that genuinely moved.
- An addon with no `preview` block is not capturable and is not a gap: `dev-harness` ships without one, so its panel is photographed by nothing.

Then sweep the whole branch for version bumps, which is a judgement about the SET of changes and is visible to nobody working item by item. Every addon a player can OBSERVE a change in needs its `version` bumped, and needs `apiMinor` set to the smallest minor carrying every member it reads. An addon changed without a bump is an addon changed for nobody: no badge, no update row, no error, and fresh installs silently getting a different body from every existing player.

## Phase 5: the documentation this pass owns

`AGENTS.md` carries measurements with dates on them and this pass is the only thing that re-reads them. Leaving them is publishing last release's readings as current. At minimum, re-check:

- The deployed-channel table and the divergence it records.
- The item, skill-icon, cue and aura-kind counts, and the per-class icon counts.
- The item-art completeness claim and whatever is currently pending.
- The not-on-the-wire field list, in both directions: a field can LEAVE it, as `castTargetId` did at 0.36.0.
- Any claim the release made false. Correct it rather than deleting it when the LESSON survives: a reading that was wrong when it was committed does not become right by being overtaken, and saying so is what stops the next person re-deriving it.

`site/content/docs/` describes what an addon can read, so a newly published member or a newly false claim belongs there too. `patterns.md` is where the material about reading the send site lives.

## Phase 6: the gate and the report

`pnpm check` whole before calling anything done. While iterating, scope to what you touched (`pnpm lint <path>`, `pnpm exec vitest run addons/<id>`, `pnpm check:ts`), because a whole-tree write can land on a file something else is halfway through saving, and a red full-tree run taken while anything else is in flight has to be re-run before it is reported.

Report, in this order:

- **What moved**, by surface, with citations.
- **What was regenerated**, including the no-ops. A verified no-op is a real result: it is the difference between "the art did not change" and "nobody looked."
- **What the preview capture found**, over the whole catalogue rather than the addons you touched. Say which came back byte-identical, which differed, and for each that differed whether it was committed or restored, with the number the visibility call rested on. "Every preview re-captured unchanged" is a finding; "I did not expect any to change" is not one.
- **What was published** and what `API_MINOR` did, with the `git tag --contains` reading behind the decision.
- **Which addons changed**, with their version bumps, and which deliberately did not bump and why.
- **What was refused**, with the reason. A reworked mechanic whose state is never sent, a new write command, a field only honest on some surfaces. This section is worth as much as the rest, because it is what stops the same idea being re-proposed next cycle.
- **What is still owed.** Anything read off the wire is verified BY HAND against a running client before it is trusted, and if the tag being audited is only on live then the session has to be live. Mocking that verifies the mock, and the failures it would catch are silent ones: a field read at the wrong nesting level, or under the wire's name instead of the entity's, simply never matches and never complains.

Nothing is committed. Leave the tree for the user.
