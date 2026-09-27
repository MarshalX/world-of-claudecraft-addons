# The surface checklist

Every surface this project reads out of the game, what to read it from, and what a change to it costs us.

**The paths are a starting point, not an authority.** The game owes this project nothing for any of them. When one misses, use the re-find column, and correct the path here in the same pass, because the next cycle starts from this table.

Re-resolve per CITATION, not per release: `git diff --stat <old> <new> -- server/` first to see which files moved, then re-find by bare NAME in those files. Grep the bare name, not a declaration keyword: a free function turned into a method is still there while `function <name>` finds nothing, and an emit written `out.chm = 1` is missed by a quoted `'chm'`.

Work the four groups in order. Group A decides whether anything is on fire, and it is cheap. Group B is mechanical. Group C is where the judgement is. Group D lists things that look like Group C and are not; read it before proposing a field.

## A. Is the loader still working

Nothing here should ever change, so a change here outranks everything else in the cycle. All of it is `git diff <old> <new> -- <path>` in the game checkout.

| Surface | Read in | Re-find by | What a change costs |
|---|---|---|---|
| HUD anchors | `index.html`, `play.html`, `src/ui/options_window.ts` (`.opt-version`), `src/ui/options_main_menu_controller.ts` (`.opt-list`, `.opt-btn`), `src/ui/interface_unlock.ts` | Resolve every selector in `ANCHORS` in `loader/src/runtime/ui/anchors.ts` against the game's markup. Read the list off `ANCHORS`, not from here. | A moved selector is an injection point that silently stops existing. `anchors.ts` is one table so the repair is one edit, and the manager's Diagnostics pane resolves them live. |
| The three borrowed classes | `src/styles/base.css` | `grep -n '\.panel\b\|\.panel-title\|\.x-btn' src/styles/base.css` | The kit WEARS these, so a frame's border, background, shadow and title face come from the game. If one leaves `@layer base` the loader starts winning by injection order instead of by being unlayered, which is much weaker and fails silently. |
| The two borrowed BUTTON classes | `play.html` (`#mm-options`), the button the game builds in `src/ui/options_main_menu_controller.ts` | Read the `className` the game writes and compare it to `GAME_MICRO_BUTTON_CLASS` and `GAME_MENU_BUTTON_CLASS` in `anchors.ts`. NOT a selector check: a stale class list resolves fine and only LOOKS wrong. | Nothing fails. When the game moves its button styling onto a new class, the loader's rail button draws a bare glyph and its menu entry falls back to a legacy arm and renders in the previous release's style. Update `tests/fakes/game-dom.ts` to the game's markup; the two injection suites assert against the fake's own buttons, never a literal. |
| `@layer` order | `src/styles/play.extra.css`, `src/styles/index.extra.css` | `grep -n '@layer' src/styles/*.extra.css`; the two must agree | The loader's sheet is unlayered and therefore outranks any layered rule. A reorder costs nothing while that holds; a borrowed class leaving a layer is the case that bites. |
| Wire layout version | `ONLINE_WORLD_LAYOUT_VERSION` in `src/world_api.ts` | `grep -rn 'ONLINE_WORLD_LAYOUT_VERSION' src/` | A move costs nothing, because `redactOutbound` matches on the field NAME, not the frame type. Check instead that the auth frame, built by `buildWebSocketAuthMessage` in `src/net/world_auth_message.ts`, still carries the credential as `token`: that name is the whole of the match. |
| `window.__game` keys | `src/main.ts` | `grep -n 'window.__game\|__game =' src/main.ts` | The runtime's probe reads this object. A key leaving is a read that starts returning undefined. Keys arriving are usually debug surface and usually nothing. |
| The theme picker | `src/ui/theme.ts` | `grep -rn 'documentElement.style.setProperty' src/ui/theme.ts` | It rewrites a subset of tokens at run time in JavaScript, so alternate themes are in no stylesheet and the stage can only ever show the default. If the picker's token subset grows, nothing here changes, but do not let anyone conclude the stage is broken. |

## B. What has to be regenerated

Read `generated.md` beside this file for how each generator is invoked and which of them read the network rather than the checkout. This table is only about deciding WHETHER each has anything to write.

