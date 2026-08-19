# The surface checklist

Every surface this project reads out of the game, what to read it from, and what a change to it costs us.

**The paths are DATED, not authoritative.** They were verified against game tag `v0.39.0` on 2026-08-19; every path in the four tables below resolved at that tag. The game owes this project nothing for any of them, so treat a path as a starting point and use the re-find column when it misses. When you find a path has moved, correct it here in the same pass, because the next cycle starts from this table.

Work the four groups in order. Group A decides whether anything is on fire, and it is cheap. Group B is mechanical. Group C is where the judgement is. Group D is the list of things that look like Group C and are not, and reading it before you get excited about a field is the whole reason it is written down.

## A. Is the loader still working

Nothing here should ever change, which is exactly why a change here outranks everything else in the cycle. All of it is `git diff <old> <new> -- <path>` in the game checkout.

| Surface | Last seen at | Re-find by | What a change costs |
|---|---|---|---|
| HUD anchors | `index.html`, `play.html`, `src/ui/options_window.ts` | Resolve each selector in `loader/src/runtime/ui/anchors.ts` against the game's markup. There are eight: `#ui`, `#options-menu`, `.opt-list`, `.opt-version`, `#side-buttons-col-b`, `#mm-options`, `#zone-label`, `#game-version`. | A moved selector is an injection point that silently stops existing. `anchors.ts` is one table so the repair is one edit, and the manager's Diagnostics pane resolves them live. |
| The three borrowed classes | `src/styles/base.css` | `grep -n '\.panel\b\|\.panel-title\|\.x-btn' src/styles/base.css` | The kit WEARS these, so a frame's border, background, shadow and title face come from the game. If one leaves `@layer base` the loader starts winning by injection order instead of by being unlayered, which is much weaker and fails silently. |
| `@layer` order | `src/styles/play.extra.css`, `src/styles/index.extra.css` | `grep -n '@layer' src/styles/*.extra.css`; the two must agree | The loader's sheet is unlayered and therefore outranks any layered rule. A reorder costs nothing while that holds; a borrowed class leaving a layer is the case that bites. |
| Wire layout version | `src/world_api.ts`, `ONLINE_WORLD_LAYOUT_VERSION` | `grep -rn 'ONLINE_WORLD_LAYOUT_VERSION' src/` | It has moved three times (3 to 5 at 0.35.0, 5 to 6 at 0.36.0, 6 to 7 at 0.39.0) and cost nothing every time, because `redactOutbound` matches on the field NAME rather than the frame type. Check that the auth frame still carries `token` under that name; that is the one thing the redaction depends on. `buildWebSocketAuthMessage` in `src/net/online.ts` is where to read it. |
| `window.__game` keys | `src/main.ts` | `grep -n 'window.__game\|__game =' src/main.ts` | The runtime's probe reads this object. A key leaving is a read that starts returning undefined. Keys arriving are usually debug surface and usually nothing. |
| The theme picker | `src/ui/theme.ts` | `grep -rn 'documentElement.style.setProperty' src/ui/theme.ts` | It rewrites a subset of tokens at run time in JavaScript, so alternate themes are in no stylesheet and the stage can only ever show the default. If the picker's token subset grows, nothing here changes, but do not let anyone conclude the stage is broken. |

## B. What has to be regenerated

Read `generated.md` beside this file for how each generator is invoked and which of them read the network rather than the checkout. This table is only about deciding WHETHER each has anything to write.

| Artifact | Game input | Decide by |
|---|---|---|
| `packages/types/items.generated.d.ts` | `public/ui/items/` and its `mapping.json` | `git diff --stat <old> <new> -- public/ui/items/`. Empty means a guaranteed no-op. |
| `packages/types/icons.generated.d.ts` | `public/ui/skills/<class>/mapping.json`, nine files | `git diff --stat <old> <new> -- public/ui/skills/`. Watch for ids REMOVED as well as added: five paladin ids were retired at 0.36.0, so a regenerated union is not always additive. A new FOLDER there is not a new class: 0.39.0 added `pet`, which is pet-bar buttons no addon can name, and it is deliberately not in `ICON_CLASSES`. |
| `packages/types` aura family, via `runtime/ui/kit/aura-art.ts` | `public/ui/auras/mapping.json` | Nothing is generated from it, so there is no artifact to regenerate; the runtime reads the deployed manifest. What to check is that the manifest is still SERVED and still shaped `{family: 'auras', assets: [{auraId, output}], externalAssets: [{auraId, runtimeUrl}]}`, because `family` is the shape check and a rename would make the whole family read as empty. New at 0.39.0. |
| `packages/types/cues.generated.d.ts` | `public/audio/sfx/runtime-pack.json` and the clips | `git diff --stat <old> <new> -- public/audio/` |
| `stage/theme.generated.css` | `src/styles/tokens.css` plus the rules for the three borrowed classes | `git diff <old> <new> -- src/styles/tokens.css src/styles/base.css`. A token being REMOVED matters more than one being added: a loader rule reading a token the game no longer declares, with no fallback, silently stops applying, and `pnpm theme` warns about exactly that. |
| `packages/types/aura-kinds.generated.d.ts` and `loader/src/shared/aura-kinds.generated.ts` | `src/sim/aura_classify.ts` | `git diff <old> <new> -- src/sim/aura_classify.ts`. Two outputs, because there is no endpoint to re-read at run time so the runtime carries the value as well as the type. |
| The nine addon data tables | Each table names its own sources; see below | Run `pnpm tables`. Do not decide this by reading source diffs. |

