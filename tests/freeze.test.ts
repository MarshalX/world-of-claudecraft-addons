// @vitest-environment happy-dom

// The Dev tab's freeze. The switch is in runtime/freeze.ts and the API surfaces obey it, so each
// gate is driven through the real surface an addon is handed. Freezing must NOT unsubscribe a held
// handler, drop a held timer's id or bag entry, hang `waitFor`, or fire a burst on resume.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTimers, type TimerHost } from '../loader/src/runtime/api/timers.ts';
import { createWorld } from '../loader/src/runtime/api/world.ts';
import { DisposalBag } from '../loader/src/runtime/disposal.ts';
import {
  createFreezeControl,
  isFrozen,
  setFrozen,
  unlessFrozen,
} from '../loader/src/runtime/freeze.ts';
import { FROZEN_CLASS, ROOT_ID } from '../loader/src/runtime/ui/root.ts';
import { createWorldHub } from '../loader/src/runtime/world/hub.ts';
import { eventsFrame, HELLO_FRAME, PLAYER_ENTITY, setAt } from './fakes/frames.ts';
import { netHarness } from './fakes/net-harness.ts';

afterEach(() => {
  // The switch is module state, so a frozen test would freeze the next one.
  setFrozen(document, false);
  document.body.innerHTML = '';
});

function mountRoot(): HTMLElement {
  const root = document.createElement('div');
  root.id = ROOT_ID;
  document.body.appendChild(root);
  return root;
}

/** A hand-driven clock: the point is which handlers run, not when. */
function fakeHost() {
  const pending = new Map<number, (arg: never) => void>();
  let nextId = 1;

  const schedule = (handler: (arg: never) => void): number => {
    const id = nextId;
    nextId += 1;
    pending.set(id, handler);
    return id;
  };

  const host: TimerHost = {
    setTimeout: schedule,
    clearTimeout: (id) => {
      pending.delete(id);
    },
    setInterval: schedule,
    clearInterval: (id) => {
      pending.delete(id);
    },
    requestAnimationFrame: schedule,
    cancelAnimationFrame: (id) => {
      pending.delete(id);
    },
  };

  return {
    host,
    /** An interval stays scheduled after it fires, the way a real one does. */
    tick: (id: number) => pending.get(id)?.(undefined as never),
    fire: (id: number) => {
      const handler = pending.get(id);
      pending.delete(id);
      handler?.(undefined as never);
    },
    /**
     * Fire everything due now and nothing scheduled by it, as a browser does, so a handler that
     * re-arms itself does not fire twice in one pass.
     */
    fireAll: () => {
      for (const [id, handler] of [...pending]) {
        pending.delete(id);
        handler(undefined as never);
      }
    },
  };
}

/**
 * A live world with a hand-driven frame clock. The clock advances 25 ms a frame, over the
 * sampler's floor between samples, so each frame is a sample; a stuck clock samples only once.
 */
async function worldHarness() {
  const live = { player: { ...PLAYER_ENTITY } as Record<string, unknown> };
  const scheduled = new Map<number, () => void>();
  let next = 1;
  let clock = 0;

  const hub = createWorldHub({
    game: Promise.resolve({ world: live }),
    schedule: (run) => {
      const id = next;
      next += 1;
      scheduled.set(id, run);
      return id;
    },
    cancel: (id) => {
      scheduled.delete(id);
    },
    lastDamageAt: () => null,
    now: () => clock,
    zoneName: () => null,
    simNow: () => null,
    realm: () => null,
  });
  await hub.ready;

  return {
    world: createWorld(hub, new DisposalBag()),
    live,
    frame: () => {
      clock += 25;
      for (const run of [...scheduled.values()]) {
        scheduled.clear();
        run();
      }
    },
  };
}

describe('the switch', () => {
  it('starts thawed', () => {
    expect(isFrozen()).toBe(false);
  });

  it('marks the root so the stylesheet can stop animating', () => {
    const root = mountRoot();

    setFrozen(document, true);
    expect(root.classList.contains(FROZEN_CLASS)).toBe(true);

    setFrozen(document, false);
    expect(root.classList.contains(FROZEN_CLASS)).toBe(false);
  });

  // The manager can be open before the UI mounts, so there may be no root to mark.
  it('freezes with no root in the document', () => {
    setFrozen(document, true);

    expect(isFrozen()).toBe(true);
  });

  it('reads back through the control the Dev pane is handed', () => {
    const control = createFreezeControl(document);

    control.set(true);

    expect(control.frozen()).toBe(true);
    expect(isFrozen()).toBe(true);
  });
});

describe('unlessFrozen', () => {
  it('holds the call while frozen and passes the arguments when not', () => {
    const handler = vi.fn();
    const gated = unlessFrozen(handler);

    setFrozen(document, true);
    gated('held');
    setFrozen(document, false);
    gated('through');

    expect(handler).toHaveBeenCalledExactlyOnceWith('through');
  });

  // Read per dispatch, not captured at subscribe time, or a handler registered
  // before the freeze would run through it.
  it('holds a handler wrapped before the freeze was on', () => {
    const handler = vi.fn();
    const gated = unlessFrozen(handler);

    setFrozen(document, true);
    gated();

    expect(handler).not.toHaveBeenCalled();
  });
});

