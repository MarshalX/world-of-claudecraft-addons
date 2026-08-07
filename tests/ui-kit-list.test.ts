// @vitest-environment happy-dom

// The keyed list.
//
// Two claims carry the rest. A row that survives a sync must be the SAME row, since an
// addon holds measured state on it and a re-created row silently restarts all of it.
// And a sync that changes nothing must touch the document not at all, because a list
// called from a frame loop that re-inserted its rows would drop hover sixty times a
// second, and with it the tooltip the player is reading.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListOpts } from '../loader/src/runtime/ui/kit/list.ts';
import { createList } from '../loader/src/runtime/ui/kit/list.ts';
import { mountAddon } from './fakes/addon.ts';

interface Item {
  id: string;
  text: string;
}

interface Held {
  el: HTMLElement;
  updates: number;
  destroy: () => void;
}

/** One trace rather than three counters: the ORDER is half of what is under test. */
interface Log {
  trace: string[];
  updates: Array<{ key: string; index: number; text: string }>;
}

function items(...ids: string[]): Item[] {
  return ids.map((id) => ({ id, text: id.toUpperCase() }));
}

/** Which rows a case draws, for the ones that hold more than they show. */
type Shown = (item: Item, index: number) => boolean;

/** A list over plain divs, with every call it made to us recorded. */
function open(parent?: Element, shown?: Shown) {
  const log: Log = { trace: [], updates: [] };
  const rows = new Map<string, Held>();

  const create = (item: Item): Held => {
    log.trace.push(`create:${item.id}`);
    const el = document.createElement('div');
    el.setAttribute('data-key', item.id);
    const row: Held = {
      el,
      updates: 0,
      destroy: () => {
        log.trace.push(`destroy:${item.id}`);
      },
    };
    rows.set(item.id, row);
    return row;
  };

  const opts: ListOpts<Item, Held> = {
    key: (item) => item.id,
    create,
    update: (row, item, index) => {
      row.updates += 1;
      log.updates.push({ key: item.id, index, text: item.text });
    },
  };
  if (parent !== undefined) {
    opts.parent = parent;
  }
  if (shown !== undefined) {
    opts.shown = shown;
  }
  return { list: createList(opts), log, rows };
}

/** The order the parent actually holds, by the key each row was built for. */
function order(parent: Element): string[] {
  return [...parent.children].map((el) => el.getAttribute('data-key') ?? '?');
}