| Artifact | Game input | Decide by |
|---|---|---|
| `packages/types/items.generated.d.ts` | `public/ui/items/` and its `mapping.json` | `git diff --stat <old> <new> -- public/ui/items/`. Empty means an expected no-op. |
| `packages/types/icons.generated.d.ts` | `public/ui/skills/<class>/mapping.json`, nine files | `git diff --stat <old> <new> -- public/ui/skills/`. Watch for ids REMOVED as well as added; a regenerated union is not always additive. A new FOLDER there is not a new class: `pet` holds pet-bar buttons no addon can name and is deliberately not in `ICON_CLASSES`. |
| `packages/types` aura family, via `runtime/ui/kit/aura-art.ts` | `public/ui/auras/mapping.json` | Nothing is generated from it, so there is no artifact to regenerate; the runtime reads the deployed manifest. What to check is that the manifest is still SERVED and still shaped `{family: 'auras', assets: [{auraId, output}], externalAssets: [{auraId, runtimeUrl}]}`, because `family` is the shape check and a rename would make the whole family read as empty. |
| `packages/types/cues.generated.d.ts` | `public/audio/sfx/runtime-pack.json` and the clips | `git diff --stat <old> <new> -- public/audio/` |
| `stage/theme.generated.css` | `src/styles/tokens.css` plus the rules for the three borrowed classes | `git diff <old> <new> -- src/styles/tokens.css src/styles/base.css`. A token being REMOVED matters more than one being added: a loader rule reading a token the game no longer declares, with no fallback, silently stops applying, and `pnpm theme` warns about exactly that. |
| `packages/types/aura-kinds.generated.d.ts` and `loader/src/shared/aura-kinds.generated.ts` | `src/sim/aura_classify.ts` AND `src/sim/persistent_aura.ts` | `git diff <old> <new> -- src/sim/aura_classify.ts src/sim/persistent_aura.ts`. Two outputs, because there is no endpoint to re-read at run time so the runtime carries the value as well as the type. A diff here is NOT automatically a rule change: the file holds more than one predicate. Diff the whole predicate you care about (`isDispellableAura`, `isToggleAura`), not the file. |
| The addon data tables | Each table names its own sources; see below | Run `pnpm tables`. Do not decide this by reading source diffs. |

**A source diff predicts, it does not decide.** A served manifest is deployed independently of the tag, so run the network generators even when the diff under `public/` is empty; "the source did not move" and "the manifest did not move" are different claims and only the second is what the artifact records. When `public/` moved a lot, bucket the diff by subtree (`git diff --name-only <old> <new> -- public/ | awk -F/ '{print $2"/"$3}' | sort | uniq -c`) instead of reading every path. Art follows the class kits: raids, professions and mechanics add no skill art. And an art manifest cannot see a content rule (binding, stats, a mechanic leaving), so a quiet art diff says nothing about those.

**On the data tables specifically.** Each table records its own provenance in its header, under `generatedFrom`, `source`, `game` or `gameVersion` depending on which generator wrote it, and two of them (`veinsight`, `emberwatch`) record no source list at all, so the only complete answer is in the generator. A changed source file does NOT mean a stale table: content edits often regenerate byte-identical apart from the stamp. Regenerate and diff the OUTPUT. That is what `pnpm tables` does.

## C. New readable surface: the publish candidates

This is the part that needs judgement, and the method is one question asked in a fixed order.

1. **Did the shape change?** `src/sim/types.ts` is where the event union, the entity payloads and the item payloads live. `git diff <old> <new> -- src/sim/types.ts` is the highest-yield single diff in the cycle.
2. **Is it actually SENT?** A field in `src/sim/types.ts` is a declaration, not a promise. Read the send site in `server/game.ts`: `wireEntity`, `identityFields`, `dynamicFields` for entities, and `selfWireJson` for the self payload, which seeds from `wireEntity` and assigns the self-only stats over it. **Read `server/self_scalar_wire.ts` for the self payload too**: it holds the static self-scalar cohort, and its own header says a new self scalar lands there rather than as another inline `maybe(...)`. Its `SELF_SCALAR_KEYS` is the whole list, so it is the cheapest read in group C: diff that array between the two tags. Read the function; do not grep it, because a payload assembled by spreading does not mention its inherited fields anywhere a search can reach.
3. **Is the send site a SEND?** In `server/game.ts`, `captureBotDetectionSnapshot` reads `inCombat`, `moveSpeed` and `onGround`, and `liveSessions` (the admin readout) reads `moveSpeed`, into server-internal records that never become a frame. A grep finds a server write that reads exactly like a send. The question is whether the object being written lands in a frame.
4. **Is it honest on every surface it appears on?** `publicInstanceView` in `src/sim/item_instance_transfer.ts` carries an allowlist, so an item field can be real on your own bags and structurally absent on a market row. Publishing it on a shape that covers both is publishing a field that is sometimes a lie. The precedent is `OwnedItemInstance extends PublicItemInstance`: narrow the shape, and say in the doc line WHY the wide one can never carry it.
5. **Does a watcher need to see it change?** A published field that is not in the relevant `loader/src/runtime/world/signature-*.ts` mark arrives correctly and never fires its `world.on`, so no subscriber sees it toggle.

