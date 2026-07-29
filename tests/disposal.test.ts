import { describe, expect, it, vi } from 'vitest';

/** A teardown that must never fire, without an empty block. */
const noop = (): undefined => undefined;

import { DisposalBag } from '../loader/src/runtime/disposal.ts';

describe('DisposalBag', () => {
  it('runs teardowns in reverse registration order', () => {
    const order: number[] = [];
    const bag = new DisposalBag();
    bag.add(() => order.push(1));
    bag.add(() => order.push(2));
    bag.add(() => order.push(3));

    bag.dispose();
    expect(order).toEqual([3, 2, 1]);
  });

  // A throwing teardown must not strand the rest: a broken addon still has to
  // release its DOM nodes and listeners.
  it('runs every teardown even when one throws', () => {
    const after = vi.fn();
    const before = vi.fn();
    const bag = new DisposalBag();
    bag.add(before);
    bag.add(() => {
      throw new Error('boom');
    });
    bag.add(after);

    const errors = bag.dispose();
    expect(before).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalledOnce();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe('boom');
  });

  it('normalizes a thrown non-Error into an Error', () => {
    const bag = new DisposalBag();
    bag.add(() => {
      // biome-ignore lint/style/useThrowOnlyError: throwing a non-Error is what this asserts on
      throw 'plain string';
    });
    const errors = bag.dispose();
    expect(errors[0]).toBeInstanceOf(Error);
    expect(errors[0]?.message).toBe('plain string');
  });

  it('is idempotent: a second dispose runs nothing again', () => {
    const fn = vi.fn();
    const bag = new DisposalBag();
    bag.add(fn);

    bag.dispose();
    bag.dispose();
    expect(fn).toHaveBeenCalledOnce();
  });

  it('reports disposed state and empties itself', () => {
    const bag = new DisposalBag();
    bag.add(noop);
    expect(bag.isDisposed).toBe(false);
    expect(bag.size).toBe(1);

    bag.dispose();
    expect(bag.isDisposed).toBe(true);
    expect(bag.size).toBe(0);
  });

  // A stray async callback landing after disable must not leak its resource.
  it('runs an teardown added after disposal immediately', () => {
    const fn = vi.fn();
    const bag = new DisposalBag();
    bag.dispose();

    bag.add(fn);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('lets a caller unregister a teardown before disposal', () => {
    const fn = vi.fn();
    const bag = new DisposalBag();
    const off = bag.add(fn);

    off();
    expect(bag.size).toBe(0);
    bag.dispose();
    expect(fn).not.toHaveBeenCalled();
  });
});
