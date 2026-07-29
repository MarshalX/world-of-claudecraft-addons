// Timers that clear themselves when the addon is disabled.
//
// These exist because disable is HOT: no page reload, so a bare setInterval
// keeps running forever against DOM the loader has already removed. The other
// half is the bookkeeping: a one-shot has to unregister itself when it fires, or
// an addon scheduling one timeout a second accumulates a dead bag entry a second
// for as long as it is enabled.

import { describe, expect, it, vi } from 'vitest';
import { createTimers, type TimerHost } from '../loader/src/runtime/api/timers.ts';
import { DisposalBag } from '../loader/src/runtime/disposal.ts';

interface Scheduled {
  handler: (arg: never) => void;
  ms: number;
}

/** A hand-driven clock, so nothing here waits on real time. */
function fakeHost() {
  const pending = new Map<number, Scheduled>();
  const cleared: number[] = [];
  let nextId = 1;

  const schedule = (handler: (arg: never) => void, ms: number): number => {
    const id = nextId;
    nextId += 1;
    pending.set(id, { handler, ms });
    return id;
  };
  const cancel = (id: number): void => {
    cleared.push(id);
    pending.delete(id);
  };

  const host: TimerHost = {
    setTimeout: schedule,
    clearTimeout: cancel,
    setInterval: schedule,
    clearInterval: cancel,
    requestAnimationFrame: (handler) => schedule(handler as (arg: never) => void, 0),
    cancelAnimationFrame: cancel,
  };

  return {
    host,
    cleared,
    pendingIds: () => [...pending.keys()],
    fire: (id: number, arg?: unknown) => {
      const entry = pending.get(id);
      pending.delete(id);
      entry?.handler(arg as never);
    },
  };
}

function open() {
  const bag = new DisposalBag();
  const clock = fakeHost();
  return { bag, clock, timers: createTimers(clock.host, bag) };
}

describe('setTimeout', () => {
  it('schedules and fires the handler', () => {
    const { clock, timers } = open();
    const handler = vi.fn();

    const id = timers.setTimeout(handler, 50);
    clock.fire(id);

    expect(handler).toHaveBeenCalledOnce();
  });

  it('is cleared when the addon is disabled', () => {
    const { bag, clock, timers } = open();
    const id = timers.setTimeout(vi.fn(), 50);

    bag.dispose();

    expect(clock.cleared).toContain(id);
  });

  // Otherwise an addon scheduling one timeout a second leaks one bag entry a
  // second for as long as it is enabled.
  it('unregisters itself from the bag once it has fired', () => {
    const { bag, clock, timers } = open();

    const id = timers.setTimeout(vi.fn(), 50);
    expect(bag.size).toBe(1);
    clock.fire(id);

    expect(bag.size).toBe(0);
  });

  it('unregisters from the bag when cleared explicitly', () => {
    const { bag, timers } = open();

    const id = timers.setTimeout(vi.fn(), 50);
    timers.clearTimeout(id);

    expect(bag.size).toBe(0);
  });

  // The registry has to be clean before the handler runs, or a handler that
  // reschedules leaves the entry of the timer that just fired behind it.
  it('leaves nothing behind when the handler itself throws', () => {
    const { bag, clock, timers } = open();
    const id = timers.setTimeout(() => {
      throw new Error('addon handler blew up');
    }, 50);

    expect(() => {
      clock.fire(id);
    }).toThrow();
    expect(bag.size).toBe(0);
  });

  it('handles a handler that reschedules itself', () => {
    const { bag, clock, timers } = open();
    let id = 0;
    const tick = (): void => {
      id = timers.setTimeout(tick, 50);
    };

    id = timers.setTimeout(tick, 50);
    clock.fire(id);

    expect(bag.size).toBe(1);
  });
});

describe('setInterval', () => {
  it('stays registered across firings, since it repeats', () => {
    const { bag, clock, timers } = open();
    const handler = vi.fn();

    const id = timers.setInterval(handler, 50);
    clock.fire(id);

    expect(handler).toHaveBeenCalledOnce();
    expect(bag.size).toBe(1);
  });

  it('is cleared when the addon is disabled', () => {
    const { bag, clock, timers } = open();
    const id = timers.setInterval(vi.fn(), 50);

    bag.dispose();

    expect(clock.cleared).toContain(id);
  });

  it('unregisters from the bag when cleared explicitly', () => {
    const { bag, timers } = open();

    timers.clearInterval(timers.setInterval(vi.fn(), 50));

    expect(bag.size).toBe(0);
  });
});

describe('requestAnimationFrame', () => {
  it('passes the frame time through to the handler', () => {
    const { clock, timers } = open();
    const handler = vi.fn();

    clock.fire(timers.requestAnimationFrame(handler), 1234);

    expect(handler).toHaveBeenCalledWith(1234);
  });

  it('is cancelled when the addon is disabled', () => {
    const { bag, clock, timers } = open();
    const id = timers.requestAnimationFrame(vi.fn());

    bag.dispose();

    expect(clock.cleared).toContain(id);
  });

  it('unregisters itself once the frame has run', () => {
    const { bag, clock, timers } = open();

    clock.fire(timers.requestAnimationFrame(vi.fn()), 0);

    expect(bag.size).toBe(0);
  });
});

describe('everything at once', () => {
  it('clears every outstanding timer on dispose', () => {
    const { bag, clock, timers } = open();
    timers.setTimeout(vi.fn(), 10);
    timers.setInterval(vi.fn(), 10);
    timers.requestAnimationFrame(vi.fn());

    bag.dispose();

    expect(clock.cleared).toHaveLength(3);
  });

  // The bag runs an entry added after disposal immediately, so a timer created
  // by a straggling async callback is cancelled rather than left running.
  it('cancels a timer scheduled after the addon was already disabled', () => {
    const { bag, clock, timers } = open();
    bag.dispose();

    const id = timers.setInterval(vi.fn(), 10);

    expect(clock.cleared).toContain(id);
  });
});
