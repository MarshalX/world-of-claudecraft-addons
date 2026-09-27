// Every game DOM selector the loader depends on, in one table, so a game update that moves
// one is a single edit. The manager's Diagnostics pane resolves this table live.

/**
 * The class the game puts on `document.body` while its HUD edit mode is on
 * (`INTERFACE_UNLOCKED_BODY_CLASS`, `src/ui/interface_unlock.ts`). ui/game-unlock.ts
 * matches on the class alone.
 */
export const GAME_UNLOCKED_CLASS = 'interface-unlocked';

/**
 * Everything from hudRoot through microOptions lives inside the game's
 * `<template id="game-ui-template">` and does not exist until world entry clones it, which
 * is why the in-game injections wait (see ui/hud-mount.ts). gameVersion is in the live DOM
 * from the start; interfaceUnlocked is a mode, absent until the player enters it.
 */
export const ANCHORS = {
  /** The game's HUD root, and the marker for the whole clone having landed. */
  hudRoot: '#ui',
  /** The game menu panel. Rebuilt with innerHTML on every view change. */
  optionsMenu: '#options-menu',
  /** The menu's button column. Present only on the menu's root view. */
  optionsList: '.opt-list',
  /** The version line. A SIBLING of the button list, not a child of it. */
  optionsVersion: '.opt-version',
  /** Present only on a sub-view, which is how a sub-view is told from the root. */
  optionsBack: '[data-back]',
  /** The micro-button rail. */
  microColumn: '#side-buttons-col-b',
  /** The game-menu micro button, which the Addons button is placed next to. */
  microOptions: '#mm-options',
  /**
   * The minimap's zone name, repainted every frame. It carries no zone id, and the delve
   * painter owns it underground, so it reads as "what the game says you are looking at".
   */
  zoneLabel: '#zone-label',
  /** The footer build readout, which is in the live DOM from the start. */
  gameVersion: '#game-version',
  /** The game's own HUD edit mode ("Edit Frames"). Resolves only while the mode is open. */
  interfaceUnlocked: `body.${GAME_UNLOCKED_CLASS}`,
} as const;

export type AnchorKey = keyof typeof ANCHORS;

export const ANCHOR_KEYS = Object.keys(ANCHORS) as AnchorKey[];

/**
 * The anchors that must resolve once the HUD is in the document. The menu-internal ones and
 * interfaceUnlocked exist only in a particular view or mode, so they say nothing about drift.
 */
export const ANCHORS_REQUIRED_IN_GAME: readonly AnchorKey[] = [
  'hudRoot',
  'optionsMenu',
  'microColumn',
  'microOptions',
  'zoneLabel',
];

/**
 * The classes the game puts on a menu entry, reused so ours is styled by the game.
 *
 * `ui-btn` carries the plate and is what the game's `#options-menu .opt-btn.ui-btn` row
 * rule keys on. Without it the entry is still styled, by the game's legacy
 * `.btn:where(:not(.ui-btn))` arm, so it looks subtly wrong rather than broken.
 */
export const GAME_MENU_BUTTON_CLASS = 'btn ui-btn opt-btn';

/**
 * The classes the game puts on a rail button (`play.html`, every `#mm-*`). The plate lives
 * on `.ui-icon-btn`, so a button wearing only `micro-btn` draws a bare glyph.
 */
export const GAME_MICRO_BUTTON_CLASS = 'micro-btn ui-icon-btn ui-icon-btn--micro';

export interface AnchorReport {
  key: AnchorKey;
  selector: string;
  found: boolean;
}

/**
 * Which anchors resolve right now. A false is not automatically a fault: the game menu
 * exists only while it is open, and the version footer only on the index document.
 */
export function resolveAnchors(doc: Pick<Document, 'querySelector'>): AnchorReport[] {
  return ANCHOR_KEYS.map((key) => ({
    key,
    selector: ANCHORS[key],
    found: doc.querySelector(ANCHORS[key]) !== null,
  }));
}
