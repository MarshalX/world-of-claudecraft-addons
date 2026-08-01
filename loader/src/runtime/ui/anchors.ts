// Every game DOM selector the loader depends on, in one table.
//
// These are the external surface the whole project rests on, and the game owes
// us no compatibility for any of them. Collecting them here means a game update
// that moves one is a single edit, and it lets the manager's Diagnostics pane
// report which anchors still resolve, so drift is visible before an addon
// author reports it as a bug.
//
// Each entry records where the game builds it, so a check against the game
// source starts from a real file rather than a guess.

/**
 * Everything from hudRoot through microOptions lives inside the game's
 * <template id="game-ui-template"> and does NOT exist until world entry clones
 * it into the document. Only gameVersion is in the live DOM from the start.
 * That is why the in-game injections wait (see ui/hud-mount.ts) rather than
 * looking their anchor up once.
 *
 * The keys are ordered as the loader uses them: the HUD root first, then the
 * game menu, then the micro-button rail, then the version readout.
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
   * The minimap's zone name, written by the minimap painter every frame.
   *
   * The one place the loader can read where the player is. The zone table is
   * content, so there is no id to be had, and the delve painter owns this same
   * element underground, which is why the reading is "what the game says you are
   * looking at" rather than an overworld zone.
   */
  zoneLabel: '#zone-label',
  /** The footer build readout, and the only anchor here outside the HUD template. */
  gameVersion: '#game-version',
} as const;

export type AnchorKey = keyof typeof ANCHORS;

export const ANCHOR_KEYS = Object.keys(ANCHORS) as AnchorKey[];

/**
 * The anchors that must resolve once the HUD is in the document.
 *
 * The three menu-internal ones are deliberately absent: `.opt-list` and
 * `.opt-version` exist only while the menu is open on its root view, and
 * `[data-back]` only on a sub-view, so none of them says anything about drift
 * when checked at an arbitrary moment.
 */
export const ANCHORS_REQUIRED_IN_GAME: readonly AnchorKey[] = [
  'hudRoot',
  'optionsMenu',
  'microColumn',
  'microOptions',
  'zoneLabel',
];

/** The classes the game puts on a menu entry, reused so ours is styled by the game. */
export const GAME_MENU_BUTTON_CLASS = 'btn opt-btn';

/** The classes the game puts on a rail button. */
export const GAME_MICRO_BUTTON_CLASS = 'micro-btn';

export interface AnchorReport {
  key: AnchorKey;
  selector: string;
  found: boolean;
}

/**
 * Which anchors resolve right now.
 *
 * A false is not automatically a fault: the game menu exists only while it is
 * open, and the version footer only on the index document. The pane presents it
 * as a reading rather than a verdict.
 */
export function resolveAnchors(doc: Pick<Document, 'querySelector'>): AnchorReport[] {
  return ANCHOR_KEYS.map((key) => ({
    key,
    selector: ANCHORS[key],
    found: doc.querySelector(ANCHORS[key]) !== null,
  }));
}
