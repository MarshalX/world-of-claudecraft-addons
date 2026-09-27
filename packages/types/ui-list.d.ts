// The keyed list: what you draw a changing set of things with.
//
// The list owns the lifecycle; what a row IS stays yours, since `create` returns
// whatever you want to hold and `update` is handed it straight back.

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

/** Added in API minor 4, every member included. */
export interface ListOpts<T, H extends Destroyable> {
  /**
   * Where the elements live.
   *
   * Given one, the list keeps that parent's children in `sync` order, moving only
   * what moved, and OWNS where they are. Omit it for world pins, which their
   * `ui.anchor3d` places. Drawing one thing on a panel and over a unit takes two
   * lists over the same reading.
   */
  parent?: Element;
  /**
   * What makes two items across two syncs the same item.
   *
   * A row survives as long as its key keeps turning up. Key on the thing itself (an
   * ability id, a node id), never its array position, or every reorder rebuilds.
   *
   * **Distinct within one sync, not merely stable across syncs.** A reading that
   * repeats a key is refused whole, with the key named, and nothing you were already
   * holding is touched.
   *
   * A DISPLAY NAME is the trap: a mob's ability arrives as a bare label and two can
   * share one. Where no id is carried, key on something unique in your reading, such
   * as the caster's entity id with the label, or an ordinal within the pass.
   */
  key: (item: T) => string;
  /**
   * Build one.
   *
   * Return whatever you want to hold: the widget, or an object with the widget and
   * whatever you measured. `destroy` is called on it when the item leaves, when you
   * clear the list, and when your addon is disabled.
   */
  create: (item: T) => H;
  /**
   * Called for every item on every sync, just-created ones included, after
   * `create`: this is where the painting goes. The index is the position in the
   * array you passed, NOT the drawn position when you use `shown`.
   *
   * It runs for an unshown row too, so an off-screen row keeps measuring. `ui.bar`
   * and `ui.tile` already drop an update that repeats what a slot says.
   */
  update?: (held: H, item: T, index: number) => void;
  /**
   * Which held rows are DRAWN, when you hold more than you show. Defaults to all.
   *
   * Pass the whole set you want KEPT to `sync` and answer false for rows off screen:
   * the row stays ALIVE with everything it measured, so it returns intact instead of
   * rebuilt from mid-cooldown with a wrong fill.
   *
   * ```js
   * // Every cooldown kept, the ten soonest ready drawn.
   * rows.sync(running.sort((a, b) => a.left - b.left));
   * // with: shown: (timer, index) => index < 10,
   * ```
   *
   * THE TWO INDICES DIFFER. This one, like `update`'s, is the position in the array
   * you passed; a shown row is PLACED at its rank among shown rows, so hiding the
   * third of five draws the fourth third with no gap.
   *
   * No effect without a `parent`. An unshown element leaves the DOCUMENT, so a row
   * that re-homes its element (inside a `ui.anchor3d`) is pulled off that anchor
   * every sync: use TWO lists to draw one row in two places.
   */
  shown?: (item: T, index: number) => boolean;
  /**
   * How to find the element to order, when `parent` is set and what `create`
   * returned is not one. Defaults to reading `held.el`. Resolved ONCE, when the row
   * is created.
   */
  element?: (held: H) => Element;
}

/** Added in API minor 4, every member included. */
export interface List<T, H extends Destroyable> {
  /**
   * Reconcile against this exact set, in this exact order.
   *
   * Destroys held rows whose key is absent, creates new ones, runs `update` for every
   * item, and orders elements when there is a `parent`. A sync that changes nothing
   * writes nothing to the document, so calling it every frame is fine.
   */
  sync: (items: readonly T[]) => void;
  /** What you are holding for that key, if anything. */
  get: (key: string) => H | undefined;
  /**
   * Every row you are holding, drawn or not, for per-frame work that is not a
   * reconcile: fading pins by distance, turning arrows.
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
   * **It hands you a COPY**, so syncing inside the walk cannot disturb it, and editing
   * the array changes nothing. Rows come in CREATION order, not sync order.
   */
  values: () => readonly H[];
  /** How many rows are held. */
  readonly size: number;
  /**
   * Destroy everything held, keeping the list usable. The next `sync` builds it back.
   */
  clear: () => void;
  /**
   * Destroy everything and stop. Done for you when your addon is disabled. A `sync`
   * after it does nothing.
   */
  destroy: () => void;
}
