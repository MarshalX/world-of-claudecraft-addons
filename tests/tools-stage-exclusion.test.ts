// The port bind is what keeps two stage runs from bundling over each other, so the bundle has
// to be written inside the tool after the bind. A build chained ahead of it in the script
// rewrites `stage/stage.js` under a run that already holds the port. This pins the script
// shape, since the behaviour needs two processes and a real socket.

import { describe, expect, it } from 'vitest';
import PACKAGE_TEXT from '../package.json?raw';

const BUILDER = 'build-stage.mjs';

/** The two scripts that own the port, by the name `pnpm` knows them as. */
const GUARDED = ['stage', 'shots'] as const;

function scripts(): Record<string, string> {
  const parsed: unknown = JSON.parse(PACKAGE_TEXT);
  const found = (parsed as { scripts?: Record<string, string> }).scripts;
  if (found === undefined) {
    throw new Error('package.json declares no scripts');
  }
  return found;
}

describe('the stage entry points', () => {
  it.each(GUARDED)('runs %s without chaining the bundler ahead of the port bind', (name) => {
    const script = scripts()[name];

    expect(script).toBeDefined();
    expect(script).not.toContain(BUILDER);
  });

  // The bundler alone binds nothing, so it can still rewrite the bundle under a live capture.
  it('leaves build:stage as the bare bundler, which binds no port', () => {
    expect(scripts()['build:stage']).toContain(BUILDER);
  });
});
