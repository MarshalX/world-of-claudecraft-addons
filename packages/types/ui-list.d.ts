// The keyed list: what you draw a changing set of things with.
//
// Its own file on the subject axis ui-timers.d.ts and ui-controls.d.ts were split
// along: a bar and a tile are what one row IS, and this is how a screenful of them
// comes and goes. It owns the lifecycle; what a row IS stays yours, since `create`
// returns whatever you want to hold and `update` is handed it straight back.

/**
 * What a row has to be able to do. Added in API minor 4.
 *
 * Everything the kit builds already is one, so `create` can return a `ui.bar` or a
 * `ui.tile` as it stands. A row you assemble out of parts carries the `destroy` that
 * takes all of them down:
 *
 * ```js
 * create: (node) => {
 *   const tile = woc.ui.tile({ label: node.name });
 *   const anchor = woc.ui.anchor3d(() => node.pos);
 *   anchor.el.appendChild(tile.el);
 *   return { tile, anchor, destroy: () => { tile.destroy(); anchor.destroy(); } };
 * },
 * ```
 */
export interface Destroyable {
  destroy: () => void;
}

export interface ListOpts<T, H extends Destroyable> {
  /**
   * Where the elements live. Added in API minor 4.
   *
   * Given one, the list keeps that parent's children in the order you called `sync`
   * with, moving only what actually moved, and it OWNS where they are: a row cannot be
   * in the parent and somewhere else at once. Omit it and nothing is inserted or
   * ordered, which is what a world pin needs, since its `ui.anchor3d` places it.
   *
   * Drawing the same thing on a panel and over a unit wants two lists, one of each
   * kind, over the same reading. See `shown`.
   */
  parent?: Element;
  /**
   * What makes two items across two syncs the same item. Added in API minor 4.
   *
   * A row survives for as long as its key keeps turning up, so this decides what a
   * player sees hold still. Key on the thing itself, an ability id or a node id, never
   * on its position in the array, or every reorder rebuilds the row that moved.
   *
   * **Distinct within one sync, not merely stable across syncs.** A reading that
   * repeats a key is refused whole, with the key named, and nothing you were already
   * holding is touched.
   *
   * A DISPLAY NAME is the trap, because it looks like the thing itself and is not: a
   * mob's ability reaches you as a bare label with no id, and two can carry the same
   * label, so a list of what is being cast at you collides. Where no id is carried, key
   * on something unique in your own reading, such as the caster's entity id with the
   * label, or an ordinal within the pass.
   */
  key: (item: T) => string;
  /**
   * Build one. Added in API minor 4.
   *
   * Return whatever you want to hold: the widget, or an object with the widget and
   * whatever you measured. `destroy` is called on it when the item leaves, when you
   * clear the list, and when your addon is disabled.
   */
  create: (item: T) => H;
  /**
   * Called for every item on every sync, the ones just created included. Added in
   * API minor 4.
   *
   * This is where the painting goes. It runs after `create`, so a new row is drawn by
   * the same code that redraws an old one. The index is the row's position in the array
   * you passed, NOT the position it is drawn at when you are using `shown`.
   *
   * It runs for an unshown row too, which is how one that is off screen keeps
   * measuring. Skip that work yourself only if it is expensive: `ui.bar` and `ui.tile`
   * drop an update that repeats what a slot already says.
   */
  update?: (held: H, item: T, index: number) => void;
  /**
   * Which held rows are DRAWN, when you hold more than you show. Added in API minor
   * 4.
   *
   * Everything is drawn by default. Pass the whole set you want KEPT to `sync` and
   * answer false for the ones that should not be on screen: the row stays ALIVE with
   * everything it has measured, so one coming back into view is the row that left.
   * That is the difference between a missing row and a wrong one, since a cooldown
   * whose length you learned by watching it, rebuilt when it comes back, baselines from
   * the middle of the cooldown it is already in and draws a confidently wrong fill.
   *
   * ```js
   * // Every cooldown kept, the ten soonest ready drawn.
   * rows.sync(running.sort((a, b) => a.left - b.left));
   * // with: shown: (timer, index) => index < 10,
   * ```
   *
   * THE TWO INDICES ARE DIFFERENT. This one, and `update`'s, is the item's position in
   * the array you passed; a shown row is PLACED at its rank among the shown rows alone,
   * so hiding the third of five leaves the fourth drawn third with no gap.
   *
   * Nothing to do without a `parent`. And an unshown element leaves the DOCUMENT rather
   * than only the parent, so a row that re-homes its own element, as a world-anchored
   * one does inside its `ui.anchor3d`, is pulled back off that anchor every sync. Draw
   * one row in two places with TWO lists rather than one `shown` meaning two things.
   */
  shown?: (item: T, index: number) => boolean;
  /**
   * How to find the element to order, when `parent` is set and what `create`
   * returned is not one. Defaults to reading `held.el`. Added in API minor 4.
   *
   * Resolved ONCE, when the row is created: that element is what gets ordered and
   * what gets taken out of the parent when the row leaves.
   */
  element?: (held: H) => Element;
}

export interface List<T, H extends Destroyable> {
  /**
   * Reconcile against this exact set, in this exact order. Added in API minor 4.
   *
   * In order: everything held whose key is not in `items` is destroyed, everything new
   * is created, `update` runs for every item, and each element is moved into place when
   * there is a `parent`. So this is the set you want KEPT and `shown` is which of it is
   * on screen. A sync that changes nothing writes nothing to the document, so calling
   * it from a frame loop is the intended use.
   */
  sync: (items: readonly T[]) => void;
  /** What you are holding for that key, if anything. Added in API minor 4. */
  get: (key: string) => H | undefined;
  /**
   * Every row you are holding, drawn or not. Added in API minor 4.
   *
   * For work that is not a sync: a per-frame pass over a set that changes now and then.
   * Fading each world pin by how far away it is, pointing every arrow as the player
   * turns. Neither is a reconcile and neither should force one.
   *
   * ```js
   * // Sixty times a second, over rows the sync above put there once.
   * woc.onFrame(() => {
   *   for (const pin of pins.values()) {
   *     pin.tile.el.style.opacity = fade(pin.area);
   *   }
   * });
   * ```
   *
   * **It hands you a COPY.** Syncing from inside the walk cannot disturb the walk: you
   * carry on over the rows held when you asked, including any that sync took down. The
   * array is yours, so dropping from it drops nothing; the list changes only by `sync`.
   *
   * The rows come in CREATION order, not the order you last synced. If you want display
   * order you have it already, in the array you just passed to `sync`.
   */
  values: () => readonly H[];
  /** How many rows are held. Added in API minor 4. */
  readonly size: number;
  /**
   * Destroy everything held, keeping the list usable. Added in API minor 4.
   *
   * For the moment there is nothing to draw at all: a fight over, a player who left the
   * world. The next `sync` builds it back.
   */
  clear: () => void;
  /**
   * Destroy everything and stop. Added in API minor 4.
   *
   * Done for you when your addon is disabled, which is why this is rarely worth calling.
   * A stopped list stays stopped: a `sync` landing after it, from a frame loop that got
   * one more tick in, does nothing rather than building rows into a frame that is gone.
   */
  destroy: () => void;
}
