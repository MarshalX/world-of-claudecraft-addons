// Where the player is, read off the game's own minimap label.
//
// The zone table is CONTENT: it lives in the client bundle behind a pure
// function of the player's position, and nothing on the hook exposes either the
// table or the id it resolves to. So the only reading available is the text the
// minimap painter writes, and that shapes what can honestly be published:
//
//  - It is a localized DISPLAY NAME, not an id. It changes with the client's
//    language, so an addon cannot compare it against a hardcoded string and
//    expect that to work for anyone else. Show it, or watch it change.
//  - It is null until the HUD exists, because the element ships inside the
//    game's UI template and is cloned in at world entry.
//  - Underground the delve painter owns the same element, so the reading is
//    "what the game says you are looking at" rather than an overworld zone.
//
// The SUBZONE is deliberately not here. The game announces a landmark once, as a
// banner, when the player walks into it, and never clears it on the way out, so
// the element holds the last landmark announced rather than where anyone is. A
// reading taken from it would be right for a moment and wrong for the rest of
// the session, which is worse than not offering one.

import { ANCHORS } from '../ui/anchors.ts';

/** The zone name the game is displaying, or null when there is no HUD yet. */
export function createZoneReader(doc: Document): () => string | null {
  return () => {
    const text = doc.querySelector(ANCHORS.zoneLabel)?.textContent;
    if (typeof text !== 'string') {
      return null;
    }
    const trimmed = text.trim();
    // An empty label is the painter having nothing to say, which is the same
    // answer as no HUD rather than a zone whose name is the empty string.
    if (trimmed.length === 0) {
      return null;
    }
    return trimmed;
  };
}
