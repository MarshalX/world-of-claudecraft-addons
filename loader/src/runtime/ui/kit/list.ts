// A keyed list: create, update, order and destroy, over rows the addon owns.
//
// It owns the lifecycle and never the row's shape, so `create` returns whatever the
// addon wants to hold. Nothing here is guarded: the callbacks run inside the addon's
// own `sync`, so a throw lands in its own stack. Contrast a tooltip's content
// function, which the loader calls from its own pointer handling and wraps.

import type { Teardown } from '../../disposal.ts';

const OWN_ELEMENT = 'el';

interface Destroyable {
  destroy: Teardown;
}

interface ListOpts<T, H extends Destroyable> {
  /**
   * Where the elements live, and with one set the list owns where they are. Omit it
   * for a row that places itself, which is what a world-anchored pin does.
   */
  parent?: Element;
  /**
   * What makes two items across two syncs the same item. Distinct within one sync as
   * well, and `sync` refuses a reading that repeats one. A display name is the trap: a
   * mob's ability carries a bare label with no id, and two can share it.
   */
  key: (item: T) => string;
  /** Build one. Return whatever you want to hold; `destroy` is called when it leaves. */
  create: (item: T) => H;
  /**
   * Called for every item on every sync, new and unshown ones included. `index` is its
   * position in the array `sync` was given, not the position it is drawn at.
   */
  update?: (held: H, item: T, index: number) => void;
  /**
   * Which held rows are drawn, for a caller holding more than it shows. An unshown row
   * stays alive with everything it has measured, and its element leaves the DOCUMENT
   * rather than only the parent, since `remove()` is not scoped: a row that re-homed
   * itself into a world anchor is taken back off it every sync. Two lists is the shape
   * for drawing one row in two places.
   */
  shown?: (item: T, index: number) => boolean;
  /**
   * The element to order, when `create` did not return one. Defaults to `held.el` and
   * is resolved ONCE, so a row's element is fixed for its lifetime.
   */
  element?: (held: H) => Element;
}

interface List<T, H extends Destroyable> {
  /** Reconcile against this exact set, in this exact order. */
  sync: (items: readonly T[]) => void;
  get: (key: string) => H | undefined;
  /**
   * Every row held, drawn or not, for a per-frame pass that is not a sync. A COPY, as
   * `frame-loop.ts` takes of its handler sets, so a walk that syncs cannot corrupt
   * itself. In creation order, not the order last synced.
   */
  values: () => readonly H[];
  readonly size: number;
  /** Destroy everything held, keeping the list usable. */
  clear: () => void;
  /** Destroy everything and stop. Called for you when your addon is disabled. */
  destroy: Teardown;
}

interface Row<H> {
  held: H;
  el: Element | null;
}

interface ListState<T, H extends Destroyable> {
  rows: Map<string, Row<H>>;
  opts: ListOpts<T, H>;
  stopped: boolean;
}

/**
 * Computed rather than `held.el`: Biome asks for the dot and TypeScript refuses to dot
 * into an index signature. Same idiom as `fieldValue` in runtime/net/frames.ts.
 */
function ownElement(held: object): unknown {
  return (held as Record<string, unknown>)[OWN_ELEMENT];
}

/**
 * The element this row is ordered by, or null when nothing is. Throws rather than
 * skipping: a list that silently ordered nothing looks like one that never synced.
 */
function elementOf<T, H extends Destroyable>(opts: ListOpts<T, H>, held: H): Element | null {
  if (opts.parent === undefined) {
    return null;
  }
  const found = opts.element?.(held) ?? ownElement(held);
  if (found instanceof Element) {
    return found;
  }
  throw new Error('ui.list was given a parent but this row has no `el`: pass `element`');
}

/** Never re-insert what is already in place: a moved element loses hover. */
function place(parent: Element, el: Element, at: number): void {
  if (parent.children[at] !== el) {
    parent.insertBefore(el, parent.children[at] ?? null);
  }
}

