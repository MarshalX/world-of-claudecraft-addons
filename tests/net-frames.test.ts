import { describe, expect, it } from 'vitest';

import {
  deepFreeze,
  fieldArray,
  fieldNumber,
  fieldScalar,
  fieldString,
  fieldValue,
  parseFrame,
  redactOutbound,
} from '../loader/src/runtime/net/frames.ts';
import { AUTH_FRAME, at, setAt, snapFrame, text } from './fakes/frames.ts';

describe('parseFrame', () => {
  it('decodes a frame off the raw text', () => {
    expect(parseFrame(text({ t: 'hello', pid: 661 }))?.t).toBe('hello');
  });

  // The game's socket is JSON text both ways, so anything else on it belongs to
  // somebody other than the game and decoding it would be a guess.
  it.each([
    ['a binary frame', new ArrayBuffer(4)],
    ['malformed JSON', '{ not json'],
    ['a JSON array', '[1,2,3]'],
    ['a JSON scalar', '42'],
    ['an object with no type', '{"pid":1}'],
    ['an object whose type is not a string', '{"t":7}'],
  ])('rejects %s', (_label, data) => {
    expect(parseFrame(data)).toBeNull();
  });

  it('parses its own copy rather than sharing the game to it', () => {
    const raw = text({ t: 'snap', tick: 1 });
    expect(parseFrame(raw)).not.toBe(parseFrame(raw));
  });
});

describe('field readers', () => {
  it('reads through a missing or non-object source without throwing', () => {
    expect(fieldValue(null, 'a')).toBeNull();
    expect(fieldString(7, 'a')).toBeNull();
    expect(fieldNumber(undefined, 'a')).toBeNull();
    expect(fieldArray('nope', 'a')).toEqual([]);
  });

  it('refuses a number that is not finite, so a NaN never reaches state', () => {
    expect(fieldNumber({ tick: Number.NaN }, 'tick')).toBeNull();
    expect(fieldNumber({ tick: Number.POSITIVE_INFINITY }, 'tick')).toBeNull();
  });

  it('reads the ack off the self record rather than the head', () => {
    const frame = snapFrame({ self: { ack: 12 } });
    expect(fieldNumber(frame, 'ack')).toBeNull();
    expect(fieldNumber(fieldValue(frame, 'self'), 'ack')).toBe(12);
  });

  // Entity flags are booleans. Reading them with a number-only reader drops them
  // silently, which looks exactly like a field that never changes.
  describe('fieldScalar', () => {
    it('renders a boolean, which fieldNumber cannot', () => {
      expect(fieldNumber({ dead: false }, 'dead')).toBeNull();
      expect(fieldScalar({ dead: false }, 'dead')).toBe('false');
      expect(fieldScalar({ dead: true }, 'dead')).toBe('true');
    });

    it('distinguishes false from absent', () => {
      expect(fieldScalar({ inCombat: false }, 'inCombat')).not.toBe(fieldScalar({}, 'inCombat'));
    });

    it('renders numbers and strings, and blanks anything else', () => {
      expect(fieldScalar({ hp: 1375 }, 'hp')).toBe('1375');
      expect(fieldScalar({ name: 'Marshal' }, 'name')).toBe('Marshal');
      expect(fieldScalar({ pos: { x: 1 } }, 'pos')).toBe('');
      expect(fieldScalar({ targetId: null }, 'targetId')).toBe('');
    });
  });
});

describe('redactOutbound', () => {
  // The client's first frame on every socket, including every reconnect, carries
  // the account bearer token. Without this an addon subscribing to net.onSend is
  // handed it.
  it('blanks the token and the client seed on the auth frame', () => {
    const redacted = redactOutbound(AUTH_FRAME);

    expect(at(redacted, 'token')).not.toBe(AUTH_FRAME.token);
    expect(at(redacted, 'clientSeed')).not.toBe(AUTH_FRAME.clientSeed);
    expect(JSON.stringify(redacted)).not.toContain('bearer-abc123');
  });

  it('keeps the rest of the frame readable', () => {
    const redacted = redactOutbound(AUTH_FRAME);

    expect(redacted.t).toBe('auth-world-3');
    expect(at(redacted, 'character')).toBe(716);
    expect(at(redacted, 'timerWire')).toBe(3);
  });

  it('does not touch the frame the game is about to send', () => {
    redactOutbound(AUTH_FRAME);

    expect(AUTH_FRAME.token).toBe('bearer-abc123');
  });

  // An input frame is the 20 Hz case, so the common path has to be allocation
  // free rather than copying every frame just in case.
  it('returns the frame itself when there is nothing to redact', () => {
    const input = { t: 'input', seq: 4 };
    expect(redactOutbound(input)).toBe(input);
  });
});

describe('deepFreeze', () => {
  it('freezes nested objects and arrays', () => {
    const frame = deepFreeze({ t: 'events', list: [{ type: 'damage', amount: 12 }] });

    expect(Object.isFrozen(frame)).toBe(true);
    expect(Object.isFrozen(frame.list)).toBe(true);
    expect(Object.isFrozen(frame.list[0])).toBe(true);
  });

  it('stops one handler changing what the next one sees', () => {
    const frame: Record<string, unknown> = deepFreeze({ t: 'snap', tick: 1 });

    expect(() => {
      setAt(frame, 'tick', 999);
    }).toThrow(TypeError);
    expect(at(frame, 'tick')).toBe(1);
  });

  it('terminates on a cycle, since freezing happens before the recursion', () => {
    const cyclic: Record<string, unknown> = { t: 'snap' };
    setAt(cyclic, 'self', cyclic);

    expect(() => deepFreeze(cyclic)).not.toThrow();
    expect(Object.isFrozen(cyclic)).toBe(true);
  });
});
