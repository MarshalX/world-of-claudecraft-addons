// biome-ignore-all lint/suspicious/noConsole: the mirror of loader/src/shared/diag.ts, which carries the same suppression for the same reason: something has to reach the console so that nothing else does
// Captures the loader's diagnostic channel, so a suite can assert a problem was reported.

import { vi } from 'vitest';

export interface CapturedDiag {
  /** Every diagError call, most recent last, as its message plus details. */
  errors: () => unknown[][];
  restore: () => void;
}

export function captureDiag(): CapturedDiag {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  return {
    errors: () => spy.mock.calls,
    restore: () => {
      spy.mockRestore();
    },
  };
}