6. **Does the game send a whole FAMILY the loader never reads?** This is a separate question from the five above, and a cycle can answer the first five with nothing while this one has the real finding. Encounter state is the example: it is not an entity field and never reaches a client as one, but an encounter can put its own records on the wire (`server/nythraxis_wire.ts`). Diff `server/*_wire.ts` for new modules and new emitters.
7. **Did a RULE change with no field changing?** The player combat flag is derived from hate tables (`src/sim/combat/engaged_combat.ts`), so a change there widens what `PartyMember.inCombat`, `world.combat` and `world.threat` answer with nothing to publish and nothing to bump. A shape diff finds none of it; read the diffs of the sim modules those surfaces are derived from and report what an addon will now see.

Other places a new readable surface shows up:

| Surface | Read in | Note |
|---|---|---|
| Market query and page shape | `src/sim/market_query.ts`, `src/world_api/market.ts` | The market page is passed through rather than projected, so a new field ARRIVES before it is published. That is the passthrough trap: nothing in the published types promises it, so an addon built on it is built on nothing. |
| Default keybinds | `src/game/keybinds.ts` | Nothing to change here. Conflict detection reads the game's live profile, so a new default binding is reported correctly the day it ships. |
| Content tables | `src/sim/data.ts`, `src/sim/content/*.ts` | These feed the addon data tables rather than the API. Group B. |
| Item art resolution | `src/ui/icons.ts` (`ITEM_ART_PENDING`, `weaponIconUrl`, `currencyImageUrl`), `src/sim/content/heroic_variants.ts` | The loader mirrors the game's own resolver. If the game changes how it resolves an icon, `loader/src/runtime/ui/kit/item-art.ts` has to change with it or `icon.item()` starts promising URLs that 404. `staticIconUrl` is the function to read, since it decides the ORDER the families are tried in. |

## D. Looks publishable, is not

Check here before proposing anything. Each of these is a client-side default or a server-internal value, which means it is present, of the right type, and permanently wrong.

- **Fields the client constructs with defaults.** `src/net/blank_entity.ts` builds every entity with defaults and fills in what the snapshot carried, so a field the server never sends is present and holds that default for the whole session. `ccDr` is built as an empty Map there. **That file is the highest-yield single read in group D**, because a field ADDED to it is the game saying, in its own source, that the client has to manufacture a value, which settles the question before `server/` is opened. The not-on-the-wire list is in `AGENTS.md` and this pass is the only thing that re-checks it, in both directions: a field LEAVES the list when a send site appears.
- **The cast queue.** `queuedCastAbility`, `queuedCastAim` and `queuedCastTargetId` are not sent, while the melee `queuedOnSwing` is, as `queued` on the self payload. Finding `queued` and stopping is the trap.
- **Write commands.** `IWorld` gains methods every release or two. `net` is read-only and that is the project's premise rather than a gap, so a new write command is a line in the report and nothing else.
- **A reworked mechanic whose state is not sent.** The PvP diminishing-returns ladder is the example: it can change wholesale and an addon sees none of it. Report it, because it looks like a feature opportunity until you check the wire.
- **Server telemetry enums.** `UnstuckAreaKind` gaining a member is not a surface.
- **A refusal reason on an event we do not publish**, such as a craft or salvage refusal. There is nothing to extend; publishing the event is a separate feature, not a catch-up item.

## What AGENTS.md states that only this pass re-checks

`AGENTS.md` states current facts about the game without counts or dates: the not-on-the-wire field list and its published exceptions, the three combat-record id exceptions, the `world.dispellable` gap, the item-art pending mechanism, and the channel rules. Correct each in place when it changed and leave it alone when it did not; the skill body's documentation phase has the rules.
