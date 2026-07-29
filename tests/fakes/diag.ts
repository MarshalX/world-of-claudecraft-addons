// biome-ignore-all lint/suspicious/noConsole: the mirror of loader/src/shared/diag.ts, which carries the same suppression for the same reason: something has to reach the console so that nothing else does
// Capturing the loader's diagnostic channel.
//
// Several modules report a recoverable problem through diag.ts rather than
// throwing, and "it was reported" is part of what those modules promise: a
// dropped record that nobody is told about is the silent failure the reporting
// exists to prevent. Asserting that promise means reaching the console, so the
// reach is collected here instead of in every suite.

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
