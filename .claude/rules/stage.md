---
paths:
  - "stage/**"
  - "addons/*/stage.ts"
  - "addons/*/preview.png"
  - "addons/*/addon.json"
  - "tools/shots*"
  - "tools/stage*"
  - "tools/theme*"
  - "tools/kit-classes.ts"
  - "loader/build-stage.mjs"
---

# The stage and previews

Part of `AGENTS.md`, split out because it applies only to the paths above. Everything in `AGENTS.md` still holds here.

- **A scenario states what was ALREADY TRUE in `world` and what then HAPPENED in `run`.** The addon reads the world on its first line, so anything a session has at login (class, spellbook, bags, party) goes in `world`.
- **Adopting `woc.paint` needs three edits**: the addon, `harness.frames.tick()` in its suite, and `stage.frame()` in its scenario. A missing scenario tick photographs a BLANK panel into the committed preview and nothing warns, so open the capture.
- **The stage empties the player's dynamic collections** in `createPlayer` (`stage/src/stage.ts`), not in the shared fixture that suites assert on.
- **The loader inherits the game's look through tokens AND three worn classes** (`panel`, `panel-title`, `x-btn`). `.panel` carries a frame's edge, so tokens alone render a frame with no border. `pnpm theme` copies both, keeping each rule's layer and media query. `tests/tools-theme.test.ts` fails when the kit wears a class the extractor does not know (`tools/kit-classes.ts`).
- **A preview is CROPPED to the drawn frames plus 24px.** Frames floor at their opening size, so fix a half-empty panel with more content and an overfull one with less, never with a different box. Scale is chosen from `MIN_DEVICE_WIDTH` and verified against the capture, with `SLOT_MARGIN` (16px) absorbing rasteriser jitter. Width growth and the 512 kB shrink are separate passes in that order.
- **A preview may be a SHEET of several `preview: true` scenarios**, each in its own iframe (one document cannot hold two copies of an addon), captioned in the page because sharp lacks the game font. **Budget: `panes * (box + 48) + (panes - 1) * 16 <= 1440`**; over it the last pane is silently cropped.
- **`pnpm shots` never guesses**: which scenario (`preview: true`), when it is done (`data-stage="ready"`), or what it shows (`alt` written on the scenario, copied verbatim).
- **The stage shows only the game's default theme**; the theme picker's values live in JavaScript (`src/ui/theme.ts`), in no stylesheet.