describe('woc.timers', () => {
  it('holds an interval and resumes it', () => {
    const clock = fakeHost();
    const timers = createTimers(clock.host, new DisposalBag());
    const paint = vi.fn();
    const id = timers.setInterval(paint, 250);

    clock.tick(id);
    setFrozen(document, true);
    clock.tick(id);
    clock.tick(id);
    setFrozen(document, false);
    clock.tick(id);

    expect(paint).toHaveBeenCalledTimes(2);
  });

  // The freeze holds the call, never the registration, so a frozen timer can still be cleared.
  it('leaves a frozen interval clearable and in the disposal bag', () => {
    const bag = new DisposalBag();
    const clock = fakeHost();
    const timers = createTimers(clock.host, bag);
    const id = timers.setInterval(vi.fn(), 250);

    setFrozen(document, true);

    expect(bag.size).toBe(1);
    timers.clearInterval(id);
    expect(bag.size).toBe(0);
  });

  it('holds an animation frame', () => {
    const clock = fakeHost();
    const timers = createTimers(clock.host, new DisposalBag());
    const draw = vi.fn();

    setFrozen(document, true);
    clock.fire(timers.requestAnimationFrame(draw));

    expect(draw).not.toHaveBeenCalled();
  });

  // An addon animates by re-arming inside the handler, so dropping a held one-shot would end the
  // chain for good.
  it('keeps a self-rescheduling frame loop alive across a freeze', () => {
    const clock = fakeHost();
    const timers = createTimers(clock.host, new DisposalBag());
    const drawn = vi.fn();
    const tick = (): void => {
      drawn();
      timers.requestAnimationFrame(tick);
    };
    timers.requestAnimationFrame(tick);

    clock.fireAll();
    setFrozen(document, true);
    clock.fireAll();
    setFrozen(document, false);
    clock.fireAll();

    // Before the freeze, released by the resume, and the frame after: the middle one proves it.
    expect(drawn).toHaveBeenCalledTimes(3);
  });

  // Held, unlike socket traffic: at most one entry per live timer, so there is no backlog.
  it('runs a one-shot that came due while frozen when the freeze lifts', () => {
    const bag = new DisposalBag();
    const clock = fakeHost();
    const timers = createTimers(clock.host, bag);
    const later = vi.fn();
    const id = timers.setTimeout(later, 50);

    setFrozen(document, true);
    clock.fire(id);
    expect(later).not.toHaveBeenCalled();
    setFrozen(document, false);

    expect(later).toHaveBeenCalledOnce();
    // Consumed, not leaked: the bookkeeping ran when the platform fired it.
    expect(bag.size).toBe(0);
  });

  it('discards a held one-shot when the addon is disabled while frozen', () => {
    const bag = new DisposalBag();
    const clock = fakeHost();
    const timers = createTimers(clock.host, bag);
    const later = vi.fn();

    const id = timers.setTimeout(later, 50);
    setFrozen(document, true);
    clock.fire(id);
    bag.dispose();
    setFrozen(document, false);

    expect(later).not.toHaveBeenCalled();
  });
});

describe('woc.world.on', () => {
  it('holds a watch and resumes it', async () => {
    const h = await worldHarness();
    const moved = vi.fn();
    h.world.on('player', moved);

    setAt(h.live.player, 'hp', 90);
    h.frame();
    setFrozen(document, true);
    setAt(h.live.player, 'hp', 80);
    h.frame();
    setFrozen(document, false);
    setAt(h.live.player, 'hp', 70);
    h.frame();

    expect(moved).toHaveBeenCalledTimes(2);
  });

  // Gated at the listener, not the sampler, so the baseline keeps moving and resume fires no burst.
  it('does not fire for what changed while frozen once resumed', async () => {
    const h = await worldHarness();
    const moved = vi.fn();
    h.world.on('player', moved);

    setFrozen(document, true);
    setAt(h.live.player, 'hp', 40);
    h.frame();
    setFrozen(document, false);
    h.frame();

    expect(moved).not.toHaveBeenCalled();
  });
});

describe('woc.net', () => {
  it('holds an event handler and resumes it, still subscribed', () => {
    const h = netHarness();
    const damage = vi.fn();
    h.net.onEvent('damage', damage);

    setFrozen(document, true);
    h.inbound(eventsFrame([{ type: 'damage' }]));
    setFrozen(document, false);
    h.inbound(eventsFrame([{ type: 'damage' }]));

    expect(damage).toHaveBeenCalledOnce();
  });

  // A meter under-counts across a freeze; that is the cost of not replaying a backlog.
  it('drops what arrived while frozen rather than replaying it', () => {
    const h = netHarness();
    const damage = vi.fn();
    h.net.onEvent('damage', damage);

    setFrozen(document, true);
    h.inbound(eventsFrame([{ type: 'damage' }, { type: 'damage' }, { type: 'damage' }]));
    setFrozen(document, false);

    expect(damage).not.toHaveBeenCalled();
  });

  // The subscription is `once`, so a gated `waitFor` would be dropped and hang forever.
  it('settles waitFor while frozen', async () => {
    const h = netHarness();
    setFrozen(document, true);

    const pending = h.net.waitFor('hello');
    h.inbound(HELLO_FRAME);

    await expect(pending).resolves.toBeDefined();
  });
});