/** The list removes what it inserted; a second `remove()` on a detached node is free. */
function drop<H extends Destroyable>(rows: Map<string, Row<H>>, key: string, row: Row<H>): void {
  rows.delete(key);
  row.held.destroy();
  row.el?.remove();
}

function prune<H extends Destroyable>(rows: Map<string, Row<H>>, live: ReadonlySet<string>): void {
  for (const [key, row] of rows) {
    if (!live.has(key)) {
      drop(rows, key, row);
    }
  }
}

function rowFor<T, H extends Destroyable>(state: ListState<T, H>, item: T): Row<H> {
  const key = state.opts.key(item);
  const found = state.rows.get(key);
  if (found !== undefined) {
    return found;
  }
  const held = state.opts.create(item);
  const row: Row<H> = { held, el: elementOf(state.opts, held) };
  state.rows.set(key, row);
  return row;
}

/** Drawn unless the caller said otherwise. See `ListOpts.shown`. */
function isShown<T, H extends Destroyable>(opts: ListOpts<T, H>, item: T, index: number): boolean {
  if (opts.shown === undefined) {
    return true;
  }
  return opts.shown(item, index);
}

/**
 * Place a row or take it out, answering how many are placed. `remove()` on a detached
 * element is defined as a no-op, so an unshown row costs nothing per frame.
 */
function draw(parent: Element, el: Element, at: number, shown: boolean): number {
  if (!shown) {
    el.remove();
    return at;
  }
  place(parent, el, at);
  return at + 1;
}

/** The first key handed in twice. Walked only once a clash is known. */
function repeatedKey<T>(items: readonly T[], key: (item: T) => string): string {
  const seen = new Set<string>();
  for (const item of items) {
    const one = key(item);
    if (seen.has(one)) {
      return one;
    }
    seen.add(one);
  }
  return '';
}

/**
 * Destroying before creating is what lets a row take an id another is giving up in the
 * same sync. The cursor is separate from the loop counter: one counts what was drawn.
 */
function reconcile<T, H extends Destroyable>(state: ListState<T, H>, items: readonly T[]): void {
  if (state.stopped) {
    return;
  }
  const { opts } = state;
  const live = new Set(items.map((item) => opts.key(item)));
  // Before anything is destroyed or created, so a refused sync leaves the panel as it
  // was. Tolerating a duplicate instead reorders every row after it, silently.
  if (live.size !== items.length) {
    const clash = repeatedKey(items, opts.key);
    throw new Error(`ui.list was given two items keyed '${clash}' in one sync`);
  }
  prune(state.rows, live);
  let at = 0;
  for (const [index, item] of items.entries()) {
    const row = rowFor(state, item);
    opts.update?.(row.held, item, index);
    if (opts.parent !== undefined && row.el !== null) {
      at = draw(opts.parent, row.el, at, isShown(opts, item, index));
    }
  }
}

function clear<H extends Destroyable>(rows: Map<string, Row<H>>): void {
  for (const [key, row] of rows) {
    drop(rows, key, row);
  }
}

/**
 * A stopped list stays stopped: disable is hot, so a frame loop can get one more tick
 * in after the bag has run, and a sync then would build rows into DOM that is gone.
 */
function createList<T, H extends Destroyable>(opts: ListOpts<T, H>): List<T, H> {
  const state: ListState<T, H> = { rows: new Map(), opts, stopped: false };

  return {
    sync: (items) => {
      reconcile(state, items);
    },
    get: (key) => state.rows.get(key)?.held,
    values: () => Array.from(state.rows.values(), (row) => row.held),
    get size() {
      return state.rows.size;
    },
    clear: () => {
      clear(state.rows);
    },
    destroy: () => {
      state.stopped = true;
      clear(state.rows);
    },
  };
}

export type { Destroyable, List, ListOpts };
export { createList };
