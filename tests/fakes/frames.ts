// Frame and entity fixtures, shaped from traffic observed on a live pbe client
// rather than from the game's type declarations.
//
// The two disagree in ways that decide whether this code works at all. The ack
// the latency pairing needs rides the `self` record and not the snapshot head,
// and an Entity carries `maxHp`/`resource` where the wire record that delivered
// it used `mhp`/`res`. Both of those were wrong here until a real session said
// so, so these fixtures are the record of what the game actually sends.

/** The client's first frame on every socket. `token` is the account bearer token. */
export const AUTH_FRAME = {
  t: 'auth-world-3',
  token: 'bearer-abc123',
  character: 716,
  clientSeed: 'seed-xyz',
  timerWire: 3,
};

export const HELLO_FRAME = {
  t: 'hello',
  pid: 661,
  seed: 20_061,
  realm: 'Claudemoon',
  softWords: [],
};

/** A player entity as the client holds it, not as the wire spells it. */
export const PLAYER_ENTITY = {
  id: 661,
  name: 'Marshal',
  level: 20,
  hp: 1375,
  maxHp: 1375,
  resource: 100,
  maxResource: 100,
  dead: false,
  inCombat: false,
  targetId: null as number | null,
};

export function snapFrame(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { t: 'snap', tick: 242_554, time: 12_127.7, self: { id: 661, ack: 0 }, ...over };
}

/** A snapshot carrying an ack on the self record, where the server puts it. */
export function ackSnap(ack: number): Record<string, unknown> {
  return snapFrame({ self: { id: 661, ack } });
}

export function inputFrame(seq: number): Record<string, unknown> {
  return { t: 'input', seq, mi: { f: 1 } };
}

export function eventsFrame(list: readonly unknown[]): Record<string, unknown> {
  return { t: 'events', list };
}

export function text(frame: unknown): string {
  return JSON.stringify(frame);
}

/**
 * Read a fixture field by name.
 *
 * Tests index these objects constantly, and a literal key on a record type is
 * caught between two rules that disagree: the linter wants dot access and the
 * compiler forbids it on an index signature. A named key settles both.
 */
export function at(source: unknown, key: string): unknown {
  return (source as Record<string, unknown>)[key];
}

export function setAt(target: unknown, key: string, value: unknown): void {
  (target as Record<string, unknown>)[key] = value;
}
