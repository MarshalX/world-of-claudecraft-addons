// The per-addon log tail.
//
// Two properties matter and both are about what the buffer does NOT do. It is
// bounded per addon, so a chatty addon cannot push the quiet one that failed
// out of view. And it stores formatted text rather than the arguments, so
// logging a game entity does not pin the game's live object in memory for the
// rest of the session.

import { describe, expect, it } from 'vitest';
import {
  createLogBuffer,
  formatArgs,
  MAX_ENTRIES_PER_ADDON,
  MAX_TEXT_LENGTH,
} from '../loader/src/runtime/log/buffer.ts';

const A = 'official/combat-meter';
const B = 'official/cooldown-bars';

describe('the log buffer', () => {
  it('keeps entries per addon, oldest first', () => {
    const buffer = createLogBuffer();
    buffer.append(A, 'info', 10, 'first');
    buffer.append(A, 'warn', 20, 'second');

    expect(buffer.tail(A).map((entry) => entry.text)).toEqual(['first', 'second']);
    expect(buffer.tail(A)[1]?.level).toBe('warn');
  });

  it('answers an empty tail for an addon that never logged', () => {
    expect(createLogBuffer().tail(A)).toEqual([]);
  });

  // The whole reason the bound is per addon: a 20 Hz handler in one addon must
  // not cost the log of the addon a player is actually trying to debug.
  it('does not let one addon evict another', () => {
    const buffer = createLogBuffer();
    buffer.append(B, 'error', 1, 'the line that matters');
    for (let index = 0; index < MAX_ENTRIES_PER_ADDON * 3; index += 1) {
      buffer.append(A, 'info', index, `noise ${index}`);
    }

    expect(buffer.tail(B).map((entry) => entry.text)).toEqual(['the line that matters']);
  });

  it('drops the oldest once it is full and keeps the newest', () => {
    const buffer = createLogBuffer();
    const total = MAX_ENTRIES_PER_ADDON + 10;
    for (let index = 0; index < total; index += 1) {
      buffer.append(A, 'info', index, `line ${index}`);
    }
    const tail = buffer.tail(A);

    expect(tail).toHaveLength(MAX_ENTRIES_PER_ADDON);
    expect(tail[0]?.text).toBe('line 10');
    expect(tail.at(-1)?.text).toBe(`line ${total - 1}`);
  });

  it('clears one addon without touching the others', () => {
    const buffer = createLogBuffer();
    buffer.append(A, 'info', 1, 'a');
    buffer.append(B, 'info', 1, 'b');

    buffer.clear(A);

    expect(buffer.tail(A)).toEqual([]);
    expect(buffer.tail(B)).toHaveLength(1);
  });

  it('drops everything on dispose', () => {
    const buffer = createLogBuffer();
    buffer.append(A, 'info', 1, 'a');

    buffer.dispose();

    expect(buffer.tail(A)).toEqual([]);
  });
});

describe('formatArgs', () => {
  it('joins arguments the way a console line reads', () => {
    expect(formatArgs(['hit for', 42, 'damage'])).toBe('hit for 42 damage');
  });

  it('names an Error rather than rendering it as an empty object', () => {
    expect(formatArgs([new TypeError('bad entity')])).toBe('TypeError: bad entity');
  });

  // A game entity is circular, which is the ordinary case for anything an addon
  // would want to log, and JSON.stringify throws on it.
  it('survives a circular object', () => {
    const entity: Record<string, unknown> = { id: 7 };
    Object.assign(entity, { self: entity });

    expect(() => formatArgs([entity])).not.toThrow();
  });

  it('handles undefined and null, which JSON.stringify answers oddly for', () => {
    expect(formatArgs([undefined])).toBe('undefined');
    expect(formatArgs([null])).toBe('null');
  });

  // A logged snapshot is enormous and the manager renders this in a fixed box.
  it('truncates a very long argument', () => {
    const long = 'x'.repeat(MAX_TEXT_LENGTH * 2);

    expect(formatArgs([long])).toHaveLength(MAX_TEXT_LENGTH);
  });
});

// The manager renders the tail as a list, and a key built from the timestamp or
// the array index shifts under it: two identical lines a millisecond apart are
// ordinary, and dropping the oldest entry renumbers every index below it.
describe('entry identity', () => {
  it('gives every entry a sequence number, unique across addons', () => {
    const buffer = createLogBuffer();
    buffer.append(A, 'info', 1, 'same text');
    buffer.append(B, 'info', 1, 'same text');
    buffer.append(A, 'info', 1, 'same text');

    const seqs = [...buffer.tail(A), ...buffer.tail(B)].map((entry) => entry.seq);

    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it("keeps an entry's sequence number when older ones are dropped", () => {
    const buffer = createLogBuffer();
    for (let index = 0; index < MAX_ENTRIES_PER_ADDON + 5; index += 1) {
      buffer.append(A, 'info', index, `line ${index}`);
    }
    const before = buffer.tail(A).at(-1)?.seq;

    buffer.append(A, 'info', 999, 'one more');

    expect(buffer.tail(A).at(-2)?.seq).toBe(before);
  });
});
