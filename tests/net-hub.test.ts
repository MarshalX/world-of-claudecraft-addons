import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DisposalBag } from '../loader/src/runtime/disposal.ts';
import { eventsFrame, snapFrame } from './fakes/frames.ts';
import { type NetHarness, netHarness } from './fakes/net-harness.ts';

let h: NetHarness;
beforeEach(() => {
  h = netHarness();
});

describe('the disposal bag', () => {
  it('releases every subscription when the addon is disabled', () => {
    const seen = vi.fn();
    h.net.on('snap', seen);
    h.net.onRaw(seen);
    h.net.onEvent('damage', seen);

    h.bag.dispose();
    h.inbound(snapFrame());
    h.inbound(eventsFrame([{ type: 'damage' }]));

    expect(seen).not.toHaveBeenCalled();
  });

  it('does not leave a dead entry behind when the addon unsubscribes itself', () => {
    const off = h.net.on('snap', vi.fn());
    expect(h.bag.size).toBe(1);

    off();

    expect(h.bag.size).toBe(0);
  });

  it('survives an explicit unsubscribe after disposal', () => {
    const off = h.net.on('snap', vi.fn());
    h.bag.dispose();

    expect(() => off()).not.toThrow();
  });
});

describe('the hub', () => {
  it('shares one socket hook across addons', () => {
    const second = new DisposalBag();
    const a = vi.fn();
    const b = vi.fn();
    h.net.on('snap', a);
    h.addonOf(second).on('snap', b);

    h.inbound(snapFrame());

    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('disabling one addon leaves the other subscribed', () => {
    const second = new DisposalBag();
    const a = vi.fn();
    const b = vi.fn();
    h.net.on('snap', a);
    h.addonOf(second).on('snap', b);

    h.bag.dispose();
    h.inbound(snapFrame());

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });

  it('uninstalls the hook on dispose', () => {
    h.hub.dispose();

    expect(h.uninstalled()).toBe(true);
  });

  it('throttles through to the addon surface', () => {
    const seen = vi.fn();
    h.net.on('snap', seen, { throttle: 1000 });

    for (let i = 0; i < 20; i += 1) {
      h.advance(50);
      h.inbound(snapFrame());
    }

    expect(seen.mock.calls.length).toBeLessThan(3);
  });
});

// Freezing is what stops one addon's handler changing what the next one sees, and
// it costs a walk of the whole frame. A snapshot is the frame that matters: it is
// the largest thing on the socket, it arrives 20 times a second, and it used to be
// frozen whenever ANYTHING anywhere was subscribed. A player running a meter that
// wants combat events was paying for it on every snapshot for the whole session.
//
// The first case is the saving. The second and third are the property that makes the
// saving safe, and they are the ones to keep: a subscriber must never be handed a
// frame that another handler could still be holding a mutable reference to.
describe('freezing a frame', () => {
  // A frame nobody is subscribed to is delivered to nobody, so there is no handler
  // to read its frozenness back from. The freeze itself is what is counted instead,
  // which is also the thing being saved.
  it('does not walk a snapshot when only another topic is subscribed', () => {
    const froze = vi.spyOn(Object, 'freeze');
    h.net.onEvent('damage', vi.fn());
    froze.mockClear();

    h.inbound(snapFrame({ ents: [{ id: 1, auras: [{ id: 'rend' }] }, { id: 2 }] }));

    expect(froze).not.toHaveBeenCalled();
    froze.mockRestore();
  });

  it('walks it once something does subscribe to it', () => {
    const froze = vi.spyOn(Object, 'freeze');
    h.net.on('snap', vi.fn());
    froze.mockClear();

    h.inbound(snapFrame({ ents: [{ id: 1, auras: [{ id: 'rend' }] }, { id: 2 }] }));

    expect(froze).toHaveBeenCalled();
    froze.mockRestore();
  });

  it('freezes a snapshot for a frame subscriber', () => {
    let delivered: unknown = null;
    h.net.on('snap', (frame) => {
      delivered = frame;
    });

    h.inbound(snapFrame());

    expect(Object.isFrozen(delivered)).toBe(true);
  });

  it('freezes a snapshot for a raw subscriber', () => {
    let delivered: unknown = null;
    h.net.onRaw((frame) => {
      delivered = frame;
    });

    h.inbound(snapFrame());

    expect(Object.isFrozen(delivered)).toBe(true);
  });

  // Events are frozen one at a time against their own subscribers, so an addon
  // watching one kind still cannot reach into what another addon is about to read.
  it('freezes an event for the kind that asked for it', () => {
    let delivered: unknown = null;
    h.net.onEvent('damage', (event) => {
      delivered = event;
    });

    h.inbound(eventsFrame([{ type: 'damage', amount: 12 }]));

    expect(Object.isFrozen(delivered)).toBe(true);
  });

  it('freezes an event for a wildcard subscriber', () => {
    let delivered: unknown = null;
    h.net.onAnyEvent((event) => {
      delivered = event;
    });

    h.inbound(eventsFrame([{ type: 'heal2', amount: 5 }]));

    expect(Object.isFrozen(delivered)).toBe(true);
  });
});
