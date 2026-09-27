// `preview.alt` lives on the scenario in `stage.ts` and is copied into `addon.json` by
// `pnpm shots`; nothing else ties the two together. Compare the whole composed string,
// since the lead ("On the left,") and the join are read aloud too. The filesystem is
// read through tools/manifests.ts because `noNodejsModules` is not exempt in `tests/**`.

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

/** A computed access, because `useNamingConvention` rejects `module.SCENARIOS`. */
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
 * The panels one addon marks for the preview, read the way `pnpm shots` reads them. A
 * missing `stage.ts` throws. The extension stays literal in the template because vite's
 * dynamic-import-vars plugin warns otherwise.
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

  // An empty list would make the check above pass vacuously.
  it('includes at least one addon', () => {
    expect(shipped().length).toBeGreaterThan(0);
  });
});
