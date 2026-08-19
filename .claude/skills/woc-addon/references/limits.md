# What the game does not give an addon

Read this when an idea depends on something you cannot find in `packages/types/`, before concluding it is a gap in the loader. Almost everything here is a limit of the WIRE or of the client's own bundling: the server does not send it, or the client holds it somewhere no addon can reach. No amount of API reading finds a way round those, and an addon that appears to have one is guessing.

Each entry says what is missing and what to do instead, because "you cannot have this" without "do this instead" is how a limit turns into a bug report.

## Contents

- [The absolute ones](#the-absolute-ones)
- [Combat and meters](#combat-and-meters)
- [Abilities, auras and control](#abilities-auras-and-control)
- [Items and the economy](#items-and-the-economy)
- [Encounters and the world](#encounters-and-the-world)
- [Drawing](#drawing)
- [How to tell a limit from a gap](#how-to-tell-a-limit-from-a-gap)

## The absolute ones

**There is no send API, and there will not be one.** Nothing an addon does can accept a roll, take a queue proposal, place a marker, buy a listing, sort a bag or cast anything. The game's terms prohibit automating play and the loader has no path to do it. Every addon is a DISPLAY. A feature description that reads as an action is a defect in the description.

**The session token is off limits.** Never read `localStorage['woc_session']`. Outbound frames are redacted before any addon sees them, matched on the field name so a version bump cannot slip one past.

**`world.raw.drainEvents()` breaks the game.** It is destructive: it returns the queued events and EMPTIES the queue, and the game's own main loop is the intended caller. An addon that calls it silently eats the player's combat log, loot toasts, quest popups and cast bars, with no error and no obvious cause.

## Combat and meters

**Combat events are scoped to you and your group, within a radius.** The server delivers a damage or heal record only if you are the source, the target, or grouped with one of them, and there is a distance limit on top of that. A meter measures the group it is in, which is what a meter is for. It must not present a total as realm-wide, and must not silently drop to zero when the player leaves the group.

**A pet's damage is never delivered at all.** The participant test matches player ids, and a pet is a mob-kind entity with its own entity id, so its swing at a mob matches nothing and is filtered server-side. The pet is not invisible: it is in the entity list, its owner is readable, and it hitting YOU is delivered because you are the target. So an addon can see the pet, name it, watch it fight, and never say what it did. Do not infer pet damage from the target's health delta; a pet's swing and a second player's land identically.

**Overhealing is never reported.** The heal is clamped to the target's missing health before the record is emitted, and the clamped amount is discarded. Report EFFECTIVE healing and say so. Reconstructing overheal from a health delta does not work: a heal landing in the same tick as damage is indistinguishable from an overheal.

**A heal is attributed from the record that carries a source.** The plain heal event has a target and an amount and nothing to attribute it to. Records flagged as cue-only carry no healing and exist to drive a sound: skip them ON THE FLAG, never on a zero amount, because a genuine direct heal legitimately lands at 0 on a target already at full health.

**Enemy and ally cooldowns are not sent.** Only your own. Anything about another player's cooldown is an inference from an observed cast, and an ability used out of scope is invisible. Present it as an inference, and show "unknown" rather than "ready" for anything never observed.

## Abilities, auras and control

**An ability's id and its display name have diverged and nothing bridges them.** Skill art is filed under the id; combat records carry the name. `world.abilities` closes the join in both directions for YOUR OWN spellbook, and that exception is the whole of what is recoverable. For anything a mob casts, a name derived from an id is a guess. Slugify and let the failure be cosmetic: a bar hides its icon slot when the art 404s.

**A lockout aura's id is not an ability id.** An interrupt applies an aura whose id has a suffix, so it can never resolve art through the ability icon builder.

**An aura event cannot identify what it names.** It carries a display name, a gained flag and a target, and no id, and often no kind. Build an aura model from the entity's own aura list and use the event only as a cheap "something changed on that unit" nudge. An addon that builds its model from the event looks correct and silently confuses two abilities that share a display name.

**A party row's aura strip is capped, filtered and rounded.** At most eight, filtered by the game's own relevance rule, whole-second remaining, no stacks, no value, no school, no source. This cannot be widened. Build a healer display on rows anyway, because a row exists for a member nowhere near you and an entity does not, and reach for the entity only to enrich the members close enough to have one.

**Diminishing returns state is server-side**, but the applied duration rides the aura, so the stage is recoverable by comparing an observed duration against the ladder. Two facts a display must state rather than assume: diminishing returns apply between two PLAYERS only and never to a mob, and STUNS DO NOT DIMINISH. Showing a stun ladder is showing a lie.

**Combo points have no published maximum.** Size a pip strip to the most seen this session and say so.

**A mob's aura often has an icon now, and this entry used to say it never could.** Game 0.39.0 began serving `/ui/auras/mapping.json`, and `ui.icon.aura(id)` reads it. That family is exactly the auras no ability id names, mob-applied ones among them, so ask it FIRST and fall back to `ui.icon.ability` for an aura a player applied, which is the order the game's own resolver uses. Two things to carry from the old entry, because they still hold. The family is closed and small, so plenty of effects are in neither route and are still composited on a canvas from a bundled table with nothing to point at: keep the null branch. And `ui.icon.aura` answers null until its manifest lands, unlike the other builders, so `await woc.ui.icon.preloadAuras()` once at start or your first rows keep their fallback.

## Items and the economy

**Item metadata is bundled and unreachable.** There is no item table on any object an addon can see, and no item level anywhere at all, because item level is derived from where the item drops. Four partial sources: a served art manifest gives some names, loot rolls carry a name and quality beside the id and teach one item permanently each time, the recipe table is reachable, and an addon can embed a distilled table of its own. The served manifest's name field is the ART SOURCE name and disagrees with the game's display name for a meaningful fraction of items, so it is reliable for ART and not for naming.

**No item declares its stack maximum.** Compute against the largest stack you have OBSERVED and say that is what you did. An observed maximum is a lower bound that improves; a guessed one is wrong quietly.

**The market keeps no price history.** No history table, no sold-price record, no query for either. A listing exists until bought or until it expires. So the addon IS the history: record every page the player browses, keyed by item, with a timestamp.

**Drop chances are bundled with the mob templates** and are unreachable for the same reason items are.

**The proximity-gated reads are three-state.** Market, mail and bank stream only while the player stands at the counter. `near` carries the payload, `away` means not there, `unknown` means nothing has decoded. Never present `away` as an empty market, an empty mailbox or an empty bank, and never store a snapshot on it.

## Encounters and the world

**Encounter internals are server-side.** The phase, the mark list and per-mechanic timers do not ride the wire.

**A boss mechanic's cadence cannot be predicted from engage.** The timer is seeded at spawn, not at engage, and it decrements only while the boss is in melee contact, which is what lets a ranged kiter hold a boss out of melee so that none of them ever land. A big cast also re-arms to its interval plus its own cast time, so the first gap differs from the rest. Anchor on an observed instance and project forward, and draw the first one as unknown.

**The telegraph flag is far narrower than its name.** It marks a handful of the most lethal mechanics in the whole game, not the mechanic set. An addon that FILTERS on it sees those few and reports every other boss as quiet. Read cast bars as the primary source and treat the flag as an addition.

**The elite, rare and boss flags are not on the wire.** An entity record carries kind, template id, name and level; the client resolves the rest from its own bundled table. An addon that wants to mark a rare carries its own roster and matches on template id.

**An experience award carries no source.** A kill and a quest turn-in are the same record. "Kills to level" is therefore an inference: credit an award that lands within a couple of seconds of a death you were involved in, keep the window short, and say it is a heuristic.

**A mob's selected target is not on the field you expect.** The ordinary target field is written for players and bots only, so on every mob in the game it is present, correctly typed and permanently null. A mob's target rides the aggro field instead. The unit resolver for "target of target" hides the difference, and hiding it is most of what that resolver is for.

**Zone identity is display text, not an id.** The published zone is the game's own localized minimap label, so comparing it against a hardcoded string only works for players running one language. Resolving a zone from a position means carrying the rectangles yourself, and the game's own resolver has a clamping fallback that names a real overworld zone for a player standing in a dungeon or an arena, so a naive copy is wrong exactly where it matters.

## Drawing

**There is no terrain height and no world-to-screen scale.** The height functions are module-scope in the client and on no reachable object, and no heightmap is served. A ground marker is anchored at a guessed height: capturing the player's own height once, when the effect is first seen, is the best available answer because it is the one height known to be on the floor. Do not track it live, which would slide markers up ramps and drop them on jumps.

**A unit's model height is not on the entity.** It lives on the renderer, so a nameplate drawn at a fixed offset is wrong for a very large model and wrong differently for a very small one.

**A cast in progress carries no school**, so a mob's cast bar cannot be tinted by damage type. Guessing a school from an ability id puts a claim about damage type on a row that nothing on the wire made; leave it untinted and say why.

**Roll numbers arrive as composed chat text.** The live vote state carries each member's choice and not their number; the number appears only at resolution inside a chat line. Parse it, and treat a parse miss as unknown rather than as zero. The item id is bracketed in a stable token, so the ITEM is reliable even when the number is not.

## How to tell a limit from a gap

If the data is on an object the loader can reach and simply is not published, that is a LOADER gap and it can be fixed. If the server never sends it, or the client holds it in a bundled table, no loader change helps.

Two things make this harder than it sounds, and both have cost real bugs:

**A field being present proves nothing.** The client builds every entity with defaults and fills in what the snapshot carried, so a field the server never sends is present, of the right type, and holds that default for the whole session. It passes every shape check. The way to tell is to read the server's SEND SITE, not the client's type declaration.

**A field nobody has named is invisible.** The loader reads the game's objects field by field, so nothing reports a field that exists and was never asked for. Listing the keys of a live object once, from a running client, finds what reasoning cannot.
