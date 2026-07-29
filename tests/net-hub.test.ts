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