function panel(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

/**
 * happy-dom reports NO mutation record for `insertBefore(el, el)`, where a real browser
 * removes the node and puts it back, dropping hover. So idempotence is pinned on the
 * CALL as well as on what the document can be observed to have done.
 */
function inserts(parent: HTMLElement, run: () => void): number {
  const spy = vi.spyOn(parent, 'insertBefore');
  run();
  const seen = spy.mock.calls.length;
  spy.mockRestore();
  return seen;
}

/** Every mutation anywhere under an element, which is what a repaint must not make. */
function touches(el: HTMLElement, run: () => void): number {
  const observer = new MutationObserver(() => undefined);
  observer.observe(el, { attributes: true, characterData: true, childList: true, subtree: true });
  run();
  const seen = observer.takeRecords().length;
  observer.disconnect();
  return seen;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('a keyed list reconciling', () => {
  it('creates each new key once and updates it once', () => {
    const { list, log } = open(panel());

    list.sync(items('a', 'b'));

    expect(log.trace).toEqual(['create:a', 'create:b']);
    expect(log.updates).toEqual([
      { key: 'a', index: 0, text: 'A' },
      { key: 'b', index: 1, text: 'B' },
    ]);
    expect(list.size).toBe(2);
  });

  it('destroys a key that leaves exactly once, and forgets it', () => {
    const { list, log } = open(panel());
    list.sync(items('a', 'b'));

    list.sync(items('b'));

    expect(log.trace.filter((one) => one === 'destroy:a')).toEqual(['destroy:a']);
    expect(list.get('a')).toBeUndefined();
    expect(list.size).toBe(1);
  });

  it('keeps the row a key that stays already had', () => {
    const { list, log } = open(panel());
    list.sync(items('a', 'b'));
    const first = list.get('a');

    list.sync(items('a', 'b', 'c'));

    expect(log.trace).toEqual(['create:a', 'create:b', 'create:c']);
    expect(list.get('a')).toBe(first);
    expect(first?.updates).toBe(2);
  });

  it('gives a leaving key up before an arriving one is built', () => {
    const { list, log } = open(panel());
    list.sync(items('a'));

    list.sync(items('b'));

    expect(log.trace).toEqual(['create:a', 'destroy:a', 'create:b']);
  });
});

// Two items with one key are a claim that cannot be true, so the reading is refused
// rather than tolerated: tolerating it draws every row after the duplicate one slot
// late, on every sync, silently. The refusal lands BEFORE anything is destroyed or
// created, which is the half worth testing: a bad sync must not half-reconcile.
describe('two items sharing one key', () => {
  const clashing = [...items('a', 'b'), { id: 'a', text: 'AGAIN' }, ...items('c')];

  it('refuses the sync and names the key', () => {
    const { list } = open(panel());

    expect(() => {
      list.sync(clashing);
    }).toThrow(/'a'/);
  });

  it('leaves what it was already holding exactly as it was', () => {
    const parent = panel();
    const { list, log } = open(parent);
    list.sync(items('a', 'b'));
    const first = list.get('a');

    expect(() => {
      list.sync(clashing);
    }).toThrow();

    expect(order(parent)).toEqual(['a', 'b']);
    expect(list.size).toBe(2);
    expect(list.get('a')).toBe(first);
    expect(log.trace).toEqual(['create:a', 'create:b']);
  });
});

describe('a list with a parent', () => {
  it('inserts the rows in the order it was synced with', () => {
    const parent = panel();
    const { list } = open(parent);

    list.sync(items('a', 'b', 'c'));

    expect(order(parent)).toEqual(['a', 'b', 'c']);
  });

  it('moves the elements on a reorder without recreating them', () => {
    const parent = panel();
    const { list, log } = open(parent);
    list.sync(items('a', 'b', 'c'));
    const first = list.get('a')?.el;

    list.sync(items('c', 'a', 'b'));

    expect(order(parent)).toEqual(['c', 'a', 'b']);
    expect(log.trace).toEqual(['create:a', 'create:b', 'create:c']);
    expect(list.get('a')?.el).toBe(first);
  });

  it('takes a leaving row out of the parent', () => {
    const parent = panel();
    const { list } = open(parent);
    list.sync(items('a', 'b', 'c'));

    list.sync(items('a', 'c'));

    expect(order(parent)).toEqual(['a', 'c']);
  });

  it('orders what `element` names when the row is not one', () => {
    const parent = panel();
    const list = createList<Item, { box: HTMLElement; destroy: () => void }>({
      parent,
      key: (item) => item.id,
      create: (item) => {
        const box = document.createElement('section');
        box.setAttribute('data-key', item.id);
        return { box, destroy: () => undefined };
      },
      element: (row) => row.box,
    });

    list.sync(items('a', 'b'));

    expect(order(parent)).toEqual(['a', 'b']);
  });

  it('refuses a row it cannot order rather than ordering nothing', () => {
    const list = createList<Item, { destroy: () => void }>({
      parent: panel(),
      key: (item) => item.id,
      create: () => ({ destroy: () => undefined }),
    });

    expect(() => {
      list.sync(items('a'));
    }).toThrow(/element/);
  });
});

// The COST of a needless insert is invisible to a suite, so what is pinned is the only
// visible thing: a sync that moves nothing touches nothing. The second case keeps the
// first from passing vacuously, since an unwired observer reports nothing either.
describe('a list told what it already holds', () => {
  it('writes nothing at all when nothing moved', () => {
    const parent = panel();
    const { list } = open(parent);
    list.sync(items('a', 'b', 'c'));

    expect(
      touches(parent, () => {
        list.sync(items('a', 'b', 'c'));
      }),
    ).toBe(0);
    expect(
      inserts(parent, () => {
        list.sync(items('a', 'b', 'c'));
      }),
    ).toBe(0);
  });

  it('writes when the order really changed', () => {
    const parent = panel();
    const { list } = open(parent);
    list.sync(items('a', 'b', 'c'));

    expect(
      touches(parent, () => {
        list.sync(items('c', 'b', 'a'));
      }),
    ).toBeGreaterThan(0);
    expect(
      inserts(parent, () => {
        list.sync(items('a', 'b', 'c'));
      }),
    ).toBeGreaterThan(0);
  });
});

describe('a list with no parent', () => {
  it('inserts nothing anywhere', () => {
    const { list, rows } = open();

    list.sync(items('a', 'b'));

    expect(list.size).toBe(2);
    expect(rows.get('a')?.el.parentElement).toBeNull();
    expect(document.body.querySelector('[data-key]')).toBeNull();
  });

  it('still destroys what leaves', () => {
    const { list, log } = open();
    list.sync(items('a', 'b'));

    list.sync(items('a'));

    expect(log.trace).toEqual(['create:a', 'create:b', 'destroy:b']);
  });
});

// Hold every cooldown running, draw the soonest ready. Under test is the difference
// between a row that is missing and one that is WRONG: a cut row carries a length the
// addon learned by watching, and destroying it means the row that comes back baselines
// from mid-cooldown and draws a fill nothing on screen says is a guess.
describe('a list holding more than it shows', () => {
  const topTwo: Shown = (_item, index) => index < 2;

  it('takes an unshown row out of the parent without destroying it', () => {
    const parent = panel();
    const { list, log } = open(parent, topTwo);

    list.sync(items('a', 'b', 'c'));

    expect(order(parent)).toEqual(['a', 'b']);
    expect(log.trace).toEqual(['create:a', 'create:b', 'create:c']);
    expect(list.size).toBe(3);
    expect(list.get('c')).toBeDefined();
  });

  it('keeps what an unshown row was carrying, and goes on updating it', () => {
    const parent = panel();
    const { list } = open(parent, topTwo);
    list.sync(items('a', 'b', 'c'));
    const cut = list.get('c');

    list.sync(items('a', 'b', 'c'));

    expect(list.get('c')).toBe(cut);
    expect(cut?.updates).toBe(2);
  });

  it('puts a row back where it belongs when it is shown again', () => {
    const parent = panel();
    const { list, log } = open(parent, topTwo);
    list.sync(items('a', 'b', 'c'));
    const cut = list.get('c');

    list.sync(items('c', 'a', 'b'));

    expect(order(parent)).toEqual(['c', 'a']);
    expect(list.get('c')).toBe(cut);
    expect(log.trace).toEqual(['create:a', 'create:b', 'create:c']);
  });

  it('ranks the shown rows among themselves, leaving no gap', () => {
    const parent = panel();
    const { list } = open(parent, (_item, index) => index !== 2);

    list.sync(items('a', 'b', 'c', 'd', 'e'));

    expect(order(parent)).toEqual(['a', 'b', 'd', 'e']);
  });

  it('still writes nothing at all when nothing moved', () => {
    const parent = panel();
    const { list } = open(parent, topTwo);
    list.sync(items('a', 'b', 'c'));

    expect(
      touches(parent, () => {
        list.sync(items('a', 'b', 'c'));
      }),
    ).toBe(0);
    expect(
      inserts(parent, () => {
        list.sync(items('a', 'b', 'c'));
      }),
    ).toBe(0);
  });

  // A row is either in the parent or nowhere: `remove()` is not scoped, so a row that
  // re-homed its own element into a world anchor is taken back off it every sync. The
  // symptom is a cell that flickers rather than an error, which is why it is pinned.
  it('takes an unshown row out of wherever it is, not only out of the parent', () => {
    const parent = panel();
    const elsewhere = panel();
    const { list } = open(parent, (_item, index) => index < 1);
    list.sync(items('a', 'b'));
    const cut = list.get('b');
    elsewhere.appendChild(cut?.el as HTMLElement);

    list.sync(items('a', 'b'));

    expect(elsewhere.children).toHaveLength(0);
    expect(cut?.el.parentElement).toBeNull();
  });

  it('updates an unshown row with its place in the array it was passed', () => {
    const parent = panel();
    const { list, log } = open(parent, topTwo);

    list.sync(items('a', 'b', 'c'));

    expect(log.updates).toEqual([
      { key: 'a', index: 0, text: 'A' },
      { key: 'b', index: 1, text: 'B' },
      { key: 'c', index: 2, text: 'C' },
    ]);
  });
});

// The per-frame pass, which is the half of a list that is not a sync.
//
// The row that is HELD AND NOT DRAWN is the case to get right and the easy one to miss:
// an implementation walking the parent's children, or the drawn slice, passes every
// other case here and quietly skips exactly the row a fade wants.
describe('walking what a list holds', () => {
  it('hands back every row, including one it is not drawing', () => {
    const parent = panel();
    const { list } = open(parent, (_item, index) => index < 2);
    list.sync(items('a', 'b', 'c'));

    const held = list.values();

    expect(held).toHaveLength(3);
    expect(held.map((row) => row.el.getAttribute('data-key'))).toEqual(['a', 'b', 'c']);
    expect(order(parent)).toEqual(['a', 'b']);
  });

  it('hands back the rows themselves, not copies of them', () => {
    const { list } = open();
    list.sync(items('a'));

    expect(list.values()[0]).toBe(list.get('a'));
  });

  // Creation order, not the order of the last sync, which a caller wanting display
  // order must not rely on.
  it('keeps the order the rows were created in', () => {
    const parent = panel();
    const { list } = open(parent);
    list.sync(items('a', 'b'));

    list.sync(items('b', 'a'));

    expect(list.values().map((row) => row.el.getAttribute('data-key'))).toEqual(['a', 'b']);
  });

  it('is a copy, so a sync from inside the walk cannot disturb it', () => {
    const parent = panel();
    const { list, log } = open(parent);
    list.sync(items('a', 'b', 'c'));

    const walked: string[] = [];
    for (const row of list.values()) {
      walked.push(row.el.getAttribute('data-key') ?? '?');
      list.sync(items('a'));
    }

    expect(walked).toEqual(['a', 'b', 'c']);
    expect(log.trace).toEqual(['create:a', 'create:b', 'create:c', 'destroy:b', 'destroy:c']);
    expect(list.size).toBe(1);
  });

  it('is not a second way to change the list', () => {
    const { list } = open();
    list.sync(items('a', 'b'));

    const held = list.values() as Held[];
    held.length = 0;

    expect(list.size).toBe(2);
    expect(list.values()).toHaveLength(2);
  });

  it('is empty once everything is cleared', () => {
    const { list } = open(panel());
    list.sync(items('a', 'b'));

    list.clear();

    expect(list.values()).toEqual([]);
  });
});

describe('clearing and destroying', () => {
  it('clears everything held and stays usable', () => {
    const parent = panel();
    const { list, log } = open(parent);
    list.sync(items('a', 'b'));

    list.clear();

    expect(log.trace).toEqual(['create:a', 'create:b', 'destroy:a', 'destroy:b']);
    expect(list.size).toBe(0);
    expect(order(parent)).toEqual([]);

    list.sync(items('a'));

    expect(list.size).toBe(1);
    expect(order(parent)).toEqual(['a']);
  });

  it('destroys everything held and then stays stopped', () => {
    const parent = panel();
    const { list, log } = open(parent);
    list.sync(items('a', 'b'));

    list.destroy();
    list.sync(items('a', 'b', 'c'));

    expect(log.trace).toEqual(['create:a', 'create:b', 'destroy:a', 'destroy:b']);
    expect(list.size).toBe(0);
    expect(order(parent)).toEqual([]);
  });
});

// The list goes in the addon's disposal bag, so disable takes down every row it holds.
// Nothing else here can see that, since `createList` knows nothing about a bag.
const MANIFEST = JSON.stringify({
  id: 'probe',
  name: 'Probe',
  version: '1.0.0',
  apiVersion: 1,
  apiMinor: 4,
  author: 'MarshalX',
  description: 'Draws two rows through woc.ui.list and holds on to what it built.',
  entry: 'main.js',
});

const SOURCE = `
  const seen = { destroyed: 0 };
  const parent = document.createElement('div');
  parent.id = 'probe-rows';
  document.body.appendChild(parent);
  const list = woc.ui.list({
    parent,
    key: (item) => item.id,
    create: () => {
      const el = document.createElement('div');
      return { el, destroy: () => { seen.destroyed += 1; } };
    },
  });
  list.sync([{ id: 'a' }, { id: 'b' }]);
  globalThis.__probeList = { seen, parent, size: () => list.size };
`;

interface Probe {
  seen: { destroyed: number };
  parent: HTMLElement;
  size: () => number;
}

function probe(): Probe {
  const found = (globalThis as unknown as { __probeList?: Probe }).__probeList;
  if (found === undefined) {
    throw new Error('the probe addon did not run');
  }
  return found;
}

describe('a list an addon built', () => {
  it('is destroyed when the addon is disabled', async () => {
    const harness = await mountAddon({ manifest: MANIFEST, source: SOURCE });
    const { seen, parent, size } = probe();
    expect(size()).toBe(2);
    expect(parent.children).toHaveLength(2);

    harness.dispose();

    expect(seen.destroyed).toBe(2);
    expect(size()).toBe(0);
    expect(parent.children).toHaveLength(0);
  });
});
