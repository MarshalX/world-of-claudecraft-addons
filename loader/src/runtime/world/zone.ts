// Where the player is, read off the game's own minimap label.
//
// The zone table is bundled content the hook does not expose, so this is the minimap's text:
//
//  - A localized DISPLAY NAME, not an id, so it cannot be compared against a hardcoded string.
//  - Null until the HUD is cloned in at world entry.
//  - Underground, the delve painter owns the same element.
//
// No subzone: the game's landmark banner is never cleared on the way out, so it holds the last
// landmark announced rather than where the player is.

import { ANCHORS } from '../ui/anchors.ts';

/** The zone name the game is displaying, or null when there is no HUD yet. */
export function createZoneReader(doc: Document): () => string | null {
  return () => {
    const text = doc.querySelector(ANCHORS.zoneLabel)?.textContent;
    if (typeof text !== 'string') {
      return null;
    }
    const trimmed = text.trim();
    // An empty label means nothing to say, not a zone named ''.
    if (trimmed.length === 0) {
      return null;
    }
    return trimmed;
  };
}
