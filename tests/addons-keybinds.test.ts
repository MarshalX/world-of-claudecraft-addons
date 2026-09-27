// No two binds the loader can register at once claim the same combo. The dispatcher fires EVERY
// matching registration, so a shared default acts twice on one press. The loader's own binds are
// included, and combos are compared canonically ('Shift+Alt+KeyE' is 'Alt+Shift+KeyE').
//
// Reads the filesystem through tools/manifests.ts because `noNodejsModules` is not exempt here.

import { describe, expect, it } from 'vitest';
import { LOADER_BIND_DECLS, LOADER_OWNER } from '../loader/src/runtime/keys/loader-binds.ts';
import { normalizeCombo } from '../loader/src/shared/combo.ts';
import { addonDirs, readAddon } from '../tools/manifests.ts';

interface Claim {
  /** '<addon id>:<bind id>', which is what the dispatcher keys a registration by. */
  key: string;
  combo: string;
}

/**
 * Every bind the loader could register at once, canonicalised. An invalid manifest contributes
 * nothing (`pnpm validate` reports it); a combo that does not normalise is kept as written.
 */
function claims(): Claim[] {
  const out: Claim[] = LOADER_BIND_DECLS.map((decl) => ({
    key: `${LOADER_OWNER}:${decl.id}`,
    combo: normalizeCombo(decl.default) ?? decl.default,
  }));
  for (const dir of addonDirs()) {
    const result = readAddon(dir);
    if (result.ok) {
      for (const bind of result.manifest.keybinds ?? []) {
        out.push({
          key: `${result.manifest.id}:${bind.id}`,
          combo: normalizeCombo(bind.default) ?? bind.default,
        });
      }
    }
  }
  return out;
}

/** Combo to the keys claiming it, for the combos claimed more than once. */
function collisions(): Record<string, string[]> {
  const byCombo = new Map<string, string[]>();
  for (const claim of claims()) {
    byCombo.set(claim.combo, [...(byCombo.get(claim.combo) ?? []), claim.key]);
  }
  const out: Record<string, string[]> = {};
  for (const [combo, keys] of byCombo) {
    if (keys.length > 1) {
      out[combo] = keys;
    }
  }
  return out;
}

describe('the marketplace keybinds', () => {
  // Within one addon too: two of its own commands on one key fire together.
  it('are claimed by exactly one command each', () => {
    expect(collisions()).toEqual({});
  });

  // An empty claim list would pass the check above while proving nothing.
  it('are actually being looked at', () => {
    expect(claims().length).toBeGreaterThan(LOADER_BIND_DECLS.length);
  });
});
