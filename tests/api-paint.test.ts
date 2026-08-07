// Driven through the REAL frame loop rather than a stand-in: the two behaviours
// this rests on are the loop's own, that it stops when nothing is subscribed and
// that it copies its handler set before running it, so a subscription made
// mid-phase lands on the next frame.

import { describe, expect, it, vi } from 'vitest';
import { createPaintApi, type PaintApi } from '../loader/src/runtime/api/paint.ts';
import { DisposalBag } from '../loader/src/runtime/disposal.ts';
import { createFrameClock } from './fakes/frame-loop.ts';

function open() {
  const bag = new DisposalBag();
  const clock = createFrameClock();
  const report = vi.fn();
  const paint: PaintApi = createPaintApi({ frames: clock.loop, bag, report });
  return { bag, clock, report, paint };
}

describe('coalescing', () => {
  it('runs the handler once however many times it was asked in one turn', () => {
    const { clock, paint } = open();
    const handler = vi.fn();
    const repaint = paint(handler);

    repaint();
    repaint();
    repaint();
    clock.tick();

    expect(handler).toHaveBeenCalledOnce();
  });

  it('does not run the handler again on a frame nobody asked for', () => {
    const { clock, paint } = open();
    const handler = vi.fn();

    paint(handler)();
    clock.tick();
    clock.tick();

    expect(handler).toHaveBeenCalledOnce();
  });

  it('runs again when asked again after it drew', () => {
    const { clock, paint } = open();
    const handler = vi.fn();
    const repaint = paint(handler);

    repaint();
    clock.tick();
    repaint();
    clock.tick();

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('gives up its seat on the loop once it has drawn', () => {
    const { clock, paint } = open();

    paint(vi.fn())();
    clock.tick();

    expect(clock.pending()).toBe(0);
  });
});

describe('a request from inside the handler', () => {
  it('schedules the next frame rather than recursing', () => {
    const { clock, paint } = open();
    const handler = vi.fn(() => {
      if (handler.mock.calls.length < 2) {
        repaint();
      }
    });
    const repaint = paint(handler);

    repaint();
    clock.tick();

    expect(handler).toHaveBeenCalledOnce();

    clock.tick();

    expect(handler).toHaveBeenCalledTimes(2);
  });

  // Unsubscribing and resubscribing inside the loop's own phase makes it
  // schedule two callbacks for the next frame.
  it('leaves exactly one frame scheduled', () => {
    const { clock, paint } = open();
    const repaint = paint(() => {
      repaint();
    });

    repaint();
    clock.tick();

    expect(clock.pending()).toBe(1);
  });
});

describe('a frame that is hidden', () => {
  it('does not draw while it is hidden', () => {
    const { clock, paint } = open();
    const frame = { visible: false };
    const handler = vi.fn();

    paint(handler, { frame })();
    clock.tick();
    clock.tick();

    expect(handler).not.toHaveBeenCalled();
  });

  it('draws once when the frame is shown again', () => {
    const { clock, paint } = open();
    const frame = { visible: false };
    const handler = vi.fn();

    paint(handler, { frame })();
    clock.tick();
    frame.visible = true;
    clock.tick();

    expect(handler).toHaveBeenCalledOnce();
  });

  it('draws once for however many requests arrived while it was hidden', () => {
    const { clock, paint } = open();
    const frame = { visible: false };
    const handler = vi.fn();
    const repaint = paint(handler, { frame });

    repaint();
    clock.tick();
    repaint();
    clock.tick();
    frame.visible = true;
    clock.tick();

    expect(handler).toHaveBeenCalledOnce();
  });

  // The documented cost. `Frame` publishes no change event, so the only way to
  // notice the panel returning is to look once a frame.
  it('holds its seat on the loop for as long as a repaint is owed', () => {
    const { clock, paint } = open();
    const frame = { visible: false };

    paint(vi.fn(), { frame })();
    clock.tick();
    clock.tick();
    clock.tick();

    expect(clock.pending()).toBe(1);
  });

  it('gives the seat up once the panel has come back and drawn', () => {
    const { clock, paint } = open();
    const frame = { visible: false };

    paint(vi.fn(), { frame })();
    clock.tick();
    frame.visible = true;
    clock.tick();

    expect(clock.pending()).toBe(0);
  });

  // The seat tracks the OWED flag, not the hidden state.
  it('holds no seat while a hidden frame has nothing owed', () => {
    const { clock, paint } = open();

    paint(vi.fn(), { frame: { visible: false } });

    expect(clock.pending()).toBe(0);
  });

  it('draws nothing on a show nobody asked for a repaint before', () => {
    const { clock, paint } = open();
    const frame = { visible: false };
    const handler = vi.fn();

    paint(handler, { frame });
    frame.visible = true;
    clock.tick();

    expect(handler).not.toHaveBeenCalled();
  });

  it('draws on the same frame the request was made, when it is visible', () => {
    const { clock, paint } = open();
    const handler = vi.fn();

    paint(handler, { frame: { visible: true } })();
    clock.tick();

    expect(handler).toHaveBeenCalledOnce();
  });
});

describe('disable', () => {
  it('drops a pending request without calling the handler', () => {
    const { bag, clock, paint } = open();
    const handler = vi.fn();

    paint(handler)();
    bag.dispose();
    clock.tick();

    expect(handler).not.toHaveBeenCalled();
  });

  // The one case that holds a seat, so the one that could outlive disable.
  it('drops a repaint owed to a hidden frame, and stops the loop', () => {
    const { bag, clock, paint } = open();
    const frame = { visible: false };
    const handler = vi.fn();

    paint(handler, { frame })();
    clock.tick();
    bag.dispose();
    frame.visible = true;
    clock.tick();

    expect(handler).not.toHaveBeenCalled();
    expect(clock.pending()).toBe(0);
  });

  it('refuses a request made after the addon was disabled', () => {
    const { bag, clock, paint } = open();
    const handler = vi.fn();
    const repaint = paint(handler);

    bag.dispose();
    repaint();
    clock.tick();

    expect(handler).not.toHaveBeenCalled();
    expect(clock.pending()).toBe(0);
  });

  it('leaves nothing running for a registration made after disable', () => {
    const { bag, clock, paint } = open();
    const handler = vi.fn();

    bag.dispose();
    paint(handler)();
    clock.tick();

    expect(handler).not.toHaveBeenCalled();
  });
});

describe('a handler that throws', () => {
  it('reports it to the addon rather than to the loop', () => {
    const { clock, report, paint } = open();

    paint(() => {
      throw new Error('addon draw blew up');
    })();
    clock.tick();

    expect(report).toHaveBeenCalledOnce();
  });

  // The registration is kept, so a mistake costs a warning rather than a panel
  // that never draws again.
  it('reports the second throw nowhere and keeps drawing', () => {
    const { clock, report, paint } = open();
    const handler = vi.fn(() => {
      throw new Error('addon draw blew up');
    });
    const repaint = paint(handler);

    repaint();
    clock.tick();
    repaint();
    clock.tick();

    expect(handler).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledOnce();
  });

  // `owed` is cleared before the handler, so a throw leaves nothing pending.
  it('leaves nothing owed', () => {
    const { clock, paint } = open();
    const handler = vi.fn(() => {
      throw new Error('addon draw blew up');
    });

    paint(handler)();
    clock.tick();
    clock.tick();

    expect(handler).toHaveBeenCalledOnce();
  });
});
