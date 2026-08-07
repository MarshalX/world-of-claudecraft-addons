// An addon's `preview.alt` is written in TWO places that nothing ties together: on
// the SCENARIO in `stage.ts`, beside the fixture that produces the panel, and in
// `addon.json`, which `pnpm shots` copies it into and which everything else reads.
//
// They can disagree silently either way. A manifest-only edit is overwritten by the
// next capture; a scenario-only edit ships a stale description until somebody runs
// a tool that rewrites every PNG in the tree. This needs no browser, so it catches
// the drift on the commit that introduces it.
//
// It COMPOSES the whole string rather than checking each panel's sentence appears
// in it. Containment passes while the lead ("On the left,") or the join changes,
// and those are part of what a screen reader reads out.
//
// It reads the filesystem through tools/manifests.ts, as tests/addons-suites.test.ts
// does: `noNodejsModules` is not exempt under `tests/**`.

import { describe, expect, it } from 'vitest';
import { addonDirs, readAddon } from '../tools/manifests.ts';
import { type Panel, previewAlt } from '../tools/shots-core.ts';

interface Scenario {
  preview?: boolean;
  caption?: string | undefined;
  alt?: string;
}

interface Shipped {
  dir: string;
  alt: string;
}

/**
 * Read with a computed access rather than `module.SCENARIOS`, because the name is the
 * addon's: `useNamingConvention` asks for camelCase on a property either way. Same
 * idiom as `fieldValue` in runtime/net/frames.ts.
 */
const SCENARIOS_EXPORT = 'SCENARIOS';

/** Every addon whose manifest declares a preview, with the sentence it ships. */
function shipped(): Shipped[] {
  const found: Shipped[] = [];
  for (const dir of addonDirs()) {
    const read = readAddon(dir);
    if (read.ok) {
      const { preview } = read.manifest;
      if (preview !== undefined) {
        found.push({ dir, alt: preview.alt });
      }
    }
  }
  return found;
}

function scenariosIn(module: Record<string, unknown>): readonly Scenario[] {
  const found = module[SCENARIOS_EXPORT];
  if (Array.isArray(found)) {
    return found as readonly Scenario[];
  }
  return [];
}

/**
 * The panels one addon marks for the preview, read the way `pnpm shots` reads them.
 * An addon promising a picture with no scenario to produce it THROWS rather than
 * being skipped.
 *
 * `stage.ts` is literal in the template because vite's dynamic-import-vars plugin
 * warns on a specifier whose extension is not in the static part.
 */
async function panelsOf(dir: string): Promise<Panel[]> {
  const module: Record<string, unknown> = await import(`../addons/${dir}/stage.ts`);
  return scenariosIn(module)
    .filter((one) => one.preview === true)
    .map((one) => ({ caption: one.caption, alt: one.alt ?? '' }));
}

/** Which side is stale, since the two want opposite fixes. */
function drift(dir: string, composed: string, alt: string): string {
  return [
    `${dir}: the alt in addon.json does not match what its scenarios compose.`,
    'Edit the alt on the SCENARIO in stage.ts, which is where it lives, then',
    'copy the composed string into addon.json so the next `pnpm shots` writes no diff.',
    `  from stage.ts: ${composed}`,
    `  in addon.json: ${alt}`,
  ].join('\n');
}

describe('every addon that ships a preview', () => {
  it('has an alt in its manifest that its own scenarios compose', async () => {
    const mismatched: string[] = [];
    const rows = shipped();
    const composed = await Promise.all(rows.map(async (row) => await panelsOf(row.dir)));
    for (const [at, row] of rows.entries()) {
      const panels = composed[at] ?? [];
      const built = previewAlt(panels);
      if (built !== row.alt) {
        mismatched.push(drift(row.dir, built, row.alt));
      }
    }
    expect(mismatched).toEqual([]);
  });

  // The guard on the guard, the same one addons-suites.test.ts carries: an empty
  // list makes the check above vacuous, so a broken `addonDirs` or a manifest
  // schema change that hid `preview` would pass it while proving nothing.
  it('is actually being looked at', () => {
    expect(shipped().length).toBeGreaterThan(0);
  });
});