**On the data tables specifically.** Each table records its own provenance in its header, under `generatedFrom`, `source`, `game` or `gameVersion` depending on which generator wrote it, and two of them (`veinsight`, `emberwatch`) record no source list at all, so the only complete answer is in the generator. A changed source file does NOT mean a stale table: `v0.36.0..v0.37.1` touched `src/sim/content/zone1.ts` and `src/sim/content/rift/mobs.ts`, which feed four tables, and all four regenerated byte-identical apart from the stamp. Regenerate and diff the OUTPUT. That is what `pnpm tables` does.

## C. New readable surface: the publish candidates

This is the part that needs judgement, and the method is one question asked in a fixed order.

1. **Did the shape change?** `src/sim/types.ts` is where the event union, the entity payloads and the item payloads live. `git diff <old> <new> -- src/sim/types.ts` is the highest-yield single diff in the cycle.
2. **Is it actually SENT?** A field in `src/sim/types.ts` is a declaration, not a promise. Read the send site in `server/game.ts`: `wireEntity`, `identityFields`, `dynamicFields` for entities, and `selfWireJson` for the self payload, which seeds from `wireEntity` and assigns the self-only stats over it. Read the function; do not grep it, because a payload assembled by spreading does not mention its inherited fields anywhere a search can reach.
3. **Is the send site a SEND?** `captureBotDetectionSnapshot` in `server/game.ts` reads `inCombat`, `moveSpeed` and `onGround` into a server-internal record that never becomes a frame. A grep finds a server write that reads exactly like a send. The question is whether the object being written lands in a frame.
4. **Is it honest on every surface it appears on?** `publicInstanceView` in `src/sim/item_instance_transfer.ts` carries an allowlist, so an item field can be real on your own bags and structurally absent on a market row. Publishing it on a shape that covers both is publishing a field that is sometimes a lie. The precedent is `OwnedItemInstance extends PublicItemInstance`: narrow the shape, and say in the doc line WHY the wide one can never carry it.
5. **Does a watcher need to see it change?** A published field that is not in the relevant `loader/src/runtime/world/signature-*.ts` mark arrives correctly and never fires its `world.on`. That is the defect the 0.37.1 cycle found: an item lock reached us and no subscriber could see it toggle.

Other places a new readable surface shows up:

| Surface | Last seen at | Note |
|---|---|---|
| Market query and page shape | `src/sim/market_query.ts`, `src/world_api/market.ts` | The market page is passed through rather than projected, so a new field ARRIVES before it is published. That is the passthrough trap: nothing in the published types promises it, so an addon built on it is built on nothing. |
| Default keybinds | `src/game/keybinds.ts` | Nothing to change here. Conflict detection reads the game's live profile, so a new default binding is reported correctly the day it ships. 0.37.1 added `targetPrev` on `Shift+Tab` and cost nothing. |
| Content tables | `src/sim/data.ts`, `src/sim/content/*.ts` | These feed the addon data tables rather than the API. Group B. |
| Item art resolution | `src/ui/icons.ts` (`ITEM_ART_PENDING`, `weaponIconUrl`, `currencyImageUrl`), `src/sim/content/heroic_variants.ts` | The loader mirrors the game's own resolver. If the game changes how it resolves an icon, `loader/src/runtime/ui/kit/item-art.ts` has to change with it or `icon.item()` starts promising URLs that 404. `staticIconUrl` is the function to read, since it decides the ORDER the families are tried in: 0.39.0 put `currencyImageUrl` ahead of the item arms and split `aura` out of the `ability` arm. |

## D. Looks publishable, is not

Check here before proposing anything. Each of these is a client-side default or a server-internal value, which means it is present, of the right type, and permanently wrong.

- **Fields the client constructs with defaults.** `src/net/online.ts` builds every entity with defaults and fills in what the snapshot carried, so a field the server never sends is present and holds that default for the whole session. `ccDr` is built as an empty Map there. The current not-on-the-wire list is in `AGENTS.md` and this cycle is the only thing that ever re-checks it, in both directions: a field can LEAVE the list, as `castTargetId` did at 0.36.0.
- **Write commands.** `IWorld` gains methods every release or two. `net` is read-only and that is the project's premise rather than a gap, so a new write command is a line in the report and nothing else.
- **A reworked mechanic whose state is not sent.** The 0.37.1 PvP diminishing-returns rework is the clean example: the whole ladder changed and an addon can see none of it. Worth reporting precisely because it looks like a feature opportunity until you check the wire.
- **Server telemetry enums.** `UnstuckAreaKind` gaining a member is not a surface.
- **A refusal reason on an event we do not publish.** Craft and salvage gained a `'locked'` refusal at 0.37.1 and we publish no craft or salvage result event, so there was nothing to extend. Publishing the event is a real feature and a separate piece of work, not a catch-up item.

## Where the counts live

Several claims in `AGENTS.md` are measurements with dates on them, and this pass is the only thing that re-reads them. They are listed in the skill body under the documentation phase. The ones that go stale fastest are the deployed-channel table, the item and skill-icon counts, the item-art completeness claim, and the not-on-the-wire field list.
