// What keeps two stage runs from bundling over each other.
//
// `stage/stage.js` is ONE file every scenario shares, and both stage entry points
// bind port 5182, so the bind is the whole of what makes them exclusive. That only
// holds while the bundle is written from INSIDE the tool, after the bind: a build
// chained ahead of it in the script runs in its own process, rewrites the bundle
// under whoever already holds the port, and only then discovers the port is taken.
//
// This pins the shape rather than the behaviour, because the behaviour needs two
// processes and a real socket. It is the same bargain `tools-readme.test.ts` makes
// in testing the markers rather than the generated section: test the thing that
// would silently remove the guarantee. The failure it guards against is the
// expensive kind, a 15 second `waitForSelector` on a scenario that was fine.
//
// The manifest arrives as text through `?raw` rather than as a typed JSON import,
// for the reason `tools/brand.ts` exists: node:fs stays on the side of the
// boundary where `noNodejsModules` is exempt, and a test file is not that side.

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

  // The exception that proves the split, and the one the table in AGENTS.md warns
  // about: this is the bundler on its own, it binds nothing, and so it is the one
  // way left to rewrite the bundle under a live capture.
  it('leaves build:stage as the bare bundler, which binds no port', () => {
    expect(scripts()['build:stage']).toContain(BUILDER);
  });
});
