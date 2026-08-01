// @vitest-environment happy-dom

// The Dev tab's freeze.
//
// One subject across four modules, which is why it is its own suite: the switch
// is in runtime/freeze.ts and the four places it has to be OBEYED are the API
// surfaces, so a suite that only drove the module would pass while an addon kept
// repainting. Each gate is exercised through the real surface an addon is handed.
//
// The cases that matter most are the ones that pin what freezing must NOT do:
// a held handler stays subscribed, a held timer keeps its id and its bag entry,
// `waitFor` still settles, and resuming does not fire a burst of everything that
// was missed. Those are the ways a freeze turns from a dev switch into a bug an
// addon author would report as their own.

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
     * Fire everything due now, and nothing scheduled BY it.
     *
     * Snapshotted first, so a handler that re-arms itself does not fire again in
     * the same pass. That is what the browser does, and it is the whole point
     * when the loop under test is the one doing the re-arming.
     */
    fireAll: () => {
      for (const [id, handler] of [...pending]) {
        pending.delete(id);
        handler(undefined as never);
      }
    },
  };
}

/** A live world with a hand-driven frame clock, so the sampler is not a race. */
async function worldHarness() {
  const live = { player: { ...PLAYER_ENTITY } as Record<string, unknown> };
  const scheduled = new Map<number, () => void>();
  let next = 1;

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
    now: () => 0,
    zoneName: () => null,
    simNow: () => null,
  });
  await hub.ready;

  return {
    world: createWorld(hub, new DisposalBag()),
    live,
    frame: () => {
      for (const run of [...scheduled.values()]) {
        scheduled.clear();
        run();
      }
    },
  };
}

describe('the switch', () => {
  it('starts thawed, which is what makes a page reload the way out', () => {
    expect(isFrozen()).toBe(false);
  });

  it('marks the root so the stylesheet can stop animating', () => {
    const root = mountRoot();

    setFrozen(document, true);
    expect(root.classList.contains(FROZEN_CLASS)).toBe(true);

    setFrozen(document, false);
    expect(root.classList.contains(FROZEN_CLASS)).toBe(false);
  });

  // The manager has a host-side route in that works before the UI mounts, so the
  // pane holding this switch can be on screen while there is no root to mark.
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

  // The freeze holds the CALL, never the registration: suspending the timers
  // themselves would mean re-arming every one of them on resume, and an addon
  // that cleared a frozen timer would be clearing something that no longer
  // existed.
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

  // THE REGRESSION, from a live session: cooldown-bars sat still after an
  // unfreeze while its events kept flowing. A one-shot that came due while
  // frozen used to be dropped, and an addon animates by re-arming INSIDE the
  // handler, so the held handler took the whole chain with it: nothing was left
  // pending, and no unfreeze could revive it.
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

    // Three draws: one before the freeze, one released by the resume, one from
    // the frame after it. The middle one is what proves the chain survived.
    expect(drawn).toHaveBeenCalledTimes(3);
  });

  // Held, not dropped. A one-shot is at most one entry per live timer, so the
  // queue is bounded by construction and there is no backlog to spike on, which
  // is what makes this a different decision from socket traffic.
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

  // A disabled addon must not draw, and disable is hot. The held call is
  // discarded with everything else the addon owned.
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

  // Gated at the listener rather than by stopping the sampler, so the watcher
  // keeps taking its baseline while frozen. Stopping it instead would make the
  // first frame after a resume dispatch every key that moved during the freeze,
  // which is a burst at exactly the moment an addon is least ready for one.
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

  // Traffic during a freeze is dropped rather than queued, so a meter
  // under-counts across one. Asserted rather than left implicit: it is the cost
  // of not replaying a backlog of 20 Hz frames into the resume.
  it('drops what arrived while frozen rather than replaying it', () => {
    const h = netHarness();
    const damage = vi.fn();
    h.net.onEvent('damage', damage);

    setFrozen(document, true);
    h.inbound(eventsFrame([{ type: 'damage' }, { type: 'damage' }, { type: 'damage' }]));
    setFrozen(document, false);

    expect(damage).not.toHaveBeenCalled();
  });

  // A gated `waitFor` would never settle: the subscription is `once`, so the bus
  // drops it on the frame the handler was held for and the addon's await would
  // hang past the resume with nothing left to wake it.
  it('settles waitFor while frozen', async () => {
    const h = netHarness();
    setFrozen(document, true);

    const pending = h.net.waitFor('hello');
    h.inbound(HELLO_FRAME);

    await expect(pending).resolves.toBeDefined();
  });
});
